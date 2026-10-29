import { useContext, useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ManagementShell } from '../../src/renderer/components/ManagementShell';
import { PcStatus } from '../../src/renderer/components/PcStatus';
import { ManagementNavigation } from '../../src/renderer/management-navigation';
import type { PcMeasurement, PcStatusSnapshot } from '../../src/shared/pc-status';
import type { ManagementTextSizeId } from '../../src/shared/management-text-size';
import '../../src/renderer/styles.css';

type Stage = 'idle' | 'processing' | 'success' | 'error';
type State = { connected: boolean; expanded: boolean; stage: Stage; message: string; updateNotice: boolean; textSize:ManagementTextSizeId };
let state: State = { connected: true, expanded: false, stage: 'idle', message: '', updateNotice: false, textSize:'medium' };
let finishAcknowledgement: (() => void) | undefined;

// This isolated renderer has no real management token, backend, or external requests.
Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });
window.fetch = async input => {
  if (input !== '/api/management/pc-status') throw new Error(`Unexpected request: ${input}`);
  const now = Date.now();
  const metric = (value: number): PcMeasurement => ({ value, status: 'valid', lastSuccessAt: now });
  const gib = 2 ** 30;
  const data: PcStatusSnapshot = {
    measuredAt: now, state: 'running', gpuStatus: 'valid',
    gpus: [{ id: '00000000:00000001', name: 'Test GPU', kind: 'dedicated',
      usage: metric(state.expanded ? 100 : 9), capacity: metric((state.expanded ? 128 : 8) * gib),
      dedicatedMemory: metric((state.expanded ? 99.9 : 2) * gib), sharedMemory: metric(0) }],
    memory: { used: metric((state.expanded ? 999 : 8) * gib), total: metric((state.expanded ? 1024 : 16) * gib) },
    application: { cpu: metric(1), memory: metric(100 * 2 ** 20), incomplete: false },
  };
  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
};

function Controls({ prefix, stage }: { prefix: string; stage: Stage }) {
  return <section className="panel" aria-label="通知検証用の操作">
    <div style={{ height: 260 }} />
    <label>検証入力<input id={`${prefix}-input`} defaultValue="編集中の値" /></label>
    <button id={`${prefix}-action`} disabled={stage === 'processing'} style={{ width: '100%', maxWidth: 240, minWidth: 0, height: 40 }}
      onClick={() => {
        const failed = (document.getElementById(`${prefix}-input`) as HTMLInputElement).value === '失敗';
        window.notificationHarness.update({ stage: 'processing' });
        window.setTimeout(() => window.notificationHarness.update({ stage: failed ? 'error' : 'success',
          message: failed ? '検証用操作に失敗しました。' : '検証用操作を完了しました。' }), 100);
      }}>
      {stage === 'processing' ? '処理しています…' : '接続確認を実行'}
    </button>
    <div style={{ height: 1000 }} />
  </section>;
}

function Editor({ stage }: { stage: Stage }) {
  const navigation = useContext(ManagementNavigation);
  return navigation?.editor ? <Controls prefix="editor" stage={stage} /> : null;
}

function Harness() {
  const [current, setCurrent] = useState(state);
  useLayoutEffect(() => {
    window.notificationHarness = {
      update(next) { flushSync(() => { state = { ...state, ...next }; setCurrent(state); }); },
      finishAcknowledgement() { finishAcknowledgement?.(); },
      ready() {
        return document.querySelector('.pc-status-button')?.textContent?.includes(state.expanded ? '99.9/128' : '2.0/8.0') ?? false;
      },
    };
  }, []);
  return <ManagementShell connected={current.connected} textSize={current.textSize}
    operationNotice={current.stage === 'success' || current.stage === 'error' ? { tone: current.stage, message: current.message } : undefined}
    pcStatus={<PcStatus key={String(current.expanded)} />} warnings={[]} activities={[]} windows={null}
    updateNotices={current.updateNotice ? [{ key: 'update-notice', owner: 'smartphone', message: '受信方式を更新しました。共通QRで再登録し、OBS入力を確認してください。退避先: C:\\Users\\配信者\\AppData\\Roaming\\CasMate\\長い退避ファイル名.backup '.repeat(4),
      onAcknowledge: async () => {
        await new Promise<void>(resolve => { finishAcknowledgement = resolve; });
        window.notificationHarness.update({ updateNotice: false, stage: 'success', message: '更新案内を確認済みにしました。' });
      } }] : []}
    home={<Controls prefix="home" stage={current.stage} />}>
    <Editor stage={current.stage} />
  </ManagementShell>;
}

declare global {
  interface Window {
    notificationHarness: { update(next: Partial<State>): void; ready(): boolean; finishAcknowledgement(): void };
  }
}

flushSync(() => createRoot(document.getElementById('root')!).render(<Harness />));
