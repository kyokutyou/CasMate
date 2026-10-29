import { useCallback, useEffect, useRef, useState } from 'react';
import type { ObsSourceAddRequest, ObsSourceContext, ObsSourceOperation, ObsSourceTarget } from '../shared/obs-source-registration';
import type { ObsSourceTestRequest, ObsSourceTestContext, ObsSourceTestState } from '../shared/obs-source-test';
import type {
  AppSnapshot,
  CharacterAssetSlot,
  ConnectionKey,
  RealtimeEvent,
  SettingsSection,
  SimpleCharacterMotionSettings,
  SpeechRecognitionOverlayBootstrap,
  SpeechRecognitionOverlayRealtimeEvent,
  TextEffectsSettings,
  TextEffectTriggeredPayload,
  VoicevoxSpeaker,
} from '../shared/types';

export function useTextEffectsOverlay() {
  const [settings, setSettings] = useState<TextEffectsSettings | null>(null);
  const [trigger, setTrigger] = useState<TextEffectTriggeredPayload | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let cancelled = false;
    let socket: WebSocket | null = null;
    let retry: number | undefined;
    let receivedState = false;
    const abort = new AbortController();
    const load = async () => {
      const response = await fetch('/api/bootstrap', { signal: abort.signal });
      if (!response.ok) return;
      const data = await response.json() as BootstrapResponse;
      if (!cancelled && !receivedState) setSettings(data.snapshot.settings.textEffects);
    };
    const connect = () => {
      if (cancelled) return;
      const current = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      socket = current;
      socketRef.current = socket;
      socket.addEventListener('message', (message) => {
        if (cancelled || socket !== current) return;
        const event = JSON.parse(String(message.data)) as RealtimeEvent;
        if (event.type === 'state.snapshot') {
          receivedState = true; abort.abort();
          setSettings((event.payload as AppSnapshot).settings.textEffects);
        } else if (event.type === 'settings.changed') {
          const payload = event.payload as { section?: string; value?: TextEffectsSettings };
          if (payload.section === 'textEffects' && payload.value) {
            receivedState = true; abort.abort(); setSettings(payload.value);
          }
        } else if (event.type === 'textEffects.triggered') {
          setTrigger(event.payload as TextEffectTriggeredPayload);
        }
      });
      socket.addEventListener('close', () => {
        if (!cancelled && socket === current) {
          socket = null; socketRef.current = null;
          retry = window.setTimeout(connect, 1_500);
        }
      });
    };
    void load().catch(() => undefined);
    connect();
    return () => {
      cancelled = true;
      abort.abort();
      if (retry) window.clearTimeout(retry);
      socket?.close();
      socketRef.current = null;
    };
  }, []);

  const reportError = useCallback(() => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'textEffects.renderError' }));
    }
  }, []);

  return { settings, trigger, reportError };
}

interface BootstrapResponse {
  snapshot: AppSnapshot;
  operationToken?: string;
  revision?: number;
}

export function useSpeechRecognitionOverlay() {
  const [overlay, setOverlay] = useState<SpeechRecognitionOverlayBootstrap | null>(null);
  const lastRevision = useRef(-1);

  useEffect(() => {
    let cancelled = false;
    let socket: WebSocket | null = null;
    let retry: number | undefined;
    let receivedState = false;
    const abort = new AbortController();

    const bootstrap = async () => {
      const response = await fetch('/api/overlays/speech-recognition/bootstrap', { signal: abort.signal });
      if (!response.ok) throw new Error('音声認識表示を取得できません。');
      const value = await response.json() as SpeechRecognitionOverlayBootstrap;
      if (!cancelled && !receivedState) setOverlay(value);
    };
    const connect = () => {
      if (cancelled) return;
      const current = new WebSocket(
        `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/overlay/speech-recognition`,
      );
      socket = current;
      socket.addEventListener('message', (message) => {
        if (cancelled || socket !== current) return;
        const event = JSON.parse(String(message.data)) as SpeechRecognitionOverlayRealtimeEvent;
        if (event.type === 'speechRecognitionOverlay.snapshot') {
          receivedState = true; abort.abort();
          lastRevision.current = event.revision;
          setOverlay(event.payload);
          return;
        }
        if (event.revision <= lastRevision.current) return;
        if (lastRevision.current >= 0 && event.revision > lastRevision.current + 1) {
          socket?.close();
          return;
        }
        lastRevision.current = event.revision;
        if (event.type === 'speechRecognitionOverlay.stateChanged') {
          setOverlay((current) => current ? { ...current, state: event.payload } : current);
        } else if (event.type === 'speechRecognitionOverlay.appearanceChanged') {
          setOverlay((current) => current ? { ...current, appearance: event.payload } : current);
        } else if (event.type === 'application.stopping') {
          setOverlay((current) => current
            ? { ...current, state: { active: null } }
            : current);
        }
      });
      socket.addEventListener('close', () => {
        if (!cancelled && socket === current) {
          socket = null;
          retry = window.setTimeout(connect, 1_500);
        }
      });
    };

    void bootstrap().catch(() => undefined);
    connect();
    return () => {
      cancelled = true;
      abort.abort();
      if (retry) clearTimeout(retry);
      socket?.close();
    };
  }, []);

  return overlay;
}

export function useApplicationState(management = false) {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const obsRegistrationRef = useRef<AppSnapshot['obsSourceRegistration']>(undefined);
  const obsTestRef = useRef<AppSnapshot['obsSourceTest']>(undefined);
  const [obsSourceContextRevision, setObsSourceContextRevision] = useState(0);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const token = useRef<string | null>(
    document.querySelector<HTMLMetaElement>('meta[name="casmate-management"]')?.content ?? null,
  );
  const lastRevision = useRef(-1);
  const socketRef = useRef<WebSocket | null>(null);
  const snapshotGeneration = useRef(0);

  const bootstrap = useCallback(async () => {
    const generation = snapshotGeneration.current;
    const response = await fetch(`/api/bootstrap${management ? '?view=management' : ''}`, {
      headers: management && token.current ? { 'X-CasMate-Management': token.current } : {},
    });
    if (!response.ok) throw new Error('起動状態を取得できません。');
    const data = (await response.json()) as BootstrapResponse;
    if (generation === snapshotGeneration.current && (lastRevision.current < 0 ||
      (Number.isSafeInteger(data.revision) && data.revision! >= lastRevision.current))) {
      if (Number.isSafeInteger(data.revision)) lastRevision.current = data.revision!;
      obsRegistrationRef.current = data.snapshot.obsSourceRegistration;
      obsTestRef.current = data.snapshot.obsSourceTest;
      setSnapshot(data.snapshot);
      if (management) setObsSourceContextRevision(data.revision ?? 0);
    }
    if (data.operationToken) token.current = data.operationToken;
    return data.snapshot;
  }, [management]);

  useEffect(() => {
    let cancelled = false;
    let socket: WebSocket | null = null;
    let retry: number | undefined;
    void bootstrap().catch((reason: unknown) => {
      if (!cancelled) setError(messageOf(reason));
    });

    const connect = () => {
      if (cancelled) return;
      const managementQuery = management && token.current
        ? `?management=${encodeURIComponent(token.current)}`
        : '';
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws${managementQuery}`);
      socketRef.current = socket;
      socket.addEventListener('open', () => {
        setConnected(true);
        setError(null);
      });
      socket.addEventListener('message', (message) => {
        const event = JSON.parse(String(message.data)) as RealtimeEvent;
        if (event.type === 'state.snapshot') {
          snapshotGeneration.current++;
          lastRevision.current = event.revision;
          obsRegistrationRef.current = (event.payload as AppSnapshot).obsSourceRegistration;
          obsTestRef.current = (event.payload as AppSnapshot).obsSourceTest;
          setSnapshot(event.payload as AppSnapshot);
          if (management) setObsSourceContextRevision(event.revision);
          return;
        }
        if (event.revision <= lastRevision.current) return;
        if (lastRevision.current >= 0 && event.revision > lastRevision.current + 1) {
          void bootstrap();
          return;
        }
        lastRevision.current = event.revision;
        if (management && event.type === 'obsSourceRegistration.contextInvalidated') setObsSourceContextRevision(event.revision);
        if (event.type === 'obsSourceRegistration.stateChanged') obsRegistrationRef.current = event.payload as AppSnapshot['obsSourceRegistration'];
        if (event.type === 'obsSourceTest.stateChanged') obsTestRef.current = event.payload as AppSnapshot['obsSourceTest'];
        setSnapshot((current) => applyEvent(current, event));
      });
      socket.addEventListener('close', () => {
        setConnected(false);
        if (!cancelled) retry = window.setTimeout(connect, 1_500);
      });
      socket.addEventListener('error', () => setConnected(false));
    };
    connect();
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      socket?.close();
      socketRef.current = null;
    };
  }, [bootstrap, management]);

  const mutate = useCallback(async (path: string, method = 'POST', body?: unknown) => {
    if (!token.current) throw new Error('操作トークンを取得できません。管理画面を再読み込みしてください。');
    const requestedRevision = lastRevision.current;
    const response = await fetch(path, {
      method,
      headers: {
        'X-CasMate-Token': token.current,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = (await response.json()) as { snapshot?: AppSnapshot; revision?: number; message?: string; code?: string };
    if (!response.ok) {
      if (result.code === 'INITIAL_SETUP_CONFLICT') await bootstrap();
      throw Object.assign(new Error(result.message ?? '操作に失敗しました。'), { code: result.code });
    }
    if (result.snapshot && (Number.isSafeInteger(result.revision) ? result.revision! >= lastRevision.current : requestedRevision === lastRevision.current)) {
      if (Number.isSafeInteger(result.revision)) lastRevision.current = result.revision!;
      setSnapshot(result.snapshot);
    }
    return result;
  }, [bootstrap]);

  const updateSettings = useCallback(
    (section: SettingsSection, value: unknown, options?: { commentFontSizePx: number }) => {
      if (section === 'character' && value && typeof value === 'object') {
        const data = value as Record<string, unknown>;
        return mutate('/api/character/options', 'PUT', { alwaysOnTop: data.alwaysOnTop, clickThrough: data.clickThrough });
      }
      if (value && typeof value === 'object' && (section === 'commentOverlay' || section === 'speechRecognitionOverlay')) {
        const data = value as Record<string, unknown>;
        const keys = section === 'commentOverlay' ? ['mode', 'stackDurationSeconds', 'singleDurationSeconds', 'stackDirection', 'showSource', 'showAuthor', 'showContent'] : ['displayDurationSeconds'];
        const payload = Object.fromEntries(keys.filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]]));
        if (section === 'commentOverlay' && options) payload.fontSizePx = options.commentFontSizePx;
        return mutate(`/api/obs-design/${section === 'commentOverlay' ? 'comments' : 'speech'}/options`, 'PUT', payload);
      }
      return mutate(`/api/settings/${section}`, 'PUT', value);
    },
    [mutate],
  );
  const sourceAction = useCallback(
    (source: ConnectionKey, action: 'start' | 'stop' | 'reconnect') => mutate(`/api/sources/${source}/${action}`),
    [mutate],
  );
  const uploadAsset = useCallback(async (
    slot: CharacterAssetSlot,
    file: File,
  ) => {
    if (!token.current) throw new Error('操作トークンを取得できません。');
    const requestedRevision = lastRevision.current;
    const response = await fetch(`/api/character/simple/assets/${slot}`, {
      method: 'POST',
      headers: { 'X-CasMate-Token': token.current, 'Content-Type': file.type },
      body: file,
    });
    const result = (await response.json()) as { snapshot?: AppSnapshot; revision?: number; message?: string };
    if (!response.ok) throw new Error(result.message ?? '素材を登録できません。');
    if (result.snapshot && (Number.isSafeInteger(result.revision) ? result.revision! >= lastRevision.current : requestedRevision === lastRevision.current)) {
      if (Number.isSafeInteger(result.revision)) lastRevision.current = result.revision!;
      setSnapshot(result.snapshot);
    }
  }, []);

  const clearAsset = useCallback(
    (slot: CharacterAssetSlot) => mutate(`/api/character/simple/assets/${slot}`, 'DELETE'),
    [mutate],
  );
  const previewCharacterMotion = useCallback(
    (motion: SimpleCharacterMotionSettings) =>
      mutate('/api/character/simple/motion-preview', 'PUT', motion),
    [mutate],
  );
  const saveCharacterMotion = useCallback(
    (motion: SimpleCharacterMotionSettings) =>
      mutate('/api/character/simple/motion', 'PUT', motion),
    [mutate],
  );

  const listSpeechVoices = useCallback(async (): Promise<VoicevoxSpeaker[]> => {
    if (!token.current) throw new Error('操作トークンを取得できません。');
    const response = await fetch('/api/speech/voices', {
      method: 'POST',
      headers: { 'X-CasMate-Token': token.current },
    });
    const result = await response.json() as { voices?: VoicevoxSpeaker[]; message?: string };
    if (!response.ok) throw new Error(result.message ?? '話者一覧を取得できません。');
    return result.voices ?? [];
  }, []);
  const reportCharacterAssetError = useCallback(() => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'character.assetError' }));
    }
  }, []);

  const smartphoneAdapters = useCallback(async (): Promise<import('../shared/direct-connection').DirectAdapterOption[]> => {
    if (!token.current) throw new Error('操作トークンを取得できません。');
    const response = await fetch('/api/management/smartphone-adapters', { cache: 'no-store', headers: { 'X-CasMate-Management': token.current } });
    const result = await response.json() as { adapters?: import('../shared/direct-connection').DirectAdapterOption[]; message?: string };
    if (!response.ok || !result.adapters) throw new Error(result.message ?? 'ネットワーク一覧を取得できません。');
    return result.adapters;
  }, []);
  const smartphoneLanAdapters = useCallback(async (): Promise<import('../shared/direct-connection').DirectAdapterOption[]> => {
    if (!token.current) throw new Error('操作トークンを取得できません。');
    const response = await fetch('/api/management/smartphone-lan-adapters', { cache: 'no-store', headers: { 'X-CasMate-Management': token.current } });
    const result = await response.json() as { adapters?: import('../shared/direct-connection').DirectAdapterOption[]; message?: string };
    if (!response.ok || !result.adapters) throw new Error(result.message ?? 'ネットワーク一覧を取得できません。');
    return result.adapters;
  }, []);
  const obsSourceContext = useCallback(async (target: ObsSourceTarget): Promise<ObsSourceContext> => {
    if (!token.current) throw new Error('操作トークンを取得できません。管理画面を再読み込みしてください。');
    const response = await fetch('/api/management/obs-sources/context?target=' + encodeURIComponent(JSON.stringify(target)), {
      cache: 'no-store', headers: { 'X-CasMate-Management': token.current },
    });
    const result = await response.json() as ObsSourceContext & { code?: string; message?: string };
    if (!response.ok) throw Object.assign(new Error(result.message ?? 'OBSのシーンとソースを取得できません。'), { code: result.code });
    return result;
  }, []);
  const obsSourceAdd = useCallback(async (request: ObsSourceAddRequest): Promise<ObsSourceOperation | null> => {
    if (!token.current) throw new Error('操作トークンを取得できません。管理画面を再読み込みしてください。');
    const response = await fetch('/api/obs-sources/add', {
      method: 'POST', cache: 'no-store',
      headers: { 'X-CasMate-Token': token.current, 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    const result = await response.json() as { operation?: ObsSourceOperation; snapshot?: AppSnapshot; revision?: number; code?: string; message?: string };
    if (!response.ok || !result.operation) throw Object.assign(new Error(result.message ?? 'OBSソースの登録を完了できません。'), { code: result.code });
    if (typeof result.revision === 'number' && Number.isFinite(result.revision) && Number.isInteger(result.revision)) {
      if (result.snapshot && result.revision >= lastRevision.current) {
        lastRevision.current = result.revision;
        obsRegistrationRef.current = result.snapshot.obsSourceRegistration;
        setSnapshot(result.snapshot);
      } else if (result.revision < lastRevision.current) {
        const latest = obsRegistrationRef.current;
        const operation = latest?.lastOperation?.id === result.operation.id ? latest.lastOperation
          : latest?.unfinishedOperations?.find(value => value.id === result.operation!.id);
        return operation ?? null;
      }
    }
    return result.operation;
  }, []);
  return {
    snapshot,
    obsSourceContextRevision,
    obsTestContext: async (request: ObsSourceTestRequest): Promise<ObsSourceTestContext> => {
      if (!token.current) throw new Error('管理画面の操作トークンを確認してください。');
      const response = await fetch('/api/management/obs-sources/test-context?request=' + encodeURIComponent(JSON.stringify(request)), {
        cache: 'no-store', headers: { 'X-CasMate-Management': token.current },
      });
      const result = await response.json() as ObsSourceTestContext;
      if (!response.ok) throw new Error(result.message ?? 'テスト可否を確認できません。');
      return result;
    },
    obsTestAction: async (action: 'start' | 'stop', body: ObsSourceTestRequest | { testId: string }): Promise<ObsSourceTestState | undefined> => {
      if (!token.current) throw new Error('管理画面の操作トークンを確認してください。');
      const response = await fetch('/api/obs-sources/test/' + action, { method: 'POST', cache: 'no-store',
        headers: { 'X-CasMate-Token': token.current, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json() as { snapshot?: AppSnapshot; revision?: number; message?: string };
      if (!response.ok) throw new Error(result.message ?? 'テスト送信の結果を確認できません。');
      if (result.snapshot && Number.isSafeInteger(result.revision) && result.revision! >= lastRevision.current) {
        lastRevision.current = result.revision!; obsTestRef.current = result.snapshot.obsSourceTest;
        obsRegistrationRef.current = result.snapshot.obsSourceRegistration; setSnapshot(result.snapshot);
      }
      return obsTestRef.current;
    },
    obsSourceContext,
    obsSourceAdd,
    smartphoneAdapters,
    smartphoneLanAdapters,
    smartphoneDirectAction: async (action: 'retry' | 'cleanup' | 'manual-confirm' | 'reset-key', body?: unknown) => {
      if (!token.current) throw new Error('操作トークンを取得できません。');
      const requestedRevision = lastRevision.current;
      const response = await fetch(`/api/smartphone/direct/${action}`, { method: 'POST', cache: 'no-store',
        headers: { 'X-CasMate-Token': token.current, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
      const result = await response.json() as { snapshot?: AppSnapshot; revision?: number; message?: string };
      if (!response.ok) throw new Error(result.message ?? '直接接続の操作を完了できません。');
      if (result.snapshot && (Number.isSafeInteger(result.revision) ? result.revision! >= lastRevision.current : requestedRevision === lastRevision.current)) {
        if (Number.isSafeInteger(result.revision)) lastRevision.current = result.revision!;
        setSnapshot(result.snapshot);
      }
      return result;
    },
    smartphoneInvitation: async (network: import('../shared/smartphone').SmartphoneNetwork) => {
      if (!token.current) throw new Error('操作トークンを取得できません。');
      const response = await fetch('/api/smartphone/invitation', {
        method: 'POST', cache: 'no-store', headers: { 'X-CasMate-Token': token.current, 'Content-Type': 'application/json' }, body: JSON.stringify({ network }),
      });
      const result = await response.json() as { invitation?: import('../shared/smartphone').SmartphoneInvitation; message?: string };
      if (!response.ok || !result.invitation) throw new Error(result.message ?? '共通QRを準備できません。');
      return result.invitation;
    },
    smartphoneObsInput: async (id: string) => {
      if (!token.current) throw new Error('操作トークンを取得できません。');
      const response = await fetch('/api/smartphone/devices/' + encodeURIComponent(id) + '/obs-input', {
        method: 'POST', cache: 'no-store', headers: { 'X-CasMate-Token': token.current, 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      });
      const result = await response.json() as { input?: string; message?: string };
      if (!response.ok || !result.input) throw new Error(result.message ?? 'OBS入力を準備できません。');
      return result.input;
    },
    connected,
    error,
    mutate,
    updateSettings,
    sourceAction,
    uploadAsset,
    clearAsset,
    previewCharacterMotion,
    saveCharacterMotion,
    listSpeechVoices,
    reportCharacterAssetError,
  };
}

function applyEvent(current: AppSnapshot | null, event: RealtimeEvent): AppSnapshot | null {
  if (!current) return current;
  switch (event.type) {
    case 'comment.received': {
      const comments = [...current.comments, event.payload as AppSnapshot['comments'][number]];
      return { ...current, comments: comments.slice(-10_000) };
    }
    case 'comment.removed': {
      const id = (event.payload as { id: string }).id;
      return { ...current, comments: current.comments.filter((comment) => comment.id !== id) };
    }
    case 'source.statusChanged': {
      const status = event.payload as AppSnapshot['sourceStatuses'][ConnectionKey];
      return {
        ...current,
        sourceStatuses: { ...current.sourceStatuses, [status.source]: status },
      };
    }
    case 'settings.changed': {
      const payload = event.payload as {
        section: SettingsSection;
        value: AppSnapshot['settings'][SettingsSection];
        settingsRevision: number;
      };
      return {
        ...current,
        settings: { ...current.settings, [payload.section]: payload.value },
        settingsRevision: payload.settingsRevision,
      };
    }
    case 'commentOverlay.stateChanged':
      return { ...current, commentOverlay: event.payload as AppSnapshot['commentOverlay'] };
    case 'character.stateChanged':
      return { ...current, character: event.payload as AppSnapshot['character'] };
    case 'commentSpeech.stateChanged':
      return { ...current, commentSpeech: event.payload as AppSnapshot['commentSpeech'] };
    case 'mobileSpeech.stateChanged':
      return { ...current, mobileSpeech: event.payload as AppSnapshot['mobileSpeech'] };
    case 'smartphone.stateChanged':
      return { ...current, smartphone: event.payload as AppSnapshot['smartphone'] };
    case 'aiListener.stateChanged':
      return { ...current, aiListener: event.payload as AppSnapshot['aiListener'] };
    case 'obsControl.stateChanged':
      return { ...current, obsControl: event.payload as AppSnapshot['obsControl'] };
    case 'obsSourceRegistration.stateChanged':
      return { ...current, obsSourceRegistration: event.payload as AppSnapshot['obsSourceRegistration'] };
    case 'obsSourceTest.stateChanged':
      return { ...current, obsSourceTest: event.payload as AppSnapshot['obsSourceTest'] };
    case 'initialSetup.stateChanged':
      return { ...current, initialSetup: event.payload as AppSnapshot['initialSetup'] };
    case 'shitarabaNextThread.stateChanged':
      return {
        ...current,
        shitarabaNextThread: event.payload as AppSnapshot['shitarabaNextThread'],
      };
    case 'speechRecognition.stateChanged':
      return {
        ...current,
        speechRecognition: event.payload as AppSnapshot['speechRecognition'],
      };
    case 'speechRecognition.resultReceived':
      // The authoritative preview history arrives with the accompanying state event.
      return current;
    case 'speechRecognitionOverlay.stateChanged':
      return {
        ...current,
        speechRecognitionOverlay: event.payload as AppSnapshot['speechRecognitionOverlay'],
      };
    case 'speechRecognitionOverlay.appearanceChanged':
      // The following settings.changed event carries the authoritative shared appearance.
      return current;
    default:
      return current;
  }
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : '不明なエラーが発生しました。';
}
