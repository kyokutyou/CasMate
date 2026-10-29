import { useCallback, useLayoutEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import type { AppSettings, AppSnapshot, ConnectionKey, SettingsSection, SourceStatusView, VoicevoxSpeaker } from '../../src/shared/types';
import { initialSetupSteps, type InitialSetupCommand } from '../../src/shared/initial-setup';

type Trace = { kind: string; source?: ConnectionKey; action?: string; section?: SettingsSection; value?: unknown; path?: string; body?: unknown };
const trace: Trace[] = [];
let nextSaveError: { message: string; code?: string } | undefined;
let nextAiTestError: string | undefined;
let nextSaveWait: Promise<void> | undefined;
let releaseSave: (() => void) | undefined;
let nextMutationWait: Promise<void> | undefined;
let releaseMutation: (() => void) | undefined;
let nextMutationError: string | undefined;
let voicesValue: VoicevoxSpeaker[] = [];
let voicesRequests = 0;
let nextVoicesWait: Promise<void> | undefined;
let releaseVoices: (() => void) | undefined;
let nextVoicesError: string | undefined;
async function listSpeechVoices() {
  voicesRequests++;
  const wait=nextVoicesWait;nextVoicesWait=undefined;
  if(wait)await wait;
  if(nextVoicesError){const message=nextVoicesError;nextVoicesError=undefined;throw new Error(message);}
  return structuredClone(voicesValue);
}
const initial = JSON.parse(document.getElementById('fixture-data')!.textContent!) as AppSnapshot;
window.fetch = async () => { throw new Error('This fixture must not access a network.'); };
window.open = url => { trace.push({ kind: 'browser', value: String(url) }); return null; };

export function useApplicationState() {
  const [snapshot, setSnapshot] = useState(initial);
  const updateSettings = useCallback(async <K extends SettingsSection>(section: K, value: AppSettings[K]) => {
    trace.push({ kind: 'save', section, value: structuredClone(value) });
    const wait = nextSaveWait; nextSaveWait = undefined;
    if (wait) await wait;
    if (nextSaveError) { const error = nextSaveError; nextSaveError = undefined; throw Object.assign(new Error(error.message), { code: error.code }); }
    setSnapshot(current => ({ ...current, settingsRevision: current.settingsRevision + 1, settings: { ...current.settings, [section]: value } }));
  }, []);
  const sourceAction = useCallback(async (source: ConnectionKey, action: 'start' | 'stop' | 'reconnect') => {
    trace.push({ kind: 'source', source, action });
    setSnapshot(current => ({ ...current, sourceStatuses: { ...current.sourceStatuses, [source]: {
      ...current.sourceStatuses[source], state: action === 'stop' ? 'stopped' : 'connected', message: null,
    } } }));
  }, []);
  const mutate = useCallback(async (path: string, _method?: string, body?: unknown) => {
    trace.push({ kind: 'mutate', path, body });
    const wait = nextMutationWait; nextMutationWait = undefined;
    if (wait) await wait;
    if (nextMutationError) { const message = nextMutationError; nextMutationError = undefined; throw new Error(message); }
    if (path === '/api/management/initial-setup') {
      const command = body as InitialSetupCommand;
      setSnapshot(current => {
        const view = structuredClone(current.initialSetup!); view.revision++; view.autoShow = false; view.started = true;
        if (command.action === 'select') { view.selected = command.selected; view.smartphoneUses = command.smartphoneUses; }
        if (command.action === 'move') view.position = command.position;
        if (command.action === 'confirm') view.confirmations[command.step] = command.fingerprint;
        if (command.action === 'unconfirm') delete view.confirmations[command.step];
        if (command.action === 'defer') { view.deferred.push(command.step); const steps = initialSetupSteps(view); view.position = steps[steps.indexOf(command.step) + 1] ?? 'summary'; }
        if (command.action === 'finish') { view.completed = true; view.position = 'summary'; }
        if (command.action === 'reload') delete view.warning;
        return { ...current, initialSetup: view };
      });
      return;
    }
    if (path === '/api/windows/comment-list/toggle') {
      setSnapshot(current => ({ ...current, settings: { ...current.settings, application: { ...current.settings.application, commentListWindowVisible: !current.settings.application.commentListWindowVisible } } }));
      return;
    }
    if (path === '/api/ai-listener/test-api') {
      if (nextAiTestError) { const message = nextAiTestError; nextAiTestError = undefined; throw new Error(message); }
      return { model: window.boardManagementHarness.snapshot().settings.aiListener.model, message: 'Gemini APIの文章応答を確認しました。' };
    }
    if (path === '/api/ai-listener/visual/sources') return { sources: [{ uuid: 'game', name: 'ゲーム画面', collection: '配信' }] };
    if (path === '/api/ai-listener/visual/status') return { debugEnabled: false };
    if (path === '/api/speech/engine/select') return { selected: false };
    if (path === '/api/shitaraba/next-thread/resolve') {
      const resolution = body as { outcome: 'created'; threadUrl: string };
      setSnapshot(current => ({ ...current, shitarabaNextThread: { ...current.shitarabaNextThread,
        status: 'created', nextThreadUrl: resolution.threadUrl, message: '必要ならブラウザで現行スレッドへ案内してください。' } }));
    }
  }, []);
  useLayoutEffect(() => {
    window.boardManagementHarness = {
      trace: () => structuredClone(trace),
      failNextSave(message, code) { nextSaveError = { message, code }; },
      failNextApiTest(message) { nextAiTestError = message; },
      holdNextSave() { nextSaveWait = new Promise(resolve => { releaseSave = resolve; }); },
      releaseSave() { releaseSave?.(); releaseSave = undefined; },
      holdNextMutation(message?: string) { nextMutationError = message; nextMutationWait = new Promise(resolve => { releaseMutation = resolve; }); },
      releaseMutation() { releaseMutation?.(); releaseMutation = undefined; },
      voiceRequests: () => voicesRequests,
      holdNextVoices(message) { nextVoicesError = message;nextVoicesWait = new Promise(resolve => { releaseVoices = resolve; }); },
      releaseVoices(value) { if(value)voicesValue = value;releaseVoices?.();releaseVoices = undefined; },
      updateSnapshot(patch) { flushSync(() => setSnapshot(current => ({ ...current, ...patch }))); },
      updateSource(status) { flushSync(() => setSnapshot(current => ({ ...current,
        sourceStatuses: { ...current.sourceStatuses, shitaraba: { ...current.sourceStatuses.shitaraba, ...status } } }))); },
      browserRequired() { flushSync(() => setSnapshot(current => ({ ...current,
        shitarabaNextThread: { ...current.shitarabaNextThread, status: 'browserRequired', nextThreadUrl: null,
          message: 'ブラウザで認証を確認して次スレッドを作成し、作成済みURLを登録してください。' } }))); },
      snapshot: () => structuredClone(snapshot),
    };
  }, [snapshot]);
  return { snapshot, connected: true, error: null, updateSettings, sourceAction, mutate,
    uploadAsset: async () => {}, listSpeechVoices: async () => listSpeechVoices() };
}

declare global {
  interface Window {
    boardManagementHarness: {
      trace(): Trace[];
      failNextSave(message: string, code?: string): void;
      failNextApiTest(message: string): void;
      holdNextSave(): void;
      releaseSave(): void;
      holdNextMutation(message?: string): void;
      releaseMutation(): void;
      voiceRequests(): number;
      holdNextVoices(message?: string): void;
      releaseVoices(value?: VoicevoxSpeaker[]): void;
      updateSnapshot(patch: Partial<AppSnapshot>): void;
      updateSource(status: Partial<SourceStatusView>): void;
      browserRequired(): void;
      snapshot(): AppSnapshot;
    };
  }
}
