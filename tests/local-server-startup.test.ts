import { connect, createServer } from 'node:net';
import { once } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { AiController } from '../src/main/ai/ai-controller';
import { AiStore } from '../src/main/ai/ai-store';
import { AppState } from '../src/main/core/app-state';
import { createDefaultSettings } from '../src/main/core/settings';
import { LocalServer } from '../src/main/server/local-server';
import { InitialSetupStore } from '../src/main/core/initial-setup-store';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function freePort() {
  const probe = createServer();
  await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('Port unavailable');
  await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return address.port;
}

describe('起動時のローカル待受と機能準備', () => {
  it('期限後に保存が完了したら同じ接続の未完了後続要求を閉じる', async () => {
    const entered = deferred(), writing = deferred();
    const state = new AppState(createDefaultSettings(), {
      saveSettings: async () => { entered.resolve(); await writing.promise; },
    });
    const port = await freePort(); const server = new LocalServer({ state, port }); await server.start();
    const socket = connect(port, '127.0.0.1'); socket.on('error', () => {}); socket.resume(); await once(socket, 'connect');
    const body = JSON.stringify({ ...createDefaultSettings().application, managementTheme: 'pearl' });
    socket.write(`PUT /api/settings/application HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: http://127.0.0.1:${port}\r\nX-CasMate-Token: ${server.operationToken}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}POST /api/management/initial-setup HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{`);
    await entered.promise;
    let stopped = false; const stopping = server.stop().then(() => { stopped = true; });
    try {
      await new Promise(resolve => setTimeout(resolve, 1700));
      expect(stopped).toBe(false);
      writing.resolve();
      await vi.waitFor(() => expect(stopped).toBe(true), { timeout: 1000 });
    } finally { writing.resolve(); socket.destroy(); await stopping; await state.shutdown(); }
  });

  it.each(['settings', 'initial-setup'])('受理済みの%s保存中はTCP期限後も保存完了を待つ', async kind => {
    const entered = deferred(), writing = deferred();
    const write = async () => { entered.resolve(); await writing.promise; };
    const state = new AppState(createDefaultSettings(), {
      saveSettings: write,
      initialSetup: new InitialSetupStore('unused-slow-shutdown-fixture', false, write),
    });
    const port = await freePort(); const server = new LocalServer({ state, port }); await server.start();
    const url = kind === 'settings' ? '/api/settings/application' : '/api/management/initial-setup';
    const body = kind === 'settings' ? { ...createDefaultSettings().application, managementTheme: 'pearl' } : { action: 'open', revision: 0 };
    const response = fetch(`http://127.0.0.1:${port}${url}`, { method: kind === 'settings' ? 'PUT' : 'POST',
      headers: { Origin: `http://127.0.0.1:${port}`, 'X-CasMate-Token': server.operationToken, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(async result => ({ status: result.status, body: await result.json() }), error => error);
    await entered.promise;
    let stopped = false; const stopping = server.stop().then(() => { stopped = true; });
    try {
      await new Promise(resolve => setTimeout(resolve, 1700));
      expect(stopped).toBe(false);
      writing.resolve();
      expect(await response).toMatchObject({ status: 200 });
      await stopping;
    } finally { writing.resolve(); await response; await stopping; await state.shutdown(); }
  });

  it.each(['preconnect', 'headers', 'body'])('未完了の%s接続があっても終了を無期限に待たない', async mode => {
    const state = new AppState(createDefaultSettings());
    const port = await freePort();
    const server = new LocalServer({ state, port });
    await server.start();
    const socket = connect(port, '127.0.0.1');
    socket.on('error', () => {});
    await once(socket, 'connect');
    if (mode === 'headers') socket.write('GET /api/bootstrap HTTP/1.1\r\nHost:');
    if (mode === 'body') socket.write(`PUT /api/settings/application HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: http://127.0.0.1:${port}\r\nX-CasMate-Token: ${server.operationToken}\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{`);
    let finished = false;
    const stopping = server.stop().then(() => { finished = true; });
    try {
      await vi.waitFor(() => expect(finished).toBe(true), { timeout: 2500 });
    } finally {
      socket.destroy();
      await stopping;
      await state.shutdown();
    }
  });

  it('前のサーバーの終了期限で、新しく起動したサーバーの接続を破棄しない', async () => {
    const state = new AppState(createDefaultSettings()); const port = await freePort();
    const server = new LocalServer({ state, port }); await server.start();
    const first = connect(port, '127.0.0.1'); first.on('error', () => {}); await once(first, 'connect');
    const stopping = server.stop();
    await server.start();
    const replacement = connect(port, '127.0.0.1'); replacement.on('error', () => {}); await once(replacement, 'connect');
    try {
      await stopping;
      expect(replacement.destroyed).toBe(false);
      const response = await fetch(`http://127.0.0.1:${port}/api/bootstrap`);
      expect(response.status).toBe(200);
      await response.arrayBuffer();
    } finally { first.destroy(); replacement.destroy(); await server.stop(); await state.shutdown(); }
  });

  it('終了開始後に本文が揃った要求から新しい設定保存を始めない', async () => {
    const save = vi.fn(async () => undefined);
    const state = new AppState(createDefaultSettings(), { saveSettings: save });
    const port = await freePort(); const server = new LocalServer({ state, port }); await server.start();
    const socket = connect(port, '127.0.0.1'); socket.on('error', () => {}); await once(socket, 'connect');
    const body = JSON.stringify({ ...createDefaultSettings().application, managementTheme: 'pearl' });
    let received = ''; socket.setEncoding('utf8'); socket.on('data', data => { received += data; });
    const closed = once(socket, 'close');
    socket.write(`PUT /api/settings/application HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: http://127.0.0.1:${port}\r\nX-CasMate-Token: ${server.operationToken}\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body.slice(0, -1)}`);
    const stopping = server.stop();
    try {
      socket.write(body.slice(-1));
      await closed; await stopping;
      expect(received).toContain('503 Service Unavailable');
      expect(save).not.toHaveBeenCalled();
    } finally { socket.destroy(); await stopping; await state.shutdown(); }
  });

  it('自動接続の準備が遅くても管理bootstrapとサーバーの起動完了を待たせない', async () => {
    const state = new AppState(createDefaultSettings());
    const preparation = deferred();
    const sources = vi.spyOn(state, 'startSourcesOnLaunch').mockReturnValue(preparation.promise);
    const recognition = vi.spyOn(state, 'startSpeechRecognitionOnLaunch').mockResolvedValue();
    const port = await freePort();
    const server = new LocalServer({ state, port, operationToken: 'fixture-token' });
    let ready = false;
    const start = server.start().then(() => { ready = true; });
    try {
      await vi.waitFor(() => expect(sources).toHaveBeenCalledOnce(), { timeout: 300 });
      const response = await fetch(`http://127.0.0.1:${port}/api/bootstrap?view=management`, {
        headers: { 'X-CasMate-Management': 'fixture-token' },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ operationToken: 'fixture-token' });
      expect(ready).toBe(true);
      expect(recognition).toHaveBeenCalledOnce();
    } finally {
      preparation.resolve();
      await start;
      await server.stop();
      await state.shutdown();
    }
  });

  it('初期確認中に終了した場合、後からコメントの自動接続を始めない', async () => {
    const settings = createDefaultSettings();
    settings.sources.autoConnect = true;
    settings.sources.twitch = { enabled: true, channel: 'fixture' };
    const adapterStart = vi.fn().mockResolvedValue(undefined);
    const state = new AppState(settings, {
      sourceFactory: source => ({ source, start: adapterStart, stop: vi.fn() }),
    });
    const preparation = deferred();
    vi.spyOn(state, 'initialize').mockReturnValue(preparation.promise);
    const launch = state.startSourcesOnLaunch();
    await state.shutdown();
    preparation.resolve();
    await launch;
    expect(adapterStart).not.toHaveBeenCalled();
  });

  it('AI終了の待機中に初期確認が完了しても、保留中の手動したらば接続を始めない', async () => {
    const settings = createDefaultSettings();
    const adapterStart = vi.fn().mockResolvedValue(undefined);
    const state = new AppState(settings, {
      sourceFactory: source => ({ source, start: adapterStart, stop: vi.fn() }),
    });
    const preparation = deferred();
    vi.spyOn(state, 'initialize').mockReturnValue(preparation.promise);
    // The controller constructor performs no I/O; only shutdown is exercised.
    const controller = new AiController(settings.aiListener, {
      store: new AiStore('unused-startup-fixture', {
        isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '',
      }),
      gateway: { hasKey: () => false, account: () => null, generate: vi.fn(), post: vi.fn() },
      changed: vi.fn(), acquire: vi.fn(), release: vi.fn(), ngWords: () => [],
    });
    const aiClosing = deferred();
    const aiShutdown = vi.spyOn(controller, 'shutdown').mockReturnValue(aiClosing.promise);
    state.attachAi(controller);
    const manualStart = state.startSource('shitaraba');
    let closed = false;
    const closing = state.shutdown().then(() => { closed = true; });
    try {
      expect(aiShutdown).toHaveBeenCalledOnce();
      preparation.resolve();
      await manualStart;
      expect(closed).toBe(false);
      expect(adapterStart).not.toHaveBeenCalled();
      expect(state.snapshot().sourceStatuses.shitaraba.state).toBe('stopped');
    } finally {
      preparation.resolve();
      aiClosing.resolve();
      await Promise.all([manualStart, closing]);
    }
  });

  it('初期確認中の手動停止を自動接続で取り消さない', async () => {
    const settings = createDefaultSettings();
    settings.sources.autoConnect = true;
    settings.sources.twitch = { enabled: true, channel: 'fixture' };
    const adapterStart = vi.fn().mockResolvedValue(undefined);
    const state = new AppState(settings, {
      sourceFactory: source => ({ source, start: adapterStart, stop: vi.fn() }),
    });
    const preparation = deferred();
    vi.spyOn(state, 'initialize').mockReturnValue(preparation.promise);
    const launch = state.startSourcesOnLaunch();
    await state.stopSource('twitch');
    preparation.resolve();
    await launch;
    expect(adapterStart).not.toHaveBeenCalled();
    await state.shutdown();
  });

  it('初期確認中にしたらば設定を更新しても古い確認結果で新設定を上書きしない', async () => {
    const settings = createDefaultSettings();
    settings.sources.shitaraba.threadUrl = 'https://jbbs.shitaraba.net/bbs/read.cgi/game/1234/100/';
    const preparation = deferred();
    const content = vi.fn().mockImplementation(async () => {
      await preparation.promise;
      return { title: 'fixture 1', body: 'fixture body' };
    });
    const state = new AppState(settings, {
      shitarabaWriteAdapter: {
        fetchThreadContent: content, findThreadsByTitle: vi.fn().mockResolvedValue([]),
        createNextThread: vi.fn(), announceNextThread: vi.fn(),
      },
    });
    const launch = state.startSourcesOnLaunch();
    let updated = false;
    const next = structuredClone(settings.sources);
    next.shitaraba.nextThread.titleMode = 'manual';
    next.shitaraba.nextThread.manualTitle = 'new title';
    next.shitaraba.nextThread.bodyMode = 'manual';
    next.shitaraba.nextThread.manualBody = 'new body';
    const update = state.updateSettings('sources', next).then(() => { updated = true; });
    await Promise.resolve();
    expect(updated).toBe(false);
    preparation.resolve();
    await Promise.all([launch, update]);
    expect(content).toHaveBeenCalledOnce();
    expect(state.snapshot().shitarabaNextThread).toMatchObject({ plannedTitle: 'new title', plannedBody: 'new body' });
    await state.shutdown();
  });
});
