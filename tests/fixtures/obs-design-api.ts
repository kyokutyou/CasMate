import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import type { AppSnapshot } from '../../src/shared/types';
import { validateObsDesign } from '../../src/shared/obs-design';
import { addSavedObsDesign, emptySavedObsDesigns, removeSavedObsDesign } from '../../src/shared/saved-obs-designs';

const initial = JSON.parse(document.getElementById('fixture-data')!.textContent!) as AppSnapshot;
let failure = '';
let gate: Promise<void> | undefined;
let release: (() => void) | undefined;
export function useApplicationState() {
  const [snapshot, setSnapshot] = useState(initial);
  useEffect(() => {
    Object.assign(window, { designHarness: {
      snapshot: () => snapshot,
      update: (value: Partial<AppSnapshot['settings']['application']>) => flushSync(() => setSnapshot(current => ({ ...current, settings: { ...current.settings, application: { ...current.settings.application, ...value } } }))),
      fail(message = '保存できませんでした。再保存してください。') { failure = message; },
      hold() { gate = new Promise(resolve => { release = resolve; }); },
      release() { release?.(); release = undefined; },
    } });
  }, [snapshot]);
  return { snapshot, error: null, mutate: async (_path: string, _method: string, value?: unknown) => {
    const waiting = gate; gate = undefined;
    if (waiting) await waiting;
    if (failure) { const message = failure; failure = ''; throw new Error(message); }
    const section = _path.includes('comments') ? 'commentOverlay' : 'speechRecognitionOverlay';
    const target = section === 'commentOverlay' ? 'comments' : 'speech';
    flushSync(() => setSnapshot(current => {
      const settings = _path.includes('/saved')
        ? { ...current.settings, application: { ...current.settings.application, obsSavedDesigns: _method === 'POST' ? addSavedObsDesign(current.settings.application.obsSavedDesigns ?? emptySavedObsDesigns(), target, value) : removeSavedObsDesign(current.settings.application.obsSavedDesigns ?? emptySavedObsDesigns(), target, _path.split('/').at(-1)) } }
        : { ...current.settings, [section]: { ...current.settings[section], design: validateObsDesign(target, value) } };
      return { ...current, settingsRevision: current.settingsRevision + 1, settings };
    }));
    return {};
  } };
}
