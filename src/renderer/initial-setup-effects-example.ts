import type { TextEffectRule } from '../shared/types';
import { graphemes, normalizeTextMatch } from '../shared/unicode';

// Explanatory example for one saved rule, independent of its enabled switch.
// This never creates a comment or sends an OBS event.
export function setupEffectExampleCount(text: string, rule?: TextEffectRule): number {
  if (!rule) return 0;
  const normalized = normalizeTextMatch(text.replace(/h?ttps?:\/\/[^\s]+/giu, ''));
  const trigger = normalizeTextMatch(rule.trigger);
  if (!trigger) return 0;
  if (rule.countMode === 'fixed') return normalized.includes(trigger) ? Math.min(20, rule.fixedCount) : 0;
  const consecutiveTrigger = graphemes(trigger)[0];
  let longest = 0; let run = 0;
  for (const letter of graphemes(normalized)) {
    run = letter === consecutiveTrigger ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return longest >= rule.minimumConsecutiveCount ? Math.min(20, longest) : 0;
}
