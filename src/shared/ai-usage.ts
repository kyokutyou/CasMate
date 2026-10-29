export interface AiTokenTotal { tokens: number; responses: number }
export interface AiApiUsage {
  requests: number;
  pending: number;
  input: AiTokenTotal;
  output: AiTokenTotal;
  total: AiTokenTotal;
}
export type AiGenerationOutcome = 'succeeded' | 'skipped' | 'cancelled' | 'failed' | 'unknown';
export interface AiUsage {
  api: AiApiUsage;
  outcomes: Record<AiGenerationOutcome, number>;
}
export function emptyAiApiUsage(): AiApiUsage {
  return { requests: 0, pending: 0, input: { tokens: 0, responses: 0 }, output: { tokens: 0, responses: 0 }, total: { tokens: 0, responses: 0 } };
}
export function emptyAiOutcomes(): AiUsage['outcomes'] {
  return { succeeded: 0, skipped: 0, cancelled: 0, failed: 0, unknown: 0 };
}
