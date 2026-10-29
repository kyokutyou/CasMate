import { smartphoneView } from './fixtures/smartphone-view';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnection, createServer } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { AppState } from '../src/main/core/app-state';
import { createDefaultSettings } from '../src/main/core/settings';
import {
  createMobileHttpApplication,
  MobilePublicationServerManager,
  privateIpv4Addresses,
  projectMobileRealtimeEvent,
  resolveMobilePublicationTargets,
} from '../src/main/server/mobile-lan-server';

describe('スマホ向け読取専用公開境界', () => {
  it.each(['lan', 'tailscale'] as const)('%s公開の終了でHTTP要求前の接続を待たない', async network => {
    const settings = createDefaultSettings();
    const state = new AppState(settings);
    state.setSmartphoneState({ ...smartphoneView, settings: { ...smartphoneView.settings, activeNetwork: network } });
    const port = await freePort();
    const manager = new MobilePublicationServerManager({ state, port, addresses: () => ['127.0.0.1'],
      tailscaleClient: { detect: async () => ({ status: 'ready', address: '127.0.0.1' }) } });
    await manager.start();
    const socket = createConnection(port, '127.0.0.1');
    await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
    let finished = false;
    const stopping = manager.stop().then(() => { finished = true; });
    try { await vi.waitFor(() => expect(finished).toBe(true), { timeout: 1_000, interval: 10 }); }
    finally { socket.destroy(); await stopping; state.dispose(); }
  });

  it('終了は処理中のTailscale検出を待たず、遅い検出後も公開を再開しない', async () => {
    const state = new AppState(createDefaultSettings());
    state.setSmartphoneState({ ...smartphoneView, settings: { ...smartphoneView.settings, activeNetwork: 'tailscale' } });
    let release!: (value: { status: 'ready'; address: string }) => void;
    const detection = new Promise<{ status: 'ready'; address: string }>(resolve => { release = resolve; });
    const detect = vi.fn((_signal?: AbortSignal) => detection);
    const manager = new MobilePublicationServerManager({ state, port: 0, tailscaleClient: { detect } });
    const starting = manager.start();
    await vi.waitFor(() => expect(detect).toHaveBeenCalledOnce());
    let finished = false;
    const stopping = manager.stop().then(() => { finished = true; });
    try {
      await vi.waitFor(() => expect(finished).toBe(true), { timeout: 1_000, interval: 10 });
      expect(detect.mock.calls[0][0]?.aborted).toBe(true);
    }
    finally {
      release({ status: 'ready', address: '127.0.0.1' });
      await starting; await stopping;
      expect(state.snapshot().mobileSpeech.urls).toEqual([]);
      await manager.stop(); state.dispose();
    }
  });

  it('停止した検出が再起動後に返っても現在の公開と更新周期を変えない', async () => {
    vi.useFakeTimers();
    const state = new AppState(createDefaultSettings());
    state.setSmartphoneState({ ...smartphoneView, settings: { ...smartphoneView.settings, activeNetwork: 'tailscale' } });
    let release!: (value: { status: 'ready'; address: string }) => void;
    const detection = new Promise<{ status: 'ready'; address: string }>(resolve => { release = resolve; });
    const detect = vi.fn().mockReturnValueOnce(detection).mockResolvedValue({ status: 'notInstalled' });
    const manager = new MobilePublicationServerManager({ state, port: 0, tailscaleClient: { detect } });
    try {
      const starting = manager.start();
      await vi.advanceTimersByTimeAsync(0);
      await manager.stop();
      await manager.start();
      release({ status: 'ready', address: '127.0.0.1' });
      await starting;
      expect(state.snapshot().mobileSpeech.urls).toEqual([]);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(detect).toHaveBeenCalledTimes(3);
      expect(state.snapshot().mobileSpeech.tailscaleStatus).toBe('notInstalled');
    } finally { await manager.stop(); state.dispose(); vi.useRealTimers(); }
  });

  it('RFC1918のIPv4だけをインターフェースごとの公開対象にする', () => {
    expect(privateIpv4Addresses({
      Ethernet: [
        { address: '192.168.1.20', family: 'IPv4', internal: false, netmask: '', cidr: null, mac: '' },
        { address: '169.254.1.2', family: 'IPv4', internal: false, netmask: '', cidr: null, mac: '' },
      ],
      VPN: [{ address: '10.8.0.2', family: 'IPv4', internal: false, netmask: '', cidr: null, mac: '' }],
      Public: [{ address: '203.0.113.2', family: 'IPv4', internal: false, netmask: '', cidr: null, mac: '' }],
      Loopback: [{ address: '127.0.0.1', family: 'IPv4', internal: true, netmask: '', cidr: null, mac: '' }],
      V6: [{ address: 'fd00::1', family: 'IPv6', internal: false, netmask: '', cidr: null, mac: '', scopeid: 0 }],
    })).toEqual(['10.8.0.2', '192.168.1.20']);
  });

  it('スマホ用の最小状態と音声だけを返し、管理面を常に拒否する', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'casmate-mobile-'));
    await writeFile(join(directory, 'index.html'), '<!doctype html><head></head><div id="root"></div>');
    const settings = createDefaultSettings();
    settings.commentList = {
      showSource: false,
      showAuthor: true,
      showContent: true,
      stackDirection: 'newestTop',
      fontFamily: 'Meiryo UI',
      fontSizePx: 24,
      textColor: '#112233ff',
      backgroundColor: '#445566aa',
    };
    const state = new AppState(settings);
    state.acceptComment({
      externalId: 'game:123:456:1',
      source: 'shitaraba',
      authorName: '名無しさん',
      content: [{ type: 'text', text: '本文' }],
      initialHistory: false,
    });
    const app = createMobileHttpApplication({
      state,
      port: 3000,
      address: '192.168.1.20',
      staticDirectory: directory,
    });
    const host = { Host: '192.168.1.20:3000' };

    const bootstrap = await request(app).get('/mobile/bootstrap').set(host);
    expect(bootstrap.status).toBe(200);
    expect(bootstrap.body).toEqual({ protocolVersion: 2, mobilePublished: true, audioAvailable: false });
    expect((await request(app).get('/mobile/audio/abcdefghijklmnopqrstuvwx.m4a').set(host)).status).toBe(404);
    expect(JSON.stringify(bootstrap.body)).not.toMatch(/operationToken|target|threadUrl|voicevox|application/i);
    expect(JSON.stringify(bootstrap.body)).not.toContain('game:123:456');
    expect((await request(app).get('/api/bootstrap').set(host)).status).toBe(404);
    expect((await request(app).get('/api/management/pc-status').set(host).set('X-CasMate-Management', 'secret')).status).toBe(404);
    expect((await request(app).get('/api/management/fonts').set(host).set('X-CasMate-Management', 'secret')).status).toBe(404);
    expect((await request(app).get('/overlay/comments').set(host)).status).toBe(404);

    const page = await request(app).get('/comments').set(host);
    expect(page.text).toContain('casmate-mobile');
    expect(page.text).not.toContain('casmate-management');
    state.dispose();
  });

  it('実際の待受Host以外を拒否する', async () => {
    const state = new AppState(createDefaultSettings());
    const app = createMobileHttpApplication({ state, port: 3000, address: '10.0.0.8' });
    expect((await request(app).get('/mobile/bootstrap').set('Host', '10.0.0.9:3000')).status).toBe(403);
    state.dispose();
  });

  it.each([
    [true, false, [{ kind: 'lan', address: '192.168.1.20' }]],
    [false, true, [{ kind: 'tailscale', address: '100.100.20.30' }]],
    [true, true, [
      { kind: 'lan', address: '192.168.1.20' },
      { kind: 'tailscale', address: '100.100.20.30' },
    ]],
    [false, false, []],
  ] as const)('LAN=%s、Tailscale=%sで対象経路だけを公開する', (
    lanEnabled,
    tailscaleEnabled,
    expected,
  ) => {
    expect(resolveMobilePublicationTargets(
      { lanEnabled, tailscaleEnabled },
      ['192.168.1.20'],
      { status: 'ready', address: '100.100.20.30' },
    )).toEqual(expected);
  });

  it('Tailscale未導入をLAN公開から分離した状態として通知する', async () => {
    const settings = createDefaultSettings();
    settings.mobileSpeech.tailscaleEnabled = true;
    const state = new AppState(settings);
    state.setSmartphoneState({ ...smartphoneView, settings: { ...smartphoneView.settings, activeNetwork: settings.mobileSpeech.tailscaleEnabled ? 'tailscale' : 'lan' } });
    const server = new MobilePublicationServerManager({
      state,
      port: 3000,
      addresses: () => [],
      tailscaleClient: { detect: async () => ({ status: 'notInstalled' }) },
    });

    await server.start();

    expect(state.snapshot().mobileSpeech).toMatchObject({
      urls: [],
      tailscaleStatus: 'notInstalled',
    });
    await server.stop();
    state.dispose();
  });

  it('設定変更が重なってもTailscale検出と公開更新を直列化する', async () => {
    const settings = createDefaultSettings();
    settings.mobileSpeech.tailscaleEnabled = true;
    const state = new AppState(settings);
    state.setSmartphoneState({ ...smartphoneView, settings: { ...smartphoneView.settings, activeNetwork: 'tailscale' } });
    let activeDetections = 0;
    let maximumActiveDetections = 0;
    let releaseFirst!: () => void;
    const firstDetection = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const detect = vi.fn(async () => {
      activeDetections += 1;
      maximumActiveDetections = Math.max(maximumActiveDetections, activeDetections);
      if (detect.mock.calls.length === 1) await firstDetection;
      activeDetections -= 1;
      return { status: 'notInstalled' as const };
    });
    const server = new MobilePublicationServerManager({
      state,
      port: 3000,
      addresses: () => [],
      tailscaleClient: { detect },
    });

    const starting = server.start();
    await vi.waitFor(() => expect(detect).toHaveBeenCalledOnce());
    const updating = state.updateSettings('mobileSpeech', settings.mobileSpeech);
    await updating;
    releaseFirst();
    await starting;
    await vi.waitFor(() => expect(detect).toHaveBeenCalledTimes(2));

    expect(maximumActiveDetections).toBe(1);
    await server.stop();
    state.dispose();
  });

  it('ネットワーク検出失敗をスマホ向けLAN公開だけの警告に分離する', async () => {
    const settings = createDefaultSettings();
    settings.mobileSpeech.lanEnabled = true;
    const state = new AppState(settings);
    state.setSmartphoneState({ ...smartphoneView, settings: { ...smartphoneView.settings, activeNetwork: settings.mobileSpeech.tailscaleEnabled ? 'tailscale' : 'lan' } });
    const server = new MobilePublicationServerManager({
      state,
      port: 3000,
      addresses: () => { throw new Error('秘密を含み得るネットワーク検出エラー'); },
    });

    await expect(server.start()).resolves.toBeUndefined();
    expect(state.snapshot().mobileSpeech).toMatchObject({
      urls: [],
      warning: 'スマホ向けLAN公開を準備できませんでした。PC機能は継続します。',
    });

    await server.stop();
    state.dispose();
  });

  it('LANの状態イベントを補正済みの音声利用可否だけへ射影する', () => {
    const state = new AppState(createDefaultSettings());
    const projected = projectMobileRealtimeEvent({
      type: 'mobileSpeech.stateChanged',
      revision: 1,
      payload: {
        urls: [{ kind: 'lan', url: 'http://192.168.1.20:3000/comments', qrDataUrl: 'data:secret', available: true }],
        activeClient: true,
        currentCommentId: 'secret-comment-id',
        queueLength: 4,
        droppedCount: 2,
        audioAvailable: true,
        warning: 'secret-warning',
      },
    }, state);

    expect(projected).toEqual({
      type: 'mobile.audioAvailabilityChanged',
      payload: { audioAvailable: false },
    });

    expect(projectMobileRealtimeEvent({
      type: 'commentSpeech.stateChanged',
      revision: 2,
      payload: { engineStatus: 'ready' },
    }, state)).toEqual({
      type: 'mobile.audioAvailabilityChanged',
      payload: { audioAvailable: false },
    });
    state.dispose();
  });

  it('コメント一覧設定の変更を表示専用設定だけへ射影する', () => {
    const settings = createDefaultSettings();
    settings.commentList = {
      showSource: true,
      showAuthor: false,
      showContent: true,
      stackDirection: 'newestTop',
      fontFamily: 'Yu Gothic UI',
      fontSizePx: 22,
      textColor: '#ffeeddff',
      backgroundColor: '#112233ff',
    };
    const state = new AppState(settings);

    expect(projectMobileRealtimeEvent({
      type: 'settings.changed',
      revision: 3,
      payload: {
        section: 'commentList',
        value: settings.commentList,
        settingsRevision: 2,
      },
    }, state)).toEqual({
      type: 'commentList.settingsChanged',
      payload: settings.commentList,
    });

    expect(JSON.stringify(projectMobileRealtimeEvent({
      type: 'settings.changed',
      revision: 4,
      payload: {
        section: 'sources',
        value: settings.sources,
        settingsRevision: 3,
      },
    }, state))).not.toContain('threadUrl');
    state.dispose();
  });

  it('LANコメントIDを接続先を含まない不透明IDへ射影する', () => {
    const state = new AppState(createDefaultSettings());
    const projected = projectMobileRealtimeEvent({
      type: 'comment.received',
      revision: 5,
      payload: {
        id: 'shitaraba:game:123:456:1',
        externalId: 'game:123:456:1',
        source: 'shitaraba',
        authorName: '名無しさん',
        content: [{ type: 'text', text: '本文' }],
        initialHistory: false,
        receivedAt: '2026-08-25T00:00:00.000Z',
      },
    }, state);

    expect(JSON.stringify(projected)).not.toContain('shitaraba:game:123:456:1');
    expect(projected?.payload).toMatchObject({ source: 'shitaraba' });
    state.dispose();
  });
});

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('LISTENER_ADDRESS');
  await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return address.port;
}
