import { CompactFeedback } from './CompactFeedback';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes } from 'react';
import type { ShitarabaNextThreadSettings, ShitarabaNextThreadState } from '../../shared/types';
import { SettingsCard } from './SettingsCard';
import { SlimSwitch } from './SlimSwitch';
import './next-thread-panel.css';

interface Props {
  settings: ShitarabaNextThreadSettings;
  state: ShitarabaNextThreadState;
  threadUrl: string;
  synchronized: boolean;
  saveError?: string;
  onChange(value: ShitarabaNextThreadSettings): void;
  onSave(value: ShitarabaNextThreadSettings): Promise<unknown>;
  onCreate(): Promise<unknown>;
  onResolve(value: { outcome: 'created'; threadUrl: string } | { outcome: 'notCreated' }): Promise<unknown>;
  onSuccess(message: string): void;
}

const statusLabels: Record<ShitarabaNextThreadState['status'], string> = {
  disabled: '無効', manualReady: '手動作成できます', monitoring: '作成待ち', inputRequired: '入力確認が必要',
  creating: '作成中', created: '作成済み', uncertain: '結果不明', failed: '作成失敗', browserRequired: 'ブラウザ作成が必要',
};
const fields = ['createAtResponseNumber', 'switchAtResponseNumber', 'manualTitle', 'manualBody', 'announcementTemplate', 'authorName', 'email'] as const;
type Field = typeof fields[number];
type Form = Record<Field, string>;
const validNumber = (text: string) => /^\d+$/.test(text) && Number(text) >= 1 && Number(text) <= 10000;
function errorsFor(form: Form): Partial<Record<Field, string>> {
  const errors: Partial<Record<Field, string>> = {};
  for (const key of ['createAtResponseNumber', 'switchAtResponseNumber'] as const) {
    if (!validNumber(form[key])) errors[key] = '1〜10000の整数を入力してください。';
  }
  if (!errors.createAtResponseNumber && !errors.switchAtResponseNumber && Number(form.createAtResponseNumber) > Number(form.switchAtResponseNumber)) {
    errors.createAtResponseNumber = '作成開始レス番号は切替レス番号以下にしてください。';
  }
  if (form.announcementTemplate.split('{url}').length !== 2) errors.announcementTemplate = '案内文に {url} をちょうど1回含めてください。';
  if (form.authorName.includes('#')) errors.authorName = '投稿者名に # は使用できません。';
  for (const key of fields) {
    if (form[key].length > (key === 'manualBody' ? 1_000_000 : 100_000)) errors[key] = '入力が長すぎます。短くしてください。';
  }
  return errors;
}
function verifiedThread(raw: string) {
  try {
    const url = new URL(raw.trim());
    if (url.username || url.password) return null;
    if (url.origin === 'https://jbbs.shitaraba.net') {
      const match = url.pathname.match(/^\/bbs\/read\.cgi\/([a-zA-Z0-9_-]+)\/(\d+)\/(\d+)(?:\/.*)?$/);
      if (!match) return null;
      return { board: `https://jbbs.shitaraba.net/${match[1]}/${match[2]}/`, key: `shitaraba/${match[1]}/${match[2]}/${match[3]}`,
        url: `https://jbbs.shitaraba.net/bbs/read.cgi/${match[1]}/${match[2]}/${match[3]}/` };
    }
    if (url.origin === 'https://bbs.jpnkn.com') {
      const match = url.pathname.match(/^\/test\/read\.cgi\/([a-zA-Z0-9_-]+)\/([1-9]\d*)(?:\/(?:l[1-9]\d*|\d+(?:-\d*)?)?)?\/?$/);
      if (!match) return null;
      return { board: `https://bbs.jpnkn.com/${match[1]}/`, key: `jpnkn/${match[1]}/${match[2]}`,
        url: `https://bbs.jpnkn.com/test/read.cgi/${match[1]}/${match[2]}/` };
    }
    return null;
  } catch { return null; }
}

// A button that becomes unavailable asynchronously must keep the active keyboard focus.
function ActionButton({ disabled, onClick, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const [focused, setFocused] = useState(false);
  return <button {...props} type="button" disabled={disabled && !focused} aria-disabled={Boolean(disabled)}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onClick={event => { if (!disabled) onClick?.(event); }} />;
}

export function NextThreadPanel({ settings, state, threadUrl, synchronized, saveError, onChange, onSave, onCreate, onResolve, onSuccess }: Props) {
  const id = useId();
  const focusedInput = useRef<{ element: HTMLElement; fallback: HTMLElement | null } | null>(null);
  useLayoutEffect(() => {
    const focused = focusedInput.current;
    if (focused && !focused.element.isConnected) {
      if (document.activeElement === document.body) focused.fallback?.focus({ preventScroll: true });
      focusedInput.current = null;
    }
  });
  const currentThread = verifiedThread(threadUrl);
  const currentKey = currentThread?.key ?? threadUrl.trim();
  const [edits, setEdits] = useState<Partial<Record<Field, { base: string; text: string }>>>({});
  useEffect(() => {
    setEdits(previous => {
      const obsolete = fields.filter(key => previous[key] && previous[key]!.base !== String(settings[key]));
      if (!obsolete.length) return previous;
      const next = { ...previous };for (const key of obsolete) delete next[key];return next;
    });
  }, [settings]);
  const [operation, setOperation] = useState<string | null>(null);
  const pending = useRef(false);
  const [operationFailure, setOperationFailure] = useState<{ key: string; message: string } | null>(null);
  const operationContext = useRef({});
  useLayoutEffect(() => { operationContext.current = {};setOperationFailure(null); }, [currentKey]);
  const operationError = operationFailure?.key === currentKey ? operationFailure.message : '';
  const [resolvedUrl, setResolvedUrl] = useState('');
  // Retain local unfinished input while valid values flow through the existing autosave draft.
  const form = Object.fromEntries(fields.map(key => [key, edits[key]?.base === String(settings[key]) ? edits[key]!.text : String(settings[key])])) as Form;
  const inputErrors = errorsFor(form);
  const hasErrors = Object.keys(inputErrors).length > 0;
  const nextThread = state.nextThreadUrl ? verifiedThread(state.nextThreadUrl) : null;
  const resolvedThread = verifiedThread(resolvedUrl);
  const validResolved = Boolean(currentThread && resolvedThread && currentThread.board === resolvedThread.board && currentThread.key !== resolvedThread.key);
  const stateWarning = state.message || (['uncertain', 'failed', 'inputRequired', 'browserRequired'].includes(state.status) ? statusLabels[state.status] : '');
  const warning = [operationError, stateWarning, ...Object.values(inputErrors)].filter(Boolean).join(' ');
  const ready = synchronized && !saveError && !hasErrors && Boolean(currentThread && state.plannedTitle?.trim() && state.plannedBody?.trim()) &&
    !['disabled', 'creating', 'created', 'uncertain', 'browserRequired'].includes(state.status);
  const canRegister = state.status === 'uncertain' || state.status === 'browserRequired';
  const change = (key: Field, text: string) => {
    setOperationFailure(null);
    setEdits(previous => ({ ...previous, [key]: { base: String(settings[key]), text } }));
    const next = { ...form, [key]: text };
    if (!Object.keys(errorsFor(next)).length) onChange({ ...settings, ...next,
      createAtResponseNumber: Number(next.createAtResponseNumber), switchAtResponseNumber: Number(next.switchAtResponseNumber) });
  };
  const run = async (name: string, action: () => Promise<unknown>, success?: string) => {
    if (pending.current) return;
    const context = operationContext.current;
    pending.current = true; setOperation(name); setOperationFailure(null);
    try { await action(); if (success) onSuccess(success); }
    catch (error) {
      // Autosave owns save failures and clears them when a later save succeeds.
      if (name !== 'save' && context === operationContext.current) setOperationFailure({ key: currentKey, message: error instanceof Error ? error.message : '次スレッドの操作に失敗しました。' });
    }
    finally { pending.current = false; setOperation(null); }
  };
  const save = (value: ShitarabaNextThreadSettings) => run('save', () => onSave(value));
  const help = (key: Field, text: string) => <CompactFeedback reserve={[text, '入力が長すぎます。短くしてください。', ...(key === 'createAtResponseNumber' ? ['作成開始レス番号は切替レス番号以下にしてください。'] : []), ...(key === 'announcementTemplate' ? ['案内文に {url} をちょうど1回含めてください。'] : []), ...(key === 'authorName' ? ['投稿者名に # は使用できません。'] : []), ...(['createAtResponseNumber', 'switchAtResponseNumber'].includes(key) ? ['1〜10000の整数を入力してください。'] : [])]} id={`${id}-${key}-help`} className={`next-input-help${inputErrors[key] ? ' field-error' : ''}`}>{inputErrors[key] || text}</CompactFeedback>;
  const number = (key: 'createAtResponseNumber' | 'switchAtResponseNumber', label: string) => <div className="next-field">
    <label htmlFor={`${id}-${key}`}>{label}</label><div className="next-number"><input id={`${id}-${key}`} type="number" min={1} max={10000} step={1} value={form[key]}
      aria-invalid={Boolean(inputErrors[key])} aria-describedby={`${id}-${key}-help`} onChange={event => change(key, event.target.value)} /><span>番</span></div>
    {help(key, '1〜10000の整数')}</div>;
  const textInput = (key: Field, label: string, description: string, rows?: number) => <div className="next-field"><label htmlFor={`${id}-${key}`}>{label}</label>
    {rows ? <textarea id={`${id}-${key}`} rows={rows} maxLength={key === 'manualBody' ? 1_000_000 : 100_000} value={form[key]} aria-invalid={Boolean(inputErrors[key])} aria-describedby={`${id}-${key}-help`} onChange={event => change(key, event.target.value)} />
      : <input id={`${id}-${key}`} maxLength={100_000} value={form[key]} aria-invalid={Boolean(inputErrors[key])} aria-describedby={`${id}-${key}-help`} onChange={event => change(key, event.target.value)} />}
    {help(key, description)}</div>;
  const mode = (key: 'titleMode' | 'bodyMode', label: string, auto: string) => <div className="next-field">
    <label htmlFor={`${id}-${key}`}>{label}</label><select id={`${id}-${key}`} value={settings[key]} aria-disabled={Boolean(operation)}
      onChange={event => { const value = event.target.value; if (!pending.current && (value === 'auto' || value === 'manual')) void save({ ...settings, [key]: value }); }}>
      <option value="auto">{auto}</option><option value="manual">手動で入力</option>
    </select></div>;
  const open = (url: string) => {
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    // noopener may return null even when the browser opens the target successfully.
    if (opened) opened.opener = null;
  };
  const statusMessage = operationError || saveError || Object.values(inputErrors)[0] ||
    (!synchronized ? '設定または接続先の保存・反映を待っています。完了後に作成予定内容を確認してください。' : '') ||
    (state.status === 'uncertain' ? state.message || '作成結果を確認できません。' : state.message) ||
    (!currentThread ? 'コメント取得の設定で、有効な現行スレッドURLを指定してください。' :
        state.status === 'creating' || operation === 'create' ? '同名タイトルを確認して作成しています。' :
          state.status === 'created' ? '次スレッドは作成済みです。切替レス番号に到達すると接続先を切り替えます。' :
            !state.plannedTitle || !state.plannedBody ? 'タイトル・本文の設定を確認してください。' : '作成前に同名タイトルを確認します。');
  return <SettingsCard cardId="nextThread" title="掲示板の次スレッド作成" eyebrow="BOARD NEXT THREAD" className="next-thread-panel"
    saveError={saveError} navigationWarning={warning}>
    <section className="next-live" aria-label="現行スレッドと稼働状態">
      <div className="next-live-summary">
        <div className="next-status-slot"><span className="next-status" role="status" tabIndex={0}>{statusLabels[state.status]}</span></div>
        <div className="next-live-metric"><small>最大レス番号</small><strong>{state.maxResponseNumber ?? '接続を確認'}{state.maxResponseNumber !== null && <span>番</span>}</strong></div>
        <div className="next-live-metric"><small>作成開始まで</small><strong>{!settings.enabled ? '自動作成はオフ' : state.remainingResponses === null ? '接続と設定を確認' : `残り ${state.remainingResponses} レス`}</strong></div>
      </div>
      <div className="next-current"><small>現行スレッド</small><div className="next-current-url" tabIndex={0}>{threadUrl || '未設定'}</div></div>
    </section>
    <div className="next-columns">
    <section className="next-box next-stack next-settings" aria-labelledby={`${id}-settings`}
      onFocusCapture={event => {
        const element = event.target;
        const suffix = element.id.slice(id.length + 1);
        const fallback = suffix === 'manualTitle' ? document.getElementById(`${id}-titleMode`) :
          suffix === 'manualBody' ? document.getElementById(`${id}-bodyMode`) :
            suffix === 'announcementTemplate' ? element.closest('.next-announcement')?.querySelector<HTMLElement>('[role=switch]') : null;
        focusedInput.current = fallback ? { element, fallback } : null;
      }} onBlurCapture={event => { if (event.relatedTarget || event.target.isConnected) focusedInput.current = null; }}><h3 id={`${id}-settings`}>作成の設定</h3>
      <div className="next-between next-auto"><strong>自動作成</strong>
        <SlimSwitch label="次スレッド自動作成" checked={settings.enabled} disabled={Boolean(operation) || (!settings.enabled && hasErrors)} keepFocus onChange={enabled => save({ ...settings, enabled })} /></div>
      <div className="next-grid">{number('createAtResponseNumber', '作成するレス番号')}{number('switchAtResponseNumber', '切り替えるレス番号')}</div>
      <small>作成開始の番号は、切替の番号以下にしてください</small>
      {mode('titleMode', 'タイトル', '末尾の番号を +1')}
      {settings.titleMode === 'manual' && textInput('manualTitle', '手動タイトル', '空欄では作成できません。次回も同じ内容を使います。')}
      {mode('bodyMode', '本文', '1レス目を引き継ぐ')}
      {settings.bodyMode === 'manual' && textInput('manualBody', '手動本文', '空欄では作成できません。次回も同じ内容を使います。', 5)}
      <details className="next-details"><summary><span>投稿者名・E-mail</span><small>任意・作成と案内に共通</small></summary><div className="next-grid">
        {textInput('authorName', '投稿者名', '空欄なら掲示板の既定名。# は使えません。')}{textInput('email', 'E-mail', '空欄可。「sage」なども入力できます。')}</div></details>
      <details className="next-details next-announcement" open><summary>作成後の案内</summary><div className="next-stack"><div className="next-between"><strong>現行スレッドにURLを投稿</strong>
        <SlimSwitch label="現行スレッドにURLを投稿" checked={settings.announceCurrentThread} disabled={Boolean(operation)} keepFocus onChange={announceCurrentThread => save({ ...settings, announceCurrentThread })} /></div>
        {settings.announceCurrentThread && <><small>作成成功から{currentThread?.key.startsWith('jpnkn/') ? 30 : 5}秒後に1回投稿します。</small>
          {textInput('announcementTemplate', '案内文', '{url} を1回含めてください。', 3)}</>}
      </div></details>
    </section>
    <section className="next-box next-stack next-planned" aria-labelledby={`${id}-execution`}><h3 id={`${id}-execution`}>作成予定</h3>
      <div className="next-preview"><label htmlFor={`${id}-planned-title`}>作成予定タイトル</label><textarea id={`${id}-planned-title`} readOnly value={state.plannedTitle ?? ''} placeholder="スレッド接続とタイトル設定を確認してください" />
        <label htmlFor={`${id}-planned-body`}>作成予定本文</label><textarea id={`${id}-planned-body`} className="next-planned-body" readOnly value={state.plannedBody ?? ''} placeholder="スレッド接続と本文設定を確認してください" /></div>
      <div className="next-execution"><div className="next-between"><small>自動作成がオフでも使えます。</small>
        <ActionButton className="next-create" disabled={Boolean(operation) || !ready} aria-busy={operation === 'create'}
          aria-label="今すぐ作成" aria-describedby={`${id}-state`} onClick={() => { if (ready) void run('create', onCreate, '次スレッドを作成しました。'); }}>{operation === 'create' || state.status === 'creating' ? '作成中…' : '今すぐ作成'}</ActionButton></div>
        <p id={`${id}-state`} className="next-state-message" role="status" tabIndex={0}>{statusMessage}{canRegister && ' 「ブラウザで作成・結果を確認」を開いてください。'}</p>
        <div className="next-url"><label htmlFor={`${id}-next-url`}>次スレッドURL</label><input id={`${id}-next-url`} readOnly value={nextThread?.url ?? ''} placeholder="作成後に次スレッドURLを表示" />
          <div className="next-actions"><ActionButton className="secondary" disabled={!nextThread || Boolean(operation)} onClick={() => { if (nextThread) void run('copy', () => navigator.clipboard.writeText(nextThread.url), '次スレッドURLをコピーしました。'); }}>URLをコピー</ActionButton>
            <ActionButton className="secondary" disabled={!nextThread} onClick={() => { if (nextThread) open(nextThread.url); }}>ブラウザで開く</ActionButton></div></div>
        <details className="next-details next-recovery"><summary>ブラウザで作成・結果を確認</summary><div className="next-stack">
          <p>認証が必要なときや、作成結果が不明なときに使います。掲示板で確認し、作成済みならURLを登録してください。</p>
          <ActionButton className="secondary" disabled={!currentThread} onClick={() => { if (currentThread) open(currentThread.board); }}>現行掲示板をブラウザで開く</ActionButton>
          <label htmlFor={`${id}-resolved`}>作成済み次スレッドURL</label><input id={`${id}-resolved`} value={resolvedUrl} onChange={event => setResolvedUrl(event.target.value)} aria-describedby={`${id}-resolved-help`} aria-invalid={Boolean(resolvedUrl) && !validResolved} />
          <CompactFeedback id={`${id}-resolved-help`} className="next-input-help" reserve={['同じサービス・掲示板の、現行スレッド以外のHTTPS URLを指定してください。', '結果不明またはブラウザ作成が必要な場合に、作成済みURLを登録できます。']}>{resolvedUrl && !validResolved ? '同じサービス・掲示板の、現行スレッド以外のHTTPS URLを指定してください。' : '結果不明またはブラウザ作成が必要な場合に、作成済みURLを登録できます。'}</CompactFeedback>
          <div className="next-actions"><ActionButton disabled={!synchronized || Boolean(saveError) || !canRegister || !validResolved || Boolean(operation)} onClick={() => { if (synchronized && !saveError && canRegister && validResolved) void run('resolve', () => onResolve({ outcome: 'created', threadUrl: resolvedThread!.url }), '作成済みURLを登録しました。'); }}>作成済みURLを登録</ActionButton>
            <ActionButton className="secondary" disabled={!synchronized || Boolean(saveError) || state.status !== 'uncertain' || Boolean(operation)} onClick={() => { if (synchronized && !saveError && state.status === 'uncertain') void run('resolve', () => onResolve({ outcome: 'notCreated' }), '未作成を確認しました。'); }}>未作成を確認</ActionButton></div>
          <p>認証のためブラウザで作成した場合、アプリからのURL案内は省略します。未作成の確認だけでは再送しません。</p>
        </div></details>
      </div>
    </section>
    </div>
  </SettingsCard>;
}
