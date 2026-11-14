import { useEffect, useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ManagementShell } from '../../src/renderer/components/ManagementShell';
import { ListenerPollPanel } from '../../src/renderer/components/ListenerPollPanel';
import type { PollDraft, PollAppearance, PollManagementSnapshot } from '../../src/shared/listener-poll';
import type { ManagementThemeId } from '../../src/shared/management-theme';
import type { ManagementTextSizeId } from '../../src/shared/management-text-size';
import { ListenerPollPage } from '../../src/renderer/poll/ListenerPollPage';
import { PollOverlayPage } from '../../src/renderer/pages/PollOverlayPage';
import '../../src/renderer/styles.css';

const data: PollManagementSnapshot = {
  instance: 'render-fixture', revision: 1, available: true, error: null,
  draft: { question: '次の配信で一緒に楽しむ企画は？', options: ['ゲームを遊ぶ', 'みんなで雑談'], durationMinutes: 5 },
  appearance: { fontSize: 28, color: '#ffffff', background: '#142032' },
  publication: { status: 'online', url: `https://${'a'.repeat(26)}.srv.us/`, message: '' },
  current: { id: 'fixture-poll', question: '次の配信で一緒に楽しむ企画は？', options: ['ゲームを遊ぶ', 'みんなで雑談'], counts: [12, 8], startedAt: 0, endsAt: null, closedAt: null, closeReason: null, resultsVisible: true }, history: [],
};
const request = async (action?: string, body?: unknown) => {
  if (action === 'draft') data.draft = body as PollDraft;
  if (action === 'appearance') data.appearance = body as PollAppearance;
  if (action) data.revision++;
  return structuredClone(data);
};
const publicState = () => ({ instance: data.instance, revision: data.revision, poll: data.current, appearance: data.appearance });
class FixtureEvents {
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { setTimeout(() => { this.onopen?.(); this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(publicState()) })); }, 20); }
  close() {}
}
Object.defineProperty(window, 'EventSource', { value: FixtureEvents });
window.fetch = async () => new Response(JSON.stringify({ state: publicState(), ballot: null, cookieReady: true }));
interface Harness { update(theme: ManagementThemeId, text: ManagementTextSizeId): void; clear(): void; mode(mode: 'management' | 'listener' | 'overlay'): void }
declare global { interface Window { pollLayoutHarness: Harness } }
function Harness() {
  const [theme, setTheme] = useState<ManagementThemeId>('ocean'), [textSize, setTextSize] = useState<ManagementTextSizeId>('medium');
  const [notice, setNotice] = useState<{ message: string; tone: 'success' | 'error' }>();
  const [mode, setMode] = useState<'management' | 'listener' | 'overlay'>('management');
  useEffect(() => { window.pollLayoutHarness = { update: (theme, text) => { setTheme(theme); setTextSize(text); }, clear: () => setNotice(undefined), mode: setMode }; }, []);
  useLayoutEffect(() => { document.body.className = mode === 'listener' ? 'poll-document' : ''; }, [mode]);
  if (mode === 'listener') return <ListenerPollPage/>;
  if (mode === 'overlay') return <PollOverlayPage/>;
  return <ManagementShell theme={theme} textSize={textSize} home={null} connected pcStatus={null} windows={null} warnings={[]} activities={[]} operationNotice={notice}>
    <ListenerPollPanel request={request} baseUrl="http://127.0.0.1:3000" onNotice={(message, tone) => setNotice({ message, tone })} onRegisterSource={() => undefined}/>
  </ManagementShell>;
}
flushSync(() => createRoot(document.getElementById('root')!).render(<Harness/>));
