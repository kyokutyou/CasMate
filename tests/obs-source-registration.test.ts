import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ObsSourceRequestRejected } from '../src/main/obs/obs-control-controller';
import { obsOverlayDefinitions } from '../src/shared/obs-source-registration';
import { sourceSetup, deviceId, firstScene, secondScene, defaultTransform } from './fixtures/obs-source-registration';
import type { SmartphoneNetwork } from '../src/shared/smartphone';

const url = 'http://127.0.0.1:3100/overlay/comments';
function writes(obs: ReturnType<typeof sourceSetup>['obs']) { return obs.calls.filter(call => /^(Create|Set|Remove)/.test(call.type)); }

describe('OBSソース登録', () => {
  it('現在のシーンの所属を再取得し、別シーンだけの共有入力を追加済みと判定しない', async () => {
    const { obs, controller, target, add } = sourceSetup();
    const created = await add();
    const inputUuid = created.inputUuid!;
    expect(await controller.context(target)).toMatchObject({ presentInputUuids: [inputUuid] });
    obs.item(secondScene, inputUuid);
    obs.scene(firstScene).items = [];
    expect(await controller.context(target)).toMatchObject({ presentInputUuids: [], candidates: [{ uuid: inputUuid }] });
    obs.currentScene = secondScene;
    expect(await controller.context(target)).toMatchObject({ presentInputUuids: [inputUuid] });
  });
  it.each(Object.entries(obsOverlayDefinitions))('正式URLと基本キャンバスで%s表示を新規作成し保存値を確認する', async (overlay, definition) => {
    const { controller, obs, states } = sourceSetup();
    const operation = await controller.add({ target: { kind: 'overlay', overlay }, collection: obs.collection, sceneUuid: firstScene });
    expect(operation).toMatchObject({ status: 'succeeded', result: 'created', phase: 'complete' });
    expect(obs.inputs[0]).toMatchObject({ kind: 'browser_source',
      settings: { url: 'http://127.0.0.1:3100' + definition.path, width: 1920, height: 1080, is_local_file: false } });
    expect(obs.scene(firstScene).items[0].transform).toMatchObject({ positionX: 960, positionY: 540, boundsWidth: 1920,
      boundsHeight: 1080, boundsType: 'OBS_BOUNDS_SCALE_INNER', scaleX: 1, scaleY: 1, alignment: 0 });
    expect(states.some(state => state.busy && state.lastOperation?.phase === 'verifying')).toBe(true);
    expect(states.at(-1)).toMatchObject({ busy: false, lastOperation: { status: 'succeeded' } });
    expect(obs.occupied).toBe(false);
    expect(writes(obs).map(call => call.type)).toEqual(['CreateInput', 'SetSceneItemTransform']);
  });

  it.each(['lan', 'tailscale', 'direct'] satisfies SmartphoneNetwork[])('送信前の%sメディアを固定入力・mpegts・非seekableで作成できる', async network => {
    const { controller, obs, phone } = sourceSetup();
    phone.settings.activeNetwork = network;
    phone.devices[0].obsLocalPort = 13001;
    const target = { kind: 'smartphone', deviceId };
    expect((await controller.context(target)).title).toContain('スマホA');
    expect(await controller.add({ target, collection: obs.collection, sceneUuid: firstScene })).toMatchObject({ status: 'succeeded' });
    expect(obs.inputs[0].settings).toMatchObject({ input: 'udp://127.0.0.1:13001?localaddr=127.0.0.1&fifo_size=1024&overrun_nonfatal=1',
      is_local_file: false, input_format: 'mpegts', seekable: false, close_when_inactive: false });
    expect(obs.scene(firstScene).items[0].transform).toMatchObject({ boundsType: 'OBS_BOUNDS_SCALE_INNER', scaleX: 1, scaleY: 1 });
  });

  it('端末別入力を区別し、OFF・未登録経路でも再利用し、共通入力未割当と削除を拒否する', async () => {
    const { controller, obs, phone } = sourceSetup();
    for (const device of phone.devices) {
      expect(await controller.add({ target: { kind: 'smartphone', deviceId: device.id },
        collection: obs.collection, sceneUuid: firstScene })).toMatchObject({ status: 'succeeded' });
    }
    expect(obs.inputs.map(input => input.settings.input)).toHaveLength(2);
    expect(obs.inputs[0].settings.input).not.toBe(obs.inputs[1].settings.input);
    phone.settings.activeNetwork = null;
    const target = { kind: 'smartphone', deviceId };
    expect((await controller.context(target)).candidates).toHaveLength(1);
    phone.settings.activeNetwork = 'tailscale'; phone.devices[0].profiles.tailscale.registered = false;
    expect(await controller.add({ target, collection: obs.collection, sceneUuid: firstScene }))
      .toMatchObject({ status: 'succeeded', result: 'alreadyPresent' });
    delete phone.devices[0].obsLocalPort;
    await expect(controller.context(target)).rejects.toMatchObject({ code: 'OBS_SOURCE_TARGET_UNAVAILABLE' });
    phone.devices.shift();
    await expect(controller.add({ target, collection: obs.collection, sceneUuid: firstScene }))
      .rejects.toMatchObject({ code: 'OBS_SOURCE_TARGET_UNAVAILABLE' });
  });

  it('全経路・OFF・登録更新を通じて同じソースを再利用し、別シーンでも共通入力を共有する', async () => {
    const { controller, obs, phone } = sourceSetup(); const target = { kind: 'smartphone', deviceId };
    const created = await controller.add({ target, collection: obs.collection, sceneUuid: firstScene });
    for (const network of ['tailscale', 'direct', null, 'lan'] as const) {
      phone.settings.activeNetwork = network; phone.devices[0].profiles.lan.revision += 1;
      expect(await controller.add({ target, collection: obs.collection, sceneUuid: firstScene }))
        .toMatchObject({ status: 'succeeded', result: 'alreadyPresent', inputUuid: created.inputUuid });
    }
    obs.currentScene = secondScene;
    expect(await controller.add({ target, collection: obs.collection, sceneUuid: secondScene }))
      .toMatchObject({ status: 'succeeded', result: 'reused', inputUuid: created.inputUuid });
    expect(obs.inputs).toHaveLength(1);
  });

  it('登録中の経路切替やOFFでは配置を中断せず、旧経路別ソースは変更しない', async () => {
    const { controller, obs, phone } = sourceSetup(); const target = { kind: 'smartphone', deviceId };
    const old = obs.input('ffmpeg_source', { input: 'udp://127.0.0.1:10003?localaddr=127.0.0.1&fifo_size=1024&overrun_nonfatal=1',
      is_local_file: false, input_format: 'mpegts', seekable: false }, '旧Tailscale');
    const before = structuredClone(old);
    obs.intercept = async type => { if (type === 'GetSceneItemTransform') { phone.settings.activeNetwork = null; phone.devices[0].profiles.lan.revision += 1; } };
    expect(await controller.add({ target, collection: obs.collection, sceneUuid: firstScene }))
      .toMatchObject({ status: 'succeeded', result: 'created' });
    expect(obs.inputs).toHaveLength(2); expect(old).toEqual(before);
    await expect(controller.context({ ...target, network: 'lan' })).rejects.toMatchObject({ code: 'OBS_SOURCE_INVALID_REQUEST' });
  });

  it('共有入力の項目だけを削除した場合はテスト不可理由を示し、明示的な追加で同じ入力を使う', async () => {
    const { obs, add, controller, target } = sourceSetup();
    const created = await add();
    const inputUuid = created.inputUuid!;
    const shared = obs.item(secondScene, inputUuid, { enabled: false, transform: { ...defaultTransform, positionX: 42 } });
    const before = structuredClone(shared);
    obs.scene(firstScene).items = [];
    obs.calls = [];
    expect((await controller.context(target)).candidates.map(input => input.uuid)).toEqual([inputUuid]);
    await expect(controller.validateDisplayTest({ target, collection: obs.collection, sceneUuid: firstScene, inputUuid }))
      .rejects.toMatchObject({ code: 'OBS_TEST_NOT_IN_SCENE' });
    expect(writes(obs)).toEqual([]);
    expect(await add({ inputUuid })).toMatchObject({ status: 'succeeded', result: 'reused', inputUuid });
    expect(obs.inputs).toHaveLength(1); expect(shared).toEqual(before);
  });

  it('手動ブラウザ入力を共有し、そのviewportと既存項目の配置・非表示を保持する', async () => {
    const { obs, add } = sourceSetup();
    const input = obs.input('browser_source', { url, width: 800, height: 600 });
    const old = obs.item(secondScene, input.uuid, { enabled: false, transform: { ...defaultTransform, positionX: 42, scaleX: 2 } });
    const before = structuredClone({ input, old });
    expect(await add()).toMatchObject({ status: 'succeeded', result: 'reused', inputUuid: input.uuid });
    expect({ input, old }).toEqual(before);
    expect(obs.inputs).toHaveLength(1);
    expect(obs.scene(firstScene).items[0].transform.boundsType).toBe('OBS_BOUNDS_SCALE_INNER');
    expect(writes(obs).map(call => call.type)).toEqual(['CreateSceneItem', 'SetSceneItemTransform']);
  });

  it('既定設定と未登録キーの実効値を重ねて手動メディアを再利用する', async () => {
    const { controller, obs } = sourceSetup();
    const input = obs.input('ffmpeg_source', { input: 'udp://127.0.0.1:10001?localaddr=127.0.0.1&fifo_size=1024&overrun_nonfatal=1', is_local_file: false });
    expect(await controller.add({ target: { kind: 'smartphone', deviceId }, collection: obs.collection,
      sceneUuid: firstScene })).toMatchObject({ status: 'succeeded', result: 'reused', inputUuid: input.uuid });
    expect(input.settings.seekable).toBeUndefined();
    expect(obs.inputs).toHaveLength(1);
  });

  it.each([{ is_local_file: true }, { seekable: true, is_local_file: false }, { input_format: 'mp4', is_local_file: false }])(
    '同一入力の不適合メディアを修正・重複作成しない %j', async settings => {
      const { controller, obs } = sourceSetup();
      const input = obs.input('ffmpeg_source', {
        input: 'udp://127.0.0.1:10001?localaddr=127.0.0.1&fifo_size=1024&overrun_nonfatal=1', ...settings,
      });
      const before = structuredClone(input);
      const target = { kind: 'smartphone', deviceId };
      expect((await controller.context(target)).incompatible).toHaveLength(1);
      expect(await controller.add({ target, collection: obs.collection, sceneUuid: firstScene }))
        .toMatchObject({ status: 'failed', errorCode: 'OBS_SOURCE_INCOMPATIBLE' });
      expect(input).toEqual(before); expect(writes(obs)).toEqual([]);
    });

  it('複数の適合候補は利用者のUUID選択を要求し、無関係なUUIDを受理しない', async () => {
    const { obs, controller, target, add } = sourceSetup();
    const a = obs.input('browser_source', { url }, 'A');
    const b = obs.input('browser_source', { url }, 'B');
    const other = obs.input('browser_source', { url: 'https://example.com' });
    expect((await controller.context(target)).candidates.map(input => input.uuid)).toEqual([a.uuid, b.uuid]);
    expect(await add()).toMatchObject({ status: 'failed', errorCode: 'OBS_SOURCE_SELECTION_REQUIRED' });
    expect(await add({ inputUuid: other.uuid })).toMatchObject({ status: 'failed', errorCode: 'OBS_SOURCE_INVALID_REQUEST' });
    expect(writes(obs)).toEqual([]);
    expect(await add({ inputUuid: b.uuid })).toMatchObject({ status: 'succeeded', inputUuid: b.uuid, result: 'reused' });
  });

  it.each([false, true])('非表示のグループ／入れ子シーン内を探索し重複追加しない（group=%s）', async group => {
    const { obs, add, controller, target } = sourceSetup();
    const input = obs.input('browser_source', { url });
    const nestedUuid = randomUUID();
    obs.scenes.push({ uuid: nestedUuid, name: '入れ子', group, items: [] });
    obs.item(firstScene, nestedUuid, { group, nested: !group, enabled: false });
    const nested = obs.item(nestedUuid, input.uuid, { enabled: false, transform: { ...defaultTransform, positionY: 55 } });
    const before = structuredClone(nested);
    expect(await controller.context(target)).toMatchObject({ presentInputUuids: [input.uuid] });
    expect(writes(obs)).toEqual([]);
    expect(await add()).toMatchObject({ status: 'succeeded', result: 'alreadyPresent' });
    expect(nested).toEqual(before);
    expect(writes(obs)).toEqual([]);
  });

  it('循環と不正応答では登録済みと断定せず、書き込まない', async () => {
    const { obs, add } = sourceSetup();
    const input = obs.input('browser_source', { url });
    obs.item(firstScene, input.uuid); obs.item(firstScene, secondScene, { nested: true });
    obs.item(secondScene, firstScene, { nested: true });
    expect(await add()).toMatchObject({ status: 'failed', errorCode: 'OBS_SOURCE_RESPONSE_INVALID' });
    expect(writes(obs)).toEqual([]);
  });

  it('入力・シーン・グループの名前衝突を連番で避ける', async () => {
    const { obs, add } = sourceSetup();
    obs.input('browser_source', { url: 'https://example.com' }, 'きゃすメイト コメント');
    obs.scene(secondScene).name = 'きゃすメイト コメント (2)';
    obs.scenes.push({ uuid: randomUUID(), name: 'きゃすメイト コメント (3)', group: true, items: [] });
    expect(await add()).toMatchObject({ status: 'succeeded' });
    expect(obs.inputs.at(-1)?.name).toBe('きゃすメイト コメント (4)');
  });

  it('配置の拒否後は既知の項目だけ再開し、通常の追加済み判定で成功にしない', async () => {
    const { obs, add, controller } = sourceSetup();
    obs.failures.push({ type: 'SetSceneItemTransform', error: new ObsSourceRequestRejected(600) });
    const first = await add();
    expect(first).toMatchObject({ status: 'incomplete', phase: 'configuring', result: 'created' });
    expect(first.inputUuid).toBeTruthy(); expect(first.sceneItemId).toBe(1);
    await expect(add()).rejects.toMatchObject({ code: 'OBS_SOURCE_RETRY_REQUIRED' });
    expect(await add({ retryOperationId: first.id })).toMatchObject({ status: 'succeeded', result: 'created', id: first.id });
    expect(obs.inputs).toHaveLength(1); expect(obs.scene(firstScene).items).toHaveLength(1);
    expect(writes(obs).map(call => call.type)).toEqual(['CreateInput', 'SetSceneItemTransform', 'SetSceneItemTransform']);
    expect(controller.view().busy).toBe(false);
  });

  it('別対象の成功後も未完了操作IDを管理状態へ保持して復旧できる', async () => {
    const { obs, add, controller } = sourceSetup();
    obs.failures.push({ type: 'SetSceneItemTransform', error: new ObsSourceRequestRejected(600) });
    const first = await add();
    await add({ target: { kind: 'overlay', overlay: 'character' } });
    expect(controller.view().lastOperation?.target).toEqual({ kind: 'overlay', overlay: 'character' });
    expect(controller.view().unfinishedOperations).toEqual([first]);
    expect(await add({ retryOperationId: first.id })).toMatchObject({ status: 'succeeded', id: first.id });
    expect(controller.view().unfinishedOperations).toEqual([]);
  });

  it('作成応答喪失は所有を推測せず、再試行でも自動再送・配置・削除しない', async () => {
    const { obs, add } = sourceSetup();
    obs.failures.push({ type: 'CreateInput', error: new Error('OBS_REQUEST_TIMEOUT'), after: true });
    const first = await add();
    expect(first).toMatchObject({ status: 'unknown', inputUuid: null, sceneItemId: null });
    expect(obs.inputs).toHaveLength(1);
    expect(await add({ retryOperationId: first.id })).toMatchObject({ status: 'unknown', errorCode: 'OBS_SOURCE_RESULT_UNKNOWN' });
    expect(writes(obs).map(call => call.type)).toEqual(['CreateInput']);
  });

  it('配置応答喪失でも明示再試行の読み戻しで確認でき、設定要求を再送しない', async () => {
    const { obs, add } = sourceSetup();
    obs.failures.push({ type: 'SetSceneItemTransform', error: new Error('OBS_REQUEST_TIMEOUT'), after: true });
    const first = await add();
    expect(first.status).toBe('unknown');
    expect(await add({ retryOperationId: first.id })).toMatchObject({ status: 'succeeded', id: first.id });
    expect(writes(obs).map(call => call.type)).toEqual(['CreateInput', 'SetSceneItemTransform']);
  });

  it('外部で変更された作成済み項目を再試行で上書きしない', async () => {
    const { obs, add } = sourceSetup();
    obs.failures.push({ type: 'SetSceneItemTransform', error: new ObsSourceRequestRejected(600) });
    const first = await add(); obs.scene(firstScene).items[0].transform.positionX = 123;
    expect(await add({ retryOperationId: first.id })).toMatchObject({ status: 'incomplete', errorCode: 'OBS_SOURCE_ITEM_CHANGED' });
    expect(obs.scene(firstScene).items[0].transform.positionX).toBe(123);
    expect(writes(obs)).toHaveLength(2);
  });

  it.each(['collection', 'disconnect', 'device'] as const)('作成後の%s変更で残りの配置を停止する', async change => {
    const { controller, obs, phone } = sourceSetup();
    const target = { kind: 'smartphone', deviceId };
    obs.intercept = async type => {
      if (type === 'GetSceneItemTransform' && obs.inputs.length > 0) {
        if (change === 'collection') { obs.generation++; obs.collection = '別の配信'; }
        if (change === 'disconnect') obs.connected = false;
        if (change === 'device') phone.devices.splice(0, 1);
      }
    };
    expect(await controller.add({ target, collection: obs.collection, sceneUuid: firstScene }))
      .toMatchObject({ status: 'incomplete' });
    expect(writes(obs).map(call => call.type)).toEqual(['CreateInput']);
    expect(obs.inputs).toHaveLength(1);
  });

  it('連打・複数画面からの要求を同期的に占有し、処理終了で解放する', async () => {
    const { obs, add } = sourceSetup();
    let release!: () => void; let entered!: () => void;
    const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    obs.intercept = async type => { if (type === 'GetVersion') { entered(); await gate; } };
    const first = add(); await enteredPromise;
    expect(obs.occupied).toBe(true);
    await expect(add()).rejects.toMatchObject({ code: 'BUSY' });
    release(); expect((await first).status).toBe('succeeded');
    expect(obs.occupied).toBe(false); expect(obs.inputs).toHaveLength(1);
  });

  it.each(['old', 'api', 'kind'] as const)('未対応OBS (%s)は本機能だけ失敗し書き込まない', async reason => {
    const { controller, obs, target, add } = sourceSetup();
    if (reason === 'old') obs.version = '5.3.1';
    if (reason === 'api') obs.availableRequests = obs.availableRequests.filter(type => type !== 'CreateInput');
    if (reason === 'kind') obs.inputKinds = ['ffmpeg_source'];
    await expect(controller.context(target)).rejects.toMatchObject({ code: 'OBS_SOURCE_UNSUPPORTED' });
    expect(await add()).toMatchObject({ status: 'failed', errorCode: 'OBS_SOURCE_UNSUPPORTED' });
    expect(writes(obs)).toEqual([]); expect(obs.occupied).toBe(false);
  });

  it.each([
    { target: { kind: 'overlay', overlay: 'comments', url: 'https://example.com' } },
    { target: { kind: 'overlay', overlay: 'management' } },
    { requestType: 'StartStream' },
    { sceneUuid: 'wrong' },
    { retryOperationId: randomUUID() },
  ])('任意入力・汎用OBS要求・無関係な再試行を拒否する %j', async request => {
    const { obs, add } = sourceSetup();
    await expect(add(request)).rejects.toMatchObject({ code: 'OBS_SOURCE_INVALID_REQUEST' });
    expect(obs.calls).toEqual([]);
  });

  it('旧コレクションと削除済みシーンを再確認し、再起動後の既存項目は修復しない', async () => {
    const { obs, add } = sourceSetup();
    expect(await add({ collection: '古い配信' })).toMatchObject({ status: 'failed', errorCode: 'OBS_SOURCE_TARGET_CHANGED' });
    expect(await add({ sceneUuid: randomUUID() })).toMatchObject({ status: 'failed', errorCode: 'OBS_SOURCE_TARGET_CHANGED' });
    obs.failures.push({ type: 'SetSceneItemTransform', error: new ObsSourceRequestRejected(600) });
    expect((await add()).status).toBe('incomplete');
    const restarted = sourceSetup(obs);
    expect(await restarted.add()).toMatchObject({ status: 'succeeded', result: 'alreadyPresent' });
    expect(writes(obs).map(call => call.type)).toEqual(['CreateInput', 'SetSceneItemTransform']);
  });
});


it('スタジオモードのプレビューを編集中のシーンとして使い、本番への指定を拒否する', async () => {
  const f = sourceSetup(); f.obs.studioMode = true;
  expect((await f.controller.context(f.target)).currentSceneUuid).toBe(secondScene);
  expect(await f.add()).toMatchObject({ status: 'failed', errorCode: 'OBS_SOURCE_TARGET_CHANGED' });
  expect(writes(f.obs)).toEqual([]);
  expect(await f.add({ sceneUuid: secondScene })).toMatchObject({ status: 'succeeded', sceneUuid: secondScene });
  expect(f.obs.scene(firstScene).items).toEqual([]);
});
it('プレビューが不明なスタジオモードでは本番へ代替せず書き込まない', async () => {
  const f = sourceSetup(); f.obs.studioMode = true; f.obs.previewScene = null;
  await expect(f.controller.context(f.target)).rejects.toMatchObject({ code: 'OBS_SOURCE_SCENE_UNAVAILABLE' });
  expect(await f.add()).toMatchObject({ status: 'failed', errorCode: 'OBS_SOURCE_SCENE_UNAVAILABLE' }); expect(writes(f.obs)).toEqual([]);
});
it('最初の書込み直前に編集中のシーンが変わった場合は結果不明にせず停止する', async () => {
  const f = sourceSetup(); let switched = false;
  f.obs.intercept = async type => { if (type === 'GetSceneItemList' && !switched) { switched = true; f.obs.currentScene = secondScene; } };
  expect(await f.add()).toMatchObject({ status: 'failed', errorCode: 'OBS_SOURCE_TARGET_CHANGED' }); expect(writes(f.obs)).toEqual([]);
});
it('最初の書込み後にシーンを変えても確定したシーンで配置を完了する', async () => {
  const f = sourceSetup();
  f.obs.intercept = async type => { if (type === 'SetSceneItemTransform') f.obs.currentScene = secondScene; };
  expect(await f.add()).toMatchObject({ status: 'succeeded', sceneUuid: firstScene });
  expect(f.obs.scene(firstScene).items).toHaveLength(1); expect(f.obs.scene(secondScene).items).toEqual([]);
});
it('未完了登録を別の編集中シーンで再試行せず、元の項目を保持する', async () => {
  const f = sourceSetup(); f.obs.failures.push({ type: 'SetSceneItemTransform', error: new ObsSourceRequestRejected(500) });
  const first = await f.add(); expect(first.status).toBe('incomplete'); f.obs.currentScene = secondScene; const count = writes(f.obs).length;
  expect(await f.add({ retryOperationId: first.id, inputUuid: first.inputUuid })).toMatchObject({ status: 'incomplete', errorCode: 'OBS_SOURCE_RETRY_TARGET_CHANGED', sceneUuid: firstScene });
  expect(writes(f.obs)).toHaveLength(count); f.obs.currentScene = firstScene;
  expect(await f.add({ retryOperationId: first.id, inputUuid: first.inputUuid })).toMatchObject({ status: 'succeeded' });
});
it('スタジオモード読取APIがないOBSでは自動登録だけを拒否する', async () => {
  const f = sourceSetup(); f.obs.availableRequests = f.obs.availableRequests.filter(type => type !== 'GetStudioModeEnabled');
  await expect(f.controller.context(f.target)).rejects.toMatchObject({ code: 'OBS_SOURCE_UNSUPPORTED' }); expect(writes(f.obs)).toEqual([]);
});

it.each([false, true])('最後のシーン読取後の切替でも最初の作成・共有を書き込まない（スタジオ=%s）', async studio => {
  for (const reuse of [false, true]) {
    const f = sourceSetup(); f.obs.studioMode = studio;
    if (reuse) f.obs.input('browser_source', { url: 'http://127.0.0.1:3100/overlay/comments' });
    const sceneUuid = studio ? secondScene : firstScene;
    f.obs.intercept = async type => {
      if (type === 'GetSceneCollectionList' && f.obs.calls.at(-2)?.type === 'GetStudioModeEnabled' &&
        f.obs.calls.some(call => call.type === 'GetSceneItemList')) {
        if (studio) f.obs.previewScene = firstScene; else f.obs.currentScene = secondScene;
      }
    };
    expect(await f.add({ sceneUuid })).toMatchObject({ status: 'failed', errorCode: 'OBS_SOURCE_TARGET_CHANGED' });
    expect(writes(f.obs)).toEqual([]);
  }
});
