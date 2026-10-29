// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Prototype } from '../prototypes/management-ui-throwaway/prototype';
import { adjacentVariant, categories, features, parseVariant, purposeFeatures, scenarios } from '../prototypes/management-ui-throwaway/model';
import { parsePcStyle } from '../prototypes/management-ui-throwaway/PcStatus';

beforeEach(() => {
  window.history.replaceState(null, '', '/?variant=A');
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('isolated management UI exploration', () => {
  it('returns A5 settings to their entry page, scroll position and keyboard trigger with edits intact', async () => {
    window.history.replaceState(null, '', '/?variant=A5');
    const user = userEvent.setup(); render(<Prototype />);
    const main = screen.getByRole('main');
    fireEvent.scroll(main, { target: { scrollTop: 240 } });
    await user.click(screen.getByRole('button', { name: /^OBSコメント表示/ }));
    fireEvent.change(screen.getByLabelText('文字サイズ（px）'), { target: { value: '36' } });
    await user.click(screen.getByRole('button', { name: '← ホームに戻る' }));
    expect(screen.getByRole('heading', { name: '配信のホーム', level: 1 })).toBeInTheDocument();
    expect(main.scrollTop).toBe(240);
    expect(screen.getByRole('button', { name: /^OBSコメント表示/ })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: '設定', exact: true }));
    fireEvent.scroll(main, { target: { scrollTop: 320 } });
    await user.click(screen.getByRole('button', { name: /^OBSコメント表示/ }));
    expect(screen.getByLabelText('文字サイズ（px）')).toHaveValue(36);
    await user.click(screen.getByRole('button', { name: '← 設定に戻る' }));
    expect(screen.getByRole('heading', { name: '設定', level: 1 })).toBeInTheDocument();
    expect(main.scrollTop).toBe(320);
    expect(screen.getByRole('button', { name: /^OBSコメント表示/ })).toHaveFocus();
  });

  it('defaults to the adopted PC treatment while retaining explicit comparison links', () => {
    expect(parsePcStyle(null)).toBe('3');
    expect(parsePcStyle('unknown')).toBe('3');
    expect(parsePcStyle('1')).toBe('1');
    expect(parsePcStyle('2')).toBe('2');
  });
  it.each(['1', '2', '3'])('opens graph-free PC details from A5 style %s and restores keyboard focus', async style => {
    window.history.replaceState(null, '', `/?variant=A5&pc=${style}`);
    const user = userEvent.setup(); render(<Prototype />);
    const status = screen.getByRole('button', { name: /^PC状態の詳細を開く/ });
    expect(status).toHaveClass(`pc-style-${style}`);
    status.focus(); await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'PC状態' });
    expect(within(dialog).getByText('GPUメモリ使用量')).toBeInTheDocument();
    expect(within(dialog).getByText('きゃすメイト')).toBeInTheDocument();
    expect(within(dialog).getByText(/420/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('試作で表示する負荷'), 'heavy');
    await user.click(screen.getByRole('button', { name: '閉じる' }));
    expect(status).toHaveFocus();
    expect(status).toHaveAccessibleName(/高負荷/);
    expect(status).toHaveTextContent('97');
    expect(status.querySelector('.pc-tone-high')).not.toBeNull();
  });

  it('shares PC load and setting edits across three PC treatments and resets mock readings', async () => {
    window.history.replaceState(null, '', '/?variant=A5');
    const user = userEvent.setup(); render(<Prototype />);
    await user.click(screen.getByRole('button', { name: 'Twitchの接続先を変更' }));
    fireEvent.change(screen.getByLabelText('Twitch 接続先'), { target: { value: 'retained-demo' } });
    await user.click(screen.getByRole('button', { name: 'PC表示2：細いステータスバー' }));
    expect(window.location.search).toBe('?variant=A5&pc=2');
    await user.click(screen.getByRole('button', { name: /^PC状態の詳細を開く/ }));
    await user.selectOptions(screen.getByLabelText('試作で表示する負荷'), 'raised');
    await user.click(screen.getByRole('button', { name: '閉じる' }));
    await user.click(screen.getByRole('button', { name: 'PC表示3：数値を主役に' }));
    expect(screen.getByRole('button', { name: /^PC状態の詳細を開く/ })).toHaveAccessibleName(/高め/);
    await user.click(screen.getByRole('button', { name: 'Twitchの接続先を変更' }));
    expect(screen.getByLabelText('Twitch 接続先')).toHaveValue('retained-demo');
    await user.click(screen.getByRole('button', { name: '初期状態に戻す' }));
    await user.click(within(screen.getByRole('dialog', { name: '初期状態に戻す' })).getByRole('button', { name: '初期状態に戻す' }));
    expect(screen.getByRole('button', { name: /^PC状態の詳細を開く/ })).toHaveAccessibleName(/通常/);
  });

  it('opens each A5 source at its own input and retains edits through the shared settings entry', async () => {
    window.history.replaceState(null, '', '/?variant=A5');
    const user = userEvent.setup(); render(<Prototype />);
    for (const name of ['YouTube Live', 'Twitch', 'したらば']) {
      screen.getByRole('button', { name: `${name}の接続先を変更` }).focus();
      await user.keyboard('{Enter}');
      const input = screen.getByLabelText(`${name} 接続先`);
      expect(input).toHaveFocus();
      await user.clear(input);
      await user.type(input, `${name}-edited`);
      await user.click(screen.getByRole('button', { name: 'ホーム', exact: true }));
      expect(screen.getByRole('switch', { name: `${name}のコメント取得` })).toBeChecked();
    }
    await user.click(screen.getByRole('button', { name: '接続を確認', exact: true }));
    expect(screen.getByRole('heading', { name: 'コメント取得', level: 1 })).toHaveFocus();
    for (const name of ['YouTube Live', 'Twitch', 'したらば']) expect(screen.getByLabelText(`${name} 接続先`)).toHaveValue(`${name}-edited`);
  });

  it('shares A5 slim editor switches with home and supports Space and Enter', async () => {
    window.history.replaceState(null, '', '/?variant=A5');
    const user = userEvent.setup(); render(<Prototype />);
    await user.click(screen.getByRole('button', { name: 'コメント読み上げ', exact: true }));
    const toggle = screen.getByRole('switch', { name: 'コメントを読み上げる' });
    expect(toggle).toHaveClass('switch-slim');
    toggle.focus();
    await user.keyboard(' ');
    expect(toggle).not.toBeChecked();
    await user.keyboard('{Enter}');
    expect(toggle).toBeChecked();
    await user.keyboard(' ');
    await user.click(screen.getByRole('button', { name: 'ホーム', exact: true }));
    const homeToggle = screen.getByRole('switch', { name: 'コメント読み上げ', exact: true });
    expect(homeToggle).not.toBeChecked();
    await user.click(homeToggle);
    await user.click(screen.getByRole('button', { name: 'コメント読み上げ', exact: true }));
    expect(screen.getByRole('switch', { name: 'コメントを読み上げる' })).toBeChecked();
  });

  it('switches each A5 comment source independently and reflects it in the editor', async () => {
    window.history.replaceState(null, '', '/?variant=A5');
    const user = userEvent.setup(); render(<Prototype />);
    const youtube = screen.getByRole('switch', { name: 'YouTube Liveのコメント取得' });
    const twitch = screen.getByRole('switch', { name: 'Twitchのコメント取得' });
    const shitaraba = screen.getByRole('switch', { name: 'したらばのコメント取得' });
    await user.click(youtube);
    expect(youtube).toHaveAttribute('aria-checked', 'false');
    expect(twitch).toHaveAttribute('aria-checked', 'true');
    expect(shitaraba).toHaveAttribute('aria-checked', 'true');
    await user.click(twitch);
    expect(screen.queryByText('接続エラー')).not.toBeInTheDocument();
    await user.click(shitaraba);
    expect(screen.getAllByText('停止中')).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: '接続先を変更', exact: true }));
    for (const name of ['YouTube Live', 'Twitch', 'したらば']) expect(screen.getByText(`${name} 停止中`)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'ホーム', exact: true }));
    await user.click(screen.getByRole('switch', { name: 'Twitchのコメント取得' }));
    expect(screen.getByRole('switch', { name: 'Twitchのコメント取得' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'YouTube Liveのコメント取得' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('接続中')).toBeInTheDocument();
  });

  it.each(['A5', 'A6', 'A7'])('omits breadcrumbs and retains edits through the back button in %s', async variant => {
    window.history.replaceState(null, '', `/?variant=${variant}`);
    const user = userEvent.setup(); render(<Prototype />);
    expect(screen.queryByRole('button', { name: 'スイッチを比較' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '接続を確認', exact: true }));
    expect(screen.queryByRole('navigation', { name: '現在位置' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Twitch 接続先'), { target: { value: 'edited-channel' } });
    await user.click(screen.getByRole('button', { name: variant === 'A5' ? '← ホームに戻る' : '← 設定に戻る' }));
    if (variant === 'A5') await user.click(screen.getByRole('button', { name: '設定', exact: true }));
    expect(screen.getByRole('heading', { name: '設定', level: 1 })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: /^コメント取得/ }));
    expect(screen.getByLabelText('Twitch 接続先')).toHaveValue('edited-channel');
  });
  it.each(['A5', 'A6', 'A7'])('keeps the original A workflow and all areas reachable in %s', async variant => {
    window.history.replaceState(null, '', `/?variant=${variant}`);
    const user = userEvent.setup(); render(<Prototype />);
    expect(screen.getByRole('heading', { name: '配信のホーム', level: 1 })).toBeInTheDocument();
    if (variant === 'A7') await user.click(screen.getByRole('button', { name: /^音声/ }));
    const speech = screen.getByRole('switch', { name: 'コメント読み上げ', exact: true });
    expect(speech).toHaveAttribute('aria-checked', 'true');
    await user.click(speech);
    expect(speech).toHaveAttribute('aria-checked', 'false');
    await user.click(screen.getByRole('button', { name: '接続を確認', exact: true }));
    expect(screen.getByLabelText('Twitch 接続先')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Twitchに再接続' }));
    await user.click(screen.getByRole('button', { name: '設定', exact: true }));
    for (const f of features) expect(screen.getByRole('button', { name: new RegExp(`^${f.name}`) })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^スマホ音声再生/ }));
    await user.click(screen.getByRole('button', { name: '接続の案内を開く' }));
    expect(screen.getByRole('dialog', { name: 'スマホ接続の案内' })).toBeInTheDocument();
  });

  it('keeps A7 inline edits when folding and moving to the other compositions', async () => {
    window.history.replaceState(null, '', '/?variant=A7');
    const user = userEvent.setup(); render(<Prototype />);
    const audio = screen.getByRole('button', { name: /^音声/ });
    expect(audio).toHaveAttribute('aria-expanded', 'false');
    await user.click(audio);
    fireEvent.change(screen.getByLabelText('読み上げ速度'), { target: { value: '1.3' } });
    await user.click(screen.getByRole('button', { name: /^表示・スマホ/ }));
    expect(screen.queryByLabelText('読み上げ速度')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^スマホから映像を送る/ }));
    expect(screen.getByRole('heading', { name: 'Android外配信', level: 1 })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'A6：操作と設定を左右に' }));
    await user.click(screen.getByRole('button', { name: 'コメント読み上げ', exact: true }));
    expect(screen.getByLabelText('読み上げ速度')).toHaveValue(1.3);
    await user.click(screen.getByRole('button', { name: 'A5：元のAを磨く' }));
    await user.click(screen.getByRole('button', { name: /^OBSコメント表示/ }));
    expect(screen.getByLabelText('文字サイズ（px）')).toBeInTheDocument();
  });

  it('supports deep links and wraparound through all sixteen alternatives', () => {
    expect(parseVariant('C3')).toBe('C3');
    expect(parseVariant('V2')).toBe('V2');
    expect(parseVariant('unknown')).toBe('A');
    expect(adjacentVariant('C', 1)).toBe('C1');
    expect(parseVariant('A2')).toBe('A2');
    expect(adjacentVariant('V3', 1)).toBe('A1');
    expect(adjacentVariant('A7', 1)).toBe('A');
    expect(adjacentVariant('A', -1)).toBe('A7');
  });

  it('shows operational states in refined A and recovers a source without leaving home', async () => {
    window.history.replaceState(null, '', '/?variant=A4');
    const user = userEvent.setup(); render(<Prototype />);
    await user.click(screen.getByRole('button', { name: 'Twitchを再接続' }));
    expect(screen.getByRole('heading', { name: '配信のホーム' })).toBeInTheDocument();
    expect(screen.queryByText('接続切れ')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'YouTube Liveを停止' }));
    await user.click(screen.getByRole('button', { name: 'YouTube Liveの接続先を変更' }));
    expect(screen.getByText('YouTube Live 停止中')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('YouTube Live 接続先'), { target: { value: 'sample-updated' } });
    await user.click(screen.getByRole('button', { name: 'ホーム', exact: true }));
    expect(screen.getByRole('button', { name: 'YouTube Liveの接続先を変更' })).toHaveTextContent('sample-updated');
    await user.click(screen.getByRole('button', { name: 'コメント一覧を閉じる' }));
    expect(screen.getByRole('button', { name: 'コメント一覧を開く' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '読み上げをオフにする' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '設定', exact: true }));
    for (const f of features) expect(screen.getByRole('button', { name: new RegExp(`^${f.name}`) })).toBeInTheDocument();
  });

  it('distinguishes preparation and manual restart from enabled state in refined A', async () => {
    window.history.replaceState(null, '', '/?variant=A4');
    const user = userEvent.setup(); render(<Prototype />);
    await user.click(screen.getByRole('button', { name: '比べ方・記録' }));
    await user.click(screen.getByRole('button', { name: '読み上げの準備中' }));
    expect(screen.getByText('VOICEVOXの準備中')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '読み上げをオフにする' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '比べ方・記録' }));
    await user.click(screen.getByRole('button', { name: 'AIの手動再開待ち' }));
    expect(screen.getByText('手動再開待ち')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '確認して再開' }));
    expect(screen.getByText('発言のタイミングを待機')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'AIを停止' }));
    expect(screen.getByRole('button', { name: 'AIを開始' })).toBeInTheDocument();
  });

  it.each(['A1', 'A2', 'A3'])('keeps home and settings separate and all areas reachable in %s', async variant => {
    window.history.replaceState(null, '', `/?variant=${variant}`);
    const user = userEvent.setup(); const view = render(<Prototype />);
    expect(screen.getByRole('heading', { name: '配信のホーム', level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '用途' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '設定', exact: true }));
    const found = new Set<string>();
    if (variant === 'A3') {
      for (const c of categories) {
        await user.click(within(screen.getByRole('main')).getByRole('button', { name: new RegExp(c.name) }));
        for (const f of features.filter(f => f.category === c.id)) {
          expect(screen.getByRole('button', { name: f.name, exact: true })).toBeInTheDocument();
          found.add(f.id);
        }
        await user.click(screen.getByRole('button', { name: /分類を選び直す/ }));
      }
    } else {
      for (const details of view.container.querySelectorAll('main details')) {
        if (!details.hasAttribute('open')) await user.click(details.querySelector('summary')!);
      }
      for (const f of features) {
        expect(screen.getByRole('button', { name: f.name, exact: true })).toBeInTheDocument();
        found.add(f.id);
      }
    }
    expect(found.size).toBe(14);
    await user.click(screen.getByRole('button', { name: 'ホーム', exact: true }));
    expect(screen.getByRole('heading', { name: '配信のホーム', level: 1 })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /設定を確認/ }));
    expect(screen.getByLabelText('Twitch 接続先')).toBeVisible();
  });

  it('retains shared edits and lets the A3 dock operate while editing', async () => {
    window.history.replaceState(null, '', '/?variant=A1');
    const user = userEvent.setup(); render(<Prototype />);
    await user.click(screen.getByRole('button', { name: 'コメント読み上げ', exact: true }));
    fireEvent.change(screen.getByLabelText('読み上げ速度'), { target: { value: '1.7' } });
    await user.click(screen.getByRole('button', { name: 'A3：操作バー付きホーム' }));
    await user.click(screen.getByRole('button', { name: /音声/ }));
    await user.click(screen.getByRole('button', { name: 'コメント読み上げ', exact: true }));
    expect(screen.getByLabelText('読み上げ速度')).toHaveValue(1.7);
    await user.click(screen.getByRole('button', { name: '読み上げを切り替え', exact: true }));
    expect(screen.getByRole('switch', { name: 'コメントを読み上げる' })).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'A2：下部タブのホーム' }));
    await user.click(screen.getByRole('button', { name: '設定', exact: true }));
    await user.type(screen.getByRole('textbox', { name: 'すべての設定を検索' }), '速度');
    await user.click(screen.getByRole('button', { name: 'コメント読み上げ', exact: true }));
    expect(screen.getByLabelText('読み上げ速度')).toHaveValue(1.7);
  });

  it.each(['C1', 'C2', 'C3', 'V1', 'V2', 'V3'])('keeps all 14 areas reachable in %s', async variant => {
    window.history.replaceState(null, '', `/?variant=${variant}`);
    const user = userEvent.setup(); const view = render(<Prototype />);
    const found = new Set<string>();
    for (const purpose of Object.keys(purposeFeatures)) {
      await user.click(screen.getByRole('button', { name: new RegExp(`0[123]\\s*${purpose}`) }));
      for (const details of view.container.querySelectorAll('main details')) {
        if (!details.hasAttribute('open')) await user.click(details.querySelector('summary')!);
      }
      for (const feature of features) {
        const buttons = within(screen.getByRole('main')).queryAllByRole('button', { name: new RegExp(`^${feature.name}`) });
        if (buttons.length) found.add(feature.id);
      }
    }
    expect([...found].sort()).toEqual(features.map(f => f.id).sort());
    await user.click(screen.getByRole('button', { name: /設定を確認/ }));
    expect(screen.getByLabelText('Twitch 接続先')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Twitch 接続先'), { target: { value: 'new_demo' } });
    await user.click(screen.getByRole('button', { name: 'Twitchに再接続' }));
    expect(screen.queryByText('Twitchの接続を確認してください')).not.toBeInTheDocument();
  });

  it('filters C3 by setting labels and restores the list after an empty search', async () => {
    window.history.replaceState(null, '', '/?variant=C3');
    const user = userEvent.setup(); render(<Prototype />);
    await user.type(screen.getByRole('textbox', { name: 'この用途の設定を検索' }), '人格');
    expect(screen.getByRole('button', { name: 'AIリスナー', exact: true })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'コメント取得', exact: true })).not.toBeInTheDocument();
    await user.clear(screen.getByRole('textbox', { name: 'この用途の設定を検索' }));
    await user.type(screen.getByRole('textbox', { name: 'この用途の設定を検索' }), '存在しない項目');
    expect(screen.getByText('該当する設定がありません')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '検索をクリア' }));
    expect(screen.getByRole('button', { name: 'コメント取得', exact: true })).toBeInTheDocument();
  });

  it('shares settings across groups and expands V3 editing in place', async () => {
    window.history.replaceState(null, '', '/?variant=C1');
    const user = userEvent.setup(); render(<Prototype />);
    await user.click(screen.getByRole('button', { name: 'コメント読み上げ', exact: true }));
    fireEvent.change(screen.getByLabelText('読み上げ速度'), { target: { value: '1.6' } });
    await user.click(screen.getByRole('button', { name: '縦長の3案' }));
    await user.click(screen.getByRole('button', { name: 'V3：縦長・その場で編集' }));
    const trigger = screen.getByRole('button', { name: /^コメント読み上げ/ });
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('読み上げ速度')).toHaveValue(1.6);
    expect(screen.getByRole('heading', { name: '配信準備', level: 1 })).toBeInTheDocument();
    await user.click(trigger);
    expect(screen.queryByLabelText('読み上げ速度')).not.toBeInTheDocument();
    await user.click(trigger);
    expect(screen.getByLabelText('読み上げ速度')).toHaveValue(1.6);
  });
  it('preserves edits across A/B/C and never sends or persists settings', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem');
    render(<Prototype />);
    await user.click(screen.getByRole('button', { name: 'コメント読み上げ' }));
    await user.selectOptions(screen.getByLabelText('話者・スタイル'), '四国めたん / ノーマル');
    fireEvent.change(screen.getByLabelText('読み上げ速度'), { target: { value: '1.4' } });
    await user.click(screen.getByRole('button', { name: 'B：左メニュー' }));
    expect(window.location.search).toBe('?variant=B');
    await user.click(screen.getByRole('button', { name: '音声', exact: true }));
    await user.click(screen.getByRole('button', { name: /コメント読み上げ.*声/ }));
    expect(screen.getByLabelText('読み上げ速度')).toHaveValue(1.4);
    await user.click(screen.getByRole('button', { name: 'C：用途別タブ' }));
    await user.click(screen.getByRole('button', { name: /コメント読み上げ.*声/ }));
    expect(screen.getByLabelText('話者・スタイル')).toHaveValue('四国めたん / ノーマル');
    await user.click(screen.getByRole('button', { name: '声を試す' }));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(storageSpy).not.toHaveBeenCalled();
  });

  it.each(['A', 'B', 'C'])('offers every existing area in variant %s', async variant => {
    window.history.replaceState(null, '', `/?variant=${variant}`);
    const user = userEvent.setup(); render(<Prototype />);
    expect(features).toHaveLength(14);
    if (variant === 'A') {
      await user.click(screen.getByRole('button', { name: '設定', exact: true }));
      for (const feature of features) expect(screen.getByRole('button', { name: new RegExp(`^${feature.name}`) })).toBeInTheDocument();
    } else if (variant === 'B') {
      for (const category of categories) {
        await user.click(screen.getByRole('button', { name: category.name, exact: true }));
        for (const feature of features.filter(f => f.category === category.id)) expect(within(screen.getByRole('main')).getByRole('button', { name: new RegExp(`^${feature.name}`) })).toBeInTheDocument();
      }
    } else {
      expect(new Set(Object.values(purposeFeatures).flat()).size).toBe(14);
      for (const [purpose, ids] of Object.entries(purposeFeatures)) {
        await user.click(screen.getByRole('button', { name: new RegExp(`0[123]\\s*${purpose}`) }));
        for (const id of ids) expect(screen.getByRole('button', { name: new RegExp(`\\d+\\s*${features.find(f => f.id === id)!.name}`) })).toBeInTheDocument();
      }
    }
  });

  it('routes a warning to editable connection settings and simulates recovery', async () => {
    const user = userEvent.setup(); render(<Prototype />);
    await user.click(screen.getByRole('button', { name: /設定を確認/ }));
    expect(screen.getByRole('heading', { name: 'コメント取得', level: 1 })).toHaveFocus();
    await user.clear(screen.getByLabelText('Twitch 接続先'));
    await user.type(screen.getByLabelText('Twitch 接続先'), 'edited_demo');
    await user.click(screen.getByRole('button', { name: 'Twitchに再接続' }));
    expect(screen.queryByText('Twitchの接続を確認してください')).not.toBeInTheDocument();
    expect(screen.getByText('Twitch 接続中')).toBeInTheDocument();
  });

  it('opens optional previews and mobile instructions, and preserves persona edits', async () => {
    const user = userEvent.setup(); render(<Prototype />);
    await user.click(screen.getByRole('button', { name: 'AIリスナー', exact: true }));
    fireEvent.change(screen.getByLabelText('人格の名前'), { target: { value: 'あおい' } });
    await user.click(screen.getByRole('button', { name: '人格を保存' }));
    await user.click(screen.getByRole('button', { name: 'ホーム', exact: true }));
    await user.click(screen.getByRole('button', { name: 'OBSコメント表示', exact: true }));
    fireEvent.change(screen.getByLabelText('文字サイズ（px）'), { target: { value: '36' } });
    await user.click(screen.getByRole('button', { name: 'プレビューを開く' }));
    expect(screen.getByRole('dialog', { name: '表示プレビュー' })).toBeInTheDocument();
    expect(screen.getByText('こんばんは！ 今日も楽しみにしていました。')).toHaveStyle({ fontSize: '36px' });
    await user.click(screen.getByRole('button', { name: '閉じる' }));
    expect(screen.getByRole('button', { name: 'プレビューを開く' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'ホーム', exact: true }));
    await user.click(screen.getByRole('button', { name: 'スマホ音声再生', exact: true }));
    await user.click(screen.getByRole('button', { name: '接続の案内を開く' }));
    expect(screen.getByRole('dialog', { name: 'スマホ接続の案内' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '閉じる' }));
    await user.click(screen.getByRole('button', { name: 'ホーム', exact: true }));
    await user.click(screen.getByRole('button', { name: 'AIリスナー', exact: true }));
    expect(screen.getByLabelText('人格の名前')).toHaveValue('あおい');
  });

  it('records navigation, scroll and notes, then resets', async () => {
    const user = userEvent.setup(); render(<Prototype />);
    await user.click(screen.getByRole('button', { name: '比べ方・記録' }));
    await user.selectOptions(screen.getByLabelText('試す操作'), scenarios[5]);
    await user.click(screen.getByRole('button', { name: 'この案で計測を始める' }));
    await user.click(screen.getByRole('button', { name: /設定を確認/ }));
    fireEvent.scroll(screen.getByRole('main'), { target: { scrollTop: 125 } });
    await user.click(screen.getByRole('button', { name: '計測を記録' }));
    expect(screen.getByText('移動 1回 · スクロール 125px')).toBeInTheDocument();
    await user.type(screen.getByLabelText('迷った場所・良かった点'), '警告からすぐ開けた');
    await user.click(screen.getByRole('button', { name: 'この結果を記録' }));
    expect(screen.getByText('警告からすぐ開けた')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '閉じる' }));
    await user.click(screen.getByRole('button', { name: '初期状態に戻す' }));
    await user.click(within(screen.getByRole('dialog', { name: '初期状態に戻す' })).getByRole('button', { name: '初期状態に戻す' }));
    expect(screen.getByRole('heading', { name: '配信のホーム' })).toBeInTheDocument();
  });

  it('keeps arrow keys inside inputs and dialogs, switches variants elsewhere', async () => {
    const user = userEvent.setup(); render(<Prototype />);
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(window.location.search).toBe('?variant=B');
    await user.click(screen.getByRole('button', { name: /設定を確認/ }));
    fireEvent.keyDown(screen.getByLabelText('Twitch 接続先'), { key: 'ArrowRight' });
    expect(window.location.search).toBe('?variant=B');
    await user.click(screen.getByRole('button', { name: '比べ方・記録' }));
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(window.location.search).toBe('?variant=B');
  });
});
