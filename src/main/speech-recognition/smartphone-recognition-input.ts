import { createSocket } from 'node:dgram';
import type { OutdoorReceivers } from '../outdoor/outdoor-receivers';
import type { SmartphoneView } from '../../shared/smartphone';
import type { SpeechRecognitionExternalInput } from './speech-recognition-worker';

export interface RecognitionInputLease {
  key: string;
  externalInput: SpeechRecognitionExternalInput;
  enable(): boolean;
  close(): void;
}
export interface SmartphoneRecognitionInputs {
  key(deviceId: string): string | null;
  hasDevice(deviceId: string): boolean;
  open(deviceId: string): Promise<RecognitionInputLease | null>;
  subscribe(listener: () => void): () => void;
}

/** Only owned receiver instances can feed recognition. No user-supplied URL is accepted. */
export class ReceiverRecognitionInputs implements SmartphoneRecognitionInputs {
  constructor(private readonly privateReceivers: OutdoorReceivers, private readonly directReceivers: OutdoorReceivers,
    private readonly view: () => SmartphoneView, private readonly ffmpegPath: string,
    private readonly subscribeState: (listener: () => void) => () => void) {}
  hasDevice(deviceId: string): boolean { return this.view().devices.some(d => d.id === deviceId); }
  private source(deviceId: string) {
    const network = this.view().settings.activeNetwork;
    if (!network || !this.hasDevice(deviceId)) return null;
    const receivers = network === 'direct' ? this.directReceivers : this.privateReceivers;
    const id = `${deviceId}:${network}`;
    const source = receivers.recognitionSource(id);
    return source?.receiving ? { receivers, id, source, key: `${source.receiverInstance}:${source.connectionRevision}:${source.sessionId}:${source.generation}` } : null;
  }
  key(deviceId: string): string | null { return this.source(deviceId)?.key ?? null; }
  async open(deviceId: string): Promise<RecognitionInputLease | null> {
    const current = this.source(deviceId); if (!current) return null;
    const socket = createSocket('udp4');
    const port = await new Promise<number>((resolve, reject) => {
      socket.once('error', reject);
      socket.bind({ address: '127.0.0.1', port: 0, exclusive: true }, () => { const address = socket.address(); resolve(address.port); });
    }).finally(() => { try { socket.close(); } catch { /* A failed bind has no open socket. */ } });
    if (this.key(deviceId) !== current.key) return null;
    return { key: current.key, externalInput: { udpPort: port, ffmpegPath: this.ffmpegPath, generation: current.key },
      enable: () => this.key(deviceId) === current.key && current.receivers.setRecognitionTap(current.id, { port, connectionRevision: current.source.connectionRevision }),
      close: () => {
        const source = current.receivers.recognitionSource(current.id);
        if (source && `${source.receiverInstance}:${source.connectionRevision}:${source.sessionId}:${source.generation}` === current.key)
          current.receivers.setRecognitionTap(current.id, null);
      } };
  }
  subscribe(listener: () => void): () => void {
    const callbacks = [this.privateReceivers.subscribeRecognition(listener), this.directReceivers.subscribeRecognition(listener), this.subscribeState(listener)];
    return () => { for (const unsubscribe of callbacks) unsubscribe(); };
  }
}
