import type { IncomingComment } from '../../shared/types';
import { abortableDelay } from './abortable-delay';
import { normalizeShitarabaInput, type NormalizedShitarabaInput } from './source-inputs';
import { withSourceRequestDeadline } from './source-request';
import { createSourceHttpError, NonRetryableSourceError } from './source-errors';
import {
  createSourceStatus,
  type CommentSourceAdapter,
  type SourceCallbacks,
} from './source-adapter';

export interface ShitarabaSourceRuntime {
  fetch: typeof fetch;
  delay(milliseconds: number, signal: AbortSignal): Promise<void>;
}

const defaultRuntime: ShitarabaSourceRuntime = { fetch, delay: abortableDelay };

export interface ParsedShitarabaRaw {
  comments: IncomingComment[];
  maxResponseNumber: number | null;
}

export function parseShitarabaRaw(
  raw: string,
  initialHistory: boolean,
  connectionKey = '',
  onAuthor?: (id: string, name: string) => void,
): ParsedShitarabaRaw {
  const comments: IncomingComment[] = [];
  let maxResponseNumber: number | null = null;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const fields = line.split('<>');
    const responseNumberText = fields[0]?.trim();
    if (!responseNumberText || fields.length < 5 || !/^\d+$/.test(responseNumberText)) continue;
    const responseNumber = Number(responseNumberText);
    if (!Number.isSafeInteger(responseNumber) || responseNumber < 1) continue;
    maxResponseNumber = Math.max(maxResponseNumber ?? 0, responseNumber);
    let body: string;
    let author: string;
    try {
      body = decodeEntities(stripMarkup(fields[4] ?? '')).trim();
      author = decodeEntities(stripMarkup(fields[1] ?? '')).trim();
    } catch {
      // A malformed row must not prevent later responses or progress updates.
      continue;
    }
    if (!body) continue;
    onAuthor?.(connectionKey ? `${connectionKey}:${responseNumberText}` : responseNumberText, author);
    comments.push({
      externalId: connectionKey ? `${connectionKey}:${responseNumberText}` : responseNumberText,
      source: 'shitaraba',
      authorName: `レス${responseNumberText}`,
      content: [{ type: 'text', text: body }],
      initialHistory,
    });
  }
  return { comments, maxResponseNumber };
}

export class ShitarabaSource implements CommentSourceAdapter {
  readonly source = 'shitaraba' as const;
  private controller: AbortController | null = null;
  private running = false;

  constructor(
    private readonly input: NormalizedShitarabaInput,
    private readonly callbacks: SourceCallbacks,
    private readonly runtime: ShitarabaSourceRuntime = defaultRuntime,
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
    this.callbacks.onStatus(createSourceStatus(this.source, 'stopped'));
  }

  private async run(signal: AbortSignal) {
    let lastNumber = 0;
    let first = true;
    let failures = 0;
    while (this.running && !signal.aborted) {
      try {
        if (first || failures > 0) {
          this.callbacks.onStatus(
            createSourceStatus(this.source, failures ? 'reconnecting' : 'connecting'),
          );
        }
        const suffix = first ? 'l100' : `${lastNumber + 1}-`;
        const url = `https://jbbs.shitaraba.net/bbs/rawmode.cgi/${this.input.category}/${this.input.boardId}/${this.input.threadId}/${suffix}`;
        const raw = await withSourceRequestDeadline('したらば', signal, async requestSignal => {
          const response = await this.runtime.fetch(url, { signal: requestSignal });
          requestSignal.throwIfAborted();
          if (!response.ok) throw createSourceHttpError('したらば', response.status);
          return new TextDecoder('euc-jp').decode(await response.arrayBuffer());
        });
        signal.throwIfAborted();
        const parsed = parseShitarabaRaw(
          raw,
          first,
          `${this.input.category}:${this.input.boardId}:${this.input.threadId}`,
          (id, name) => this.callbacks.onRawAuthor?.('shitaraba', id, name),
        );
        const comments = parsed.comments;
        this.callbacks.onShitarabaBatch?.(comments);
        if (parsed.maxResponseNumber !== null) {
          lastNumber = Math.max(lastNumber, parsed.maxResponseNumber);
          this.callbacks.onShitarabaProgress?.(lastNumber);
        }
        for (const comment of comments) {
          if (signal.aborted || !this.running) return;
          this.callbacks.onComment(comment);
        }
        if (signal.aborted || !this.running) return;
        first = false;
        failures = 0;
        this.callbacks.onStatus(createSourceStatus(this.source, 'connected'));
        await this.runtime.delay(this.pollIntervalSeconds * 1_000, signal);
      } catch (error) {
        if (signal.aborted || !this.running) return;
        const message = error instanceof Error ? error.message : '接続に失敗しました。';
        if (error instanceof NonRetryableSourceError) {
          this.running = false;
          this.callbacks.onStatus(createSourceStatus(this.source, 'error', message));
          return;
        }
        failures += 1;
        this.callbacks.onStatus(createSourceStatus(this.source, 'reconnecting', message));
        await this.runtime.delay(
          Math.max(this.pollIntervalSeconds * 1_000, Math.min(30_000, failures * 5_000)),
          signal,
        ).catch(() => {});
      }
    }
  }
}

export function createShitarabaSource(
  threadUrl: string,
  pollIntervalSeconds: number,
  callbacks: SourceCallbacks,
) {
  return new ShitarabaSource(
    normalizeShitarabaInput(threadUrl),
    callbacks,
    defaultRuntime,
    pollIntervalSeconds,
  );
}

function stripMarkup(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '');
}

function decodeEntities(value: string) {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, key: string) => {
    if (key.startsWith('#')) {
      const hexadecimal = key[1]?.toLowerCase() === 'x';
      const codePoint = Number.parseInt(key.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }
    return named[key.toLowerCase()] ?? entity;
  });
}
