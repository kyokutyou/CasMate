export interface PollDraft { question: string; options: string[]; durationMinutes: number | null }
export interface PollAppearance { fontSize: number; color: string; background: string }
export interface ListenerPoll {
  id: string; question: string; options: string[]; counts: number[];
  startedAt: number; endsAt: number | null; closedAt: number | null;
  closeReason: 'manual' | 'deadline' | 'publicationStopped' | 'interrupted' | null;
  resultsVisible: boolean;
}
export type PublicPoll = Omit<ListenerPoll, 'counts' | 'closeReason'> & { counts?: number[] };
export interface PollPublicSnapshot { instance: string; revision: number; poll: PublicPoll | null; appearance: PollAppearance }
export interface PollBallot { option: number; version: number }
export interface PollVoteRequest { pollId: string; requestId: string; option: number; version: number }
export interface PollPublicationState {
  status: 'off' | 'starting' | 'online' | 'reconnecting' | 'stopping' | 'error';
  url: string | null; message: string;
}
export interface PollManagementSnapshot {
  instance: string; revision: number; available: boolean; error: string | null; draft: PollDraft;
  appearance: PollAppearance; current: ListenerPoll | null; history: ListenerPoll[];
  publication: PollPublicationState;
}
export const defaultPollDraft: PollDraft = { question: '', options: ['', ''], durationMinutes: null };
export const defaultPollAppearance: PollAppearance = { fontSize: 28, color: '#ffffff', background: '#142032' };

export function validPollDraft(value: unknown, complete = false): value is PollDraft {
  if (!record(value) || !only(value, ['question', 'options', 'durationMinutes']) ||
    typeof value.question !== 'string' || value.question.length > 200 || !Array.isArray(value.options) ||
    value.options.length < 2 || value.options.length > 10 || value.options.some(x => typeof x !== 'string' || x.length > 100) ||
    !(value.durationMinutes === null || Number.isInteger(value.durationMinutes) && Number(value.durationMinutes) >= 1 && Number(value.durationMinutes) <= 1440)) return false;
  return !complete || Boolean(value.question.trim() && value.options.every(x => x.trim()) && new Set(value.options.map(x => x.trim())).size === value.options.length);
}
export function validPollAppearance(value: unknown): value is PollAppearance {
  return record(value) && only(value, ['fontSize', 'color', 'background']) && Number.isInteger(value.fontSize) && Number(value.fontSize) >= 12 && Number(value.fontSize) <= 100 &&
    typeof value.color === 'string' && /^#[\da-f]{6}$/iu.test(value.color) && typeof value.background === 'string' && /^#[\da-f]{6}$/iu.test(value.background);
}
export function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
export function only(value: Record<string, unknown>, keys: string[]): boolean { return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)); }
