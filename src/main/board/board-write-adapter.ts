import {
  FetchShitarabaWriteAdapter, ShitarabaWriteFailure,
  type ShitarabaThreadContent, type CreateNextThreadRequest, type AnnounceNextThreadRequest,
} from '../shitaraba/shitaraba-write-adapter';
import { boardThreadKey, normalizeBoardInput, type NormalizedBoardThread } from '../sources/source-inputs';
import { FetchJpnknWriteAdapter } from './jpnkn-write-adapter';

export { ShitarabaWriteFailure as BoardWriteFailure } from '../shitaraba/shitaraba-write-adapter';
export type BoardThreadContent = ShitarabaThreadContent;
export type BoardCreateNextThreadRequest = Omit<CreateNextThreadRequest, 'currentThread'> & { currentThread: NormalizedBoardThread };
export type BoardAnnounceNextThreadRequest = Omit<AnnounceNextThreadRequest, 'currentThread'> & { currentThread: NormalizedBoardThread };

export interface BoardWriteAdapter {
  fetchThreadContent(thread: NormalizedBoardThread): Promise<BoardThreadContent>;
  findThreadsByTitle(thread: NormalizedBoardThread, title: string): Promise<string[]>;
  createNextThread(request: BoardCreateNextThreadRequest): Promise<{ threadUrl: string }>;
  announceNextThread(request: BoardAnnounceNextThreadRequest): Promise<void>;
  postAiComment(request: BoardAnnounceNextThreadRequest): Promise<void>;
}

export function createBoardWriteAdapter(runtime?: { fetch: typeof fetch }): BoardWriteAdapter {
  const shitaraba = new FetchShitarabaWriteAdapter(runtime);
  const jpnkn = new FetchJpnknWriteAdapter(runtime);
  return {
    async fetchThreadContent(thread) {
      const current = verifiedThread(thread);
      return current.service === 'shitaraba' ? shitaraba.fetchThreadContent(current) : jpnkn.fetchThreadContent(current);
    },
    async findThreadsByTitle(thread, title) {
      const current = verifiedThread(thread);
      return current.service === 'shitaraba' ? shitaraba.findThreadsByTitle(current, title) : jpnkn.findThreadsByTitle(current, title);
    },
    async createNextThread(request) {
      const currentThread = verifiedThread(request.currentThread);
      return currentThread.service === 'shitaraba'
        ? shitaraba.createNextThread({ ...request, currentThread })
        : jpnkn.createNextThread({ ...request, currentThread });
    },
    async announceNextThread(request) {
      const currentThread = verifiedThread(request.currentThread);
      return currentThread.service === 'shitaraba'
        ? shitaraba.announceNextThread({ ...request, currentThread })
        : jpnkn.announceNextThread({ ...request, currentThread });
    },
    async postAiComment(request) {
      const currentThread = verifiedThread(request.currentThread);
      return currentThread.service === 'shitaraba'
        ? shitaraba.postAiComment({ ...request, currentThread })
        : jpnkn.postAiComment({ ...request, currentThread });
    },
  };
}

function verifiedThread(thread: NormalizedBoardThread): NormalizedBoardThread {
  try {
    const normalized = normalizeBoardInput(thread.url);
    if (boardThreadKey(normalized) !== boardThreadKey(thread)) throw new Error();
    return normalized;
  } catch {
    throw new ShitarabaWriteFailure('preflight', '掲示板の投稿先スレッドURLを確認してください。');
  }
}
