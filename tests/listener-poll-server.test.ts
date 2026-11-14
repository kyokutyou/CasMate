import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createServer, get, type ClientRequest, type IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { PollController } from '../src/main/poll/poll-controller';
import { emptyPollData, PollStore } from '../src/main/poll/poll-store';
import { createPollPublicApplication } from '../src/main/poll/poll-public-server';
import { LocalAccess } from '../src/main/server/local-access';
import { registerPollManagementRoutes } from '../src/main/poll/poll-management-routes';
import { PollPublication } from '../src/main/poll/poll-publication';
import { HttpError } from '../src/main/server/http-handlers';
import type { PollPublicSnapshot } from '../src/shared/listener-poll';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); vi.restoreAllMocks(); });
const host = 'poll.example', origin = `https://${host}`;
async function fixture(persistent = false) {
  const directory = persistent ? await mkdtemp(join(tmpdir(), 'casmate-poll-load-')) : null;
  if (directory) cleanup.push(async () => { if (!directory.startsWith(join(tmpdir(), 'casmate-poll-load-'))) throw new Error('Unexpected poll test path'); await rm(directory, { recursive: true, force: true }); });
  const polls = new PollController(directory ? new PollStore(join(directory, 'polls.json')) : { load: async () => emptyPollData(), save: async () => undefined }); await polls.initialize(); cleanup.push(() => polls.shutdown());
  await polls.draft({ question: 'どちら？', options: ['A', 'B'], durationMinutes: null }); await polls.start();
  let online = true;
  const app = createPollPublicApplication({ polls, host: () => host, online: () => online, nonce: 'unique-run', assets: new Map([['/', { type: 'text/html', body: Buffer.from('<h1>専用の投票</h1>') }]]) });
  const cookie = async () => { const result = await request(app).get('/api/state').set('Host', host); return String(result.headers['set-cookie'][0]).split(';')[0]; };
  const vote = (identity: string, option = 0, version = 0, requestId = randomUUID()) => request(app).post('/api/vote').set('Host', host).set('Origin', origin).set('Cookie', identity).send({ pollId: polls.view().current!.id, option, version, requestId });
  return { polls, app, cookie, vote, offline: () => { online = false; } };
}
describe('listener-only public surface', () => {
  it('serves only fixed poll assets and dedicated APIs, with verified Host and Origin', async () => {
    const f = await fixture(); expect((await request(f.app).get('/').set('Host', host)).text).toContain('専用の投票');
    for (const path of ['/api/bootstrap','/api/management/polls','/overlay/poll','/comments','/assets/../../package.json','/assets/unknown.js','/listener-poll.html']) expect((await request(f.app).get(path).set('Host', host)).status).toBe(404);
    expect((await request(f.app).get('/health').set('Host', host)).body).toEqual({ nonce: 'unique-run' });
    expect((await request(f.app).get('/api/state').set('Host', 'evil.example')).status).toBe(403);
    expect((await request(f.app).get('/api/state').set('Host', host).set('Origin', 'https://evil.example')).status).toBe(403);
    const cookie = await f.cookie();
    expect((await request(f.app).post('/api/vote').set('Host', host).set('Cookie', cookie).send({})).status).toBe(403);
    expect((await request(f.app).post('/api/vote').set('Host', host).set('Origin', 'https://evil.example').set('Cookie', cookie).send({})).status).toBe(403);
  });
  it('uses secure HttpOnly cookies, rejects fabricated sessions and does not leak counts', async () => {
    const f = await fixture(); const initial = await request(f.app).get('/api/state').set('Host', host);
    expect(initial.headers['set-cookie'][0]).toMatch(/HttpOnly; Secure; SameSite=Strict/u); expect(initial.body.cookieReady).toBe(false);
    const cookie = await f.cookie(); const result = await f.vote(cookie); expect(result.status).toBe(200); expect(result.body.state.poll).not.toHaveProperty('counts');
    const state = await request(f.app).get('/api/state').set('Host', host).set('Cookie', cookie);
    expect(state.body).toMatchObject({ cookieReady: true, ballot: { option: 0, version: 1 } }); expect(state.body.state.poll).not.toHaveProperty('counts');
    const other = await f.cookie(); expect((await request(f.app).get('/api/state').set('Host', host).set('Cookie', other)).body.ballot).toBeNull();
    expect((await f.vote('casmate_poll=' + 'a'.repeat(64) + '.' + 'b'.repeat(64))).status).toBe(403);
    await f.polls.reveal(true); expect((await request(f.app).get('/api/state').set('Host', host)).body.state.poll.counts).toEqual([1, 0]);
  });
  it('bounds message size and per-participant request rate, and stops votes while offline', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(100_000);
    const f = await fixture(); const cookie = await f.cookie();
    expect((await f.vote(cookie)).status).toBe(200); expect((await f.vote(cookie, 1, 1)).status).toBe(200); expect((await f.vote(cookie, 0, 2)).status).toBe(429);
    expect((await request(f.app).post('/api/vote').set('Host', host).set('Origin', origin).set('Cookie', cookie).send({ text: 'x'.repeat(3000) })).status).toBe(413);
    f.offline(); expect((await f.vote(cookie)).status).toBe(503);
  });
  it('accepts 50 independent voters, moves all votes and broadcasts the final revision to every connection', async () => {
    let clock = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const f = await fixture(true); const server = createServer(f.app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    cleanup.push(() => new Promise<void>(resolve => server.close(() => resolve())));
    const identities = await Promise.all(Array.from({ length: 50 }, () => f.cookie()));
    const clients: { request: ClientRequest; response: IncomingMessage; states: PollPublicSnapshot[] }[] = [];
    cleanup.push(async () => { for (const client of clients) { client.response.destroy(); client.request.destroy(); } });
    await Promise.all(identities.map(cookie => new Promise<void>((resolve, reject) => {
      const req = get({ hostname: '127.0.0.1', port: (server.address() as AddressInfo).port, path: '/api/events', headers: { Host: host, Cookie: cookie } }, response => {
        if (response.statusCode !== 200) { reject(new Error(`SSE ${response.statusCode}`)); response.resume(); return; }
        const client = { request: req, response, states: [] as PollPublicSnapshot[] }; clients.push(client); let buffer = '';
        response.setEncoding('utf8'); response.on('data', (chunk: string) => { buffer += chunk; let end: number; while ((end = buffer.indexOf('\n\n')) !== -1) { const block = buffer.slice(0, end); buffer = buffer.slice(end + 2); if (block.startsWith('data: ')) { client.states.push(JSON.parse(block.slice(6))); resolve(); } } });
      }); req.once('error', reject);
    })));
    expect(clients).toHaveLength(50); expect(clients.every(c => !Object.hasOwn(c.states[0].poll!, 'counts'))).toBe(true);
    clock += 1000;
    const accepted = await Promise.all(identities.map(cookie => f.vote(cookie))); expect(accepted.every(r => r.status === 200)).toBe(true);
    expect(f.polls.view().current?.counts).toEqual([50, 0]);
    clock += 1000;
    const moved = await Promise.all(identities.map(cookie => f.vote(cookie, 1, 1))); expect(moved.every(r => r.status === 200)).toBe(true);
    await f.polls.reveal(true); const revision = f.polls.publicView().revision;
    await vi.waitFor(() => expect(clients.every(client => client.states.at(-1)?.revision === revision)).toBe(true), { timeout: 5000 });
    for (const client of clients) { expect(client.states.at(-1)?.poll?.counts).toEqual([0, 50]); expect(JSON.stringify(client.states)).not.toContain('ballot'); }
    // Reconnection gets the latest snapshot without replaying an intermediate tally.
    const state = await request(f.app).get('/api/state').set('Host', host).set('Cookie', identities[0]);
    expect(state.body.state.revision).toBe(revision); expect(state.body.ballot).toEqual({ option: 1, version: 2 });
  });
});
describe('poll management authorization', () => {
  it('reports immediate publication preparation failures as errors instead of success', async () => {
    const f = await fixture(), access = new LocalAccess(3000, 'management-secret');
    const publication = new PollPublication(f.polls, { host: null, online: false, nonce: '', start: async () => 1, stop: async () => undefined, disconnect: () => undefined }, { open: async () => { throw new Error('Windows OpenSSHを利用できません。'); } });
    cleanup.push(() => publication.stop());
    const app = express(); app.use(access.requireHost, express.json());
    registerPollManagementRoutes(app, { controller: f.polls, publication }, access.requireManagementRead, access.requireOperation);
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { if (error instanceof HttpError) res.status(error.status).json({ code: error.code, message: error.message }); else res.sendStatus(500); });
    const result = await request(app).post('/api/management/polls/publish').set('Host', '127.0.0.1:3000').set('Origin', 'http://127.0.0.1:3000').set('X-CasMate-Token', 'management-secret');
    expect(result.status).toBe(503); expect(result.body).toEqual({ code: 'POLL_PUBLICATION_FAILED', message: 'Windows OpenSSHを利用できません。' });
  });
  it('keeps history and commands behind management authorization, with redacted overlay data', async () => {
    const f = await fixture(), access = new LocalAccess(3000, 'management-secret');
    const publication = new PollPublication(f.polls, { host: null, online: false, nonce: '', start: async () => 1, stop: async () => undefined, disconnect: () => undefined }, { open: async () => ({ close: async () => undefined }) });
    cleanup.push(() => publication.stop());
    const app = express(); app.use(access.requireHost, express.json());
    registerPollManagementRoutes(app, { controller: f.polls, publication }, access.requireManagementRead, access.requireOperation);
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { if (error instanceof HttpError) res.status(error.status).json({ code: error.code }); else res.sendStatus(500); });
    expect((await request(app).get('/api/management/polls').set('Host', '127.0.0.1:3000')).status).toBe(403);
    expect((await request(app).post('/api/management/polls/reveal').set('Host', '127.0.0.1:3000').set('Origin', 'http://127.0.0.1:3000').send({ visible: true })).status).toBe(403);
    const admin = await request(app).get('/api/management/polls').set('Host', '127.0.0.1:3000').set('X-CasMate-Management', 'management-secret');
    expect(admin.body.current.counts).toEqual([0, 0]); expect(admin.body).toHaveProperty('history');
    const overlay = await request(app).get('/api/overlays/poll').set('Host', '127.0.0.1:3000');
    expect(overlay.body.poll).not.toHaveProperty('counts'); expect(overlay.body).not.toHaveProperty('history');
    expect((await request(app).get('/api/overlays/poll').set('Host', '127.0.0.1:3000').set('Origin', 'https://evil.example')).status).toBe(403);
    const reveal = await request(app).post('/api/management/polls/reveal').set('Host', '127.0.0.1:3000').set('Origin', 'http://127.0.0.1:3000').set('X-CasMate-Token', 'management-secret').send({ visible: true });
    expect(reveal.status).toBe(200); expect((await request(app).get('/api/overlays/poll').set('Host', '127.0.0.1:3000')).body.poll.counts).toEqual([0, 0]);
    expect((await request(app).post('/api/management/polls/start').set('Host', '127.0.0.1:3000').set('Origin', 'http://127.0.0.1:3000').set('X-CasMate-Token', 'management-secret')).status).toBe(409);
  });
});
