// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ManagementShell } from '../src/renderer/components/ManagementShell';
import { SettingsCard } from '../src/renderer/components/SettingsCard';

afterEach(cleanup);

const categories = [
  ['コメント', [['sources', 'コメント取得'], ['commentFilter', 'コメントフィルター'], ['nextThread', '掲示板の次スレッド作成']]],
  ['音声・AI', [['commentSpeech', 'コメント読み上げ'], ['speechRecognition', '配信者音声認識'], ['aiListener', 'AIリスナー']]],
  ['表示・演出', [['textEffects', 'コメント文字演出'], ['character', 'キャラクター'], ['commentList', 'コメント一覧']]],
  ['OBS', [['commentOverlay', 'OBSコメント表示'], ['speechRecognitionOverlay', 'OBS音声認識表示'], ['obsControl', 'OBS操作'], ['urls', 'OBSにソースを追加']]],
  ['スマホ連携', [['smartphone', 'スマホ連携']]],
  ['アプリ', [['application', 'アプリ設定']]],
] as const;

it('設定の6分類に15の入口を重複なく並べ、移動した項目の警告も表示する', () => {
  render(<ManagementShell home={null} connected pcStatus={null} windows={null}
    warnings={[{ id: 'aiListener', message: '再開が必要です。' }, { id: 'obsControl', message: 'OBS接続を確認してください。' }]} activities={[]}>
    {null}
  </ManagementShell>);
  fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: '設定', exact: true }));
  const cards = [...document.querySelectorAll('.management-categories .management-category')];
  expect(cards).toHaveLength(6);
  expect(screen.queryByRole('button', { name: 'AIリスナーの人格 ›' })).toBeNull();
  categories.forEach(([group, items], index) => {
    expect(within(cards[index] as HTMLElement).getByRole('heading', { level: 2 })).toHaveTextContent(group);
    expect([...cards[index].querySelectorAll('.management-entry')].map(entry => entry.id)).toEqual(items.map(([id]) => `settings-${id}`));
  });
  for (const id of ['aiListener', 'obsControl']) expect(within(document.getElementById(`settings-${id}`)!).getByText('要確認')).toBeVisible();
});

it.each(categories.flatMap(([, items]) => [...items]))('%sの編集先から同じ設定入口へ戻り、編集中の値を保持する', (id, title) => {
  render(<ManagementShell home={null} connected pcStatus={null} windows={null} warnings={[]} activities={[]}>
    <SettingsCard cardId={id} title={title} eyebrow=""><label>編集値<input defaultValue="" /></label></SettingsCard>
  </ManagementShell>);
  fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: '設定', exact: true }));
  const entry = document.getElementById(`settings-${id}`)!;
  fireEvent.click(entry);
  expect(screen.getByRole('heading', { level: 1, name: title })).toHaveFocus();
  fireEvent.change(screen.getByLabelText('編集値'), { target: { value: '編集中' } });
  fireEvent.click(screen.getByRole('button', { name: '← 設定に戻る' }));
  expect(entry).toHaveFocus();
  fireEvent.click(entry);
  expect(screen.getByLabelText('編集値')).toHaveValue('編集中');
});
