import { randomBytes, randomUUID } from 'node:crypto';
import type {
  IncomingComment,
  TextEffectItem,
  TextEffectRule,
  TextEffectsSettings,
  TextEffectTriggeredPayload,
} from '../../shared/types';
import { graphemes, normalizeTextMatch } from '../../shared/unicode';

export function matchTextEffects(
  comment: IncomingComment,
  settings: TextEffectsSettings,
): TextEffectItem[] {
  if (!settings.enabled) return [];
  const textParts = comment.content
    .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
    .map((part) => normalizeTextMatch(withoutUrls(part.text)));
  const items: TextEffectItem[] = [];
  let runs: Map<string, number> | undefined;
  for (const rule of settings.rules) {
    if (!rule.enabled || items.length >= 20) continue;
    const normalizedTrigger = normalizeTextMatch(rule.trigger);
    let count = 0;
    if (rule.countMode === 'fixed') {
      if (textParts.some((text) => text.includes(normalizedTrigger))) count = rule.fixedCount;
    } else {
      const trigger = graphemes(normalizedTrigger)[0];
      runs ??= longestRuns(textParts);
      const longest = runs.get(trigger) ?? 0;
      if (longest >= rule.minimumConsecutiveCount) count = longest;
    }
    const availableCount = Math.min(count, 20 - items.length);
    for (let index = 0; index < availableCount; index += 1) {
      items.push({ text: rule.displayText, color: rule.color });
    }
  }
  return items;
}

export function createTextEffectPayload(items: TextEffectItem[]): TextEffectTriggeredPayload {
  return {
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    seed: randomBytes(16).toString('hex'),
    items: items.slice(0, 20),
  };
}

export function testItemsForRule(rule: TextEffectRule): TextEffectItem[] {
  const count = rule.countMode === 'fixed' ? rule.fixedCount : rule.minimumConsecutiveCount;
  return Array.from({ length: count }, () => ({ text: rule.displayText, color: rule.color }));
}

function withoutUrls(value: string): string {
  return value.replace(/h?ttps?:\/\/[^\s]+/giu, '');
}

function longestRuns(parts: string[]): Map<string, number> {
  const runs = new Map<string, number>();
  for (const part of parts) {
    let previous: string | undefined;
    let count = 0;
    for (const grapheme of graphemes(part)) {
      count = grapheme === previous ? count + 1 : 1;
      previous = grapheme;
      if (count > (runs.get(grapheme) ?? 0)) runs.set(grapheme, count);
    }
  }
  return runs;
}
