import { useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ManagementShell } from '../../src/renderer/components/ManagementShell';
import { ObsUrlsPanel } from '../../src/renderer/components/ObsUrlsPanel';
import { SmartphonePanel } from '../../src/renderer/components/SmartphonePanel';
import { ObsSourceRegistrationDialog, type ObsSourceRegistrationEntry, type ObsSourceRegistrationWarning } from '../../src/renderer/components/ObsSourceRegistrationDialog';
import type { ObsSourceAddRequest, ObsSourceContext, ObsSourceOperation, ObsSourceOperationStatus, ObsSourceRegistrationState, ObsSourceTarget } from '../../src/shared/obs-source-registration';
import type { ObsControlView } from '../../src/shared/obs-control';
import type { ObsSourceTestState } from '../../src/shared/obs-source-test';
import type { ManagementTextSizeId } from '../../src/shared/management-text-size';
import type { ManagementThemeId } from '../../src/shared/management-theme';
import { smartphoneDirectView, smartphoneMobileState } from './smartphone-view';
import '../../src/renderer/styles.css';

const obs: ObsControlView = { epoch: 'test', revision: 1, enabled: true, connection: 'connected', voiceEnabled: false, androidEnabled: false,
  obsPort: 4455, passwordConfigured: true, phrases: { startCommand: '配信開始', stopCommand: '配信終了', startConfirm: '開始を実行', stopConfirm: '終了を実行' },
  stream: 'stopped', busy: false, confirmation: null, lastOperation: null, error: null,
  publication: { lanEnabled: false, tailscaleEnabled: false, port: 3002, ready: false, registered: false, registrationId: null, revision: null, endpoints: [], warning: null } };
type FixtureState = { registration: ObsSourceRegistrationState; test: ObsSourceTestState; notice?: { message: string; tone: 'success' | 'error' }; theme?: ManagementThemeId; textSize?: ManagementTextSizeId; recoveries?: ObsSourceRegistrationWarning[]; phoneOff: boolean; long: boolean; multiple: boolean; removedFromScene: boolean; contextRevision: number };
let current: FixtureState = { registration: { busy: false, lastOperation: null, unfinishedOperations: [] }, test: { busy: false, current: null, warnings: [] }, phoneOff: false, long: false, multiple: false, removedFromScene: false, contextRevision: 0 };
let pending: { operation: ObsSourceOperation; finish(operation: ObsSourceOperation): void } | null = null;
let additions = 0;
let contextReads = 0;
const registeredInputs = new Map<string, { uuid: string; name: string }>();
declare global {
  interface Window {
    obsRegistrationHarness: { update(patch: Partial<FixtureState>): void; complete(status: ObsSourceOperationStatus, message?: string): void; additions(): number; contexts(): number; pending(): boolean };
  }
}
const targetTitle = (target: ObsSourceTarget) => target.kind === 'overlay'
  ? { comments: 'コメント', speech: '音声認識', character: 'キャラクター', effects: '文字演出' }[target.overlay]
  : 'スマホA';

// The harness uses real renderer components and state changes without connecting to OBS or exposing registration credentials.
function Harness() {
  const [value, setValue] = useState(current);
  const [request, setRequest] = useState<ObsSourceRegistrationEntry | null>(null);
  const [feedback, setFeedback] = useState<ObsSourceRegistrationWarning | undefined>();
  const [phoneBlocked, setPhoneBlocked] = useState('');
  const update = (patch: Partial<FixtureState>) => { flushSync(() => { current = { ...current, ...patch }; setValue(current); }); };
  useLayoutEffect(() => {
    window.obsRegistrationHarness = { update, additions: () => additions, contexts: () => contextReads, pending: () => Boolean(pending), complete(status, message) {
      if (!pending) throw new Error('No fixture operation is pending.');
      const operation = { ...pending.operation, status, phase: 'complete' as const, message: message ?? 'OBSへの登録と設定・配置の確認が完了しました。映像・音声はOBSで確認してください。',
        result: status === 'succeeded' ? 'created' as const : null, errorCode: status === 'succeeded' ? null : 'OBS_SOURCE_RESULT_UNKNOWN' };
      const unfinishedOperations = (current.registration.unfinishedOperations ?? []).filter(value => value.id !== operation.id);
      if (status === 'incomplete' || status === 'unknown') unfinishedOperations.push(operation);
      if (operation.inputUuid) registeredInputs.set(JSON.stringify(operation.target), { uuid: operation.inputUuid, name: 'きゃすメイト ' + targetTitle(operation.target) });
      update({ registration: { busy: false, lastOperation: operation, unfinishedOperations } });
      const finished = pending; pending = null; finished.finish(operation);
    } };
  });
  const operation = value.registration.lastOperation;
  const disconnected = new URLSearchParams(window.location.search).has('disconnected');
  const recovery = operation && ['failed', 'incomplete', 'unknown'].includes(operation.status)
    ? { key: operation.id, target: operation.target, title: operation.title, message: `${operation.title}：${operation.message}`,
      retryOperationId: operation.status === 'incomplete' || operation.status === 'unknown' ? operation.id : undefined } : feedback;
  const owner = recovery?.target.kind === 'smartphone' ? 'smartphone' : 'urls';
  const phone = structuredClone(smartphoneDirectView); phone.settings.activeNetwork = value.phoneOff ? null : 'lan';
  if (value.long) phone.devices[0].name = 'A'.repeat(64);
  const context = async (target: ObsSourceTarget): Promise<ObsSourceContext> => { contextReads += 1; const input = registeredInputs.get(JSON.stringify(target)); return { target,
    title: targetTitle(target) + (value.long ? '・長い対象名の描画確認'.repeat(9) : ''), collection: '配信用コレクション',
    scenes: [{ uuid: 'waiting', name: '待機' }, { uuid: 'program', name: '現在の本番シーン' }], currentSceneUuid: 'program', canvas: { width: 1920, height: 1080 },
    candidates: value.multiple ? [{ uuid: 'visual-source', name: '手動コメントA' }, { uuid: 'manual-second', name: '手動コメントB' }]
      : input ? [{ ...input, name: input.name + (value.long ? '・長いソース名'.repeat(18) : '') }] : [],
    presentInputUuids: input && !value.removedFromScene ? [input.uuid] : [], incompatible: [] }; };
  const add = (submitted: ObsSourceAddRequest): Promise<ObsSourceOperation> => {
    additions += 1;
    const running: ObsSourceOperation = { id: submitted.retryOperationId ?? 'visual-operation-' + additions, target: submitted.target,
      title: targetTitle(submitted.target), collection: submitted.collection, sceneUuid: submitted.sceneUuid, sceneName: '現在の本番シーン',
      status: 'running', phase: 'creatingInput', result: null, inputUuid: 'visual-source', sceneItemId: 4, errorCode: null, message: 'OBSへの登録を処理中です。' };
    update({ registration: { ...value.registration, busy: true, lastOperation: running } });
    return new Promise(resolve => {
      pending = { operation: running, finish: resolve };
      if (new URLSearchParams(window.location.search).has('autoComplete')) window.setTimeout(() => window.obsRegistrationHarness.complete('succeeded'), 450);
    });
  };
  return <ManagementShell connected pcStatus={null} activities={[]} home={null} windows={null} operationNotice={value.notice} textSize={value.textSize} theme={value.theme}
    warnings={recovery ? [{ id: owner, target: `obs-registration-recovery-${encodeURIComponent(recovery.key)}`, message: recovery.message,
      onSelect: entry => setRequest({ target: recovery.target, title: recovery.title, entry, retryOperationId: recovery.retryOperationId }) }] : []}>
    <ObsUrlsPanel baseUrl="http://127.0.0.1:3000" onRegisterSource={setRequest} registrationWarning={owner === 'urls' ? recovery?.message : undefined}
      onOperationStart={() => update({ notice: undefined })} onSuccess={message => update({ notice: { message, tone: 'success' } })} onError={() => {}} />
    <SmartphonePanel view={phone} mobile={smartphoneMobileState} audioSettings={{ lanEnabled: true, tailscaleEnabled: false, bitrateKbps: 32 }}
      onRegisterSource={setRequest} onRegistrationBlockedChange={setPhoneBlocked} registrationWarning={owner === 'smartphone' ? recovery?.message : undefined}
      configure={async () => {}} changeAudio={() => {}} deviceAction={async () => {}} invitation={async () => { throw new Error('Fixture QR is unavailable.'); }}
      obsInput={async () => 'udp://127.0.0.1:10001'} onSuccess={message => update({ notice: { message, tone: 'success' } })} />
    <ObsSourceRegistrationDialog request={request} state={value.registration} obs={disconnected ? { ...obs, connection: 'disconnected' } : obs} smartphone={phone} smartphoneBlockedReason={phoneBlocked} contextRevision={value.contextRevision}
      onCopyStart={() => update({ notice: undefined })} onCopyNotice={(message, error) => update({ notice: { message, tone: error ? 'error' : 'success' } })}
      testState={value.test} testContext={async () => ({ available: !value.removedFromScene, message: value.removedFromScene ? 'このOBSソースは対象のシーンに追加されていません。「OBSに追加」で追加してからテストしてください。' : '' })}
      testAction={async (action, submitted) => {
        const test: ObsSourceTestState = action === 'start' && 'target' in submitted ? { busy: true, warnings: [], current: { ...submitted,
          id: 'display-test', title: targetTitle(submitted.target), phase: 'sending', startedAt: Date.now(), expiresAt: Date.now() + 5000, needsAttention: false, message: 'テスト表示を送信しました。' } }
          : { ...value.test, busy: false, current: value.test.current ? { ...value.test.current, phase: 'complete', message: '' } : null };
        update({ test, notice: action === 'start' ? { message: test.current?.message ?? '', tone: 'success' } : undefined }); return test;
      }}
      onTestNotice={(message, error) => update({ notice: { message, tone: error ? 'error' : 'success' } })}
      baseUrl="http://127.0.0.1:3000" recoveries={value.recoveries ?? (recovery ? [recovery] : [])} context={context} add={add} onOpen={setRequest} onClose={() => setRequest(null)}
      onStart={() => { setFeedback(undefined); update({ notice: undefined }); }} onNotice={(message, tone, target, title) => {
        update({ notice: tone === 'success' ? { message, tone } : undefined }); setFeedback(tone === 'error' ? { key: 'feedback-' + JSON.stringify(target), target, title, message: `${title}：${message}` } : undefined);
      }} />
  </ManagementShell>;
}
flushSync(() => createRoot(document.getElementById('root')!).render(<Harness />));
