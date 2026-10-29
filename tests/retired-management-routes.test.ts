import request from 'supertest';
import { expect, it } from 'vitest';
import { AppState } from '../src/main/core/app-state';
import { createDefaultSettings } from '../src/main/core/settings';
import { createHttpApplication } from '../src/main/server/local-server';

it('廃止した単独・統合QRと端末QRのAPIを管理認証後も公開しない', async () => {
  const state = new AppState(createDefaultSettings());
  const app = createHttpApplication({ state, port: 3000, operationToken: 'operation' });
  for (const path of ['/api/outdoor/configure', '/api/outdoor/registration', '/api/obs-control/revoke', '/api/obs-control/regenerate', '/api/smartphone/devices/device/registration']) {
    const result = await request(app).post(path).set('Host', '127.0.0.1:3000').set('Origin', 'http://127.0.0.1:3000').set('X-CasMate-Token', 'operation');
    expect(result.status).toBe(404); expect(result.body).not.toHaveProperty('registration');
  }
  await state.shutdown();
});
