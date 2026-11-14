import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { atomicBytes } from '../core/compatibility-storage';
import type { SecretProtection } from '../core/secret-protection';
import { canonicalSrvUrl } from '../poll/srv-us-tunnel';
import { reactionRecord, type ReactionNamedShareView } from '../../shared/listener-reactions';
import { ReactionError } from './reaction-controller';

const origin = 'https://kyokutyou.com';
const token = /^[a-f0-9]{64}$/u;
const operationId = /^[a-f0-9-]{36}$/u;
const namePattern = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/u;
type Action = 'claim' | 'refresh';
interface Mutation { action: Action; id: string; target: string; revision: number; name: string; invite: string; time: number; publication: number; session: string }
interface Stored { key: string; pending?: Mutation }
interface Remote { enrolled: boolean; active: boolean; name: string | null; target: string | null; expiresAt: number; now: number; revision: number }
interface Connection { url: string; publication: number; signal: AbortSignal }
const empty: ReactionNamedShareView = { revision: 0, enrolled: false, name: null, url: null, expiresAt: 0, message: '' };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export class ReactionNamedShare {
  private current?: Connection;
  private readonly session = randomUUID();
  private acknowledgedPublication = 0;
  private snapshot = empty;
  private tail = Promise.resolve();
  private proof?: { digest: string; id: string; connection: Connection; expiresAt: number };

  constructor(private readonly path: string, private readonly protection: SecretProtection,
    private readonly request: typeof fetch = fetch, private readonly now = Date.now) {}

  view(): ReactionNamedShareView {
    if (this.snapshot.name && this.snapshot.expiresAt <= this.now()) {
      this.update({ ...this.snapshot, name: null, url: null, message: '有効期限を過ぎました。リンクを再確認してください。' });
    }
    if (this.current?.signal.aborted && this.snapshot.url) this.update({ ...this.snapshot, url: null });
    return { ...this.snapshot };
  }

  ready(url: string, publication: number, signal: AbortSignal) {
    this.current = { url, publication, signal };
    this.update({ ...this.snapshot, url: null });
    void this.enqueue(() => this.synchronize(false)).catch(() => undefined);
  }

  verifyProof(body: unknown): boolean {
    const proof = this.proof;
    return !!proof && this.live(proof.connection) && proof.expiresAt > this.now() && reactionRecord(body) &&
      body.id === proof.id && body.target === proof.connection.url && typeof body.proof === 'string' &&
      token.test(body.proof) && digest(body.proof) === proof.digest;
  }

  claim(input: unknown): Promise<void> {
    const rawName = reactionRecord(input) && typeof input.name === 'string' ? input.name.trim() : '';
    const name = rawName.toLowerCase();
    const invite = reactionRecord(input) && typeof input.invite === 'string' ? input.invite.trim().toLowerCase() : '';
    if (!/^[a-zA-Z0-9-]+$/u.test(rawName) || !namePattern.test(name) || invite && !token.test(invite)) throw new ReactionError(400, '名前または招待コードを確認してください。');
    return this.enqueue(async () => {
      const connection = this.connection();
      const stored = await this.load() ?? { key: randomBytes(32).toString('hex') };
      const state = await this.recover(stored, connection);
      this.apply(state, connection);
      if (!state.enrolled && !invite) throw new ReactionError(403, 'テスト利用者用の招待コードを入力してください。');
      if (state.name === name && state.target === connection.url) { this.apply(state, connection); return; }
      await this.mutate(stored, state, connection, 'claim', name, state.enrolled ? '' : invite);
      this.acknowledgedPublication = connection.publication;
    });
  }

  refresh() { return this.enqueue(() => this.synchronize(true)); }

  private enqueue(work: () => Promise<void>): Promise<void> {
    const result = this.tail.then(work).catch((error: unknown) => {
      if (!this.current?.signal.aborted) this.update({ ...this.snapshot, url: error instanceof ReactionError && [400, 409, 422, 429].includes(error.status) ? this.snapshot.url : null, message: error instanceof ReactionError ? error.message : '名前付きリンクを確認できません。直接リンクを使えます。' });
      throw error;
    });
    this.tail = result.catch(() => undefined);
    return result;
  }

  private async synchronize(explicit: boolean) {
    const connection = this.current;
    if (!connection || !this.live(connection)) {
      if (explicit) this.connection();
      return;
    }
    const stored = await this.load();
    if (!stored) {
      if (explicit) throw new ReactionError(404, '名前付きリンクはまだ発行していません。');
      return;
    }
    const state = await this.recover(stored, connection);
    if (!this.live(connection)) return;
    if (state.active && (state.target !== connection.url || this.acknowledgedPublication !== connection.publication)) {
      await this.mutate(stored, state, connection, 'refresh', '', '');
      this.acknowledgedPublication = connection.publication;
    } else {
      this.apply(state, connection);
      if (explicit && !state.name) throw new ReactionError(410, '有効な名前がありません。名前を入力して発行してください。');
    }
  }

  private live(connection: Connection) { return this.current === connection && !connection.signal.aborted; }
  private connection() {
    if (!this.current || !this.live(this.current)) throw new ReactionError(409, 'リスナーページを公開してから操作してください。');
    return this.current;
  }

  private async load(): Promise<Stored | undefined> {
    let bytes: Buffer;
    try { bytes = await readFile(this.path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    const data = JSON.parse(this.protection.decryptString(bytes)) as Stored;
    const pending = data?.pending;
    if (!data || !token.test(data.key) || pending && (!operationId.test(pending.id) || !canonicalSrvUrl(pending.target) ||
      !['claim', 'refresh'].includes(pending.action) || !Number.isSafeInteger(pending.revision) || !Number.isFinite(pending.time) ||
      typeof pending.name !== 'string' || typeof pending.invite !== 'string')) throw new Error('invalid share state');
    return data;
  }

  private async save(stored: Stored) {
    if (!this.protection.isEncryptionAvailable()) throw new ReactionError(503, '更新キーを保護できません。');
    await atomicBytes(this.path, this.protection.encryptString(JSON.stringify(stored)));
  }

  private async recover(stored: Stored, connection: Connection): Promise<Remote> {
    const pending = stored.pending;
    const state = await this.call(stored.key, 'status', pending ? { id: pending.id } : {}, connection);
    if (!pending) return state;
    const currentPublication = pending.session === this.session && pending.publication === connection.publication;
    if (state.completed && state.target === connection.url && currentPublication) this.acknowledgedPublication = connection.publication;
    if (!state.completed && currentPublication && pending.target === connection.url && pending.revision === state.revision && this.now() - pending.time < 86_400_000) {
      try {
        const result = await this.send(stored, pending, connection);
        this.acknowledgedPublication = connection.publication;
        return result;
      } catch (error) { if (!(error instanceof ReactionError) || error.status >= 500 || error.status === 429) throw error; }
    }
    await this.save({ key: stored.key });
    delete stored.pending;
    return state;
  }

  private async mutate(stored: Stored, state: Remote, connection: Connection, action: Action, name: string, invite: string) {
    const mutation = { action, id: randomUUID(), target: connection.url, revision: state.revision, name, invite, time: this.now(), publication: connection.publication, session: this.session };
    await this.save({ key: stored.key, pending: mutation });
    try { this.apply(await this.send(stored, mutation, connection), connection); }
    catch (error) {
      if (error instanceof ReactionError && error.status < 500) await this.save({ key: stored.key });
      throw error;
    }
  }

  private async send(stored: Stored, mutation: Mutation, connection: Connection) {
    const proof = randomBytes(32).toString('hex');
    this.proof = { digest: digest(proof), id: mutation.id, connection, expiresAt: this.now() + 30_000 };
    try {
      const { id, target, revision, name, invite } = mutation;
      const result = await this.call(stored.key, mutation.action, { id, target, revision, name, invite, proof }, connection);
      await this.save({ key: stored.key });
      delete stored.pending;
      return result;
    } finally { this.proof = undefined; }
  }

  private apply(state: Remote, connection: Connection) {
    if (!this.live(connection)) return;
    const expiresAt = state.expiresAt;
    this.update({ enrolled: state.enrolled, name: state.name, expiresAt,
      url: state.name && state.target === connection.url && expiresAt > this.now() ? `${origin}/live/${state.name}` : null,
      message: state.enrolled && !state.name ? '有効な名前がありません。名前を入力して発行できます。' : '' });
  }

  private update(view: Omit<ReactionNamedShareView, 'revision'>) {
    this.snapshot = { ...view, revision: this.snapshot.revision + 1 };
  }

  private async call(key: string, action: string, body: object, connection: Connection): Promise<Remote & { completed: boolean }> {
    if (!this.live(connection)) throw new ReactionError(503, '公開先が変わりました。');
    const requestedAt = this.now();
    const response = await this.request(`${origin}/api/casmate-share/v1/${action}`, { method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify(body),
      signal: AbortSignal.any([connection.signal, AbortSignal.timeout(7000)]) });
    if (!response.ok) {
      await response.body?.cancel();
      const messages: Record<number, string> = { 400: '共有リンクの名前を確認してください。', 403: '招待コードまたは更新権限を確認してください。', 409: '名前が使用中か、状態が変わりました。別の名前を選ぶか、再確認してください。', 422: '公開先を確認できません。', 429: '発行の上限に達しました。時間をおいて再試行してください。' };
      throw new ReactionError(response.status, messages[response.status] ?? '名前付きリンクを確認できません。直接リンクを使えます。');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('missing share response');
    let text = '';
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        text += Buffer.from(chunk.value).toString('utf8');
        if (text.length > 4096) throw new Error('oversize share response');
      }
    } finally { await reader.cancel().catch(() => undefined); }
    const result = JSON.parse(text) as Remote & { completed: boolean };
    if (typeof result.enrolled !== 'boolean' || typeof result.active !== 'boolean' || typeof result.completed !== 'boolean' ||
      !Number.isSafeInteger(result.now) || !Number.isSafeInteger(result.expiresAt) || !Number.isSafeInteger(result.revision) ||
      result.name !== null && !namePattern.test(result.name) || result.target !== null && !canonicalSrvUrl(result.target)) throw new Error('invalid share response');
    return { ...result, expiresAt: requestedAt + Math.max(0, result.expiresAt - result.now - 1000) };
  }
}
