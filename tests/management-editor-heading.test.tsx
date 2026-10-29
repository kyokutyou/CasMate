// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useContext } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ManagementShell } from '../src/renderer/components/ManagementShell';
import { ManagementNavigation, managementSections } from '../src/renderer/management-navigation';

function HomeShortcut() {
  const navigation = useContext(ManagementNavigation);
  return <button id="test-home-filter" onClick={event => navigation?.open('commentFilter', event.currentTarget)}>フィルターを開く</button>;
}
function renderShell(warning = false) {
  return render(<ManagementShell home={<HomeShortcut />} windows={null} pcStatus={null} connected
    warnings={warning ? [{ id: 'commentFilter', message: 'フィルター設定を確認してください。' }] : []} activities={[]}>
    <p>編集内容</p>
  </ManagementShell>);
}
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(cleanup);

describe('設定編集の共通見出し', () => {
  it('項目への移動は祖先だけを開き、入力と他の開閉状態を保って入口へ戻る', () => {
    function TargetShortcut() {
      const navigation = useContext(ManagementNavigation);
      return <button id="target-entry" onClick={event => navigation?.open('textEffects', event.currentTarget, 'target-summary')}>表示設定へ</button>;
    }
    render(<ManagementShell home={<TargetShortcut />} windows={null} pcStatus={null} connected warnings={[]} activities={[]}>
      <details data-testid="target-details"><summary id="target-summary">見た目</summary><input aria-label="未保存の値" defaultValue="12" /></details>
      <details data-testid="other-details"><summary>他の設定</summary></details>
    </ManagementShell>);
    const entry = screen.getByRole('button', { name: '表示設定へ' });
    fireEvent.click(entry);
    expect(document.getElementById('target-summary')).toHaveFocus();
    expect(screen.getByTestId('target-details')).toHaveAttribute('open');
    expect(screen.getByTestId('other-details')).not.toHaveAttribute('open');
    fireEvent.change(screen.getByLabelText('未保存の値'), { target: { value: '34' } });
    fireEvent.click(screen.getByRole('button', { name: '← ホームに戻る' }));
    expect(entry).toHaveFocus();
    fireEvent.click(entry);
    expect(screen.getByLabelText('未保存の値')).toHaveValue('34');
    expect(document.getElementById('target-summary')).toHaveFocus();
  });
  it('現行の全編集先の説明を短い1段落に統一し、戻る操作と入口のフォーカスを保つ', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: '設定', exact: true }));
    const entries = [...document.querySelectorAll<HTMLButtonElement>('.management-categories .management-entry')];
    expect(entries.map(entry => entry.id)).toEqual(managementSections.flatMap(section =>
      section.items.map(([id]) => `settings-${id}`)));
    for (const entry of entries) {
      fireEvent.click(entry);
      const explanation = document.querySelector('.editor-introduction')!;
      expect(explanation.querySelectorAll('p')).toHaveLength(1);
      expect(explanation.querySelector('strong')).toBeNull();
      expect(explanation.querySelector('p')!.textContent!.length).toBeLessThanOrEqual(48);
      const back = screen.getByRole('button', { name: '← 設定に戻る' });
      expect(back).toHaveTextContent(/^←$/);
      fireEvent.click(back); expect(entry).toHaveFocus();
    }
  });
  it.each(['settings', 'warning'] as const)('AIリスナーは共通の戻る操作と説明枠を使い入口へ戻る（%s）', origin => {
    render(<ManagementShell home={null} windows={null} pcStatus={null} connected
      warnings={origin === 'warning' ? [{ id: 'aiListener', message: 'AIリスナーの設定を確認してください。' }] : []} activities={[]}>
      <p>編集内容</p>
    </ManagementShell>);
    let entry: HTMLElement;
    if (origin === 'settings') {
      fireEvent.click(screen.getByRole('button', { name: '設定', exact: true }));
      entry = screen.getByRole('button', { name: /AIリスナー\s*人格・参加設定・記憶・連携/ });
      fireEvent.click(entry);
    } else {
      entry = screen.getByRole('button', { name: /要確認 1件/ });
      fireEvent.click(entry);
      fireEvent.click(screen.getByRole('button', { name: /AIリスナーの設定を確認してください。/ }));
    }
    const backPage = origin === 'settings' ? '設定' : 'ホーム';
    const back = screen.getByRole('button', { name: `← ${backPage}に戻る` });
    expect(back.textContent).toBe('←');
    expect(back).toHaveAttribute('data-icon-only', 'true');
    expect(back).toHaveAttribute('title', `${backPage}に戻る`);
    const heading = screen.getByRole('heading', { level: 1, name: 'AIリスナー' });
    expect(back.parentElement).toBe(heading.parentElement);
    const header = within(heading.closest('.editor-heading')!);
    expect(header.queryByText('人格・参加設定・記憶・連携')).toBeNull();
    expect(header.getByText('配信に参加するAIの話し方や参加先を設定します。')).toBeVisible();
    expect(document.querySelector('.editor-introduction [aria-hidden="true"]')).toHaveTextContent('◇');
    fireEvent.click(back);
    expect(entry).toHaveFocus();
  });
  it.each(['home', 'settings', 'warning'] as const)('コメント読み上げは共通見出しと説明枠を使い入口へ戻る（%s）', origin => {
    function SpeechShortcut() {
      const navigation = useContext(ManagementNavigation);
      return <button id="test-home-speech" onClick={event => navigation?.open('commentSpeech', event.currentTarget)}>読み上げを開く</button>;
    }
    render(<ManagementShell home={<SpeechShortcut />} windows={null} pcStatus={null} connected
      warnings={origin === 'warning' ? [{ id: 'commentSpeech', message: '読み上げの設定を確認してください。' }] : []} activities={[]}>
      <p>編集内容</p>
    </ManagementShell>);
    let entry: HTMLElement;
    if (origin === 'settings') {
      fireEvent.click(screen.getByRole('button', { name: '設定', exact: true }));
      entry = screen.getByRole('button', { name: /コメント読み上げ\s*話者・速度・VOICEVOX/ });
      fireEvent.click(entry);
    } else if (origin === 'warning') {
      entry = screen.getByRole('button', { name: /要確認 1件/ });
      fireEvent.click(entry);
      fireEvent.click(screen.getByRole('button', { name: /読み上げの設定を確認してください。/ }));
    } else {
      entry = screen.getByRole('button', { name: '読み上げを開く' });
      fireEvent.click(entry);
    }
    const backPage = origin === 'settings' ? '設定' : 'ホーム';
    const back = screen.getByRole('button', { name: `← ${backPage}に戻る` });
    expect(back.textContent).toBe('←');
    expect(back).toHaveAttribute('data-icon-only', 'true');
    expect(back).toHaveAttribute('title', `${backPage}に戻る`);
    const heading = screen.getByRole('heading', { level: 1, name: 'コメント読み上げ' });
    expect(heading).toHaveFocus();
    expect(back.parentElement).toBe(heading.parentElement);
    const header = within(heading.closest('.editor-heading')!);
    expect(header.queryByText('話者・速度・VOICEVOX')).toBeNull();
    expect(header.getByText('VOICEVOXで新着コメントを読み上げます。')).toBeVisible();
    expect(document.querySelector('.editor-introduction [aria-hidden="true"]')).toHaveTextContent('◇');
    fireEvent.click(back);
    expect(entry).toHaveFocus();
  });
  it('音声認識は矢印と画面名、その下に共通の説明枠を表示する', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: '設定', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: /配信者音声認識\s*マイク・認識設定・OBS表示/ }));
    const heading = screen.getByRole('heading', { level: 1, name: '配信者音声認識' });
    const back = screen.getByRole('button', { name: '← 設定に戻る' });
    expect(back.textContent).toBe('←');
    expect(back).toHaveAttribute('title', '設定に戻る');
    expect(back.parentElement).toBe(heading.parentElement);
    expect(screen.getByText('配信者の声をPC内で日本語に認識します。')).toBeVisible();
    expect(within(heading.closest('.editor-heading')!).queryByText('マイク・認識設定・OBS表示')).toBeNull();
    expect(document.querySelector('.editor-introduction [aria-hidden="true"]')).toHaveTextContent('◇');
  });
  it('コメントフィルターはA案の矢印だけの戻る操作と画面名を表示し、重複する補足を置かない', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: '設定', exact: true }));
    const entry = screen.getByRole('button', { name: /コメントフィルター\s*NGワード・アスキーアート/ });
    fireEvent.click(entry);
    const back = screen.getByRole('button', { name: '← 設定に戻る', exact: true });
    expect(back.textContent).toBe('←');
    const heading = screen.getByRole('heading', { level: 1, name: 'コメントフィルター' });
    expect(heading).toHaveFocus();
    expect(within(heading.closest('.editor-heading')!).queryByText('NGワード・アスキーアート')).toBeNull();
    fireEvent.click(back);
    expect(entry).toHaveFocus();
    expect(screen.getByRole('heading', { level: 1, name: '設定' })).toBeVisible();
  });
  it('ホームから開いた場合は矢印のアクセシブルネームと戻り先をホームにする', () => {
    renderShell();
    const entry = screen.getByRole('button', { name: 'フィルターを開く' });
    fireEvent.click(entry);
    const back = screen.getByRole('button', { name: '← ホームに戻る', exact: true });
    expect(back.textContent).toBe('←');
    fireEvent.click(back);
    expect(entry).toHaveFocus();
    expect(screen.getByRole('heading', { level: 1, name: '配信のホーム' })).toBeVisible();
  });
  it('警告から開いても同じ見出しを使い、戻ると警告入口へ復帰する', () => {
    renderShell(true);
    const entry = screen.getByRole('button', { name: '要確認 1件' });
    fireEvent.click(entry);
    fireEvent.click(screen.getByRole('button', { name: /フィルター設定を確認してください/ }));
    const back = screen.getByRole('button', { name: '← ホームに戻る', exact: true });
    expect(back.textContent).toBe('←');
    fireEvent.click(back);
    expect(entry).toHaveFocus();
  });
  it.each(['home', 'settings', 'warning'] as const)('コメント取得は共通見出しと説明枠を使い入口へ戻る（%s）', origin => {
    function SourcesShortcut() {
      const navigation = useContext(ManagementNavigation);
      return <button id="test-home-sources" onClick={event => navigation?.open('sources', event.currentTarget)}>取得を開く</button>;
    }
    render(<ManagementShell home={<SourcesShortcut />} windows={null} pcStatus={null} connected
      warnings={origin === 'warning' ? [{ id: 'sources', message: '接続先を確認してください。' }] : []} activities={[]}>
      <p>編集内容</p>
    </ManagementShell>);
    let entry: HTMLElement;
    if (origin === 'settings') {
      fireEvent.click(screen.getByRole('button', { name: '設定', exact: true }));
      entry = screen.getByRole('button', { name: /コメント取得\s*接続先・自動接続/ });
      fireEvent.click(entry);
    } else if (origin === 'warning') {
      entry = screen.getByRole('button', { name: /要確認 1件/ });
      fireEvent.click(entry);
      fireEvent.click(screen.getByRole('button', { name: /接続先を確認してください。/ }));
    } else {
      entry = screen.getByRole('button', { name: '取得を開く' });
      fireEvent.click(entry);
    }
    const backPage = origin === 'settings' ? '設定' : 'ホーム';
    const back = screen.getByRole('button', { name: `← ${backPage}に戻る` });
    expect(back.textContent).toBe('←');
    expect(back).toHaveAttribute('data-icon-only', 'true');
    expect(back).toHaveAttribute('title', `${backPage}に戻る`);
    const heading = screen.getByRole('heading', { level: 1, name: 'コメント取得' });
    expect(heading).toHaveFocus();
    expect(back.parentElement).toBe(heading.parentElement);
    const header = within(heading.closest('.editor-heading')!);
    expect(header.queryByText('接続先・自動接続')).toBeNull();
    expect(header.getByText('YouTube・Twitch・掲示板の接続先と自動接続を設定します。')).toBeVisible();
    expect(document.querySelector('.editor-introduction [aria-hidden="true"]')).toHaveTextContent('◇');
    fireEvent.click(back);
    expect(entry).toHaveFocus();
  });
  it('OBSコメント表示は共通の矢印と説明枠を使用し、一覧用の補足を繰り返さない', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: '設定', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: /OBSコメント表示\s*表示方法・表示項目・デザイン/ }));
    const back = screen.getByRole('button', { name: '← 設定に戻る', exact: true });
    expect(back.textContent).toBe('←');
    expect(back.textContent).not.toContain('に戻る');
    const heading = screen.getByRole('heading', { level: 1, name: 'OBSコメント表示' });
    expect(within(heading.closest('.editor-heading')!).queryByText('文字サイズ・表示方法')).toBeNull();
    expect(within(heading.closest('.editor-heading')!).getByText('OBSに表示するコメントの見え方を調整します。')).toBeVisible();
  });
});
