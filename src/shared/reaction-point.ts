export const REACTION_POINT_INTENTS = {
  look: 'ここ見て！',
  question: 'これなに？',
  danger: '危ない！',
} as const;
export type ReactionPointIntent = keyof typeof REACTION_POINT_INTENTS;
export function validReactionPointIntent(value: unknown): value is ReactionPointIntent {
  return typeof value === 'string' && Object.hasOwn(REACTION_POINT_INTENTS, value);
}
