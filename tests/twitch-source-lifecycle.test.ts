import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { TwitchSource } from '../src/main/sources/twitch-source';
import type { SourceStatus } from '../src/main/sources/source-adapter';
import type { IncomingComment } from '../src/shared/types';

class FakeTwitchSocket extends EventEmitter {
  readonly sent: string[] = [];
  closed = false;

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
    this.emit('close');
  }
}

describe('Twitchコメントソースの接続ライフサイクル', () => {
  it('サーバーのRECONNECTを受けたら切断通知を待たず再参加し、旧接続の残りを受理しない', async () => {
    vi.useFakeTimers();
    const sockets: FakeTwitchSocket[] = [];
    const statuses: SourceStatus[] = [];
    const onComment = vi.fn();
    const source = new TwitchSource('kyokutyou', { onStatus: status => statuses.push(status), onComment }, () => {
      const socket = new FakeTwitchSocket(); sockets.push(socket); return socket;
    });
    try {
      await source.start();
      const first = sockets[0];
      first.emit('open');
      first.emit('message', Buffer.from('@room-id=123 :tmi.twitch.tv ROOMSTATE #kyokutyou\r\n'));
      first.emit('message', Buffer.from(':tmi.twitch.tv RECONNECT\r\n@id=late;display-name=Viewer :viewer!viewer@viewer PRIVMSG #kyokutyou :late\r\n'));
      expect(statuses.at(-1)?.state).toBe('reconnecting');
      expect(first.closed).toBe(true);
      expect(onComment).not.toHaveBeenCalled();
      first.emit('message', Buffer.from(':tmi.twitch.tv RECONNECT\r\n'));
      await vi.advanceTimersByTimeAsync(2_999);
      expect(sockets).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(sockets).toHaveLength(2);
      sockets[1].emit('open');
      expect(sockets[1].sent).toContain('JOIN #kyokutyou\r\n');
      sockets[1].emit('message', Buffer.from('@room-id=123 :tmi.twitch.tv ROOMSTATE #kyokutyou\r\n'));
      expect(statuses.at(-1)?.state).toBe('connected');
      await source.stop();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(sockets).toHaveLength(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally { await source.stop(); vi.useRealTimers(); }
  });

  it('連続失敗では3・6・12・24・30秒へ延長し、参加成功後は3秒へ戻る', async () => {
    vi.useFakeTimers();
    const sockets: FakeTwitchSocket[] = [];
    const statuses: SourceStatus[] = [];
    const source = new TwitchSource('kyokutyou', {
      onStatus: status => statuses.push(status), onComment: () => undefined,
    }, () => {
      const socket = new FakeTwitchSocket();
      sockets.push(socket);
      return socket;
    });
    try {
      await source.start();
      for (const wait of [3_000, 6_000, 12_000, 24_000, 30_000, 30_000]) {
        const count = sockets.length;
        sockets.at(-1)!.emit('close');
        expect(statuses.at(-1)?.state).toBe('reconnecting');
        await vi.advanceTimersByTimeAsync(wait - 1);
        expect(sockets).toHaveLength(count);
        await vi.advanceTimersByTimeAsync(1);
        expect(sockets).toHaveLength(count + 1);
      }
      const socket = sockets.at(-1)!;
      socket.emit('open');
      socket.emit('message', Buffer.from('@room-id=123 :tmi.twitch.tv ROOMSTATE #kyokutyou\r\n'));
      socket.emit('close');
      const count = sockets.length;
      await vi.advanceTimersByTimeAsync(2_999);
      expect(sockets).toHaveLength(count);
      await vi.advanceTimersByTimeAsync(1);
      expect(sockets).toHaveLength(count + 1);
    } finally {
      await source.stop();
      vi.useRealTimers();
    }
  });

  it('WSS接続が15秒間始まらない場合に中止して再試行し、旧接続の通知を除外する', async () => {
    vi.useFakeTimers();
    const sockets: FakeTwitchSocket[] = [];
    const statuses: SourceStatus[] = [];
    const onComment = vi.fn();
    const source = new TwitchSource('kyokutyou', {
      onStatus: status => statuses.push(status), onComment,
    }, () => {
      const socket = new FakeTwitchSocket();
      sockets.push(socket);
      return socket;
    });
    try {
      await source.start();
      await vi.advanceTimersByTimeAsync(14_999);
      expect(sockets[0].closed).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(sockets[0].closed).toBe(true);
      expect(statuses.at(-1)?.state).toBe('reconnecting');
      await vi.advanceTimersByTimeAsync(3_000);
      expect(sockets).toHaveLength(2);
      const count = statuses.length;
      sockets[0].emit('open');
      sockets[0].emit('message', Buffer.from('@id=late;display-name=Viewer :viewer!viewer@viewer PRIVMSG #kyokutyou :late\r\n'));
      sockets[0].emit('error', new Error('old socket'));
      sockets[0].emit('close');
      expect(sockets[0].sent).toEqual([]);
      expect(onComment).not.toHaveBeenCalled();
      expect(statuses).toHaveLength(count);
      await source.stop();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(sockets).toHaveLength(2);
    } finally {
      await source.stop();
      vi.useRealTimers();
    }
  });

  it('ソケット作成失敗とcloseが届かないエラーでも再試行する', async () => {
    vi.useFakeTimers();
    const socket = new FakeTwitchSocket();
    socket.close = () => { socket.closed = true; };
    const createSocket = vi.fn().mockImplementationOnce(() => { throw new Error('connection failed'); })
      .mockReturnValue(socket);
    const statuses: SourceStatus[] = [];
    const source = new TwitchSource('kyokutyou', {
      onStatus: status => statuses.push(status), onComment: () => undefined,
    }, createSocket);
    try {
      await expect(source.start()).resolves.toBeUndefined();
      expect(statuses.at(-1)?.state).toBe('reconnecting');
      await vi.advanceTimersByTimeAsync(3_000);
      expect(createSocket).toHaveBeenCalledTimes(2);
      socket.emit('error', new Error('connection failed'));
      expect(socket.closed).toBe(true);
      await vi.advanceTimersByTimeAsync(6_000);
      expect(createSocket).toHaveBeenCalledTimes(3);
    } finally {
      await source.stop();
      vi.useRealTimers();
    }
  });

  it('参加済みならコメントが来なくても接続を保ちPINGへ応答する', async () => {
    vi.useFakeTimers();
    const socket = new FakeTwitchSocket();
    const createSocket = vi.fn(() => socket);
    const statuses: SourceStatus[] = [];
    const source = new TwitchSource('kyokutyou', {
      onStatus: status => statuses.push(status), onComment: () => undefined,
    }, createSocket);
    try {
      await source.start();
      socket.emit('open');
      socket.emit('message', Buffer.from('@room-id=123 :tmi.twitch.tv ROOMSTATE #kyokutyou\r\n'));
      await vi.advanceTimersByTimeAsync(180_000);
      socket.emit('message', Buffer.from('PING :tmi.twitch.tv\r\n'));
      expect(socket.sent.at(-1)).toBe('PONG :tmi.twitch.tv\r\n');
      expect(socket.closed).toBe(false);
      expect(createSocket).toHaveBeenCalledOnce();
      expect(statuses.at(-1)?.state).toBe('connected');
    } finally {
      await source.stop();
      vi.useRealTimers();
    }
  });

  it('PINGへの送信が失敗しても例外を外へ出さず、対象ソケットだけを再接続する', async () => {
    vi.useFakeTimers();
    const sockets: FakeTwitchSocket[] = [];
    const statuses: SourceStatus[] = [];
    const source = new TwitchSource('kyokutyou', {
      onStatus: status => statuses.push(status), onComment: () => undefined,
    }, () => {
      const socket = new FakeTwitchSocket(); sockets.push(socket); return socket;
    });
    try {
      await source.start();
      const socket = sockets[0];
      socket.emit('open');
      socket.emit('message', Buffer.from('@room-id=123 :tmi.twitch.tv ROOMSTATE #kyokutyou\r\n'));
      socket.send = () => { throw new Error('send failed'); };
      expect(() => socket.emit('message', Buffer.from('PING :tmi.twitch.tv\r\n'))).not.toThrow();
      expect(socket.closed).toBe(true);
      expect(statuses.at(-1)?.state).toBe('reconnecting');
      await vi.advanceTimersByTimeAsync(3_000);
      expect(sockets).toHaveLength(2);
    } finally { await source.stop(); vi.useRealTimers(); }
  });

  it('正常コメント受信でも再試行待ちを3秒へ戻す', async () => {
    vi.useFakeTimers();
    const sockets: FakeTwitchSocket[] = [];
    const onComment = vi.fn();
    const source = new TwitchSource('kyokutyou', { onStatus: () => undefined, onComment }, () => {
      const socket = new FakeTwitchSocket(); sockets.push(socket); return socket;
    });
    try {
      await source.start();
      sockets[0].emit('close');
      await vi.advanceTimersByTimeAsync(3_000);
      sockets[1].emit('close');
      await vi.advanceTimersByTimeAsync(6_000);
      sockets[2].emit('open');
      sockets[2].emit('message', Buffer.from('@id=ok;display-name=Viewer :viewer!viewer@viewer PRIVMSG #kyokutyou :hello\r\n'));
      expect(onComment).toHaveBeenCalledOnce();
      sockets[2].emit('close');
      await vi.advanceTimersByTimeAsync(3_000);
      expect(sockets).toHaveLength(4);
    } finally { await source.stop(); vi.useRealTimers(); }
  });

  it('WSSが期限内に開いた後はチャンネル参加を別の15秒期限で待つ', async () => {
    vi.useFakeTimers();
    const socket = new FakeTwitchSocket();
    const statuses: SourceStatus[] = [];
    const source = new TwitchSource('kyokutyou', {
      onStatus: status => statuses.push(status), onComment: () => undefined,
    }, () => socket);
    try {
      await source.start();
      await vi.advanceTimersByTimeAsync(14_999);
      socket.emit('open');
      await vi.advanceTimersByTimeAsync(14_999);
      expect(socket.closed).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(socket.closed).toBe(true);
      expect(statuses.at(-1)?.state).toBe('reconnecting');
    } finally { await source.stop(); vi.useRealTimers(); }
  });

  it('WebSocketエラー後に自動再接続する間はreconnectingになる', async () => {
    const socket = new FakeTwitchSocket();
    const statuses: SourceStatus[] = [];
    const source = new TwitchSource(
      'kyokutyou',
      { onStatus: (status) => statuses.push(status), onComment: () => undefined },
      () => socket,
    );

    await source.start();
    socket.emit('error', new Error('一時的な接続エラー'));

    expect(statuses.at(-1)?.state).toBe('reconnecting');
    await source.stop();
  });

  it('チャンネルへの参加を拒否された場合は再接続せずerrorになる', async () => {
    const socket = new FakeTwitchSocket();
    const statuses: SourceStatus[] = [];
    const source = new TwitchSource(
      'missing-channel',
      { onStatus: (status) => statuses.push(status), onComment: () => undefined },
      () => socket,
    );

    await source.start();
    socket.emit('open');
    socket.emit(
      'message',
      Buffer.from('@msg-id=msg_channel_suspended :tmi.twitch.tv NOTICE #missing-channel :Channel does not exist.\r\n'),
    );

    expect(socket.closed).toBe(true);
    expect(statuses.at(-1)).toMatchObject({
      state: 'error',
      message: 'Channel does not exist.',
    });
  });

  it('参加応答がない場合は待機期限後にreconnectingになる', async () => {
    vi.useFakeTimers();
    try {
      const socket = new FakeTwitchSocket();
      const statuses: SourceStatus[] = [];
      const source = new TwitchSource(
        'missing-channel',
        { onStatus: (status) => statuses.push(status), onComment: () => undefined },
        () => socket,
      );

      await source.start();
      socket.emit('open');
      await vi.advanceTimersByTimeAsync(15_000);

      expect(socket.closed).toBe(true);
      expect(statuses.at(-1)).toMatchObject({
        state: 'reconnecting',
        message: 'Twitchチャンネルから応答がないため再接続します。',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('公式WSSへ接続し、IRCメッセージを送受信して停止できる', async () => {
    const socket = new FakeTwitchSocket();
    const statuses: SourceStatus[] = [];
    const comments: IncomingComment[] = [];
    let requestedUrl = '';
    const source = new TwitchSource(
      'kyokutyou',
      {
        onStatus: (status) => statuses.push(status),
        onComment: (comment) => comments.push(comment),
      },
      (url) => {
        requestedUrl = url;
        return socket;
      },
    );

    await source.start();
    try {
      expect(requestedUrl).toBe('wss://irc-ws.chat.twitch.tv:443');

      socket.emit('open');
      expect(socket.sent).toEqual([
        'PASS SCHMOOPIIE\r\n',
        expect.stringMatching(/^NICK justinfan\d{5}\r\n$/),
        'CAP REQ :twitch.tv/tags twitch.tv/commands\r\n',
        'JOIN #kyokutyou\r\n',
      ]);
      socket.emit(
        'message',
        Buffer.from('@room-id=123 :tmi.twitch.tv ROOMSTATE #kyokutyou\r\n'),
      );
      expect(statuses.at(-1)?.state).toBe('connected');

      socket.emit(
        'message',
        Buffer.from('@id=message-1;display-name=Viewer :viewer!viewer@viewer PRIVMSG #kyokutyou :hello\r\n'),
      );
      expect(comments).toHaveLength(1);
      expect(comments[0]).toMatchObject({
        externalId: 'message-1',
        source: 'twitch',
        authorName: 'Viewer',
        initialHistory: false,
      });

      socket.emit('message', Buffer.from('PING :tmi.twitch.tv\r\n'));
      expect(socket.sent.at(-1)).toBe('PONG :tmi.twitch.tv\r\n');
    } finally {
      await source.stop();
    }

    expect(socket.closed).toBe(true);
    expect(statuses.at(-1)?.state).toBe('stopped');
  });
});
