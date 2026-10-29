import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { compatibilityPolicy } from '../../shared/compatibility-policy.generated';
import { createServer, type Server } from 'node:http';
import express, { type Express } from 'express';
import type { AppState } from '../core/app-state';
import type { ObsControlController } from '../obs/obs-control-controller';
import type { MobilePublicationServerManager } from '../server/mobile-lan-server';
import { attachSmartphoneControlServer, controlVersionHeader } from './smartphone-control-session';
import { isAllowedObsEndpointAddress, type ObsControlRegistration } from '../../shared/obs-control';
import { isOutdoorPort, outdoorErrors, type OutdoorRegistration, type OutdoorReport } from '../../shared/outdoor';
import { defaultSmartphoneSettings, smartphoneNetworks, allSmartphoneNetworks, type PrivateSmartphoneNetwork, type SmartphoneConfiguration, type SmartphoneNetwork,
  type SmartphoneInvitation, type SmartphoneRegistration, type SmartphoneView, type SmartphonePreparation, type UpdatedSmartphoneRegistration,
  type CurrentSmartphoneRegistration, type SmartphoneControlVersion } from '../../shared/smartphone';
import { addSmartphoneDevice, allocateVideo, allocateSmartphonePort, createSmartphoneRecord, rotateSmartphoneInvitations, validateDeviceName, SmartphoneStorageError, type SmartphoneDevice, type SmartphoneRecord, type SmartphoneStore } from './smartphone-store';
import { enrollDevice, EnrollmentError, parseEnrollment } from './smartphone-enrollment';
import type { OutdoorReceivers, ReceiverConfig } from '../outdoor/outdoor-receivers';
import { defaultDirectSettings, validateDirectSettings, type DirectCredential } from '../../shared/direct-connection';
import { newDirectCredential, rotateDirectInvitation } from './direct-ledger';
import { DirectRuntime } from './direct-runtime';
import type { DirectIdentity } from './direct-identity';
import type { DirectListener } from './direct-server';
import type { DirectGateway } from './direct-gateway';
import type { DirectWindows } from './direct-windows';
import type { MobileAudioReady } from '../speech/mobile-speech-controller';

interface Listener { close(): Promise<void>; }
interface ReportState { report: OutdoorReport; receivedAt: number; disconnected: boolean; retired: Set<string>; }
interface SmartphoneOptions {
  store: Pick<SmartphoneStore, 'load' | 'save'>;
  state: Pick<AppState, 'snapshot' | 'setSmartphoneState' | 'subscribe' | 'remoteSpeechRecognitionState' | 'setSpeechRecognitionEnabled' | 'selectSpeechRecognitionInput' | 'retrySpeechRecognition'>;
  mobile: Pick<MobilePublicationServerManager, 'start' | 'stop'>;
  obs: ObsControlController;
  managementPorts: () => number[];
  receivers: Pick<OutdoorReceivers, 'sync' | 'stop' | 'view' | 'feedback'> & Partial<Pick<OutdoorReceivers, 'setGuard' | 'activate'>>;
  listen?: (app: Express, address: string, port: number, onError: () => void, setup?: (server: Server) => () => void) => Promise<Listener>;
  now?: () => number;
  lanNetwork?: Pick<DirectWindows, 'list' | 'stop'>;
  direct?: { receivers: SmartphoneOptions['receivers']; program: string; workerProgram: string; windows?: DirectWindows; gateway?: DirectGateway;
    listen: (identity: DirectIdentity, address: string, port: number, hosts: () => string[], failed: () => void) => Promise<DirectListener> };
}

export class SmartphoneController {
  private record: SmartphoneRecord | null = null;
  private warning: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private stopped = true;
  private generation = 0;
  private timer?: NodeJS.Timeout;
  private unsubscribe?: () => void;
  private readonly reports = new Map<string, ReportState>();
  private readonly reportConnections = new Map<string, Set<string>>();
  private videoListener?: { key: string; listener: Listener };
  private networks: SmartphoneView['networks'] = { lan: emptyNetwork(), tailscale: emptyNetwork() };
  private obsSignature = '';
  private readonly direct?: DirectRuntime;
  private readonly enrollments = new Map<string, Promise<SmartphoneRegistration>>();
  private readonly preparationErrors = new Set<string>();

  constructor(private readonly options: SmartphoneOptions) {
    options.receivers.setGuard?.(config => this.acceptsReceiver(config));
    options.direct?.receivers.setGuard?.(config => this.acceptsReceiver(config));
    options.obs.useDeviceRegistrations(id => {
      const direct = Object.values(this.record?.direct?.devices ?? {}).find(d => d.registered && d.obs.registrationId === id);
      return direct ? { ...direct.obs, endpoints: [] } : this.record?.devices.find(device => device.obs.registrationId === id)?.obs ?? null;
    });
    if (options.direct) this.direct = new DirectRuntime({ ...options.direct, read: () => this.record, changed: () => this.publish(), now: options.now,
      update: change => this.serial(async () => { if (!this.record) throw new Error('保存を利用できません。'); const next = structuredClone(this.record); change(next);
        await options.store.save(next); this.record = next; this.refreshOwnership(); this.publish(); }) });
  }

  async start(): Promise<void> {
    const generation = ++this.generation;
    const current = () => !this.stopped && this.generation === generation;
    this.stopped = false;
    this.record = null;
    let record: SmartphoneRecord | null = null;
    try {
      record = await this.options.store.load();
      if (!current()) return;
      if (!record) {
        const fresh = createSmartphoneRecord();
        await this.options.store.save(fresh);
        if (!current()) return;
        record = fresh;
      }
      if (!record.invitations) {
        const next = structuredClone(record);
        rotateSmartphoneInvitations(next);
        await this.options.store.save(next);
        if (!current()) return;
        record = next;
      }
    } catch (error) {
      if (!current()) return;
      this.warning = error instanceof SmartphoneStorageError ? error.message : record
        ? 'スマホの共通QR用情報を保存できません。台帳と選択中のネットワークを保持しています。保存領域を確認してPCアプリを起動し直してください。'
        : 'スマホ台帳を読み込めず、登録の編集を停止しています。元の保存は保持しています。保存領域とWindowsのユーザーを確認してください。コメント機能は継続します。';
    }
    // Keep startup normalization private so early management edits cannot race
    // its protected save. A failed normalization retains the loaded ledger.
    this.record = record;
    this.refreshOwnership();
    this.publish();
    if (!current()) return;
    await this.options.mobile.start();
    if (!current()) return;
    await this.refresh();
    if (!current()) return;
    this.obsSignature = this.currentObsSignature();
    this.unsubscribe = this.options.state.subscribe(event => {
      if (event.type !== 'obsControl.stateChanged' || this.obsSignature === this.currentObsSignature()) return;
      this.obsSignature = this.currentObsSignature();
      void this.refresh();
    });
    this.timer = setInterval(() => { void this.refresh(); }, 2000);
    this.timer.unref?.();
  }

  get updateNotice(): string | null { return this.record?.migrationNotice ?? null; }

  snapshot(): SmartphoneView {
    const settings = structuredClone(this.record?.settings ?? this.fallbackSettings());
    if ('videoEnabled' in settings) delete settings.videoEnabled;
    const tcp = this.direct?.tcpEndpoints() ?? []; const directView = this.direct?.view();
    const obs = this.options.obs.view();
    return { available: this.record !== null, settings: structuredClone(settings), networks: { ...structuredClone(this.networks), direct: {
      address: tcp[0]?.address ?? null, commentsUrl: null, registrationReady: tcp.length > 0,
      invitationRevision: this.record?.direct?.invitation.revision ?? 0, videoReady: Boolean(this.record?.devices.some(d => this.direct?.srtEndpoints(d.id).length)),
      obsReady: Boolean(tcp.length && obs.enabled && obs.androidEnabled), warning: directView?.failure ? '直接接続の一部を準備できません。公開・受信の状態を確認してください。' : null,
    } }, ...(directView ? { direct: directView } : {}),
      warning: this.warning,
      devices: (this.record?.devices ?? []).map(device => ({ id: device.id, name: device.name, obsLocalPort: device.obsLocalPort, obsRevision: device.obs.revision,
        profiles: { lan: this.profileView(device, 'lan'), tailscale: this.profileView(device, 'tailscale'), ...(this.record?.direct?.devices[device.id] ? { direct: this.directProfileView(device.id) } : {}) },
      })) };
  }

  configure(patch: SmartphoneConfiguration): Promise<void> {
    return this.serial(async () => {
      const next = this.editable();
      if (patch && typeof patch === 'object' && 'videoEnabled' in patch) throw new Error('映像の独立設定は廃止されました。画面を更新してください。設定は変更していません。');
      if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(k => !['activeNetwork', 'network', 'statusPort', 'direct', 'lanInterfaceId'].includes(k))) throw new Error('設定の形式が正しくありません。');
      if (patch.activeNetwork !== undefined) {
        if (![null, ...allSmartphoneNetworks].includes(patch.activeNetwork)) throw new Error('ネットワークが正しくありません。');
        next.settings.activeNetwork = patch.activeNetwork;
      }
      if ('lanInterfaceId' in patch) {
        if (patch.lanInterfaceId !== null && (typeof patch.lanInterfaceId !== 'string' || !/^[a-zA-Z0-9{}-]{1,80}$/u.test(patch.lanInterfaceId))) throw new Error('ネットワークのLAN接続先が正しくありません。');
        if (patch.lanInterfaceId && !(await this.lanAdapters()).some(a => a.id.toLowerCase() === patch.lanInterfaceId!.toLowerCase())) throw new Error('ネットワークのLAN接続先を利用できません。一覧を更新してください。');
        next.settings.lanInterfaceId = patch.lanInterfaceId;
      }
      if (patch.statusPort !== undefined) {
        if (!patch.network || !allSmartphoneNetworks.includes(patch.network)) throw new Error('ネットワークを選択してください。');
        if (patch.statusPort !== undefined) {
          if (!isOutdoorPort(patch.statusPort) || this.options.managementPorts().includes(patch.statusPort) || patch.statusPort === 4455) {
            throw new Error('登録・制御ポートは1024～65535で、コメントのHTTPポートと別にしてください。');
          }
          next.settings.statusPorts[patch.network] = patch.statusPort;
        }
      }
      if (patch.direct !== undefined) {
        if (patch.network !== 'direct') throw new Error('直接接続の設定は直接接続を選択して変更してください。');
        if (!patch.direct || typeof patch.direct !== 'object' || Array.isArray(patch.direct)) throw new Error('直接接続の設定形式が正しくありません。');
        next.settings.direct = validateDirectSettings({ ...next.settings.direct ?? defaultDirectSettings(), ...patch.direct });
        if (next.settings.direct.manualSrtEndpoints.some(e => !next.devices.some(d => d.id === e.deviceId))) throw new Error('スマホの手動設定の対象を確認してください。');
      }
      const directScope = (record: SmartphoneRecord) => JSON.stringify([record.settings.activeNetwork, record.settings.statusPorts.direct,
        record.settings.direct?.interfaceId, record.settings.direct?.mode, record.settings.direct?.manualEndpoints]);
      if (directScope(next) !== directScope(this.record!)) rotateDirectInvitation(next.direct!);
      if (JSON.stringify(next.settings.direct) !== JSON.stringify(this.record!.settings.direct) || next.settings.statusPorts.direct !== this.record!.settings.statusPorts.direct) next.direct!.revision += 1;
      const switched = next.settings.activeNetwork !== this.record!.settings.activeNetwork;
      const leavingDirect = this.record!.settings.activeNetwork === 'direct' && next.settings.activeNetwork !== 'direct';
      await this.options.store.save(next);
      this.record = next;
      this.refreshOwnership();
      // Its closing-state saves re-enter this queue; start closure now without awaiting them here.
      if (leavingDirect) void this.direct?.refresh().catch(() => undefined);
      if (switched) { await this.closeListeners(); await this.options.mobile.stop(); }
      this.publish();
      if (switched) await this.options.mobile.start();
      await this.refreshNow();
    }).then(() => { void this.direct?.refresh(); });
  }

  add(name: string): Promise<void> { return this.changeDevices(record => { addSmartphoneDevice(record, name); }); }
  rename(id: string, name: string): Promise<void> { return this.changeDevices(record => { this.device(record, id).name = validateDeviceName(name); }); }
  remove(id: string): Promise<void> {
    return this.changeDevices(record => { this.device(record, id); record.devices = record.devices.filter(d => d.id !== id); delete record.direct?.devices[id];
      record.settings.direct!.manualSrtEndpoints = record.settings.direct!.manualSrtEndpoints.filter(e => e.deviceId !== id); rotateSmartphoneInvitations(record); }, id);
  }
  regenerate(id: string): Promise<void> {
    return this.changeDevices(record => {
      const device = this.device(record, id);
      for (const network of smartphoneNetworks) {
        const video = device.video[network];
        if (video) { video.token = randomBytes(32).toString('hex'); video.passphrase = randomBytes(16).toString('hex'); video.revision += 1; }
      }
      for (const update of Object.values(device.updates ?? {})) if (update) {
        update.credential.token = randomBytes(32).toString('hex'); update.credential.revision += 1; update.projectionHash = ''; update.legacyProjectionHash = '';
        update.speechRecognition.token = randomBytes(32).toString('hex'); update.speechRecognition.revision += 1;
      }
      device.obs.token = randomBytes(32).toString('hex'); device.obs.revision += 1;
      const allocation = record.direct?.devices[id];
      if (allocation) { allocation.comments.token = randomBytes(32).toString('hex'); allocation.comments.revision += 1;
        allocation.obs.token = randomBytes(32).toString('hex'); allocation.obs.revision += 1;
        if (allocation.outdoor) { allocation.outdoor.token = randomBytes(32).toString('hex'); allocation.outdoor.passphrase = randomBytes(16).toString('hex'); allocation.outdoor.revision += 1; } }
      rotateSmartphoneInvitations(record);
    }, id);
  }

  invitation(network: SmartphoneNetwork): SmartphoneInvitation {
    if (network === 'direct') {
      const record = this.editable(); const endpoints = this.direct?.tcpEndpoints() ?? [];
      if (record.settings.activeNetwork !== 'direct' || !endpoints.length || !record.direct?.identity) throw new Error('このネットワークのHTTPS待受と公開設定を準備してください。');
      return { type: 'casmate.outdoor', version: compatibilityPolicy.contracts.directInvitation.current, pcId: record.pcId, network, pcKey: record.direct.identity.pcKey, endpoints, token: record.direct.invitation.token };
    }
    const record = this.editable(); const view = this.networks[network];
    if (record.settings.activeNetwork !== network || !view?.commentsUrl || !view.registrationReady || !record.invitations) {
      throw new Error('このネットワークをONにして、コメントと登録の接続先を準備してください。');
    }
    return { type: 'casmate.outdoor', version: compatibilityPolicy.contracts.privateInvitation.current, pcId: record.pcId, network, comments: { url: view.commentsUrl },
      registrationPort: record.settings.statusPorts[network], token: record.invitations[network].token };
  }

  enroll(network: SmartphoneNetwork, authorization: string | undefined, value: unknown, protocolVersion: SmartphoneControlVersion = 3): Promise<SmartphoneRegistration> {
    if (network === 'direct') return this.enrollDirect(authorization, value, protocolVersion);
    let request: ReturnType<typeof parseEnrollment>;
    try { request = parseEnrollment(value); } catch (error) { return Promise.reject(error); }
    return this.serial(async () => {
      const record = this.editable();
      if (record.settings.activeNetwork !== network || !record.invitations || !matchesToken(record.invitations[network].token, authorization)) {
        throw new EnrollmentError(403, 'INVITATION_EXPIRED', 'このQRは無効です。PCで共通QRを開き直して読み取ってください。');
      }
      let invitation: SmartphoneInvitation;
      try { invitation = this.invitation(network); }
      catch { throw new EnrollmentError(503, 'REGISTRATION_UNAVAILABLE', 'PCのスマホ連携で、有効な機能の接続状態を確認してください。'); }
      if (invitation.version !== compatibilityPolicy.contracts.privateInvitation.current) throw new Error('PRIVATE_INVITATION');
      const device = enrollDevice(record, request);
      const address = new URL(invitation.comments.url).hostname;
      this.updateDeviceAddress(device, network, address, invitation.registrationPort, invitation.registrationPort);
      this.ensureUpdate(device, network);
      await this.options.store.save(record);
      this.record = record;
      this.publish();
      return this.updatedRegistrationNow(device.id, network, protocolVersion);
    }).then(result => { void this.refresh(); return result; });
  }

  obsInput(id: string): string {
    const record = this.editable();
    const port = this.device(record, id).obsLocalPort;
    if (!port) throw new Error('映像の共通入力を準備中です。PCの状態を確認してください。');
    return `udp://127.0.0.1:${port}?localaddr=127.0.0.1&fifo_size=1024&overrun_nonfatal=1`;
  }

  feedback(id: string, network: SmartphoneNetwork, value: unknown) {
    if (!value || typeof value !== 'object') throw new Error('FEEDBACK_REQUEST');
    const request = value as { sessionId: string; generation: number };
    if (Object.keys(request).sort().join(',') !== 'generation,sessionId' ||
        typeof request.sessionId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(request.sessionId) ||
        !Number.isSafeInteger(request.generation) || request.generation < 1 || request.generation > 999999999) throw new Error('FEEDBACK_REQUEST');
    return { version: 1, sample: network === 'direct' ? this.direct?.feedback(id, request.sessionId, request.generation) ?? null : this.options.receivers.feedback(`${id}:${network}`, request.sessionId, request.generation) };
  }

  authenticateObs(authorization: string | undefined): ObsControlRegistration | null {
    const network = this.record?.settings.activeNetwork;
    const obs = this.options.obs.view();
    if (!network || !this.snapshot().networks[network]?.obsReady || !obs.enabled || !obs.androidEnabled || this.stopped) return null;
    if (network === 'direct') { const device = Object.values(this.record?.direct?.devices ?? {}).find(d => d.registered && matchesToken(d.obs.token, authorization)); return device ? { ...device.obs, endpoints: [] } : null; }
    const device = this.record?.devices.find(d => matchesToken(d.obs.token, authorization));
    return device ? structuredClone(device.obs) : null;
  }

  authenticateVideo(network: SmartphoneNetwork, authorization: string | undefined): string | null {
    if (network === 'direct') { if (this.stopped || this.record?.settings.activeNetwork !== 'direct') return null;
      return Object.entries(this.record.direct!.devices).find(([id, d]) => d.registered && d.outdoor && matchesToken(d.outdoor.token, authorization) && this.direct?.srtEndpoints(id).length)?.[0] ?? null; }
    if (this.stopped || this.record?.settings.activeNetwork !== network || !this.networks[network].videoReady) return null;
    return this.record.devices.find(d => d.video[network] && matchesToken(d.video[network]!.token, authorization) && this.preparation(d.id, network).video === 'ready')?.id ?? null;
  }

  authenticateControl(network: SmartphoneNetwork, obsToken?: string, videoToken?: string, registrationToken?: string,
    speechToken?: string, protocolVersion: SmartphoneControlVersion = 2) {
    if (protocolVersion !== 2 && protocolVersion !== 3 || protocolVersion === 2 && speechToken !== undefined) return null;
    if (this.stopped || network !== this.record?.settings.activeNetwork ||
      !(network === 'direct' ? this.direct?.tcpEndpoints().length : this.networks[network].registrationReady)) return null;
    if (registrationToken === undefined) return null;
    const device = this.record.devices.find(d => {
      const direct = this.record!.direct?.devices[d.id];
      if (network === 'direct' && !direct?.registered) return false;
      const update = d.updates?.[network]?.credential;
      const obs = network === 'direct' ? direct!.obs : d.obs;
      const video = network === 'direct' ? direct!.outdoor : d.video[network];
      return Boolean(update && matchesToken(update.token, registrationToken)) &&
        (obsToken === undefined || matchesToken(obs.token, obsToken)) &&
        (videoToken === undefined || Boolean(video && matchesToken(video.token, videoToken))) &&
        (speechToken === undefined || Boolean(d.updates?.[network]?.speechRecognition && matchesToken(d.updates[network]!.speechRecognition.token, speechToken)));
    });
    if (!device) return null;
    const obs = network === 'direct' ? { ...this.record.direct!.devices[device.id]!.obs, endpoints: [] } : structuredClone(device.obs);
    return { deviceId: device.id, protocolVersion,
      obs: obsToken === undefined ? null : obs, video: videoToken !== undefined,
      speechRecognition: speechToken === undefined ? null : structuredClone(device.updates![network]!.speechRecognition),
      update: structuredClone(device.updates![network]!.credential) };
  }

  registrationUpdateCurrent(id: string, network: SmartphoneNetwork, credential: DirectCredential): boolean {
    const current = this.record?.devices.find(d => d.id === id)?.updates?.[network]?.credential;
    return Boolean(current && current.registrationId === credential.registrationId && current.revision === credential.revision &&
      matchesToken(current.token, `Bearer ${credential.token}`));
  }

  registrationTokenCurrent(network: SmartphoneNetwork, token: string): boolean {
    return Boolean(this.record?.devices.some(device => {
      const credential = device.updates?.[network]?.credential;
      return credential && matchesToken(credential.token, token);
    }));
  }

  updatedRegistration(id: string, network: SmartphoneNetwork, credential: DirectCredential, protocolVersion: SmartphoneControlVersion = 3): Promise<UpdatedSmartphoneRegistration> {
    return this.serial(async () => {
      if (!this.registrationUpdateCurrent(id, network, credential)) throw new EnrollmentError(403, 'REGISTRATION_REVOKED', '登録を更新してください。');
      return this.updatedRegistrationNow(id, network, protocolVersion);
    });
  }

  touchReport(id: string, network: SmartphoneNetwork, connectionId: string): void {
    const key = `${id}:${network}`;
    if (!this.reportConnections.has(key)) this.reportConnections.set(key, new Set());
    this.reportConnections.get(key)!.add(connectionId);
    const report = this.reports.get(key);
    if (report) { report.receivedAt = this.now(); report.disconnected = false; }
  }

  releaseReport(id: string, network: SmartphoneNetwork, connectionId: string): void {
    const key = `${id}:${network}`;
    const connections = this.reportConnections.get(key);
    if (!connections?.delete(connectionId)) return;
    if (connections?.size) return;
    this.reportConnections.delete(key);
    const report = this.reports.get(key);
    if (report) { report.disconnected = true; this.publish(); }
  }

  acceptReport(id: string, network: SmartphoneNetwork, value: unknown): boolean {
    const device = this.record?.devices.find(d => d.id === id);
    if (!device || this.record?.settings.activeNetwork !== network || !value || typeof value !== 'object') return false;
    const report = value as OutdoorReport; const registration = network === 'direct' ? this.record.direct?.devices[id]?.outdoor : device.video[network];
    if (!registration) return false;
    if (Object.keys(report).sort().join(',') !== 'errorCode,microphone,registrationId,revision,sequence,sessionId,status,version' ||
      report.version !== 1 || report.registrationId !== registration.registrationId || report.revision !== registration.revision ||
      typeof report.sessionId !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/u.test(report.sessionId) || !Number.isSafeInteger(report.sequence) || report.sequence < 0 ||
      !['stopped', 'preparing', 'connecting', 'sending', 'reconnecting', 'actionRequired'].includes(report.status) ||
      !['enabled', 'muted'].includes(report.microphone) || !outdoorErrors.includes(report.errorCode)) return false;
    const key = `${id}:${network}`; const previous = this.reports.get(key);
    if (previous?.retired.has(report.sessionId) || (previous?.report.sessionId === report.sessionId && report.sequence <= previous.report.sequence)) return true;
    const retired = previous?.retired ?? new Set<string>();
    if (previous && previous.report.sessionId !== report.sessionId) retired.add(previous.report.sessionId);
    this.reports.set(key, { report: structuredClone(report), receivedAt: this.now(), disconnected: false, retired });
    this.publish(); return true;
  }

  refresh(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    const generation = this.generation;
    void this.direct?.refresh();
    return this.serial(async () => {
      if (this.stopped || this.generation !== generation) return;
      try { await this.refreshNow(); }
      catch {
        if (this.stopped || this.generation !== generation) return;
        this.warning = 'スマホの接続状態を更新できません。ネットワークと保存領域を確認してください。'; this.publish();
      }
    });
  }

  private async refreshNow(): Promise<void> {
    if (this.stopped) return;
    const generation = this.generation;
    const current = () => !this.stopped && this.generation === generation;
    const network = this.record?.settings.activeNetwork;
    if (!network) { await this.closeListeners(); this.publish(); return; }
    if (network === 'direct') {
      await this.closeListeners(false);
      if (!current()) return;
      await this.prepareDeviceAllocations(network);
      if (current()) this.publish();
      return;
    }
    // Targets are verified by the publication manager even when its comment listener fails.
    const targets = this.options.state.snapshot().mobileSpeech.urls.filter(u => u.kind === network);
    let eligible = targets;
    if (network === 'lan' && this.options.lanNetwork) {
      try {
        const adapters = await this.lanAdapters();
        if (!current()) return;
        let id = this.record!.settings.lanInterfaceId;
        if (!id && adapters.length === 1) {
          const next = this.editable(); next.settings.lanInterfaceId = adapters[0]!.id;
          await this.options.store.save(next);
          if (!current()) return;
          this.record = next; id = next.settings.lanInterfaceId;
        }
        const adapter = adapters.find(a => a.id.toLowerCase() === id?.toLowerCase());
        if (!adapter) throw new Error(id ? '選択したLANアダプターを利用できません。接続状態を確認するか、選択し直してください。' : 'スマホとつながるLANアダプターを選択してください。');
        eligible = targets.filter(t => adapter.addresses.some(a => a.address === new URL(t.url).hostname));
      } catch (error) {
        if (!current()) return;
        await this.closeListeners();
        this.networks.lan.warning = error instanceof Error ? error.message : 'LANアダプターを確認できません。';
        this.publish(); return;
      }
    }
    const urls = eligible.map(u => u.url).sort();
    const old = this.networks[network];
    const url = urls.find(u => new URL(u).hostname === old.address) ?? urls[0];
    const address = url ? new URL(url).hostname : null;
    if (!address) {
      await this.closeListeners();
      this.networks[network].warning = '選択したネットワークの接続先を利用できません。ネットワーク接続とコメント公開の状態を確認してください。';
      this.publish(); return;
    }
    const obs = this.options.obs.view();
    const videoPort = this.record!.settings.statusPorts[network];
    const obsEnabled = obs.enabled && obs.androidEnabled;
    const videoKey = `${network}:${address}:${videoPort}`;
    if (this.videoListener && this.videoListener.key !== videoKey) { await this.videoListener.listener.close(); this.videoListener = undefined; }
    if (!current()) return;
    const next = this.editable();
    for (const device of next.devices) {
      this.updateDeviceAddress(device, network, address, videoPort, videoPort);
    }
    try {
      if (JSON.stringify(next) !== JSON.stringify(this.record)) {
        await this.options.store.save(next);
        if (!current()) return;
        this.record = next;
      }
    } catch {
      if (!current()) return;
      await this.closeListeners(); this.networks[network].warning = '接続先の変更を保存できません。登録用の待受を停止しました。'; this.publish(); return;
    }
    this.networks = { lan: emptyNetwork(), tailscale: emptyNetwork() };
    const commentsUrl = targets.find(target => target.url === url && target.available)?.url ?? null;
    const warnings: string[] = commentsUrl ? [] : ['コメントの待受を開始できません。コメント用ポートと公開状態を確認してください。'];
    if (videoKey && !this.videoListener) {
      try {
        if (this.options.managementPorts().includes(videoPort)) throw new Error('PORT_CONFLICT');
        const listener = await this.openListener('video', network, createSmartphoneStatusApplication(this, network, address, videoPort), address, videoPort);
        if (!current()) { await listener.close(); return; }
        this.videoListener = { key: videoKey, listener };
      } catch { warnings.push('スマホ登録・映像状態の待受を開始できません。TCPポートとファイアウォールを確認してください。'); }
    }
    if (!current()) return;
    this.networks[network] = { address, commentsUrl, registrationReady: Boolean(this.videoListener), invitationRevision: this.record!.invitations?.[network].revision ?? 0,
      videoReady: Boolean(this.videoListener), obsReady: obsEnabled && Boolean(this.videoListener), warning: warnings.join(' ') || null };
    this.options.obs.setDevicePublication(network, obsEnabled && this.videoListener ? [{ network, address, port: videoPort }] : [], obsEnabled && Boolean(this.videoListener));
    await this.prepareDeviceAllocations(network);
    if (!current()) return;
    await this.syncReceivers();
    if (current()) this.publish();
  }

  private async syncReceivers() {
    const network = this.record?.settings.activeNetwork;
    if (network === 'direct') { await this.options.receivers.stop(); return; }
    const address = network ? this.networks[network].address : null;
    const active = network && address && !this.stopped;
    await this.options.receivers.sync(active ? this.record!.devices.flatMap(device => {
      const video = device.video[network];
      return video && device.obsLocalPort ? [{ id: `${device.id}:${network}`, network, address, port: video.obsPort,
        localPort: device.obsLocalPort, passphrase: video.passphrase }] : [];
    }) : []);
  }

  async stop(): Promise<void> {
    this.generation++;
    this.stopped = true; clearInterval(this.timer); this.unsubscribe?.();
    this.refreshOwnership();
    const stopping = Promise.allSettled([
      () => this.options.lanNetwork?.stop?.(), () => this.direct?.stop(), () => this.options.receivers.stop(), () => this.closeListeners(), () => this.options.mobile.stop(),
    ].map(stop => Promise.resolve().then(stop)));
    // Closing public resources must not wait behind an unrelated in-flight save.
    await this.queue;
    const results = await stopping;
    for (const result of results) if (result.status === 'rejected') throw result.reason;
  }

  private changeDevices(change: (record: SmartphoneRecord) => void, invalidatedId?: string): Promise<void> {
    return this.serial(async () => {
      const next = this.editable(); const invalidated = invalidatedId ? this.device(next, invalidatedId).obs.registrationId : null;
      change(next); await this.options.store.save(next); this.record = next;
      this.refreshOwnership();
      if (invalidated) {
        this.options.obs.invalidateDeviceRegistration(invalidated);
        for (const network of smartphoneNetworks) this.reports.delete(`${invalidatedId}:${network}`);
      }
      await this.refreshNow(); this.publish();
    }).then(() => { void this.direct?.refresh(); });
  }
  private editable(): SmartphoneRecord {
    if (!this.record || this.stopped) throw new Error('スマホ台帳を利用できません。元の保存は保持しています。');
    return structuredClone(this.record);
  }
  private device(record: SmartphoneRecord, id: string): SmartphoneDevice {
    const device = record.devices.find(d => d.id === id); if (!device) throw new Error('スマホの登録が見つかりません。'); return device;
  }
  private updateDeviceAddress(device: SmartphoneDevice, network: PrivateSmartphoneNetwork, address: string, statusPort: number, obsPort: number) {
    const video = device.video[network];
    if (video && (video.address !== address || video.statusPort !== statusPort)) {
      video.address = address; video.statusPort = statusPort; video.revision += 1;
      this.reports.delete(`${device.id}:${network}`);
    }
    const endpoint = { network, address, port: obsPort };
    if (JSON.stringify(device.obs.endpoints.find(e => e.network === network)) !== JSON.stringify(endpoint)) {
      device.obs.endpoints = [...device.obs.endpoints.filter(e => e.network !== network), endpoint];
      device.obs.revision += 1;
      this.options.obs.invalidateDeviceRegistration(device.obs.registrationId);
    }
  }
  private videoRegistration(device: SmartphoneDevice, network: PrivateSmartphoneNetwork): Omit<OutdoorRegistration, 'statusPort'> {
    const video = device.video[network]; if (!video?.address) throw new Error('映像の接続先を準備してください。');
    return { type: video.type, version: video.version, registrationId: video.registrationId, revision: video.revision,
      address: video.address, obsPort: video.obsPort, passphrase: video.passphrase, token: video.token };
  }
  private profileView(device: SmartphoneDevice, network: PrivateSmartphoneNetwork) {
    const report = this.reports.get(`${device.id}:${network}`);
    return { registered: Boolean(device.updates?.[network]?.credential), obsPort: device.video[network]?.obsPort ?? 0,
      receiver: this.options.receivers.view(`${device.id}:${network}`), preparation: this.preparation(device.id, network), revision: device.video[network]?.revision ?? 0, report: report ? structuredClone(report.report) : null,
      stale: !report || report.disconnected || this.now() - report.receivedAt > 10000 || !this.networks[network].videoReady };
  }

  private ensureUpdate(device: SmartphoneDevice, network: SmartphoneNetwork) {
    device.updates ??= {};
    return device.updates[network] ??= { credential: newDirectCredential(), speechRecognition: newDirectCredential(), updateRevision: 0, projectionHash: '', legacyProjectionHash: '' };
  }

  /** Allocation failures belong to one receiver, never to the saved registration or comment transport. */
  private async prepareDeviceAllocations(network: SmartphoneNetwork) {
    const generation = this.generation;
    const next = this.editable();
    const allocated: string[] = [];
    for (const device of next.devices) {
      if (network === 'direct' && !next.direct?.devices[device.id]) continue;
      const key = `${device.id}:${network}`;
      try {
        if (network === 'direct') this.allocateDirectVideo(next, device.id);
        else {
          allocateVideo(next, device, network);
          const address = this.networks[network].address;
          if (address) this.updateDeviceAddress(device, network, address, next.settings.statusPorts[network], next.settings.statusPorts[network]);
        }
        allocated.push(key);
      } catch { this.preparationErrors.add(key); }
    }
    try {
      if (JSON.stringify(next) !== JSON.stringify(this.record)) {
        await this.options.store.save(next);
        if (this.stopped || this.generation !== generation) return;
        this.record = next;
      }
      for (const key of allocated) this.preparationErrors.delete(key);
    } catch { for (const key of allocated) this.preparationErrors.add(key); }
    if (this.stopped || this.generation !== generation) return;
    if (network === 'direct') void this.direct?.refresh();
  }

  private preparation(id: string, network: SmartphoneNetwork): SmartphonePreparation {
    const obs = this.options.obs.view();
    const active = !this.stopped && this.record?.settings.activeNetwork === network;
    const controlReady = active && (network === 'direct' ? Boolean(this.direct?.tcpEndpoints().length) : this.networks[network].obsReady);
    const receiver = network === 'direct' ? this.direct?.receiver(id) : this.options.receivers.view(`${id}:${network}`);
    const ready = active && (network === 'direct' ? Boolean(this.direct?.srtEndpoints(id).length) :
      Boolean(this.networks[network].registrationReady && this.record?.devices.find(d => d.id === id)?.video[network] &&
        receiver && ['listening', 'receiving', 'reconnecting'].includes(receiver.state)));
    const failed = active && (this.preparationErrors.has(`${id}:${network}`) || receiver?.state === 'error' ||
      (network === 'direct' && Boolean(this.direct?.view().entries.some(entry => entry.deviceId === id && entry.protocol === 'udp' && entry.warning))));
    return { video: ready ? 'ready' : failed ? 'error' : 'preparing',
      obsControl: !obs.enabled || !obs.androidEnabled ? 'disabled' : controlReady ? 'ready' : 'preparing' };
  }

  private async updatedRegistrationNow(id: string, network: SmartphoneNetwork, protocolVersion: SmartphoneControlVersion = 3): Promise<UpdatedSmartphoneRegistration> {
    const next = this.editable(); const device = this.device(next, id);
    const update = device.updates?.[network];
    if (!update || next.settings.activeNetwork !== network) throw new Error('登録情報の更新接続を確認してください。');
    const preparation = this.preparation(id, network);
    const common = { type: 'casmate.outdoor' as const, pcId: next.pcId, deviceId: id,
      registrationUpdate: structuredClone(update.credential), speechRecognition: structuredClone(update.speechRecognition), updateRevision: update.updateRevision, preparation };
    let result: CurrentSmartphoneRegistration;
    if (network === 'direct') {
      const allocation = next.direct?.devices[id]; const endpoints = this.direct?.tcpEndpoints() ?? [];
      if (!allocation?.registered || !next.direct?.identity || !endpoints.length) throw new Error('登録情報の更新接続を準備中です。');
      const outdoor = allocation.outdoor;
      result = { ...common, version: compatibilityPolicy.contracts.directRegistration.current, network, pcKey: next.direct.identity.pcKey, endpoints,
        comments: { ...allocation.comments, protocolVersion: compatibilityPolicy.contracts.mobileProtocol.current }, control: { protocolVersion: compatibilityPolicy.contracts.controlProtocol.current },
        ...(preparation.video === 'ready' && outdoor ? { outdoor: { registrationId: outdoor.registrationId, revision: outdoor.revision,
          token: outdoor.token, passphrase: outdoor.passphrase, endpoints: this.direct!.srtEndpoints(id) } } : {}),
        ...(preparation.obsControl === 'ready' ? { obsControl: { ...allocation.obs } } : {}) };
    } else {
      const view = this.networks[network];
      if (!view.commentsUrl || !view.registrationReady) throw new Error('登録情報の更新接続を準備中です。');
      result = { ...common, version: compatibilityPolicy.contracts.privateRegistration.current, network, comments: { url: view.commentsUrl },
        control: { protocolVersion: compatibilityPolicy.contracts.controlProtocol.current, url: `ws://${view.address}:${next.settings.statusPorts[network]}/smartphone/ws` },
        ...(preparation.video === 'ready' ? { outdoor: this.videoRegistration(device, network) } : {}),
        ...(preparation.obsControl === 'ready' ? { obsControl: { registrationId: device.obs.registrationId, revision: device.obs.revision, token: device.obs.token } } : {}) };
    }
    const projection = protocolVersion === 2 ? legacyRegistrationProjection(result) : result;
    const hashKey = protocolVersion === 2 ? 'legacyProjectionHash' : 'projectionHash';
    const hash = createHash('sha256').update(JSON.stringify({ ...projection, updateRevision: 0 })).digest('hex');
    if (hash !== update[hashKey]) {
      if (update.updateRevision >= Number.MAX_SAFE_INTEGER) throw new Error('登録情報の更新番号を更新できません。');
      update.updateRevision += 1; update[hashKey] = hash;
      await this.options.store.save(next); this.record = next;
    }
    projection.updateRevision = update.updateRevision;
    return projection;
  }
  private fallbackSettings() {
    return defaultSmartphoneSettings();
  }
  private now() { return (this.options.now ?? Date.now)(); }
  private publish() {
    if (this.record?.settings.activeNetwork === 'direct') { const obs = this.options.obs.view(); this.options.obs.setDevicePublication(null, [], Boolean(!this.stopped && obs.enabled && obs.androidEnabled && this.direct?.tcpEndpoints().length)); }
    this.options.state.setSmartphoneState(this.snapshot());
  }
  private currentObsSignature() { const o = this.options.obs.view(); return JSON.stringify([o.enabled, o.androidEnabled, o.publication.port]); }
  private serial<T>(action: () => Promise<T>): Promise<T> { const result = this.queue.then(action); this.queue = result.catch(() => undefined); return result; }
  private async openListener(_kind: 'video', network: PrivateSmartphoneNetwork, app: Express, address: string, port: number): Promise<Listener> {
    const listener = await (this.options.listen ?? listenHttp)(app, address, port, () => {
      void this.serial(async () => {
        if (this.videoListener?.listener !== listener) return;
        this.videoListener = undefined;
        this.networks[network].videoReady = false; this.networks[network].registrationReady = false; this.networks[network].obsReady = false;
        this.options.obs.setPublicationReady(false);
        this.networks[network].warning = 'スマホの登録・制御接続に失敗しました。ネットワークを確認してください。';
        this.publish(); await listener.close();
      }).catch(() => undefined);
    }, server => attachSmartphoneControlServer(server, { controller: this, obs: this.options.obs, state: this.options.state, network, address, port }));
    return listener;
  }
  private async closeListeners(clearObsPublication = true) {
    if (clearObsPublication) { const network = this.record?.settings.activeNetwork; this.options.obs.setDevicePublication(network === 'direct' ? null : network ?? null, [], false); }
    // Receiver ownership fences the next writer independently of comment/control
    // listeners. Never wait for DirectRuntime's save callbacks inside this queue.
    void this.options.receivers.stop().then(() => { if (!this.stopped) this.publish(); }).catch(() => undefined);
    await this.videoListener?.listener.close();
    this.videoListener = undefined;
    this.networks = { lan: emptyNetwork(), tailscale: emptyNetwork() };
  }

  private refreshOwnership(): void {
    const network = this.stopped ? null : this.record?.settings.activeNetwork ?? null;
    this.options.receivers.activate?.(network); this.options.direct?.receivers.activate?.(network);
  }
  private acceptsReceiver(config: ReceiverConfig): boolean {
    if (this.stopped || this.record?.settings.activeNetwork !== config.network) return false;
    const device = this.record.devices.find(value => `${value.id}:${config.network}` === config.id);
    if (!device || device.obsLocalPort !== config.localPort) return false;
    if (config.network === 'direct') {
      const video = this.record.direct?.devices[device.id]?.outdoor;
      return Boolean(video && video.internalPort === config.port && video.passphrase === config.passphrase);
    }
    const video = device.video[config.network];
    return Boolean(video && video.obsPort === config.port && video.address === config.address && video.passphrase === config.passphrase);
  }

  authenticateRead(token?: string): string | null {
    if (this.stopped || this.record?.settings.activeNetwork !== 'direct' || !this.direct?.tcpEndpoints().length) return null;
    return Object.entries(this.record.direct!.devices).find(([, d]) => d.registered && matchesToken(d.comments.token, token))?.[0] ?? null;
  }
  authenticateDirectInvitation(token?: string): boolean { return !this.stopped && this.record?.settings.activeNetwork === 'direct' && Boolean(this.direct?.tcpEndpoints().length) && matchesToken(this.record.direct!.invitation.token, token); }
  directConnected(address: string, port: number, host: string) { return this.direct?.connected(address, port, host) ?? (() => undefined); }
  sendDirectAudioReady(id: string, audio: MobileAudioReady) { this.direct?.sendAudioReady(id, audio); }
  discardDirectAudio(id: string, audioId: string) { this.direct?.discardAudio(id, audioId); }
  async lanAdapters() {
    if (!this.options.lanNetwork) throw new Error('ネットワーク一覧を取得できません。');
    return (await this.options.lanNetwork.list()).map(a => ({ id: a.id, name: a.name, description: a.description,
      preferred: false, addresses: a.addresses.filter(v => v.family === 'ipv4' && isAllowedObsEndpointAddress('lan', v.address)) }))
      .filter(a => a.addresses.length).sort((a, b) => a.name.localeCompare(b.name));
  }
  async directAdapters() {
    if (!this.direct) throw new Error('ネットワーク一覧を取得できません。');
    return this.direct.adapters();
  }
  async directRetry() { await this.direct?.retryNow(); }
  async directCleanup() { await this.direct?.cleanup(); }
  async directManualConfirm(revision: number, deviceId?: string) { if (!this.direct) throw new Error('直接接続を利用できません。'); await this.direct.manualConfirm(revision, deviceId); }
  async resetDirectIdentity() {
    await this.serial(async () => { const next = this.editable(); if (next.settings.activeNetwork === 'direct') throw new Error('直接接続をOFFにしてからPC鍵を再生成してください。');
      next.direct!.identity = null; rotateDirectInvitation(next.direct!); next.direct!.revision += 1;
      for (const d of Object.values(next.direct!.devices)) { d.registered = false; d.pending = true;
        d.comments = { ...newDirectCredential(), revision: d.comments.revision + 1 }; d.obs = { ...newDirectCredential(), revision: d.obs.revision + 1 };
        if (d.outdoor) d.outdoor = { ...d.outdoor, ...newDirectCredential(), passphrase: randomBytes(16).toString('hex'), revision: d.outdoor.revision + 1 }; }
      for (const device of next.devices) { const update = device.updates?.direct;
        if (update) { update.credential = { ...newDirectCredential(), revision: update.credential.revision + 1 };
          update.speechRecognition = { ...newDirectCredential(), revision: update.speechRecognition.revision + 1 }; update.projectionHash = ''; update.legacyProjectionHash = ''; } }
      await this.options.store.save(next); this.record = next; this.publish(); });
    this.direct?.resetIdentityFailure();
  }
  private allocateDirectVideo(record: SmartphoneRecord, id: string) {
    const allocation = record.direct!.devices[id]!;
    const device = this.device(record, id);
    const reserved = [...record.reservedPorts];
    const previousObsPort = device.obsLocalPort;
    try {
      device.obsLocalPort ??= allocateSmartphonePort(record);
      allocation.outdoor ??= { ...newDirectCredential(), passphrase: randomBytes(16).toString('hex'), internalPort: allocateSmartphonePort(record) };
    } catch (error) {
      record.reservedPorts = reserved;
      if (previousObsPort === undefined) delete device.obsLocalPort;
      throw error;
    }
  }
  private directProfileView(id: string) {
    const video = this.record?.direct?.devices[id]?.outdoor; const report = this.reports.get(`${id}:direct`);
    return { registered: Boolean(this.record?.direct?.devices[id]?.registered && this.record.devices.find(device => device.id === id)?.updates?.direct?.credential),
      obsPort: video?.internalPort ?? 0, revision: video?.revision ?? 0, receiver: this.direct?.receiver(id), preparation: this.preparation(id, 'direct'),
      report: report ? structuredClone(report.report) : null, stale: !report || report.disconnected || this.now() - report.receivedAt > 10000 || !this.direct?.srtEndpoints(id).length };
  }
  private enrollDirect(authorization: string | undefined, value: unknown, protocolVersion: SmartphoneControlVersion): Promise<SmartphoneRegistration> {
    let request: ReturnType<typeof parseEnrollment>;
    try { request = parseEnrollment(value, true); } catch (error) { return Promise.reject(error); }
    const key = JSON.stringify([authorization, request, protocolVersion]); const existing = this.enrollments.get(key); if (existing) return existing;
    const operation = this.serial(async () => {
      const next = this.editable();
      if (next.settings.activeNetwork !== 'direct' || !matchesToken(next.direct!.invitation.token, authorization)) throw new EnrollmentError(403, 'INVITATION_EXPIRED', 'PCの共通QRを開き直してください。');
      try { this.invitation('direct'); } catch { throw new EnrollmentError(503, 'PREPARATION_FAILED', 'HTTPSの待受を準備できません。PCの接続状態を確認してください。'); }
      const device = enrollDevice(next, request);
      next.direct!.devices[device.id] ??= { comments: newDirectCredential(), obs: newDirectCredential(), registered: false, pending: true };
      this.ensureUpdate(device, 'direct');
      next.direct!.devices[device.id]!.registered = true;
      next.direct!.devices[device.id]!.pending = false;
      await this.options.store.save(next); this.record = next; this.publish();
      return this.updatedRegistrationNow(device.id, 'direct', protocolVersion);
    }).then(result => { void this.refresh(); return result; }).finally(() => this.enrollments.delete(key));
    this.enrollments.set(key, operation); return operation;
  }
}

function emptyNetwork() { return { address: null, commentsUrl: null, registrationReady: false, invitationRevision: 0, videoReady: false, obsReady: false, warning: null }; }
/** The preceding app sees exactly its own closed wire contract, without new authority. */
export function legacyRegistrationProjection(registration: CurrentSmartphoneRegistration): UpdatedSmartphoneRegistration {
  const { speechRecognition, ...common } = registration;
  // Explicit destructuring removes only the new authority from the legacy wire projection.
  void speechRecognition;
  if (common.network === 'direct') return { ...common, version: 14, control: { protocolVersion: 2 } };
  return { ...common, version: 12, control: { protocolVersion: 2, url: common.control.url } };
}
function matchesToken(token: string, authorization: string | undefined): boolean {
  const expected = Buffer.from(`Bearer ${token}`); const actual = Buffer.from(authorization ?? '');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
async function listenHttp(app: Express, address: string, port: number, onError: () => void, setup?: (server: Server) => () => void): Promise<Listener> {
  const server = createServer(app);
  const dispose = setup?.(server);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, address, () => { server.off('error', reject); resolve(); }); });
  server.on('error', onError);
  return { close: async () => { dispose?.(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
export function createSmartphoneStatusApplication(controller: SmartphoneController, network: PrivateSmartphoneNetwork, address: string, port: number): Express {
  const app = express(); app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST' || req.originalUrl !== '/smartphone/enroll') { res.sendStatus(404); return; }
    const remote = req.socket.remoteAddress?.replace(/^::ffff:/u, '');
    if (req.headers.origin !== undefined || req.headers.host !== `${address}:${port}` || req.socket.localAddress !== address ||
      !remote || !isAllowedObsEndpointAddress(network, remote) ||
      ['x-casmate-read', 'x-casmate-obs', 'x-casmate-outdoor', 'x-casmate-registration', 'x-casmate-speech'].some(key => req.headers[key] !== undefined)) { res.sendStatus(403); return; }
    next();
  });
  app.use('/smartphone/enroll', express.json({ limit: 8192, strict: true }));
  app.post('/smartphone/enroll', async (req, res) => {
    try {
      const version = controlVersionHeader(req);
      if (version === null) throw new EnrollmentError(400, 'UNSUPPORTED_VERSION', 'PCとAndroidの対応版を確認してください。');
      res.json({ registration: await controller.enroll(network, req.headers.authorization, req.body, version) });
    }
    catch (error) {
      if (error instanceof EnrollmentError) { res.status(error.status).json({ code: error.code, message: error.message }); return; }
      res.status(503).json({ code: 'REGISTRATION_UNAVAILABLE', message: 'スマホの登録を保存できません。PCの接続状態と保存領域を確認してください。' });
    }
  });
  app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.sendStatus(400); });
  return app;
}
