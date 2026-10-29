import { ValidationError } from '../core/validation-error';

export type YouTubeInputKind = 'channelId' | 'handle' | 'liveId';

export interface NormalizedYouTubeInput {
  kind: YouTubeInputKind;
  target: string;
}

export interface NormalizedShitarabaInput {
  category: string;
  boardId: string;
  threadId: string;
  url: string;
}

export interface NormalizedJpnknInput {
  service: 'jpnkn';
  boardId: string;
  threadId: string;
  url: string;
}

export type NormalizedBoardThread =
  | (NormalizedShitarabaInput & { service: 'shitaraba' })
  | NormalizedJpnknInput;

export function normalizeYouTubeInput(raw: string): NormalizedYouTubeInput {
  const value = raw.trim();
  let target = value;
  let kind: YouTubeInputKind;

  if (/^https?:\/\//i.test(value)) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw youtubeError();
    }
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'youtu.be') {
      target = url.pathname.split('/').filter(Boolean)[0] ?? '';
      kind = 'liveId';
    } else if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (url.pathname === '/watch') {
        target = url.searchParams.get('v') ?? '';
        kind = 'liveId';
      } else {
        const liveMatch = url.pathname.match(/^\/live\/([\w-]{11})\/?$/);
        if (liveMatch) {
          target = liveMatch[1];
          kind = 'liveId';
          return { kind, target };
        }
        const channelMatch = url.pathname.match(/^\/channel\/(UC[\w-]{22})\/?$/);
        if (channelMatch) {
          target = channelMatch[1];
          kind = 'channelId';
        } else {
          const handleMatch = url.pathname.match(/^\/(%40|@)([^/]+)\/?$/i);
          if (!handleMatch) throw youtubeError();
          try {
            target = `@${decodeURIComponent(handleMatch[2])}`;
          } catch {
            throw youtubeError();
          }
          kind = 'handle';
        }
      }
    } else {
      throw youtubeError();
    }
  } else if (/^@[^\s/?#]{3,30}$/.test(value)) {
    kind = 'handle';
  } else if (/^UC[\w-]{22}$/.test(value)) {
    kind = 'channelId';
  } else if (/^[\w-]{11}$/.test(value)) {
    kind = 'liveId';
  } else {
    throw youtubeError();
  }

  if (kind === 'liveId' && !/^[\w-]{11}$/.test(target)) {
    throw youtubeError();
  }
  if (kind === 'channelId' && !/^UC[\w-]{22}$/.test(target)) {
    throw youtubeError();
  }
  if (kind === 'handle' && !/^@[^\s/?#]{3,30}$/.test(target)) throw youtubeError();
  return { kind, target };
}

export function normalizeTwitchInput(raw: string): string {
  const value = raw.trim();
  let channel = value;
  if (/^https?:\/\//i.test(value)) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw twitchError();
    }
    if (url.hostname.toLowerCase().replace(/^www\./, '') !== 'twitch.tv') {
      throw twitchError();
    }
    channel = url.pathname.split('/').filter(Boolean)[0] ?? '';
  }
  channel = channel.toLowerCase();
  if (!/^[a-z0-9_]{3,25}$/.test(channel)) {
    throw twitchError();
  }
  return channel;
}

export function normalizeShitarabaInput(raw: string): NormalizedShitarabaInput {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw shitarabaError();
  }
  if (url.hostname.toLowerCase() !== 'jbbs.shitaraba.net') {
    throw shitarabaError();
  }
  const match = url.pathname.match(
    /^\/bbs\/read\.cgi\/([a-zA-Z0-9_-]+)\/(\d+)\/(\d+)(?:\/.*)?$/,
  );
  if (!match) {
    throw shitarabaError();
  }
  const [, category, boardId, threadId] = match;
  return {
    category,
    boardId,
    threadId,
    url: `https://jbbs.shitaraba.net/bbs/read.cgi/${category}/${boardId}/${threadId}/`,
  };
}

export function normalizeJpnknInput(raw: string): NormalizedJpnknInput {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw jpnknError(); }
  if (!isPublicBoardUrl(url) || url.hostname.toLowerCase() !== 'bbs.jpnkn.com') throw jpnknError();
  const match = url.pathname.match(
    /^\/test\/read\.cgi\/([a-zA-Z0-9_-]+)\/([1-9]\d*)(?:\/(?:l[1-9]\d*|\d+(?:-\d*)?)?)?\/?$/,
  );
  if (!match) throw jpnknError();
  const [, boardId, threadId] = match;
  return { service: 'jpnkn', boardId, threadId,
    url: `https://bbs.jpnkn.com/test/read.cgi/${boardId}/${threadId}/` };
}

export function normalizeBoardInput(raw: string): NormalizedBoardThread {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw boardError(); }
  if (!isPublicBoardUrl(url)) throw boardError();
  if (url.hostname.toLowerCase() === 'jbbs.shitaraba.net') {
    return { ...normalizeShitarabaInput(raw), service: 'shitaraba' };
  }
  if (url.hostname.toLowerCase() === 'bbs.jpnkn.com') return normalizeJpnknInput(raw);
  throw boardError();
}

export function boardThreadKey(thread: NormalizedBoardThread): string {
  return thread.service === 'shitaraba'
    ? `shitaraba:${thread.category}:${thread.boardId}:${thread.threadId}`
    : `jpnkn:${thread.boardId}:${thread.threadId}`;
}

function isPublicBoardUrl(url: URL): boolean {
  return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password && !url.port;
}

function jpnknError(): ValidationError {
  return new ValidationError('jpnknスレッドURLを確認してください。');
}

function boardError(): ValidationError {
  return new ValidationError('したらばまたはjpnknのスレッドURLを確認してください。');
}

function youtubeError(): ValidationError {
  return new ValidationError('YouTube接続先を確認してください。');
}

function twitchError(): ValidationError {
  return new ValidationError('Twitchチャンネル名またはURLを確認してください。');
}

function shitarabaError(): ValidationError {
  return new ValidationError('したらばスレッドURLを確認してください。');
}
