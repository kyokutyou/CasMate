import type { Express } from 'express';
import type { AiController } from '../ai/ai-controller';
import { AiServiceError, type AiConnections } from '../ai/ai-connections';
import { isPlainRecord } from './http-handlers';
import { randomUUID } from 'node:crypto';
import { aiSkipMessage } from '../ai/ai-reply';
import { graphemes } from '../../shared/unicode';

/** Registered behind the management Host, Origin and operation-token guards. */
export function registerAiApiTest(app: Express, ai?: { controller: AiController; connections: AiConnections }) {
  app.post('/api/ai-listener/test-reply', async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (!ai) { response.status(503).json({ code: 'AI_UNAVAILABLE', message: 'AIリスナーを利用できません。' }); return; }
    const body = request.body;
    if (!isPlainRecord(body) || Object.keys(body).sort().join(',') !== 'personaId,text' || typeof body.personaId !== 'string' || body.personaId.length > 200 || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 2000) {
      response.status(400).json({ code: 'AI_REPLY_TEST_INVALID', message: '人格と1～2000文字のテストコメントを指定してください。' }); return;
    }
    const cancel = new AbortController(), deadline = AbortSignal.timeout(35000);
    const personaId = body.personaId, text = body.text.trim();
    const generation = ai.controller.contextRevision();
    const closed = () => { if (!response.writableEnded) cancel.abort(); };
    response.on('close', closed);
    try {
      const reply = await ai.controller.withIdleSettings(async (settings, signal) => {
        const persona = settings.personas.find(item => item.id === personaId);
        if (!persona || !ai.connections.hasKey()) throw new Error('保存済み人格とAPIキーを確認してください。');
        const combined = AbortSignal.any([signal, cancel.signal, deadline]);
        // Normal context selection reserves two thirds for recent comments.
        // Keep the sole synthetic input whole without changing saved settings.
        const contextCharacters = Math.max(settings.contextCharacters, Math.ceil(graphemes(text).length * 3 / 2));
        const result = await ai.connections.generate({ ...settings, contextCharacters, visual: { enabled: false, source: null }, debugPromptLog: false }, persona,
          [{ id: randomUUID(), at: new Date().toISOString(), role: 'viewer', source: null, text }], false, combined, undefined, true);
        combined.throwIfAborted();
        return typeof result === 'string' ? result.trim() || aiSkipMessage({ action: 'skip', reason: 'invalid-response' }) : aiSkipMessage(result);
      });
      if (cancel.signal.aborted) return;
      if (generation !== ai.controller.contextRevision()) throw new Error('設定が変更されました。');
      response.json({ reply });
    } catch (error) {
      if (!cancel.signal.aborted) response.status(409).json({ code: 'AI_REPLY_TEST_FAILED', message: deadline.aborted ? '35秒以内に返答を確認できませんでした。' : error instanceof AiServiceError ? error.message : 'AIを停止し、保存済みの人格・設定・APIキーを確認して再試行してください。' });
    } finally { response.off('close', closed); }
  });
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
