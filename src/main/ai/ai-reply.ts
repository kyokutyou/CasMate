const skipReasons = ['acknowledgement', 'unclear', 'resolved', 'redundant', 'no-topic'] as const;
type ModelSkipReason = typeof skipReasons[number];
export interface AiGenerationSkip { action: 'skip'; reason: ModelSkipReason | 'invalid-response' }
export type AiGenerationResult = string | AiGenerationSkip;

export function aiSkipMessage(result: AiGenerationSkip): string {
  const reasons: Record<AiGenerationSkip['reason'], string> = {
    acknowledgement: '相づちのみ', unclear: '意味不明', resolved: '解決済み', redundant: '反応の重複',
    'no-topic': '話題なし', 'invalid-response': '返答形式不正',
  };
  return `今回は見送りました（${reasons[result.reason]}）。`;
}

export const aiReplySchema = {
  type: 'OBJECT',
  properties: {
    action: { type: 'STRING', enum: ['reply', 'skip'] },
    target: { type: 'INTEGER', minimum: 0 },
    text: { type: 'STRING' },
    reason: { type: 'STRING', enum: ['none', ...skipReasons] },
  },
  required: ['action', 'target', 'text', 'reason'],
};

/** Only text tied to a human utterance in this request may reach the posting controller. */
export function parseAiReply(raw: string, allowed: number[], greeting: boolean): AiGenerationResult {
  const invalid: AiGenerationSkip = { action: 'skip', reason: 'invalid-response' };
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return invalid; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid;
  const data = value as Record<string, unknown>;
  if (Object.keys(data).sort().join(',') !== 'action,reason,target,text' || typeof data.text !== 'string' ||
    typeof data.target !== 'number' || !Number.isSafeInteger(data.target)) return invalid;
  if (data.action === 'skip') {
    if (data.target !== 0 || data.text !== '' || !skipReasons.some(reason => reason === data.reason)) return invalid;
    return { action: 'skip', reason: data.reason as ModelSkipReason };
  }
  if (data.action !== 'reply' || data.reason !== 'none' || !data.text.trim() ||
    !(allowed.includes(data.target) || (greeting && data.target === 0))) return invalid;
  return data.text.trim();
}
