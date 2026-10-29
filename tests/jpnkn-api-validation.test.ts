import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { AiConnections } from '../src/main/ai/ai-connections';
import { AiController } from '../src/main/ai/ai-controller';
import { AiStore } from '../src/main/ai/ai-store';
import { AppState } from '../src/main/core/app-state';
import { createDefaultSettings } from '../src/main/core/settings';
import { createHttpApplication } from '../src/main/server/local-server';

const headers = {
  Host: '127.0.0.1:3000',
  Origin: 'http://127.0.0.1:3000',
  'X-CasMate-Token': 'secret',
};

async function fixture() {
  const settings = createDefaultSettings();
  settings.sources.shitaraba.threadUrl = 'https://bbs.jpnkn.com/test/read.cgi/clarahas/123/';
  const state = new AppState(settings);
  const start = vi.spyOn(state, 'startSource').mockResolvedValue();
  const stop = vi.spyOn(state, 'stopSource').mockResolvedValue();
  const reconnect = vi.spyOn(state, 'reconnectSource').mockResolvedValue();
  const store = new AiStore(await mkdtemp(join(tmpdir(), 'casmate-board-api-')), {
    isEncryptionAvailable: () => false,
    encryptString: () => Buffer.alloc(0),
    decryptString: () => '',
  });
  const fetcher = vi.fn<typeof fetch>(async () => { throw new Error('このAPI境界テストでは外部通信しません。'); });
  const connections = new AiConnections(store, async () => undefined, () => undefined, fetcher);
  const controller = new AiController(settings.aiListener, {
    store,
    gateway: connections,
    changed: (view) => state.setAiView(view),
    acquire: async () => undefined,
    release: async () => undefined,
    ngWords: () => [],
  });
  const resume = vi.spyOn(controller, 'resume').mockResolvedValue();
  const app = createHttpApplication({
    state, port: 3000, operationToken: 'secret',
    ai: { controller, connections, openLogs: async () => undefined },
  });
  return {
    app, state, start, stop, reconnect, controller, connections, resume, fetcher,
    async close() { await controller.shutdown(); await state.shutdown(); await connections.shutdown(); },
  };
}

describe('掲示板枠と実サービスのREST検証', () => {
  it('接続操作は従来の3枠だけを受け付け、jpnknの独立接続キーを拒否する', async () => {
    const test = await fixture();
    try {
      for (const [action, operation] of [
        ['start', test.start], ['stop', test.stop], ['reconnect', test.reconnect],
      ] as const) {
        for (const source of ['youtube', 'twitch', 'shitaraba'] as const) {
          const response = await request(test.app).post(`/api/sources/${source}/${action}`).set(headers);
          expect(response.status).toBe(200);
          expect(operation).toHaveBeenLastCalledWith(source);
          expect(response.body.snapshot.settings.sources.shitaraba.threadUrl).toBe(
            'https://bbs.jpnkn.com/test/read.cgi/clarahas/123/',
          );
        }
        expect(operation).toHaveBeenCalledTimes(3);
        for (const source of ['jpnkn', 'unknown']) {
          const response = await request(test.app).post(`/api/sources/${source}/${action}`).set(headers);
          expect(response.status).toBe(400);
          expect(response.body.code).toBe('VALIDATION_ERROR');
        }
        expect(operation).toHaveBeenCalledTimes(3);
      }
      expect(test.fetcher).not.toHaveBeenCalled();
    } finally { await test.close(); }
  });

  it('AI再開はjpnknを含む4サービスを受け付け、未知サービスとjpnkn OAuth操作を拒否する', async () => {
    const test = await fixture();
    const begin = vi.spyOn(test.connections, 'begin').mockImplementation(() => undefined);
    const unlink = vi.spyOn(test.connections, 'unlink').mockResolvedValue();
    try {
      for (const source of ['youtube', 'twitch', 'shitaraba', 'jpnkn'] as const) {
        const response = await request(test.app).post('/api/ai-listener/resume').set(headers).send({ source });
        expect(response.status).toBe(200);
        expect(test.resume).toHaveBeenLastCalledWith(source);
      }
      const all = await request(test.app).post('/api/ai-listener/resume').set(headers).send({});
      expect(all.status).toBe(200);
      expect(test.resume).toHaveBeenLastCalledWith(undefined);
      for (const source of ['unknown', 'board', 'jpnkn.invalid', 123]) {
        const response = await request(test.app).post('/api/ai-listener/resume').set(headers).send({ source });
        expect(response.status).toBe(400);
        expect(response.body.code).toBe('AI_OPERATION_FAILED');
      }
      expect(test.resume).toHaveBeenCalledTimes(5);
      for (const action of ['link', 'unlink']) {
        const response = await request(test.app).post(`/api/ai-listener/${action}`).set(headers).send({ source: 'jpnkn' });
        expect(response.status).toBe(400);
        expect(response.body.code).toBe('AI_OPERATION_FAILED');
      }
      expect(begin).not.toHaveBeenCalled();
      expect(unlink).not.toHaveBeenCalled();
      expect(test.fetcher).not.toHaveBeenCalled();
    } finally { await test.close(); }
  });
});
