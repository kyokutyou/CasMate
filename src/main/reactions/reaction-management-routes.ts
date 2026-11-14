import type { Express, RequestHandler } from 'express';
import { ReactionController, ReactionError } from './reaction-controller';
import type { ReactionPublication } from './reaction-publication';
import { asyncHandler, HttpError } from '../server/http-handlers';
import { reactionRecord } from '../../shared/listener-reactions';
import type { ReactionNamedShare } from './reaction-named-share';
export interface ReactionManagementOptions { controller: ReactionController; publication: Pick<ReactionPublication, 'view' | 'start' | 'stop'>; namedShare?: ReactionNamedShare }
export function registerReactionManagementRoutes(app: Express, options: ReactionManagementOptions | undefined, read: RequestHandler, operation: RequestHandler) {
  if (!options) return;
  const { controller, publication, namedShare } = options;
  const view = () => ({ ...controller.view(publication.view()), namedShare: namedShare?.view() });
  app.get('/api/management/reactions', read, (_req, res) => { controller.preview(); res.setHeader('Cache-Control', 'no-store'); res.json(view()); });
  app.get('/api/management/reactions/frame', read, (req, res) => {
    const frame = typeof req.query.id === 'string' ? controller.frames.get(req.query.id) : null;
    res.setHeader('Cache-Control', 'no-store');
    if (!frame) { res.sendStatus(410); return; } res.type('image/jpeg').send(frame.bytes);
  });
  app.post('/api/management/reactions/:action', operation, asyncHandler(async (req, res) => {
    try {
      const expectedInstance = req.header('X-CasMate-Reaction-Instance');
      if (expectedInstance !== undefined && expectedInstance !== controller.instance) {
        throw new ReactionError(409, 'アプリの起動状態が変わりました。現在の状態を確認してください。');
      }
      switch (req.params.action) {
        case 'share-claim':
          if (!namedShare) throw new ReactionError(404, '名前付きリンクは利用できません。');
          await namedShare.claim(req.body); break;
        case 'share-refresh':
          if (!namedShare) throw new ReactionError(404, '名前付きリンクは利用できません。');
          await namedShare.refresh(); break;
        case 'settings': await controller.update(req.body); break;
        case 'preview-settings': await controller.configureListenerPreview(req.body); break;
        case 'detect': {
          const body: unknown = req.body;
          if (!reactionRecord(body) || !Object.hasOwn(body, 'targetId') || Object.keys(body).some(key => key !== 'targetId' && key !== 'operationToken')) throw new ReactionError(400, '対象を選択してください。');
          await controller.runDesktopPreparation(() => controller.detect(body.targetId), body.operationToken);
          break;
        }
        case 'auto-start':
          if (!reactionRecord(req.body) || Object.keys(req.body).join(',') !== 'enabled') throw new ReactionError(400, '自動開始の設定を確認してください。');
          await controller.configurePublishStart(req.body.enabled); break;
        case 'startup-publication':
          if (!reactionRecord(req.body) || Object.keys(req.body).join(',') !== 'enabled') throw new ReactionError(400, '起動時公開の設定を確認してください。');
          await controller.configureStartupPublication(req.body.enabled); break;
        case 'publish': await controller.requestPublication(publication); break;
        case 'unpublish': controller.cancelPreviewLookup(); await publication.stop(); break;
        case 'start': await controller.runDesktopPreparation(() => controller.startDesktop(), reactionRecord(req.body) ? req.body.operationToken : undefined); break;
        case 'stop': controller.stopDesktop(); break;
        case 'edit': controller.pauseEditing(); break;
        case 'edit-cancel':
          if (!reactionRecord(req.body) || Object.keys(req.body).join(',') !== 'editToken' || typeof req.body.editToken !== 'string') throw new ReactionError(400, '取り消す編集を確認してください。');
          await controller.cancelEditing(req.body.editToken); break;
        case 'test': controller.testDesktop(); break;
        default: throw new ReactionError(404, '操作が見つかりません。');
      }
      if (publication.view().status === 'error' && ['publish','unpublish'].includes(String(req.params.action))) throw new ReactionError(503, publication.view().message);
      res.json(view());
    } catch (error) { throw new HttpError(error instanceof ReactionError ? error.status : 503, 'REACTION_OPERATION_FAILED', error instanceof ReactionError ? error.message : 'リアクションの操作に失敗しました。再試行してください。'); }
  }));
  app.get('/api/overlays/reactions/events', (req, res) => {
    if (!controller.isAvailable()) { res.sendStatus(503); return; }
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) { res.sendStatus(403); return; }
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' }); res.flushHeaders();
    const send = (name: string, data: unknown) => { if (name === 'shutdown') { res.end(); return; } if (!res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)) res.destroy(); };
    send('snapshot', controller.publicView());
    const unsubscribe = controller.subscribe(send);
    const timer = setInterval(() => { if (!res.write(': heartbeat\n\n')) res.destroy(); }, 15000); timer.unref();
    res.once('close', () => { clearInterval(timer); unsubscribe(); });
  });
}
