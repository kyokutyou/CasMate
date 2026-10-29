import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { describe, expect, it, vi } from 'vitest';
import { MobileReadSession } from '../src/main/server/mobile-read-session';
import { AppState } from '../src/main/core/app-state';
import { createDefaultSettings } from '../src/main/core/settings';

describe('公開WSのtopic境界', () => {
  it('音声だけなら履歴を送らず、バイナリ・履歴分割・旧世代拒否を共用する', async () => {
    const state = new AppState(createDefaultSettings());
    const begin = vi.spyOn(state, 'startMobileSpeech').mockReturnValue(true);
    const finish = vi.spyOn(state, 'finishMobileAudio');
    vi.spyOn(state, 'mobileAudio').mockImplementation(id => Buffer.alloc(id.startsWith('a') ? 40_000 : 8000, 7));
    const server = new WebSocketServer({ port: 0 });
    await once(server, 'listening');
    const address = server.address(); if (typeof address === 'string' || !address) throw new Error();
    let session!: MobileReadSession;
    const snapshot = vi.fn(() => ({ revision: 1, payload: { protocolVersion: 2 as const, comments: [], sourcesRunning: false,
      mobilePublished: true, audioAvailable: true, commentList: createDefaultSettings().commentList } }));
    server.on('connection', ws => { session = new MobileReadSession('test', ws, state, snapshot, () => undefined); });
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}`);
    const text: Array<Record<string, unknown>> = []; const binary: Buffer[] = [];
    ws.on('message', (data, isBinary) => { if (isBinary) binary.push(Buffer.from(data as Buffer)); else text.push(JSON.parse(String(data))); });
    try {
      await once(ws, 'open');
      const send = (value: unknown) => ws.send(JSON.stringify(value));
      send({ type: 'mobile.subscribe', protocolVersion: 2, topic: 'audio', generation: 1, enabled: true });
      await vi.waitFor(() => expect(begin).toHaveBeenCalledOnce());
      expect(snapshot).not.toHaveBeenCalled();
      session.audioReady({ audioId: 'a'.repeat(24), commentId: 'opaque', expiresInMs: 15000 });
      session.audioReady({ audioId: 'b'.repeat(24), commentId: 'short-prefetch', expiresInMs: 15000 });
      await vi.waitFor(() => expect(binary).toHaveLength(4));
      expect(binary.map(b => b.toString('ascii', 12, 36))).toEqual(['a', 'a', 'a', 'b'].map(id => id.repeat(24)));
      expect(binary.slice(0, 3).map(b => b.readUInt32BE(8))).toEqual([0, 16384, 32768]);
      expect(binary.every(b => b.readUInt32BE(4) === 1 && b.length <= 16420)).toBe(true);
      expect(Buffer.concat(binary.slice(0, 3).map(b => b.subarray(36)))).toEqual(Buffer.alloc(40_000, 7));
      send({ type: 'mobile.subscribe', protocolVersion: 2, topic: 'audio', generation: 2, enabled: false });
      send({ type: 'mobile.audioEnded', audioId: 'a'.repeat(24), generation: 1 });
      send({ type: 'mobile.subscribe', protocolVersion: 2, topic: 'comments', generation: 1, enabled: true });
      await vi.waitFor(() => expect(text.some(e => e.type === 'mobile.snapshotEnd')).toBe(true));
      expect(finish).not.toHaveBeenCalled();
      expect(snapshot).toHaveBeenCalledOnce();
    } finally { ws.terminate(); await new Promise<void>(resolve => server.close(() => resolve())); state.dispose(); }
  });
});
