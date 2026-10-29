// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MobileCommentsPage } from '../src/renderer/pages/MobileCommentsPage';

const commentList = {
  showSource: true,
  showAuthor: true,
  showContent: true,
  stackDirection: 'newestBottom' as const,
  fontFamily: 'Yu Gothic UI',
  fontSizePx: 16,
  textColor: '#edf0ffff',
  backgroundColor: '#131524ff',
};

const comment = {
  id: 'youtube:1',
  externalId: '1',
  sequence: 1,
  source: 'youtube' as const,
  authorName: '視聴者',
  content: [{ type: 'text' as const, text: 'スマホで表示するコメント' }],
  receivedAt: '2026-08-24T00:00:00.000Z',
  initialHistory: false,
};

const sockets: FakeWebSocket[] = [];
const audioInstances: FakeAudio[] = [];
const playAudioElement = vi.fn(async () => undefined);
const metadata = { protocolVersion: 2, sourcesRunning: true, mobilePublished: true, audioAvailable: true, commentList };
const wire = (type: string, payload: object, generation = 1, revision = 1) => ({ type, payload, generation, revision, connectionId: 'connection' });
class FakeWebSocket {
  static readonly OPEN = 1;
  sent: string[] = []; readyState = 1;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null;
  constructor() { sockets.push(this); queueMicrotask(() => this.receive(wire('mobile.hello', metadata, 0))); }
  send(value: string) {
    this.sent.push(value); const m = JSON.parse(value);
    if (m.type === 'mobile.subscribe' && m.topic === 'comments' && m.enabled) {
      queueMicrotask(() => {
        this.receive(wire('mobile.snapshotBegin', metadata, m.generation));
        this.receive(wire('mobile.snapshotChunk', { comments: [comment] }, m.generation));
        this.receive(wire('mobile.snapshotEnd', {}, m.generation));
      });
    }
  }
  close() { if (this.readyState !== 3) { this.readyState = 3; this.onclose?.({ code: 1000 }); } }
  receive(value: object) { this.onmessage?.({ data: JSON.stringify(value) }); }
  messages() { return this.sent.map(value => JSON.parse(value)); }
  audio(id = 'a'.repeat(24), generation = 1, finish = true) {
    this.receive(wire('mobile.audioReady', { audioId: id, commentId: 'opaque', byteLength: 3, expiresInMs: 15000 }, generation));
    if (finish) this.binary(id, generation);
  }
  binary(id: string, generation: number) {
    const data = new ArrayBuffer(39); const v = new DataView(data);
    v.setUint32(0, 0x434d4132); v.setUint32(4, generation);
    new Uint8Array(data, 12, 24).set([...id].map(c => c.charCodeAt(0)));
    this.onmessage?.({ data });
  }
}
class FakeAudio {
  src = ''; onended: (() => void) | null = null; onerror: (() => void) | null = null;
  play = vi.fn(() => playAudioElement()); pause = vi.fn();
  constructor() { audioInstances.push(this); }
}
const bridge = { onmessage: null as ((event: { data: string }) => void) | null, postMessage: vi.fn((message: string) => {
  if (message !== 'ready') return;
  queueMicrotask(() => {
    for (const e of [wire('mobile.snapshotBegin', metadata), wire('mobile.snapshotChunk', { comments: [comment] }), wire('mobile.snapshotEnd', {})]) bridge.onmessage?.({ data: JSON.stringify(e) });
  });
}) };
describe('スマホ表示の共通UIと通信版2', () => {
  beforeEach(() => {
    sockets.length = 0; audioInstances.length = 0; playAudioElement.mockReset().mockResolvedValue(undefined);
    window.history.replaceState({}, '', '/comments'); localStorage.clear();
    vi.stubGlobal('WebSocket', FakeWebSocket); vi.stubGlobal('Audio', FakeAudio); vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('CasMateComments', bridge);
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:audio'), revokeObjectURL: vi.fn() });
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('埋め込みはネイティブメッセージだけで同じ表示と実高さを保つ', async () => {
    window.history.replaceState({}, '', '/comments?embedded=android');
    localStorage.setItem('casmate.mobileSpeech.requested', 'started');
    const { container } = render(<MobileCommentsPage />);
    await screen.findByText(comment.content[0]!.text);
    expect(container.querySelector('.mobile-comments-page')).toHaveStyle({ height: window.innerHeight + 'px' });
    expect(container.querySelector('.mobile-comments-page')).toHaveClass('mobile-comments-page-embedded');
    expect(Array.from(container.querySelector('.comment-list-summary')!.children).map(e => e.textContent))
      .toEqual(['コメント接続済み', '自動スクロール: オン']);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(container.querySelector('header')).toContainElement(screen.getByRole('status'));
    expect(screen.getByRole('status')).toHaveTextContent('コメント接続済み');
    expect(screen.queryByRole('button', { name: /音声を/ })).not.toBeInTheDocument();
    expect(sockets).toHaveLength(0); expect(audioInstances).toHaveLength(0); expect(fetch).not.toHaveBeenCalled();
  });

  it('Androidの配色だけを変更し、コメントの設定・履歴・スクロール・フォーカスと表示世代を維持する', async () => {
    window.history.replaceState({}, '', '/comments?embedded=android');
    const { container } = render(<MobileCommentsPage />);
    await screen.findByText(comment.content[0]!.text);
    // Finish initial auto-scroll before testing appearance-only changes.
    await act(async () => undefined);
    const page = container.querySelector('.mobile-comments-page')!;
    const item = container.querySelector('.comment')!;
    const list = container.querySelector<HTMLElement>('.comment-stream')!;
    const control = screen.getByRole('button', { name: '自動スクロール: オン' });
    list.scrollTop = 23; control.focus();
    const readyCount = bridge.postMessage.mock.calls.filter(([message]) => message === 'ready').length;
    await act(async () => bridge.onmessage?.({ data: JSON.stringify({ type: 'android.presentation', payload: { theme: 'dark' } }) }));
    expect(page).toHaveClass('native-comment-theme-dark');
    expect(container.querySelector('.comment')).toBe(item);
    expect(item).toHaveStyle({ fontSize: '16px', color: 'var(--android-text)', backgroundColor: 'var(--android-background)' });
    expect(commentList.textColor).toBe('#edf0ffff');
    expect(commentList.backgroundColor).toBe('#131524ff');
    expect(list.scrollTop).toBe(23); expect(control).toHaveFocus();
    expect(bridge.postMessage.mock.calls.filter(([message]) => message === 'ready')).toHaveLength(readyCount);
    expect(sockets).toHaveLength(0); expect(audioInstances).toHaveLength(0); expect(fetch).not.toHaveBeenCalled();
    await act(async () => {
      bridge.onmessage?.({ data: JSON.stringify({ type: 'android.presentation', payload: { theme: 'system' } }) });
      bridge.onmessage?.({ data: JSON.stringify({ type: 'android.presentation', payload: null }) });
    });
    expect(page).toHaveClass('native-comment-theme-dark');
    await act(async () => bridge.onmessage?.({ data: JSON.stringify({ type: 'android.presentation', payload: { theme: 'light' } }) }));
    expect(page).toHaveClass('native-comment-theme-light');
    expect(container.querySelector('.comment')).toBe(item);
    await act(async () => bridge.onmessage?.({ data: JSON.stringify(wire('commentList.settingsChanged', {
      ...commentList, fontSizePx: 24, fontFamily: 'Arial', showAuthor: false,
      textColor: '#ffff00ff', backgroundColor: '#000000ff',
    }, 1, 2)) }));
    expect(item).toHaveStyle({ fontSize: '24px', fontFamily: 'Arial', color: 'var(--android-text)', backgroundColor: 'var(--android-background)' });
    expect(container.querySelector('.comment-meta strong')).toBeNull();
    expect(commentList.textColor).toBe('#edf0ffff');
    expect(commentList.backgroundColor).toBe('#131524ff');
  });

  it('Android埋め込みの本文から左右フリックだけを依頼し、操作・縦・遅い移動・取消・複数指は無視する', async () => {
    window.history.replaceState({}, '', '/comments?embedded=android');
    const { container } = render(<MobileCommentsPage />);
    await screen.findByText(comment.content[0]!.text);
    const content = container.querySelector('.comment-body')!;
    const control = screen.getByRole('button', { name: '自動スクロール: オン' });
    let now = 1000; vi.spyOn(performance, 'now').mockImplementation(() => now);
    const pointer = (target: Element, type: string, x: number, y: number, id = 1, primary = true) => {
      const event = new Event(type, { bubbles: true });
      Object.assign(event, { pointerId: id, clientX: x, clientY: y, button: 0, isPrimary: primary });
      target.dispatchEvent(event);
    };
    const flick = (target: Element, x: number, y = 2, elapsed = 100) => {
      pointer(target, 'pointerdown', 100, 100); now += elapsed; pointer(content, 'pointerup', 100 + x, 100 + y);
    };
    flick(content, -70); flick(content, 80);
    const requests = () => bridge.postMessage.mock.calls.map(([message]) => message).filter(message => message.startsWith('flick:'));
    const before = requests().length;
    expect(requests().slice(-2)).toEqual(['flick:left', 'flick:right']);
    flick(control, 90); flick(content, 20); flick(content, 80, 100); flick(content, 90, 0, 701);
    pointer(content, 'pointerdown', 100, 100); pointer(content, 'pointermove', 105, 140); pointer(content, 'pointerup', 190, 100);
    pointer(content, 'pointerdown', 100, 100); pointer(content, 'pointercancel', 180, 100); pointer(content, 'pointerup', 190, 100);
    pointer(content, 'pointerdown', 100, 100); pointer(content, 'pointerdown', 100, 100, 2, false);
    pointer(content, 'pointerup', 180, 100); pointer(content, 'pointerup', 190, 100, 2, false);
    pointer(content, 'pointerdown', 100, 100); window.dispatchEvent(new Event('blur')); pointer(content, 'pointerup', 190, 100);
    expect(requests()).toHaveLength(before);
    flick(content, 80); expect(requests().at(-1)).toBe('flick:right');
    expect(sockets).toHaveLength(0); expect(audioInstances).toHaveLength(0);
  });

  it('通常ブラウザはbootstrapなしで同期し、開始と明示停止を保存する', async () => {
    const user = userEvent.setup(); const { container } = render(<MobileCommentsPage />);
    await screen.findByText(comment.content[0]!.text);
    expect(container.querySelector('.comment')).toHaveStyle({ color: commentList.textColor, backgroundColor: commentList.backgroundColor });
    expect(screen.getByText('アプリ接続済み')).toBeInTheDocument(); expect(fetch).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '読み上げを聞く' }));
    expect(sockets[0]!.messages()).toContainEqual(expect.objectContaining({ type: 'mobile.subscribe', topic: 'audio', enabled: true, generation: 1 }));
    expect(localStorage.getItem('casmate.mobileSpeech.requested')).toBe('started');
    await user.click(screen.getByRole('button', { name: '読み上げを止める' }));
    expect(sockets[0]!.messages()).toContainEqual(expect.objectContaining({ topic: 'audio', enabled: false, generation: 2 }));
    expect(localStorage.getItem('casmate.mobileSpeech.requested')).toBeNull();
  });

  it('開始希望を再読み込みで復元し、明示停止後は復元しない', async () => {
    localStorage.setItem('casmate.mobileSpeech.requested', 'started');
    const view = render(<MobileCommentsPage />); await screen.findByRole('button', { name: '読み上げを止める' });
    expect(sockets[0]!.messages()).toContainEqual(expect.objectContaining({ topic: 'audio', enabled: true }));
    await userEvent.click(screen.getByRole('button', { name: '読み上げを止める' }));
    view.unmount(); render(<MobileCommentsPage />); await screen.findByRole('button', { name: '読み上げを聞く' });
    expect(sockets[1]!.messages().filter(m => m.topic === 'audio')).toEqual([]);
  });

  it('バイナリ先読みを順に再生し、実再生開始を返す', async () => {
    localStorage.setItem('casmate.mobileSpeech.requested', 'started'); render(<MobileCommentsPage />);
    await screen.findByRole('button', { name: '読み上げを止める' });
    await act(async () => { sockets[0]!.audio(); sockets[0]!.audio('b'.repeat(24)); });
    expect(audioInstances[0]!.play).toHaveBeenCalledTimes(1);
    expect(sockets[0]!.messages()).toContainEqual(expect.objectContaining({ type: 'mobile.audioStarted', audioId: 'a'.repeat(24) }));
    await act(async () => audioInstances[0]!.onended?.());
    expect(audioInstances[0]!.play).toHaveBeenCalledTimes(2);
    expect(sockets[0]!.messages()).toContainEqual(expect.objectContaining({ type: 'mobile.audioEnded' }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('自動再生拒否は開始希望を維持し、画面操作で再開する', async () => {
    localStorage.setItem('casmate.mobileSpeech.requested', 'started'); render(<MobileCommentsPage />);
    await screen.findByRole('button', { name: '読み上げを止める' });
    playAudioElement.mockRejectedValueOnce(new DOMException('blocked', 'NotAllowedError'));
    await act(async () => sockets[0]!.audio());
    await screen.findByText(/画面をタップ/); expect(localStorage.getItem('casmate.mobileSpeech.requested')).toBe('started');
    await userEvent.click(screen.getByRole('heading', { name: 'コメント一覧' }));
    await waitFor(() => expect(sockets[0]!.messages()).toContainEqual(expect.objectContaining({ type: 'mobile.audioStarted' })));
  });

  it('利用不可・切断は再生を破棄し、古い購読の遅いバイナリを捨てる', async () => {
    localStorage.setItem('casmate.mobileSpeech.requested', 'started'); render(<MobileCommentsPage />);
    await screen.findByRole('button', { name: '読み上げを止める' });
    await act(async () => {
      sockets[0]!.audio('a'.repeat(24), 1, false);
      sockets[0]!.receive(wire('mobile.audioAvailabilityChanged', { audioAvailable: false }, 0));
      sockets[0]!.binary('a'.repeat(24), 1);
    });
    expect(audioInstances[0]!.play).not.toHaveBeenCalled();
    await act(async () => sockets[0]!.receive(wire('mobile.audioAvailabilityChanged', { audioAvailable: true }, 0)));
    expect(sockets[0]!.messages()).toContainEqual(expect.objectContaining({ topic: 'audio', generation: 3, enabled: true }));
    await act(async () => sockets[0]!.audio('b'.repeat(24), 3));
    await act(async () => sockets[0]!.close());
    expect(audioInstances[0]!.src).toBe(''); expect(localStorage.getItem('casmate.mobileSpeech.requested')).toBe('started');
  });

  it('表示設定をリアルタイム反映し、旧世代の変更を無視する', async () => {
    const { container } = render(<MobileCommentsPage />); await screen.findByText(comment.content[0]!.text);
    await act(async () => sockets[0]!.receive(wire('commentList.settingsChanged', { ...commentList, fontSizePx: 24, showAuthor: false })));
    expect(container.querySelector('.comment')).toHaveStyle({ fontSize: '24px' });
    expect(screen.queryByText('視聴者')).not.toBeInTheDocument();
    await act(async () => sockets[0]!.receive(wire('commentList.settingsChanged', commentList, 99)));
    expect(container.querySelector('.comment')).toHaveStyle({ fontSize: '24px' });
  });
});
