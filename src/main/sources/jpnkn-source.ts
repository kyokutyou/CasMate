import iconv from 'iconv-lite';
import type { IncomingComment } from '../../shared/types';
import { abortableDelay } from './abortable-delay';
import { normalizeJpnknInput, type NormalizedJpnknInput } from './source-inputs';
import { withSourceRequestDeadline } from './source-request';
import { createSourceHttpError, NonRetryableSourceError } from './source-errors';
import { createSourceStatus, type CommentSourceAdapter, type SourceCallbacks, type SourceStatus } from './source-adapter';

export interface JpnknSourceRuntime {
  fetch: typeof fetch;
  delay(milliseconds: number, signal: AbortSignal): Promise<void>;
}

export interface ParsedJpnknDat {
  comments: IncomingComment[];
  maxResponseNumber: number | null;
  completedRows: number;
  remainder: Uint8Array;
}

type EntityDecoder = (value: string) => string;
let entityDecoder: Promise<EntityDecoder> | undefined;
function decoder(): Promise<EntityDecoder> {
  entityDecoder ??= import('entities').then(({ decode, EntityLevel }) =>
    (value: string) => decode(value, EntityLevel.HTML).replace(/\u00a0/g, ' '));
  return entityDecoder;
}

function markupToText(value: string, decode: EntityDecoder, trim = true): string {
  const text = decode(value
    .replace(/<(script|style|iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ''))
    .replace(/\r\n?/g, '\n');
  return trim ? text.trim() : text;
}

export async function jpnknMarkupToText(value: string, trim = true): Promise<string> {
  return markupToText(value, await decoder(), trim);
}

export function isJpnknCp932(value: string): boolean {
  return /^(?:shift-jis|shiftjis|sjis|windows-31j|cp932|ms932|x-sjis)$/i.test(value.trim().replace(/_/g, '-'));
}

// Decode only complete physical rows. A split CP932 character remains in the byte tail.
export async function parseJpnknDat(
  bytes: Uint8Array,
  initialHistory: boolean,
  connectionKey = '',
  firstResponseNumber = 1,
  onAuthor?: (id: string, name: string) => void,
): Promise<ParsedJpnknDat> {
  const decode = await decoder();
  const comments: IncomingComment[] = [];
  let start = 0;
  let completedRows = 0;
  for (let end = 0; end < bytes.length; end++) {
    if (bytes[end] !== 0x0a) continue;
    const number = firstResponseNumber + completedRows++;
    const lineEnd = end > start && bytes[end - 1] === 0x0d ? end - 1 : end;
    const raw = iconv.decode(Buffer.from(bytes.subarray(start, lineEnd)), 'cp932');
    start = end + 1;
    // Deleted, empty, malformed, and undecodable rows still consume a response number.
    if (raw.includes('\ufffd')) continue;
    const fields = raw.split('<>');
    if (fields.length !== 5) continue;
    const body = markupToText(fields[3] ?? '', decode);
    if (!body) continue;
    const externalId = connectionKey ? connectionKey + ':' + number : String(number);
    onAuthor?.(externalId, markupToText(fields[0] ?? '', decode));
    comments.push({ externalId, source: 'jpnkn', authorName: 'レス' + number,
      content: [{ type: 'text', text: body }], initialHistory });
  }
  return { comments, completedRows,
    maxResponseNumber: completedRows ? firstResponseNumber + completedRows - 1 : null,
    remainder: bytes.slice(start) };
}

export function jpnknDatUrl(thread: NormalizedJpnknInput): string {
  return 'https://bbs.jpnkn.com/' + thread.boardId + '/dat/' + thread.threadId + '.dat';
}

const defaultRuntime: JpnknSourceRuntime = { fetch, delay: abortableDelay };
class JpnknDatError extends Error {}

export class JpnknSource implements CommentSourceAdapter {
  readonly source = 'shitaraba' as const;
  private controller: AbortController | null = null;
  private running = false;

  constructor(
    private readonly input: NormalizedJpnknInput,
    private readonly callbacks: SourceCallbacks,
    private readonly runtime: JpnknSourceRuntime = defaultRuntime,
    private readonly pollIntervalSeconds = 5,
  ) {}

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.controller = new AbortController();
    void this.run(this.controller.signal);
  }

  async stop(): Promise<void> {
    this.running = false;
    this.controller?.abort();
    this.controller = null;
    this.status('stopped');
  }

  private status(state: SourceStatus['state'], message: string | null = null): void {
    this.callbacks.onStatus({ ...createSourceStatus(this.source, state, message), service: 'jpnkn' });
  }

  private async fetchDat(signal: AbortSignal, cursor: number | null): Promise<{ response: Response; bytes: Uint8Array | null }> {
    const headers: Record<string, string> = { 'Accept-Encoding': 'identity' };
    if (cursor !== null) headers.Range = 'bytes=' + cursor + '-';
    return withSourceRequestDeadline('jpnkn', signal, async requestSignal => {
      const response = await this.runtime.fetch(jpnknDatUrl(this.input), {
        headers, cache: 'no-store', redirect: 'manual', signal: requestSignal,
      });
      requestSignal.throwIfAborted();
      verifyIdentity(response);
      const bytes = response.status === 200 || response.status === 206
        ? await datBytes(response, response.status !== 206) : null;
      // Keep disposal inside the deadline, but an already errored body must not mask the HTTP status.
      if (bytes === null) await response.body?.cancel().catch(() => undefined);
      return { response, bytes };
    });
  }

  private async run(signal: AbortSignal): Promise<void> {
    let cursor: number | null = null;
    let overlap: Uint8Array = new Uint8Array();
    let completeRows = 0;
    let maximum = 0;
    let tail: Uint8Array = new Uint8Array();
    let initialTail = false;
    let first = true;
    let failures = 0;
    while (this.running && !signal.aborted) {
      try {
        if (first || failures) this.status(failures ? 'reconnecting' : 'connecting');
        const requestedStart: number | null = cursor === null ? null : cursor - overlap.length;
        let { response, bytes } = await this.fetchDat(signal, requestedStart);
        signal.throwIfAborted();
        if (response.status === 304 && cursor !== null) {
          this.callbacks.onBoardBatch?.([]);
        } else {
          let append = false;
          if (response.status === 206 && cursor !== null) {
            append = validRange(response, requestedStart!, bytes!.length) &&
              bytes!.length >= overlap.length && overlap.every((byte, index) => bytes![index] === byte);
            if (append) bytes = bytes!.subarray(overlap.length);
          }
          if (response.status === 416 || response.status === 205 ||
            (response.status === 206 && !append)) {
            ({ response, bytes } = await this.fetchDat(signal, null));
            signal.throwIfAborted();
          }
          if (response.status !== 200 && !(response.status === 206 && append)) {
            throw createSourceHttpError('jpnkn', response.status);
          }
          if (!bytes) throw new JpnknDatError('jpnknのDAT本文を確認できません。');
          const oldRows = completeRows;
          const oldMaximum = maximum;
          const oldInitialTail: boolean = initialTail;
          const combined = append ? concatenate(tail, bytes) : bytes;
          const authors = new Map<string, string>();
          const parsed = await parseJpnknDat(combined, first, this.input.boardId + ':' + this.input.threadId,
            append ? completeRows + 1 : 1, (id, name) => authors.set(id, name));
          signal.throwIfAborted();
          if (!this.running) return;
          completeRows = append ? completeRows + parsed.completedRows : parsed.completedRows;
          cursor = append ? cursor! + bytes.length : bytes.length;
          overlap = (append ? concatenate(overlap, bytes) : bytes).slice(-128);
          tail = parsed.remainder;
          maximum = Math.max(maximum, completeRows);
          const snapshotRows = completeRows + (tail.length ? 1 : 0);
          const comments = parsed.comments.filter(comment => {
            const number = responseNumber(comment);
            return first ? number > snapshotRows - 100 : number > oldMaximum;
          });
          // The first snapshot's unfinished last row belongs to history when it completes.
          if (!first && oldInitialTail) {
            for (const comment of comments) {
              if (responseNumber(comment) === oldRows + 1) comment.initialHistory = true;
            }
          }
          initialTail = tail.length > 0 && (first || (oldInitialTail && completeRows === oldRows));
          for (const comment of comments) this.callbacks.onRawAuthor?.('jpnkn', comment.externalId, authors.get(comment.externalId) ?? '');
          this.callbacks.onBoardBatch?.(comments);
          if (maximum) this.callbacks.onBoardProgress?.(maximum);
          for (const comment of comments) this.callbacks.onComment(comment);
        }
        first = false;
        failures = 0;
        if (!this.running || signal.aborted) return;
        this.status('connected');
        await this.runtime.delay(this.pollIntervalSeconds * 1_000, signal);
      } catch (error) {
        if (signal.aborted || !this.running) return;
        const message = error instanceof JpnknDatError || error instanceof NonRetryableSourceError ||
          (error instanceof Error && /^jpnkn HTTP \d+$/.test(error.message))
          ? error.message : 'jpnknへ接続できません。再試行します。';
        if (error instanceof NonRetryableSourceError) {
          this.running = false;
          this.status('error', message);
          return;
        }
        failures++;
        this.status('reconnecting', message);
        await this.runtime.delay(
          Math.max(this.pollIntervalSeconds * 1_000, Math.min(30_000, failures * 5_000)), signal,
        ).catch(() => {});
      }
    }
  }
}

function responseNumber(comment: IncomingComment): number {
  return Number(comment.externalId.split(':').at(-1));
}

function concatenate(left: Uint8Array, right: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(left.length + right.length);
  bytes.set(left); bytes.set(right, left.length);
  return bytes;
}

function verifyIdentity(response: Response): void {
  const encoding = response.headers.get('content-encoding')?.trim().toLowerCase();
  if (encoding && encoding !== 'identity') throw new JpnknDatError('jpnknのDAT圧縮応答を処理できません。取得位置は変更していません。');
}

async function datBytes(response: Response, checkLength = true): Promise<Uint8Array> {
  const contentType = response.headers.get('content-type');
  if (contentType && !/^text\/plain(?:\s*;|$)/i.test(contentType)) throw new JpnknDatError('jpnknのDAT形式を確認できません。');
  const charset = contentType?.match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1];
  if (charset && !isJpnknCp932(charset)) throw new JpnknDatError('jpnknのDAT文字コードを確認できません。');
  const bytes = new Uint8Array(await response.arrayBuffer());
  const length = response.headers.get('content-length');
  if (checkLength && length !== null && (!/^\d+$/.test(length) || Number(length) !== bytes.length)) {
    throw new JpnknDatError('jpnknのDAT長を確認できません。');
  }
  return bytes;
}

function validRange(response: Response, cursor: number, length: number): boolean {
  const match = response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
  if (!match) return false;
  const [start, end, total] = match.slice(1).map(Number);
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) !== length)) return false;
  return [start, end, total].every(Number.isSafeInteger) && start === cursor &&
    end >= start && total > end && end - start + 1 === length;
}

export function createJpnknSource(threadUrl: string, pollIntervalSeconds: number, callbacks: SourceCallbacks): JpnknSource {
  return new JpnknSource(normalizeJpnknInput(threadUrl), callbacks, defaultRuntime, pollIntervalSeconds);
}
