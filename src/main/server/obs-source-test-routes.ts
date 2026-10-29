import type { Express, RequestHandler } from 'express';
import type { AppState } from '../core/app-state';
import { ObsSourceRegistrationError } from '../obs/obs-source-registration-controller';
import type { ObsSourceTestController } from '../obs/obs-source-test-controller';
import { asyncHandler, HttpError, isPlainRecord } from './http-handlers';

export function registerObsSourceTestRoutes(app: Express, options: {
  controller?: ObsSourceTestController;
  state: Pick<AppState, 'snapshotEvent'>;
  managementRead: RequestHandler;
  operation: RequestHandler;
}): void {
  const invoke = async <T>(action: (controller: ObsSourceTestController) => Promise<T>): Promise<T> => {
    if (!options.controller) throw new HttpError(503, 'OBS_TEST_UNAVAILABLE', '表示テストを準備中です。');
    try { return await action(options.controller); }
    catch (error) {
      if (error instanceof ObsSourceRegistrationError) throw new HttpError(error.status, error.code, error.message);
      throw new HttpError(503, 'OBS_TEST_UNAVAILABLE', 'テスト送信の結果を確認できません。OBSで確認してください。');
    }
  };
  app.get('/api/management/obs-sources/test-context', options.managementRead, asyncHandler(async (request, response) => {
    if (typeof request.query.request !== 'string' || Object.keys(request.query).length !== 1) throw new HttpError(400, 'OBS_TEST_INVALID_REQUEST', 'テストする対象を選択してください。');
    let value: unknown;
    try { value = JSON.parse(request.query.request); } catch { throw new HttpError(400, 'OBS_TEST_INVALID_REQUEST', 'テストする対象を選択してください。'); }
    response.setHeader('Cache-Control', 'no-store');
    response.json(await invoke(controller => controller.context(value)));
  }));
  for (const action of ['start', 'stop'] as const) {
    app.post('/api/obs-sources/test/' + action, options.operation, asyncHandler(async (request, response) => {
      response.setHeader('Cache-Control', 'no-store');
      if (action === 'stop' && (!isPlainRecord(request.body) || Object.keys(request.body).length !== 1 || !Object.hasOwn(request.body, 'testId'))) throw new HttpError(400, 'OBS_TEST_INVALID_REQUEST', 'テストIDを確認してください。');
      const result = await invoke<unknown>(controller => action === 'start' ? controller.start(request.body) : controller.stop(request.body.testId));
      const snapshot = options.state.snapshotEvent();
      response.json({ result, snapshot: snapshot.payload, revision: snapshot.revision });
    }));
  }
}
