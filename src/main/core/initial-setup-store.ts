import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { AppSnapshot } from '../../shared/types';
import { initialSetupSteps, setupFeatures, setupStepIds, smartphoneUses, setupConfigured, type InitialSetupCommand, type InitialSetupRecord, type InitialSetupView, type SetupStep } from '../../shared/initial-setup';
import { atomicBytes } from './compatibility-storage';

type InitialSetupContext = Pick<AppSnapshot, 'settings' | 'obsControl' | 'smartphone' | 'aiListener' | 'obsSourceRegistration'>;

export class InitialSetupError extends Error {
  constructor(message: string, readonly conflict = false) { super(message); }
}
export class InitialSetupStore {
  private record: InitialSetupRecord;
  private queue = Promise.resolve();
  private warning?: string;
  constructor(private readonly path: string, firstRun: boolean, private readonly write = atomicBytes,
    private readonly privateFingerprints: () => { obs?: string; ai?: string; port?: number; voicevox?: string } = () => ({})) {
    this.record = { version: 1, revision: 0, autoShow: firstRun, started: false, completed: false, selected: [], smartphoneUses: ['comments'], position: 'welcome', deferred: [], confirmations: {} };
  }
  async load(): Promise<void> {
    try {
      const value: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      this.record = parseRecord(value);
      if (setupStepIds.includes(this.record.position as SetupStep) && !initialSetupSteps(this.record).includes(this.record.position as SetupStep)) this.record.position = 'features';
      this.warning = undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') { this.warning = undefined; return; }
      this.record.autoShow = false;
      this.warning = '初回設定の進行記録を読み込めません。原本を保持しています。保存領域を確認して「進行記録を再読込」を押してください。';
    }
  }
  view(snapshot: InitialSetupContext): InitialSetupView {
    const fingerprints = setupFingerprints(snapshot);
    const extra = this.privateFingerprints();
    const combine = (step: SetupStep, value: unknown) => { fingerprints[step] = createHash('sha256').update(JSON.stringify([fingerprints[step], value])).digest('hex'); };
    combine('smartphone', this.record.smartphoneUses.includes('video') ? [this.record.smartphoneUses, 'received-data-v1'] : this.record.smartphoneUses);
    for (const step of ['obsControl', 'obsDisplay', 'aiListener'] as const) combine(step, extra.obs ?? '');
    combine('aiListener', extra.ai ?? '');
    combine('commentSpeech', extra.voicevox ?? '');
    combine('obsDisplay', extra.port ?? snapshot.settings.application.port);
    combine('obsDisplay', ['commentOverlay', 'speechRecognition', 'textEffects', 'character'].filter(id => this.record.selected.includes(id as import('../../shared/initial-setup').SetupFeature)));
    return { ...structuredClone(this.record), fingerprints, ...(this.warning ? { warning: this.warning } : {}) };
  }
  update(command: unknown, snapshot: () => AppSnapshot): Promise<void> {
    const operation = this.queue.then(async () => {
      const c = parseCommand(command);
      if (c.action === 'reload') { await this.load(); if (this.warning) throw new InitialSetupError(this.warning); return; }
      if (this.warning) throw new InitialSetupError(this.warning);
      if (c.revision !== this.record.revision) throw new InitialSetupError('別の管理画面で初回設定が更新されました。最新の進行を確認して操作し直してください。', true);
      const next = structuredClone(this.record);
      next.autoShow = false; next.started = true;
      if (c.action === 'open') { next.autoShow = false; next.started = true; }
      if (c.action === 'select') {
        next.selected = c.selected; next.smartphoneUses = c.smartphoneUses; next.completed = false;
        const steps = initialSetupSteps(next);
        next.deferred = next.deferred.filter(step => steps.includes(step));
        if (setupStepIds.includes(next.position as SetupStep) && !steps.includes(next.position as SetupStep)) next.position = 'features';
      }
      if (c.action === 'move') {
        if (!['welcome', 'features', 'summary', ...initialSetupSteps(next)].includes(c.position)) throw new InitialSetupError('選んだ機能の手順を開いてください。');
        next.position = c.position;
      }
      if (c.action === 'defer' || c.action === 'confirm' || c.action === 'unconfirm') {
        if (!initialSetupSteps(next).includes(c.step)) throw new InitialSetupError('選んだ機能の確認項目を指定してください。');
        if (c.action === 'unconfirm') delete next.confirmations[c.step];
        else if (c.action === 'defer') {
          next.deferred = [...new Set([...next.deferred, c.step])]; delete next.confirmations[c.step];
          const steps = initialSetupSteps(next); next.position = steps[steps.indexOf(c.step) + 1] ?? 'summary';
        }
        else {
          const current = snapshot();
          if (this.view(current).fingerprints[c.step] !== c.fingerprint) throw new InitialSetupError('設定が変更されました。現在の設定を確認してから確認済みにしてください。', true);
          if (!setupConfigured(c.step, current, next.smartphoneUses)) throw new InitialSetupError('必要な設定・準備を確認するか、後で設定することを選んでください。');
          next.confirmations[c.step] = c.fingerprint; next.deferred = next.deferred.filter(step => step !== c.step);
        }
      }
      if (c.action === 'finish') { next.completed = true; next.autoShow = false; next.position = 'summary'; }
      next.revision++;
      try { await this.write(this.path, Buffer.from(JSON.stringify(next) + '\n')); }
      catch { throw new InitialSetupError('初回設定の進み具合を保存できませんでした。保存領域を確認して、もう一度お試しください。'); }
      this.record = next;
    });
    this.queue = operation.catch(() => undefined); return operation;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function list(value: unknown, allowed: readonly string[]): value is string[] { return Array.isArray(value) && value.length <= allowed.length && value.every(v => typeof v === 'string' && allowed.includes(v)) && new Set(value).size === value.length; }
function parseRecord(value: unknown): InitialSetupRecord {
  if (!isRecord(value) || Object.keys(value).sort().join(',') !== 'autoShow,completed,confirmations,deferred,position,revision,selected,smartphoneUses,started,version' ||
    value.version !== 1 || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 ||
    !['autoShow', 'started', 'completed'].every(k => typeof value[k] === 'boolean') ||
    !list(value.selected, setupFeatures.map(f => f[0])) || !list(value.smartphoneUses, smartphoneUses) || !list(value.deferred, setupStepIds) ||
    !['welcome', 'features', 'summary', ...setupStepIds].includes(String(value.position)) || !isRecord(value.confirmations) ||
    !Object.entries(value.confirmations).every(([k, v]) => setupStepIds.includes(k as SetupStep) && typeof v === 'string' && /^[a-f0-9]{64}$/.test(v))) throw new InitialSetupError('初回設定の記録形式を確認できません。');
  return value as unknown as InitialSetupRecord;
}
function parseCommand(value: unknown): InitialSetupCommand {
  if (!isRecord(value) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0) throw new InitialSetupError('初回設定の操作を確認できません。');
  const keys: Record<string, string[]> = { open: [], finish: [], reload: [], select: ['selected', 'smartphoneUses'], move: ['position'], defer: ['step'], confirm: ['step', 'fingerprint'], unconfirm: ['step'] };
  const fields = typeof value.action === 'string' && Object.hasOwn(keys, value.action) ? keys[value.action] : undefined;
  if (!fields || Object.keys(value).sort().join(',') !== ['action', 'revision', ...fields].sort().join(',')) throw new InitialSetupError('初回設定の操作を確認できません。');
  if (value.action === 'select' && (!list(value.selected, setupFeatures.map(f => f[0])) || !list(value.smartphoneUses, smartphoneUses))) throw new InitialSetupError('使う機能を選び直してください。');
  if (value.action === 'move' && !['welcome', 'features', 'summary', ...setupStepIds].includes(String(value.position))) throw new InitialSetupError('確認する手順を選んでください。');
  if ((value.action === 'defer' || value.action === 'confirm' || value.action === 'unconfirm') && !setupStepIds.includes(value.step as SetupStep)) throw new InitialSetupError('確認する機能を選んでください。');
  if (value.action === 'confirm' && (typeof value.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.fingerprint))) throw new InitialSetupError('現在の設定を確認してください。');
  return value as unknown as InitialSetupCommand;
}
export function setupFingerprints(s: InitialSetupContext): Record<SetupStep, string> {
  const settings = s.settings;
  const obs = s.obsControl ? [s.obsControl.obsPort, s.obsControl.passwordConfigured] : null;
  const phone = s.smartphone ? [s.smartphone.settings, Object.values(s.smartphone.networks).map(n => [n.address, n.commentsUrl]),
    s.smartphone.devices.map(d => [d.id, d.obsLocalPort, d.obsRevision, Object.values(d.profiles).map(p => [p.registered, p.revision])])] : null;
  const values: Record<SetupStep, unknown> = {
    sources: settings.sources, commentSpeech: settings.commentSpeech, smartphone: [phone, settings.mobileSpeech],
    speechRecognition: settings.speechRecognition, obsControl: obs,
    aiListener: [settings.aiListener, s.aiListener?.hasKey, s.aiListener && Object.values(s.aiListener.services).map(v => v.account), obs, settings.speechRecognition, settings.sources],
    textEffects: settings.textEffects, character: settings.character.simple,
    obsDisplay: [settings.application.port, settings.commentOverlay, settings.speechRecognitionOverlay, settings.textEffects, settings.character.simple, settings.speechRecognition, obs,
      s.obsSourceRegistration?.lastOperation && [s.obsSourceRegistration.lastOperation.target, s.obsSourceRegistration.lastOperation.collection,
        s.obsSourceRegistration.lastOperation.sceneUuid, s.obsSourceRegistration.lastOperation.inputUuid]],
  };
  return Object.fromEntries(setupStepIds.map(step => [step, createHash('sha256').update(JSON.stringify(values[step])).digest('hex')])) as Record<SetupStep, string>;
}
