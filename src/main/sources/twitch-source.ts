import WebSocket, { type RawData } from 'ws';
import type { ContentPart, IncomingComment } from '../../shared/types';
import { normalizeTwitchInput } from './source-inputs';
import {
  createSourceStatus,
  type CommentSourceAdapter,
  type SourceCallbacks,
} from './source-adapter';

export function parseTwitchMessage(
  line: string,
  initialHistory: boolean,
): IncomingComment | null {
  const match = line.match(/^@([^ ]+) :[^ ]+ PRIVMSG #[^ ]+ :(.*)$/);
  if (!match) return null;
  const tags = parseTags(match[1]);
  const message = match[2];
  const id = tags.get('id');
  if (!id) return null;

  const ranges: Array<{ start: number; end: number; id: string }> = [];
  const emotes = tags.get('emotes');
  if (emotes) {
    for (const group of emotes.split('/')) {
      const [emoteId, positions = ''] = group.split(':');
      for (const position of positions.split(',')) {
        const [start, end] = position.split('-').map(Number);
        if (Number.isInteger(start) && Number.isInteger(end)) {
          ranges.push({ start, end, id: emoteId });
        }
      }
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  const characters = Array.from(message);
  const content: ContentPart[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) {
      content.push({ type: 'text', text: characters.slice(cursor, range.start).join('') });
    }
    const alt = characters.slice(range.start, range.end + 1).join('');
    content.push({
      type: 'emote',
      id: range.id,
      alt,
      url: `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(range.id)}/default/dark/2.0`,
    });
    cursor = range.end + 1;
  }
  if (cursor < characters.length) {
    content.push({ type: 'text', text: characters.slice(cursor).join('') });
  }
  if (!content.length) content.push({ type: 'text', text: message });

  return {
    externalId: id,
    source: 'twitch',
    authorName: tags.get('display-name') || '匿名',
    content,
    initialHistory,
  };
}

export class TwitchSource implements CommentSourceAdapter {
  readonly source = 'twitch' as const;
  private socket: TwitchSocket | null = null;
  private stopped = true;
  private failures = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private connectionTimer: NodeJS.Timeout | null = null;
  private joinTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly channel: string,
    private readonly callbacks: SourceCallbacks,
    private readonly createSocket: TwitchSocketFactory = (url) => new WebSocket(url),
  ) {}

  async start(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    this.failures = 0;
    this.connect(false);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.closeConnection();
    this.callbacks.onStatus(createSourceStatus(this.source, 'stopped'));
  }

  private connect(reconnecting: boolean) {
    if (this.stopped) return;
    this.callbacks.onStatus(
      createSourceStatus(this.source, reconnecting ? 'reconnecting' : 'connecting'),
    );
    if (this.stopped) return;
    const nick = `justinfan${Math.floor(Math.random() * 80_000 + 10_000)}`;
    let socket: TwitchSocket;
    try {
      socket = this.createSocket('wss://irc-ws.chat.twitch.tv:443');
    } catch {
      this.reconnect('Twitchへ接続できません。再接続します。');
      return;
    }
    this.socket = socket;
    this.connectionTimer = setTimeout(() => {
      if (!this.isCurrent(socket)) return;
      this.reconnect('Twitchへの接続が完了しないため再接続します。');
    }, 15_000);
    socket.on('open', () => {
      if (!this.isCurrent(socket)) return;
      if (this.connectionTimer) clearTimeout(this.connectionTimer);
      this.connectionTimer = null;
      try {
        socket.send('PASS SCHMOOPIIE\r\n');
        socket.send(`NICK ${nick}\r\n`);
        socket.send('CAP REQ :twitch.tv/tags twitch.tv/commands\r\n');
        socket.send(`JOIN #${this.channel}\r\n`);
      } catch {
        this.reconnect('Twitchへ接続できません。再接続します。');
        return;
      }
      if (!this.isCurrent(socket)) return;
      this.joinTimer = setTimeout(() => {
        if (!this.isCurrent(socket)) return;
        this.reconnect('Twitchチャンネルから応答がないため再接続します。');
      }, 15_000);
    });
    let buffer = '';
    socket.on('message', (data) => {
      if (!this.isCurrent(socket)) return;
      buffer += rawDataToText(data);
      const lines = buffer.split('\r\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!this.isCurrent(socket)) return;
        if (/^(?:@[^ ]+ )?:tmi\.twitch\.tv RECONNECT\s*$/.test(line)) {
          this.reconnect('Twitchから再接続の指示を受けたため再接続します。');
          return;
        }
        if (line.startsWith('PING')) {
          try {
            socket.send(`${line.replace('PING', 'PONG')}\r\n`);
          } catch {
            this.reconnect('Twitchへ接続できません。再接続します。');
            return;
          }
          continue;
        }
        if (isRoomStateForChannel(line, this.channel)) {
          if (this.joinTimer) clearTimeout(this.joinTimer);
          this.joinTimer = null;
          this.failures = 0;
          this.callbacks.onStatus(createSourceStatus(this.source, 'connected'));
          continue;
        }
        const suspendedChannelNotice = readSuspendedChannelNotice(line);
        if (suspendedChannelNotice) {
          this.failPermanently(suspendedChannelNotice);
          return;
        }
        const comment = parseTwitchMessage(line, false);
        if (comment) {
          this.failures = 0;
          this.callbacks.onComment(comment);
        }
      }
    });
    socket.on('error', () => {
      if (!this.isCurrent(socket)) return;
      this.reconnect('Twitchへ接続できません。再接続します。');
    });
    socket.on('close', () => {
      if (!this.isCurrent(socket)) return;
      this.reconnect('Twitchとの接続が切れたため再接続します。');
    });
  }

  private isCurrent(socket: TwitchSocket): boolean {
    return !this.stopped && this.socket === socket;
  }

  private reconnect(message: string) {
    if (this.stopped) return;
    this.closeConnection();
    const wait = Math.min(30_000, 3_000 * 2 ** this.failures);
    this.failures = Math.min(4, this.failures + 1);
    this.callbacks.onStatus(createSourceStatus(this.source, 'reconnecting', message));
    if (this.stopped) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect(true);
    }, wait);
  }

  private failPermanently(message: string) {
    if (this.stopped) return;
    this.stopped = true;
    this.closeConnection();
    this.callbacks.onStatus(createSourceStatus(this.source, 'error', message));
  }

  private closeConnection() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.connectionTimer) clearTimeout(this.connectionTimer);
    if (this.joinTimer) clearTimeout(this.joinTimer);
    this.reconnectTimer = null;
    this.connectionTimer = null;
    this.joinTimer = null;
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }
}

export interface TwitchSocket {
  send(data: string): void;
  close(): void;
  on(event: 'open', listener: () => void): this;
  on(event: 'message', listener: (data: RawData) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'close', listener: () => void): this;
}

export type TwitchSocketFactory = (url: string) => TwitchSocket;

export function createTwitchSource(channel: string, callbacks: SourceCallbacks) {
  return new TwitchSource(normalizeTwitchInput(channel), callbacks);
}

function parseTags(value: string) {
  const tags = new Map<string, string>();
  for (const pair of value.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 0) continue;
    tags.set(pair.slice(0, separator), unescapeTag(pair.slice(separator + 1)));
  }
  return tags;
}

function unescapeTag(value: string) {
  return value
    .replaceAll('\\s', ' ')
    .replaceAll('\\:', ';')
    .replaceAll('\\r', '\r')
    .replaceAll('\\n', '\n')
    .replaceAll('\\\\', '\\');
}

function rawDataToText(data: RawData) {
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}

function isRoomStateForChannel(line: string, channel: string) {
  return line.toLowerCase().includes(` roomstate #${channel.toLowerCase()}`);
}

function readSuspendedChannelNotice(line: string): string | null {
  if (!line.includes(' NOTICE ')) return null;
  const tags = line.startsWith('@') ? parseTags(line.slice(1, line.indexOf(' '))) : new Map();
  if (tags.get('msg-id') !== 'msg_channel_suspended') return null;
  return line.match(/ NOTICE [^ ]+ :(.*)$/)?.[1] ?? 'Twitchチャンネルに参加できませんでした。';
}
