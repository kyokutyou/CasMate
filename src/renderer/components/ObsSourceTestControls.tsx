import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ObsSourceTestContext, ObsSourceTestRequest, ObsSourceTestState } from '../../shared/obs-source-test';

export interface ObsSourceTestControlsProps {
  selection: ObsSourceTestRequest | null;
  state?: ObsSourceTestState;
  blocked: boolean;
  contextRevision?: number;
  context?(request: ObsSourceTestRequest): Promise<ObsSourceTestContext>;
  action?(action: 'start' | 'stop', body: ObsSourceTestRequest | { testId: string }): Promise<ObsSourceTestState | undefined>;
  prepare?(): Promise<ObsSourceTestRequest | null>;
  notice(message: string, error: boolean): void;
  registrationAction?: ReactNode;
}
export function ObsSourceTestControls({ selection, state, blocked, context, contextRevision = 0, action, prepare, notice, registrationAction }: ObsSourceTestControlsProps) {
  const id = useId();
  const [eligibility, setEligibility] = useState<ObsSourceTestContext | null>(null);
  const [pending, setPending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState('');
  const serial = useRef(0);
  const outstanding = useRef<{ serial: number; stop: boolean; previousId: string | null; selection: string; observed: boolean } | null>(null);
  const callbacks = useRef({ context, action, prepare, notice });
  useLayoutEffect(() => { callbacks.current = { context, action, prepare, notice }; }, [context, action, prepare, notice]);
  const key = JSON.stringify(selection);
  const selected = useMemo(() => JSON.parse(key) as ObsSourceTestRequest | null, [key]);
  useEffect(() => {
    let closed = false;
    setEligibility(null);
    setError('');
    if (selected && callbacks.current.context && !blocked && !state?.busy)
      void callbacks.current.context(selected).then(result => { if (!closed) setEligibility(result); }).catch(reason => {
        if (!closed) setEligibility({ available: false, message: reason instanceof Error ? reason.message : 'テスト可否を確認できません。' });
      });
    return () => { closed = true; };
  }, [selected, blocked, state?.busy, contextRevision]);
  const sharedCurrent = state?.current;
  useLayoutEffect(() => {
    const request = outstanding.current, current = sharedCurrent;
    if (!request || !current) return;
    if (!request.stop && current.id !== request.previousId && JSON.stringify({ target: current.target, collection: current.collection, sceneUuid: current.sceneUuid, inputUuid: current.inputUuid }) === request.selection) {
      request.observed = true; setPending(false);
    }
    if (request.stop && current.id === request.previousId && (current.phase === 'complete' || current.phase === 'unknown')) {
      request.observed = true; setStopping(false);
    }
  }, [sharedCurrent]);
  const submit = async (stop: boolean) => {
    if (!callbacks.current.action || (!stop && (pending || !selection || !eligibility?.available || blocked || state?.busy))) return;
    if (stop && (stopping || !state?.busy || !state.current)) return;
    if (stop) setStopping(true); else setPending(true);
    const request = { serial: ++serial.current, stop, previousId: state?.current?.id ?? null, selection: JSON.stringify(selection), observed: false };
    outstanding.current = request;
    setError('');
    try {
      const prepared = stop ? null : callbacks.current.prepare ? await callbacks.current.prepare() : selection;
      if (!stop && !prepared) return;
      if (prepared) request.selection = JSON.stringify(prepared);
      await callbacks.current.action(stop ? 'stop' : 'start', stop ? { testId: state!.current!.id } : prepared!);
    }
    catch (reason) {
      if (serial.current === request.serial && !request.observed) {
        const message = reason instanceof Error ? reason.message : 'テスト送信の結果を確認できません。'; setError(message); callbacks.current.notice(message, true);
      }
    }
    finally {
      if (serial.current === request.serial) { outstanding.current = null; if (stop) setStopping(false); else setPending(false); }
    }
  };
  const targetCurrent = state?.current && selection && JSON.stringify(state.current.target) === JSON.stringify(selection.target) && state.current.inputUuid === selection.inputUuid ? state.current : null;
  const active = Boolean(state?.busy && state.current);
  const message = error || (targetCurrent && (targetCurrent.phase !== 'complete' || targetCurrent.needsAttention) ? targetCurrent.message : '')
    || (active && !targetCurrent ? `${state!.current!.title}のテストを実行中です。「テスト終了」で停止できます。` : '') || eligibility?.message
    || (!selection ? '追加後に表示テストを使えます。' : !eligibility && !state?.busy ? 'テスト可否を確認しています。' : '実際の表示はOBSで確認してください。');
  return <section className="obs-test-controls" aria-label={registrationAction ? 'OBS登録・表示テストの操作' : 'OBS表示テスト'}>
    <div className={registrationAction ? 'obs-registration-actions obs-test-buttons' : 'obs-test-buttons'}>
      {registrationAction}
      <button type="button" className="secondary" data-action="test" aria-describedby={`${id}-status`}
        aria-busy={pending || stopping} aria-disabled={active ? stopping || !action : pending || blocked || !eligibility?.available || Boolean(state?.busy) || !action}
        onClick={() => void submit(active)}>{stopping ? '終了中…' : active ? 'テスト終了' : pending ? '準備中…' : '表示テスト（5秒）'}</button>
    </div>
    <div id={`${id}-status`} className="obs-test-status" role="status" tabIndex={0} aria-label="OBS表示テストの状態">
      {message}
    </div>
  </section>;
}
