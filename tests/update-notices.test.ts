import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import request from 'supertest';
import { UpdateNoticeStore } from '../src/main/core/update-notice-store';
import { AppState } from '../src/main/core/app-state';
import { createDefaultSettings } from '../src/main/core/settings';
import { createHttpApplication } from '../src/main/server/local-server';
import { readOnlyEvent } from '../src/main/server/local-view-projections';
import { compatibilityNotice, replaceRetiredBytes } from '../src/main/core/compatibility-storage';
import type { RealtimeEvent } from '../src/shared/types';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'casmate-update-notice-'));
  const path = join(root, 'update-notices.json');
  const messages = { settings: '設定を確認してください。', obsControl: '旧OBS操作登録を退避しました。', smartphone: '受信方式を更新しました。共通QRで再登録してください。' };
  const create = () => new UpdateNoticeStore(path, { settings: () => messages.settings, obsControl: () => messages.obsControl, smartphone: () => messages.smartphone });
  const store = create(); await store.load(); return { root, path, messages, create, store };
}

it('3件の案内の確認済みを再起動後も保持し、新しい案内は再表示する', async () => {
  const { store, create, messages } = await fixture();
  expect(store.pending()).toHaveLength(3);
  const smartphone = store.pending().find(notice => notice.source === 'smartphone')!;
  await store.acknowledge(smartphone.id);
  expect(store.pending().map(notice => notice.source)).toEqual(['settings', 'obsControl']);
  const restarted = create(); await restarted.load(); expect(restarted.pending()).toEqual(store.pending());
  messages.smartphone += ' 新しい登録方式の案内です。'; expect(restarted.pending()).toHaveLength(3);
  await expect(restarted.acknowledge('0'.repeat(64))).rejects.toThrow('現在の更新案内');
});

it('同時確認と同じ案内の再試行で確認記録を失わない', async () => {
  const { store, create, path } = await fixture(); const ids = store.pending().map(notice => notice.id);
  await Promise.all([...ids, ids[0]].map(id => store.acknowledge(id)));
  const restarted = create(); await restarted.load(); expect(restarted.pending()).toEqual([]);
  const record = JSON.parse(await readFile(path, 'utf8')); expect(record.acknowledged).toEqual(ids);
  expect(Object.keys(record)).toEqual(['version', 'acknowledged']);
});

it('確認記録の保存失敗では案内を残し、復旧後に再試行できる', async () => {
  const { store, root } = await fixture(); const id = store.pending()[0].id;
  await mkdir(join(root, 'blocked'));
  const blocked = new UpdateNoticeStore(join(root, 'blocked'), { settings: () => '設定を確認してください。', obsControl: () => null, smartphone: () => null });
  await expect(blocked.acknowledge(id)).rejects.toThrow('保存できません');
  expect(blocked.pending()).toHaveLength(1);
  await store.acknowledge(id); expect(store.pending()).toHaveLength(2);
});

it('壊れた確認記録は全案内を未確認とし、記録を上書きしない', async () => {
  const { create, path } = await fixture(); await writeFile(path, '{broken');
  const store = create(); await store.load(); expect(store.warning).toContain('読み込めません');
  expect(store.pending()).toHaveLength(3);
  await expect(store.acknowledge(store.pending()[0].id)).rejects.toThrow('読み込めません');
  expect(await readFile(path, 'utf8')).toBe('{broken');
});

it('確認済みでも元設定・退避・進行記録を保全し、退避の破損を隠さない', async () => {
  const { root, path } = await fixture(); const file = join(root, 'settings.json');
  const backup = await replaceRetiredBytes(file, Buffer.from('old'), Buffer.from('current'), '旧設定を退避しました。');
  const notice = await compatibilityNotice(file); const journal = await readFile(file + '.compatibility-reset.json');
  const store = new UpdateNoticeStore(path, { settings: () => notice, obsControl: () => null, smartphone: () => null }); await store.load();
  await store.acknowledge(store.pending()[0].id);
  expect(await readFile(file, 'utf8')).toBe('current'); expect(await readFile(backup, 'utf8')).toBe('old');
  expect(await readFile(file + '.compatibility-reset.json')).toEqual(journal);
  await writeFile(backup, 'corrupt'); await expect(compatibilityNotice(file)).rejects.toThrow('退避データ');
});

it('管理認証だけが確認でき、管理snapshotとWSを更新し通常の警告は保持する', async () => {
  const { store } = await fixture(); const state = new AppState(createDefaultSettings(), { updateNotices: store, warning: '現在の障害です。' });
  const app = createHttpApplication({ state, port: 3000, operationToken: 'secret' });
  const events: RealtimeEvent[] = []; const unsubscribe = state.subscribe(event => events.push(event));
  const id = store.pending()[0].id;
  const post = (token = 'secret', origin = 'http://127.0.0.1:3000', host = '127.0.0.1:3000') => request(app)
    .post('/api/management/update-notices/acknowledge').set('Host', host).set('Origin', origin).set('X-CasMate-Token', token);
  try {
    expect((await post('wrong').send({ id })).status).toBe(403);
    expect((await post('secret', 'http://evil.test').send({ id })).status).toBe(403);
    expect((await post('secret', 'http://127.0.0.1:3000', '192.168.1.1:3000').send({ id })).status).toBe(403);
    expect((await post().send({ id, message: 'arbitrary' })).status).toBe(400);
    const stale = await post().send({ id: '0'.repeat(64) });
    expect(stale.status).toBe(400); expect(stale.body.code).toBe('UPDATE_NOTICE_ACKNOWLEDGEMENT_FAILED');
    expect(stale.body.message).toContain('現在の更新案内'); expect(stale.headers['cache-control']).toBe('no-store');
    const publicView = await request(app).get('/api/bootstrap').set('Host', '127.0.0.1:3000');
    expect(publicView.body.snapshot).not.toHaveProperty('updateNotices');
    expect((await post().send({ id })).headers['cache-control']).toBe('no-store');
    expect(state.snapshot().updateNotices).toHaveLength(2); expect(state.snapshot().warning).toBe('現在の障害です。');
    const event = events.find(event => event.type === 'state.snapshot')!;
    expect(event.payload.updateNotices).toHaveLength(2); expect(readOnlyEvent(event)?.payload).not.toHaveProperty('updateNotices');
  } finally { unsubscribe(); await state.shutdown(); }
});

it('管理APIの保存失敗は具体的な再試行案内を返し、確認状態を進めない', async () => {
  const { root, messages } = await fixture(); const path = join(root, 'blocked'); await mkdir(path);
  const store = new UpdateNoticeStore(path, { settings: () => messages.settings, obsControl: () => null, smartphone: () => null });
  const state = new AppState(createDefaultSettings(), { updateNotices: store });
  const app = createHttpApplication({ state, port: 3000, operationToken: 'secret' });
  try {
    const result = await request(app).post('/api/management/update-notices/acknowledge')
      .set('Host', '127.0.0.1:3000').set('Origin', 'http://127.0.0.1:3000').set('X-CasMate-Token', 'secret').send({ id: store.pending()[0].id });
    expect(result.status).toBe(400); expect(result.body.message).toContain('保存できませんでした');
    expect(state.snapshot().updateNotices).toHaveLength(1);
  } finally { await state.shutdown(); }
});
