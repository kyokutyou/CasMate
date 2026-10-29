export type ManagementHistoryDirection = 'back' | 'forward';
export interface ManagementHistoryBridge {
  subscribe(listener: (direction: ManagementHistoryDirection) => void): () => void;
}
