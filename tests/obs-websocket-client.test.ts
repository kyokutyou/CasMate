import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import { ObsCaptureCoordinator } from '../src/main/obs/obs-capture-coordinator';
import {
  DefaultObsWebsocketTransport,
  obsAuthentication,
} from '../src/main/obs/obs-websocket-client';

describe('OBS WebSocket client', () => {
  it('subscribes to geometry changes while retaining standard events and excluding other high-volume streams', async () => {
    const server = new WebSocketServer({ port: 0 }); await once(server, 'listening');
    const address = server.address() as AddressInfo;
    let subscriptions = 0;
    server.on('connection', socket => {
      socket.send(JSON.stringify({ op: 0, d: { rpcVersion: 1, authentication: { challenge: 'fixture', salt: 'fixture' } } }));
      socket.on('message', raw => {
        const message = JSON.parse(String(raw));
        if (message.op === 1) {
          subscriptions = message.d.eventSubscriptions ?? 0x7ff;
          socket.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }));
        }
        if (message.op === 6) {
          socket.send(JSON.stringify({ op: 7, d: { requestId: message.d.requestId, requestStatus: { result: true, code: 100 }, responseData: { outputActive: false } } }));
          if (subscriptions & (1 << 6)) socket.send(JSON.stringify({ op: 5, d: { eventType: 'StreamStateChanged', eventData: { outputActive: false } } }));
          if (subscriptions & (1 << 19)) socket.send(JSON.stringify({ op: 5, d: { eventType: 'SceneItemTransformChanged', eventData: { sceneName: 'scene', sceneUuid: 'scene-id', sceneItemId: 7, sceneItemTransform: { positionX: 100 } } } }));
        }
      });
    });
    const connection = await new DefaultObsWebsocketTransport().connect(`ws://127.0.0.1:${address.port}`, 'fixture');
    try {
      const received = vi.fn(); connection.subscribe(received); await connection.getStreamStatus();
      await vi.waitFor(() => expect(received).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'SceneItemTransformChanged' })));
      expect(received).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'StreamStateChanged' }));
      expect(subscriptions & 0xfff).toBe(0xfff);
      expect(subscriptions & ((1 << 16) | (1 << 17) | (1 << 18))).toBe(0);
    } finally { await connection.close(); for (const socket of server.clients) socket.terminate(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  it.each([[4009, 'OBS_AUTHENTICATION_FAILED'], [4010, 'OBS_PROTOCOL_UNSUPPORTED']] as const)('識別中の終了コード%sを復旧方法別に分類する', async (code, reason) => {
    const server = new WebSocketServer({ port: 0 });
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    server.on('connection', socket => {
      socket.send(JSON.stringify({ op: 0, d: { rpcVersion: 1, authentication: { challenge: 'fixture', salt: 'fixture' } } }));
      socket.once('message', () => socket.close(code));
    });
    try {
      await expect(new DefaultObsWebsocketTransport().connect(`ws://127.0.0.1:${address.port}`, 'fixture')).rejects.toThrow(reason);
    } finally {
      for (const socket of server.clients) socket.terminate();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it.each([null, [], { op: 0 }, { op: 0, d: [] }])('rejects malformed hello %j without escaping the connection', async (hello) => {
    const server = new WebSocketServer({ port: 0 });
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    server.on('connection', socket => socket.send(JSON.stringify(hello)));
    try {
      await expect(new DefaultObsWebsocketTransport().connect(`ws://127.0.0.1:${address.port}`, 'fixture'))
        .rejects.toThrow('OBS_WEBSOCKET_PROTOCOL');
    } finally {
      for (const socket of server.clients) socket.terminate();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }, 7000);

  it('discards malformed events and responses while preserving valid state requests', async () => {
    const server = new WebSocketServer({ port: 0 });
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    server.on('connection', socket => {
      socket.send(JSON.stringify({ op: 0, d: { rpcVersion: 1, authentication: { challenge: 'fixture', salt: 'fixture' } } }));
      socket.on('message', raw => {
        const message = JSON.parse(String(raw));
        if (message.op === 1) socket.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }));
        if (message.op === 6) {
          for (const invalid of [null, [], { op: 5 }, { op: 5, d: null }, { op: 7 },
            { op: 7, d: { requestId: message.d.requestId, requestStatus: { result: 'yes', code: 100 } } }]) {
            socket.send(JSON.stringify(invalid));
          }
          socket.send(JSON.stringify({ op: 7, d: { requestId: message.d.requestId,
            requestStatus: { result: true, code: 100 }, responseData: { outputActive: false } } }));
        }
      });
    });
    const connection = await new DefaultObsWebsocketTransport().connect(`ws://127.0.0.1:${address.port}`, 'fixture');
    try {
      await expect(connection.getStreamStatus()).resolves.toMatchObject({ outputActive: false });
    } finally {
      await connection.close();
      for (const socket of server.clients) socket.terminate();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it.each(['late reply', 'no reply', 'disconnect'])('keeps the physical screenshot slot beyond five seconds (%s)', async scenario => {
    const server = new WebSocketServer({ port: 0 });
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;
    let sendLate!: () => void, observed!: () => void, screenshots = 0;
    const firstSent = new Promise<void>(resolve => { observed = resolve; });
    server.on('connection', socket => {
      socket.send(JSON.stringify({ op:0, d:{ rpcVersion:1, authentication:{ challenge:'fixture', salt:'fixture' } } }));
      socket.on('message', raw => {
        const { op, d } = JSON.parse(String(raw));
        if (op === 1) socket.send(JSON.stringify({ op:2, d:{ negotiatedRpcVersion:1 } }));
        if (op !== 6) return;
        const reply = (responseData: Record<string, unknown>) => socket.send(JSON.stringify({
          op:7, d:{ requestId:d.requestId, requestStatus:{ result:true, code:100 }, responseData },
        }));
        if (d.requestType === 'GetStreamStatus') reply({ outputActive:false });
        if (d.requestType === 'GetSourceScreenshot') {
          if (++screenshots === 1) {
            sendLate = () => reply({ imageData:'late' });
            observed();
          } else reply({ imageData:'next' });
        }
      });
    });
    const connection = await new DefaultObsWebsocketTransport().connect(`ws://127.0.0.1:${port}`, 'fixture');
    vi.useFakeTimers({ toFake:['setTimeout', 'clearTimeout'] });
    try {
      const slot = new ObsCaptureCoordinator();
      const capture = () => slot.run('background', () => connection.request('GetSourceScreenshot'));
      const original = capture().catch((error: unknown) => error);
      const ordinary = connection.request('GetSceneList').catch((error: unknown) => error);
      await firstSent;
      await vi.advanceTimersByTimeAsync(5000);
      expect(await ordinary).toMatchObject({ message:'OBS_WEBSOCKET_TIMEOUT' });
      await expect(capture()).rejects.toThrow('BUSY');
      await expect(connection.getStreamStatus()).resolves.toMatchObject({ outputActive:false });
      expect(screenshots).toBe(1);
      if (scenario === 'disconnect') {
        for (const socket of server.clients) socket.terminate();
        expect(await original).toMatchObject({ message:'OBS_WEBSOCKET_DISCONNECTED' });
        await expect(slot.run('background', async () => 'released')).resolves.toBe('released');
        return;
      }
      if (scenario === 'late reply') {
        await vi.advanceTimersByTimeAsync(1000);
        sendLate();
        expect(await original).toMatchObject({ responseData:{ imageData:'late' } });
      } else {
        await vi.advanceTimersByTimeAsync(4999);
        await expect(capture()).rejects.toThrow('BUSY');
        await vi.advanceTimersByTimeAsync(1);
        expect(await original).toMatchObject({ message:'OBS_WEBSOCKET_TIMEOUT' });
        sendLate();
      }
      await expect(capture()).resolves.toMatchObject({ responseData:{ imageData:'next' } });
      expect(screenshots).toBe(2);
    } finally {
      await connection.close();
      for (const socket of server.clients) socket.terminate();
      await new Promise<void>(resolve => server.close(() => resolve()));
      vi.useRealTimers();
    }
  });

  it('derives the initial stopped state from GetStreamStatus without outputState', async () => {
    const server = new WebSocketServer({ port: 0 });
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    const password = 'fixture-password';
    const challenge = 'fixture-challenge';
    const salt = 'fixture-salt';
    server.on('connection', (socket) => {
      socket.send(JSON.stringify({ op: 0, d: { rpcVersion: 1, authentication: { challenge, salt } } }));
      socket.on('message', (raw) => {
        const message = JSON.parse(String(raw)) as { op: number; d: Record<string, unknown> };
        if (message.op === 1) {
          expect(message.d.authentication).toBe(obsAuthentication(password, { challenge, salt }));
          socket.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }));
          return;
        }
        if (message.op === 6 && message.d.requestType === 'GetStreamStatus') {
          socket.send(JSON.stringify({
            op: 7,
            d: {
              requestId: message.d.requestId,
              requestStatus: { result: true, code: 100 },
              responseData: { outputActive: false, outputReconnecting: false },
            },
          }));
        }
      });
    });

    const connection = await new DefaultObsWebsocketTransport().connect(`ws://127.0.0.1:${address.port}`, password);
    await expect(connection.getStreamStatus()).resolves.toEqual({
      outputActive: false,
      outputState: 'OBS_WEBSOCKET_OUTPUT_STOPPED',
    });
    await connection.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
});
