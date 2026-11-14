import type { Express, RequestHandler } from 'express';
import { PollController, PollError } from './poll-controller';
import { PollPublication } from './poll-publication';
import { pollEvents } from './poll-public-server';
import { asyncHandler, HttpError } from '../server/http-handlers';
import { record, only } from '../../shared/listener-poll';

export interface PollManagementOptions { controller: PollController; publication: PollPublication }
export function registerPollManagementRoutes(app: Express, options: PollManagementOptions | undefined, read: RequestHandler, operation: RequestHandler) {
  if (!options) return;
  const { controller: polls, publication } = options;
  const view = () => ({ ...polls.view(), publication: publication.view() });
  app.get('/api/management/polls', read, (_request, response) => { response.json(view()); });
  app.post('/api/management/polls/:action', operation, asyncHandler(async (request, response) => {
    try {
      const body: unknown = request.body;
      switch (request.params.action) {
        case 'draft': await polls.draft(body); break;
        case 'appearance': await polls.appearance(body); break;
        case 'publish':
          await publication.start();
          if (publication.view().status === 'error') throw new PollError(503, 'POLL_PUBLICATION_FAILED', publication.view().message);
          break;
        case 'unpublish':
          await publication.stop();
          if (publication.view().status === 'error') throw new PollError(503, 'POLL_PUBLICATION_STOP_FAILED', publication.view().message);
          break;
        case 'start':
          if (publication.view().status !== 'online') throw new PollError(409, 'POLL_NOT_PUBLISHED', '投票ページを公開してから投票を開始してください。');
          await polls.start(() => publication.view().status === 'online'); break;
        case 'close': await polls.close(); break;
        case 'reveal':
          if (!record(body) || !only(body, ['visible'])) throw new PollError(400, 'POLL_INVALID', '結果公開の設定を確認してください。');
          await polls.reveal(body.visible); break;
        case 'duplicate': case 'delete':
          if (!record(body) || !only(body, ['id']) || typeof body.id !== 'string') throw new PollError(400, 'POLL_INVALID', '投票を選択してください。');
          if (request.params.action === 'duplicate') await polls.duplicate(body.id); else await polls.delete(body.id); break;
        default: throw new PollError(404, 'POLL_ACTION_NOT_FOUND', '投票の操作が見つかりません。');
      }
      response.json(view());
    } catch (error) {
      if (error instanceof PollError) throw new HttpError(error.status, error.code, error.message);
      throw new HttpError(503, 'POLL_OPERATION_FAILED', '投票の操作に失敗しました。状態を確認して再試行してください。');
    }
  }));
  app.get('/api/overlays/poll', (request, response) => {
    // LocalServer has already verified Host. Overlay clients never get management credentials.
    if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) { response.sendStatus(403); return; }
    response.setHeader('Cache-Control', 'no-store'); response.json(polls.publicView());
  });
  app.get('/api/overlays/poll/events', (request, response) => {
    if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) { response.sendStatus(403); return; }
    pollEvents(polls, response);
  });
}
