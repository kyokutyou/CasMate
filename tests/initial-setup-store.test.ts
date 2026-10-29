import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import request from 'supertest';
import { expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { InitialSetupStore, setupFingerprints } from '../src/main/core/initial-setup-store';
import { AppState } from '../src/main/core/app-state';
import { createDefaultSettings, SettingsStore } from '../src/main/core/settings';
import { createHttpApplication } from '../src/main/server/local-server';
import { readOnlyEvent, readOnlySnapshot } from '../src/main/server/local-view-projections';
import { initialSetupSteps, setupFeatures, setupProgressLabel } from '../src/shared/initial-setup';
import { obsRegistrationSnapshot, obsRegistrationOperation } from './fixtures/obs-registration-state';

async function fixture(first = true) {
  const path = join(await mkdtemp(join(tmpdir(), 'casmate-setup-')), 'initial-setup.json');
  const store = new InitialSetupStore(path, first); await store.load();
  const snapshot = obsRegistrationSnapshot();
  return { path, store, snapshot, view: () => store.view(snapshot), update: (command: object) => store.update({ revision: store.view(snapshot).revision, ...command }, () => snapshot) };
}
it('初回判定は設定不在だけで、既存設定の読込と初回設定の記録を区別する', async () => {
  const f = await fixture();
  const settings = new SettingsStore(join(f.path, '..', 'settings.json'));
  expect((await settings.load()).firstRun).toBe(true);
  await settings.save(createDefaultSettings()); expect((await settings.load()).firstRun).toBeUndefined();
  expect(f.view().autoShow).toBe(true);
  await f.update({ action: 'open' });
  const again = new InitialSetupStore(f.path, true); await again.load();
  expect(again.view(f.snapshot)).toMatchObject({ autoShow: false, started: true });
  expect((await fixture(false)).view().autoShow).toBe(false);
});
it('依存する準備を一度だけ並べ、選択だけでは通常設定を変更しない', async () => {
  const f = await fixture(); const before = structuredClone(f.snapshot);
  await f.update({ action: 'select', selected: ['aiListener', 'commentOverlay', 'smartphone'], smartphoneUses: ['speech', 'video'] });
  expect(initialSetupSteps(f.view())).toEqual(['sources', 'commentSpeech', 'smartphone', 'speechRecognition', 'obsControl', 'aiListener', 'obsDisplay']);
  expect(f.snapshot).toEqual(before);
  for (const [id] of setupFeatures) expect(initialSetupSteps({ selected: [id], smartphoneUses: ['comments'] }).length).toBeGreaterThan(0);
});
it('保存後だけ進め、同じ版の並行操作・古い操作を拒否し、中断後も復元する', async () => {
  const f = await fixture();
  const results = await Promise.allSettled([f.update({ action: 'open' }), f.update({ action: 'open' })]);
  expect(results.filter(v => v.status === 'fulfilled')).toHaveLength(1);
  await f.update({ action: 'select', selected: ['sources'], smartphoneUses: ['comments'] });
  await f.update({ action: 'move', position: 'sources' });
  await f.update({ action: 'defer', step: 'sources' });
  const restored = new InitialSetupStore(f.path, false); await restored.load();
  expect(restored.view(f.snapshot)).toMatchObject({ position: 'summary', deferred: ['sources'], selected: ['sources'] });
  await expect(f.store.update({ revision: 0, action: 'finish' }, () => f.snapshot)).rejects.toMatchObject({ conflict: true });
  await f.update({ action: 'finish' }); await f.update({ action: 'open' });
  expect(f.view()).toMatchObject({ completed: true, position: 'summary', selected: ['sources'] });
});
it('本人の確認は関連設定に結び付き、失効・未準備・古い設定での確認を区別する', async () => {
  const f = await fixture();
  await f.update({ action: 'select', selected: ['sources'], smartphoneUses: ['comments'] });
  await expect(f.update({ action: 'confirm', step: 'sources', fingerprint: f.view().fingerprints.sources })).rejects.toThrow('必要な設定');
  f.snapshot.settings.sources.twitch.channel = 'caster';
  await f.update({ action: 'confirm', step: 'sources', fingerprint: f.view().fingerprints.sources });
  expect(setupProgressLabel('sources', f.view(), f.snapshot)).toBe('前回の動作確認済み');
  f.snapshot.sourceStatuses.twitch.state = 'error';
  expect(setupProgressLabel('sources', f.view(), f.snapshot)).toBe('前回の動作確認済み');
  const old = f.view().fingerprints.sources; f.snapshot.settings.sources.twitch.channel = 'other';
  expect(setupProgressLabel('sources', f.view(), f.snapshot)).toBe('設定済み・動作未確認');
  await expect(f.update({ action: 'confirm', step: 'sources', fingerprint: old })).rejects.toMatchObject({ conflict: true });
  const bytes = await readFile(f.path, 'utf8'); expect(bytes).not.toContain('caster'); expect(bytes).not.toContain('other');
});
it('進行保存失敗は版と位置を変更せず、読込失敗では原本を保全して通常機能を使える', async () => {
  const f = await fixture(); const write = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined);
  const store = new InitialSetupStore(f.path, true, write); await store.load();
  await expect(store.update({ revision: 0, action: 'open' }, () => f.snapshot)).rejects.toThrow('保存できません');
  expect(store.view(f.snapshot)).toMatchObject({ revision: 0, autoShow: true });
  await store.update({ revision: 0, action: 'open' }, () => f.snapshot);
  expect(store.view(f.snapshot).revision).toBe(1);
  await writeFile(f.path, '{broken'); await store.load();
  expect(store.view(f.snapshot)).toMatchObject({ autoShow: false, warning: expect.any(String) });
  await expect(store.update({ revision: 1, action: 'finish' }, () => f.snapshot)).rejects.toThrow('原本');
  expect(await readFile(f.path, 'utf8')).toBe('{broken');
});
it('本人確認の取消は記録だけを保存し、設定と段階を変えず再読込後も維持する', async () => {
  const f = await fixture();
  f.snapshot.settings.sources.twitch.channel = 'caster';
  await f.update({ action: 'select', selected: ['sources'], smartphoneUses: [] });
  await f.update({ action: 'move', position: 'sources' });
  await f.update({ action: 'confirm', step: 'sources', fingerprint: f.view().fingerprints.sources });
  const snapshot = structuredClone(f.snapshot);
  const revision = f.view().revision;
  await f.update({ action: 'unconfirm', step: 'sources' });
  expect(f.view()).toMatchObject({ position: 'sources', confirmations: {}, revision: revision + 1, deferred: [] });
  expect(f.snapshot).toEqual(snapshot);
  const restored = new InitialSetupStore(f.path, false); await restored.load();
  expect(restored.view(f.snapshot)).toMatchObject({ position: 'sources', confirmations: {} });
  await expect(f.store.update({ revision, action: 'unconfirm', step: 'sources' }, () => f.snapshot)).rejects.toMatchObject({ conflict: true });
  await expect(f.update({ action: 'unconfirm', step: 'commentSpeech' })).rejects.toThrow('選んだ機能');
});
it('本人確認の取消に失敗したら記録を維持し、同じ版で再試行できる', async () => {
  const f = await fixture();
  await f.update({ action: 'select', selected: ['commentOverlay'], smartphoneUses: [] });
  await f.update({ action: 'confirm', step: 'obsDisplay', fingerprint: f.view().fingerprints.obsDisplay });
  const write = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined);
  const store = new InitialSetupStore(f.path, false, write); await store.load();
  const before = store.view(f.snapshot);
  const command = { revision: before.revision, action: 'unconfirm', step: 'obsDisplay' };
  await expect(store.update(command, () => f.snapshot)).rejects.toThrow('保存できません');
  expect(store.view(f.snapshot)).toEqual(before);
  await store.update(command, () => f.snapshot);
  expect(store.view(f.snapshot).confirmations.obsDisplay).toBeUndefined();
});
it('管理APIは認証・形式・競合を検証し、公開snapshotとイベントから記録を除く', async () => {
  const f = await fixture(); const state = new AppState(createDefaultSettings(), { initialSetup: f.store });
  const app = createHttpApplication({ state, port: 3000, operationToken: 'secret' });
  const headers = { Host: '127.0.0.1:3000', Origin: 'http://127.0.0.1:3000', 'X-CasMate-Token': 'secret' };
  try {
    const call = (body: unknown) => request(app).post('/api/management/initial-setup').set(headers).send(body);
    expect((await request(app).post('/api/management/initial-setup').set('Host', headers.Host).send({ revision: 0, action: 'open' })).status).toBe(403);
    expect((await call({ revision: 0, action: 'select', selected: ['invented'], smartphoneUses: [] })).status).toBe(400);
    const ok = await call({ revision: 0, action: 'open' }); expect(ok.status).toBe(200); expect(ok.headers['cache-control']).toBe('no-store');
    expect(ok.body.snapshot.initialSetup.autoShow).toBe(false);
    const conflict = await call({ revision: 0, action: 'finish' }); expect(conflict.status).toBe(409);
    expect(readOnlySnapshot(state.snapshot())).not.toHaveProperty('initialSetup');
    expect(readOnlyEvent(state.snapshotEvent())?.payload).not.toHaveProperty('initialSetup');
  } finally { await state.shutdown(); }
});
it('確認取消APIは管理認証・形式・選択済み手順・競合を検証し、取消を公開面へ出さない', async () => {
  const f = await fixture();
  await f.update({ action: 'select', selected: ['commentOverlay'], smartphoneUses: [] });
  const state = new AppState(createDefaultSettings(), { initialSetup: f.store });
  const app = createHttpApplication({ state, port: 3000, operationToken: 'test-operation' });
  const headers = { Host: '127.0.0.1:3000', Origin: 'http://127.0.0.1:3000', 'X-CasMate-Token': 'test-operation' };
  const call = (body: unknown) => request(app).post('/api/management/initial-setup').set(headers).send(body);
  try {
    const view = state.snapshot().initialSetup!;
    expect((await call({ revision: view.revision, action: 'confirm', step: 'obsDisplay', fingerprint: view.fingerprints.obsDisplay })).status).toBe(200);
    const command = { revision: state.snapshot().initialSetup!.revision, action: 'unconfirm', step: 'obsDisplay' };
    expect((await request(app).post('/api/management/initial-setup').set('Host', headers.Host).set('Origin', headers.Origin).send(command)).status).toBe(403);
    expect((await call({ ...command, extra: true })).status).toBe(400);
    expect((await call({ ...command, step: 'unknown' })).status).toBe(400);
    expect((await call({ ...command, step: 'character' })).status).toBe(400);
    const settings = structuredClone(state.snapshot().settings);
    const ok = await call(command); expect(ok.status).toBe(200); expect(ok.headers['cache-control']).toBe('no-store');
    expect(ok.body.snapshot.initialSetup.confirmations.obsDisplay).toBeUndefined();
    expect(state.snapshot().settings).toEqual(settings);
    expect((await call(command)).status).toBe(409);
    expect(readOnlySnapshot(state.snapshot())).not.toHaveProperty('initialSetup');
    expect(readOnlyEvent(state.snapshotEvent())?.payload).not.toHaveProperty('initialSetup');
  } finally { await state.shutdown(); }
});
it('OBS登録先・稼働ポート・資格の変更は確認を失効し、ウィンドウ位置の変更では失効しない', async () => {
  const f = await fixture();
  const previous = f.view().fingerprints;
  f.snapshot.obsSourceRegistration!.lastOperation = obsRegistrationOperation();
  expect(f.view().fingerprints.obsDisplay).not.toBe(previous.obsDisplay);
  const firstScene = f.view().fingerprints.obsDisplay;
  f.snapshot.obsSourceRegistration!.lastOperation!.sceneUuid = 'other-scene';
  expect(f.view().fingerprints.obsDisplay).not.toBe(firstScene);
  const beforePort = f.view().fingerprints.obsDisplay; f.snapshot.settings.application.port++;
  expect(f.view().fingerprints.obsDisplay).not.toBe(beforePort);
  f.snapshot.settings.character.windowBounds.width++;
  expect(f.view().fingerprints.character).toBe(previous.character);
  let obs = 'credential-1'; let port = 3000;
  const privateStore = new InitialSetupStore(f.path, false, undefined, () => ({ obs, port }));
  const initial = privateStore.view(f.snapshot).fingerprints;
  obs = 'credential-2'; expect(privateStore.view(f.snapshot).fingerprints.obsControl).not.toBe(initial.obsControl);
  const pending = privateStore.view(f.snapshot).fingerprints.obsDisplay; port = 4000;
  expect(privateStore.view(f.snapshot).fingerprints.obsDisplay).not.toBe(pending);
});
it('確認識別値の状態更新では10,000件の履歴snapshotを作らず、通常snapshotと同じ値を通知する', async () => {
  const f = await fixture(); const state = new AppState(createDefaultSettings(), { initialSetup: f.store });
  const events: import('../src/shared/types').RealtimeEvent[] = [];
  state.subscribe(event => { if (event.type === 'initialSetup.stateChanged') events.push(event); });
  try {
    for (let i = 0; i < 10_000; i++) state.acceptComment({ source: 'youtube', externalId: String(i), authorName: '視聴者',
      content: [{ type: 'text', text: '履歴の本文' }], initialHistory: true });
    const snapshot = vi.spyOn(state, 'snapshot');
    state.setObsControlState(f.snapshot.obsControl!);
    expect(snapshot).not.toHaveBeenCalled();
    snapshot.mockRestore();
    expect(events.at(-1)?.payload).toEqual(state.snapshot().initialSetup);
    expect(state.snapshot().comments).toHaveLength(10_000);
  } finally { await state.shutdown(); }
});

it('関連設定の変更は最新の確認識別値を管理イベントで同期し、公開イベントには流さない', async () => {
  const f = await fixture(); const state = new AppState(createDefaultSettings(), { initialSetup: f.store });
  const events: import('../src/shared/types').RealtimeEvent[] = []; const unsubscribe = state.subscribe(event => events.push(event));
  try {
    const previous = state.snapshot().initialSetup!.fingerprints.sources;
    await state.updateSettings('sources', { ...state.snapshot().settings.sources, twitch: { enabled: false, channel: 'new-target' } });
    const updated = events.findLast(e => e.type === 'initialSetup.stateChanged');
    expect(updated).toBeDefined(); expect((updated!.payload as import('../src/shared/initial-setup').InitialSetupView).fingerprints.sources).not.toBe(previous);
    expect(readOnlyEvent(updated!)).toBeNull();
    expect(events.map(e => e.revision)).toEqual([...events.map(e => e.revision)].sort((a, b) => a - b));
  } finally { unsubscribe(); await state.shutdown(); }
});
it('選択したOBS表示の追加とVOICEVOX起動先の変更は、本人の確認を失効させる', async () => {
  const f = await fixture();
  await f.update({ action: 'select', selected: ['commentOverlay'], smartphoneUses: ['comments'] });
  await f.update({ action: 'confirm', step: 'obsDisplay', fingerprint: f.view().fingerprints.obsDisplay });
  expect(setupProgressLabel('obsDisplay', f.view(), f.snapshot)).toBe('前回の動作確認済み');
  await f.update({ action: 'select', selected: ['commentOverlay', 'character'], smartphoneUses: ['comments'] });
  expect(setupProgressLabel('obsDisplay', f.view(), f.snapshot)).not.toBe('前回の動作確認済み');
  let voicevox = 'private-engine-1';
  const store = new InitialSetupStore(f.path, false, undefined, () => ({ voicevox }));
  const before = store.view(f.snapshot).fingerprints.commentSpeech; voicevox = 'private-engine-2';
  expect(store.view(f.snapshot).fingerprints.commentSpeech).not.toBe(before);
  expect(JSON.stringify(store.view(f.snapshot))).not.toContain('private-engine');
});

it('旧版の映像・マイク確認記録は再確認を求め、スマホの登録や選択を保持する', async () => {
  const f = await fixture();
  await f.update({ action: 'select', selected: ['smartphone'], smartphoneUses: ['video'] });
  const oldFingerprint = createHash('sha256').update(JSON.stringify([setupFingerprints(f.snapshot).smartphone, ['video']])).digest('hex');
  const record = JSON.parse(await readFile(f.path, 'utf8'));
  record.confirmations.smartphone = oldFingerprint;
  await writeFile(f.path, JSON.stringify(record));
  const reloaded = new InitialSetupStore(f.path, false); await reloaded.load();
  const view = reloaded.view(f.snapshot);
  expect(view.confirmations.smartphone).not.toBe(view.fingerprints.smartphone);
  expect(view.smartphoneUses).toEqual(['video']); expect(f.snapshot.smartphone!.devices).toHaveLength(1);
});

it('コメントを使う機能は共通接続を先頭に一度だけ追加し、映像受信だけならOBSを要求しない', () => {
  for (const feature of ['commentSpeech', 'commentOverlay', 'textEffects'] as const) {
    const steps = initialSetupSteps({ selected: [feature], smartphoneUses: [] });
    expect(steps[0]).toBe('sources'); expect(steps.filter(step => step === 'sources')).toHaveLength(1);
  }
  expect(initialSetupSteps({ selected: ['smartphone'], smartphoneUses: ['video'] })).toEqual(['smartphone']);
  expect(initialSetupSteps({ selected: ['smartphone'], smartphoneUses: ['speech'] })).toEqual(['sources', 'commentSpeech', 'smartphone']);
  expect(initialSetupSteps({ selected: ['smartphone', 'character'], smartphoneUses: ['video'] })).toEqual(['smartphone', 'obsControl', 'character', 'obsDisplay']);
});
it('不要になったOBS段階から再開しても設定・用途・確認記録を保持して機能選択へ戻る', async () => {
  const f = await fixture();
  const record = { ...f.view(), position: 'obsControl', selected: ['smartphone'], smartphoneUses: ['video'] };
  const saved = { ...record } as Partial<typeof record>;
  delete saved.fingerprints;
  await writeFile(f.path, JSON.stringify(saved));
  const restored = new InitialSetupStore(f.path, false); await restored.load();
  expect(restored.view(f.snapshot)).toMatchObject({ position: 'features', selected: ['smartphone'], smartphoneUses: ['video'], confirmations: saved.confirmations });
});
