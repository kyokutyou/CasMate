import { createHash, randomUUID } from 'node:crypto';
import { WebSocket, type RawData } from 'ws';

export interface ObsRequestResponse {
  requestStatus: {
    result: boolean;
    code: number;
    comment?: string;
  };
  responseData?: Record<string, unknown>;
}

export interface ObsStreamStatus {
  outputActive: boolean;
  outputState: string;
}

export interface ObsWebsocketConnection {
  request(requestType: string, requestData?: Record<string, unknown>): Promise<ObsRequestResponse>;
  getStreamStatus(): Promise<ObsStreamStatus>;
  startStream(): Promise<ObsRequestResponse>;
  stopStream(): Promise<ObsRequestResponse>;
  subscribe(listener: (event: ObsWebsocketEvent) => void): () => void;
  onDisconnect(listener: (error: Error) => void): () => void;
  close(): Promise<void>;
}

export type ObsWebsocketEvent = {
  eventType: string;
  eventData?: Record<string, unknown>;
};

export interface ObsWebsocketTransport {
  connect(url: string, password: string): Promise<ObsWebsocketConnection>;
}

const OBS_RPC_VERSION = 1;
const REQUEST_TIMEOUT_MS = 5_000;

export class DefaultObsWebsocketTransport implements ObsWebsocketTransport {
  connect(url: string, password: string): Promise<ObsWebsocketConnection> {
    return ObsWebsocketConnectionImpl.connect(url, password);
  }
}

class ObsWebsocketConnectionImpl implements ObsWebsocketConnection {
  private readonly events = new Set<(event: ObsWebsocketEvent) => void>();
  private readonly disconnectListeners = new Set<(error: Error) => void>();
  private readonly pending = new Map<string, {
    resolve: (value: ObsRequestResponse) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }>();
  private closed = false;
  private constructor(private readonly socket: WebSocket) {
    socket.on('message', (data) => this.handleMessage(String(data)));
    socket.on('close', () => this.failClosed(new Error('OBS_WEBSOCKET_DISCONNECTED')));
    socket.on('error', (error) => this.failClosed(error instanceof Error ? error : new Error('OBS_WEBSOCKET_ERROR')));
  }

  static connect(url: string, password: string): Promise<ObsWebsocketConnection> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const socket = new WebSocket(url);
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.close();
        reject(new Error('OBS_WEBSOCKET_TIMEOUT'));
      }, REQUEST_TIMEOUT_MS);
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.close();
        reject(error instanceof Error ? error : new Error('OBS_WEBSOCKET_UNAVAILABLE'));
      };
      socket.once('error', fail);
      socket.once('close', code => fail(new Error(code === 4009 ? 'OBS_AUTHENTICATION_FAILED'
        : code === 4010 ? 'OBS_PROTOCOL_UNSUPPORTED' : 'OBS_WEBSOCKET_DISCONNECTED')));
      const onHello = (data: RawData) => {
        if (settled) return;
        let message: ObsMessage;
        try { message = parseObsMessage(String(data)); }
        catch { fail(new Error('OBS_WEBSOCKET_PROTOCOL')); return; }
        if (message.op !== 0) return;
        const hello = message.d as unknown as ObsHello;
        if (!hello || hello.rpcVersion !== OBS_RPC_VERSION) {
          fail(new Error('OBS_PROTOCOL_UNSUPPORTED'));
          return;
        }
        if (!hello.authentication || typeof hello.authentication.challenge !== 'string' ||
          typeof hello.authentication.salt !== 'string') {
          fail(new Error('OBS_AUTH_REQUIRED'));
          return;
        }
        const identify: ObsMessage = {
          op: 1,
          d: {
            rpcVersion: OBS_RPC_VERSION,
            authentication: obsAuthentication(password, hello.authentication),
          },
        };
        socket.send(JSON.stringify(identify));
        const onIdentified = (identifiedData: ObsMessage) => {
          if (identifiedData.op !== 2) return;
          const status = identifiedData.d as { negotiatedRpcVersion?: number };
          if (status.negotiatedRpcVersion !== OBS_RPC_VERSION) {
            fail(new Error('OBS_PROTOCOL_UNSUPPORTED'));
            return;
          }
          settled = true;
          clearTimeout(timer);
          socket.removeListener('message', onMessageBeforeConnection);
          socket.removeListener('error', fail);
          resolve(new ObsWebsocketConnectionImpl(socket));
        };
        const onMessageBeforeConnection = (next: RawData) => {
          try { onIdentified(parseObsMessage(String(next))); }
          catch { fail(new Error('OBS_WEBSOCKET_PROTOCOL')); }
        };
        socket.removeListener('message', onHello);
        socket.on('message', onMessageBeforeConnection);
      };
      socket.on('message', onHello);
    });
  }

  request(requestType: string, requestData?: Record<string, unknown>): Promise<ObsRequestResponse> {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('OBS_WEBSOCKET_DISCONNECTED'));
    }
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('OBS_WEBSOCKET_TIMEOUT'));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(requestId, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ op: 6, d: { requestType, requestId, ...(requestData ? { requestData } : {}) } }));
    });
  }

  async getStreamStatus(): Promise<ObsStreamStatus> {
    const response = await this.request('GetStreamStatus');
    if (!response.requestStatus.result) throw new Error('OBS_GET_STREAM_STATUS_FAILED');
    const data = response.responseData ?? {};
    if (typeof data.outputActive !== 'boolean' ||
      (data.outputReconnecting !== undefined && typeof data.outputReconnecting !== 'boolean')) {
      throw new Error('OBS_STREAM_STATUS_INVALID');
    }
    const outputState = typeof data.outputState === 'string'
      ? data.outputState
      : data.outputReconnecting === true
        ? 'OBS_WEBSOCKET_OUTPUT_RECONNECTING'
        : data.outputActive
          ? 'OBS_WEBSOCKET_OUTPUT_STARTED'
          : 'OBS_WEBSOCKET_OUTPUT_STOPPED';
    return { outputActive: data.outputActive, outputState };
  }

  startStream(): Promise<ObsRequestResponse> { return this.request('StartStream'); }
  stopStream(): Promise<ObsRequestResponse> { return this.request('StopStream'); }

  subscribe(listener: (event: ObsWebsocketEvent) => void): () => void {
    this.events.add(listener);
    return () => this.events.delete(listener);
  }

  onDisconnect(listener: (error: Error) => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
      this.socket.close();
    }
    this.failPending(new Error('OBS_WEBSOCKET_DISCONNECTED'));
  }

  private handleMessage(raw: string): void {
    let message: ObsMessage;
    try { message = parseObsMessage(raw); }
    catch { return; }
    if (message.op === 5) {
      const event = message.d as { eventType?: string; eventData?: Record<string, unknown> };
      if (typeof event.eventType === 'string') {
        for (const listener of this.events) listener({ eventType: event.eventType, eventData: event.eventData });
      }
      return;
    }
    if (message.op !== 7) return;
    const data = message.d as { requestId?: string; requestStatus?: ObsRequestResponse['requestStatus']; responseData?: Record<string, unknown> };
    if (typeof data.requestId !== 'string' || !isRecord(data.requestStatus) ||
      typeof data.requestStatus.result !== 'boolean' || !Number.isInteger(data.requestStatus.code) ||
      (data.requestStatus.comment !== undefined && typeof data.requestStatus.comment !== 'string') ||
      (data.responseData !== undefined && !isRecord(data.responseData))) return;
    const pending = this.pending.get(data.requestId);
    if (!pending) return;
    this.pending.delete(data.requestId);
    clearTimeout(pending.timer);
    pending.resolve({ requestStatus: data.requestStatus, responseData: data.responseData });
  }

  private failClosed(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.failPending(error);
    for (const listener of this.disconnectListeners) listener(error);
    this.disconnectListeners.clear();
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

interface ObsMessage { op: number; d: Record<string, unknown>; }
interface ObsHello { rpcVersion: number; authentication?: { challenge: string; salt: string } }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseObsMessage(raw: string): ObsMessage {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value) || !Number.isInteger(value.op) || !isRecord(value.d)) {
    throw new Error('OBS_WEBSOCKET_PROTOCOL');
  }
  return { op: value.op as number, d: value.d };
}

export function obsAuthentication(password: string, authentication: { challenge: string; salt: string }): string {
  const secret = createHash('sha256').update(`${password}${authentication.salt}`, 'utf8').digest('base64');
  return createHash('sha256').update(`${secret}${authentication.challenge}`, 'utf8').digest('base64');
}

export function obsStreamStateFromStatus(status: ObsStreamStatus): import('../../shared/obs-control').ObsStreamState {
  switch (status.outputState) {
    case 'OBS_WEBSOCKET_OUTPUT_STARTING': return 'starting';
    case 'OBS_WEBSOCKET_OUTPUT_STOPPING': return 'stopping';
    case 'OBS_WEBSOCKET_OUTPUT_RECONNECTING': return 'reconnecting';
    case 'OBS_WEBSOCKET_OUTPUT_STARTED': return 'streaming';
    case 'OBS_WEBSOCKET_OUTPUT_STOPPED': return 'stopped';
    default: return 'unknown';
  }
}
