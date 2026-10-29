import type { CommentSource, ConnectionKey, IncomingComment } from '../../shared/types';

export type SourceConnectionState =
  | 'stopped'
  | 'connecting'
  | 'waiting'
  | 'connected'
  | 'reconnecting'
  | 'error';

export interface SourceStatus {
  source: ConnectionKey;
  service?: CommentSource;
  state: SourceConnectionState;
  message: string | null;
  updatedAt: string;
}

export interface SourceCallbacks {
  onYouTubeVideo?(videoId: string): void;
  onRawAuthor?(source: CommentSource, externalId: string, name: string): void;
  onShitarabaBatch?(comments: IncomingComment[]): void;
  onBoardBatch?(comments: IncomingComment[]): void;
  onComment(comment: IncomingComment): void;
  onStatus(status: SourceStatus): void;
  onShitarabaProgress?(maxResponseNumber: number): void;
  onBoardProgress?(maxResponseNumber: number): void;
}

export interface CommentSourceAdapter {
  readonly source: ConnectionKey;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createSourceStatus(
  source: ConnectionKey,
  state: SourceConnectionState,
  message: string | null = null,
): SourceStatus {
  return { source, state, message, updatedAt: new Date().toISOString() };
}
