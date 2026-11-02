import type { CommentOverlaySettings, CommentOverlayState, CommonComment, TimedOverlayComment } from './types';

export function appendOverlayComment(state: CommentOverlayState, comment: CommonComment, settings: CommentOverlaySettings, now: number): CommentOverlayState {
  if (comment.initialHistory || [...state.active.map(item => item.comment), ...state.queue].some(item => item.id === comment.id)) return state;
  const copy = { ...comment, content: comment.content.map(part => ({ ...part })) };
  if (settings.mode === 'stack') return { active: [...state.active, { comment: copy, expiresAt: null }].slice(-settings.stackMaxComments), queue: state.queue };
  if (!state.active.length) return { active: [timed(copy, settings, now)], queue: state.queue };
  return { active: state.active, queue: [...state.queue, copy].slice(-100) };
}

export function advanceOverlayComments(state: CommentOverlayState, settings: CommentOverlaySettings, now: number): CommentOverlayState {
  if (settings.mode === 'stack') return { ...state, active: state.active.filter(item => item.expiresAt === null || Date.parse(item.expiresAt) > now) };
  let active = state.active, queue = state.queue;
  while (active[0]?.expiresAt && Date.parse(active[0].expiresAt) <= now) {
    const boundary = Date.parse(active[0].expiresAt);
    active = queue.length ? [timed(queue[0], settings, boundary)] : [];
    queue = queue.slice(1);
  }
  return { active, queue };
}

function timed(comment: CommonComment, settings: CommentOverlaySettings, now: number): TimedOverlayComment {
  return { comment, expiresAt: new Date(now + settings.singleDurationSeconds * 1000).toISOString() };
}
