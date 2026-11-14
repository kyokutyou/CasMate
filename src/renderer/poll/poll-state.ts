import type { PollPublicSnapshot } from '../../shared/listener-poll';
export function newerPollState(previous: PollPublicSnapshot | null, incoming: PollPublicSnapshot): PollPublicSnapshot {
  return previous && previous.instance === incoming.instance && previous.revision > incoming.revision ? previous : incoming;
}
