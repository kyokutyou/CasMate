import { useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes } from 'react';
import QRCode from 'qrcode';
import { defaultPollAppearance, defaultPollDraft, validPollAppearance, validPollDraft, type PollAppearance, type PollDraft, type PollManagementSnapshot } from '../../shared/listener-poll';
import { ManagementNavigation } from '../management-navigation';
import { SettingsCard } from './SettingsCard';
import type { ObsSourceRegistrationEntry } from './ObsSourceRegistrationDialog';
import { PollDisplay } from '../poll/PollDisplay';
import './listener-poll-panel.css';

export interface ListenerPollPanelProps {
  request(action?: string, body?: unknown): Promise<PollManagementSnapshot>;
  baseUrl: string; onNotice(message: string, tone: 'success' | 'error'): void;
  onRegisterSource(request: ObsSourceRegistrationEntry): void;
}
type ErrorOwner = 'draft' | 'appearance' | 'action' | 'load' | 'copy';
const publicationLabels = { stopping: '公開を停止中', off: '公開停止中', starting: '公開を準備中', online: '公開中', reconnecting: '再接続中', error: '公開に要確認' };
const reasons = { manual: '手動締切', deadline: '時間で締切', publicationStopped: '公開停止', interrupted: 'アプリ終了・中断' };
export function ListenerPollPanel({ request, baseUrl, onNotice, onRegisterSource }: ListenerPollPanelProps) {
  const navigation = useContext(ManagementNavigation), active = !navigation || navigation.editor === 'listenerPoll';
  const [view, setView] = useState<PollManagementSnapshot | null>(null);
  const [draft, setDraft] = useState<PollDraft>(() => structuredClone(defaultPollDraft));
  const [appearance, setAppearance] = useState<PollAppearance>({ ...defaultPollAppearance });
  const [draftVersion, setDraftVersion] = useState(0), [appearanceVersion, setAppearanceVersion] = useState(0);
  const [busy, setBusy] = useState(false), [errors, setErrors] = useState<Partial<Record<ErrorOwner, string>>>({});
  const [qr, setQr] = useState('');
  const draftDirty = useRef(false), appearanceDirty = useRef(false), draftAttempt = useRef(0), appearanceAttempt = useRef(0);
  const pending = useRef(false), sequence = useRef(0), mounted = useRef(true), currentView = useRef(view), notice = useRef(onNotice);
  const [draftUnsaved, setDraftUnsaved] = useState(false), [appearanceUnsaved, setAppearanceUnsaved] = useState(false);
  useEffect(() => { notice.current = onNotice; }, [onNotice]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const apply = useCallback((next: PollManagementSnapshot) => {
    if (!mounted.current) return;
    if (currentView.current?.instance === next.instance && currentView.current.revision > next.revision) return;
    currentView.current = next; setView(next);
    if (!draftDirty.current) setDraft(next.draft);
    if (!appearanceDirty.current) setAppearance(next.appearance);
  }, []);
  useEffect(() => {
    if (!active) return;
    let cancelled = false, timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      if (!pending.current) {
        const id = ++sequence.current;
        try { const next = await request(); if (!cancelled && id === sequence.current) { apply(next); setErrors(old => ({ ...old, load: undefined })); } }
        catch { if (!cancelled && id === sequence.current) setErrors(old => ({ ...old, load: '投票の状態を取得できません。再接続しています。' })); }
      }
      if (!cancelled) timer = setTimeout(() => { void load(); }, 1000);
    };
    void load(); return () => { cancelled = true; clearTimeout(timer); };
  }, [active, request, apply]);
  const run = useCallback(async (action: string, body?: unknown, owner: ErrorOwner = 'action', success?: string): Promise<PollManagementSnapshot | null> => {
    if (pending.current) return null;
    pending.current = true; ++sequence.current; setBusy(true);
    try {
      const next = await request(action, body); apply(next);
      if (mounted.current) { setErrors(old => ({ ...old, [owner]: undefined })); if (success) notice.current(success, 'success'); }
      return next;
    } catch (error) {
      const message = error instanceof Error ? error.message : '操作を完了できませんでした。';
      if (mounted.current) { setErrors(old => ({ ...old, [owner]: message })); notice.current(message, 'error'); }
      return null;
    } finally { pending.current = false; if (mounted.current) setBusy(false); }
  }, [request, apply]);
  const editDraft = (value: PollDraft) => { if (pending.current) return; draftDirty.current = true; setDraftUnsaved(true); setDraft(value); setDraftVersion(v => v + 1); };
  const editAppearance = (value: PollAppearance) => { if (pending.current) return; appearanceDirty.current = true; setAppearanceUnsaved(true); setAppearance(value); setAppearanceVersion(v => v + 1); };
  useEffect(() => {
    if (!draftDirty.current || busy || !view?.available || draftAttempt.current === draftVersion) return;
    const timer = setTimeout(() => {
      draftAttempt.current = draftVersion;
      if (!validPollDraft(draft)) { setErrors(old => ({ ...old, draft: 'お題は200文字、選択肢は各100文字、制限時間は1〜1440分の整数で入力してください。' })); return; }
      void run('draft', draft, 'draft').then(next => { if (next) { draftDirty.current = false; setDraftUnsaved(false); } });
    }, 500);
    return () => clearTimeout(timer);
  }, [draft, draftVersion, busy, view?.available, run]);
  useEffect(() => {
    if (!appearanceDirty.current || busy || !view?.available || appearanceAttempt.current === appearanceVersion) return;
    const timer = setTimeout(() => {
      appearanceAttempt.current = appearanceVersion;
      if (!validPollAppearance(appearance)) { setErrors(old => ({ ...old, appearance: '文字サイズは12〜100、色は6桁のカラーコードで入力してください。' })); return; }
      void run('appearance', appearance, 'appearance').then(next => { if (next) { appearanceDirty.current = false; setAppearanceUnsaved(false); } });
    }, 500);
    return () => clearTimeout(timer);
  }, [appearance, appearanceVersion, busy, view?.available, run]);
  const url = view?.publication.status === 'online' ? view.publication.url : null;
  useEffect(() => {
    let cancelled = false; setQr('');
    if (url) void QRCode.toDataURL(url, { width: 180, margin: 2, errorCorrectionLevel: 'M' }).then(image => { if (!cancelled) setQr(image); }).catch(() => { if (!cancelled) setErrors(old => ({ ...old, copy: 'QRを作成できませんでした。URLを選択してコピーしてください。' })); });
    return () => { cancelled = true; };
  }, [url]);
  const copy = async (value: string) => {
    if (pending.current) return; pending.current = true; setBusy(true);
    try { await navigator.clipboard.writeText(value); setErrors(old => ({ ...old, copy: undefined })); notice.current('URLをコピーしました。', 'success'); }
    catch { const message = 'コピーできませんでした。表示したURLを選択してコピーしてください。'; setErrors(old => ({ ...old, copy: message })); notice.current(message, 'error'); }
    finally { pending.current = false; setBusy(false); }
  };
  const duplicate = async (id: string) => {
    if (draftDirty.current && !window.confirm('編集中の下書きを、選択した投票で置き換えますか？')) return;
    const next = await run('duplicate', { id }, 'action', '下書きに複製しました。');
    if (next) { draftDirty.current = false; setDraftUnsaved(false); draftAttempt.current = draftVersion; setDraft(next.draft); setErrors(old => ({ ...old, draft: undefined })); }
  };
  const warning = Object.values(errors).find(Boolean) || view?.error || (view?.publication.status === 'error' ? view.publication.message : undefined);
  const disabled = busy || !view?.available;
  const current = view?.current;
  const open = current?.closedAt === null;
  return <SettingsCard cardId="listenerPoll" title="リスナー投票" eyebrow="LISTENER POLL" className="listener-poll-panel" navigationWarning={warning}>
    <section className="poll-admin-section"><h3>投票ページの公開</h3>
      <p className="muted">公開中はPCとアプリの起動が必要です。投票内容はsrv.usを経由します。機密情報を入力しないでください。</p>
      <div className="poll-publication-grid"><div><div className="button-row"><PollButton type="button" disabled={disabled || !['off', 'error'].includes(view?.publication.status ?? 'off')} aria-busy={busy} onClick={() => void run('publish', undefined, 'action', '投票ページの公開準備を開始しました。')}>公開を開始</PollButton><PollButton type="button" className="secondary" disabled={busy || !view || view.publication.status === 'off'} onClick={() => void run('unpublish', undefined, 'action', '投票ページを停止しました。')}>公開を停止</PollButton></div>
        <p className="poll-fixed-status" role="status" tabIndex={view?.publication.message ? 0 : -1}>{view ? publicationLabels[view.publication.status] : '状態を取得中'}{view?.publication.message ? `。${view.publication.message}` : ''}</p>
        <label>リスナー用URL<input readOnly value={url ?? ''} aria-label="リスナー用URL" placeholder="公開の到達確認後に表示"/></label><PollButton type="button" className="secondary" disabled={!url || busy} onClick={() => url && void copy(url)}>投票URLをコピー</PollButton>
      </div><div className="poll-qr">{qr ? <img src={qr} alt="リスナー用投票ページのQRコード"/> : <span>公開後にQRを表示</span>}</div></div>
    </section>
    <section className="poll-admin-section"><h3>{open ? '次の投票の下書き' : '投票を作成'}</h3>
      <fieldset disabled={!view?.available} aria-disabled={busy} onBeforeInput={event => { if (pending.current) event.preventDefault(); }}><label>お題<textarea rows={2} maxLength={200} value={draft.question} onChange={event => editDraft({ ...draft, question: event.target.value })}/></label>
        <div className="poll-draft-options">{draft.options.map((option, index) => <div key={index}><label>選択肢 {index + 1}<input value={option} maxLength={100} onChange={event => editDraft({ ...draft, options: draft.options.map((x, i) => i === index ? event.target.value : x) })}/></label><PollButton type="button" className="secondary" disabled={disabled || draft.options.length <= 2} aria-label={`選択肢 ${index + 1}を削除`} onClick={() => editDraft({ ...draft, options: draft.options.filter((_, i) => i !== index) })}>削除</PollButton></div>)}</div>
        <PollButton type="button" className="secondary" disabled={disabled || draft.options.length >= 10} onClick={() => editDraft({ ...draft, options: [...draft.options, ''] })}>選択肢を追加</PollButton>
        <label className="poll-duration">制限時間（分・空欄なら手動締切）<input type="number" min={1} max={1440} step={1} value={draft.durationMinutes ?? ''} onChange={event => editDraft({ ...draft, durationMinutes: event.target.value === '' ? null : Number(event.target.value) })}/></label>
      </fieldset>
      <div className="poll-save-slot" role="status" tabIndex={errors.draft ? 0 : -1}><span>{errors.draft ?? (draftUnsaved ? busy ? '下書きを保存中…' : '下書きは未保存です。' : '下書きは自動保存されます。')}</span><PollButton type="button" className="secondary" disabled={!errors.draft || busy} onClick={() => { draftAttempt.current = -1; setDraftVersion(v => v + 1); }}>再保存</PollButton></div>
      <div className="button-row"><PollButton type="button" disabled={disabled || open || draftUnsaved || !validPollDraft(draft, true) || view?.publication.status !== 'online'} onClick={() => void run('start', undefined, 'action', '投票を開始しました。')}>投票を開始</PollButton><PollButton type="button" className="secondary" disabled={disabled || !open} onClick={() => void run('close', undefined, 'action', '投票を締め切りました。')}>締め切る</PollButton></div>
      <p className="muted">投票ページを公開してから開始します。受付開始後のお題と選択肢は固定されます。</p>
    </section>
    <section className="poll-admin-section"><h3>現在の投票</h3>
      <label className="poll-reveal"><PollCheckbox type="checkbox" disabled={disabled || !current} checked={current?.resultsVisible ?? false} onChange={event => void run('reveal', { visible: event.target.checked }, 'action', event.target.checked ? '結果を公開しました。' : '結果を非公開にしました。')}/>投票ページとOBSに結果を公開</label>
      <p className="muted">アプリでは常に集計を表示します。締切だけでは結果を公開しません。</p>
      {current ? <><PollDisplay poll={current}/><p className="muted">{current.endsAt ? `締切予定：${new Date(current.endsAt).toLocaleString('ja-JP')}` : '手動で締切'}{current.closeReason ? ` · ${reasons[current.closeReason]}` : ''}</p><PollButton type="button" className="secondary" disabled={disabled} onClick={() => void duplicate(current.id)}>下書きに複製</PollButton></> : <p className="muted">まだ投票はありません。</p>}
    </section>
    <section className="poll-admin-section"><h3>投票履歴</h3>{view?.history.length ? view.history.map(poll => <details key={poll.id} className="poll-history"><summary>{poll.question} · {new Date(poll.closedAt!).toLocaleString('ja-JP')}</summary><PollDisplay poll={poll}/><p className="muted">{poll.closeReason ? reasons[poll.closeReason] : ''}</p><div className="button-row"><PollButton type="button" className="secondary" disabled={disabled} onClick={() => void duplicate(poll.id)}>下書きに複製</PollButton><PollButton type="button" className="secondary" disabled={disabled} onClick={() => { if (window.confirm(`「${poll.question}」の履歴を削除しますか？`)) void run('delete', { id: poll.id }, 'action', '投票履歴を削除しました。'); }}>履歴を削除</PollButton></div></details>) : <p className="muted">終了した投票がここに残ります。</p>}</section>
    <section className="poll-admin-section"><h3>OBS表示</h3><fieldset disabled={!view?.available} aria-disabled={busy} className="poll-appearance" onBeforeInput={event => { if (pending.current) event.preventDefault(); }}><label>文字サイズ（px）<input type="number" min={12} max={100} value={appearance.fontSize} onChange={event => editAppearance({ ...appearance, fontSize: Number(event.target.value) })}/></label><label>文字色<input type="color" value={appearance.color} onChange={event => editAppearance({ ...appearance, color: event.target.value })}/></label><label>背景色<input type="color" value={appearance.background} onChange={event => editAppearance({ ...appearance, background: event.target.value })}/></label></fieldset>
      <div className="poll-save-slot" role="status" tabIndex={errors.appearance ? 0 : -1}><span>{errors.appearance ?? (appearanceUnsaved ? busy ? '外観を保存中…' : '外観は未保存です。' : '外観は自動保存されます。')}</span><PollButton type="button" className="secondary" disabled={!errors.appearance || busy} onClick={() => { appearanceAttempt.current = -1; setAppearanceVersion(v => v + 1); }}>再保存</PollButton></div>
      <label>OBS用URL<input readOnly value={`${baseUrl}/overlay/poll`}/></label><div className="button-row"><PollButton type="button" className="secondary" disabled={busy} onClick={event => onRegisterSource({ target: { kind: 'overlay', overlay: 'poll' }, title: 'リスナー投票', entry: event.currentTarget })}>OBSに追加</PollButton><PollButton type="button" className="secondary" disabled={busy} onClick={() => void copy(`${baseUrl}/overlay/poll`)}>OBS用URLをコピー</PollButton></div>
      <p className="muted">OBSには現在のお題と、公開を許可した結果だけを表示します。</p>
    </section>
    <p className="poll-fixed-status poll-operation-status" role="status" tabIndex={warning ? 0 : -1}>{warning ?? (busy ? '処理しています…' : '')}</p>
  </SettingsCard>;
}

// Keep the active control focusable while an asynchronous operation disables its action.
function PollButton({ disabled, onClick, onFocus, onBlur, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const [focused, setFocused] = useState(false);
  return <button {...props} disabled={disabled && !focused} aria-disabled={Boolean(disabled)}
    onFocus={event => { setFocused(true); onFocus?.(event); }} onBlur={event => { setFocused(false); onBlur?.(event); }}
    onClick={event => { if (disabled) { event.preventDefault(); return; } setFocused(document.activeElement === event.currentTarget); onClick?.(event); }}/>;
}
function PollCheckbox({ disabled, onChange, onFocus, onBlur, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const [focused, setFocused] = useState(false);
  return <input {...props} disabled={disabled && !focused} aria-disabled={Boolean(disabled)}
    onFocus={event => { setFocused(true); onFocus?.(event); }} onBlur={event => { setFocused(false); onBlur?.(event); }}
    onChange={event => { if (disabled) { event.preventDefault(); return; } setFocused(document.activeElement === event.currentTarget); onChange?.(event); }}/>;
}
