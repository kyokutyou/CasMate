// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import QRCode from 'qrcode';
import { ManagementShell } from '../src/renderer/components/ManagementShell';
import { SmartphonePanel } from '../src/renderer/components/SmartphonePanel';
import { smartphoneView, smartphoneMobileState, smartphoneDirectView } from './fixtures/smartphone-view';
import { smartphoneNetworkNames, type SmartphoneInvitation } from '../src/shared/smartphone';

vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn(async () => 'data:image/png;base64,test') } }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
function setup(warnings: Parameters<typeof ManagementShell>[0]['warnings'] = []) {
  const configure = vi.fn(async () => undefined); const changeAudio = vi.fn(); const onSuccess = vi.fn();
  const deviceAction = vi.fn(async () => undefined);
  const invitation = vi.fn(async (): Promise<SmartphoneInvitation> => ({ type: 'casmate.outdoor', version: 11,
    pcId: '22222222-2222-4222-8222-222222222222', registrationPort: 3001, token: 'a'.repeat(64), network: 'lan', comments: { url: smartphoneView.networks.lan.commentsUrl! } }));
  const props = { view: smartphoneView, mobile: smartphoneMobileState, audioSettings: { lanEnabled: true, tailscaleEnabled: false, bitrateKbps: 32 },
    configure, changeAudio, onSuccess, deviceAction, invitation, obsInput: vi.fn(async () => 'udp://127.0.0.1:10001'), directAction: vi.fn(async () => undefined),
    listAdapters: vi.fn(async () => [{ id: '{de98a742-172b-470f-8aa3-8d2dfc560a21}', name: 'イーサネット 2', description: 'ASIX USB to Gigabit Ethernet Family Adapter', addresses: [{ family: 'ipv4' as const, address: '192.168.10.107' }], preferred: true }]) };
  const page = (view = smartphoneView, saveError?: string, mobile = smartphoneMobileState) => <ManagementShell home={null} windows={null} connected pcStatus={null} warnings={warnings} activities={[]}><SmartphonePanel {...props} view={view} saveError={saveError} mobile={mobile} /></ManagementShell>;
  const rendered = render(page());
  fireEvent.click(screen.getByRole('button', { name: /スマホ連携/ }));
  return { ...props, updateView: (view: typeof smartphoneView, saveError?: string, mobile = smartphoneMobileState) => rendered.rerender(page(view, saveError, mobile)) };
}
function openDetails(name: string) { fireEvent.click(screen.getByText(name).closest('summary')!); }
function nameInput(name = 'スマホA') {
  const input = screen.getByRole('textbox', { name: `${name}の名前`, hidden: true });
  const details = input.closest('details')!;
  if (!details.open) fireEvent.click(details.querySelector('summary')!);
  return screen.getByRole('textbox', { name: `${name}の名前` });
}

it.each([false, true])('名前の後続保存は先行保存の失敗を引き継がず、自身の失敗だけを示す（後続失敗=%s）', async laterFails => {
  vi.useFakeTimers();
  try {
    const p = setup(); let rejectFirst!: (reason: Error) => void;
    p.deviceAction.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectFirst = reject; }));
    if (laterFails) p.deviceAction.mockRejectedValueOnce(new Error('保存B失敗'));
    const input = nameInput();
    fireEvent.change(input, { target: { value: '名前A' } });
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(p.deviceAction).toHaveBeenCalledTimes(1);
    fireEvent.change(input, { target: { value: '名前B' } });
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(p.deviceAction).toHaveBeenCalledTimes(1);
    await act(async () => { rejectFirst(new Error('保存A失敗')); });
    expect(p.deviceAction).toHaveBeenNthCalledWith(2, smartphoneView.devices[0].id, 'rename', '名前B');
    if (laterFails) {
      expect(p.onSuccess).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: '要確認 1件' }));
      expect(screen.getByRole('dialog')).toHaveTextContent('保存B失敗');
      expect(screen.getByRole('dialog')).not.toHaveTextContent('保存A失敗');
    } else {
      expect(p.onSuccess).toHaveBeenCalledWith('スマホの設定を保存しました。');
      expect(screen.getByRole('button', { name: '要確認 0件' })).toBeVisible();
      fireEvent.click(screen.getByRole('button', { name: '← ホームに戻る' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    }
    expect(screen.queryByText('保存A失敗', { exact: false })).not.toBeInTheDocument();
    expect(input).toHaveValue('名前B');
  } finally { vi.useRealTimers(); }
});

it('採用した接続カードの順序と常設操作を示し、名前編集だけを閉じた詳細に置く', () => {
  const p = setup();
  const cards = within(screen.getByLabelText('利用するネットワーク')).getAllByRole('button');
  expect(cards.map(card => card.getAttribute('aria-label'))).toEqual([smartphoneNetworkNames.lan, smartphoneNetworkNames.direct, smartphoneNetworkNames.tailscale]);
  expect(screen.getByRole('heading', { name: 'スマホを登録する' })).toBeVisible();
  expect(screen.getByRole('heading', { name: '登録済みのスマホ' })).toBeVisible();
  const input = screen.getByRole('textbox', { name: 'スマホAの名前', hidden: true });
  expect(input.closest('details')).not.toHaveAttribute('open'); expect(input).not.toBeVisible();
  expect(screen.getByRole('heading', { name: 'スマホA' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'スマホAの映像をOBSに追加' })).toBeVisible();
  expect(screen.getByRole('button', { name: '読み上げ設定を開く' })).toBeVisible();
  expect(screen.getByText('スマホ側で確認')).toBeVisible();
  expect(p.configure).not.toHaveBeenCalled(); expect(p.deviceAction).not.toHaveBeenCalled();
});

it('下部一覧を常設し、詳細設定だけ開閉して画面往復と経路変更で保持する', () => {
  const p = setup();
  const details = document.querySelector<HTMLDetailsElement>('.sp-advanced')!;
  expect(details.open).toBe(false);
  expect(screen.getByRole('heading', { name: 'ブラウザでコメントを見る' })).toBeVisible();
  expect(screen.getByRole('spinbutton', { name: '音質（kbps）' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'OBS操作の設定' })).toBeVisible();
  fireEvent.click(details.querySelector('summary')!);
  fireEvent.click(screen.getByRole('button', { name: smartphoneNetworkNames.tailscale }));
  fireEvent.click(screen.getByRole('button', { name: '← ホームに戻る' }));
  fireEvent.click(screen.getByRole('button', { name: /スマホ連携/ }));
  expect(details.open).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'OBS操作の設定' }));
  expect(screen.getByRole('heading', { name: 'OBS操作' })).toBeVisible();
  expect(p.configure).not.toHaveBeenCalled(); expect(p.changeAudio).not.toHaveBeenCalled();
});

it('読み上げの設定入口と利用状況を常設し、ブラウザURLと音質も常設する', () => {
  const p = setup();
  const section = screen.getByRole('region', { name: 'コメント・読み上げの接続案内' });
  const browser = within(section).getByRole('region', { name: 'ブラウザで開く' });
  const speech = screen.getByRole('region', { name: '読み上げ音声をスマホへ送る' });
  expect(speech.closest('details')).toBeNull();
  expect(screen.queryByRole('switch', { name: /コメント|読み上げ/ })).toBeNull();
  expect(within(browser).getByRole('button', { name: 'URLをコピー' })).toBeVisible();
  expect(within(speech).getByText('音声接続 3台')).toBeVisible();
  expect(within(speech).getByText('家庭内LAN')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: smartphoneNetworkNames.tailscale }));
  expect(within(speech).getByText('家庭内LAN')).toBeVisible();
  expect(section).not.toHaveTextContent(/待ち \d+件|破棄累計|いつでも利用|OBSの準備は不要|以下は現在ON/);
  expect(screen.getByRole('spinbutton', { name: '音質（kbps）' })).toBeVisible();
  const rate = screen.getByRole('spinbutton', { name: '音質（kbps）' });
  fireEvent.change(rate, { target: { value: '129' } }); expect(p.changeAudio).not.toHaveBeenCalled();
  expect(rate).toHaveAttribute('aria-invalid', 'true');
  fireEvent.change(rate, { target: { value: '64' } }); expect(p.changeAudio).toHaveBeenCalledWith({ ...p.audioSettings, bitrateKbps: 64 });
  p.updateView(smartphoneView, undefined, { ...smartphoneMobileState, audioAvailable: false });
  expect(within(speech).getByText('読み上げ設定を確認')).toBeVisible();
  expect(within(section).queryByRole('button', { name: '読み上げを聞く' })).toBeNull();
  fireEvent.click(within(speech).getByRole('button', { name: '読み上げ設定を開く' }));
  expect(screen.getByRole('heading', { name: 'コメント読み上げ' })).toBeVisible();
});

it('直接接続ではブラウザURLを出さず、共通QRの案内とAndroidの開始操作を示す', () => {
  const p = setup(); p.updateView(smartphoneDirectView);
  fireEvent.click(screen.getByRole('button', { name: /^PC・スマホ直接接続/ }));

  const section = screen.getByRole('region', { name: 'コメント・読み上げの接続案内' });
  expect(within(section).getByRole('heading', { name: 'Androidで利用する' })).toBeVisible();
  expect(within(section).queryByRole('button', { name: 'URLをコピー' })).toBeNull();
  expect(section).not.toHaveTextContent('ブラウザの「読み上げを聞く」');
  expect(within(screen.getByRole('region', { name: '読み上げ音声をスマホへ送る' })).getByText('直接接続')).toBeVisible();
});
function selectDirectRoute(name: '外出先のスマホ' | '自宅のルーター' | 'このPCの受信') {
  fireEvent.click(screen.getByRole('tab', { name: new RegExp(name) }));
}
function selectUdpDevice(id: string) {
  fireEvent.change(screen.getByRole('combobox', { name: '公開UDPを設定するスマホ' }), { target: { value: id } });
}

it('接続先の即時保存で不正な公開TCP入力を消さず、更新だけでは保存しない', async () => {
  const p = setup();
  openDetails('接続の詳細設定');
  const direct = { mode: 'manual' as const, interfaceId: null, manualEndpoints: [], manualSrtEndpoints: [] };
  p.updateView({ ...smartphoneView, settings: { ...smartphoneView.settings, direct } });
  fireEvent.click(screen.getByRole('button', { name: /^PC・スマホ直接接続/ }));
  const tcp = screen.getByRole('textbox', { name: '共通TCP 候補1の公開IP' });
  fireEvent.change(tcp, { target: { value: 'invalid draft' } });
  selectDirectRoute('このPCの受信');
  const select = screen.getByRole('combobox', { name: 'PCの接続先ネットワーク' });
  await waitFor(() => expect(select.hasAttribute('disabled')).toBe(false));
  fireEvent.change(select, { target: { value: '{de98a742-172b-470f-8aa3-8d2dfc560a21}' } });
  await waitFor(() => expect(p.configure).toHaveBeenCalledWith({ network: 'direct', direct: { interfaceId: '{de98a742-172b-470f-8aa3-8d2dfc560a21}' } }));
  p.updateView({ ...smartphoneView, settings: { ...smartphoneView.settings, direct: { ...direct, interfaceId: '{de98a742-172b-470f-8aa3-8d2dfc560a21}' } } });
  p.configure.mockClear(); fireEvent.click(screen.getByRole('button', { name: '一覧を更新' }));
  await waitFor(() => expect(p.listAdapters).toHaveBeenCalledTimes(2)); expect(p.configure).not.toHaveBeenCalled();
  selectDirectRoute('自宅のルーター');
  expect(screen.getByRole('textbox', { name: '共通TCP 候補1の公開IP' })).toBe(tcp);
  expect(tcp).toHaveValue('invalid draft');
});

it.each(['manual', 'auto'] as const)('開放方法を%sへ選択した値を保存キューへ渡し、保存後の表示に反映する', async mode => {
  const p = setup();
  openDetails('接続の詳細設定');
  const direct = { mode: mode === 'manual' ? 'auto' as const : 'manual' as const, interfaceId: null, manualEndpoints: [], manualSrtEndpoints: [] };
  p.updateView({ ...smartphoneView, settings: { ...smartphoneView.settings, direct } });
  fireEvent.click(screen.getByRole('button', { name: /^PC・スマホ直接接続/ }));
  const selected = screen.getByRole('button', { name: mode === 'auto' ? /自動で開放/ : /ルーターで手動設定/ });
  fireEvent.click(selected);
  await waitFor(() => expect(p.configure).toHaveBeenCalledExactlyOnceWith({ network: 'direct', direct: { mode } }));
  p.updateView({ ...smartphoneView, settings: { ...smartphoneView.settings, direct: { ...direct, mode } } });
  expect(selected).toHaveAttribute('aria-pressed', 'true');
  const input = screen.getByRole('textbox', { name: '共通TCP 候補1の公開IP', hidden: true });
  if (mode === 'manual') expect(input).toBeVisible(); else expect(input).not.toBeVisible();
});

it('開放方法の即時保存でも不正な共通TCPの下書きを保持する', async () => {
  const p = setup(); openDetails('接続の詳細設定');
  const direct = { mode: 'manual' as const, interfaceId: null, manualEndpoints: [], manualSrtEndpoints: [] };
  p.updateView({ ...smartphoneView, settings: { ...smartphoneView.settings, direct } });
  fireEvent.click(screen.getByRole('button', { name: /^PC・スマホ直接接続/ }));
  const input = screen.getByRole('textbox', { name: '共通TCP 候補1の公開IP' });
  fireEvent.change(input, { target: { value: 'invalid draft' } });
  fireEvent.click(screen.getByRole('button', { name: /自動で開放/ }));
  await waitFor(() => expect(p.configure).toHaveBeenCalledExactlyOnceWith({ network: 'direct', direct: { mode: 'auto' } }));
  p.updateView({ ...smartphoneView, settings: { ...smartphoneView.settings, direct: { ...direct, mode: 'auto' } } });
  expect(input).not.toBeVisible();
  p.configure.mockClear(); fireEvent.click(screen.getByRole('button', { name: /ルーターで手動設定/ }));
  await waitFor(() => expect(p.configure).toHaveBeenCalledExactlyOnceWith({ network: 'direct', direct: { mode: 'manual' } }));
  p.updateView({ ...smartphoneView, settings: { ...smartphoneView.settings, direct } });
  expect(screen.getByRole('textbox', { name: '共通TCP 候補1の公開IP' })).toBe(input);
  expect(input).toBeVisible(); expect(input).toHaveValue('invalid draft');
});

it('直接接続の手動入力を500msで保存し、表示切替と画面往復で不正入力・開いた設定を保持する', async () => {
  const p = setup();
  openDetails('接続の詳細設定');
  p.updateView({ ...smartphoneView, settings: { ...smartphoneView.settings, direct: { mode: 'manual', interfaceId: null, manualEndpoints: [], manualSrtEndpoints: [] } } });
  fireEvent.click(screen.getByRole('button', { name: /^PC・スマホ直接接続/ }));
  const input = screen.getByRole('textbox', { name: '共通TCP 候補1の公開IP' });
  const port = screen.getByRole('spinbutton', { name: '共通TCP 候補1の公開ポート' });
  fireEvent.change(port, { target: { value: '23000' } });
  fireEvent.change(input, { target: { value: '8.8.8' } });
  await new Promise(resolve => setTimeout(resolve, 550)); expect(p.configure).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /^家庭内LANのネットワーク/ }));
  fireEvent.click(screen.getByRole('button', { name: /^PC・スマホ直接接続/ }));
  expect(screen.getByRole('textbox', { name: '共通TCP 候補1の公開IP' })).toHaveValue('8.8.8'); expect(input).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '← ホームに戻る' }));
  fireEvent.click(screen.getByRole('button', { name: /スマホ連携/ }));
  expect(input).toBeVisible(); expect(input).toHaveValue('8.8.8');
  fireEvent.change(input, { target: { value: '8.8.8.8' } });
  expect(p.configure).not.toHaveBeenCalled();
  await waitFor(() => expect(p.configure).toHaveBeenCalledOnce());
  expect(p.configure.mock.calls[0][0]).toMatchObject({ direct: { manualEndpoints: [{ family: 'ipv4', address: '8.8.8.8', tcpPort: 23000 }] } });
});

it('接続経路図の選択領域・UDP端末・保守の開閉を表示経路変更と画面往復で保持する', () => {
  const p = setup(); openDetails('接続の詳細設定');
  const deviceB = { ...smartphoneDirectView.devices[0], id: '33333333-3333-4333-8333-333333333333', name: 'スマホB' };
  p.updateView({ ...smartphoneDirectView, devices: [...smartphoneDirectView.devices, deviceB], settings: { ...smartphoneDirectView.settings,
    direct: { mode: 'manual', interfaceId: null, manualEndpoints: [], manualSrtEndpoints: [] } } });
  fireEvent.click(screen.getByRole('button', { name: /^PC・スマホ直接接続/ }));
  selectUdpDevice(deviceB.id);
  fireEvent.change(screen.getByRole('textbox', { name: 'スマホBのUDP 候補1の公開IP' }), { target: { value: 'unfinished' } });
  openDetails('保守・復旧'); selectDirectRoute('外出先のスマホ');
  fireEvent.click(screen.getByRole('button', { name: /^家庭内LANのネットワーク/ }));
  fireEvent.click(screen.getByRole('button', { name: '← ホームに戻る' }));
  fireEvent.click(screen.getByRole('button', { name: /スマホ連携/ }));
  fireEvent.click(screen.getByRole('button', { name: /^PC・スマホ直接接続/ }));
  expect(screen.getByRole('tab', { name: /外出先のスマホ/ })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByText('保守・復旧').closest('details')).toHaveAttribute('open');
  selectDirectRoute('自宅のルーター');
  expect(screen.getByRole('combobox', { name: '公開UDPを設定するスマホ' })).toHaveValue(deviceB.id);
  expect(screen.getByRole('textbox', { name: 'スマホBのUDP 候補1の公開IP' })).toHaveValue('unfinished');
  expect(p.configure).not.toHaveBeenCalled(); expect(p.directAction).not.toHaveBeenCalled();
});

it('不正な公開UDP入力の端末を削除すると入力と未保存状態を除去し、共通QRを再び利用できる', async () => {
  const p = setup();
  openDetails('接続の詳細設定');
  const view = { ...smartphoneDirectView, settings: { ...smartphoneDirectView.settings,
    direct: { mode: 'manual' as const, interfaceId: null,
      manualEndpoints: [{ id: '44444444-4444-4444-8444-444444444444', family: 'ipv4' as const, address: '8.8.8.8', tcpPort: 23000 }], manualSrtEndpoints: [] } } };
  p.updateView(view);
  fireEvent.click(screen.getByRole('button', { name: /^PC・スマホ直接接続/ }));
  fireEvent.change(screen.getByRole('textbox', { name: 'スマホAのUDP 候補1の公開IP' }), { target: { value: 'invalid UDP draft' } });
  const qr = screen.getByRole('button', { name: '登録用QRを表示' });
  expect(qr).toHaveAttribute('aria-disabled', 'true');
  screen.getByText('名前・登録設定').closest('details')!.open = true;
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '登録を削除' })));
  expect(p.deviceAction).toHaveBeenCalledExactlyOnceWith(smartphoneView.devices[0].id, 'delete');
  p.updateView({ ...view, devices: [] });
  expect(screen.queryByRole('textbox', { name: 'スマホAのUDP 候補1の公開IP', hidden: true })).toBeNull();
  expect(qr).toHaveAttribute('aria-disabled', 'false');
  expect(screen.getByRole('button', { name: '共通TCPの手動開放を確認' })).not.toBeDisabled();
  expect(p.configure).not.toHaveBeenCalled();
  fireEvent.click(qr);
  await waitFor(() => expect(p.invitation).toHaveBeenCalledExactlyOnceWith('direct'));
});

it.each(['valid', 'invalid-tcp', 'invalid-udp'] as const)('端末削除後も残るTCPと他端末のUDP下書きを保持し、%sの検証結果で登録可否を更新する', async state => {
  vi.useFakeTimers();
  try {
    const p = setup();
    openDetails('接続の詳細設定');
    const deviceB = { ...smartphoneDirectView.devices[0], id: '33333333-3333-4333-8333-333333333333', name: 'スマホB' };
    const view = { ...smartphoneDirectView, devices: [...smartphoneDirectView.devices, deviceB],
      settings: { ...smartphoneDirectView.settings,
        direct: { mode: 'manual' as const, interfaceId: null, manualEndpoints: [], manualSrtEndpoints: [] } } };
    p.updateView(view);
    fireEvent.click(screen.getByRole('button', { name: /^PC・スマホ直接接続/ }));
    const tcp = screen.getByRole('textbox', { name: '共通TCP 候補1の公開IP' });
    const tcpValue = state === 'invalid-tcp' ? 'invalid TCP draft' : '8.8.8.8';
    const udpValue = state === 'invalid-udp' ? 'invalid B UDP draft' : '1.1.1.1';
    fireEvent.change(screen.getByRole('spinbutton', { name: '共通TCP 候補1の公開ポート' }), { target: { value: '23000' } });
    fireEvent.change(tcp, { target: { value: tcpValue } });
    selectUdpDevice(deviceB.id);
    const udpB = screen.getByRole('textbox', { name: 'スマホBのUDP 候補1の公開IP' });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'スマホBのUDP 候補1の公開ポート' }), { target: { value: '24000' } });
    fireEvent.change(udpB, { target: { value: udpValue } });
    selectUdpDevice(smartphoneDirectView.devices[0].id);
    fireEvent.change(screen.getByRole('textbox', { name: 'スマホAのUDP 候補1の公開IP' }), { target: { value: 'invalid A UDP draft' } });
    const deviceA = within(nameInput().closest('article')!);
    deviceA.getByText('名前・登録設定').closest('details')!.open = true;
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await act(async () => fireEvent.click(deviceA.getByRole('button', { name: '登録を削除' })));
    p.updateView({ ...view, devices: [deviceB] });
    expect(tcp).toHaveValue(tcpValue); expect(udpB).toHaveValue(udpValue);
    expect(screen.queryByRole('textbox', { name: 'スマホAのUDP 候補1の公開IP', hidden: true })).toBeNull();
    expect(screen.getByRole('combobox', { name: '公開UDPを設定するスマホ' })).toHaveValue(deviceB.id);
    expect(udpB).toBeVisible();
    const qr = screen.getByRole('button', { name: '登録用QRを表示' });
    const obs = screen.getByRole('button', { name: 'OBS入力をコピー' });
    expect(qr).toHaveAttribute('aria-disabled', 'true'); expect(obs).toHaveAttribute('aria-disabled', 'true');
    await act(async () => { await vi.advanceTimersByTimeAsync(499); });
    expect(p.configure).not.toHaveBeenCalled();
    if (state !== 'valid') {
      await act(async () => { await vi.advanceTimersByTimeAsync(101); });
      expect(p.configure).not.toHaveBeenCalled(); expect(qr).toHaveAttribute('aria-disabled', 'true');
      fireEvent.change(state === 'invalid-tcp' ? tcp : udpB, { target: { value: state === 'invalid-tcp' ? '8.8.8.8' : '1.1.1.1' } });
      await act(async () => { await vi.advanceTimersByTimeAsync(499); });
      expect(p.configure).not.toHaveBeenCalled();
    }
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(p.configure).toHaveBeenCalledExactlyOnceWith({ network: 'direct', direct: {
      manualEndpoints: [expect.objectContaining({ family: 'ipv4', address: '8.8.8.8', tcpPort: 23000 })],
      manualSrtEndpoints: [expect.objectContaining({ deviceId: deviceB.id, family: 'ipv4', address: '1.1.1.1', outdoorPort: 24000 })],
    } });
    expect(qr).toHaveAttribute('aria-disabled', 'false'); expect(obs).toHaveAttribute('aria-disabled', 'false');
  } finally { vi.useRealTimers(); }
});

it('3経路の排他的なスイッチだけでコメントと映像を準備する', async () => {
  const p = setup();
  expect(screen.getByRole('heading', { name: 'スマホ連携', level: 1 })).toBeVisible();
  expect(screen.getAllByRole('switch')).toHaveLength(3);
  for (const toggle of screen.getAllByRole('switch')) expect(toggle).toBeVisible();
  expect(screen.queryByRole('switch', { name: /コメント/ })).toBeNull();

  expect(screen.getByText('音声接続 3台')).toBeVisible();
  fireEvent.click(screen.getByRole('switch', { name: '外配信Tailscaleネットワーク' }));
  await waitFor(() => expect(p.configure).toHaveBeenCalledExactlyOnceWith({ activeNetwork: 'tailscale' }));
  expect(p.onSuccess).toHaveBeenCalledOnce();
});

it('表示切替と画面往復は保存せず、入力途中と共通の画面配置を保持する', () => {
  const p = setup();
  openDetails('接続の詳細設定');
  const sections = Array.from(document.querySelectorAll('.sp-disclosure > summary strong')).map(e => e.textContent);
  fireEvent.change(screen.getByRole('spinbutton', { name: '登録・制御のTCPポート' }), { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: /^外配信Tailscaleネットワーク/ }));
  expect(Array.from(document.querySelectorAll('.sp-disclosure > summary strong')).map(e => e.textContent)).toEqual(sections);
  expect(screen.getByRole('heading', { name: 'Tailscaleの接続と登録' })).toBeVisible();
  expect(screen.getByRole('spinbutton', { name: '登録・制御のTCPポート' })).toHaveValue(3001);
  fireEvent.click(screen.getByRole('button', { name: '← ホームに戻る' }));
  fireEvent.click(screen.getByRole('button', { name: /スマホ連携/ }));
  expect(screen.getByRole('button', { name: /^外配信Tailscaleネットワーク/ })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: /^家庭内LANのネットワーク/ }));
  expect(screen.getByRole('spinbutton', { name: '登録・制御のTCPポート' })).toHaveValue(0);
  expect(p.configure).not.toHaveBeenCalled();
});

it('文字の印を追加せず選択状態を伝え、別経路がONの案内から保存・公開を変えずに設定表示だけを移す', () => {
  const p = setup();
  const lan = screen.getByRole('button', { name: /^家庭内LANのネットワーク/ });
  const direct = screen.getByRole('button', { name: /^PC・スマホ直接接続/ });
  expect(lan).toHaveAttribute('aria-pressed', 'true');
  expect(direct).toHaveAttribute('aria-pressed', 'false');
  expect(screen.queryByText('表示中', { exact: true })).toBeNull();
  p.updateView(smartphoneDirectView);
  expect(screen.getByRole('heading', { name: '家庭内LANの接続と登録' })).toBeVisible();
  expect(screen.getByText('直接接続がONです。')).toBeVisible();
  expect(screen.getByText('直接接続がONです。').closest('.sp-connection-state')).toHaveAttribute('data-attention', 'true');
  const jump = screen.getByRole('button', { name: '直接接続の設定を見る' });
  jump.focus(); fireEvent.click(jump);
  expect(direct).toHaveFocus();
  expect(direct).toHaveAttribute('aria-pressed', 'true');
  expect(lan).toHaveAttribute('aria-pressed', 'false');
  expect(screen.queryByText('表示中', { exact: true })).toBeNull();
  expect(screen.getByRole('heading', { name: '直接接続の接続と登録' })).toBeVisible();
  expect(screen.queryByRole('button', { name: '直接接続の設定を見る' })).toBeNull();
  expect(p.configure).not.toHaveBeenCalled(); expect(p.deviceAction).not.toHaveBeenCalled();
  expect(p.invitation).not.toHaveBeenCalled(); expect(p.directAction).not.toHaveBeenCalled();
});

it('全経路OFF・利用不可・未保存・保存失敗では既存の案内を優先し、移動リンクを出さない', () => {
  const p = setup();
  const noJump = () => expect(screen.queryByRole('button', { name: /の設定を見る$/ })).toBeNull();
  noJump();
  p.updateView({ ...smartphoneView, settings: { ...smartphoneView.settings, activeNetwork: null } });
  noJump(); expect(screen.getByText('このネットワークをONにすると、登録用QRを利用できます。')).toBeVisible();
  p.updateView({ ...smartphoneDirectView, available: false });
  noJump(); expect(screen.getByText('スマホ連携を利用できません。要確認から原因を確認してください。')).toBeVisible();
  p.updateView(smartphoneDirectView, '保存できません。');
  noJump(); expect(screen.getByText('未保存の入力があります。登録用QRとOBS入力は保存後に利用できます。')).toBeVisible();
  p.updateView(smartphoneDirectView);
  openDetails('接続の詳細設定');
  fireEvent.change(screen.getByRole('spinbutton', { name: '登録・制御のTCPポート' }), { target: { value: '0' } });
  noJump(); expect(screen.getByText('未保存の入力があります。登録用QRとOBS入力は保存後に利用できます。')).toBeVisible();
  expect(p.configure).not.toHaveBeenCalled();
});

it('移動リンクの消去は他の入力のフォーカスを保ち、消えるリンク自身のフォーカスだけを戻す', () => {
  const p = setup();
  p.updateView(smartphoneDirectView);
  const name = nameInput();
  name.focus(); p.updateView(smartphoneView); expect(name).toHaveFocus();
  p.updateView(smartphoneDirectView);
  const jump = screen.getByRole('button', { name: '直接接続の設定を見る' });
  fireEvent.focus(jump); jump.focus();
  p.updateView(smartphoneView);
  expect(screen.getByRole('button', { name: /^家庭内LANのネットワーク/ })).toHaveFocus();
  expect(p.configure).not.toHaveBeenCalled();
});

it('映像の独立スイッチを設けず、PCの受信停止とスマホ側停止の説明を常設する', () => {
  const p = setup();
  fireEvent.click(screen.getByRole('button', { name: /^外配信Tailscaleネットワーク/ }));
  expect(screen.queryByRole('switch', { name: '映像送信を利用する' })).toBeNull();
  expect(p.configure).not.toHaveBeenCalled();
  expect(screen.getByText(/ネットワークOFFはPCの受信のみ停止します。撮影・マイクはスマホで、配信はOBSで停止してください/)).toBeVisible();
});

it('映像準備中でも登録用QRを表示し、準備だけでは撮影を始めないと案内する', async () => {
  const p = setup();
  p.updateView({ ...smartphoneView, networks: { ...smartphoneView.networks, lan: { ...smartphoneView.networks.lan, videoReady: false } } });
  fireEvent.click(screen.getByRole('button', { name: '登録用QRを表示' }));
  expect(await screen.findByRole('img')).toBeVisible();
  expect(screen.getByText(/映像の準備中でも登録できます/)).toBeVisible();
  expect(p.invitation).toHaveBeenCalledExactlyOnceWith('lan');
});

it('登録用QRは明示表示し、移動後の遅い応答を再表示しない', async () => {
  const p = setup(); let finish!: (value: string) => void;
  vi.mocked(QRCode.toDataURL).mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: '登録用QRを表示' }));
  await waitFor(() => expect(finish).toBeDefined());
  expect(p.invitation).toHaveBeenCalledExactlyOnceWith('lan');
  fireEvent.click(screen.getByRole('button', { name: /^外配信Tailscaleネットワーク/ }));
  await act(async () => { finish('data:image/png;base64,late'); });
  expect(screen.queryByRole('img')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /^家庭内LANのネットワーク/ }));
  fireEvent.click(screen.getByRole('button', { name: '登録用QRを表示' }));
  expect(await screen.findByRole('img')).toBeVisible();
  fireEvent(window, new Event('blur'));
  expect(screen.queryByRole('img')).toBeNull();
});

it('共通QRは1つだけで、手動端末追加とOBS準備を要求しない', async () => {
  const p = setup();
  fireEvent.click(screen.getByRole('button', { name: '登録用QRを表示' }));
  expect(await screen.findByRole('img')).toBeVisible();
  expect(p.deviceAction).not.toHaveBeenCalled(); expect(p.invitation).toHaveBeenCalledExactlyOnceWith('lan'); expect(p.configure).not.toHaveBeenCalled();
  expect(screen.getAllByRole('button', { name: '登録用QRを表示' })).toHaveLength(1);
  expect(screen.queryByRole('button', { name: 'コメント用QRを表示' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'スマホを追加' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'QRを隠す' }));
  expect(screen.getByRole('button', { name: '登録用QRを表示' })).toHaveFocus();
});

it('未保存・保存中・保存失敗の接続情報ではQRとOBS入力を取得しない', async () => {
  const p = setup(); let finish!: () => void;
  openDetails('接続の詳細設定');
  p.configure.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const input = screen.getByRole('spinbutton', { name: '登録・制御のTCPポート' });
  const qr = screen.getByRole('button', { name: '登録用QRを表示' });
  fireEvent.change(input, { target: { value: '3101' } }); fireEvent.click(qr);
  expect(p.invitation).not.toHaveBeenCalled();
  await waitFor(() => expect(finish).toBeDefined()); expect(qr).toHaveAttribute('aria-disabled', 'true');
  await act(async () => finish()); expect(qr).toHaveAttribute('aria-disabled', 'false');
  p.configure.mockRejectedValueOnce(new Error('保存できません。'));
  fireEvent.change(input, { target: { value: '3102' } });
  await waitFor(() => expect(p.configure).toHaveBeenCalledTimes(2));
  fireEvent.click(qr); fireEvent.click(screen.getByRole('button', { name: 'OBS入力をコピー' }));
  expect(p.invitation).not.toHaveBeenCalled(); expect(p.obsInput).not.toHaveBeenCalled();
  expect(qr).toHaveAttribute('aria-disabled', 'true');
  fireEvent.change(input, { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: /^外配信Tailscaleネットワーク/ }));
  expect(screen.getByRole('button', { name: '要確認 1件' })).toBeVisible();
});

it('自動登録の端末追加と状態報告で共通QRを隠さず、招待変更では隠す', async () => {
  const p = setup(); fireEvent.click(screen.getByRole('button', { name: '登録用QRを表示' }));
  expect(await screen.findByRole('img')).toBeVisible();
  const added = { ...smartphoneView, devices: [...smartphoneView.devices, { ...smartphoneView.devices[0], id: 'another', name: 'スマホB' }] };
  p.updateView(added); expect(screen.getByRole('img')).toBeVisible();
  expect(p.invitation).toHaveBeenCalledOnce();
  p.updateView({ ...added, networks: { ...added.networks, lan: { ...added.networks.lan, invitationRevision: 2 } } });
  expect(screen.queryByRole('img')).toBeNull();
});

it('音質の空欄と範囲外は保存せず、コピーの失敗は共通の要確認へ出す', async () => {
  const p = setup();  const input = screen.getByRole('spinbutton', { name: '音質（kbps）' });
  fireEvent.change(input, { target: { value: '129' } }); fireEvent.change(input, { target: { value: '' } });
  expect(input).toHaveAttribute('aria-invalid', 'true'); expect(p.changeAudio).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: '64' } });
  expect(p.changeAudio).toHaveBeenCalledExactlyOnceWith({ ...p.audioSettings, bitrateKbps: 64 });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValueOnce(new Error('コピーできません。')).mockResolvedValue(undefined) } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'URLをコピー' })));
  expect(screen.getByRole('button', { name: '要確認 1件' })).toBeVisible(); expect(p.onSuccess).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'URLをコピー' })));
  expect(p.onSuccess).toHaveBeenCalledWith('コメント用URLをコピーしました。');
});

it('端末名は日本語変換の確定後だけ保存し、変換中はQRを表示しない', async () => {
  vi.useFakeTimers();
  try {
    const p = setup(); const input = nameInput();
    fireEvent.compositionStart(input); fireEvent.change(input, { target: { value: 'そと' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(p.deviceAction).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '登録用QRを表示' })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.change(input, { target: { value: '外配信用' } }); fireEvent.compositionEnd(input);
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(p.deviceAction).toHaveBeenCalledExactlyOnceWith(smartphoneView.devices[0].id, 'rename', '外配信用');
  } finally { vi.useRealTimers(); }
});

it('日常のQR・端末・OBS入力は最初から表示し、詳細設定は操作して開く', () => {
  const p = setup();
  expect(screen.getByRole('button', { name: '登録用QRを表示' })).toBeVisible();
  expect(nameInput()).toBeVisible();
  expect(screen.getByRole('button', { name: 'OBS入力をコピー' })).toBeVisible();
  expect(screen.getByRole('spinbutton', { name: '登録・制御のTCPポート' })).not.toBeVisible();
  expect(screen.getByRole('spinbutton', { name: '音質（kbps）' })).toBeVisible();
  expect(p.configure).not.toHaveBeenCalled(); expect(p.invitation).not.toHaveBeenCalled();
  openDetails('接続の詳細設定');
  expect(screen.getByRole('spinbutton', { name: '登録・制御のTCPポート' })).toBeVisible();
});

it.each(['lan', 'tailscale', 'direct'] as const)('%sの端末カードでOBS入力コピーの横から手順を開き、閉じると起点へ戻る', network => {
  const p = setup();
  fireEvent.click(screen.getByRole('button', { name: smartphoneNetworkNames[network] }));
  const connection = screen.getByRole('region', { name: '接続と登録' });
  const devices = screen.getByRole('region', { name: 'スマホ一覧・登録' });
  expect(connection.compareDocumentPosition(devices) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.queryByRole('region', { name: 'OBSに映像を表示する準備' })).toBeNull();
  const entry = within(devices).getByRole('button', { name: 'スマホAの映像をOBSに追加' });
  const copy = within(devices).getByRole('button', { name: 'OBS入力をコピー' });
  expect(entry.parentElement).toBe(copy.parentElement);
  expect(entry.closest('details')).toBeNull();
  expect(entry).toBeVisible();
  expect(screen.queryByRole('dialog', { name: '映像をOBSに追加' })).toBeNull();
  fireEvent.click(entry);
  const guide = screen.getByRole('dialog', { name: '映像をOBSに追加' });
  const target = within(guide).getByLabelText('対象のスマホ');
  expect(target).toHaveTextContent('スマホA');
  expect(target).not.toHaveTextContent('家庭内LAN');
  expect(within(guide).getAllByRole('listitem')).toHaveLength(4);
  expect(within(guide).getByText('「＋」→「メディアソース」')).toBeVisible();
  expect(within(guide).getByText('「ローカルファイル」をOFF')).toBeVisible();
  expect(within(guide).getByText('「mpegts」')).toBeVisible();
  expect(within(guide).getByText(/スマホで送信を開始し、OBSで映像・音声を確認/)).toBeVisible();
  fireEvent.click(within(guide).getByRole('button', { name: '閉じる' }));
  expect(guide).not.toBeVisible(); expect(entry).toHaveFocus();
  expect(screen.getByRole('button', { name: 'OBS操作の設定' })).toBeVisible();
  expect(p.configure).not.toHaveBeenCalled(); expect(p.deviceAction).not.toHaveBeenCalled();
  expect(p.invitation).not.toHaveBeenCalled(); expect(p.obsInput).not.toHaveBeenCalled(); expect(p.onSuccess).not.toHaveBeenCalled();
});

it('複数端末のOBS案内を対象ごとに開き、名前更新でも読んでいる対象を変えず、それぞれの起点へ戻る', () => {
  const p = setup(); const first = smartphoneView.devices[0];
  const second = { ...first, id: '22222222-2222-4222-8222-222222222222', name: 'スマホB' };
  p.updateView({ ...smartphoneView, devices: [first, second] });
  for (const device of [first, second]) {
    const entry = screen.getByRole('button', { name: `${device.name}の映像をOBSに追加` });
    fireEvent.click(entry);
    const guide = screen.getByRole('dialog', { name: '映像をOBSに追加' });
    expect(within(guide).getByLabelText('対象のスマホ')).toHaveTextContent(device.name);
    expect(within(guide).getAllByRole('listitem')[0]).toHaveTextContent(`「${device.name}」の「OBS入力をコピー」`);
    expect(within(guide).getAllByRole('listitem')[3]).toHaveTextContent(`「きゃすメイト ${device.name}」`);
    const close = within(guide).getByRole('button', { name: '閉じる' });
    p.updateView({ ...smartphoneView, devices: [first, { ...second, name: '更新されたスマホB' }] });
    expect(within(guide).getByLabelText('対象のスマホ')).toHaveTextContent(device.name);
    expect(close).toHaveFocus(); fireEvent.click(close); expect(entry).toHaveFocus();
    p.updateView({ ...smartphoneView, devices: [first, second] });
  }
  expect(p.configure).not.toHaveBeenCalled(); expect(p.deviceAction).not.toHaveBeenCalled(); expect(p.obsInput).not.toHaveBeenCalled();
});

it('案内の対象端末が削除されると閉じ、残った別端末ではなく一覧見出しへ戻る', () => {
  const p = setup(); const first = smartphoneView.devices[0];
  const second = { ...first, id: '22222222-2222-4222-8222-222222222222', name: 'スマホB' };
  p.updateView({ ...smartphoneView, devices: [first, second] });
  fireEvent.click(screen.getByRole('button', { name: 'スマホBの映像をOBSに追加' }));
  const guide = screen.getByRole('dialog', { name: '映像をOBSに追加' });
  p.updateView({ ...smartphoneView, devices: [first] });
  expect(guide).not.toBeVisible(); expect(screen.getByRole('heading', { name: '登録済みのスマホ' })).toHaveFocus();
  p.updateView({ ...smartphoneView, devices: [first, second] });
  expect(guide).not.toBeVisible();
});

it('表示ネットワークを変更しても端末共通のOBS案内を保持する', () => {
  setup(); fireEvent.click(screen.getByRole('button', { name: 'スマホAの映像をOBSに追加' }));
  const guide = screen.getByRole('dialog', { name: '映像をOBSに追加' });
  fireEvent.click(screen.getByRole('button', { name: smartphoneNetworkNames.tailscale }));
  expect(guide).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: smartphoneNetworkNames.lan }));
  expect(guide).toBeVisible();
});

it.each(['off', 'unavailable', 'unregistered', 'save-error'] as const)('OBS案内は%sでも利用でき、状態更新で手順とフォーカスを動かさない', state => {
  const p = setup();
  const view = { ...smartphoneView,
    ...(state === 'off' ? { settings: { ...smartphoneView.settings, activeNetwork: null } } : {}),
    ...(state === 'unavailable' ? { available: false } : {}),
    ...(state === 'unregistered' ? { devices: smartphoneView.devices.map(device => ({ ...device,
      profiles: { ...device.profiles, lan: { ...device.profiles.lan, registered: false } } })) } : {}) };
  p.updateView(view, state === 'save-error' ? '保存できません。' : undefined);
  const entry = screen.getByRole('button', { name: 'スマホAの映像をOBSに追加' });
  expect(entry).toBeEnabled(); fireEvent.click(entry);
  const guide = screen.getByRole('dialog', { name: '映像をOBSに追加' });
  const close = within(guide).getByRole('button', { name: '閉じる' });
  expect(close).toHaveFocus();
  p.updateView({ ...view, warning: '映像の準備を確認してください。' });
  expect(guide).toBeVisible(); expect(close).toHaveFocus();
  fireEvent(guide, new Event('cancel', { cancelable: true }));
  expect(guide).not.toBeVisible(); expect(entry).toHaveFocus();
  expect(p.configure).not.toHaveBeenCalled(); expect(p.invitation).not.toHaveBeenCalled(); expect(p.obsInput).not.toHaveBeenCalled();
});

it('OBS手順内でTab・Shift+Tabを循環し、画面移動で閉じて自動再表示しない', () => {
  const p = setup();
  const entry = screen.getByRole('button', { name: 'スマホAの映像をOBSに追加' });
  fireEvent.click(entry);
  const guide = screen.getByRole('dialog', { name: '映像をOBSに追加' });
  const close = within(guide).getByRole('button', { name: '閉じる' });
  const body = within(guide).getByLabelText('OBSへの登録手順');
  fireEvent.keyDown(close, { key: 'Tab', shiftKey: true }); expect(body).toHaveFocus();
  fireEvent.keyDown(body, { key: 'Tab' }); expect(close).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: '← ホームに戻る' }));
  expect(guide).not.toBeVisible();
  expect(screen.getByRole('button', { name: /スマホ連携/ })).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: /スマホ連携/ }));
  expect(entry).toBeVisible(); expect(guide).not.toBeVisible();
  expect(p.configure).not.toHaveBeenCalled();
});

it('処理中でもOBS手順を開け、遅れて完了したQRを手順に重ねない', async () => {
  const p = setup();
  let complete!: (value: SmartphoneInvitation) => void;
  p.invitation.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: '登録用QRを表示' }));
  await waitFor(() => expect(p.invitation).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: 'スマホAの映像をOBSに追加' }));
  const guide = screen.getByRole('dialog', { name: '映像をOBSに追加' });
  await act(async () => complete({ type: 'casmate.outdoor', version: 11, network: 'lan',
    pcId: '22222222-2222-4222-8222-222222222222', registrationPort: 3001, token: 'a'.repeat(64), comments: { url: smartphoneView.networks.lan.commentsUrl! } }));
  expect(guide).toBeVisible();
  expect(screen.queryByRole('img', { name: 'スマホ接続用QR' })).toBeNull();
  expect(within(guide).getByRole('button', { name: '閉じる' })).toHaveFocus();
  expect(p.configure).not.toHaveBeenCalled(); expect(p.obsInput).not.toHaveBeenCalled();
});

it('OFFの未登録経路を表示しても公開を変えず、端末共通のOBS入力はコピーできる', async () => {
  const p = setup();
  fireEvent.click(screen.getByRole('button', { name: '外配信Tailscaleネットワーク' }));
  expect(screen.getByRole('switch', { name: '家庭内LANのネットワーク' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('switch', { name: '外配信Tailscaleネットワーク' })).toHaveAttribute('aria-checked', 'false');
  expect(screen.getByText('この経路は未登録')).toBeVisible();
  expect(screen.getByText('Tailscale · 未登録')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '登録用QRを表示' }));
  fireEvent.click(screen.getByRole('button', { name: 'OBS入力をコピー' }));
  await waitFor(() => expect(p.obsInput).toHaveBeenCalledExactlyOnceWith(smartphoneView.devices[0].id));
  expect(p.configure).not.toHaveBeenCalled(); expect(p.invitation).not.toHaveBeenCalled();
});

it('映像の準備失敗を隠さず、正常なコメント・読み上げと共通QRは利用できる', async () => {
  const p = setup();
  const device = smartphoneView.devices[0];
  p.updateView({ ...smartphoneView, devices: [{ ...device, profiles: { ...device.profiles,
    lan: { ...device.profiles.lan, preparation: { video: 'error', obsControl: 'disabled' }, receiver: { state: 'error', receivedBytes: 0 } } } }] });
  const states = screen.getByLabelText('機能ごとの状態');
  expect(within(states).getByText('準備済み')).toBeVisible();
  expect(within(states).getAllByText('利用可能')).toHaveLength(1);
  openDetails('家庭内LANで接続する手順');
  expect(screen.getByText('コメントの接続準備済み')).toBeVisible();
  expect(within(states).getByText('要確認')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '登録用QRを表示' }));
  expect(await screen.findByRole('img')).toBeVisible(); expect(p.invitation).toHaveBeenCalledOnce();
});

it('共通入力未割当の端末は未登録経路でもOBS入力を取得しない', () => {
  const p = setup();
  p.updateView({ ...smartphoneView, settings: { ...smartphoneView.settings, activeNetwork: 'tailscale' },
    devices: smartphoneView.devices.map(device => ({ ...device, obsLocalPort: undefined })),
    networks: { ...smartphoneView.networks, tailscale: { ...smartphoneView.networks.lan, videoReady: true } } });
  fireEvent.click(screen.getByRole('button', { name: '外配信Tailscaleネットワーク' }));
  expect(screen.getByText('Tailscale · 未登録')).toBeVisible();
  expect(within(screen.getByLabelText('機能ごとの状態')).getByText('登録後に準備')).toBeVisible();
  const copy = screen.getByRole('button', { name: 'OBS入力をコピー' });
  expect(copy).toHaveAttribute('aria-disabled', 'true'); fireEvent.click(copy); expect(p.obsInput).not.toHaveBeenCalled();
});

it('空の端末一覧は登録導線を表示し、共有設定の保存失敗ではQRとOBS入力を取得しない', () => {
  const p = setup(); p.updateView({ ...smartphoneView, devices: [] });
  expect(screen.getByText('スマホはまだ登録されていません')).toBeVisible();
  expect(screen.queryByRole('button', { name: /の映像をOBSに追加/ })).toBeNull();
  expect(screen.getByRole('button', { name: '登録用QRを表示' })).toBeVisible();
  p.updateView(smartphoneView, '設定を保存できません。');
  fireEvent.click(screen.getByRole('button', { name: '登録用QRを表示' }));
  fireEvent.click(screen.getByRole('button', { name: 'OBS入力をコピー' }));
  expect(p.invitation).not.toHaveBeenCalled(); expect(p.obsInput).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '要確認 1件' })).toBeVisible();
});
