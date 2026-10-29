import type { Express, Request, Response } from 'express';
import type { AiSettings } from '../../shared/ai-listener';
import type { ObsVisual } from '../obs/obs-visual';
import type { AiController } from '../ai/ai-controller';
import type { AiConnections } from '../ai/ai-connections';
import type { VisualDebug } from '../ai/visual-debug';

/** Register after the existing management Host/Origin/operation-token guards. */
export function registerAiVisual(app: Express, options: { visual: ObsVisual; controller: AiController; connections: AiConnections;
  settings(): AiSettings; debug?: VisualDebug }) {
  const handle = (action: (req: Request, signal: AbortSignal) => Promise<unknown>) => async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    const cancel = new AbortController(); const closed = () => { if (!res.writableEnded) cancel.abort(); };
    res.on('close', closed);
    try { const result = await action(req, cancel.signal); if (!cancel.signal.aborted) res.json(result); }
    catch (error) { if (!cancel.signal.aborted) res.status(409).json({ message: error instanceof Error && error.message.startsWith('AIを停止') ? error.message : '映像の取得・操作を完了できません。OBS接続、保存済み設定、AIの停止状態を確認してください。' }); }
    finally { res.off('close', closed); }
  };
  app.post('/api/ai-listener/visual/status', handle(async () => ({ status: options.connections.imageStatus(), debugEnabled: Boolean(options.debug) })));
  app.post('/api/ai-listener/visual/sources', handle(async (_req, signal) => ({ sources: await options.visual.list(signal) })));
  app.post('/api/ai-listener/visual/capture', handle(async (req, signal) => {
    const settings = options.settings(); const revision = options.controller.contextRevision();
    if (JSON.stringify(req.body?.source) !== JSON.stringify(settings.visual?.source)) throw new Error('未保存');
    const capture = await options.visual.capture(settings.visual?.source ?? null, signal);
    if (revision !== options.controller.contextRevision()) throw new Error('取消');
    return { capture };
  }));
  const debug = options.debug;
  if (debug) {
    app.post('/api/ai-listener/visual-debug/status', handle(async () => ({ event: debug.touch() })));
    app.post('/api/ai-listener/visual-debug/clear', handle(async () => { debug.clear(); return {}; }));
    app.post('/api/ai-listener/visual-debug/close', handle(async () => { debug.close(); return {}; }));
    app.post('/api/ai-listener/visual-debug/generate', handle(async (req, signal) => {
      if (typeof req.body?.personaId !== 'string') throw new Error('人格未選択');
      const abort = () => debug.clear(); signal.addEventListener('abort', abort, { once: true });
      try { await debug.generate(req.body.personaId); return {}; }
      finally { signal.removeEventListener('abort', abort); }
    }));
  }
}
