// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationSettingsPanel } from '../src/renderer/components/ApplicationSettingsPanel';
import { createDefaultSettings } from '../src/main/core/settings';
import { useAutoSavingSettings } from '../src/renderer/use-auto-saving-settings';

function setup() {
  const props = { baseUrl: 'http://127.0.0.1:3000', port: 3000, onSaveTheme: vi.fn().mockResolvedValue(undefined), onSaveTextSize: vi.fn().mockResolvedValue(undefined), onSavePort: vi.fn().mockResolvedValue(undefined), onPortEdit: vi.fn(), onSuccess: vi.fn(), onError: vi.fn(), onOperationStart: vi.fn() };
  const view = render(<ApplicationSettingsPanel {...props}/>);
  fireEvent.click(screen.getByText('接続設定'));
  return { ...view, props };
}
const editPort = (value: string) => fireEvent.change(screen.getByLabelText('アプリの接続ポート（再起動後に有効）'), { target: { value } });
const tick = () => act(async () => { await vi.advanceTimersByTimeAsync(500); });
describe('アプリ設定のポート', () => {
  it('接続設定だけ初期状態で閉じ、配色と文字サイズを常設する', () => {
    const props = { baseUrl:'http://127.0.0.1:3000', port:3000, onSaveTheme:vi.fn(), onSaveTextSize:vi.fn(), onSavePort:vi.fn(), onPortEdit:vi.fn(), onSuccess:vi.fn(), onError:vi.fn(), onOperationStart:vi.fn() };
    render(<ApplicationSettingsPanel {...props}/>);
    expect(document.querySelector('.app-connection-details')).not.toHaveAttribute('open');
    expect(screen.getByRole('heading', { name:'見た目' })).toBeVisible();
    expect(screen.getAllByRole('radio')).toHaveLength(11);
    expect(screen.getByRole('radio', { name:'標準' })).toBeChecked();
    expect(screen.getByLabelText('アプリの接続ポート（再起動後に有効）')).not.toBeVisible();
    expect(screen.queryByText('ブルーグレー × ミント')).toBeNull();
  });
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
  it('最後の入力から500msで保存し、範囲外入力は直前の保存予約も取り消す', async () => {
    vi.useFakeTimers(); const { props } = setup();
    editPort('4000'); await act(async () => { await vi.advanceTimersByTimeAsync(300); }); editPort(''); await tick();
    expect(props.onSavePort).not.toHaveBeenCalled();
    for (const value of ['80', '65536', '3000.5']) { editPort(value); await tick(); expect(screen.getByLabelText('アプリの接続ポート（再起動後に有効）')).toHaveAttribute('aria-invalid', 'true'); }
    expect(props.onSavePort).not.toHaveBeenCalled();
    editPort('4000'); await tick(); expect(props.onSavePort).toHaveBeenCalledWith(4000);
    expect(screen.getByText(/OBS側のURLも変更してください/)).toBeVisible();
  });
  it('保存失敗で入力を失わず、再保存できる', async () => {
    vi.useFakeTimers(); const { props } = setup(); props.onSavePort.mockRejectedValueOnce(new Error('保存できません。'));
     editPort('4000'); await tick();
    expect(screen.getByLabelText('アプリの接続ポート（再起動後に有効）')).toHaveValue(4000);
    expect(screen.getByText('保存できません。')).toBeVisible();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '再保存' })); });
    expect(props.onSavePort).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: '再保存' })).not.toBeInTheDocument();
  });
  it('接続設定と更新情報を分け、共通カードの開閉でも不正入力を保持する', async () => {
    vi.useFakeTimers(); const { props } = setup();

    const connection = screen.getByRole('region', { name: '接続設定' });
    expect(within(connection).getByLabelText('アプリの接続ポート（再起動後に有効）')).toHaveValue(3000);
    expect(within(screen.getByRole('region', { name: 'バージョン・更新' })).getByText(/新しいインストーラー/)).toBeVisible();
    editPort('80');
    fireEvent.click(screen.getByRole('button', { name: 'アプリ設定：閉じる' }));
    fireEvent.click(screen.getByRole('button', { name: 'アプリ設定：詳細を開く' }));
    expect(within(connection).getByLabelText('アプリの接続ポート（再起動後に有効）')).toHaveValue(80);
    expect(within(connection).getByText('1024〜65535の整数を入力してください。')).toBeVisible();
    await tick(); expect(props.onSavePort).not.toHaveBeenCalled();
  });
  it('古い保存応答で新しい入力を上書きしない', async () => {
    vi.useFakeTimers(); const { props, rerender } = setup();
    let resolve!: () => void;
    props.onSavePort.mockImplementationOnce(() => new Promise<void>(done => { resolve = done; }));
     editPort('4000'); await tick(); editPort('');
    rerender(<ApplicationSettingsPanel {...props} port={4000}/>);
    await act(async () => { resolve(); });
    expect(screen.getByLabelText('アプリの接続ポート（再起動後に有効）')).toHaveValue(null);
    expect(props.onSuccess).not.toHaveBeenCalled();
  });
  it('他の保存で待機中の古いポート要求を、新しい不正入力でも即時に取り消す', async () => {
    vi.useFakeTimers(); const settings = createDefaultSettings(); const onError = vi.fn();
    let release!: () => void;
    const update = vi.fn().mockImplementationOnce(() => new Promise<void>(done => { release = done; })).mockResolvedValue(undefined);
    function Harness() {
      const state = useAutoSavingSettings(settings, 1, update, onError);
      if (!state.draft) return null;
      const application = state.draft.application;
      return <><button onClick={() => void state.saveSectionNow('commentOverlay', settings.commentOverlay)}>別の設定を保存</button><ApplicationSettingsPanel baseUrl="http://127.0.0.1:3000" port={application.port}
        onSaveTheme={theme => state.saveSectionNow('application', { ...application, managementTheme: theme })} onSaveTextSize={managementTextSize => state.saveSectionNow('application', { ...application, managementTextSize })} onPortEdit={() => state.stageSection('application', application)} onSavePort={port => state.saveSectionNow('application', { ...application, port })}
        onSuccess={() => {}} onError={onError} onOperationStart={() => {}}/></>;
    }
    render(<Harness/>); fireEvent.click(screen.getByRole('button', { name: '別の設定を保存' }));
     editPort('4000'); await tick();
    expect(update).toHaveBeenCalledTimes(1);
    editPort(''); await act(async () => { release(); }); await tick();
    expect(update).toHaveBeenCalledTimes(1);
    editPort('5000'); await tick();
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenLastCalledWith('application', { ...settings.application, port: 5000 });
    expect(onError).not.toHaveBeenCalled();
  });
});
