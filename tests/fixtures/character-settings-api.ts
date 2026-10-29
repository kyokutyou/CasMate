import { useLayoutEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import type { AppSnapshot, SimpleCharacterMotionSettings } from '../../src/shared/types';

const initial = JSON.parse(document.getElementById('fixture-data')!.textContent!) as AppSnapshot;
const trace: string[] = [];
let wait: Promise<void> | undefined;
let release: ((error?: string) => void) | undefined;
window.fetch = async () => { throw new Error('Unexpected network access'); };

declare global {
  interface Window {
    characterSettingsHarness: {
      holdSave(): void; releaseSave(error?: string): void; trace(): string[];
      connection(value: boolean): void;
    };
  }
}

export function useApplicationState() {
  const [snapshot, setSnapshot] = useState(initial);
  const [connected, setConnected] = useState(true);
  useLayoutEffect(() => {
    window.characterSettingsHarness = {
      holdSave() { wait = new Promise<void>((resolve, reject) => { release = error => error ? reject(new Error(error)) : resolve(); }); },
      releaseSave(error) { release?.(error); release = undefined; },
      trace: () => [...trace],
      connection(value) { flushSync(() => setConnected(value)); },
    };
  }, []);
  return {
    snapshot, connected, error: null,
    previewCharacterMotion: async (motion: SimpleCharacterMotionSettings) => {
      trace.push('preview');
      setSnapshot(current => ({ ...current, character: { ...current.character, motion } }));
    },
    saveCharacterMotion: async (motion: SimpleCharacterMotionSettings) => {
      trace.push('save');
      const pending = wait; wait = undefined;
      if (pending) await pending;
      setSnapshot(current => ({ ...current, settingsRevision: current.settingsRevision + 1,
        settings: { ...current.settings, character: { ...current.settings.character, simple: { ...current.settings.character.simple, motion } } } }));
    },
    uploadAsset: async () => { trace.push('upload'); },
    clearAsset: async () => { trace.push('clear'); },
    reportCharacterAssetError: () => { trace.push('asset-error'); },
  };
}
