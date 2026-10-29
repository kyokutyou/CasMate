import { useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ManagementShell } from '../../src/renderer/components/ManagementShell';
import { AiListenerPanel } from '../../src/renderer/components/AiListenerPanel';
import { defaultAiSettings, type AiSettings, type AiView } from '../../src/shared/ai-listener';
import type { ManagementThemeId } from '../../src/shared/management-theme';
import type { ManagementTextSizeId } from '../../src/shared/management-text-size';
import '../../src/renderer/styles.css';

const service = { ready: false, message: '', account: null, latest: null };
const initial: AiView = { requested: false, status: 'stopped', message: '停止中', nextAt: null, memoryCharacters: 0, hasKey: true,
  authorization: null, postingBudget: { used: 0, limit: 60, nextAllowedAt: null }, services: { youtube: service, twitch: service, shitaraba: service, jpnkn: service } };
window.fetch = async () => { throw new Error('No network in UI fixture'); };
function Editor({ view, error, success, settings, change, record }: { view: AiView; error: string; success(message: string): void;
  settings: AiSettings; change(value: AiSettings): void; record(path: string): void }) {
  return <AiListenerPanel settings={settings} view={view} change={change} saveError={error}
    mutate={async path => { record(path); return { sources: [], debugEnabled: false, model: settings.model, message: '文章応答を確認しました。' }; }} onSuccess={success} />;
}
function Harness() {
  const [view, setView] = useState(initial), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [theme, setTheme] = useState<ManagementThemeId>('ocean');
  const [size, setSize] = useState<ManagementTextSizeId>('medium');
  const [settings, setSettings] = useState(defaultAiSettings);const calls = useRef<string[]>([]);
  useLayoutEffect(() => { window.aiLayoutHarness = {
    update(next, error = '', notice = '') { flushSync(() => { setView({ ...initial, ...next }); setError(error); setNotice(notice); }); },
    appearance(theme, size) { flushSync(() => { setTheme(theme); setSize(size); }); },
    settings(next) { flushSync(() => setSettings({ ...defaultAiSettings(), ...next })); },
    calls() { return [...calls.current]; },
  }; }, []);
  return <ManagementShell connected pcStatus={null} warnings={[]} activities={[]} windows={null} home={null} theme={theme} textSize={size}
    operationNotice={notice ? { tone: 'success', message: notice } : undefined}><Editor view={view} error={error} success={setNotice} settings={settings} change={setSettings} record={path => calls.current.push(path)} /></ManagementShell>;
}
declare global {
  interface Window { aiLayoutHarness: { update(view: Partial<AiView>, error?: string, notice?: string): void;
    appearance(theme: ManagementThemeId, size: ManagementTextSizeId): void;settings(next: Partial<AiSettings>): void;calls(): string[] } }
}
flushSync(() => createRoot(document.getElementById('root')!).render(<Harness />));
