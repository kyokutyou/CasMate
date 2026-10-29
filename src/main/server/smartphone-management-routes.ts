import type { Express, Request, Response } from 'express';
import type { SmartphoneController } from '../smartphone/smartphone-controller';
import { allSmartphoneNetworks, type SmartphoneConfiguration, type SmartphoneNetwork } from '../../shared/smartphone';
import type { AppState } from '../core/app-state';
import type { ObsControlController } from '../obs/obs-control-controller';
import { asyncHandler, HttpError, isPlainRecord } from './http-handlers';

export interface SmartphoneManagementOptions {
  state: Pick<AppState, 'snapshot'>;
  port: number;
  smartphone?: () => SmartphoneController | null;
  obsControl?: ObsControlController;
}

// Register behind the loopback management operation guard; never on the mobile read-only server.
export function registerSmartphoneManagementRoutes(app: Express, options: SmartphoneManagementOptions): void {
  const phone = () => {
    const controller = options.smartphone?.();
    if (!controller) throw new HttpError(503, 'SMARTPHONE_UNAVAILABLE', 'スマホ連携を準備中です。');
    return controller;
  };
  const operation = (action: (request: Request, response: Response) => Promise<void>) => asyncHandler(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    try { await action(request, response); }
    catch (error) {
      if (error instanceof HttpError) throw error;
      const message = error instanceof Error && /^(スマホ|ネットワーク|映像|状態|この|接続先|OBS受信)/u.test(error.message)
        ? error.message : 'スマホ連携の操作を完了できません。接続状態とWindowsの保存領域を確認してください。';
      throw new HttpError(400, 'SMARTPHONE_OPERATION_FAILED', message);
    }
  });
  const network = (request: Request): SmartphoneNetwork => {
    const value = request.body?.network as SmartphoneNetwork;
    if (!isPlainRecord(request.body) || Object.keys(request.body).length !== 1 || !allSmartphoneNetworks.includes(value)) throw new HttpError(400, 'INVALID_NETWORK', 'ネットワークを選択してください。');
    return value;
  };
  app.post('/api/smartphone/configure', operation(async (request, response) => {
    await phone().configure(request.body as SmartphoneConfiguration); response.json({ snapshot: options.state.snapshot() });
  }));
  app.post('/api/smartphone/invitation', operation(async (request, response) => {
    response.json({ invitation: phone().invitation(network(request)) });
  }));
  for (const action of ['retry', 'cleanup', 'reset-key'] as const) app.post(`/api/smartphone/direct/${action}`, operation(async (request, response) => {
    if (request.body !== undefined) throw new HttpError(400, 'INVALID_REQUEST', 'この操作には入力は不要です。');
    if (action === 'retry') await phone().directRetry(); else if (action === 'cleanup') await phone().directCleanup(); else await phone().resetDirectIdentity();
    response.json({ snapshot: options.state.snapshot() });
  }));
  app.post('/api/smartphone/direct/manual-confirm', operation(async (request, response) => {
    const body = request.body;
    if (!isPlainRecord(body) || Object.keys(body).some(k => !['revision', 'deviceId'].includes(k)) || !Number.isSafeInteger(body.revision) ||
      (body.deviceId !== undefined && (typeof body.deviceId !== 'string' || !isUuid(body.deviceId)))) throw new HttpError(400, 'INVALID_REQUEST', '手動開放の設定を確認してください。');
    await phone().directManualConfirm(body.revision as number, body.deviceId as string | undefined); response.json({ snapshot: options.state.snapshot() });
  }));
  app.post('/api/smartphone/devices', operation(async (request, response) => {
    await phone().add(request.body?.name as string); response.json({ snapshot: options.state.snapshot() });
  }));
  app.patch('/api/smartphone/devices/:id', operation(async (request, response) => {
    await phone().rename(String(request.params.id), request.body?.name as string); response.json({ snapshot: options.state.snapshot() });
  }));
  app.delete('/api/smartphone/devices/:id', operation(async (request, response) => {
    await phone().remove(String(request.params.id)); response.json({ snapshot: options.state.snapshot() });
  }));
  app.post('/api/smartphone/devices/:id/regenerate', operation(async (request, response) => {
    await phone().regenerate(String(request.params.id)); response.json({ snapshot: options.state.snapshot() });
  }));
  app.post('/api/smartphone/devices/:id/obs-input', operation(async (request, response) => {
    if (!isPlainRecord(request.body) || Object.keys(request.body).length !== 0)
      throw new HttpError(400, 'INVALID_REQUEST', 'OBS入力の操作形式が変わりました。画面を更新してください。');
    response.json({ input: phone().obsInput(String(request.params.id)) });
  }));
  app.post('/api/obs-control/configure', asyncHandler(async (request, response) => {
    if (!options.obsControl) throw new HttpError(503, 'OBS_UNAVAILABLE', 'OBS操作を利用できません。');
    try { await options.obsControl.configure(request.body); }
    catch (error) { throw new HttpError(400, 'OBS_CONFIGURATION_FAILED', obsConfigurationMessage(error)); }
    response.json({ snapshot: options.state.snapshot() });
  }));
  app.post('/api/obs-control/retry', asyncHandler(async (_request, response) => {
    if (!options.obsControl) throw new HttpError(503, 'OBS_UNAVAILABLE', 'OBS操作を利用できません。');
    try { await options.obsControl.retry(); }
    catch (error) { throw new HttpError(503, 'OBS_RETRY_FAILED', obsConfigurationMessage(error)); }
    response.json({ snapshot: options.state.snapshot() });
  }));
  app.post('/api/obs-control/cancel', asyncHandler(async (request, response) => {
    if (!options.obsControl) throw new HttpError(503, 'OBS_UNAVAILABLE', 'OBS操作を利用できません。');
    const body = request.body;
    if (body !== undefined && (!isPlainRecord(body) || Object.keys(body).some((key) => key !== 'confirmationId') ||
      (body.confirmationId !== undefined && (typeof body.confirmationId !== 'string' || !isUuid(body.confirmationId))))) {
      throw new HttpError(400, 'INVALID_REQUEST', '確認IDが正しくありません。');
    }
    options.obsControl.cancelManagementConfirmation(body?.confirmationId as string | undefined);
    response.json({ snapshot: options.state.snapshot() });
  }));

}

function obsConfigurationMessage(error: unknown): string {
  if (error instanceof Error) {
    return {
      OBS_PASSWORD_REQUIRED: 'OBS WebSocketパスワードを設定してください。',
      OBS_PASSWORD_INVALID: 'OBS WebSocketパスワードを確認してください。',
      OBS_SECRET_UNAVAILABLE: 'OBS操作の保護設定を復元できません。資格情報を再設定してください。',
      OBS_DISABLED: 'OBS操作をオンにしてください。',
      REGISTRATION_UNAVAILABLE: '先にAndroid公開を準備してください。',
    }[error.message] ?? 'OBS操作の設定を更新できません。';
  }
  return 'OBS操作の設定を更新できません。';
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
}
