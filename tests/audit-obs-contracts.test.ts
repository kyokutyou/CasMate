import { expect, it, vi } from 'vitest';
import { ObsControlController } from '../src/main/obs/obs-control-controller';
import { defaultObsControlSettings } from '../src/main/obs/obs-control-store';
import type { ObsWebsocketConnection } from '../src/main/obs/obs-websocket-client';

const store = () => ({ resetNotice: null, load: async () => ({ version: 1 as const, settings: { ...defaultObsControlSettings(), enabled: true, voiceEnabled: true, password: 'secret' }, registration: null }), save: async () => undefined });

it.each(['OBS_AUTH_REQUIRED', 'OBS_PROTOCOL_UNSUPPORTED', 'OBS_AUTHENTICATION_FAILED'])('%sでは明示操作まで接続を再試行しない', async reason => {
  vi.useFakeTimers();
  const connect = vi.fn(async (): Promise<ObsWebsocketConnection> => { throw new Error(reason); });
  const obs = new ObsControlController({ store: store(), transport: { connect } });
  try {
    await obs.start(); await vi.advanceTimersByTimeAsync(1000);
    expect(connect).toHaveBeenCalledTimes(1);
  } finally { await obs.stop(); vi.useRealTimers(); }
});

it('配信要求の応答が遅くても送信から30秒で結果不明とする', async () => {
  vi.useFakeTimers();
  let stream = { outputActive: false, outputState: 'OBS_WEBSOCKET_OUTPUT_STOPPED' };
  const connection: ObsWebsocketConnection = {
    request: async () => ({ requestStatus: { result: true, code: 100 } }),
    getStreamStatus: async () => stream,
    startStream: async () => {
      stream = { outputActive: false, outputState: 'OBS_WEBSOCKET_OUTPUT_STARTING' };
      setTimeout(() => { stream = { outputActive: true, outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED' }; }, 31000);
      await new Promise(resolve => setTimeout(resolve, 4000));
      return { requestStatus: { result: true, code: 100 } };
    },
    stopStream: async () => ({ requestStatus: { result: true, code: 100 } }),
    subscribe: () => () => undefined, onDisconnect: () => () => undefined, close: async () => undefined,
  };
  const obs = new ObsControlController({ store: store(), transport: { connect: async () => connection } });
  try {
    await obs.start(); await obs.retry();
    const utterance = { sessionId: 's', recognizedAt: new Date().toISOString(), audioDurationMilliseconds: 100, recognitionDurationMilliseconds: 10 };
    obs.handleSpeechResult({ ...utterance, id: 'command', sequence: 1, text: 'きゃすメイト、配信開始' });
    obs.handleSpeechResult({ ...utterance, id: 'confirmation', sequence: 2, text: '開始を実行' });
    await vi.advanceTimersByTimeAsync(31000);
    expect(obs.view().lastOperation).toMatchObject({ status: 'unknown', errorCode: 'OBS_OPERATION_TIMEOUT' });
  } finally { await obs.stop(); vi.useRealTimers(); }
});
