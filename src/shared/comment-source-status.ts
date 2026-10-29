import type { ConnectionKey, SourceStatusView } from './types';

export function areCommentSourcesRunning(
  statuses: Record<ConnectionKey, SourceStatusView>,
): boolean {
  return Object.values(statuses).some((status) => status.state !== 'stopped');
}
