import type { Express, RequestHandler } from 'express';
import type { AppState } from '../core/app-state';
import { ObsSourceRegistrationController, ObsSourceRegistrationError } from '../obs/obs-source-registration-controller';
import { asyncHandler, HttpError } from './http-handlers';

export function registerObsSourceRegistrationRoutes(app: Express, options: {
  controller?: ObsSourceRegistrationController;
  state: Pick<AppState, 'snapshotEvent'>;
  managementRead: RequestHandler;
  operation: RequestHandler;
}): void {
  const controller = () => {
    if (!options.controller) throw new HttpError(503, 'OBS_UNAVAILABLE', 'OBS接続を準備中です。');
    return options.controller;
  };
  const invoke = async <T>(action: () => Promise<T>): Promise<T> => {
    try { return await action(); }
    catch (error) {
      if (error instanceof ObsSourceRegistrationError) throw new HttpError(error.status, error.code, error.message);
      if (error instanceof HttpError) throw error;
      throw new HttpError(503, 'OBS_UNAVAILABLE', 'OBSへの登録を完了できません。接続状態を確認してください。');
    }
  };
  app.get('/api/management/obs-sources/context', options.managementRead, asyncHandler(async (request, response) => {
    if (typeof request.query.target !== 'string' || Object.keys(request.query).some(key => key !== 'target')) {
      throw new HttpError(400, 'OBS_SOURCE_INVALID_REQUEST', '追加する表示・端末を選択してください。');
    }
    let target: unknown;
    try { target = JSON.parse(request.query.target); }
    catch { throw new HttpError(400, 'OBS_SOURCE_INVALID_REQUEST', '追加する表示・端末を選択してください。'); }
    response.json(await invoke(() => controller().context(target)));
  }));
  app.post('/api/obs-sources/add', options.operation, asyncHandler(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    const operation = await invoke(() => controller().add(request.body));
    const snapshot = options.state.snapshotEvent();
    response.json({ operation, snapshot: snapshot.payload, revision: snapshot.revision });
  }));
}
