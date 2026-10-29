// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ObsUrlsPanel } from '../src/renderer/components/ObsUrlsPanel';
import { SmartphonePanel } from '../src/renderer/components/SmartphonePanel';
import { smartphoneDirectView, smartphoneMobileState, smartphoneView } from './fixtures/smartphone-view';
import { smartphoneNetworkNames } from '../src/shared/smartphone';

beforeEach(() => {
  localStorage.clear();
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('4つの表示はそれぞれの対象で共通登録へ進み、管理画面とコメント一覧を対象にしない', () => {
  const onRegisterSource = vi.fn();
  render(<ObsUrlsPanel baseUrl="http://127.0.0.1:4000" onRegisterSource={onRegisterSource}
    onSuccess={vi.fn()} onError={vi.fn()} onOperationStart={vi.fn()} />);
  for (const [overlay, title] of [['comments', 'コメント'], ['speech', '音声認識'], ['character', 'キャラクター'], ['effects', '文字演出']]) {
    const entry = screen.getByRole('button', { name: `${title}をOBSに追加` }); fireEvent.click(entry);
    expect(onRegisterSource).toHaveBeenLastCalledWith({ target: { kind: 'overlay', overlay }, title, entry });
  }
  expect(onRegisterSource).toHaveBeenCalledTimes(4);
  expect(screen.queryByRole('button', { name: '管理画面をOBSに追加' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'コメント一覧をOBSに追加' })).toBeNull();
});

it('共通登録コールバックのない単独表示では追加ボタンから既存の手動案内を開く', () => {
  render(<ObsUrlsPanel baseUrl="http://127.0.0.1:3000" onSuccess={vi.fn()} onError={vi.fn()} onOperationStart={vi.fn()} />);
  const guide = screen.getByText('手動でOBSに追加する').closest('details')!;
  expect(guide.open).toBe(false); fireEvent.click(screen.getByRole('button', { name: 'コメントをOBSに追加' }));
  expect(guide.open).toBe(true); expect(guide.querySelector('summary')).toHaveFocus();
  expect(screen.getByText('URL欄に貼り付ける')).toBeVisible();
});

function phoneProps(view = smartphoneView) {
  return { view, mobile: smartphoneMobileState, audioSettings: { lanEnabled: true, tailscaleEnabled: false, bitrateKbps: 32 },
    changeAudio: vi.fn(), configure: vi.fn(async () => undefined), deviceAction: vi.fn(async () => undefined),
    invitation: vi.fn(), obsInput: vi.fn(async () => 'udp://127.0.0.1:10001'), onSuccess: vi.fn(), onRegisterSource: vi.fn() };
}

it.each(['lan', 'tailscale', 'direct'] as const)('スマホの%s入口は端末共通入力を使い、OFFや未登録でも追加できる', network => {
  const props = phoneProps(smartphoneDirectView); render(<SmartphonePanel {...props} />);
  fireEvent.click(screen.getByRole('button', { name: smartphoneNetworkNames[network] }));
  const entry = screen.getByRole('button', { name: 'スマホAの映像をOBSに追加' }); fireEvent.click(entry);
  expect(props.onRegisterSource).toHaveBeenCalledOnce();
  expect(props.onRegisterSource).toHaveBeenLastCalledWith(expect.objectContaining({ target: { kind: 'smartphone', deviceId: smartphoneView.devices[0].id }, entry, title: 'スマホA' }));
  expect(props.onRegisterSource.mock.calls[0][0].blockedReason).toBeUndefined();
  expect(props.configure).not.toHaveBeenCalled(); expect(props.deviceAction).not.toHaveBeenCalled(); expect(props.obsInput).not.toHaveBeenCalled(); expect(props.invitation).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('未保存の入力は共通登録と復旧入口の自動追加に同じ理由を伝える', () => {
  const props = phoneProps(); const onRegistrationBlockedChange = vi.fn();
  render(<SmartphonePanel {...props} onRegistrationBlockedChange={onRegistrationBlockedChange} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'スマホAの名前' }), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'スマホAの映像をOBSに追加' }));
  expect(props.onRegisterSource.mock.calls[0][0].blockedReason).toContain('未保存');
  expect(onRegistrationBlockedChange).toHaveBeenLastCalledWith(expect.stringContaining('未保存'));
  expect(props.deviceAction).not.toHaveBeenCalled(); expect(props.obsInput).not.toHaveBeenCalled();
});
