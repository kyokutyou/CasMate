import iconv from 'iconv-lite';
import type { NormalizedShitarabaInput } from '../sources/source-inputs';
import { normalizeShitarabaInput } from '../sources/source-inputs';

export interface ShitarabaThreadContent {
  title: string;
  body: string;
}

export interface CreateNextThreadRequest {
  currentThread: NormalizedShitarabaInput;
  title: string;
  body: string;
  authorName: string;
  email: string;
}

export interface AnnounceNextThreadRequest {
  currentThread: NormalizedShitarabaInput;
  message: string;
  authorName: string;
  email: string;
}

export interface ShitarabaWriteAdapter {
  fetchThreadContent(thread: NormalizedShitarabaInput): Promise<ShitarabaThreadContent>;
  findThreadsByTitle(thread: NormalizedShitarabaInput, title: string): Promise<string[]>;
  createNextThread(request: CreateNextThreadRequest): Promise<{ threadUrl: string }>;
  announceNextThread(request: AnnounceNextThreadRequest): Promise<void>;
}

export class ShitarabaWriteFailure extends Error {
  constructor(
    readonly kind: 'preflight' | 'rejected' | 'uncertain' | 'browserRequired',
    message: string,
  ) {
    super(message);
  }
}

export interface ShitarabaWriteRuntime {
  fetch: typeof fetch;
}

const defaultRuntime: ShitarabaWriteRuntime = { fetch };
const requestTimeoutMilliseconds = 15_000;

export class FetchShitarabaWriteAdapter implements ShitarabaWriteAdapter {
  constructor(private readonly runtime: ShitarabaWriteRuntime = defaultRuntime) {}

  async findThreadsByTitle(
    thread: NormalizedShitarabaInput,
    title: string,
  ): Promise<string[]> {
    let response: Response;
    try {
      response = await this.runtime.fetch(subjectUrlOf(thread), {
        cache: 'no-store',
        signal: AbortSignal.timeout(requestTimeoutMilliseconds),
      });
    } catch {
      throw new ShitarabaWriteFailure('preflight', '掲示板の既存スレッドを確認できません。');
    }
    if (!response.ok) {
      throw new ShitarabaWriteFailure('preflight', '掲示板の既存スレッドを確認できません。');
    }
    let raw: string;
    try {
      raw = (await decodeResponse(response, 'euc-jp')).text;
    } catch {
      throw new ShitarabaWriteFailure('preflight', '掲示板の既存スレッドを確認できません。');
    }
    const decodeEntities = await getEntityDecoder();
    const expected = title.trim();
    const matches = new Set<string>();
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const match = line.match(/^(\d+)\.cgi,(.*)\s*\(\d+\)\s*$/);
      if (!match) {
        throw new ShitarabaWriteFailure('preflight', '掲示板の既存スレッドを確認できません。');
      }
      if (!match?.[1] || match[1] === thread.threadId) continue;
      const candidateTitle = decodeEntities(stripAllMarkup(match[2] ?? '')).trim();
      if (candidateTitle !== expected) continue;
      matches.add(
        `https://jbbs.shitaraba.net/bbs/read.cgi/${thread.category}/${thread.boardId}/${match[1]}/`,
      );
    }
    return [...matches];
  }

  async fetchThreadContent(thread: NormalizedShitarabaInput): Promise<ShitarabaThreadContent> {
    const url = `https://jbbs.shitaraba.net/bbs/rawmode.cgi/${thread.category}/${thread.boardId}/${thread.threadId}/1`;
    let response: Response;
    try {
      response = await this.runtime.fetch(url, { signal: AbortSignal.timeout(requestTimeoutMilliseconds) });
    } catch {
      throw new ShitarabaWriteFailure('preflight', '現行スレッドの作成予定内容を取得できません。');
    }
    if (!response.ok) {
      throw new ShitarabaWriteFailure('preflight', '現行スレッドの作成予定内容を取得できません。');
    }
    let raw: string;
    try {
      raw = (await decodeResponse(response, 'euc-jp')).text;
    } catch {
      throw new ShitarabaWriteFailure('preflight', '現行スレッドの作成予定内容を取得できません。');
    }
    const line = raw.split(/\r?\n/).find((candidate) => candidate.trim());
    const fields = line?.split('<>');
    if (!fields || fields[0]?.trim() !== '1' || fields.length < 6) {
      throw new ShitarabaWriteFailure('preflight', '現行スレッドの1レス目を確認できません。');
    }
    const decodeEntities = await getEntityDecoder();
    const title = decodeEntities(stripAllMarkup(fields[5] ?? '')).trim();
    const body = markupToText(fields[4] ?? '', decodeEntities);
    if (!title || !body) {
      throw new ShitarabaWriteFailure('preflight', '現行スレッドからタイトルまたは本文を用意できません。');
    }
    return { title, body };
  }

  async createNextThread(request: CreateNextThreadRequest): Promise<{ threadUrl: string }> {
    const boardUrl = boardUrlOf(request.currentThread);
    const form = await this.fetchForm(boardUrl, request.currentThread, 'create');
    const postedRequest = {
      ...request,
      title: obfuscatePostedUrls(request.title),
      body: obfuscatePostedUrls(request.body),
      authorName: obfuscatePostedUrls(request.authorName),
      email: obfuscatePostedUrls(request.email),
    };
    const fields = withValues(form, {
      subject: postedRequest.title,
      name: postedRequest.authorName,
      mail: postedRequest.email,
      message: postedRequest.body,
    });
    const response = await this.submit(form, fields, boardUrl);
    let threadUrl: string | null;
    try {
      threadUrl = await createdThreadUrl(response, request.currentThread, form.encoding);
    } catch (error) {
      if (error instanceof ShitarabaWriteFailure) throw error;
      threadUrl = null;
    }
    if (
      !threadUrl &&
      (response.ok || (response.status >= 300 && response.status < 400))
    ) {
      threadUrl = await this.findCreatedThread(postedRequest, form.knownThreadIds);
    }
    if (!threadUrl) {
      throw new ShitarabaWriteFailure('uncertain', '送信後に次スレッドの作成を確認できません。したらばをブラウザで確認してください。');
    }
    return { threadUrl };
  }

  async announceNextThread(request: AnnounceNextThreadRequest): Promise<void> {
    return this.postComment(request, true);
  }

  async postAiComment(request: AnnounceNextThreadRequest): Promise<void> {
    return this.postComment(request, false);
  }

  private async postComment(request: AnnounceNextThreadRequest, obfuscate: boolean): Promise<void> {
    const form = await this.fetchForm(request.currentThread.url, request.currentThread, 'announce');
    const fields = withValues(form, {
      name: obfuscate ? obfuscatePostedUrls(request.authorName) : request.authorName,
      mail: obfuscate ? obfuscatePostedUrls(request.email) : request.email,
      message: obfuscate ? obfuscatePostedUrls(request.message) : request.message,
    });
    const response = await this.submit(form, fields, request.currentThread.url);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (location && verifyAnnouncementRedirect(location, response, request.currentThread)) return;
      throw new ShitarabaWriteFailure('uncertain', '送信後に案内投稿の成功を確認できません。');
    }
    let responseText: string;
    try {
      responseText = (await decodeResponse(response, form.encoding)).text;
    } catch {
      throw new ShitarabaWriteFailure('uncertain', '送信後に案内投稿の成功を確認できません。');
    }
    if (/書き?[込こ]みました|書きこみました/i.test(responseText)) return;
    if (looksRejected(responseText) || !response.ok) {
      throw new ShitarabaWriteFailure('rejected', safeRejectionMessage(responseText));
    }
    throw new ShitarabaWriteFailure('uncertain', '送信後に案内投稿の成功を確認できません。');
  }

  private async fetchForm(
    pageUrl: string,
    thread: NormalizedShitarabaInput,
    kind: 'create' | 'announce',
  ): Promise<ParsedForm> {
    let response: Response;
    try {
      response = await this.runtime.fetch(pageUrl, {
        signal: AbortSignal.timeout(requestTimeoutMilliseconds),
      });
    } catch {
      throw new ShitarabaWriteFailure('preflight', 'したらばの公開フォームを取得できません。');
    }
    if (!response.ok) {
      throw new ShitarabaWriteFailure('preflight', 'したらばの公開フォームを取得できません。');
    }
    let decoded: DecodedResponse;
    try {
      decoded = await decodeResponse(response, 'euc-jp');
    } catch {
      throw new ShitarabaWriteFailure('preflight', 'したらばの公開フォームを取得できません。');
    }
    const decodeEntities = await getEntityDecoder();
    const forms = parseForms(decoded.text, pageUrl, decoded.encoding, decodeEntities).filter((form) => {
      if (form.method !== 'post') return false;
      const path = new URL(form.action).pathname;
      return kind === 'create' ? /\/new\/?$/i.test(path) : !/\/new\/?$/i.test(path);
    });
    const form = forms.find((candidate) => actionMatchesBoard(candidate.action, thread));
    if (!form) {
      throw new ShitarabaWriteFailure('preflight', 'したらばの公開フォームを解析できません。ブラウザを使用してください。');
    }
    if (!form.encoding || form.hasInteractiveChallenge) {
      throw new ShitarabaWriteFailure('preflight', 'CAPTCHA、パスワード、または未対応の文字コードが必要なためアプリからは送信できません。ブラウザを使用してください。');
    }
    const required = kind === 'create'
      ? ['subject', 'name', 'mail', 'message']
      : ['name', 'mail', 'message'];
    if (required.some((name) => !form.controlNames.has(name))) {
      throw new ShitarabaWriteFailure('preflight', 'したらばの公開フォームを解析できません。ブラウザを使用してください。');
    }
    return {
      ...form,
      encoding: form.encoding,
      knownThreadIds: kind === 'create'
        ? threadIdsIn(decoded.text, thread)
        : new Set<string>(),
    };
  }

  private async findCreatedThread(
    request: CreateNextThreadRequest,
    knownThreadIds: ReadonlySet<string>,
  ): Promise<string | null> {
    let response: Response;
    try {
      response = await this.runtime.fetch(boardUrlOf(request.currentThread), {
        cache: 'no-store',
        signal: AbortSignal.timeout(requestTimeoutMilliseconds),
      });
    } catch {
      return null;
    }
    if (!response.ok) return null;
    let decoded: DecodedResponse;
    try {
      decoded = await decodeResponse(response, 'euc-jp');
    } catch {
      return null;
    }
    const candidates = [...threadIdsIn(decoded.text, request.currentThread)]
      .filter((threadId) => (
        threadId !== request.currentThread.threadId && !knownThreadIds.has(threadId)
      ));
    if (candidates.length > 10) return null;
    const matches: string[] = [];
    for (const threadId of candidates) {
      const candidate = normalizeShitarabaInput(
        `https://jbbs.shitaraba.net/bbs/read.cgi/${request.currentThread.category}/${request.currentThread.boardId}/${threadId}/`,
      );
      let content: ShitarabaThreadContent;
      try {
        content = await this.fetchThreadContent(candidate);
      } catch {
        continue;
      }
      if (
        normalizePostedText(content.title) === normalizePostedText(request.title) &&
        normalizePostedText(content.body) === normalizePostedText(request.body)
      ) {
        matches.push(candidate.url);
      }
    }
    return matches.length === 1 ? matches[0] ?? null : null;
  }

  private async submit(form: ParsedForm, fields: Array<[string, string]>, referer: string) {
    let body: Uint8Array;
    try {
      body = encodeForm(fields, form.encoding);
    } catch {
      throw new ShitarabaWriteFailure('preflight', 'したらばの文字コードで表せない文字が含まれています。入力内容を確認してください。');
    }
    try {
      return await this.runtime.fetch(form.action, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'Content-Type': `application/x-www-form-urlencoded; charset=${encodingLabel(form.encoding)}`,
          Referer: referer,
        },
        body: body as unknown as BodyInit,
        signal: AbortSignal.timeout(requestTimeoutMilliseconds),
      });
    } catch {
      throw new ShitarabaWriteFailure('uncertain', '送信後にしたらばからの結果を受け取れませんでした。自動再試行は行いません。');
    }
  }
}

interface ParsedForm {
  method: string;
  action: string;
  hiddenFields: Array<[string, string]>;
  namesByLowerCase: Map<string, string>;
  controlNames: Set<string>;
  hasInteractiveChallenge: boolean;
  encoding: FormEncoding;
  knownThreadIds: ReadonlySet<string>;
}

type ParsedFormCandidate = Omit<ParsedForm, 'encoding' | 'knownThreadIds'> & {
  encoding: FormEncoding | null;
};
type EntityDecoder = (value: string) => string;

function parseForms(
  html: string,
  pageUrl: string,
  pageEncoding: FormEncoding,
  decodeEntities: EntityDecoder,
): ParsedFormCandidate[] {
  const forms: ParsedFormCandidate[] = [];
  for (const match of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form\s*>/gi)) {
    const attributes = attributesOf(match[1] ?? '');
    let action: URL;
    try {
      action = new URL(decodeEntities(attributes.action ?? ''), pageUrl);
    } catch {
      continue;
    }
    if (action.protocol !== 'https:' || action.hostname.toLowerCase() !== 'jbbs.shitaraba.net') continue;
    const content = match[2] ?? '';
    const hiddenFields: Array<[string, string]> = [];
    const namesByLowerCase = new Map<string, string>();
    const controlNames = new Set<string>();
    let hasPasswordControl = false;
    for (const input of content.matchAll(/<input\b([^>]*)>/gi)) {
      const inputAttributes = attributesOf(input[1] ?? '');
      if ((inputAttributes.type ?? 'text').toLowerCase() === 'password') {
        hasPasswordControl = true;
      }
      const name = decodeEntities(inputAttributes.name ?? '');
      if (!name) continue;
      const lower = name.toLowerCase();
      namesByLowerCase.set(lower, name);
      controlNames.add(lower);
      if ((inputAttributes.type ?? 'text').toLowerCase() === 'hidden') {
        hiddenFields.push([name, decodeEntities(inputAttributes.value ?? '')]);
      }
    }
    for (const textarea of content.matchAll(/<textarea\b([^>]*)>[\s\S]*?<\/textarea\s*>/gi)) {
      const name = decodeEntities(attributesOf(textarea[1] ?? '').name ?? '');
      if (!name) continue;
      namesByLowerCase.set(name.toLowerCase(), name);
      controlNames.add(name.toLowerCase());
    }
    forms.push({
      method: (attributes.method ?? 'get').toLowerCase(),
      action: action.href,
      hiddenFields,
      namesByLowerCase,
      controlNames,
      hasInteractiveChallenge: hasPasswordControl || /captcha|g-recaptcha|hcaptcha/i.test(content),
      encoding: attributes['accept-charset']
        ? normalizeEncoding(attributes['accept-charset'])
        : pageEncoding,
    });
  }
  return forms;
}

function attributesOf(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of source.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    attributes[(match[1] ?? '').toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return attributes;
}

function withValues(form: ParsedForm, replacements: Record<string, string>): Array<[string, string]> {
  const replacementNames = new Set(Object.keys(replacements));
  const fields = form.hiddenFields.filter(([name]) => !replacementNames.has(name.toLowerCase()));
  for (const [name, value] of Object.entries(replacements)) {
    const actualName = form.namesByLowerCase.get(name);
    if (actualName) fields.push([actualName, value]);
  }
  return fields;
}

export function encodeForm(fields: Array<[string, string]>, encoding: FormEncoding): Uint8Array {
  const encoded = fields.map(([name, value]) =>
    `${encodeFormComponent(name, encoding)}=${encodeFormComponent(value, encoding)}`,
  ).join('&');
  return new TextEncoder().encode(encoded);
}

function encodeFormComponent(value: string, encoding: FormEncoding): string {
  let result = '';
  const bytes = iconv.encode(value, encoding);
  if (iconv.decode(bytes, encoding) !== value) throw new Error('unrepresentable character');
  for (const byte of bytes) {
    if (
      (byte >= 0x41 && byte <= 0x5a) ||
      (byte >= 0x61 && byte <= 0x7a) ||
      (byte >= 0x30 && byte <= 0x39) ||
      byte === 0x2a || byte === 0x2d || byte === 0x2e || byte === 0x5f
    ) {
      result += String.fromCharCode(byte);
    } else if (byte === 0x20) {
      result += '+';
    } else {
      result += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    }
  }
  return result;
}

async function createdThreadUrl(
  response: Response,
  current: NormalizedShitarabaInput,
  encoding: FormEncoding,
): Promise<string | null> {
  const location = response.headers.get('location');
  if (location && response.status >= 300 && response.status < 400) {
    const verified = verifyCreatedThreadUrl(new URL(location, response.url || current.url).href, current);
    if (verified) return verified;
  }
  if (response.status >= 300 && response.status < 400) return null;
  const responseText = (await decodeResponse(response, encoding)).text;
  if (looksRejected(responseText) || (response.status >= 400 && response.status < 500)) {
    throw new ShitarabaWriteFailure('rejected', safeRejectionMessage(responseText));
  }
  if (!response.ok) return null;
  if (!/(?:新規)?スレッド(?:を|が)?(?:正常に)?(?:作成(?:しました|されました)|作成できました)|書き?[込こ]みました/i.test(responseText)) {
    return null;
  }
  for (const match of responseText.matchAll(/(?:href\s*=\s*["']?)?(https?:\/\/jbbs\.shitaraba\.net)?(\/bbs\/read\.cgi\/[a-zA-Z0-9_-]+\/\d+\/\d+\/?)/gi)) {
    const verified = verifyCreatedThreadUrl(new URL(`${match[1] ?? ''}${match[2]}`, current.url).href, current);
    if (verified) return verified;
  }
  return null;
}

function verifyCreatedThreadUrl(raw: string, current: NormalizedShitarabaInput): string | null {
  try {
    const candidate = normalizeShitarabaInput(raw);
    if (
      candidate.category !== current.category ||
      candidate.boardId !== current.boardId ||
      candidate.threadId === current.threadId
    ) return null;
    return candidate.url;
  } catch {
    return null;
  }
}

function verifyAnnouncementRedirect(
  location: string,
  response: Response,
  current: NormalizedShitarabaInput,
): boolean {
  try {
    const candidate = normalizeShitarabaInput(
      new URL(location, response.url || current.url).href,
    );
    return candidate.url === current.url;
  } catch {
    return false;
  }
}

function actionMatchesBoard(action: string, thread: NormalizedShitarabaInput): boolean {
  const path = new URL(action).pathname;
  return path.startsWith(`/bbs/write.cgi/${thread.category}/${thread.boardId}/`);
}

function boardUrlOf(thread: NormalizedShitarabaInput): string {
  return `https://jbbs.shitaraba.net/${thread.category}/${thread.boardId}/`;
}

function subjectUrlOf(thread: NormalizedShitarabaInput): string {
  return `${boardUrlOf(thread)}subject.txt`;
}

function threadIdsIn(
  html: string,
  board: NormalizedShitarabaInput,
): Set<string> {
  const ids = new Set<string>();
  for (const match of html.matchAll(
    /\/bbs\/read\.cgi\/([a-zA-Z0-9_-]+)\/(\d+)\/(\d+)(?:\/[^\s"'<>]*)?/gi,
  )) {
    if (match[1] === board.category && match[2] === board.boardId && match[3]) {
      ids.add(match[3]);
    }
  }
  return ids;
}

function normalizePostedText(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim();
}

function obfuscatePostedUrls(value: string): string {
  return value.replace(/https?:\/\//gi, (scheme) => scheme.slice(1));
}

function markupToText(value: string, decodeEntities: EntityDecoder): string {
  return decodeEntities(
    value
      .replace(/<(script|style|iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p\s*>/gi, '\n')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/\r\n?/g, '\n')
    .replace(/^(?:[\t ]*\n)+|(?:\n[\t ]*)+$/g, '');
}

function stripAllMarkup(value: string): string {
  return value
    .replace(/<(script|style|iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<[^>]*>/g, '');
}

let entityDecoderPromise: Promise<EntityDecoder> | undefined;

async function getEntityDecoder(): Promise<EntityDecoder> {
  entityDecoderPromise ??= import('entities').then(({ decode, EntityLevel }) =>
    (value: string) => decode(value, EntityLevel.HTML).replace(/\u00a0/g, ' '),
  );
  return entityDecoderPromise;
}

type FormEncoding = 'euc-jp' | 'shift_jis' | 'utf-8';

interface DecodedResponse {
  text: string;
  encoding: FormEncoding;
}

async function decodeResponse(
  response: Response,
  fallback: FormEncoding,
): Promise<DecodedResponse> {
  const bytes = Buffer.from(await response.arrayBuffer());
  const contentTypeCharset = response.headers.get('content-type')?.match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1];
  const ascii = bytes.toString('latin1');
  const metaCharset = ascii.match(/<meta\b[^>]*charset\s*=\s*["']?([^\s"'/>;]+)/i)?.[1]
    ?? ascii.match(/<meta\b[^>]*content\s*=\s*["'][^"']*charset=([^\s"';]+)/i)?.[1];
  const declared = contentTypeCharset ?? metaCharset;
  const encoding = declared ? normalizeEncoding(declared) : fallback;
  if (!encoding) throw new Error('unsupported charset');
  return { text: iconv.decode(bytes, encoding), encoding };
}

function normalizeEncoding(value: string): FormEncoding | null {
  const first = value.trim().split(/[\s,]+/, 1)[0]?.toLowerCase().replace(/_/g, '-');
  if (first === 'euc-jp' || first === 'eucjp') return 'euc-jp';
  if (first === 'shift-jis' || first === 'shiftjis' || first === 'sjis' || first === 'windows-31j') {
    return 'shift_jis';
  }
  if (first === 'utf-8' || first === 'utf8') return 'utf-8';
  return null;
}

function encodingLabel(encoding: FormEncoding): string {
  if (encoding === 'euc-jp') return 'EUC-JP';
  if (encoding === 'shift_jis') return 'Shift_JIS';
  return 'UTF-8';
}

function looksRejected(value: string): boolean {
  return /エラー|失敗|禁止|規制|ホスト|NGワード|長すぎ|多重|連続スレッド|書き込みでき(?:ません|ない|ず)|作成でき(?:ません|ない|ず)|作成されません|投稿でき(?:ません|ない|ず)|captcha/i.test(value);
}

function safeRejectionMessage(value: string): string {
  if (/NGワード|長すぎ|無記名/i.test(value)) {
    return 'したらばが入力内容を受け付けませんでした。タイトル、本文、投稿者欄を確認してください。';
  }
  if (/外部|参照元|referer/i.test(value)) {
    return 'この掲示板はアプリからの投稿を受け付けていません。ブラウザを使用してください。';
  }
  if (/多重|連続スレッド/i.test(value)) {
    return 'したらばの連続作成制限により送信できませんでした。';
  }
  return 'したらばが送信を受け付けませんでした。掲示板の投稿条件を確認してください。';
}
