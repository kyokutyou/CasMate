import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import type { AppSnapshot } from '../../src/shared/types';
import { validateObsDesign } from '../../src/shared/obs-design';
import { addSavedObsDesign, emptySavedObsDesigns, removeSavedObsDesign } from '../../src/shared/saved-obs-designs';
import type { ObsSourceTarget } from '../../src/shared/obs-source-registration';
import type { ObsSourceTestRequest } from '../../src/shared/obs-source-test';
import { obsRegistrationContext } from './obs-registration-state';

const initial = JSON.parse(document.getElementById('fixture-data')!.textContent!) as AppSnapshot;
let failure = '';
let gate: Promise<void> | undefined;
let release: (() => void) | undefined;
const obsSourceContext = async (target: ObsSourceTarget) => ({ ...obsRegistrationContext(target), candidates: [{ uuid: 'test-source', name: 'テスト用OBSソース' }], presentInputUuids: ['test-source'] });
export function useApplicationState() {
  const [snapshot, setSnapshot] = useState(initial);
  useEffect(() => {
    Object.assign(window, { designHarness: {
      snapshot: () => snapshot,
      testMessage: (message: string) => flushSync(() => setSnapshot(current => ({ ...current, obsSourceTest: current.obsSourceTest ? { ...current.obsSourceTest, current: current.obsSourceTest.current ? { ...current.obsSourceTest.current, message } : null } : undefined }))),
      update: (value: Partial<AppSnapshot['settings']['application']>) => flushSync(() => setSnapshot(current => ({ ...current, settings: { ...current.settings, application: { ...current.settings.application, ...value } } }))),
      fail(message = '保存できませんでした。再保存してください。') { failure = message; },
      hold() { gate = new Promise(resolve => { release = resolve; }); },
      release() { release?.(); release = undefined; },
    } });
  }, [snapshot]);
  return { snapshot, error: null, obsSourceContext, obsSourceContextRevision: 0,
    obsTestContext: async () => ({ available: true, message: '' }),
    obsTestAction: async (action: 'start' | 'stop', body: ObsSourceTestRequest | { testId: string }) => {
      flushSync(() => setSnapshot(current => ({ ...current, obsSourceTest: action === 'start'
        ? { busy: !('target' in body && body.target.overlay === 'comments'), warnings: [], current: { ...body as ObsSourceTestRequest, id: 'layout-test', title: '表示', phase: 'target' in body && body.target.overlay === 'comments' ? 'complete' : 'sending', startedAt: Date.now(), expiresAt: Date.now() + 5000, needsAttention: false, message: 'テストコメントを1件投入しました' } }
        : { busy: false, warnings: [], current: current.obsSourceTest?.current ? { ...current.obsSourceTest.current, phase: 'complete', message: '' } : null } })));
      return undefined;
    }, mutate: async (_path: string, _method: string, value?: unknown) => {
    if (_path === '/api/comments/test') return {};
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
