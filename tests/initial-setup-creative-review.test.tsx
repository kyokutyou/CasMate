// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { InitialSetupCreativeReview } from '../src/renderer/components/InitialSetupCreativeReview';
import { SetupCharacter } from '../src/renderer/components/SetupCharacter';
import { ManagementNavigation, SetupPresentation } from '../src/renderer/management-navigation';
import { InitialSetupStore } from '../src/main/core/initial-setup-store';
import { obsRegistrationSnapshot } from './fixtures/obs-registration-state';

afterEach(cleanup);
it.each([
  [null, null, null, false, false],
  ['/closed.png', null, null, false, true],
  ['/closed.png', '/open.png', null, true, true],
  ['/closed.png', '/open.png', '画像を確認してください。', false, false],
] as const)('口パクの準備は画像2枚と警告の有無で判定し、静止表示の準備と区別する：%s/%s/%s', (closed, open, warning, mouthReady, displayReady) => {
  const snapshot = obsRegistrationSnapshot();
  snapshot.settings.character.simple.closedAsset = closed;
  snapshot.settings.character.simple.openAsset = open;
  snapshot.character.assetWarning = warning;
  const view = { ...new InitialSetupStore('unused', false).view(snapshot), position: 'character' as const };
  const result = render(<InitialSetupCreativeReview snapshot={snapshot} view={view}>{null}</InitialSetupCreativeReview>);
  const row = result.getByText('口パクの準備').closest('div')!.querySelector('dd');
  expect(row).toHaveAttribute('data-ready', String(mouthReady));
  expect(result.getByRole('complementary', { name: '状態と動作の確認' })).toHaveAttribute('data-ready', String(displayReady));
});
it.each(['closed', 'open', 'motion'] as const)('キャラクターの操作失敗は無関係の更新で消さず、詳細で対象を直すと解除する: %s', async scope => {
  const snapshot = obsRegistrationSnapshot();
  snapshot.settings.character.simple.closedAsset = '/closed.png';
  snapshot.settings.character.simple.openAsset = '/open.png';
  const report = vi.fn();
  const navigation = { editor: 'character' as const, initialSetup: true, reportError: report, open: vi.fn() };
  const fail = vi.fn(async () => { throw new Error('操作に失敗しました'); });
  const panel = () => <ManagementNavigation.Provider value={navigation}><SetupCharacter snapshot={snapshot} upload={fail} saveMotion={fail} onError={vi.fn()} /></ManagementNavigation.Provider>;
  const result = render(panel());
  if (scope === 'motion') fireEvent.click(result.getByRole('switch', { name: '控えめな動きを使う' }));
  else fireEvent.change(result.getByLabelText(scope === 'closed' ? '口を閉じた画像（PNG）を選択' : '口を開けた画像（PNG）を選択'), { target: { files: [new File(['png'], 'image.png', { type: 'image/png' })] } });
  await waitFor(() => expect(report).toHaveBeenLastCalledWith('character', '操作に失敗しました'));
  navigation.initialSetup = false;result.rerender(panel());
  // Another saved field is unrelated to the failed operation.
  snapshot.settings.character.simple.openAsset = scope === 'open' ? '/open.png' : '/other-open.png';
  snapshot.settings.character.simple.closedAsset = scope === 'open' ? '/other-closed.png' : '/closed.png';
  result.rerender(panel());
  expect(report).toHaveBeenLastCalledWith('character', '操作に失敗しました');
  if (scope === 'motion') snapshot.settings.character.simple.motion = { ...snapshot.settings.character.simple.motion, enabled: !snapshot.settings.character.simple.motion.enabled };
  else snapshot.settings.character.simple[scope === 'closed' ? 'closedAsset' : 'openAsset'] = '/replacement.png';
  result.rerender(panel());
  navigation.initialSetup = true;result.rerender(panel());
  await waitFor(() => expect(report).toHaveBeenLastCalledWith('character', undefined));
  expect(result.container.querySelector('.setup-creative-status')).not.toHaveTextContent('操作に失敗しました');
});
it('文字演出の説明用プレビューは保存した半透明・透明の色をそのまま描画する', () => {
  const snapshot = obsRegistrationSnapshot();
  const view = { ...new InitialSetupStore('unused', false).view(snapshot), position: 'textEffects' as const };
  snapshot.settings.textEffects.rules[0].color = '#66cc6600';
  const panel = () => <SetupPresentation.Provider value={{ source: 'youtube', selectSource: vi.fn(), effectExample: 'www' }}><InitialSetupCreativeReview snapshot={snapshot} view={view}>{null}</InitialSetupCreativeReview></SetupPresentation.Provider>;
  const result = render(panel());
  expect(result.container.querySelector('.setup-effects-example>div')).toHaveStyle({ color: '#66cc6600' });
  snapshot.settings.textEffects.rules[0].color = '#66cc6680'; result.rerender(panel());
  expect(result.container.querySelector('.setup-effects-example>div')).toHaveStyle({ color: '#66cc6680' });
});
it('開口画像が読めなければ既存の管理面通知を呼び、閉口画像へ代用する', () => {
  const snapshot = obsRegistrationSnapshot(); snapshot.settings.character.simple.closedAsset = '/closed.png'; snapshot.settings.character.simple.openAsset = '/open.png';
  const view = { ...new InitialSetupStore('unused', false).view(snapshot), position: 'character' as const };
  const notify = vi.fn();
  const result = render(<SetupPresentation.Provider value={{ source: 'youtube', selectSource: vi.fn(), characterMouth: 'open' }}><InitialSetupCreativeReview snapshot={snapshot} view={view} onOpenAssetError={notify}>{null}</InitialSetupCreativeReview></SetupPresentation.Provider>);
  const images = result.container.querySelectorAll('img');
  expect(images[1]).toHaveStyle({ opacity: '1' });
  fireEvent.error(images[1]);
  expect(notify).toHaveBeenCalledOnce(); expect(images[0]).toHaveStyle({ opacity: '1' });
});
it('画像寸法の読込失敗は読み込み中のままにせず、選び直す案内を固定領域へ表示する', () => {
  const snapshot = obsRegistrationSnapshot(); snapshot.settings.character.simple.closedAsset = '/closed.png';
  snapshot.settings.character.simple.openAsset = null;
  const report = vi.fn();
  const panel = () => <ManagementNavigation.Provider value={{ editor: 'character', initialSetup: true, reportError: report, open: vi.fn() }}><SetupCharacter snapshot={snapshot} upload={vi.fn()} saveMotion={vi.fn()} onError={vi.fn()} /></ManagementNavigation.Provider>;
  const result = render(panel());
  const image = result.container.querySelector('.setup-asset-summary img')!;
  fireEvent.error(image);
  expect(result.container.querySelector('.setup-asset-summary')).toHaveTextContent('画像を読み込めません。画像を選び直してください。');
  expect(result.queryByText('画像の大きさを読み込み中')).not.toBeInTheDocument();
  expect(report).toHaveBeenLastCalledWith('character', '画像を読み込めません。画像を選び直してください。');
  snapshot.settings.character.simple.closedAsset = '/replacement.png';result.rerender(panel());
  expect(report).toHaveBeenLastCalledWith('character', undefined);
  const replacement = result.container.querySelector('.setup-asset-summary img')!;
  Object.defineProperties(replacement, { naturalWidth: { value: 512 }, naturalHeight: { value: 512 } });
  fireEvent.load(replacement);expect(result.getByText('512 × 512 px')).toBeVisible();
});
