// Throwaway: three different rule-editing flows inside the existing settings shell.
// ?variant=A|B|C. All mutations are local mocks; never call a production API.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ManagementEditorHeading } from '../shared/ManagementEditorHeading';
import { ManagementWarnings } from '../../src/renderer/components/ManagementWarnings';
import { SlimSwitch } from '../../src/renderer/components/SlimSwitch';
import type { TextEffectRule } from '../../src/shared/types';
import { errorsFor, freshRule, initialDraft, numberError, ruleErrors, summary, toSettings, type Draft, type RuleDraft } from './model';

const variants = ['A', 'B', 'C'] as const;
type Variant = typeof variants[number];
const names = { A: '一覧で調整', B: '選んで編集', C: '順番に作成' };
const readVariant = (): Variant => variants.find(value => value === new URLSearchParams(location.search).get('variant')) ?? 'A';
const intro = { heading: 'コメントの反応を、配信画面の文字演出に', body: '反応ワードに合わせて、文字や絵文字を降らせます。OBSコメント表示とは別のブラウザソースで表示されます。' };

export function Prototype() {
  const [variant, setVariant] = useState<Variant>(readVariant);
  const [draft, setDraft] = useState<Draft>(() => structuredClone(initialDraft));
  const [saved, setSaved] = useState(() => toSettings(initialDraft));
  const [selected, setSelected] = useState('grass');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [newRule, setNewRule] = useState<RuleDraft | null>(null);
  const [step, setStep] = useState(0);
  const [section, setSection] = useState('rules');
  const [page, setPage] = useState<'editor' | 'home' | 'settings'>('editor');
  const [origin, setOrigin] = useState<'home' | 'settings'>('settings');
  const [toast, setToast] = useState('');
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState(false);
  const [failMode, setFailMode] = useState(false);
  const [modeError, setModeError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [play, setPlay] = useState<{ rule: TextEffectRule; size: number; seconds: number; count: number; key: number } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scroll = useRef<HTMLDivElement>(null);
  const returnTop = useRef(0);
  const focusTarget = useRef<string | null>(null);
  const currentRule = newRule ?? draft.rules.find(rule => rule.id === selected);
  const errors = [...errorsFor(draft), ...(newRule ? Object.values(ruleErrors(newRule)).filter(Boolean) : []), ...(modeError ? [modeError] : [])];
  const warnings = [...errors.map((message, index) => ({ key: `input-${index}`, message })),
    ...(failure ? [{ key: 'save', message: '保存に失敗しました（見本）。入力値は残しています。「保存失敗を再現」をオフにし、値を変更すると再試行します。' }] : [])];

  useEffect(() => () => { clearTimeout(saveTimer.current); clearTimeout(toastTimer.current); }, []);
  useEffect(() => {
    const pop = () => setVariant(readVariant());
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || document.querySelector('dialog[open]') ||
        event.target instanceof HTMLElement && event.target.closest('input,textarea,select,[contenteditable],[role="tablist"],[role="switch"]')) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault(); switchVariant(variants[(variants.indexOf(variant) + (event.key === 'ArrowRight' ? 1 : 2)) % 3]);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [variant]);
  useLayoutEffect(() => {
    if (!focusTarget.current) return;
    document.getElementById(focusTarget.current)?.focus({ preventScroll: true });
    if (scroll.current) scroll.current.scrollTop = page === 'editor' ? 0 : returnTop.current;
    focusTarget.current = null;
  }, [page]);

  function switchVariant(value: Variant) {
    setVariant(value);
    const url = new URL(location.href); url.searchParams.set('variant', value); history.replaceState(null, '', url);
  }
  function notify(message: string) {
    clearTimeout(toastTimer.current); setToast(message);
    toastTimer.current = setTimeout(() => setToast(''), 4000);
  }
  function commit(value: Draft) {
    setSaving(false);
    if (errorsFor(value).length) return false;
    if (failMode) { setFailure(true); return false; }
    setSaved(toSettings(value)); setFailure(false); notify('設定を反映しました（見本）'); return true;
  }
  function update(next: Draft, immediate = false) {
    setDraft(next); clearTimeout(saveTimer.current);
    if (immediate) commit(next);
    else { setSaving(true); saveTimer.current = setTimeout(() => commit(next), 500); }
  }
  function editRule(next: RuleDraft, immediate = false) {
    setModeError('');
    if (newRule?.id === next.id) setNewRule(next);
    else update({ ...draft, rules: draft.rules.map(rule => rule.id === next.id ? next : rule) }, immediate);
  }
  function setMode(rule: RuleDraft, mode: RuleDraft['countMode']) {
    const next = { ...rule, countMode: mode, count: mode === 'fixed' ? '6' : '2' };
    if (rule.trigger && ruleErrors(next).trigger) { setModeError('連続数に連動するには、反応ワードを1文字にしてください。'); return; }
    editRule(next, true);
  }
  function choose(id: string) { setSelected(id); setExpanded(expanded === id ? null : id); setStep(0); }
  function beginAdd() { if (newRule || draft.rules.length >= 50) return; setNewRule(freshRule()); setSection('rules'); setStep(0); }
  function add() {
    if (!newRule || Object.values(ruleErrors(newRule)).some(Boolean) || draft.rules.length >= 50) return;
    const next = { ...draft, rules: [...draft.rules, newRule] };
    clearTimeout(saveTimer.current);
    if (commit(next)) { setDraft(next); setSelected(newRule.id); setExpanded(newRule.id); setNewRule(null); setStep(0); }
  }
  function move(rule: RuleDraft, offset: number) {
    const rules = [...draft.rules]; const index = rules.findIndex(item => item.id === rule.id);
    if (index + offset < 0 || index + offset >= rules.length) return;
    [rules[index], rules[index + offset]] = [rules[index + offset], rules[index]];
    update({ ...draft, rules }, true);
  }
  function remove() {
    const next = { ...draft, rules: draft.rules.filter(rule => rule.id !== pendingDelete) };
    clearTimeout(saveTimer.current);
    if (commit(next)) { setDraft(next); if (selected === pendingDelete) setSelected(next.rules[0]?.id ?? ''); setExpanded(null); }
    setPendingDelete(null);
  }
  function test(rule: RuleDraft) {
    const stored = saved.rules.find(item => item.id === rule.id);
    if (!stored) return;
    setPlay({ rule: stored, size: saved.fontSizePx, seconds: saved.fallDurationSeconds,
      count: Math.min(saved.maxActiveItems, stored.countMode === 'fixed' ? stored.fixedCount : stored.minimumConsecutiveCount), key: Date.now() });
    notify('見本内でテスト再生を開始しました');
  }
  function scenario(value: string) {
    clearTimeout(saveTimer.current); setSaving(false); setFailure(false); setModeError(''); setNewRule(null); setExpanded(null);
    const next = structuredClone(initialDraft);
    if (value === 'empty') next.rules = [];
    if (value === 'many') next.rules = Array.from({ length: 50 }, (_, index) => ({ ...initialDraft.rules[index % 3], id: `sample-${index}`, trigger: index % 3 === 0 ? 'w' : `反応${index + 1}` }));
    setDraft(next); setSaved(toSettings(next)); setSelected(next.rules[0]?.id ?? ''); setFailMode(value === 'failure');
  }
  function openEditor(from: 'home' | 'settings') { returnTop.current = scroll.current?.scrollTop ?? 0; setOrigin(from); focusTarget.current = 'editor-heading'; setPage('editor'); }
  function go(next: 'home' | 'settings') { returnTop.current = 0; focusTarget.current = 'te-page-title'; setPage(next); }
  function back() { focusTarget.current = 'te-entry'; setPage(origin); }

  const fields = (rule: RuleDraft, only?: number) => <RuleFields rule={rule} onChange={editRule} onMode={setMode} only={only} modeError={modeError} />;
  const order = (rule: RuleDraft) => <div className="te-order"><span>処理する順序</span>
    <button className="secondary small" disabled={draft.rules[0]?.id === rule.id} onClick={() => move(rule, -1)}>↑ 上へ</button>
    <button className="secondary small" disabled={draft.rules.at(-1)?.id === rule.id} onClick={() => move(rule, 1)}>↓ 下へ</button></div>;
  const newActions = <div className="te-row"><button className="te-primary" disabled={!newRule || Object.values(ruleErrors(newRule)).some(Boolean)} onClick={add}>追加</button>
    <button className="secondary" onClick={() => { setNewRule(null); setModeError(''); }}>キャンセル</button></div>;
  const editor = (rule: RuleDraft) => <div className="te-editor">
    <div className="te-between te-editor-title"><h3>{newRule ? '新しいルール' : 'ルールを編集'}</h3>{!newRule && <span className="te-caption">入力後に自動保存</span>}</div>
    {fields(rule)}{newRule ? <><SlimSwitch label="新しいルールの有効状態" checked={rule.enabled} onChange={enabled => editRule({ ...rule, enabled })} />{newActions}</> : order(rule)}
  </div>;
  const rowActions = (rule: RuleDraft) => <div className="te-actions">
    <button className="secondary small" aria-label={`${rule.trigger}のテスト再生`} onClick={() => test(rule)}>▷ テスト再生</button>
    <button className="te-link" aria-label={`${rule.trigger}を削除`} onClick={() => setPendingDelete(rule.id)}>削除</button></div>;
  const row = (rule: RuleDraft, index: number, compact = false) => <article className={`te-rule ${compact ? 'te-compact' : ''}`} key={rule.id}>
    <div className="te-rule-line">
      <span className="te-number">{String(index + 1).padStart(2, '0')}</span>
      <span className="te-glyph" style={{ color: /^#[0-9a-f]{8}$/i.test(rule.color) ? rule.color : '#DCE7EC' }} aria-hidden="true">{rule.displayText}</span>
      <div className="te-rule-copy"><strong>{summary(rule)}</strong><small>{rule.countMode === 'fixed' ? 'ワード一致で固定個数' : '最も長い連続数に連動'}</small></div>
      <SlimSwitch label={`${rule.trigger}ルールの有効状態`} checked={rule.enabled} onChange={enabled => editRule({ ...rule, enabled }, true)} />
    </div>
    <div className="te-between te-row-footer">{rowActions(rule)}<button className="te-link" aria-expanded={expanded === rule.id && !compact} onClick={() => choose(rule.id)}>{expanded === rule.id && !compact ? '閉じる −' : '編集 →'}</button></div>
    {!compact && expanded === rule.id && !newRule && editor(rule)}
  </article>;
  const listTitle = <div className="te-between te-section-heading"><div className="te-row"><h2>反応ルール</h2><span className="te-caption">{draft.rules.length} / 50件</span></div>
    <button className="te-primary" onClick={beginAdd} disabled={draft.rules.length >= 50 || Boolean(newRule)}>＋ ルールを追加</button></div>;
  const empty = <div className="te-empty"><span aria-hidden="true">◇</span><h3>最初の反応をつくりましょう</h3><p>「w」が続いたら「草」を降らせる、など。<br />反応ワードと表示文字を組み合わせます。</p><button className="secondary" disabled={Boolean(newRule)} onClick={beginAdd}>ルールを追加</button></div>;
  const listHint = <p className="te-list-hint">{draft.rules.length >= 50 ? '最大50件です。追加するには既存ルールを削除してください。' : '上のルールから処理します。1コメントあたり合計20個まで。'}</p>;
  const common = <CommonFields value={draft} onChange={next => update(next)} />;
  const commonDisclosure = <details className="te-common"><summary><span>全ルール共通の見た目・上限</span><small>文字サイズ・落下時間・同時表示</small></summary>{common}</details>;
  const rulePicker = <label className="te-picker">編集するルール<select value={newRule ? '__new' : selected} onChange={event => { setSelected(event.target.value); setStep(0); }} disabled={Boolean(newRule)}>
    {newRule && <option value="__new">新しいルール</option>}{!draft.rules.length && !newRule && <option value="">ルール未登録</option>}
    {draft.rules.map((rule, index) => <option key={rule.id} value={rule.id}>{index + 1}. {summary(rule)}</option>)}
  </select></label>;

  return <main className="dashboard management-shell te-prototype">
    <header className="management-header"><div className="management-brand" aria-label="きゃすメイト"><span aria-hidden="true">▤</span><strong>きゃすメイト</strong></div>
      <span className="management-connection connection-ok" title="比較見本・未接続"><span className="connection-label">比較見本・未接続</span><span className="connection-symbol" aria-label="比較見本・未接続">◇</span></span>
      <div className="toast-region" role="region" aria-label="通知" aria-live="polite" aria-atomic="true">{toast && <div className="banner"><span className="toast-check" aria-hidden="true">✓</span><span className="toast-message" title={toast}>{toast}</span></div>}</div>
    </header>
    <nav className="management-nav" aria-label="メインナビゲーション"><button aria-current={page === 'home' ? 'page' : undefined} onClick={() => go('home')}>ホーム</button><button aria-current={page !== 'home' ? 'page' : undefined} onClick={() => go('settings')}>設定</button><ManagementWarnings items={warnings} /></nav>
    <div className="management-body" ref={scroll}>
      {page !== 'editor' ? <><h1 id="te-page-title" tabIndex={-1}>{page === 'home' ? '配信のホーム' : '設定'}</h1><section className="te-surface"><h2>表示・演出</h2><button id="te-entry" className="management-entry" onClick={() => openEditor(page)}><span className="entry-icon">✦</span><span><strong>コメント文字演出</strong><small>反応ルール・文字の見た目</small></span><span>›</span></button><p className="te-caption">見本ではこの編集先を操作できます。</p></section></> : <>
        <ManagementEditorHeading title="コメント文字演出" backPage={origin === 'home' ? 'ホーム' : '設定'} onBack={back} introduction={intro} />
        <div className="te-enable"><div><strong>コメントに反応して演出する</strong><small>オフでもルールのテスト再生はできます。</small></div><SlimSwitch label="コメント文字演出" checked={draft.enabled} onChange={enabled => update({ ...draft, enabled }, true)} /></div>
        <div className="te-save" role="status">{failure ? '要確認：入力を保持しています' : errors.length ? '入力内容を確認してください' : saving ? '変更を反映中…' : '変更は自動保存されます（見本内）'}</div>

        {variant === 'A' && <div className="te-stack" data-variant="A"><section className="te-surface">{listTitle}{listHint}
          {newRule && editor(newRule)}<div className="te-list">{draft.rules.length ? draft.rules.map((rule, index) => row(rule, index)) : empty}</div>
        </section>{commonDisclosure}</div>}

        {variant === 'B' && <div className="te-stack" data-variant="B">
          <div className="te-tabs" aria-label="編集領域">{[['rules', '反応ルール'], ['common', '全体の見た目']].map(([id, title]) => <button key={id} aria-pressed={section === id} onClick={() => setSection(id)}>{title}</button>)}</div>
          {section === 'common' ? <section className="te-surface"><h2>全ルール共通の見た目・上限</h2>{common}</section> : <>{listTitle}<div className="te-workspace">
            <aside className="te-library" aria-label="ルール一覧">{listHint}<div className="te-library-list">{draft.rules.map((rule, index) => <button className="te-library-item" disabled={Boolean(newRule)} aria-pressed={!newRule && selected === rule.id} key={rule.id} onClick={() => { setSelected(rule.id); setStep(0); }}>
              <span className="te-glyph" aria-hidden="true" style={{ color: /^#[0-9a-f]{8}$/i.test(rule.color) ? rule.color : '#DCE7EC' }}>{rule.displayText}</span><span><strong>{index + 1}. {rule.trigger}</strong><small>{rule.countMode === 'fixed' ? `${rule.count}個` : `${rule.count}回以上で連動`} · {rule.enabled ? 'オン' : 'オフ'}</small></span><span aria-hidden="true">›</span></button>)}</div>
              {!draft.rules.length && !newRule && empty}</aside>
            <section className="te-detail te-surface">{currentRule ? <>{!newRule && <><div className="te-between"><h2>選択中のルール</h2><SlimSwitch label={`${currentRule.trigger}ルールの有効状態`} checked={currentRule.enabled} onChange={enabled => editRule({ ...currentRule, enabled }, true)} /></div><p className="te-caption">左の一覧から選んで、ここで調整します。</p></>}{editor(currentRule)}{!newRule && rowActions(currentRule)}</> : <p className="te-caption">追加したルールをここで編集できます。</p>}</section>
          </div></>}
        </div>}

        {variant === 'C' && <div className="te-stack" data-variant="C">{listTitle}{rulePicker}
          {currentRule ? <section className="te-flow te-surface">
            <div className="te-steps" aria-label="ルール作成の手順">{['反応ワード', '表示する文字', '降らせる個数'].map((name, index) => <button key={name} aria-current={step === index ? 'step' : undefined} onClick={() => setStep(index)}><span>{index + 1}</span>{name}</button>)}</div>
            <div className="te-step-body"><p className="te-kicker">STEP 0{step + 1}</p><h2>{['どんなコメントに反応させますか？', '何を降らせますか？', 'どのくらい降らせますか？'][step]}</h2>
              {fields(currentRule, step)}
              <div className="te-between te-step-nav"><button className="secondary" disabled={step === 0} onClick={() => setStep(step - 1)}>← 前へ</button>
                {step < 2 ? <button className="te-primary" onClick={() => setStep(step + 1)}>次へ →</button> : newRule ? newActions : <button className="te-primary" onClick={() => test(currentRule)}>▷ テスト再生</button>}</div>
            </div>
            <div className="te-flow-footer"><SlimSwitch label={newRule ? '新しいルールの有効状態' : `${currentRule.trigger}ルールの有効状態`} checked={currentRule.enabled} onChange={enabled => editRule({ ...currentRule, enabled }, true)} />
              {newRule ? step < 2 && <button className="te-link" onClick={() => setNewRule(null)}>追加をキャンセル</button> : <button className="te-link" onClick={() => setPendingDelete(currentRule.id)}>このルールを削除</button>}</div>
            {!newRule && order(currentRule)}
          </section> : empty}
          <details className="te-common"><summary><span>登録済みルールを見渡す</span><small>{draft.rules.length}件・処理する順序</small></summary>{listHint}<div className="te-list">{draft.rules.map((rule, index) => row(rule, index, true))}</div></details>
          {commonDisclosure}
        </div>}
        <p className="te-footnote">テスト再生は保存済みの設定を使います。OBSへの接続・送信は行わず、見本内で再現します。</p>
      </>}
      {import.meta.env.DEV && <aside className="te-lab"><strong>比較用の操作</strong><p>A：一覧で調整 ／ B：一覧と編集を分離 ／ C：3ステップで作成</p>
        <label>状態の見本<select onChange={event => scenario(event.target.value)} defaultValue="normal"><option value="normal">3件登録</option><option value="empty">ルール未登録</option><option value="many">50件登録</option><option value="failure">保存失敗</option></select></label>
        <label className="te-failure-toggle"><input type="checkbox" checked={failMode} onChange={event => setFailMode(event.target.checked)} />保存失敗を再現</label>
        <details><summary>見本の状態を確認</summary><pre data-testid="payload">{JSON.stringify({ variant, draft, saved, newRule, selected, step, saving, failure, errors }, null, 2)}</pre></details>
      </aside>}
    </div>
    {import.meta.env.DEV && <nav className="te-switcher" aria-label="見本の切り替え"><span>見本</span><button aria-label="前の案" onClick={() => switchVariant(variants[(variants.indexOf(variant) + 2) % 3])}>←</button>{variants.map(key => <button key={key} aria-pressed={variant === key} onClick={() => switchVariant(key)}>{key}<span> {names[key]}</span></button>)}<button aria-label="次の案" onClick={() => switchVariant(variants[(variants.indexOf(variant) + 1) % 3])}>→</button></nav>}
    {pendingDelete && <Modal title="ルールを削除" onClose={() => setPendingDelete(null)}><p>「{draft.rules.find(rule => rule.id === pendingDelete)?.trigger}」のルールを削除しますか？</p><p className="te-caption">一時的に止める場合は、ルールをオフにできます。</p><div className="te-row"><button className="secondary" onClick={() => setPendingDelete(null)}>キャンセル</button><button className="te-danger" onClick={remove}>削除する</button></div></Modal>}
    {play && <Modal title="テスト再生（見本内）" onClose={() => setPlay(null)}><p className="te-caption">{play.rule.displayText} を {play.count}個・{play.seconds}秒で再生。実際のOBSへは送信しません。</p>
      <div className="te-stage" aria-label="文字が上から降る再生領域" key={play.key}>{Array.from({ length: play.count }, (_, index) => <span className="te-particle" key={index} style={{ '--x': `${8 + (index * 37 % 82)}%`, '--rotation': `${(index % 2 ? 1 : -1) * 55}deg`, color: play.rule.color, fontSize: `${play.size}px`, animationDuration: `${play.seconds}s` } as CSSProperties}>{play.rule.displayText}</span>)}</div>
      <p className="te-caption">表示領域を縮小した動きの見本です。絵文字の色はフォントに依存します。</p><button className="te-primary" onClick={() => setPlay({ ...play, key: Date.now() })}>もう一度再生</button>
    </Modal>}
  </main>;
}

function RuleFields({ rule, onChange, onMode, only, modeError }: { rule: RuleDraft; onChange(rule: RuleDraft): void; onMode(rule: RuleDraft, mode: RuleDraft['countMode']): void; only?: number; modeError: string }) {
  const errors = ruleErrors(rule);
  return <div className="te-fields">
    {(only === undefined || only === 0) && <Field label="反応ワード" value={rule.trigger} onChange={trigger => onChange({ ...rule, trigger })} error={errors.trigger} hint="英字の大小・全角半角は区別しません。" />}
    {(only === undefined || only === 1) && <>
      <Field label="表示文字" value={rule.displayText} onChange={displayText => onChange({ ...rule, displayText })} error={errors.displayText} hint="文字または絵文字を1つ。例：草、👏" />
      <Field label="色（#RRGGBBAA）" value={rule.color} onChange={color => onChange({ ...rule, color })} error={errors.color} hint="末尾2桁は不透明度。FFで不透明です。" /></>}
    {(only === undefined || only === 2) && <>
      <label className="te-field">個数方式<select value={rule.countMode} onChange={event => onMode(rule, event.target.value as RuleDraft['countMode'])}><option value="fixed">決まった個数を降らせる</option><option value="consecutive">連続数に合わせて降らせる</option></select><span className={`te-hint ${modeError ? 'te-error' : ''}`} role={modeError ? 'alert' : undefined}>{modeError || (rule.countMode === 'fixed' ? '含まれていれば、1コメントにつき1回発火。' : '反応ワードは1文字。最も長い連続数を使用。')}</span></label>
      <Field label={rule.countMode === 'fixed' ? '表示個数' : '最低連続数'} type="number" min={rule.countMode === 'fixed' ? 1 : 2} max={20} value={rule.count} onChange={count => onChange({ ...rule, count })} error={errors.count}
        hint={rule.countMode === 'fixed' ? '1〜20個。ワードの出現回数には連動しません。' : '2〜20回。例：ww と www なら3個。'} />
    </>}
  </div>;
}

function Field({ label, value, onChange, error = '', hint, type = 'text', min, max, step }: { label: string; value: string; onChange(value: string): void; error?: string; hint: string; type?: string; min?: number; max?: number; step?: string }) {
  const id = `te-${label}`;
  return <label className="te-field">{label}<input type={type} value={value} onChange={event => onChange(event.target.value)} min={min} max={max} step={step} aria-invalid={Boolean(error)} aria-describedby={`${id}-hint`} spellCheck={false} />
    <span className={`te-hint ${error ? 'te-error' : ''}`} id={`${id}-hint`} role={error ? 'alert' : undefined}>{error || hint}</span></label>;
}

function CommonFields({ value, onChange }: { value: Draft; onChange(value: Draft): void }) {
  return <div className="te-common-content"><div className="te-common-grid">
    <Field label="基本文字サイズ（px）" type="number" min={16} max={200} value={value.fontSizePx} onChange={fontSizePx => onChange({ ...value, fontSizePx })} error={numberError(value.fontSizePx, 16, 200)} hint="16〜200px。すべての文字に適用。" />
    <Field label="落下時間（秒）" type="number" min={1} max={10} step="0.1" value={value.fallDurationSeconds} onChange={fallDurationSeconds => onChange({ ...value, fallDurationSeconds })} error={numberError(value.fallDurationSeconds, 1, 10, false)} hint="1〜10秒。長いほどゆっくり落下。" />
    <Field label="同時表示上限（個）" type="number" min={1} max={30} value={value.maxActiveItems} onChange={maxActiveItems => onChange({ ...value, maxActiveItems })} error={numberError(value.maxActiveItems, 1, 30)} hint="1〜30個。超えた分は表示しません。" />
  </div><p className="te-caption">1コメントあたりは合計20個まで。上限を超えた演出は、後から再生されません。</p></div>;
}

function Modal({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const entryRef = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useEffect(() => {
    const entry = entryRef.current;
    const dialog = ref.current; dialog?.showModal();
    return () => { dialog?.close(); if (entry?.isConnected) entry.focus({ preventScroll: true }); else document.getElementById('editor-heading')?.focus({ preventScroll: true }); };
  }, []);
  return <dialog className="te-modal" ref={ref} aria-label={title} onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="te-between"><h2>{title}</h2><button className="secondary small" onClick={onClose} autoFocus>閉じる</button></div>{children}
  </dialog>;
}
