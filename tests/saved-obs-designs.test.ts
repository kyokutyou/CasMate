import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import request from 'supertest';
import { createObsDesignPreset } from '../src/shared/obs-design';
import { addSavedObsDesign, emptySavedObsDesigns, removeSavedObsDesign, validateSavedObsDesigns } from '../src/shared/saved-obs-designs';
import { createDefaultSettings } from '../src/main/core/settings';
import { readStoredSettings } from '../src/main/core/settings/stored-format';
import { AppState } from '../src/main/core/app-state';
import { createHttpApplication } from '../src/main/server/local-server';
import { readOnlySnapshot, readOnlyEvent } from '../src/main/server/local-view-projections';

const headers = { Host: '127.0.0.1:3000', Origin: 'http://127.0.0.1:3000', 'X-CasMate-Token': 'secret' };
const copy = (target: 'comments' | 'speech' = 'comments') => ({ id: randomUUID(), design: createObsDesignPreset(target, 'pastel') });

it('保存・再試行・対象分離・削除後も続く採番と既存保存形式の復元を扱う', () => {
  const first = copy();
  let library = addSavedObsDesign(emptySavedObsDesigns(), 'comments', first);
  first.design.style.fontSize = 80;
  expect(library.comments.items[0].design.style.fontSize).not.toBe(80);
  const original = { id: first.id, design: library.comments.items[0].design };
  expect(addSavedObsDesign(library, 'comments', original)).toEqual(library);
  expect(() => addSavedObsDesign(library, 'comments', first)).toThrow();
  library = addSavedObsDesign(library, 'speech', copy('speech'));
  library = removeSavedObsDesign(library, 'comments', first.id);
  expect(removeSavedObsDesign(library, 'comments', first.id)).toEqual(library);
  library = addSavedObsDesign(library, 'comments', copy());
  expect(library.comments.items.map(item => item.number)).toEqual([2]);
  expect(library.speech.items.map(item => item.number)).toEqual([1]);
  const settings = createDefaultSettings(); settings.application.obsSavedDesigns = library;
  expect(readStoredSettings(JSON.parse(JSON.stringify(settings))).settings.application.obsSavedDesigns).toEqual(library);
  expect(readStoredSettings(createDefaultSettings()).settings.application.obsSavedDesigns).toBeUndefined();
});

it('100件上限・重複番号・未知項目・対象不一致・不正な保存原本を拒否する', () => {
  let library = emptySavedObsDesigns();
  for (let i = 0; i < 100; i++) library = addSavedObsDesign(library, 'comments', copy());
  expect(() => addSavedObsDesign(library, 'comments', copy())).toThrow(/これ以上/);
  const one = library.comments.items[0];
  expect(addSavedObsDesign(library, 'comments', { id: one.id, design: one.design })).toEqual(library);
  const bad = structuredClone(library); bad.comments.items[1].number = 1;
  expect(() => validateSavedObsDesigns(bad)).toThrow();
  expect(() => validateSavedObsDesigns({ ...library, extra: true })).toThrow();
  expect(() => addSavedObsDesign(emptySavedObsDesigns(), 'speech', copy())).toThrow();
  expect(() => addSavedObsDesign(emptySavedObsDesigns(), 'comments', { ...copy(), text: '保存しない見本' })).toThrow();
  const settings = createDefaultSettings(); settings.application.obsSavedDesigns = bad;
  expect(() => readStoredSettings(settings)).toThrow();
});

it('設定更新キューで一覧・窓位置・別対象・一般設定を保持し、失敗で採番を進めない', async () => {
  const saveSettings = vi.fn(async () => undefined);
  const initial = createDefaultSettings(), state = new AppState(initial, { saveSettings });
  const first = copy(), second = copy();
  try {
    saveSettings.mockRejectedValueOnce(new Error('保存失敗'));
    await expect(state.updateSavedObsDesign('comments', 'add', first)).rejects.toThrow();
    expect(state.snapshot().settings.application.obsSavedDesigns).toBeUndefined();
    await Promise.all([
      state.updateSavedObsDesign('comments', 'add', first),
      state.updateSavedObsDesign('comments', 'add', second),
      state.updateSettings('application', { ...initial.application, managementTheme: 'pearl' }),
      state.updateSavedObsDesign('speech', 'add', copy('speech')),
      state.updateObsDesignWindowBounds({ width: 1300, height: 850 }),
    ]);
    const application = state.snapshot().settings.application;
    expect(application).toMatchObject({ managementTheme: 'pearl', obsDesignWindow: { width: 1300, height: 850 } });
    expect(application.obsSavedDesigns?.comments.items.map(item => item.number)).toEqual([1, 2]);
    expect(application.obsSavedDesigns?.speech.items).toHaveLength(1);
    const writes = saveSettings.mock.calls.length;
    await state.updateSavedObsDesign('comments', 'add', first);
    expect(saveSettings).toHaveBeenCalledTimes(writes);
    const before = state.snapshot().settings;
    saveSettings.mockRejectedValueOnce(new Error('削除失敗'));
    await expect(state.updateSavedObsDesign('comments', 'remove', first.id)).rejects.toThrow();
    expect(state.snapshot().settings).toEqual(before);
    expect(before.commentOverlay).toEqual(initial.commentOverlay);
  } finally { state.dispose(); }
});

it('管理APIを認証し、保存一覧を読取通信へ公開せず、削除と再試行を扱う', async () => {
  const state = new AppState(createDefaultSettings());
  const app = createHttpApplication({ state, port: 3000, operationToken: 'secret' });
  const value = copy();
  try {
    expect((await request(app).post('/api/obs-design/comments/saved').set('Host', headers.Host).send(value)).status).toBe(403);
    expect((await request(app).post('/api/obs-design/comments/saved').set({ ...headers, Origin: 'https://example.com' }).send(value)).status).toBe(403);
    expect((await request(app).post('/api/obs-design/comments/saved').set(headers).send(value)).status).toBe(200);
    expect((await request(app).post('/api/obs-design/comments/saved').set(headers).send(value)).status).toBe(200);
    expect((await request(app).post('/api/obs-design/speech/saved').set(headers).send(value)).status).toBe(400);
    expect((await request(app).post('/api/obs-design/bad/saved').set(headers).send(value)).status).toBe(400);
    expect(state.snapshot().settings.application.obsSavedDesigns?.comments.items).toHaveLength(1);
    expect(JSON.stringify(readOnlySnapshot(state.snapshot()))).not.toContain('obsSavedDesigns');
    expect(JSON.stringify(readOnlyEvent({ type: 'state.snapshot', revision: 1, payload: state.snapshot() }))).not.toContain('obsSavedDesigns');
    expect(JSON.stringify(readOnlyEvent({ type: 'settings.changed', revision: 2, payload: { section: 'application', value: state.snapshot().settings.application } }))).not.toContain('obsSavedDesigns');
    expect((await request(app).delete(`/api/obs-design/comments/saved/${value.id}`).set(headers)).status).toBe(200);
    expect((await request(app).delete(`/api/obs-design/comments/saved/${value.id}`).set(headers)).status).toBe(200);
    expect((await request(app).delete('/api/obs-design/comments/saved/invalid').set(headers)).status).toBe(400);
    const stopping = createHttpApplication({ state, port: 3000, operationToken: 'secret', acceptingRequests: () => false });
    expect((await request(stopping).post('/api/obs-design/comments/saved').set(headers).send(copy())).status).toBe(503);
  } finally { state.dispose(); }
});
