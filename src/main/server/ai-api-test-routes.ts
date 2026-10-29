import type { Express } from 'express';
import type { AiController } from '../ai/ai-controller';
import { AiServiceError, type AiConnections } from '../ai/ai-connections';
import { isPlainRecord } from './http-handlers';

/** Registered behind the management Host, Origin and operation-token guards. */
export function registerAiApiTest(app: Express, ai?: { controller: AiController; connections: AiConnections }) {
  app.post('/api/ai-listener/test-api', async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (!ai) { response.status(503).json({ code: 'AI_UNAVAILABLE', message: 'AIリスナーを利用できません。' }); return; }
    if (!isPlainRecord(request.body) || Object.keys(request.body).length) {
      response.status(400).json({ code: 'AI_API_TEST_INVALID_REQUEST', message: 'APIテストの要求を確認してください。' }); return;
    }
    const cancel = new AbortController();
    const deadline = AbortSignal.timeout(30000);
    const generation = ai.controller.contextRevision();
    let operationSignal: AbortSignal | undefined;
    const closed = () => { if (!response.writableEnded) cancel.abort(); };
    response.on('close', closed);
    try {
      const model = await ai.controller.withIdleSettings(async (settings, signal) => {
        operationSignal = AbortSignal.any([signal, cancel.signal, deadline]);
        await ai.connections.testApi(settings.model, operationSignal);
        operationSignal.throwIfAborted();
        return settings.model;
      });
      if (cancel.signal.aborted) return;
      if (generation !== ai.controller.contextRevision()) {
        response.status(409).json({ code: 'AI_API_TEST_FAILED', message: '設定または稼働状態が変わったため、APIテストを取り消しました。' }); return;
      }
      response.json({ model, message: 'Gemini APIの文章応答を確認しました。' });
    } catch (error) {
      if (cancel.signal.aborted) return;
      const message = deadline.aborted ? 'Gemini APIの応答を30秒以内に確認できませんでした。時間を置いて再試行してください。'
        : operationSignal?.aborted ? '設定または稼働状態が変わったため、APIテストを取り消しました。'
        : error instanceof AiServiceError ? error.message
        : error instanceof Error && error.message.startsWith('AIを停止') ? error.message
        : 'Gemini APIへ接続できません。接続状態と保存済みキー・モデルを確認してください。';
      response.status(409).json({ code: 'AI_API_TEST_FAILED', message });
    } finally { response.off('close', closed); }
  });
}
