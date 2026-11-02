import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ObsSourceContext } from '../../shared/obs-source-registration';
import type { useApplicationState } from '../api';
import { ObsSourceTestControls } from './ObsSourceTestControls';
import './obs-source-registration-dialog.css';
import './obs-overlay-test-panel.css';
import { TestActionButton } from './TestActionButton';

type TestApi = Pick<ReturnType<typeof useApplicationState>, 'obsSourceContext' | 'obsSourceContextRevision' | 'obsTestContext' | 'obsTestAction' | 'mutate'>;
export interface ObsOverlayTestPanelProps {
  api: TestApi;
  state: ReturnType<typeof useApplicationState>['snapshot'];
  target: 'comments' | 'speech';
  active: boolean;
  unsaved: boolean;
  invalidSelector: string;
  notice(message: string, error: boolean): void;
}

export function ObsOverlayTestPanel({ api, state, target, active, unsaved, invalidSelector, notice }: ObsOverlayTestPanelProps) {
  return target === 'comments' ? <CommentReceptionControls api={api} active={active} unsaved={unsaved} invalidSelector={invalidSelector} notice={notice}/> : <ObsOverlaySourceTestPanel api={api} state={state} target={target} active={active} unsaved={unsaved} invalidSelector={invalidSelector} notice={notice}/>;
}

export function CommentReceptionControls({ api, active, unsaved, invalidSelector, notice, speech = false, blockedReason = '', help = '' }: Omit<ObsOverlayTestPanelProps, 'state' | 'target' | 'api'> & { api: Pick<TestApi, 'mutate'>; speech?: boolean; blockedReason?: string; help?: string }) {
  const id = useId();
  const working = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    let disposed = false;
    const owner = document;
    const update = () => { if (!disposed && typeof window !== 'undefined') setInvalid(Boolean(owner.querySelector(invalidSelector))); };
    update(); const observer = new MutationObserver(update);
    observer.observe(document.body, { attributes: true, attributeFilter: ['aria-invalid'], childList: true, subtree: true });
    return () => { disposed = true; observer.disconnect(); };
  }, [invalidSelector]);
  const send = async () => {
    if (working.current || !active || blockedReason) return;
    if (unsaved || document.querySelector(invalidSelector)) { setError('入力を修正し、保存完了後にテストしてください。'); return; }
    working.current = true; setPending(true); setError('');
    try { await api.mutate(speech ? '/api/overlays/speech-recognition/test' : '/api/comments/test'); notice(speech ? 'テスト字幕を表示しました。' : 'テストコメントを1件投入しました。読み上げ・表示は通常の設定に従います。', false); }
    catch (reason) { const message = reason instanceof Error ? reason.message : 'コメントを投入できませんでした。'; setError(message); notice(message, true); }
    finally { working.current = false; setPending(false); }
  };
  return <section className="obs-overlay-test-panel" aria-label="OBSで表示を確認">
    <section className="obs-test-controls" aria-label="OBS表示テスト"><div className="obs-test-buttons">
      <TestActionButton data-action="test" aria-describedby={id} aria-busy={pending} aria-disabled={pending || unsaved || invalid || !active || Boolean(blockedReason)} onClick={() => void send()}>{pending ? '送信中…' : speech ? '字幕をテスト表示' : 'コメント受信テスト'}</TestActionButton>
    </div><div id={id} className="obs-test-status" role="status" tabIndex={0} aria-label="OBS表示テストの状態">{error || blockedReason || (unsaved ? '保存完了後にテストしてください。' : '実際の表示や音声を確認してください。')}</div></section>
    <details className="test-help"><summary>テストの説明</summary><p>{help}{speech ? '保存済みのデザイン・表示時間で字幕を1件表示します。音声認識・AI・OBS配信操作へは送りません。' : '押すたびにテストコメント1件を通常の受信処理へ送ります。表示・読み上げ・文字演出に反応し、履歴に残ります。AIリスナーには渡しません。'}</p></details>
  </section>;
}

function ObsOverlaySourceTestPanel({ api, state, target, active, unsaved, invalidSelector, notice }: ObsOverlayTestPanelProps) {
  const { obsSourceContext } = api;
  const id = useId();
  const [context, setContext] = useState<ObsSourceContext | null>(null);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [invalid, setInvalid] = useState(false);
  const collection = useRef('');
  const connected = state?.obsControl?.connection === 'connected';
  const busy = state?.obsSourceTest?.busy;
  const testId = state?.obsSourceTest?.current?.id;
  const revision = api.obsSourceContextRevision;
  const current = useRef({ active, unsaved, connected, target, input, revision });
  useLayoutEffect(() => {
    current.current = { active, unsaved, connected, target, input, revision };
    return () => { current.current = { ...current.current, active: false }; };
  }, [active, unsaved, connected, target, input, revision, invalid, refresh, busy, testId]);
  useEffect(() => {
    const update = () => setInvalid(Boolean(document.querySelector(invalidSelector)));
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { attributes: true, attributeFilter: ['aria-invalid'], childList: true, subtree: true });
    return () => observer.disconnect();
  }, [invalidSelector]);
  useEffect(() => {
    let disposed = false;
    setError(''); setLoading(false);
    if (!active || !connected || !obsSourceContext) return;
    setLoading(true);
    void obsSourceContext({ kind: 'overlay', overlay: target }).then(value => {
      if (disposed) return;
      setContext(value);
      const candidates = value.candidates.filter(candidate => value.presentInputUuids.includes(candidate.uuid));
      const sameCollection = value.collection === collection.current;
      setInput(previous => candidates.length === 1 ? candidates[0].uuid : candidates.some(candidate => candidate.uuid === previous) && sameCollection ? previous : '');
      collection.current = value.collection;
    }).catch(reason => { if (!disposed) { setContext(null); setError(reason instanceof Error ? reason.message : 'OBSソースを取得できません。'); } })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [active, connected, target, revision, refresh, obsSourceContext]);
  const candidates = context?.candidates.filter(candidate => context.presentInputUuids.includes(candidate.uuid)) ?? [];
  const selection = context?.currentSceneUuid && candidates.some(candidate => candidate.uuid === input)
    ? { target: { kind: 'overlay' as const, overlay: target }, collection: context.collection, sceneUuid: context.currentSceneUuid, inputUuid: input } : null;
  const reason = !connected ? 'OBSに接続していません。「OBS操作」で接続を設定してください。'
    : unsaved || invalid ? '保存待ちまたは入力エラーがあります。入力を修正し、保存完了後にテストしてください。'
    : loading ? 'OBSソースを確認しています。' : error
      || (!selection ? candidates.length > 1 ? '使用するOBSソースを選択してください。' : 'OBSで対象のシーンを開き、「OBSにソースを追加」から対象を追加してください。' : '');
  return <section className="obs-overlay-test-panel" aria-label="OBSで表示を確認">
    <p>{target === 'comments' ? 'テストコメント1件を通常の受信処理へ送ります。表示・読み上げ・文字演出に反応し、履歴に残ります。AIリスナーには渡しません。' : '保存済みの設定でOBSへテスト表示を送ります。実際の表示はOBSで確認してください。'}</p>
    <div className="obs-overlay-test-source"><label htmlFor={id}>使用するOBSソース</label>
      <select id={id} value={selection ? input : ''} aria-disabled={loading || !connected || candidates.length < 2} onChange={event => { if (!loading && connected && candidates.length > 1) setInput(event.target.value); }}>
        <option value="">{loading ? '確認中…' : 'ソースを選択'}</option>{candidates.map((candidate, index) => <option key={candidate.uuid} value={candidate.uuid}>{candidate.name}（候補{index + 1}）</option>)}
      </select>
      <button type="button" className="secondary" aria-disabled={loading || !connected} onClick={() => { if (!loading && connected) setRefresh(value => value + 1); }}>OBSソースを再確認</button>
    </div>
    <ObsSourceTestControls selection={selection} state={state?.obsSourceTest} blocked={!active || Boolean(reason)} context={api.obsTestContext}
      contextRevision={revision} action={api.obsTestAction} notice={notice} startLabel={target === 'comments' ? 'コメント受信テスト' : 'OBSテスト（5秒）'} unavailableMessage={reason}
      prepare={async () => {
        const before = current.current;
        if (!selection || !before.active || before.unsaved || !before.connected || document.querySelector(invalidSelector)) return null;
        const fresh = await api.obsSourceContext(selection.target);
        if (current.current !== before || document.querySelector(invalidSelector)) return null;
        if (fresh.collection !== selection.collection || fresh.currentSceneUuid !== selection.sceneUuid || !fresh.presentInputUuids.includes(selection.inputUuid) || !fresh.candidates.some(candidate => candidate.uuid === selection.inputUuid)) {
          setRefresh(value => value + 1);
          throw new Error('OBSのシーンまたはソースが変わりました。対象を再確認してからテストしてください。');
        }
        return selection;
      }}/>
  </section>;
}
