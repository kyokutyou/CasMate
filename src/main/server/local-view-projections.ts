import type { AppSnapshot, RealtimeEvent, SpeechRecognitionOverlayAppearance, SpeechRecognitionOverlayRealtimeEvent, SpeechRecognitionOverlayState } from '../../shared/types';
import { speechRecognitionOverlayAppearance } from '../core/app-state';

// These projections are only for loopback clients. LAN/Tailscale use their own minimal contract.
export function readOnlySnapshot(snapshot: AppSnapshot): Record<string, unknown> {
  const sanitized = structuredClone(snapshot) as unknown as Record<string, unknown>;
  delete sanitized.shitarabaNextThread;
  delete sanitized.speechRecognition;
  delete sanitized.speechRecognitionOverlay;
  delete sanitized.smartphone;
  delete sanitized.obsControl;
  delete sanitized.obsSourceRegistration;
  delete sanitized.obsSourceTest;
  delete sanitized.aiListener;
  delete sanitized.updateNotices;
  delete sanitized.initialSetup;
  const settings = sanitized.settings as {
    application?: { managementTheme?: unknown; managementTextSize?: unknown; obsDesignWindow?: unknown; obsSavedDesigns?: unknown };
    sources?: { shitaraba?: Record<string, unknown> };
    speechRecognition?: unknown;
    speechRecognitionOverlay?: unknown;
    aiListener?: unknown;
  } | undefined;
  if (settings?.sources?.shitaraba) delete settings.sources.shitaraba.nextThread;
  if (settings?.application) {
    delete settings.application.managementTheme;
    delete settings.application.managementTextSize;
    delete settings.application.obsDesignWindow;
    delete settings.application.obsSavedDesigns;
  }
  if (settings) delete settings.speechRecognition;
  if (settings) delete settings.speechRecognitionOverlay;
  if (settings) delete settings.aiListener;
  return sanitized;
}

export function readOnlyEvent(event: RealtimeEvent): RealtimeEvent | null {
  if (event.type === 'initialSetup.stateChanged') return null;
  if (event.type === 'aiListener.stateChanged') return null;
  if (event.type === 'smartphone.stateChanged') return null;
  if (event.type === 'obsControl.stateChanged') return null;
  if (event.type === 'obsSourceRegistration.stateChanged') return null;
  if (event.type === 'obsSourceRegistration.contextInvalidated') return null;
  if (event.type === 'obsSourceTest.stateChanged') return null;
  if (event.type === 'state.snapshot') return { ...event, payload: readOnlySnapshot(event.payload as AppSnapshot) };
  if (event.type === 'shitarabaNextThread.stateChanged' ||
    event.type === 'speechRecognition.stateChanged' ||
    event.type === 'speechRecognition.resultReceived' ||
    event.type === 'speechRecognitionOverlay.stateChanged' ||
    event.type === 'speechRecognitionOverlay.appearanceChanged') return null;
  if (event.type !== 'settings.changed') return event;
  const cloned = structuredClone(event) as typeof event;
  const payload = cloned.payload as {
    section?: string;
    value?: { shitaraba?: Record<string, unknown>; managementTheme?: unknown; managementTextSize?: unknown; obsDesignWindow?: unknown; obsSavedDesigns?: unknown };
  };
  if (payload.section === 'sources' && payload.value?.shitaraba) {
    delete payload.value.shitaraba.nextThread;
  }
  if (payload.section === 'application' && payload.value) {
    delete payload.value.managementTheme;
    delete payload.value.managementTextSize;
    delete payload.value.obsDesignWindow;
    delete payload.value.obsSavedDesigns;
  }
  if (payload.section === 'speechRecognition' || payload.section === 'speechRecognitionOverlay') return null;
  if (payload.section === 'aiListener') return null;
  return cloned;
}

export function speechRecognitionOverlayBootstrap(snapshot: AppSnapshot) {
  return {
    state: structuredClone(snapshot.speechRecognitionOverlay),
    appearance: speechRecognitionOverlayAppearance(snapshot.settings.speechRecognitionOverlay),
  };
}

export function speechRecognitionOverlayEvent(
  event: RealtimeEvent,
  revision: number,
): SpeechRecognitionOverlayRealtimeEvent | null {
  if (event.type === 'speechRecognitionOverlay.stateChanged') {
    return {
      type: event.type,
      revision,
      payload: structuredClone(event.payload) as SpeechRecognitionOverlayState,
    };
  }
  if (event.type === 'speechRecognitionOverlay.appearanceChanged') {
    return {
      type: event.type,
      revision,
      payload: structuredClone(event.payload) as SpeechRecognitionOverlayAppearance,
    };
  }
  if (event.type === 'application.stopping') {
    return { type: event.type, revision, payload: null };
  }
  return null;
}
