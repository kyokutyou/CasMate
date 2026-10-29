// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useContext } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { ManagementShell } from '../src/renderer/components/ManagementShell';
import { ManagementNavigation } from '../src/renderer/management-navigation';
import { SettingsCard } from '../src/renderer/components/SettingsCard';
import type { ManagementHistoryDirection } from '../src/shared/management-history';

function Entry() {
  const nav = useContext(ManagementNavigation)!;
  return <button id="history-entry" onClick={event => nav.open('commentFilter', event.currentTarget)}>編集する</button>;
}
function Editor() {
  const nav = useContext(ManagementNavigation)!;
  return <SettingsCard cardId="commentFilter" title="コメントフィルター" eyebrow="FILTER">
    <input id="history-draft" aria-label="下書き" defaultValue="保存前" />
    <input aria-label="IDのない下書き" defaultValue="保存前" />
    <button id="history-other" onClick={event => nav.open('aiListener', event.currentTarget)}>別の編集先</button>
  </SettingsCard>;
}
function show() {
  render(<ManagementShell home={<Entry />} live={<p>配信中の内容</p>} connected windows={null} pcStatus={null} warnings={[]} activities={[]}>
    <Editor /><SettingsCard cardId="aiListener" title="AIリスナー" eyebrow="AI"><p>AI設定</p></SettingsCard>
  </ManagementShell>);
  const body = document.querySelector('.management-body')!;
  Object.defineProperties(body, { scrollHeight: { value: 1200 }, clientHeight: { value: 400 } });
  return body;
}
async function mouse(button: 3 | 4) { await act(async () => { fireEvent.mouseUp(window, { button }); }); }
afterEach(() => { cleanup(); delete window.casmateNavigation; vi.restoreAllMocks(); });

it('マウスの戻る・進むで下書き・スクロール・フォーカスを復元する', async () => {
  const body = show();
  const entry = screen.getByRole('button', { name: '編集する' });
  body.scrollTop = 220; entry.focus(); fireEvent.click(entry);
  const input = screen.getByLabelText('下書き');
  fireEvent.change(input, { target: { value: '編集中' } }); input.focus(); body.scrollTop = 90;
  await mouse(3);
  expect(document.getElementById('page-heading')).toHaveTextContent('配信のホーム');
  expect(entry).toHaveFocus(); expect(body.scrollTop).toBe(220);
  await mouse(4);
  expect(input).toHaveValue('編集中'); expect(input).toHaveFocus(); expect(body.scrollTop).toBe(90);
});
it('ページと編集先を行き来し、履歴の端と新しい分岐を処理する', async () => {
  show(); await mouse(3);
  fireEvent.click(screen.getByRole('button', { name: '配信中', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: '設定', exact: true }));
  await mouse(3); expect(screen.getByText('配信中の内容')).toBeVisible();
  await mouse(3); expect(document.getElementById('page-heading')).toHaveTextContent('配信のホーム');
  fireEvent.click(screen.getByRole('button', { name: '編集する' }));
  await mouse(4); expect(document.getElementById('editor-heading')).toHaveTextContent('コメントフィルター');
  fireEvent.click(screen.getByRole('button', { name: '別の編集先' }));
  await mouse(3); expect(document.getElementById('editor-heading')).toHaveTextContent('コメントフィルター');
  await mouse(4); expect(document.getElementById('editor-heading')).toHaveTextContent('AIリスナー');
  fireEvent.click(screen.getByRole('button', { name: '← ホームに戻る' }));
  expect(document.getElementById('page-heading')).toHaveTextContent('配信のホーム');
});
it('モーダル中は移動せず、閉じた後に移動する', async () => {
  show(); fireEvent.click(screen.getByRole('button', { name: '編集する' }));
  const dialog = document.createElement('dialog'); dialog.open = true; document.body.append(dialog);
  await mouse(3); expect(document.getElementById('editor-heading')).toHaveTextContent('コメントフィルター');
  dialog.remove(); await mouse(3); expect(document.getElementById('page-heading')).toHaveTextContent('配信のホーム');
});
it('IDのない入力欄も履歴移動で値・スクロール・フォーカスを復元する', async () => {
  const body = show(); fireEvent.click(screen.getByRole('button', { name: '編集する' }));
  const input = screen.getByLabelText('IDのない下書き');
  fireEvent.change(input, { target: { value: '編集中' } }); input.focus(); body.scrollTop = 120;
  await mouse(3); await mouse(4);
  expect(input).toHaveValue('編集中'); expect(input).toHaveFocus(); expect(body.scrollTop).toBe(120);
});
it.each(['下書き', 'IDのない下書き'])('履歴のフォーカス先「%s」が消えた場合は編集画面の見出しへ戻す', async label => {
  show(); fireEvent.click(screen.getByRole('button', { name: '編集する' }));
  const input = screen.getByLabelText(label); input.focus();
  await mouse(3); input.remove(); await mouse(4);
  expect(document.getElementById('editor-heading')).toHaveFocus();
});
it('ElectronでもDOMだけに届くマウスの戻るを受け付ける', async () => {
  window.casmateNavigation = { subscribe: () => () => {} };
  show(); fireEvent.click(screen.getByRole('button', { name: '編集する' }));
  await mouse(3);
  expect(document.getElementById('page-heading')).toHaveTextContent('配信のホーム');
});
it('Electronの通知を購読し、解除する', async () => {
  let receive: ((direction: ManagementHistoryDirection) => void) | undefined;
  const unsubscribe = vi.fn();
  window.casmateNavigation = { subscribe(listener) { receive = listener; return unsubscribe; } };
  show(); fireEvent.click(screen.getByRole('button', { name: '編集する' }));
  await act(async () => { receive!('back'); });
  expect(document.getElementById('page-heading')).toHaveTextContent('配信のホーム');
  cleanup(); expect(unsubscribe).toHaveBeenCalledOnce();
});
it.each(['native-first', 'mouse-first'] as const)('同じクリックが両経路から届いても一度だけ移動する: %s', async order => {
  vi.spyOn(performance, 'now').mockReturnValue(0);
  let receive!: (direction: ManagementHistoryDirection) => void;
  window.casmateNavigation = { subscribe(listener) { receive = listener; return () => {}; } };
  show();
  fireEvent.click(screen.getByRole('button', { name: '配信中', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: '設定', exact: true }));
  const native = async () => { await act(async () => { receive('back'); }); };
  if (order === 'native-first') { await native(); await mouse(3); }
  else { await mouse(3); await native(); }
  expect(document.getElementById('page-heading')).toHaveTextContent('コメントと、いつもの操作');
  // A second click must still work immediately after the first pair.
  if (order === 'native-first') { await native(); await mouse(3); }
  else { await mouse(3); await native(); }
  expect(document.getElementById('page-heading')).toHaveTextContent('配信のホーム');
});
it('DOM経路だけの連続した戻る・進むをElectronでも取りこぼさない', async () => {
  window.casmateNavigation = { subscribe: () => () => {} };
  show(); fireEvent.click(screen.getByRole('button', { name: '配信中', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: '設定', exact: true }));
  await mouse(3); await mouse(3);
  expect(document.getElementById('page-heading')).toHaveTextContent('配信のホーム');
  await mouse(4); await mouse(4);
  expect(document.getElementById('page-heading')).toHaveTextContent('設定');
});
it('連続クリックの重複通知がまとめて遅れても移動を増やさない', async () => {
  let clock = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  let receive!: (direction: ManagementHistoryDirection) => void;
  window.casmateNavigation = { subscribe(listener) { receive = listener; return () => {}; } };
  show(); fireEvent.click(screen.getByRole('button', { name: '配信中', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: '設定', exact: true }));
  fireEvent.click(document.getElementById('settings-commentFilter')!);
  await act(async () => { receive('back'); });
  clock = 20;
  await act(async () => { receive('back'); });
  clock = 80;
  await mouse(3);
  clock = 90;
  await mouse(3);
  expect(document.getElementById('page-heading')).toHaveTextContent('コメントと、いつもの操作');
});

it.each([[99, 'コメントと、いつもの操作'], [100, '配信のホーム']] as const)('重複通知の判定期限を%sミリ秒で区別する', async (delay, expected) => {
  let clock = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  let receive!: (direction: ManagementHistoryDirection) => void;
  window.casmateNavigation = { subscribe(listener) { receive = listener; return () => {}; } };
  show(); fireEvent.click(screen.getByRole('button', { name: '配信中', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: '設定', exact: true }));
  await act(async () => { receive('back'); });
  clock = delay;
  await mouse(3);
  expect(document.getElementById('page-heading')).toHaveTextContent(expected);
});
