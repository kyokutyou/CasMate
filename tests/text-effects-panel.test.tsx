// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultSettings } from '../src/main/core/settings';
import { ManagementNavigation, SetupPresentation } from '../src/renderer/management-navigation';
import { TextEffectsPanel } from '../src/renderer/components/TextEffectsPanel';
import type { TextEffectsSettings } from '../src/shared/types';
import { useAutoSavingSettings } from '../src/renderer/use-auto-saving-settings';

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('通常画面でも追加保存の失敗後にキャンセルすると共有の未保存データとエラーを解消する', async () => {
  const initial = createDefaultSettings();
  const save = vi.fn().mockRejectedValueOnce(new Error('保存失敗')).mockResolvedValue(undefined);
  function Harness() {
    const saving = useAutoSavingSettings(initial, 1, save, vi.fn());
    return saving.draft && <><TextEffectsPanel value={saving.draft.textEffects} saveDeferred={value => saving.changeSection('textEffects', value)} saveImmediate={value => saving.saveSectionNow('textEffects', value)} saveError={saving.saveErrors.textEffects} testRule={vi.fn()} /><output aria-label="未保存状態">{String(saving.hasPendingSave('textEffects'))}</output></>;
  }
  const view = render(<Harness />);
  fireEvent.click(view.getByRole('button', { name: 'ルールを追加' }));
  fireEvent.change(view.getByLabelText('反応ワード'), { target: { value: 'new' } });
  fireEvent.click(view.getByRole('button', { name: '追加', exact: true }));
  await waitFor(() => expect(view.getByLabelText('未保存状態')).toHaveTextContent('true'));
  await waitFor(() => expect(view.getByText(/要確認：保存失敗/)).toBeVisible());
  fireEvent.click(view.getByRole('button', { name: 'キャンセル', exact: true }));
  await waitFor(() => expect(view.getByLabelText('未保存状態')).toHaveTextContent('false'));
  expect(save).toHaveBeenLastCalledWith('textEffects', initial.textEffects);
  expect(view.queryByText(/要確認：保存失敗/)).not.toBeInTheDocument();
  expect(view.queryByRole('button', { name: 'キャンセル', exact: true })).not.toBeInTheDocument();
});

it.each([false, true])('既存ルールの不正入力を隠して追加へ進まず、修正後に追加できる: setup=%s', basic => {
  function Harness() {
    const [value, setValue] = useState(createDefaultSettings().textEffects);
    return <ManagementNavigation.Provider value={{ editor: 'textEffects', initialSetup: basic, open: vi.fn(), reportError: vi.fn() }}><TextEffectsPanel value={value} saveDeferred={setValue} saveImmediate={vi.fn()} testRule={vi.fn()} /></ManagementNavigation.Provider>;
  }
  const view = render(<Harness />);
  if (!basic) fireEvent.click(view.getAllByRole('button', { name: '編集', exact: true })[0]);
  fireEvent.change(view.getByLabelText('反応ワード'), { target: { value: '' } });
  const add = view.getByRole('button', { name: basic ? '8888 → 拍手' : 'ルールを追加', exact: true });
  expect(add).toBeDisabled();fireEvent.click(add);
  expect(view.queryByRole('button', { name: 'キャンセル', exact: true })).not.toBeInTheDocument();
  expect(view.getByLabelText('反応ワード')).toHaveValue('');
  fireEvent.change(view.getByLabelText('反応ワード'), { target: { value: 'w' } });
  expect(add).toBeEnabled();fireEvent.click(add);
  expect(view.getByRole('button', { name: 'キャンセル', exact: true })).toBeVisible();
});

describe('コメント文字演出の管理画面', () => {
  it('色選択は不透明度を保持し、不透明度はRGBを保持する。不正なコードは修正まで補助操作を禁止する', () => {
    function Harness() {
      const initial = createDefaultSettings().textEffects;
      initial.rules[0].color = '#12345680';
      const [value, setValue] = useState(initial);
      return <TextEffectsPanel value={value} saveDeferred={setValue} saveImmediate={vi.fn()} testRule={vi.fn()} />;
    }
    const view = render(<Harness />);
    fireEvent.click(view.getAllByRole('button', { name: '編集', exact: true })[0]);
    fireEvent.change(view.getByLabelText('演出の色を選択'), { target: { value: '#abcdef' } });
    expect(view.getByLabelText('色（#RRGGBBAA）')).toHaveValue('#abcdef80');
    fireEvent.change(view.getByLabelText('演出の不透明度'), { target: { value: '25' } });
    expect(view.getByLabelText('色（#RRGGBBAA）')).toHaveValue('#abcdef40');
    fireEvent.change(view.getByLabelText('色（#RRGGBBAA）'), { target: { value: 'invalid' } });
    expect(view.getByLabelText('演出の色を選択')).toBeDisabled();
    expect(view.getByLabelText('演出の不透明度')).toBeDisabled();
    expect(view.getByLabelText('演出の色を選択')).toHaveValue('#abcdef');
    fireEvent.click(view.getByRole('button', { name: '閉じる', exact: true }));
    fireEvent.click(view.getAllByRole('button', { name: '編集', exact: true })[0]);
    expect(view.getByLabelText('色（#RRGGBBAA）')).toHaveValue('invalid');
    expect(view.getByLabelText('演出の色を選択')).toHaveValue('#abcdef');
    expect(view.getByLabelText('演出の不透明度')).toHaveValue('25');
    fireEvent.change(view.getByLabelText('色（#RRGGBBAA）'), { target: { value: '#001122ff' } });
    expect(view.getByLabelText('演出の色を選択')).toBeEnabled();
    expect(view.getByLabelText('演出の不透明度')).toHaveValue('100');
    expect(view.getAllByRole('button', { name: 'OBSへテスト送信' })).toHaveLength(3);
    expect(view.container).not.toHaveTextContent('発火');
    expect(view.getAllByText(/1コメントあたりは合計20個/)).toHaveLength(1);
  });
  it('末尾のOBS接続とテスト再生の補足案内を表示しない', () => {
    const view = render(<TextEffectsPanel value={createDefaultSettings().textEffects}
      saveDeferred={vi.fn()} saveImmediate={vi.fn(async () => undefined)} testRule={vi.fn(async () => undefined)} />);
    expect(view.queryByText('OBSコメント表示とは別のブラウザソースを使います。テスト再生は保存済みの設定を使い、接続中のOBS文字演出ビューへ送信します。')).not.toBeInTheDocument();
  });

  it('初回は展開し、コンパクト行からテスト・編集・削除できる', async () => {
    const value = createDefaultSettings().textEffects;
    const saveImmediate = vi.fn(async () => undefined);
    const testRule = vi.fn(async () => undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const view = render(<TextEffectsPanel
      value={value}
      saveDeferred={vi.fn()}
      saveImmediate={saveImmediate}
      testRule={testRule}
    />);

    expect(view.getByText('3 / 50件')).toBeInTheDocument();
    expect(view.getByRole('button', { name: 'コメント文字演出：閉じる' })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(view.getAllByRole('button', { name: 'OBSへテスト送信' })[0]);
    expect(testRule).toHaveBeenCalledWith('default-grass');

    fireEvent.click(view.getAllByRole('button', { name: '編集' })[0]);
    expect(view.getByLabelText('反応ワード')).toHaveValue('w');
    fireEvent.click(view.getAllByRole('button', { name: '削除' })[0]);
    expect(saveImmediate).toHaveBeenCalledWith({ ...value, rules: value.rules.slice(1) });
  });

  it('50件では追加操作を無効にする', () => {
    const base = createDefaultSettings().textEffects;
    const rules = Array.from({ length: 50 }, (_, index) => ({
      ...base.rules[0], id: `rule-${index}`,
    }));
    const view = render(<TextEffectsPanel
      value={{ ...base, rules }}
      saveDeferred={vi.fn()}
      saveImmediate={vi.fn(async () => undefined)}
      testRule={vi.fn(async () => undefined)}
    />);
    expect(view.getByRole('button', { name: 'ルールを追加' })).toBeDisabled();
  });

  it('追加・キャンセル、有効切替、編集、並び替えを保存する', async () => {
    const base = createDefaultSettings().textEffects;
    const initial: TextEffectsSettings = {
      ...base,
      rules: [
        { id: 'first', enabled: true, trigger: 'a', displayText: 'A', color: '#ffffffff', countMode: 'fixed', fixedCount: 1 },
        { id: 'second', enabled: true, trigger: 'b', displayText: 'B', color: '#ffffffff', countMode: 'fixed', fixedCount: 1 },
      ],
    };
    const saves: TextEffectsSettings[] = [];
    function Harness() {
      const [value, setValue] = useState(initial);
      return <TextEffectsPanel value={value} saveDeferred={setValue} saveImmediate={async (next) => {
        saves.push(next);
        setValue(next);
      }} testRule={vi.fn(async () => undefined)} />;
    }
    const view = render(<Harness />);
    fireEvent.click(view.getByLabelText('aルールの有効状態'));
    expect(saves.at(-1)?.rules[0].enabled).toBe(false);

    fireEvent.click(view.getAllByRole('button', { name: '編集' })[0]);
    fireEvent.change(view.getByLabelText('表示文字'), { target: { value: '★' } });
    expect(view.getByLabelText('表示文字')).toHaveValue('★');
    fireEvent.click(view.getByRole('button', { name: '下へ' }));
    expect(saves.at(-1)?.rules.map((rule) => rule.id)).toEqual(['second', 'first']);
    await waitFor(() => expect(view.getByRole('button', { name: 'ルールを追加' })).toBeEnabled());

    fireEvent.click(view.getByRole('button', { name: 'ルールを追加' }));
    fireEvent.click(view.getByRole('button', { name: 'キャンセル' }));
    expect(view.queryByText('新しいルール')).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'ルールを追加' }));
    fireEvent.change(view.getAllByLabelText('反応ワード')[0], { target: { value: 'new' } });
    fireEvent.click(view.getByRole('button', { name: 'コメント文字演出：閉じる' }));
    expect(view.getAllByLabelText('反応ワード')[0]).not.toBeVisible();
    fireEvent.click(view.getByRole('button', { name: 'コメント文字演出：詳細を開く' }));
    expect(view.getAllByLabelText('反応ワード')[0]).toHaveValue('new');
    fireEvent.click(view.getByRole('button', { name: '追加' }));
    await waitFor(() => expect(saves.at(-1)?.rules).toHaveLength(3));
  });

  it('連動型にできない反応ワードでは保存せず方式を維持する', async () => {
    const base = createDefaultSettings().textEffects;
    const initial: TextEffectsSettings = {
      ...base,
      rules: [{ id: 'fixed', enabled: true, trigger: 'ww', displayText: '草', color: '#66cc66ff', countMode: 'fixed', fixedCount: 2 }],
    };
    const attempts = vi.fn();
    function Harness() {
      const [value, setValue] = useState(initial);
      return <TextEffectsPanel value={value} saveDeferred={setValue} saveImmediate={async (next) => {
        attempts(next);
        if (next.rules[0].countMode === 'consecutive') throw new Error('invalid');
        setValue(next);
      }} testRule={vi.fn(async () => undefined)} />;
    }
    const view = render(<Harness />);
    fireEvent.click(view.getAllByRole('button', { name: '編集' })[0]);
    fireEvent.change(view.getByLabelText('個数設定'), { target: { value: 'consecutive' } });
    await waitFor(() => expect(view.getByLabelText('個数設定')).toHaveValue('fixed'));
    expect(attempts).not.toHaveBeenCalled();
    expect(view.getByText('連動型の反応ワードは1文字で指定してください。')).toBeInTheDocument();
  });

  it('A案の順序と条件を示し、共通設定は明示的に開く', () => {
    const view = render(<TextEffectsPanel value={createDefaultSettings().textEffects} saveDeferred={vi.fn()} saveImmediate={vi.fn(async () => undefined)} testRule={vi.fn(async () => undefined)} />);
    expect(view.getByRole('switch', { name: 'コメント文字演出' })).toBeChecked();
    expect(view.getByText('「w」が2回以上連続 → 草 × 連続数')).toBeVisible();
    expect(view.queryByText('変更は自動保存されます。')).not.toBeInTheDocument();
    expect(view.getByLabelText('基本文字サイズ（px）')).toBeVisible();
    expect(view.getByLabelText('基本文字サイズ（px）').closest('details')).toBeNull();
    fireEvent.click(view.getByText('全ルール共通の見た目・上限'));
    expect(view.getByLabelText('基本文字サイズ（px）')).toBeVisible();
    expect(view.getByLabelText('落下時間（秒）')).toBeVisible();
    expect(view.getByLabelText('同時表示上限（個）')).toBeVisible();
  });

  it('固定個数型への切替でも空の反応ワードを保存せず、元の方式を保持する', () => {
    const save = vi.fn(async () => undefined);
    function Harness() { const [value, setValue] = useState(createDefaultSettings().textEffects);
      return <TextEffectsPanel value={value} saveDeferred={setValue} saveImmediate={save} testRule={vi.fn(async () => undefined)} />; }
    const view = render(<Harness />);
    fireEvent.click(view.getAllByRole('button', { name: '編集' })[0]);
    fireEvent.change(view.getByLabelText('反応ワード'), { target: { value: '' } });
    fireEvent.change(view.getByLabelText('個数設定'), { target: { value: 'fixed' } });
    expect(save).not.toHaveBeenCalled();
    expect(view.getByLabelText('個数設定')).toHaveValue('consecutive');
  });

  it('不正な色と空の数値は入力欄に残し、追加は不正なら実行しない', () => {
    const saves = vi.fn(async () => undefined);
    function Harness() { const [value, setValue] = useState(createDefaultSettings().textEffects);
      return <TextEffectsPanel value={value} saveDeferred={setValue} saveImmediate={saves} testRule={vi.fn(async () => undefined)} />; }
    const view = render(<Harness />);
    fireEvent.click(view.getAllByRole('button', { name: '編集' })[0]);
    fireEvent.change(view.getByLabelText('色（#RRGGBBAA）'), { target: { value: 'invalid' } });
    expect(view.getByLabelText('色（#RRGGBBAA）')).toHaveValue('invalid');
    expect(view.getByLabelText('色（#RRGGBBAA）')).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(view.getByLabelText('最低連続数'), { target: { value: '' } });
    expect(view.getByLabelText('最低連続数')).toHaveValue(null);
    expect(view.getByRole('button', { name: 'ルールを追加' })).toBeDisabled();
    fireEvent.click(view.getByRole('button', { name: 'ルールを追加' }));
    expect(view.getAllByLabelText('反応ワード')).toHaveLength(1);
    expect(view.queryByRole('button', { name: '追加', exact: true })).not.toBeInTheDocument();
    expect(saves).not.toHaveBeenCalled();
  });

  it('追加・削除・並び替えの失敗で元の一覧を維持し、書き戻しや重複追加をしない', async () => {
    const calls = vi.fn();
    const base = createDefaultSettings().textEffects;
    const initial = { ...base, rules: [base.rules[0], { ...base.rules[0], id: 'second', trigger: 'a' }] };
    function Harness() { const [value, setValue] = useState(initial);
      return <TextEffectsPanel value={value} saveDeferred={setValue} saveImmediate={async next => { calls(next); setValue(next); throw new Error('保存失敗'); }} testRule={vi.fn(async () => undefined)} />; }
    const view = render(<Harness />);
    fireEvent.click(view.getAllByRole('button', { name: '編集' })[0]);
    fireEvent.click(view.getByRole('button', { name: '下へ' }));
    await waitFor(() => expect(view.getByRole('button', { name: '上へ' })).toBeDisabled());
    expect(calls).toHaveBeenCalledTimes(1);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(view.getAllByRole('button', { name: '削除', exact: true })[0]);
    await waitFor(() => expect(view.getAllByRole('button', { name: '削除', exact: true })[0]).toBeEnabled());
    expect(view.getByText('2 / 50件')).toBeVisible();
    expect(calls).toHaveBeenCalledTimes(2);
    fireEvent.click(view.getByRole('button', { name: 'ルールを追加' }));
    fireEvent.change(view.getByLabelText('反応ワード'), { target: { value: 'new' } });
    fireEvent.click(view.getByRole('button', { name: '追加', exact: true }));
    await waitFor(() => expect(view.getByRole('button', { name: '追加', exact: true })).toBeEnabled());
    expect(view.getByLabelText('反応ワード')).toHaveValue('new');
    expect(view.getByText('2 / 50件')).toBeVisible();
    fireEvent.click(view.getByRole('button', { name: '追加', exact: true }));
    await waitFor(() => expect(calls).toHaveBeenCalledTimes(4));
    expect(calls.mock.calls[3][0].rules).toHaveLength(3);
  });

  it('テスト送信中は重複要求を防ぎ、全体オフでもテストできる', async () => {
    let finish!: () => void;
    const testRule = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const value = createDefaultSettings().textEffects; value.enabled = false; value.rules[0].enabled = false;
    const view = render(<TextEffectsPanel value={value} saveDeferred={vi.fn()} saveImmediate={vi.fn(async () => undefined)} testRule={testRule} />);
    const button = view.getAllByRole('button', { name: 'OBSへテスト送信' })[0]; button.focus();
    fireEvent.click(button); fireEvent.click(button);
    expect(testRule).toHaveBeenCalledTimes(1);
    expect(button).toHaveAttribute('aria-disabled', 'true');
    await act(async () => finish());
    expect(button).toHaveFocus(); expect(button).toHaveTextContent('OBSへテスト送信');
  });
});

it('初回設定のルール追加保存中は全体ONの競合保存を禁止する', async () => {
  const value = createDefaultSettings().textEffects;
  let release!: () => void;
  const save = vi.fn((_next: TextEffectsSettings) => new Promise<void>(resolve => { release = resolve; }));
  const view = render(<ManagementNavigation.Provider value={{ editor: 'textEffects', initialSetup: true, open: vi.fn(), reportError: vi.fn() }}><TextEffectsPanel value={value} saveDeferred={vi.fn()} saveImmediate={save} testRule={vi.fn()} /></ManagementNavigation.Provider>);
  fireEvent.click(view.getByRole('button', { name: 'w → 草' }));
  fireEvent.click(view.getByRole('button', { name: 'ルールを保存', exact: true }));
  const toggle = view.getByRole('switch', { name: 'コメント文字演出' });
  expect(toggle).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(toggle);
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0][0].rules).toHaveLength(value.rules.length + 1);
  await act(async () => release());
  expect(toggle).toHaveAttribute('aria-disabled', 'false');
});

it.each(['save', 'cancel', 'elsewhere'] as const)('初回設定の追加ルール終了時に操作位置を復帰し、他へ移した焦点は奪わない: %s', async action => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  function Harness() {
    const [value, setValue] = useState<TextEffectsSettings>({ ...createDefaultSettings().textEffects, rules: [] });
    const [ruleId, setRuleId] = useState('');
    return <ManagementNavigation.Provider value={{ editor: 'textEffects', initialSetup: true, open: vi.fn(), reportError: vi.fn() }}><SetupPresentation.Provider value={{ source: 'youtube', selectSource: vi.fn(), effectRuleId: ruleId, setEffectRuleId: setRuleId }}>
      <TextEffectsPanel value={value} saveDeferred={setValue} saveImmediate={async next => { await gate;setValue(next); }} testRule={vi.fn()} />
      <button>別の操作</button>
    </SetupPresentation.Provider></ManagementNavigation.Provider>;
  }
  const view = render(<Harness />);
  fireEvent.click(view.getByRole('button', { name: 'w → 草' }));
  const origin = view.getByRole('button', { name: action === 'cancel' ? 'キャンセル' : 'ルールを保存', exact: true });
  origin.focus();fireEvent.click(origin);
  const elsewhere = view.getByRole('button', { name: '別の操作' });
  if(action !== 'cancel'){
    expect(origin).toHaveFocus();
    if(action === 'elsewhere')elsewhere.focus();
    await act(async () => { release(); });
  }
  expect(origin).not.toBeInTheDocument();
  expect(action === 'elsewhere' ? elsewhere : view.getByRole('combobox', { name: '編集するルール' })).toHaveFocus();
});
