// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DirectSettingsPanel } from '../src/renderer/components/DirectSettingsPanel';
import { SmartphonePanel } from '../src/renderer/components/SmartphonePanel';
import { ManagementShell } from '../src/renderer/components/ManagementShell';
import { smartphoneDirectView, smartphoneMobileState } from './fixtures/smartphone-view';
import { defaultDirectSettings } from '../src/shared/direct-connection';
import type { SmartphoneConfiguration } from '../src/shared/smartphone';

afterEach(() => { cleanup(); vi.useRealTimers(); });
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
function setup() {
  let view = structuredClone(smartphoneDirectView);
  view.settings.direct = { ...defaultDirectSettings(), mode: 'manual' };
  const action = vi.fn(async () => undefined);
  const list = vi.fn(async () => []);
  const configure = vi.fn(async (patch: SmartphoneConfiguration) => {
    view = { ...view, settings: { ...view.settings, direct: { ...view.settings.direct!, ...patch.direct } } };
    rendered.rerender(page());
  });
  const page = () => <ManagementShell home={null} windows={null} connected pcStatus={null} warnings={[]} activities={[]}>
    <SmartphonePanel view={view} mobile={smartphoneMobileState} audioSettings={{ lanEnabled: true, tailscaleEnabled: false, bitrateKbps: 32 }}
      configure={configure} changeAudio={vi.fn()} directAction={action} listAdapters={list} onSuccess={vi.fn()}
      deviceAction={vi.fn(async () => undefined)} invitation={vi.fn()} obsInput={vi.fn(async () => '')} />
  </ManagementShell>;
  const rendered = render(page());
  fireEvent.click(screen.getByRole('button', { name: /スマホ連携/ }));
  fireEvent.click(screen.getByText('接続の詳細設定').closest('summary')!);
  return { configure, action, list, update: (change: (value: typeof view) => void) => { change(view); rendered.rerender(page()); } };
}

it('経路の選択は設定を変更せず、PC領域だけでネットワーク一覧を読み取る', async () => {
  const p = setup();
  expect(screen.getByRole('tab', { name: /自宅のルーター/ })).toHaveAttribute('aria-selected', 'true');
  expect(p.list).not.toHaveBeenCalled();
  const router = screen.getByRole('tab', { name: /自宅のルーター/ });
  for (const name of ['外出先のスマホ', '自宅のルーター', 'このPCの受信']) {
    const tab = screen.getByRole('tab', { name: new RegExp(name) });
    const icon = tab.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon?.querySelectorAll('path, rect, line, circle, polyline').length).toBeGreaterThan(0);
  }
  fireEvent.keyDown(router, { key: 'ArrowRight' });
  await waitFor(() => expect(p.list).toHaveBeenCalledOnce());
  expect(screen.getByRole('spinbutton', { name: '登録・制御のTCPポート' })).toBeVisible();
  fireEvent.keyDown(screen.getByRole('tab', { name: /このPCの受信/ }), { key: 'Home' });
  expect(screen.getByRole('tab', { name: /外出先のスマホ/ })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole('tab', { name: /外出先のスマホ/ }), { key: 'End' });
  expect(screen.getByRole('tab', { name: /このPCの受信/ })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole('tab', { name: /このPCの受信/ }), { key: 'ArrowLeft' });
  expect(router).toHaveFocus(); expect(router).toHaveAttribute('aria-selected', 'true');
  expect(p.configure).not.toHaveBeenCalled(); expect(p.action).not.toHaveBeenCalled();
});

it('公開IPとポートを分けて検証・500ms保存し、保存応答で入力のフォーカスを失わない', async () => {
  vi.useFakeTimers(); const p = setup();
  const address = screen.getByRole('textbox', { name: '共通TCP 候補1の公開IP' });
  const port = screen.getByRole('spinbutton', { name: '共通TCP 候補1の公開ポート' });
  fireEvent.change(address, { target: { value: '192.168.1.1' } });
  fireEvent.change(port, { target: { value: '23000' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
  expect(p.configure).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '共通TCPの手動開放を確認' })).toBeDisabled();
  fireEvent.change(address, { target: { value: '8.8.8.8' } }); address.focus();
  await act(async () => { await vi.advanceTimersByTimeAsync(499); }); expect(p.configure).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(p.configure).toHaveBeenCalledExactlyOnceWith({ network: 'direct', direct: {
    manualEndpoints: [expect.objectContaining({ family: 'ipv4', address: '8.8.8.8', tcpPort: 23000 })], manualSrtEndpoints: [],
  } });
  expect(address).toHaveFocus(); expect(address).toHaveValue('8.8.8.8');
  fireEvent.change(port, { target: { value: '23001' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(address).toBe(screen.getByRole('textbox', { name: '共通TCP 候補1の公開IP' }));
});

it('候補の追加は4件まで、IPv6と空欄・候補削除を既存の保存契約に渡す', async () => {
  vi.useFakeTimers(); const p = setup();
  fireEvent.change(screen.getByRole('combobox', { name: '共通TCP 候補1のIP種別' }), { target: { value: 'ipv6' } });
  fireEvent.change(screen.getByRole('textbox', { name: '共通TCP 候補1の公開IP' }), { target: { value: '2001:4860:1::2' } });
  fireEvent.change(screen.getByRole('spinbutton', { name: '共通TCP 候補1の公開ポート' }), { target: { value: '23000' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(p.configure.mock.calls[0][0].direct?.manualEndpoints).toEqual([expect.objectContaining({ family: 'ipv6', address: '2001:4860:1::2', tcpPort: 23000 })]);
  for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: '共通TCPの候補を追加' }));
  expect(screen.getByRole('button', { name: '共通TCPの候補を追加' })).toBeDisabled();
  expect(screen.getAllByRole('textbox', { name: /共通TCP 候補\dの公開IP/ })).toHaveLength(4);
  const fourth = screen.getByRole('textbox', { name: '共通TCP 候補4の公開IP' }); fourth.focus();
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(screen.getAllByRole('textbox', { name: /共通TCP 候補\dの公開IP/ })).toHaveLength(4); expect(fourth).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: '共通TCP 候補1を削除' }));
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(p.configure.mock.lastCall?.[0].direct?.manualEndpoints).toEqual([]);
});

it('保存応答で候補の順序・空欄と編集中のDOMを保ち、先の候補を削除しても残る入力を使える', async () => {
  vi.useFakeTimers(); const p = setup();
  fireEvent.click(screen.getByRole('button', { name: '共通TCPの候補を追加' }));
  const first = screen.getByRole('textbox', { name: '共通TCP 候補1の公開IP' });
  const second = screen.getByRole('textbox', { name: '共通TCP 候補2の公開IP' });
  fireEvent.change(second, { target: { value: '8.8.8.8' } });
  fireEvent.change(screen.getByRole('spinbutton', { name: '共通TCP 候補2の公開ポート' }), { target: { value: '23000' } });
  second.focus();
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(first).toHaveValue(''); expect(second).toHaveFocus(); expect(second).toHaveValue('8.8.8.8');
  expect(screen.getByRole('textbox', { name: '共通TCP 候補2の公開IP' })).toBe(second);
  fireEvent.click(screen.getByRole('button', { name: '共通TCP 候補1を削除' }));
  const retained = screen.getByRole('textbox', { name: '共通TCP 候補1の公開IP' });
  expect(retained).toBe(second); retained.focus();
  fireEvent.change(screen.getByRole('spinbutton', { name: '共通TCP 候補1の公開ポート' }), { target: { value: '23001' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(retained).toHaveFocus(); expect(retained).toHaveValue('8.8.8.8');
  expect(p.configure.mock.lastCall?.[0].direct?.manualEndpoints).toEqual([expect.objectContaining({ address: '8.8.8.8', tcpPort: 23001 })]);
});

it('TCPと端末別UDPの候補にはIP種別とIPv6公開IPが一致する受信先だけを示し、未準備なら別候補を代用しない', () => {
  const p = setup();
  p.update(view => {
    const deviceId = view.devices[0].id;
    view.settings.direct!.manualEndpoints = [
      { id: crypto.randomUUID(), family: 'ipv4', address: '8.8.8.8', tcpPort: 23000 },
      { id: crypto.randomUUID(), family: 'ipv6', address: '2001:4860:1::2', tcpPort: 23001 },
      { id: crypto.randomUUID(), family: 'ipv6', address: '2001:4860:1::3', tcpPort: 23002 },
    ];
    view.settings.direct!.manualSrtEndpoints = [
      { id: crypto.randomUUID(), deviceId, family: 'ipv4', address: '1.1.1.1', outdoorPort: 24000 },
      { id: crypto.randomUUID(), deviceId, family: 'ipv6', address: '2001:4860:1::2', outdoorPort: 24001 },
      { id: crypto.randomUUID(), deviceId, family: 'ipv6', address: '2001:4860:1::3', outdoorPort: 24002 },
    ];
    const [tcp, udp] = view.direct!.entries;
    view.direct!.entries = [tcp, { ...tcp, id: 'tcp-v6', family: 'ipv6', localAddress: '2001:4860:1::2' },
      { ...tcp, id: 'tcp-v6-other', family: 'ipv6', localAddress: '2001:4860:1::3' },
      { ...udp, id: 'udp-v4', family: 'ipv4', localAddress: '192.168.1.2' }, udp,
      { ...udp, id: 'udp-v6-other', localAddress: '2001:4860:1::3' }];
  });
  const tcp4 = screen.getByRole('group', { name: '共通TCP 候補1' });
  const tcp6 = screen.getByRole('group', { name: '共通TCP 候補2' });
  const tcp6Other = screen.getByRole('group', { name: '共通TCP 候補3' });
  const udp4 = screen.getByRole('group', { name: 'スマホAのUDP 候補1' });
  const udp6 = screen.getByRole('group', { name: 'スマホAのUDP 候補2' });
  const udp6Other = screen.getByRole('group', { name: 'スマホAのUDP 候補3' });
  for (const [group, destination] of [[tcp4, '192.168.1.2:3001'], [tcp6, '[2001:4860:1::2]:3001'],
    [tcp6Other, '[2001:4860:1::3]:3001'], [udp4, '192.168.1.2:11000'], [udp6, '[2001:4860:1::2]:11000'],
    [udp6Other, '[2001:4860:1::3]:11000']] as const) {
    expect(group.querySelector('.sp-direct-destination code')).toHaveTextContent(destination);
    expect(group.querySelector('.sp-direct-destination code')?.textContent).toBe(destination);
  }
  expect(within(tcp4).getByText('PC内部の転送先')).toBeVisible();
  expect(within(tcp6).getByText('PCのIPv6受信先')).toBeVisible();
  expect(within(udp6).getByText('IPv6はルーターの受信許可を設定')).toBeVisible();
  fireEvent.change(within(tcp4).getByRole('combobox'), { target: { value: 'ipv6' } });
  fireEvent.change(within(udp4).getByRole('combobox'), { target: { value: 'ipv6' } });
  expect(tcp4.querySelector('.sp-direct-destination code')).toHaveTextContent('IPは受信準備後に表示');
  expect(udp4.querySelector('.sp-direct-destination code')).toHaveTextContent('端末の受信準備後に表示します');
  fireEvent.change(within(tcp4).getByRole('textbox'), { target: { value: '2001:4860:1::3' } });
  fireEvent.change(within(udp4).getByRole('textbox'), { target: { value: '2001:4860:1::3' } });
  expect(tcp4.querySelector('.sp-direct-destination code')?.textContent).toBe('[2001:4860:1::3]:3001');
  expect(udp4.querySelector('.sp-direct-destination code')?.textContent).toBe('[2001:4860:1::3]:11000');
  fireEvent.change(within(tcp4).getByRole('textbox'), { target: { value: '2001:4860:1::9' } });
  fireEvent.change(within(udp4).getByRole('textbox'), { target: { value: '2001:4860:1::9' } });
  expect(tcp4.querySelector('.sp-direct-destination code')).toHaveTextContent('IPは受信準備後に表示');
  expect(udp4.querySelector('.sp-direct-destination code')).toHaveTextContent('端末の受信準備後に表示します');
  p.update(view => { view.direct!.entries = view.direct!.entries.filter(entry => entry.family === 'ipv4'); });
  expect(tcp4.querySelector('.sp-direct-destination code')).toHaveTextContent('PCのIPv6・受信ポート 3001（IPは受信準備後に表示）');
  expect(udp4.querySelector('.sp-direct-destination code')).toHaveTextContent('端末の受信準備後に表示します');
  expect(tcp4.querySelector('.sp-direct-destination code')).not.toHaveTextContent('192.168.1.2');
  expect(udp4.querySelector('.sp-direct-destination code')).not.toHaveTextContent('192.168.1.2');
  expect(tcp6.querySelector('.sp-direct-destination code')).toHaveTextContent('IPは受信準備後に表示');
  expect(udp6.querySelector('.sp-direct-destination code')).toHaveTextContent('端末の受信準備後に表示します');
  expect(p.configure).not.toHaveBeenCalled(); expect(p.action).not.toHaveBeenCalled();
});

it('準備と実接続を分け、切断とOFFの古い到達情報を成功扱いしない', () => {
  const p = setup(); p.update(view => { view.direct!.entries[0].reachability = 'disconnected'; });
  fireEvent.click(screen.getByRole('tab', { name: /外出先のスマホ/ }));
  expect(within(screen.getByRole('tabpanel', { name: /外出先のスマホ/ })).getByText('切断・確認失効')).toBeVisible();
  p.update(view => { view.settings.activeNetwork = null; view.direct!.entries[0].reachability = 'connected'; });
  expect(screen.queryByText('確認済み')).toBeNull();
  expect(screen.getAllByText('直接接続はOFF').length).toBeGreaterThan(0);
});

it('通信一覧は本文のカードとして表示し、警告の全文は明示展開で確認できる', () => {
  const p = setup();
  fireEvent.click(screen.getByRole('tab', { name: /このPCの受信/ }));
  const pane = screen.getByRole('tabpanel', { name: /このPCの受信/ });
  const list = pane.querySelector('.sp-direct-resources')!;
  expect(list).not.toHaveAttribute('tabindex');
  expect(list.querySelectorAll('article')).toHaveLength(2);
  const warning = 'ルーターの受信許可と公開ポートを確認してください。'.repeat(20);
  p.update(view => { view.direct!.entries[0].warning = warning; });
  const details = list.querySelector('details')!;
  expect(details).not.toHaveAttribute('open');
  expect(details.querySelector('summary')).toHaveTextContent('要確認の内容あり');
  fireEvent.click(details.querySelector('summary')!);
  expect(within(details).getByText(warning)).toBeVisible();
  p.update(view => { view.direct!.entries[0].warning = null; });
  expect(details).toHaveAttribute('open');
  expect(details.querySelector('summary')).toHaveTextContent('要確認の内容なし');
  expect(within(details).getByText(warning)).toBeVisible();
  fireEvent.click(details.querySelector('summary')!);
  fireEvent.click(details.querySelector('summary')!);
  expect(within(details).getByText('この通信の要確認事項はありません。')).toBeVisible();
  expect(p.configure).not.toHaveBeenCalled(); expect(p.action).not.toHaveBeenCalled();
});

it('別画面の保存値を同期しても候補は4行以内で、空行のフォーカスを保つ', async () => {
  vi.useFakeTimers(); const p = setup();
  for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: '共通TCPの候補を追加' }));
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  const input = screen.getByRole('textbox', { name: '共通TCP 候補4の公開IP' }); input.focus();
  p.update(view => { view.settings.direct!.manualEndpoints = ['8.8.8.8', '8.8.4.4', '1.1.1.1', '1.0.0.1'].map((address, index) => ({
    id: crypto.randomUUID(), family: 'ipv4', address, tcpPort: 23000 + index,
  })); });
  expect(screen.getAllByRole('textbox', { name: /共通TCP 候補\dの公開IP/ })).toHaveLength(4);
  expect(input).toHaveFocus(); expect(input).toHaveValue('1.0.0.1');
});

it('初回設定の直接接続は全タブ・公開設定にOBSの案内を含めない', () => {
  const { container } = render(<DirectSettingsPanel initialSetup visible network="direct" portEditor={null} blocked={false}
    view={structuredClone(smartphoneDirectView)} busy={false} configure={vi.fn(async () => undefined)}
    run={vi.fn(async () => undefined)} defer={vi.fn()} />);
  expect(container).not.toHaveTextContent('OBS');
  expect(container).toHaveTextContent('このPCの端末欄で映像・マイクの受信を確認');
});
