import type { CommentSource } from './types';
import { graphemes } from './unicode';

export const aiSources = ['youtube', 'twitch', 'shitaraba', 'jpnkn'] as const;
export interface AiPersona { id: string; name: string; personality: string; tone: string; firstPerson: string; topics: string; notes: string }
export interface AiSettings {
  visual?: import('./ai-visual').AiVisualSettings;
  mode: 'manual' | 'obs'; waitSeconds: number; jitterPercent: number; maxCharacters: number; memoryCharacters: number;
  contextCharacters: number;
  model: string; personas: AiPersona[]; participants: Record<CommentSource, { enabled: boolean; personaId: string }>;
  shitarabaName: string; shitarabaEmail: string; jpnknName: string; jpnknEmail: string; debugPromptLog: boolean;
}
export function defaultAiSettings(): AiSettings {
  return { visual: { enabled: false, source: null }, mode: 'manual', waitSeconds: 60, jitterPercent: 20, maxCharacters: 20, memoryCharacters: 10000,
    contextCharacters: 3000, model: 'gemini-3.1-flash-lite', personas: [], shitarabaName: '', shitarabaEmail: '', jpnknName: '', jpnknEmail: '', debugPromptLog: false,
    participants: { youtube: { enabled: false, personaId: '' }, twitch: { enabled: false, personaId: '' }, shitaraba: { enabled: false, personaId: '' }, jpnkn: { enabled: false, personaId: '' } } };
}
export interface AiMemory { id: string; at: string; role: 'streamer' | 'viewer' | 'ai'; source: CommentSource | null; text: string }
export interface AiAttempt {
  id: string; at: string; source: CommentSource; target: string; personaId: string; personaName: string; text: string;
  result: 'sending' | 'succeeded' | 'failed' | 'unknown'; externalId?: string; previousResponse?: number; authorName?: string; reviewed?: boolean;
}
export type AiProcessingStage = 'obs-check' | 'image-preparation' | 'generating' | 'posting';
export type AiActivityStage = AiProcessingStage | 'idle' | 'waiting' | 'speaking' | 'recognizing' | 'speech-gap' | 'new-speech';
export interface AiView {
  usage?: import('./ai-usage').AiUsage;
  activity?: { stage: AiActivityStage; startedAt: number | null; lastDurationsMs: Partial<Record<AiProcessingStage, number>> };
  postingBudget: { used: number; limit: number; nextAllowedAt: number | null };
  requested: boolean;
  status: 'stopped' | 'preparing' | 'running' | 'paused' | 'attention'; message: string; nextAt: number | null;
  memoryCharacters: number; hasKey: boolean;
  services: Record<CommentSource, { ready: boolean; message: string; account: string | null; latest: AiAttempt | null }>;
  authorization: { source: 'youtube' | 'twitch'; code?: string; url: string; expiresAt?: number } | null;
}
export function validateAiSettings(value: unknown): AiSettings {
  const fail = (): never => { throw new Error('AIリスナー設定の形式・範囲を確認してください。'); };
  if (!value || typeof value !== 'object') return fail();
  const v = value as AiSettings;
  const visual = v.visual;
  if (!visual || typeof visual.enabled !== 'boolean' || (visual.enabled && !visual.source)) return fail();
  if (visual.source !== null && (!visual.source || ![visual.source.uuid, visual.source.name, visual.source.collection].every(s => typeof s === 'string' && s.length > 0 && s.length <= 512))) return fail();
  if (typeof v.debugPromptLog !== 'boolean') return fail();
  const count = (n: unknown, min: number, max: number) => typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max;
  const contextCharacters = v.contextCharacters;
  if (!count(contextCharacters, 1000, 10000)) return fail();
  if (!['manual', 'obs'].includes(v.mode) || !count(v.waitSeconds, 30, 3600) || !count(v.jitterPercent, 0, 50) ||
    !count(v.maxCharacters, 10, 200) || !count(v.memoryCharacters, 1000, 100000) ||
    typeof v.model !== 'string' || !/^[a-zA-Z0-9._-]{1,120}$/.test(v.model) ||
    !Array.isArray(v.personas) || v.personas.length > 30 || !v.participants) return fail();
  const text = (s: unknown): s is string => typeof s === 'string';
  if (!text(v.shitarabaName) || !text(v.shitarabaEmail) || !text(v.jpnknName) || !text(v.jpnknEmail)) return fail();
  for (const p of v.personas) {
    if (!p || !text(p.id) || !p.id || !text(p.name) || !p.name.trim() ||
      ![p.personality, p.tone, p.firstPerson, p.topics, p.notes].every(text)) return fail();
  }
  if (new Set(v.personas.map(p => p.id)).size !== v.personas.length) return fail();
  for (const s of aiSources) {
    const p = v.participants[s];
    if (!p || typeof p.enabled !== 'boolean' || !text(p.personaId) || (p.personaId && !v.personas.some(x => x.id === p.personaId))) return fail();
  }
  return { visual: { enabled: visual.enabled, source: visual.source ? { uuid: visual.source.uuid, name: visual.source.name, collection: visual.source.collection } : null }, mode: v.mode, waitSeconds: v.waitSeconds, jitterPercent: v.jitterPercent, maxCharacters: v.maxCharacters,
    contextCharacters, memoryCharacters: v.memoryCharacters, model: v.model, shitarabaName: v.shitarabaName, shitarabaEmail: v.shitarabaEmail, jpnknName: v.jpnknName, jpnknEmail: v.jpnknEmail, debugPromptLog: v.debugPromptLog,
    personas: v.personas.map(p => ({ id: p.id, name: p.name.trim(), personality: p.personality, tone: p.tone, firstPerson: p.firstPerson, topics: p.topics, notes: p.notes })),
    participants: Object.fromEntries(aiSources.map(s => [s, { enabled: v.participants[s].enabled, personaId: v.participants[s].personaId }])) as AiSettings['participants'] };
}
export function trimAiMemory(records: AiMemory[], limit: number): AiMemory[] {
  const result = records.filter(r => graphemes(r.text).length <= limit);
  let total = result.reduce((n, r) => n + graphemes(r.text).length, 0);
  while (total > limit && result.length) total -= graphemes(result.shift()!.text).length;
  return result;
}
