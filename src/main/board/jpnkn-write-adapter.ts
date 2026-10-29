import iconv from 'iconv-lite';
import { encodeForm, ShitarabaWriteFailure as BoardWriteFailure } from '../shitaraba/shitaraba-write-adapter';
import { normalizeJpnknInput, type NormalizedJpnknInput } from '../sources/source-inputs';
import { isJpnknCp932, jpnknDatUrl, jpnknMarkupToText } from '../sources/jpnkn-source';
import type { BoardAnnounceNextThreadRequest, BoardCreateNextThreadRequest, BoardThreadContent } from './board-write-adapter';

type CreateRequest = Omit<BoardCreateNextThreadRequest, 'currentThread'> & { currentThread: NormalizedJpnknInput };
type CommentRequest = Omit<BoardAnnounceNextThreadRequest, 'currentThread'> & { currentThread: NormalizedJpnknInput };
export interface JpnknWriteRuntime { fetch: typeof fetch }
interface PublicForm { action: string; fields: Array<[string, string]>; names: Map<string, string> }
const defaultRuntime: JpnknWriteRuntime = { fetch };
const timeout = 15_000;

export class FetchJpnknWriteAdapter {
  constructor(private readonly runtime: JpnknWriteRuntime = defaultRuntime) {}

  async fetchThreadContent(thread: NormalizedJpnknInput): Promise<BoardThreadContent> {
    const current = verifyThread(thread);
    const response = await this.get(jpnknDatUrl(current), '現行スレッドの作成予定内容を取得できません。');
    verifyPlainText(response, '現行スレッドのDAT形式を確認できません。');
    const raw = await cp932Response(response, '現行スレッドの文字コードを確認できません。');
    const fields = raw.split(/\r?\n/, 1)[0]?.split('<>');
    if (!raw.includes('\n') || !fields || fields.length !== 5) throw preflight('現行スレッドの1レス目を確認できません。');
    const title = await jpnknMarkupToText(fields[4] ?? '');
    const body = (await jpnknMarkupToText(fields[3] ?? '', false))
      .replace(/^(?:[\t ]*\n)+|(?:\n[\t ]*)+$/g, '');
    if (!title || !body.trim()) throw preflight('現行スレッドからタイトルまたは本文を用意できません。');
    return { title, body };
  }

  async findThreadsByTitle(thread: NormalizedJpnknInput, title: string): Promise<string[]> {
    const current = verifyThread(thread);
    const response = await this.get(boardUrl(current) + 'subject.txt', '掲示板の既存スレッドを確認できません。');
    verifyPlainText(response, '掲示板の既存スレッドを確認できません。');
    const raw = await cp932Response(response, '掲示板の既存スレッドを確認できません。');
    const matches = new Set<string>();
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const match = line.match(/^([1-9]\d*)\.dat<>(.*)\(\d+\)\s*$/);
      if (!match) throw preflight('掲示板の既存スレッドを確認できません。');
      const candidateTitle = await jpnknMarkupToText(match[2]);
      if (!candidateTitle) throw preflight('掲示板の既存スレッドを確認できません。');
      if (match[1] !== current.threadId && candidateTitle === title.trim()) matches.add(threadUrl(current.boardId, match[1]));
    }
    return [...matches];
  }

  async createNextThread(request: CreateRequest): Promise<{ threadUrl: string }> {
    const current = verifyThread(request.currentThread);
    validateText(request.title, 128, true);
    validatePost(request.body, request.authorName, request.email);
    const referer = boardUrl(current);
    const form = await this.fetchForm(referer, current, true);
    const response = await this.submit(form, values(form, {
      subject: request.title, from: request.authorName, mail: request.email, message: request.body,
    }), referer);
    const html = await responseText(response);
    classifyFailure(response, html);
    const location = response.headers.get('location');
    if (location && response.status >= 300 && response.status < 400) {
      const created = verifiedResultUrl(location, current, false, form.action);
      if (created) return { threadUrl: created };
    }
    if (response.ok && successText(html)) {
      const urls = new Set<string>();
      for (const match of html.matchAll(/(?:href|content)\s*=\s*["']([^"']+)["']/gi)) {
        const raw = match[1].replace(/^.*?url\s*=\s*/i, '');
        const created = verifiedResultUrl(await jpnknMarkupToText(raw), current, false, form.action);
        if (created) urls.add(created);
      }
      if (urls.size === 1) return { threadUrl: [...urls][0] };
    }
    throw new BoardWriteFailure('uncertain', 'jpnknへ送信後、次スレッドの作成結果を確認できません。自動再送せず掲示板を確認してください。');
  }

  async announceNextThread(request: CommentRequest): Promise<void> { return this.postComment(request); }
  async postAiComment(request: CommentRequest): Promise<void> { return this.postComment(request); }

  private async postComment(request: CommentRequest): Promise<void> {
    const current = verifyThread(request.currentThread);
    validatePost(request.message, request.authorName, request.email);
    const form = await this.fetchForm(current.url, current, false);
    const response = await this.submit(form, values(form, {
      from: request.authorName, mail: request.email, message: request.message,
    }), current.url);
    const html = await responseText(response);
    classifyFailure(response, html);
    const location = response.headers.get('location');
    if (location && response.status >= 300 && response.status < 400 && verifiedResultUrl(location, current, true, form.action)) return;
    if (response.ok && successText(html)) return;
    throw new BoardWriteFailure('uncertain', 'jpnknへ送信後、投稿結果を確認できません。自動再送せず掲示板を確認してください。');
  }

  private async get(url: string, message: string, inspectFailure = false): Promise<Response> {
    let response: Response;
    try {
      response = await this.runtime.fetch(url, { redirect: 'manual', cache: 'no-store',
        headers: { 'Accept-Encoding': 'identity' }, signal: AbortSignal.timeout(timeout) });
    } catch { throw preflight(message); }
    if (inspectFailure && authenticationLocation(response.headers.get('location') ?? '')) throw browserRequired();
    if (!response.ok && !inspectFailure) throw preflight(message);
    if (response.url && new URL(response.url).origin !== 'https://bbs.jpnkn.com') throw preflight(message);
    return response;
  }

  private async fetchForm(pageUrl: string, current: NormalizedJpnknInput, create: boolean): Promise<PublicForm> {
    const response = await this.get(pageUrl, 'jpnknの公開フォームを取得できません。', true);
    const html = await cp932Response(response, 'jpnknの公開フォームの文字コードを確認できません。', true);
    if (authenticationPage(html, !response.ok)) throw browserRequired();
    if (!response.ok) throw preflight('jpnknの公開フォームを取得できません。');
    const clean = html.replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
    const candidates: PublicForm[] = [];
    for (const match of clean.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form\s*>/gi)) {
      const attributes = attributesOf(match[1]);
      if ((attributes.method ?? 'get').toLowerCase() !== 'post') continue;
      let action: URL;
      try { action = new URL(await jpnknMarkupToText(attributes.action ?? ''), pageUrl); } catch { continue; }
      if (action.origin !== 'https://bbs.jpnkn.com' || action.pathname !== '/test/bbs.cgi' ||
        action.username || action.password || action.search || action.hash) continue;
      if (attributes['accept-charset'] && !isJpnknCp932(attributes['accept-charset'])) throw preflight('jpnknの公開フォームの文字コードを確認できません。');
      const names = new Map<string, string>();
      const fields: Array<[string, string]> = [];
      let invalid = false;
      const content = match[2];
      // Unknown successful controls must not be silently omitted from a changed form.
      if ([...content.matchAll(/<(?:select|button)\b([^>]*)>/gi)]
        .some(control => 'name' in attributesOf(control[1]))) continue;
      const controls = [...content.matchAll(/<input\b([^>]*)>/gi),
        ...content.matchAll(/<textarea\b([^>]*)>[\s\S]*?<\/textarea\s*>/gi)];
      for (const control of controls) {
        const attrs = attributesOf(control[1]);
        if ((attrs.type ?? '').toLowerCase() === 'password') throw browserRequired();
        if (!attrs.name) continue;
        const name = await jpnknMarkupToText(attrs.name);
        const lower = name.toLowerCase();
        if (names.has(lower) || 'disabled' in attrs || !['subject', 'from', 'mail', 'message', 'bbs', 'key'].includes(lower)) {
          invalid = true; break;
        }
        names.set(lower, name);
        if (lower === 'bbs' || lower === 'key') {
          if ((attrs.type ?? '').toLowerCase() !== 'hidden') { invalid = true; break; }
          fields.push([name, await jpnknMarkupToText(attrs.value ?? '')]);
        } else if ((attrs.type ?? 'text').toLowerCase() !== 'text') {
          invalid = true; break;
        }
      }
      const expected = create ? ['subject', 'from', 'mail', 'message', 'bbs'] : ['from', 'mail', 'message', 'bbs', 'key'];
      if (invalid || names.size !== expected.length || expected.some(name => !names.has(name))) continue;
      const bbs = fields.find(([name]) => name.toLowerCase() === 'bbs')?.[1];
      const key = fields.find(([name]) => name.toLowerCase() === 'key')?.[1];
      if (bbs !== current.boardId || (create ? key !== undefined : key !== current.threadId)) continue;
      candidates.push({ action: action.href, fields, names });
    }
    if (candidates.length !== 1) throw preflight('jpnknの公開フォームを解析できません。ブラウザで確認してください。');
    return candidates[0];
  }

  private async submit(form: PublicForm, fields: Array<[string, string]>, referer: string): Promise<Response> {
    let body: Uint8Array;
    try { body = encodeForm(fields, 'shift_jis'); }
    catch { throw preflight('jpnknの文字コードで表せない文字が含まれています。入力内容を確認してください。'); }
    try {
      return await this.runtime.fetch(form.action, { method: 'POST', redirect: 'manual',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: referer },
        body: body as unknown as BodyInit, signal: AbortSignal.timeout(timeout) });
    } catch {
      throw new BoardWriteFailure('uncertain', 'jpnknへ送信後、結果を受け取れませんでした。自動再送は行いません。');
    }
  }
}

function preflight(message: string): BoardWriteFailure { return new BoardWriteFailure('preflight', message); }
function verifyPlainText(response: Response, message: string): void {
  const contentType = response.headers.get('content-type');
  if (contentType && !/^text\/plain(?:\s*;|$)/i.test(contentType)) throw preflight(message);
}
function browserRequired(): BoardWriteFailure {
  return new BoardWriteFailure('browserRequired', 'jpnknが利用認証を要求しています。ブラウザで作成し、作成済みURLを登録してください。');
}
function verifyThread(thread: NormalizedJpnknInput): NormalizedJpnknInput {
  try {
    const normalized = normalizeJpnknInput(thread.url);
    if (thread.service !== 'jpnkn' || normalized.boardId !== thread.boardId || normalized.threadId !== thread.threadId) throw new Error();
    return normalized;
  } catch { throw preflight('jpnknの投稿先スレッドURLを確認してください。'); }
}
function boardUrl(thread: NormalizedJpnknInput): string { return 'https://bbs.jpnkn.com/' + thread.boardId + '/'; }
function threadUrl(board: string, key: string): string { return 'https://bbs.jpnkn.com/test/read.cgi/' + board + '/' + key + '/'; }
function values(form: PublicForm, replacements: Record<string, string>): Array<[string, string]> {
  return [...form.fields, ...Object.entries(replacements).map(([name, value]): [string, string] => [form.names.get(name)!, value])];
}
function validateText(text: string, maximum: number, required: boolean): void {
  if ((required && !text.trim()) || Array.from(text).length > maximum) {
    throw preflight('jpnknの文字数制限に合うタイトル、本文、投稿者欄を入力してください。');
  }
  try { encodeForm([['value', text]], 'shift_jis'); }
  catch { throw preflight('jpnknの文字コードで表せない文字が含まれています。入力内容を確認してください。'); }
}
function validatePost(body: string, name: string, mail: string): void {
  validateText(body, 4096, true); validateText(name, 128, false); validateText(mail, 128, false);
  if (name.includes('#')) throw preflight('jpnknのトリップはアプリから使用できません。投稿者名を確認してください。');
}
function attributesOf(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of source.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return attributes;
}
async function cp932Response(response: Response, message: string, inspectAuthentication = false): Promise<string> {
  try {
    const bytes = Buffer.from(await response.arrayBuffer());
    const charset = response.headers.get('content-type')?.match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1];
    const ascii = bytes.toString('latin1');
    const meta = ascii.match(/<meta\b[^>]*charset\s*=\s*["']?([^\s"'/>;]+)/i)?.[1];
    const declared = charset ?? meta;
    if (inspectAuthentication) {
      const candidate = declared && /^(?:utf-8|utf8)$/i.test(declared)
        ? new TextDecoder('utf-8', { fatal: true }).decode(bytes) : iconv.decode(bytes, 'cp932');
      if (authenticationPage(candidate, !response.ok)) throw browserRequired();
    }
    if ((charset && !isJpnknCp932(charset)) || (meta && !isJpnknCp932(meta))) throw new Error();
    const text = iconv.decode(bytes, 'cp932');
    if (text.includes('\ufffd')) throw new Error();
    return text;
  } catch (error) {
    if (error instanceof BoardWriteFailure && error.kind === 'browserRequired') throw error;
    throw preflight(message);
  }
}
async function responseText(response: Response): Promise<string> {
  if (authenticationLocation(response.headers.get('location') ?? '')) throw browserRequired();
  try {
    const bytes = new Uint8Array(await response.arrayBuffer());
    const charset = response.headers.get('content-type')?.match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1];
    const ascii = Buffer.from(bytes).toString('latin1');
    const declared = charset ?? ascii.match(/<meta\b[^>]*charset\s*=\s*["']?([^\s"'/>;]+)/i)?.[1];
    if (declared && /^(?:utf-8|utf8)$/i.test(declared)) return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (declared && !isJpnknCp932(declared)) throw new Error();
    const text = iconv.decode(Buffer.from(bytes), 'cp932');
    if (text.includes('\ufffd')) throw new Error();
    return text;
  }
  catch { throw new BoardWriteFailure('uncertain', 'jpnknの送信結果を解析できません。掲示板を確認してください。'); }
}
function authenticationLocation(raw: string): boolean {
  try {
    const url = new URL(raw, 'https://bbs.jpnkn.com/');
    return url.protocol === 'https:' && !url.username && !url.password &&
      ['auth.bbs.jpnkn.com', 'verify.bbs.jpnkn.com'].includes(url.hostname);
  } catch { return false; }
}
function authenticationPage(html: string, refused: boolean): boolean {
  const clean = html.replace(/<!--[\s\S]*?-->/g, '');
  // A thread can quote authentication words and URLs. Only actual challenge
  // controls or a dedicated authentication response justify pausing posting.
  for (const tag of clean.matchAll(/<(?:script|iframe|form|input|div)\b([^>]*)>/gi)) {
    const attributes = attributesOf(tag[1]);
    if (['src', 'action'].some(name => attributes[name] && authenticationLocation(attributes[name]))) return true;
    if (/^(?:cf-turnstile-response|g-recaptcha-response|h-captcha-response)$/i.test(attributes.name ?? '') ||
      /(?:^|\s)(?:cf-turnstile|g-recaptcha|h-captcha)(?:\s|$)/i.test(attributes.class ?? '') ||
      /^https:\/\/challenges\.cloudflare\.com\/turnstile\//i.test(attributes.src ?? '')) return true;
  }
  const hasPostingForm = [...clean.matchAll(/<form\b([^>]*)>/gi)].some(tag => {
    const attributes = attributesOf(tag[1]);
    try { return new URL(attributes.action ?? '', 'https://bbs.jpnkn.com/').pathname === '/test/bbs.cgi'; }
    catch { return false; }
  });
  const authText = /利用認証|認証(?:が必要|を行|してください|トークン)|(?:captcha|turnstile).*(?:required|verify)/i;
  if (!hasPostingForm && [...clean.matchAll(/<(?:title|h1|h2)\b[^>]*>([\s\S]*?)<\/(?:title|h1|h2)\s*>/gi)]
    .some(tag => authText.test(tag[1].replace(/<[^>]*>/g, '')))) return true;
  return refused && authText.test(clean.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '').replace(/<[^>]*>/g, ''));
}
function classifyFailure(response: Response, html: string): void {
  if (authenticationPage(html, !response.ok) || authenticationLocation(response.headers.get('location') ?? '')) throw browserRequired();
  if (/エラー|ERROR|禁止|規制|NGワード|長すぎ|連続投稿|連続スレッド|書き込みでき(?:ません|ない)|作成でき(?:ません|ない)|投稿でき(?:ません|ない)/i.test(html) ||
    (response.status >= 400 && response.status < 500)) {
    throw new BoardWriteFailure('rejected', 'jpnknが投稿を受け付けませんでした。入力内容と掲示板の投稿制限を確認してください。');
  }
}
function successText(html: string): boolean {
  return /書き?[込こ]みました|書きこみました|スレッド(?:を|が)?(?:正常に)?(?:作成しました|作成されました)/i.test(html);
}
function verifiedResultUrl(raw: string, current: NormalizedJpnknInput, reply: boolean, base: string): string | null {
  try {
    const url = new URL(raw, base);
    if (url.protocol !== 'https:') return null;
    const candidate = normalizeJpnknInput(url.href);
    return candidate.boardId === current.boardId && (reply ? candidate.threadId === current.threadId : candidate.threadId !== current.threadId)
      ? candidate.url : null;
  } catch { return null; }
}
