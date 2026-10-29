import { createServer } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { AppState } from '../src/main/core/app-state';
import { createDefaultSettings } from '../src/main/core/settings';
import { LocalServer } from '../src/main/server/local-server';
import type {
  RealtimeEvent,
  SpeechRecognitionOverlayRealtimeEvent,
} from '../src/shared/types';
import type { SpeechRecognitionWorker, SpeechRecognitionWorkerEvent } from '../src/main/speech-recognition/speech-recognition-worker';

describe('WebSocketリアルタイム同期', () => {
  it('接続直後のスナップショットと以後の状態変更を同じ順序で配信する', async () => {
    const port = await freePort();
    const state = new AppState(createDefaultSettings());
    const server = new LocalServer({ state, port });
    await server.start();
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      origin: `http://127.0.0.1:${port}`,
    });
    try {
      const first = await nextMessage(socket);
      expect(first.type).toBe('state.snapshot');

      const receivedPromise = messagesUntil(socket, 'comment.received');
      state.acceptComment({
        externalId: 'realtime-1', source: 'twitch', authorName: 'Viewer',
        content: [{ type: 'text', text: 'hello' }], initialHistory: false,
      });
      const received = await receivedPromise;
      expect(received.revision).toBeGreaterThan(first.revision);
      expect((received.payload as { externalId: string }).externalId).toBe('realtime-1');
    } finally {
      socket.close();
      await server.stop();
      state.dispose();
    }
  });

  it('次スレッド状態は操作トークンを持つ管理WebSocketだけへ配信する', async () => {
    const port = await freePort();
    const state = new AppState(createDefaultSettings());
    const server = new LocalServer({ state, port, operationToken: 'secret' });
    await server.start();
    const readOnly = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      origin: `http://127.0.0.1:${port}`,
    });
    const management = new WebSocket(
      `ws://127.0.0.1:${port}/ws?management=${encodeURIComponent('secret')}`,
      { origin: `http://127.0.0.1:${port}` },
    );
    try {
      const [readOnlySnapshot, managementSnapshot] = await Promise.all([
        nextMessage(readOnly),
        nextMessage(management),
      ]);

      expect(readOnlySnapshot.payload).not.toHaveProperty('shitarabaNextThread');
      expect(managementSnapshot.payload).toHaveProperty('shitarabaNextThread');
    } finally {
      readOnly.close();
      management.close();
      await server.stop();
      state.dispose();
    }
  });

  it('音声認識の状態と結果を管理WebSocketだけへ配信する', async () => {
    const port = await freePort();
    const worker = new WebSocketSpeechRecognitionWorker();
    const state = new AppState(createDefaultSettings(), { speechRecognitionWorker: worker });
    await state.startSpeechRecognitionPreview();
    const server = new LocalServer({ state, port, operationToken: 'secret' });
    await server.start();
    const readOnly = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: `http://127.0.0.1:${port}` });
    const management = new WebSocket(`ws://127.0.0.1:${port}/ws?management=secret`, { origin: `http://127.0.0.1:${port}` });
    try {
      await Promise.all([nextMessage(readOnly), nextMessage(management)]);
      const managementResult = messagesUntil(management, 'speechRecognition.resultReceived');
      const readOnlyNext = nextMessage(readOnly);
      worker.emit({ type: 'result', result: {
        id: 'result-1', sessionId: 'session-1', sequence: 1,
        recognizedAt: '2026-08-28T00:00:00.000Z', text: '非公開の認識結果',
        audioDurationMilliseconds: 1000, recognitionDurationMilliseconds: 100,
      } });
      state.acceptComment({
        externalId: 'public-comment', source: 'twitch', authorName: 'Viewer',
        content: [{ type: 'text', text: '公開コメント' }], initialHistory: false,
      });

      expect((await managementResult).type).toBe('speechRecognition.resultReceived');
      const publicEvent = await readOnlyNext;
      expect(publicEvent.type).toBe('comment.received');
      expect(JSON.stringify(publicEvent)).not.toContain('非公開の認識結果');
    } finally {
      readOnly.close();
      management.close();
      await server.stop();
      state.dispose();
    }
  });

  it('専用WebSocketへ表示状態と専用外観だけを配信する', async () => {
    const port = await freePort();
    const worker = new WebSocketSpeechRecognitionWorker();
    const settings = createDefaultSettings();
    settings.speechRecognition.enabled = true;
    const state = new AppState(settings, {
      speechRecognitionWorker: worker,
      saveSettings: async () => undefined,
    });
    const server = new LocalServer({ state, port });
    await server.start();
    const socket = new WebSocket(
      `ws://127.0.0.1:${port}/ws/overlay/speech-recognition`,
      { origin: `http://127.0.0.1:${port}` },
    );
    const secondSocket = new WebSocket(
      `ws://127.0.0.1:${port}/ws/overlay/speech-recognition`,
      { origin: `http://127.0.0.1:${port}` },
    );
    let reconnected: WebSocket | null = null;
    let expiredReconnect: WebSocket | null = null;
    try {
      const [snapshot, secondSnapshot] = await Promise.all([
        nextOverlayMessage(socket),
        nextOverlayMessage(secondSocket),
      ]);
      expect(snapshot).toEqual({
        type: 'speechRecognitionOverlay.snapshot',
        revision: 0,
        payload: {
          state: { active: null },
          appearance: {
            fontFamily: 'Yu Gothic UI', fontSizePx: 32, textColor: '#ffffffff',
            backgroundColor: '#00000099', paddingPx: 8, borderRadiusPx: 8,
          },
        },
      });
      expect(secondSnapshot).toEqual(snapshot);

      const stateChanged = Promise.all([
        nextOverlayMessage(socket),
        nextOverlayMessage(secondSocket),
      ]);
      worker.emit({ type: 'result', result: {
        id: 'result-1', sessionId: 'session-1', sequence: 1,
        recognizedAt: '2026-08-28T00:00:00.000Z', text: '専用表示だけ',
        audioDurationMilliseconds: 1_000, recognitionDurationMilliseconds: 100,
      } });
      const synchronized = await stateChanged;
      for (const event of synchronized) {
        expect(event).toMatchObject({
          type: 'speechRecognitionOverlay.stateChanged',
          revision: 1,
          payload: { active: { id: 'result-1', text: '専用表示だけ' } },
        });
      }

      secondSocket.close();
      reconnected = new WebSocket(
        `ws://127.0.0.1:${port}/ws/overlay/speech-recognition`,
        { origin: `http://127.0.0.1:${port}` },
      );
      expect(await nextOverlayMessage(reconnected)).toMatchObject({
        type: 'speechRecognitionOverlay.snapshot',
        revision: 1,
        payload: { state: { active: { id: 'result-1', text: '専用表示だけ' } } },
      });

      const appearanceChanged = messagesUntilOverlay(
        socket,
        'speechRecognitionOverlay.appearanceChanged',
      );
      await state.updateSettings('speechRecognitionOverlay', {
        ...settings.speechRecognitionOverlay,
        fontSizePx: 48,
      });
      expect(await appearanceChanged).toMatchObject({
        payload: { fontSizePx: 48 },
      });

      const dateNow = vi.spyOn(Date, 'now').mockReturnValue(0);
      const expiredState = messagesUntilOverlay(
        socket,
        'speechRecognitionOverlay.stateChanged',
      );
      worker.emit({ type: 'result', result: {
        id: 'expired', sessionId: 'session-1', sequence: 2,
        recognizedAt: '2026-08-28T00:00:01.000Z', text: '期限切れ結果',
        audioDurationMilliseconds: 1_000, recognitionDurationMilliseconds: 100,
      } });
      await expiredState;
      dateNow.mockRestore();

      reconnected.close();
      expiredReconnect = new WebSocket(
        `ws://127.0.0.1:${port}/ws/overlay/speech-recognition`,
        { origin: `http://127.0.0.1:${port}` },
      );
      expect(await nextOverlayMessage(expiredReconnect)).toMatchObject({
        type: 'speechRecognitionOverlay.snapshot',
        revision: 3,
        payload: { state: { active: null } },
      });
    } finally {
      socket.close();
      secondSocket.close();
      reconnected?.close();
      expiredReconnect?.close();
      await server.stop();
      state.dispose();
    }
  });

  it.each([
    ['shitaraba', 'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/456/'],
    ['jpnkn', 'https://bbs.jpnkn.com/test/read.cgi/kyokutyou/123/'],
  ])('非公開イベントを除外しても読取WebSocketのリビジョンを連番に保つ（%s）', async (service, threadUrl) => {
    const port = await freePort();
    const settings = createDefaultSettings();
    const state = new AppState(settings, { saveSettings: async () => undefined, boardWriteAdapter: {
      fetchThreadContent: async () => ({ title: 'スレ1', body: '本文' }),
      findThreadsByTitle: async () => [], createNextThread: async () => { throw new Error('Unexpected POST'); },
      announceNextThread: async () => { throw new Error('Unexpected POST'); },
    } });
    const server = new LocalServer({ state, port });
    await server.start();
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      origin: `http://127.0.0.1:${port}`,
    });
    try {
      const snapshot = await nextMessage(socket);
      const nextSources = structuredClone(settings.sources);
      nextSources.shitaraba = {
        ...nextSources.shitaraba,
        threadUrl,
        nextThread: {
          ...nextSources.shitaraba.nextThread,
          enabled: true,
          titleMode: 'manual',
          manualTitle: '次タイトル',
          bodyMode: 'manual',
          manualBody: '次本文',
        },
      };

      const publicEvents = nextMessages(socket, 3);
      await state.updateSettings('sources', nextSources);
      const [sourceStatus, serviceChanged, settingsChanged] = await publicEvents;

      expect(sourceStatus.revision).toBe(snapshot.revision + 1);
      expect(serviceChanged.revision).toBe(sourceStatus.revision + 1);
      expect(serviceChanged).toMatchObject({ type: 'source.statusChanged', payload: { source: 'shitaraba', service } });
      expect(settingsChanged.revision).toBe(serviceChanged.revision + 1);
      expect(settingsChanged.type).toBe('settings.changed');
      expect(settingsChanged.payload).not.toHaveProperty('value.shitaraba.nextThread');
    } finally {
      socket.close();
      await server.stop();
      state.dispose();
    }
  });
});

class WebSocketSpeechRecognitionWorker implements SpeechRecognitionWorker {
  private listener: ((event: SpeechRecognitionWorkerEvent) => void) | null = null;
  subscribe(listener: (event: SpeechRecognitionWorkerEvent) => void) {
    this.listener = listener;
    return () => { this.listener = null; };
  }
  initialize = async () => undefined;
  listMicrophones = async () => [];
  prepareModel = async () => undefined;
  start = async () => ({ sessionId: 'session-1' });
  stop = async () => undefined;
  setWavSaving = async () => undefined;
  retry = async () => undefined;
  shutdown = async () => undefined;
  emit(event: SpeechRecognitionWorkerEvent) { this.listener?.(event); }
}

function nextMessage(socket: WebSocket): Promise<RealtimeEvent> {
  return new Promise((resolve, reject) => {
    socket.once('message', (data) => resolve(JSON.parse(String(data)) as RealtimeEvent));
    socket.once('error', reject);
  });
}

function nextMessages(socket: WebSocket, count: number): Promise<RealtimeEvent[]> {
  return new Promise((resolve, reject) => {
    const messages: RealtimeEvent[] = [];
    const onMessage = (data: WebSocket.RawData) => {
      messages.push(JSON.parse(String(data)) as RealtimeEvent);
      if (messages.length !== count) return;
      socket.off('message', onMessage);
      socket.off('error', reject);
      resolve(messages);
    };
    socket.on('message', onMessage);
    socket.once('error', reject);
  });
}

async function messagesUntil(socket: WebSocket, type: RealtimeEvent['type']) {
  while (true) {
    const message = await nextMessage(socket);
    if (message.type === type) return message;
  }
}

function nextOverlayMessage(socket: WebSocket): Promise<SpeechRecognitionOverlayRealtimeEvent> {
  return new Promise((resolve, reject) => {
    socket.once('message', (data) => resolve(
      JSON.parse(String(data)) as SpeechRecognitionOverlayRealtimeEvent,
    ));
    socket.once('error', reject);
  });
}

async function messagesUntilOverlay(
  socket: WebSocket,
  type: SpeechRecognitionOverlayRealtimeEvent['type'],
) {
  while (true) {
    const message = await nextOverlayMessage(socket);
    if (message.type === type) return message;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}
