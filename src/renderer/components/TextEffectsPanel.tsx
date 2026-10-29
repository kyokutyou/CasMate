import { CompactFeedback } from './CompactFeedback';
import { useContext, useId, useLayoutEffect, useRef, useState } from 'react';
import { ManagementNavigation, SetupPresentation } from '../management-navigation';
import { graphemes } from '../../shared/unicode';
import type { TextEffectRule, TextEffectsSettings } from '../../shared/types';
import { SettingsCard } from './SettingsCard';
import { SlimSwitch } from './SlimSwitch';
import './text-effects-panel.css';

interface Props {
  saveError?: string;
  value: TextEffectsSettings;
  saveDeferred(value: TextEffectsSettings): void;
  saveImmediate(value: TextEffectsSettings): Promise<unknown>;
  testRule(ruleId: string): Promise<unknown>;
}

export function TextEffectsPanel({ value: incoming, saveDeferred, saveImmediate, testRule, saveError }: Props) {
  const navigation = useContext(ManagementNavigation);
  const { confirmation, effectExample = 'ww と www', setEffectExample, effectRuleId, setEffectRuleId } = useContext(SetupPresentation);
  const basic = navigation?.initialSetup === true;
  const id = useId();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newRule, setNewRule] = useState<TextEffectRule>(freshRule);
  const [modeError, setModeError] = useState<{ id: string; message: string } | null>(null);
  const [operationError, setOperationError] = useState('');
  const [structureBusy, setStructureBusy] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const structurePending = useRef(false);
  const testPending = useRef(false);
  const ruleSelection = useRef<HTMLSelectElement>(null);
  const completedAddOrigin = useRef<Element | null>(null);
  useLayoutEffect(() => {
    if (adding) return;
    const origin = completedAddOrigin.current;
    completedAddOrigin.current = null;
    if (basic && navigation?.editor === 'textEffects' && origin && !origin.isConnected && document.activeElement === document.body) {
      ruleSelection.current?.focus({ preventScroll: true });
    }
  }, [adding, basic, navigation?.editor]);
  // The shared save hook is optimistic. Confirm structural changes before exposing
  // the new list; failure keeps the old draft without writing it back to the server.
  const [retained, setRetained] = useState<TextEffectsSettings | null>(null);
  const value = retained ?? incoming;
  const [validColors, setValidColors] = useState<Record<string, string>>({});
  const visibleRules = adding ? [...value.rules, newRule] : value.rules;
  const nextColors = Object.fromEntries(visibleRules.map(rule => [rule.id, validColor(rule.color) ? rule.color : validColors[rule.id] ?? '#ffffffff']));
  if (Object.keys(validColors).length !== visibleRules.length || Object.entries(nextColors).some(([key, color]) => validColors[key] !== color)) setValidColors(nextColors);
  const inputError = value.rules.flatMap(rule => Object.values(ruleErrors(rule))).find(Boolean)
    || numberError(value.fontSizePx, 16, 200, false) || numberError(value.fallDurationSeconds, 1, 10, false)
    || numberError(value.maxActiveItems, 1, 30);
  const error = saveError || operationError || modeError?.message || inputError;
  const save = async (next: TextEffectsSettings) => {
    if (structurePending.current) return;
    setRetained(null); setOperationError('');
    try { await saveImmediate(next); }
    catch (error) { setOperationError(messageOf(error)); }
  };
  const edit = (next: TextEffectsSettings) => { setRetained(null); setOperationError(''); saveDeferred(next); };
  const updateRule = (next: TextEffectRule, immediate = false) => {
    setModeError(null);
    if (adding && next.id === newRule.id) { setNewRule(next); return; }
    const updated = { ...value, rules: value.rules.map(rule => rule.id === next.id ? next : rule) };
    return immediate ? save(updated) : edit(updated);
  };
  const changeMode = (rule: TextEffectRule, mode: TextEffectRule['countMode']) => {
    const length = graphemes(rule.trigger.trim()).length;
    if (length < 1 || length > 50 || mode === 'consecutive' && length !== 1) {
      setModeError({ id: rule.id, message: mode === 'consecutive' ? '連動型の反応ワードは1文字で指定してください。' : '反応ワードは1〜50文字で入力してください。' }); return;
    }
    const base = { id: rule.id, enabled: rule.enabled, trigger: rule.trigger, displayText: rule.displayText, color: rule.color };
    void updateRule(mode === 'fixed' ? { ...base, countMode: 'fixed', fixedCount: 1 }
      : { ...base, countMode: 'consecutive', minimumConsecutiveCount: 2 }, true);
  };
  const structuralSave = async (next: TextEffectsSettings, done: () => void) => {
    if (structurePending.current) return;
    structurePending.current = true; setStructureBusy(true); setOperationError(''); setRetained(value);
    try { await saveImmediate(next); setRetained(null); done(); }
    catch (error) { setOperationError(messageOf(error)); }
    finally { structurePending.current = false; setStructureBusy(false); }
  };
  const addRule = () => {
    if (value.rules.length >= 50 || inputError || Object.values(ruleErrors(newRule)).some(Boolean)) return;
    const origin = document.activeElement;
    void structuralSave({ ...value, rules: [...value.rules, newRule] }, () => {
      if (basic) completedAddOrigin.current = origin;
      setEffectRuleId?.(newRule.id); setAdding(false); setEditingId(newRule.id); setNewRule(freshRule()); setModeError(null);
    });
  };
  const cancelAdding = () => {
    if (structurePending.current) return;
    const origin = document.activeElement;
    const finish = () => {
      if (basic) completedAddOrigin.current = origin;
      setAdding(false); setNewRule(freshRule()); setModeError(null);
    };
    // A failed structural save remains in the shared optimistic draft. An explicit
    // cancel must restore that draft too; keep the form if restoring it fails.
    if (retained) void structuralSave(retained, finish);
    else finish();
  };
  const deleteRule = (rule: TextEffectRule) => {
    if (structurePending.current || !window.confirm(`「${rule.trigger}」の文字演出ルールを削除しますか？`)) return;
    void structuralSave({ ...value, rules: value.rules.filter(candidate => candidate.id !== rule.id) }, () => {
      setEditingId(current => current === rule.id ? null : current);
    });
  };
  const moveRule = (index: number, offset: -1 | 1) => {
    if (index + offset < 0 || index + offset >= value.rules.length) return;
    const rules = [...value.rules]; [rules[index], rules[index + offset]] = [rules[index + offset], rules[index]];
    void structuralSave({ ...value, rules }, () => undefined);
  };
  const test = async (ruleId: string) => {
    if (testPending.current || structurePending.current) return;
    testPending.current = true; setTestingId(ruleId); setOperationError('');
    try { await testRule(ruleId); }
    catch (error) { setOperationError(error instanceof Error ? error.message : '文字演出のテスト送信に失敗しました。'); }
    finally { testPending.current = false; setTestingId(null); }
  };
  const startAdding = () => { if (inputError) return; setEditingId(null); setAdding(true); setModeError(null); };
  const fields = (rule: TextEffectRule) => <RuleFields basic={basic} rule={rule} lastValidColor={nextColors[rule.id]} onDeferred={next => updateRule(next)} onMode={mode => changeMode(rule, mode)} modeError={modeError?.id === rule.id ? modeError.message : undefined} />;

  const selected = value.rules.find(rule => rule.id === effectRuleId) ?? value.rules[0];
  const prepared = adding ? newRule : selected;
  const preset = (kind: 'grass' | 'clap') => {
    if (value.rules.length >= 50 || inputError) return;
    setAdding(true); setEditingId(null); setModeError(null);
    setNewRule(kind === 'grass' ? { id: crypto.randomUUID(), enabled: true, trigger: 'w', displayText: '草', color: '#66cc66ff', countMode: 'consecutive', minimumConsecutiveCount: 2 }
      : { id: crypto.randomUUID(), enabled: true, trigger: '8888', displayText: '👏', color: '#ffffffff', countMode: 'fixed', fixedCount: 6 });
  };
  if (basic) return <SettingsCard cardId="textEffects" title="コメント文字演出" eyebrow="COMMENT TEXT EFFECTS" className="text-effects-panel setup-creative-panel"
    navigationWarning={error || (adding || structureBusy ? '編集中のルールを保存するか、キャンセルしてください。' : undefined)}>
    <section className="setup-step-card"><h2><span className="setup-number">1</span>最初のルールを作る</h2><p>「w」が続いたら「草」を降らせるルールから始めましょう。</p>
      <fieldset aria-disabled={structureBusy} className="setup-effects-fields" onClickCapture={event => { if (structureBusy) { event.preventDefault(); event.stopPropagation(); } }} onKeyDownCapture={event => { if (structureBusy && event.key !== 'Tab') { event.preventDefault(); event.stopPropagation(); } }} onPointerDownCapture={event => { if (structureBusy) { event.preventDefault(); event.stopPropagation(); } }}><div className="button-row"><button className="secondary" disabled={value.rules.length >= 50 || Boolean(inputError)} onClick={() => preset('grass')}>w → 草</button><button className="secondary" disabled={value.rules.length >= 50 || Boolean(inputError)} onClick={() => preset('clap')}>8888 → 拍手</button></div>
      <label>編集するルール<select ref={ruleSelection} disabled={adding} value={selected?.id ?? ''} onChange={event => setEffectRuleId?.(event.target.value)}>{value.rules.length ? value.rules.map(rule => <option key={rule.id} value={rule.id}>{rule.trigger} → {rule.displayText}</option>) : <option value="">ルールがありません</option>}</select></label>
      {prepared && <>{fields(prepared)}<p className="muted">{adding ? '追加するルールです。保存するまで反応例やOBSテストには使いません。' : '既存ルールは入力後500ミリ秒で自動保存します。説明用プレビューは保存済みの内容です。'}</p></>}
      {adding && <div className="button-row"><button className="setup-primary" disabled={Boolean(inputError) || Object.values(ruleErrors(newRule)).some(Boolean)} onClick={addRule}>ルールを保存</button><button className="secondary" onClick={cancelAdding}>キャンセル</button></div>}
      </fieldset><CompactFeedback className="setup-creative-status" role="status" tabIndex={0} reserve={['要確認：保存できませんでした。入力は保持しています。']}>{error ? '要確認：' + error : structureBusy ? 'ルールを保存しています…' : value.rules.length >= 50 ? '最大50件です。詳細設定で既存ルールを整理できます。' : '色や並び順、ルールの削除は詳細設定で変更できます。'}</CompactFeedback>
    </section>
    <section className="setup-step-card"><h2><span className="setup-number">2</span>コメント例で反応を試す</h2><p>連続回数に合わせる場合は、コメント内で最も長く続いた部分を使います。</p><p className="setup-inline-note">w → 草・最小2回なら「ww と www」で草が3個。w・W・ｗは同じように扱います。最大20個です。</p><label>説明用のコメント例<input value={effectExample} onChange={event => setEffectExample?.(event.target.value)} /></label><small>説明用の反応例です。新着コメントの取得・OBSへの送信は行いません。</small></section>
    <section className="setup-step-card"><h2><span className="setup-number">3</span>OBSでの確認手順</h2><p>保存したルールの反応例は右欄で確認できます。</p><p className="setup-inline-note">最後の「OBSの表示確認」でソースを追加し、OBSへテスト送信します。</p></section>
    <section className="setup-step-card"><h2><span className="setup-number">4</span>通常の演出を設定する</h2><p>条件に合う新着コメントに反応します。過去のコメントには反応しません。</p><SlimSwitch keepFocus disabled={structureBusy} label="コメント文字演出" checked={value.enabled} onChange={enabled => save({ ...value, enabled })} /><small>ONにすると実際の新着コメントに反応します。OBS表示の準備も確認してください。</small>{confirmation}</section>
  </SettingsCard>;
  return <SettingsCard cardId="textEffects" navigationWarning={error || (navigation?.initialSetup && (adding || structureBusy) ? '編集中のルールを保存するか、キャンセルしてください。' : undefined)} title="コメント文字演出" eyebrow="COMMENT TEXT EFFECTS" className="text-effects-panel">
    <fieldset className="effects-controls" disabled={structureBusy}>
      <div className="effects-enable"><div><strong>コメントに反応して演出する</strong><CompactFeedback as="span" className="effects-enable-help" role="status" aria-label="設定の保存状態" tabIndex={0} reserve={['オフでもOBSへテスト送信できます。', '要確認：保存できませんでした。入力は保持しています。']}>{error ? `要確認：${error} 入力は保持しています。` : 'オフでもOBSへテスト送信できます。'}</CompactFeedback></div>
        <SlimSwitch label="コメント文字演出" checked={value.enabled} onChange={enabled => save({ ...value, enabled })} /></div>
      <section className="effects-rules" aria-labelledby={`${id}-rules`}>
        <div className="effects-section-heading"><div><h3 id={`${id}-rules`}>反応ルール</h3><span>{value.rules.length} / 50件</span></div>
          <button type="button" className="small" disabled={value.rules.length >= 50 || adding || Boolean(inputError)} onClick={startAdding}><span aria-hidden="true">＋ </span>ルールを追加</button></div>
        <p className="effects-list-hint">{value.rules.length >= 50 ? '最大50件です。追加するには既存ルールを削除してください。' : '上のルールから処理します。'}</p>
        {adding && <div className="effects-editor effects-add-form"><h3>新しいルール</h3>{fields(newRule)}
          <SlimSwitch label="新しいルールの有効状態" checked={newRule.enabled} onChange={enabled => setNewRule({ ...newRule, enabled })} />
          <div className="button-row"><button type="button" disabled={Boolean(inputError) || Object.values(ruleErrors(newRule)).some(Boolean)} onClick={addRule}>追加</button>
            <button type="button" className="secondary" onClick={cancelAdding}>キャンセル</button></div>
        </div>}
        <div className="effects-rule-list" aria-label="保存順のルール一覧">
          {value.rules.map((rule, index) => <article className="effects-rule" key={rule.id} aria-label={`${index + 1}. ${rule.trigger}のルール`}>
            <div className="effects-rule-line"><span className="effects-number">{String(index + 1).padStart(2, '0')}</span>
              <span className="effects-glyph" aria-hidden="true" style={validColor(rule.color) ? { color: rule.color } : undefined}>{rule.displayText}</span>
              <div className="effects-rule-copy"><strong>{rule.countMode === 'fixed'
                ? `「${rule.trigger}」を含む → ${rule.displayText} × ${formatNumber(rule.fixedCount)}`
                : `「${rule.trigger}」が${formatNumber(rule.minimumConsecutiveCount)}回以上連続 → ${rule.displayText} × 連続数`}</strong>
                <small>{rule.countMode === 'fixed' ? 'ワード一致で固定個数' : '最も長い連続数に連動'}</small></div>
              <SlimSwitch label={`${rule.trigger}ルールの有効状態`} checked={rule.enabled} onChange={enabled => updateRule({ ...rule, enabled }, true)} />
            </div>
            <div className="effects-rule-actions"><div>
              <button type="button" className="secondary small effects-test" aria-label="OBSへテスト送信" aria-disabled={Boolean(testingId)} aria-busy={testingId === rule.id} onClick={() => void test(rule.id)}>{testingId === rule.id ? '送信中…' : <><span aria-hidden="true">▷ </span>OBSへテスト送信</>}</button>
              <button type="button" className="secondary effects-link" onClick={() => deleteRule(rule)}>削除</button></div>
              <button type="button" className="secondary effects-link" disabled={adding} aria-expanded={editingId === rule.id} onClick={() => setEditingId(editingId === rule.id ? null : rule.id)}>{editingId === rule.id ? '閉じる' : '編集'}<span aria-hidden="true"> {editingId === rule.id ? '−' : '→'}</span></button>
            </div>
            {editingId === rule.id && !adding && <div className="effects-editor"><div className="effects-editor-heading"><h3>ルールを編集</h3><small>入力後に自動保存</small></div>{fields(rule)}
              <div className="effects-order"><span>処理する順序</span><button type="button" className="secondary small" disabled={index === 0} onClick={() => moveRule(index, -1)}><span aria-hidden="true">↑ </span>上へ</button>
                <button type="button" className="secondary small" disabled={index === value.rules.length - 1} onClick={() => moveRule(index, 1)}><span aria-hidden="true">↓ </span>下へ</button></div>
            </div>}
          </article>)}
          {!value.rules.length && <div className="effects-empty"><span aria-hidden="true">◇</span><h3>最初の反応をつくりましょう</h3><p>「w」が続いたら「草」を降らせる、など。<br />反応ワードと表示文字を組み合わせます。</p>
            <button type="button" className="secondary" disabled={adding || Boolean(inputError)} onClick={startAdding}>最初のルールを追加</button></div>}
        </div>
      </section>
      <section className="effects-common" aria-labelledby="effects-appearance"><h3 id="effects-appearance" tabIndex={-1}>全ルール共通の見た目・上限<small>文字サイズ・落下時間・同時表示</small></h3>
        <div className="effects-common-content"><div className="effects-common-fields">
          <NumberInput label="基本文字サイズ（px）" value={value.fontSizePx} min={16} max={200} step="any" integer={false} hint="16〜200px。すべての文字に適用。" onChange={fontSizePx => edit({ ...value, fontSizePx })} />
          <NumberInput label="落下時間（秒）" value={value.fallDurationSeconds} min={1} max={10} step="any" integer={false} hint="1〜10秒。長いほどゆっくり落下。" onChange={fallDurationSeconds => edit({ ...value, fallDurationSeconds })} />
          <NumberInput label="同時表示上限（個）" value={value.maxActiveItems} min={1} max={30} hint="1〜30個。超えた分は表示しません。" onChange={maxActiveItems => edit({ ...value, maxActiveItems })} />
        </div><p>1コメントあたりは合計20個まで。上限を超えた演出は、後から再生されません。</p></div>
      </section>
    </fieldset>
  </SettingsCard>;
}

function RuleFields({ rule, lastValidColor, onDeferred, onMode, modeError, basic = false }: { basic?: boolean; rule: TextEffectRule; lastValidColor: string; onDeferred(rule: TextEffectRule): void; onMode(mode: TextEffectRule['countMode']): void; modeError?: string }) {
  const errors = ruleErrors(rule); const id = useId();
  return <div className="effects-fields">
    <TextInput label="反応ワード" value={rule.trigger} error={errors.trigger} hint="英字の大小・全角半角は区別しません。" validationHelp={['反応ワードは1〜50文字で入力してください。', '連動型の反応ワードは1文字で指定してください。']} onChange={trigger => onDeferred({ ...rule, trigger })} />
    <TextInput label="表示文字" value={rule.displayText} error={errors.displayText} hint="文字または絵文字を1つ。例：草、👏" validationHelp={['表示文字は絵文字を含めて1文字で入力してください。']} onChange={displayText => onDeferred({ ...rule, displayText })} />
    {!basic && <RuleColor value={rule.color} color={lastValidColor} error={errors.color} onChange={color => onDeferred({ ...rule, color })} />}
    <div className="effects-field"><label htmlFor={id}>個数設定</label><select id={id} value={rule.countMode} aria-describedby={`${id}-hint`} aria-invalid={Boolean(modeError)} onChange={event => onMode(event.target.value === 'fixed' ? 'fixed' : 'consecutive')}>
      <option value="fixed">決まった個数を降らせる</option><option value="consecutive">連続数に合わせて降らせる</option></select>
      <CompactFeedback id={`${id}-hint`} className={`effects-field-hint${modeError ? ' field-error' : ''}`} reserve={['1コメントにつき1回反応。', '反応ワードは1文字。最も長い連続数を使用。', '連動型の反応ワードは1文字で指定してください。', '反応ワードは1〜50文字で入力してください。']}>{modeError || (rule.countMode === 'fixed' ? '1コメントにつき1回反応。' : '反応ワードは1文字。最も長い連続数を使用。')}</CompactFeedback></div>
    {rule.countMode === 'fixed'
      ? <NumberInput label="表示個数" value={rule.fixedCount} min={1} max={20} hint="1〜20個。ワードの出現回数には連動しません。" onChange={fixedCount => onDeferred({ ...rule, fixedCount })} />
      : <NumberInput label="最低連続数" value={rule.minimumConsecutiveCount} min={2} max={20} hint="2〜20回。例：ww と www なら3個。" onChange={minimumConsecutiveCount => onDeferred({ ...rule, minimumConsecutiveCount })} />}
  </div>;
}
function TextInput({ label, value, onChange, hint, error, validationHelp }: { label: string; value: string; onChange(value: string): void; hint: string; error: string; validationHelp: string[] }) {
  const id = useId();
  return <div className="effects-field"><label htmlFor={id}>{label}</label><input id={id} value={value} spellCheck={false} aria-invalid={Boolean(error)} aria-describedby={`${id}-hint`} onChange={event => onChange(event.target.value)} />
    <CompactFeedback id={`${id}-hint`} className={`effects-field-hint${error ? ' field-error' : ''}`} reserve={[hint, ...validationHelp]}>{error || hint}</CompactFeedback></div>;
}
function RuleColor({ value, color, error, onChange }: { value: string; color: string; error: string; onChange(value: string): void }) {
  const opacity = Math.round(parseInt(color.slice(7), 16) / 255 * 100);
  return <div className="effects-color-editor">
    <div className="effects-color-controls">
      <label>色を選ぶ<input type="color" aria-label="演出の色を選択" value={color.slice(0, 7)} disabled={Boolean(error)} onChange={event => onChange(event.target.value + color.slice(7))} /></label>
      <label>不透明度 <output>{opacity}%</output><input type="range" aria-label="演出の不透明度" aria-valuetext={`${opacity}%`} min={0} max={100} step={1} value={opacity} disabled={Boolean(error)} onChange={event => onChange(color.slice(0, 7) + Math.round(Number(event.target.value) / 100 * 255).toString(16).padStart(2, '0'))} /></label>
    </div>
    <TextInput label="色（#RRGGBBAA）" value={value} error={error} hint="色コードでも指定できます。末尾2桁は不透明度です。" validationHelp={['#RRGGBBAA形式で入力してください。例：#66CC66FF']} onChange={onChange} />
  </div>;
}
function NumberInput({ label, value, onChange, hint, min, max, step = '1', integer = true }: { label: string; value: number; onChange(value: number): void; hint: string; min: number; max: number; step?: string; integer?: boolean }) {
  const id = useId(); const error = numberError(value, min, max, integer);
  return <div className="effects-field"><label htmlFor={id}>{label}</label><input id={id} type="number" min={min} max={max} step={step} value={Number.isFinite(value) ? value : ''} aria-invalid={Boolean(error)} aria-describedby={`${id}-hint`}
    onChange={event => onChange(event.target.value === '' ? Number.NaN : Number(event.target.value))} />
    <CompactFeedback id={`${id}-hint`} className={`effects-field-hint${error ? ' field-error' : ''}`} reserve={[hint, `${min}〜${max}の${integer ? '整数' : '数値'}を入力してください。`]}>{error || hint}</CompactFeedback></div>;
}
function ruleErrors(rule: TextEffectRule) {
  const length = graphemes(rule.trigger.trim()).length;
  return { trigger: length < 1 || length > 50 ? '反応ワードは1〜50文字で入力してください。' : rule.countMode === 'consecutive' && length !== 1 ? '連動型の反応ワードは1文字で指定してください。' : '',
    displayText: graphemes(rule.displayText.trim()).length !== 1 ? '表示文字は絵文字を含めて1文字で入力してください。' : '',
    color: validColor(rule.color) ? '' : '#RRGGBBAA形式で入力してください。例：#66CC66FF',
    count: rule.countMode === 'fixed' ? numberError(rule.fixedCount, 1, 20) : numberError(rule.minimumConsecutiveCount, 2, 20) };
}
const validColor = (value: string) => /^#[0-9a-f]{8}$/i.test(value);
const numberError = (value: number, min: number, max: number, integer = true) => Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value)) ? '' : `${min}〜${max}の${integer ? '整数' : '数値'}を入力してください。`;
const formatNumber = (value: number) => Number.isFinite(value) ? String(value) : '—';
const messageOf = (error: unknown) => error instanceof Error ? error.message : '設定を保存できませんでした。';
function freshRule(): TextEffectRule {
  return { id: crypto.randomUUID(), enabled: true, trigger: '', displayText: '★', color: '#ffffffff', countMode: 'fixed', fixedCount: 1 };
}
