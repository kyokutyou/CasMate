// Throwaway UI model. No filesystem, backend, telemetry, or persistent storage.
import type { TextEffectRule, TextEffectsSettings } from '../../src/shared/types';
import { graphemes, normalizeTextMatch } from '../../src/shared/unicode';

export interface RuleDraft {
  id: string; enabled: boolean; trigger: string; displayText: string; color: string;
  countMode: 'fixed' | 'consecutive'; count: string;
}
export interface Draft {
  enabled: boolean; fontSizePx: string; fallDurationSeconds: string; maxActiveItems: string;
  rules: RuleDraft[];
}
export const initialDraft: Draft = {
  enabled: true, fontSizePx: '64', fallDurationSeconds: '3', maxActiveItems: '30',
  rules: [
    { id: 'grass', enabled: true, trigger: 'w', displayText: '草', color: '#66CC66FF', countMode: 'consecutive', count: '2' },
    { id: 'clap', enabled: true, trigger: '8888', displayText: '👏', color: '#FFD782FF', countMode: 'fixed', count: '6' },
    { id: 'celebrate', enabled: false, trigger: 'おめでとう', displayText: '🎉', color: '#FFB8DAFF', countMode: 'fixed', count: '8' },
  ],
};
export function freshRule(): RuleDraft {
  return { id: crypto.randomUUID(), enabled: true, trigger: '', displayText: '★', color: '#FFFFFFFF', countMode: 'fixed', count: '6' };
}
export function numberError(value: string, min: number, max: number, integer = true) {
  return value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max && (!integer || Number.isInteger(Number(value)))
    ? '' : `${min}〜${max}の${integer ? '整数' : '数値'}を入力してください。`;
}
export function ruleErrors(rule: RuleDraft) {
  const length = graphemes(rule.trigger.trim()).length;
  return {
    trigger: length < 1 || length > 50 ? '反応ワードは1〜50文字で入力してください。'
      : rule.countMode === 'consecutive' && graphemes(normalizeTextMatch(rule.trigger.trim())).length !== 1 ? '連動型の反応ワードは1文字にしてください。' : '',
    displayText: graphemes(rule.displayText).length !== 1 ? '表示文字は絵文字を含めて1文字にしてください。' : '',
    color: /^#[0-9a-f]{8}$/i.test(rule.color) ? '' : '#RRGGBBAA形式で入力してください。例：#66CC66FF',
    count: numberError(rule.count, rule.countMode === 'fixed' ? 1 : 2, 20),
  };
}
export function errorsFor(draft: Draft) {
  return [numberError(draft.fontSizePx, 16, 200), numberError(draft.fallDurationSeconds, 1, 10, false),
    numberError(draft.maxActiveItems, 1, 30), ...draft.rules.flatMap(rule => Object.values(ruleErrors(rule)))].filter(Boolean);
}
export function toRule(rule: RuleDraft): TextEffectRule {
  const base = { id: rule.id, enabled: rule.enabled, trigger: rule.trigger.trim(), displayText: rule.displayText, color: rule.color };
  return rule.countMode === 'fixed' ? { ...base, countMode: 'fixed', fixedCount: Number(rule.count) }
    : { ...base, countMode: 'consecutive', minimumConsecutiveCount: Number(rule.count) };
}
export function toSettings(draft: Draft): TextEffectsSettings {
  return { enabled: draft.enabled, fontSizePx: Number(draft.fontSizePx), fallDurationSeconds: Number(draft.fallDurationSeconds),
    maxActiveItems: Number(draft.maxActiveItems), rules: draft.rules.map(toRule) };
}
export function summary(rule: RuleDraft) {
  return rule.countMode === 'fixed' ? `「${rule.trigger || '未入力'}」を含む → ${rule.displayText} × ${rule.count || '—'}`
    : `「${rule.trigger || '未入力'}」が${rule.count || '—'}回以上連続 → ${rule.displayText} × 連続数`;
}
