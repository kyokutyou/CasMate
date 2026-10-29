import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import { join } from 'node:path';
import express, { type Express } from 'express';
import { WebSocketServer } from 'ws';
import { MobileReadSession } from './mobile-read-session';
import { areCommentSourcesRunning } from '../../shared/comment-source-status';
import { MOBILE_PROTOCOL_VERSION } from '../../shared/types';
import type {
  CommonComment,
  MobilePublicationKind,
  MobileSpeechSettings,
  MobileSpeechUrlState,
  MobileCommentsRealtimeEvent,
  RealtimeEvent,
  TailscalePublicationStatus,
} from '../../shared/types';
import type { AppState } from '../core/app-state';
import type { MobileAudioReady } from '../speech/mobile-speech-controller';
import {
  WindowsTailscaleClient,
  type TailscaleClient,
  type TailscaleDetection,
} from './tailscale-client';

interface MobileHttpOptions {
  state: AppState;
  port: number;
  address: string;
  staticDirectory?: string;
}

export function createMobileHttpApplication(options: MobileHttpOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use((request, response, next) => {
    if (request.headers.host !== `${options.address}:${options.port}`) {
      response.status(403).json({ code: 'INVALID_HOST', message: '公開URLを確認してください。' });
      return;
    }
    next();
  });

  app.get('/mobile/bootstrap', (_request, response) => {
    response.set('Cache-Control', 'no-store').json({ protocolVersion: MOBILE_PROTOCOL_VERSION, mobilePublished: true, audioAvailable: options.state.snapshot().mobileSpeech.audioAvailable });
  });
  if (options.staticDirectory) {
    app.get('/comments', async (_request, response, next) => {
      try {
        const index = await readFile(join(options.staticDirectory!, 'index.html'), 'utf8');
        response.type('html').send(index.replace(
          '</head>',
          '<meta name="casmate-mobile" content="true"></head>',
        ));
      } catch (error) {
        next(error);
      }
    });
    app.use(express.static(options.staticDirectory, { index: false, fallthrough: true }));
  }
  app.use((_request, response) => response.sendStatus(404));
  return app;
}

export function privateIpv4Addresses(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): string[] {
  const result = new Set<string>();
  for (const values of Object.values(interfaces)) {
    for (const info of values ?? []) {
      if (info.family !== 'IPv4' || info.internal || !isPrivateIpv4(info.address)) continue;
      result.add(info.address);
    }
  }
  return [...result].sort();
}

export interface MobilePublicationServerManagerOptions {
  state: AppState;
  port: number;
  staticDirectory?: string;
  addresses?: () => string[];
  tailscaleClient?: TailscaleClient;
}

interface AddressServer {
  kind: MobilePublicationKind;
  http: Server;
  sockets: WebSocketServer;
  clients: Map<string, MobileReadSession>;
}

export class MobilePublicationServerManager {
  private readonly servers = new Map<string, AddressServer>();
  private readonly failed = new Set<string>();
  private refreshTimer: NodeJS.Timeout | null = null;
  private refreshQueue: Promise<void> = Promise.resolve();
  private refreshAbort = new AbortController();
  private stopped = true;
  private audioAvailability: boolean | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly tailscaleClient: TailscaleClient;

  constructor(private readonly options: MobilePublicationServerManagerOptions) {
    this.tailscaleClient = options.tailscaleClient ?? new WindowsTailscaleClient();
  }

  async start(): Promise<void> {
    const controller = new AbortController();
    this.refreshAbort = controller;
    this.stopped = false;
    this.unsubscribe = this.options.state.subscribe((event) => {
      this.broadcastEvent(event);
      if (event.type === 'settings.changed' &&
        (event.payload as { section?: string }).section === 'mobileSpeech') {
        void this.safeRefresh();
      }
    });
    await this.safeRefresh();
    if (controller.signal.aborted) return;
    this.refreshTimer = setInterval(() => { void this.safeRefresh(); }, 5_000);
  }

  async refresh(): Promise<void> {
    await this.refreshNow(this.refreshAbort.signal);
  }

  private async refreshNow(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    const settings = this.options.state.snapshot().settings.mobileSpeech;
    let lanAddresses: string[] = [];
    let lanWarning: string | null = null;
    if (settings.lanEnabled) {
      try {
        lanAddresses = (this.options.addresses ?? privateIpv4Addresses)();
      } catch {
        lanWarning = 'スマホ向けLAN公開を準備できませんでした。PC機能は継続します。';
      }
    }
    let tailscale: TailscaleDetection = { status: 'ipUnavailable' };
    if (settings.tailscaleEnabled) {
      try {
        tailscale = await this.detectTailscale(signal);
      } catch {
        tailscale = { status: 'ipUnavailable' };
      }
    }
    if (signal.aborted) return;
    const targets = resolveMobilePublicationTargets(settings, lanAddresses, tailscale);
    const desired = new Set(targets.map(({ address }) => address));
    await Promise.allSettled([...this.servers.keys()]
      .filter((address) => !desired.has(address))
      .map((address) => this.stopAddress(address)));
    for (const target of targets) {
      if (signal.aborted) return;
      const { address } = target;
      if (this.servers.has(address)) continue;
      try {
        await this.startAddress(target);
        this.failed.delete(address);
      } catch {
        this.failed.add(address);
      }
    }
    if (signal.aborted) return;
    const urls = await Promise.all(targets.map(async ({ address, kind }): Promise<MobileSpeechUrlState> => {
      const url = `http://${address}:${this.options.port}/comments`;
      const available = this.servers.has(address) && !this.failed.has(address);
      const result: MobileSpeechUrlState = {
        kind,
        url,
        available,
      };
      return result;
    }));
    if (targets.some(({ kind, address }) => kind === 'lan' && this.failed.has(address))) {
      lanWarning = '一部のLANアドレスで待ち受けを開始できませんでした。PC機能は継続します。';
    }
    let tailscaleStatus: TailscalePublicationStatus = settings.tailscaleEnabled
      ? tailscale.status
      : 'disabled';
    if (targets.some(({ kind, address }) => kind === 'tailscale' && this.failed.has(address))) {
      tailscaleStatus = 'listenFailed';
    }
    this.options.state.setMobileUrls(urls);
    this.options.state.setMobileLanWarning(lanWarning);
    this.options.state.setMobileTailscaleStatus(tailscaleStatus);
  }

  sendAudioReady(clientId: string, audio: MobileAudioReady): void {
    for (const server of this.servers.values()) {
      const client = server.clients.get(clientId);
      if (client) { client.audioReady({ ...audio, commentId: opaqueMobileId(audio.commentId) }); return; }
    }
  }

  discardAudio(clientId: string, audioId: string): void {
    for (const server of this.servers.values()) server.clients.get(clientId)?.discard(audioId);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.refreshAbort.abort();
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    await this.refreshQueue;
    await Promise.allSettled([...this.servers.keys()].map((address) => this.stopAddress(address)));
    this.options.state.setMobileUrls([]);
    this.options.state.setMobileLanWarning(null);
    this.options.state.setMobileTailscaleStatus('disabled');
  }

  private safeRefresh(): Promise<void> {
    const signal = this.refreshAbort.signal;
    const operation = this.refreshQueue.then(async () => {
      if (this.stopped || signal.aborted) return;
      try {
        await this.refreshNow(signal);
      } catch {
        if (signal.aborted) return;
        this.options.state.setMobileLanWarning(
          'スマホ向け公開を更新できませんでした。既存のPC機能は継続します。',
        );
      }
    });
    this.refreshQueue = operation;
    return operation;
  }

  private async detectTailscale(signal: AbortSignal): Promise<TailscaleDetection> {
    let cancel!: () => void;
    const cancelled = new Promise<TailscaleDetection>(resolve => {
      cancel = () => resolve({ status: 'ipUnavailable' });
    });
    signal.addEventListener('abort', cancel, { once: true });
    try {
      return await Promise.race([this.tailscaleClient.detect(signal), cancelled]);
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  }

  private async startAddress(target: MobilePublicationTarget): Promise<void> {
    const { address, kind } = target;
    const app = createMobileHttpApplication({ ...this.options, address });
    const http = createServer(app);
    const sockets = new WebSocketServer({ noServer: true, maxPayload: 8192 });
    const clients = new Map<string, MobileReadSession>();
    http.on('upgrade', (request, socket, head) => {
      if (request.url !== '/mobile/ws' || request.headers.host !== `${address}:${this.options.port}`) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
      sockets.handleUpgrade(request, socket, head, (webSocket) => sockets.emit('connection', webSocket));
    });
    sockets.on('connection', (socket) => {
      const clientId = randomBytes(16).toString('base64url');
      clients.set(clientId, new MobileReadSession(clientId, socket, this.options.state,
        () => ({ revision: this.options.state.snapshotEvent().revision, payload: mobileBootstrap(this.options.state) }),
        () => clients.delete(clientId)));

    });
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject);
      http.listen(this.options.port, address, () => {
        http.off('error', reject);
        resolve();
      });
    });
    this.servers.set(address, { kind, http, sockets, clients });
  }

  private broadcastEvent(event: RealtimeEvent): void {
    const projected = projectMobileRealtimeEvent(event, this.options.state);
    if (!projected) return;
    if (projected.type === 'mobile.audioAvailabilityChanged') {
      if (this.audioAvailability === projected.payload.audioAvailable) return;
      this.audioAvailability = projected.payload.audioAvailable;
    }
    for (const server of this.servers.values()) {
      for (const client of server.clients.values()) {
        client.event(projected);
      }
    }
  }

  private async stopAddress(address: string): Promise<void> {
    const server = this.servers.get(address);
    this.servers.delete(address);
    if (!server) return;
    for (const [clientId, client] of server.clients) {
      this.options.state.stopMobileSpeech(clientId);
      client.close();
    }
    server.sockets.close();
    await new Promise<void>((resolve) => {
      server.http.close(() => resolve());
      server.http.closeAllConnections();
    });
  }
}

export interface MobilePublicationTarget {
  kind: MobilePublicationKind;
  address: string;
}

export function resolveMobilePublicationTargets(
  settings: Pick<MobileSpeechSettings, 'lanEnabled' | 'tailscaleEnabled'>,
  lanAddresses: string[],
  tailscale: TailscaleDetection,
): MobilePublicationTarget[] {
  const targets: MobilePublicationTarget[] = [];
  if (settings.lanEnabled) {
    targets.push(...lanAddresses.map((address) => ({ kind: 'lan' as const, address })));
  }
  if (settings.tailscaleEnabled && tailscale.status === 'ready') {
    targets.push({ kind: 'tailscale', address: tailscale.address });
  }
  return targets;
}

export function projectMobileRealtimeEvent(
  event: RealtimeEvent,
  state: AppState,
): MobileCommentsRealtimeEvent | null {
  if (event.type === 'comment.received') {
    return {
      type: 'comment.received',
      revision: event.revision,
      payload: projectMobileComment(event.payload as CommonComment),
    };
  }
  if (event.type === 'comment.removed') {
    return {
      type: 'comment.removed',
      revision: event.revision,
      payload: { id: opaqueMobileId((event.payload as { id: string }).id) },
    };
  }
  if (event.type === 'source.statusChanged') {
    return { type: 'source.activityChanged', payload: { sourcesRunning: sourcesRunning(state) } };
  }
  if (event.type === 'settings.changed' &&
    (event.payload as { section?: string }).section === 'commentList') {
    return {
      type: 'commentList.settingsChanged',
      payload: state.snapshot().settings.commentList,
    };
  }
  if (event.type === 'mobileSpeech.stateChanged' || event.type === 'commentSpeech.stateChanged') {
    const mobile = state.snapshot().mobileSpeech;
    return {
      type: 'mobile.audioAvailabilityChanged',
      payload: { audioAvailable: mobile.audioAvailable },
    };
  }
  return null;
}

export function mobileBootstrap(state: AppState) {
  const snapshot = state.snapshot();
  return {
    protocolVersion: MOBILE_PROTOCOL_VERSION,
    comments: snapshot.comments.map(projectMobileComment),
    sourcesRunning: sourcesRunning(state),
    mobilePublished: true,
    audioAvailable: snapshot.mobileSpeech.audioAvailable && snapshot.settings.commentSpeech.enabled,
    commentList: snapshot.settings.commentList,
  };
}

function sourcesRunning(state: AppState): boolean {
  return areCommentSourcesRunning(state.snapshot().sourceStatuses);
}

function projectMobileComment(comment: CommonComment): CommonComment {
  return {
    ...comment,
    id: opaqueMobileId(comment.id),
    externalId: opaqueMobileId(comment.externalId),
  };
}

export function opaqueMobileId(id: string): string {
  return createHash('sha256').update(id).digest('base64url');
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false;
  return octets[0] === 10 ||
    (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31) ||
    (octets[0] === 192 && octets[1] === 168);
}
