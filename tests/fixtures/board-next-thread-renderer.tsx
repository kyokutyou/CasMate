import { useContext, useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ManagementShell } from '../../src/renderer/components/ManagementShell';
import { NextThreadPanel } from '../../src/renderer/components/NextThreadPanel';
import { ManagementNavigation } from '../../src/renderer/management-navigation';
import type { ShitarabaNextThreadSettings, ShitarabaNextThreadState } from '../../src/shared/types';
import type { ManagementThemeId } from '../../src/shared/management-theme';
import type { ManagementTextSizeId } from '../../src/shared/management-text-size';
import '../../src/renderer/styles.css';

const initialSettings: ShitarabaNextThreadSettings = { enabled: true, createAtResponseNumber: 950, switchAtResponseNumber: 1000,
  titleMode: 'manual', manualTitle: '配信10', bodyMode: 'manual', manualBody: '次スレッドの本文',
  announceCurrentThread: true, announcementTemplate: '次スレッドはこちらです。\n{url}', authorName: '', email: '' };
const initial: ShitarabaNextThreadState = { status: 'manualReady', maxResponseNumber: 949, remainingResponses: 1,
  plannedTitle: '配信10', plannedBody: '次スレッドの本文', nextThreadUrl: null, message: null, updatedAt: '2026-10-08T00:00:00Z' };

window.fetch = async () => { throw new Error('This drawing fixture must not access a network.'); };

function Editor({ state, settings, change, success, threadUrl }: { state: ShitarabaNextThreadState; settings: ShitarabaNextThreadSettings; threadUrl: string;
  change(settings: ShitarabaNextThreadSettings): void; success(message: string): void }) {
  const navigation = useContext(ManagementNavigation);
  return navigation?.editor === 'nextThread' ? <NextThreadPanel settings={settings} state={state}
    threadUrl={threadUrl} synchronized onChange={change} onSave={async value => change(value)}
    onCreate={async () => {}} onResolve={async () => {}} onSuccess={success} /> : null;
}

function Harness() {
  const [state, setState] = useState(initial);
  const [settings, setSettings] = useState(initialSettings);
  const [notice, setNotice] = useState('');
  const [threadUrl, setThreadUrl] = useState('https://bbs.jpnkn.com/test/read.cgi/clarahas/123/');
  const [theme, setTheme] = useState<ManagementThemeId>('ocean');
  const [textSize, setTextSize] = useState<ManagementTextSizeId>('medium');
  useLayoutEffect(() => {
    window.boardNextThreadHarness = { update(next, message = '') {
      flushSync(() => { setState({ ...initial, ...next }); setNotice(message); });
    }, settings(next) { flushSync(() => setSettings({ ...initialSettings, ...next })); },
    appearance(theme, size) { flushSync(() => { setTheme(theme); setTextSize(size); }); },
    thread(url) { flushSync(() => setThreadUrl(url)); } };
  }, []);
  return <ManagementShell connected pcStatus={null} warnings={[]} activities={[]} windows={null} home={null} theme={theme} textSize={textSize}
    operationNotice={notice ? { tone: 'success', message: notice } : undefined}>
    <Editor state={state} settings={settings} threadUrl={threadUrl} change={setSettings} success={setNotice} />
  </ManagementShell>;
}

declare global {
  interface Window { boardNextThreadHarness: { update(state: Partial<ShitarabaNextThreadState>, notice?: string): void;
    settings(settings: Partial<ShitarabaNextThreadSettings>): void;
    appearance(theme: ManagementThemeId, size: ManagementTextSizeId): void;
    thread(url: string): void } }
}

flushSync(() => createRoot(document.getElementById('root')!).render(<Harness />));
