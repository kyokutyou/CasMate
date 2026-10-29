import type { ContentPart, IncomingComment } from '../../shared/types';
import { abortableDelay } from './abortable-delay';
import { normalizeYouTubeInput, type NormalizedYouTubeInput } from './source-inputs';
import { withSourceRequestDeadline } from './source-request';
import {
  createSourceHttpError,
  NonRetryableSourceError,
  WaitingSourceError,
} from './source-errors';
import {
  createSourceStatus,
  type CommentSourceAdapter,
  type SourceCallbacks,
} from './source-adapter';

type UnknownRecord = Record<string, unknown>;

export interface YouTubeSourceRuntime {
  fetch: typeof fetch;
  delay(milliseconds: number, signal: AbortSignal): Promise<void>;
}

const defaultRuntime: YouTubeSourceRuntime = { fetch, delay: abortableDelay };

export function parseYouTubeActions(
  actions: unknown[],
  initialHistory: boolean,
): IncomingComment[] {
  const comments: IncomingComment[] = [];
  for (const action of actions) {
    const renderer = readRenderer(action);
    if (!renderer) continue;
    const id = stringValue(renderer.id);
    const authorName = textValue(renderer.authorName) || '匿名';
    const runs = recordValue(renderer.message)?.runs;
    if (!id || !Array.isArray(runs)) continue;

    const content: ContentPart[] = [];
    for (const run of runs) {
      const item = recordValue(run);
      if (!item) continue;
      const text = stringValue(item.text);
      if (text) {
        content.push({ type: 'text', text });
        continue;
      }
      const emoji = recordValue(item.emoji);
      if (!emoji) continue;
      const thumbnails = recordValue(emoji.image)?.thumbnails;
      const thumbnail = Array.isArray(thumbnails)
        ? recordValue(thumbnails.at(-1))
        : undefined;
      const url = stringValue(thumbnail?.url);
      const emojiId = stringValue(emoji.emojiId);
      const shortcuts = emoji.shortcuts;
      const alt = Array.isArray(shortcuts) ? stringValue(shortcuts[0]) : '';
      if (url && emojiId) content.push({ type: 'emote', id: emojiId, alt, url });
    }
    if (content.length) {
      comments.push({
        externalId: id,
        source: 'youtube',
        authorName,
        content,
        initialHistory,
      });
    }
  }
  return comments;
}

export class YouTubeSource implements CommentSourceAdapter {
  readonly source = 'youtube' as const;
  private controller: AbortController | null = null;
  private running = false;
  private resolvedHandleChannelId: string | null = null;

  constructor(
    private readonly input: NormalizedYouTubeInput,
    private readonly callbacks: SourceCallbacks,
    private readonly runtime: YouTubeSourceRuntime = defaultRuntime,
  ) {}

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.resolvedHandleChannelId = null;
    this.controller = new AbortController();
    void this.run(this.controller.signal);
  }

  async stop(): Promise<void> {
    this.running = false;
    this.controller?.abort();
    this.controller = null;
    this.callbacks.onStatus(createSourceStatus(this.source, 'stopped'));
  }

  private async run(signal: AbortSignal): Promise<void> {
    let retry = 0;
    while (this.running && !signal.aborted) {
      try {
        this.callbacks.onStatus(
          createSourceStatus(this.source, retry ? 'reconnecting' : 'connecting'),
        );
        const input = await this.resolveInput(signal);
        const videoId = await resolveVideoId(input, signal, this.runtime.fetch);
        signal.throwIfAborted();
        this.callbacks.onYouTubeVideo?.(videoId);
        const page = await fetchText(`https://www.youtube.com/watch?v=${videoId}`, signal, this.runtime.fetch);
        const apiKey = matchRequired(page, /"INNERTUBE_API_KEY":"([^"]+)"/, 'API情報');
        const clientVersion =
          page.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1] ?? '2.20260801.00.00';
        let continuation = extractContinuation(page);
        let firstBatch = true;
        this.callbacks.onStatus(createSourceStatus(this.source, 'connected'));
        retry = 0;

        while (this.running && !signal.aborted) {
          const payload = await withSourceRequestDeadline('YouTube', signal, async requestSignal => {
            const response = await this.runtime.fetch(
              `https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=${encodeURIComponent(apiKey)}`,
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  context: { client: { clientName: 'WEB', clientVersion } },
                  continuation,
                }),
                signal: requestSignal,
              },
            );
            requestSignal.throwIfAborted();
            if (!response.ok) throw createSourceHttpError('YouTube', response.status);
            return (await response.json()) as UnknownRecord;
          });
          signal.throwIfAborted();
          const continuationContents = recordValue(payload.continuationContents);
          const liveChat = recordValue(continuationContents?.liveChatContinuation);
          const actions = Array.isArray(liveChat?.actions) ? liveChat.actions : [];
          const parsed = parseYouTubeActions(actions, firstBatch);
          for (const comment of firstBatch ? parsed.slice(-100) : parsed) {
            if (signal.aborted || !this.running) return;
            this.callbacks.onComment(comment);
          }
          firstBatch = false;
          const continuationData = readContinuationData(liveChat?.continuations);
          continuation = continuationData.continuation;
          await this.runtime.delay(continuationData.timeoutMs, signal);
        }
      } catch (error) {
        if (signal.aborted || !this.running) return;
        const message = error instanceof Error ? error.message : '接続に失敗しました。';
        if (error instanceof WaitingSourceError) {
          this.callbacks.onStatus(createSourceStatus(this.source, 'waiting', message));
          await this.runtime.delay(30_000, signal).catch(() => {});
          continue;
        }
        if (error instanceof NonRetryableSourceError) {
          this.running = false;
          this.callbacks.onStatus(createSourceStatus(this.source, 'error', message));
          return;
        }
        retry += 1;
        this.callbacks.onStatus(createSourceStatus(this.source, 'reconnecting', message));
        await this.runtime.delay(Math.min(30_000, 1_000 * 2 ** Math.min(retry, 5)), signal).catch(() => {});
      }
    }
  }

  private async resolveInput(signal: AbortSignal): Promise<NormalizedYouTubeInput> {
    if (this.input.kind !== 'handle') return this.input;
    if (this.resolvedHandleChannelId) {
      return { kind: 'channelId', target: this.resolvedHandleChannelId };
    }
    const page = await fetchText(
      `https://www.youtube.com/${this.input.target}`,
      signal,
      this.runtime.fetch,
    );
    const channelId = page.match(/"externalId":"(UC[\w-]{22})"/)?.[1];
    if (!channelId) {
      throw new NonRetryableSourceError(
        'YouTubeチャンネルを特定できません。サービスの応答形式が変更された可能性があります。',
      );
    }
    this.resolvedHandleChannelId = channelId;
    return { kind: 'channelId', target: channelId };
  }
}

export function createYouTubeSource(
  target: string,
  callbacks: SourceCallbacks,
): YouTubeSource {
  return new YouTubeSource(normalizeYouTubeInput(target), callbacks);
}

async function resolveVideoId(
  input: NormalizedYouTubeInput,
  signal: AbortSignal,
  fetcher: typeof fetch,
) {
  if (input.kind === 'liveId') return input.target;
  const page = await fetchText(`https://www.youtube.com/channel/${input.target}/live`, signal, fetcher);
  const id = findCanonicalVideoId(page);
  if (!id) throw new WaitingSourceError('現在のライブ配信を確認できません。');
  return id;
}

function findCanonicalVideoId(page: string): string | undefined {
  const tags = page.match(/<(?:link|meta)\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const rel = readHtmlAttribute(tag, 'rel').toLowerCase();
    const property = readHtmlAttribute(tag, 'property').toLowerCase();
    if (rel !== 'canonical' && property !== 'og:url') continue;
    const value = readHtmlAttribute(tag, rel === 'canonical' ? 'href' : 'content');
    try {
      const url = new URL(value.replace(/&amp;/g, '&'));
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      const videoId = url.searchParams.get('v') ?? '';
      if (host === 'youtube.com' && url.pathname === '/watch' && /^[\w-]{11}$/.test(videoId)) {
        return videoId;
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

function readHtmlAttribute(tag: string, name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return tag.match(new RegExp(`\\b${escapedName}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1] ?? '';
}

async function fetchText(url: string, signal: AbortSignal, fetcher: typeof fetch) {
  return withSourceRequestDeadline('YouTube', signal, async requestSignal => {
    const response = await fetcher(url, { signal: requestSignal, headers: { 'accept-language': 'ja' } });
    requestSignal.throwIfAborted();
    if (!response.ok) throw createSourceHttpError('YouTube', response.status);
    return response.text();
  });
}

function extractContinuation(page: string) {
  const match = page.match(/"continuation":"([^"]+)"/);
  if (!match) {
    throw new NonRetryableSourceError('ライブチャットの継続情報を取得できません。');
  }
  return match[1];
}

function readContinuationData(value: unknown): { continuation: string; timeoutMs: number } {
  if (!Array.isArray(value)) {
    throw new NonRetryableSourceError('ライブチャットの更新情報がありません。');
  }
  for (const entry of value) {
    const record = recordValue(entry);
    const data =
      recordValue(record?.timedContinuationData) ??
      recordValue(record?.invalidationContinuationData);
    const continuation = stringValue(data?.continuation);
    if (continuation) {
      const timeout = Number(data?.timeoutMs ?? 2_000);
      return { continuation, timeoutMs: Math.max(500, Math.min(timeout, 30_000)) };
    }
  }
  throw new NonRetryableSourceError('ライブチャットの更新情報がありません。');
}

function readRenderer(value: unknown): UnknownRecord | undefined {
  const action = recordValue(value);
  const add = recordValue(action?.addChatItemAction);
  const item = recordValue(add?.item);
  return recordValue(item?.liveChatTextMessageRenderer);
}

function recordValue(value: unknown): UnknownRecord | undefined {
  return typeof value === 'object' && value !== null ? (value as UnknownRecord) : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function textValue(value: unknown): string {
  const record = recordValue(value);
  if (!record) return '';
  if (typeof record.simpleText === 'string') return record.simpleText;
  return Array.isArray(record.runs)
    ? record.runs.map((run) => stringValue(recordValue(run)?.text)).join('')
    : '';
}

function matchRequired(value: string, pattern: RegExp, label: string) {
  const match = value.match(pattern)?.[1];
  if (!match) throw new NonRetryableSourceError(`${label}を取得できません。`);
  return match;
}
