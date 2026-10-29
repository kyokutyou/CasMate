import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import {
  DefaultObsWebsocketTransport,
  obsAuthentication,
} from '../src/main/obs/obs-websocket-client';

describe('OBS WebSocket client', () => {
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
