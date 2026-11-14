import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PollController } from '../src/main/poll/poll-controller';
import { emptyPollData, parsePollData, PollStore, type PollData } from '../src/main/poll/poll-store';

const controllers: PollController[] = [];
const directories: string[] = [];
afterEach(async () => { await Promise.all(controllers.splice(0).map(c => c.shutdown())); await Promise.all(directories.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
async function fixture() {
  let saved = emptyPollData();
  let clock = 100_000;
  const save = vi.fn(async (data: PollData) => { saved = structuredClone(data); });
  const store = { load: async () => structuredClone(saved), save };
  const c = new PollController(store, () => clock); controllers.push(c); await c.initialize();
  await c.draft({ question: '次に何をする？', options: ['ゲーム', '雑談'], durationMinutes: 1 }); await c.start();
  const vote = (voter: string, option = 0, version = 0, requestId = randomUUID()) => c.vote(voter, { pollId: c.view().current!.id, option, version, requestId });
  return { c, vote, save, store, saved: () => saved, advance: (ms: number) => { clock += ms; } };
}
describe('listener poll controller', () => {
  it('counts one vote per browser, moves it, rejects a stale tab and deduplicates requests', async () => {
    const { c, vote } = await fixture();
    const requestId = randomUUID(); await vote('browser', 0, 0, requestId); await vote('browser', 0, 0, requestId);
    expect(c.view().current?.counts).toEqual([1, 0]);
    await vote('browser', 1, 1);
    await expect(vote('browser', 0, 1)).rejects.toMatchObject({ code: 'POLL_BALLOT_CHANGED' });
    expect(c.view().current?.counts).toEqual([0, 1]);
    expect(c.ballot('browser')).toEqual({ option: 1, version: 2 });
  });
  it('serializes simultaneous requests from two tabs and different voters', async () => {
    const { c, vote } = await fixture();
    const results = await Promise.allSettled([vote('same'), vote('same', 1), vote('other', 1)]);
    expect(results.map(x => x.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
    expect(c.view().current?.counts).toEqual([1, 1]);
  });
  it('omits all counts until reveal and does not reveal on close', async () => {
    const { c, vote, saved } = await fixture(); await vote('browser');
    expect(c.publicView().poll).not.toHaveProperty('counts');
    await c.close(); expect(c.publicView().poll).not.toHaveProperty('counts');
    expect(saved().ballots).toEqual({}); expect(c.view().history[0].counts).toEqual([1, 0]);
    await c.reveal(true); expect(c.publicView().poll?.counts).toEqual([1, 0]);
    await c.reveal(false); expect(c.publicView().poll).not.toHaveProperty('counts');
  });
  it('rejects a vote on the deadline and commits the closure first', async () => {
    const { c, vote, advance } = await fixture(); advance(60_000);
    await expect(vote('browser')).rejects.toMatchObject({ code: 'POLL_CLOSED' });
    expect(c.view().current?.closeReason).toBe('deadline'); expect(c.view().current?.counts).toEqual([0, 0]);
  });
  it('does not acknowledge, publish or retain an unsaved vote; later save recovers', async () => {
    const { c, vote, save } = await fixture(); const listener = vi.fn(); c.subscribe(listener);
    const revision = c.view().revision;
    save.mockRejectedValueOnce(new Error('disk full'));
    await expect(vote('browser')).rejects.toMatchObject({ code: 'POLL_SAVE_FAILED' });
    expect(c.view().current?.counts).toEqual([0, 0]); expect(c.view().revision).toBe(revision); expect(c.ballot('browser')).toBeNull();
    await vote('browser'); expect(c.view().error).toBeNull(); expect(c.view().current?.counts).toEqual([1, 0]);
    expect(listener).toHaveBeenCalled();
  });
  it('closes an interrupted persisted poll on startup and retains aggregate history only', async () => {
    const { vote, store, saved } = await fixture(); await vote('browser');
    const c = new PollController(store); controllers.push(c); await c.initialize();
    expect(c.view().current?.closeReason).toBe('interrupted'); expect(c.view().current?.counts).toEqual([1, 0]);
    expect(saved().ballots).toEqual({}); expect(c.view().history).toHaveLength(1);
    expect(parsePollData(saved())).toEqual(saved());
  });
  it('duplicates closed polls, starts with new id and hidden results, deletes history', async () => {
    const { c, vote } = await fixture(); await vote('browser'); await c.close(); await c.reveal(true);
    const id = c.view().current!.id; await c.duplicate(id); await c.start();
    expect(c.view().current?.id).not.toBe(id); expect(c.view().current?.resultsVisible).toBe(false); expect(c.view().current?.counts).toEqual([0, 0]);
    await expect(c.delete(c.view().current!.id)).rejects.toMatchObject({ code: 'POLL_OPEN' });
    await c.delete(id); expect(c.view().history).toEqual([]);
  });
  it('validates empty/duplicate options and saves incomplete drafts without starting', async () => {
    const { c } = await fixture(); await c.close();
    await c.draft({ question: '  ', options: ['', ''], durationMinutes: null });
    await expect(c.start()).rejects.toMatchObject({ code: 'POLL_DRAFT_INCOMPLETE' });
    await c.draft({ question: 'お題', options: ['同じ', ' 同じ '], durationMinutes: null });
    await expect(c.start()).rejects.toMatchObject({ code: 'POLL_DRAFT_INCOMPLETE' });
  });
  it('isolates corrupt files and preserves the original', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'casmate-poll-')); directories.push(directory);
    const path = join(directory, 'poll.json'); await writeFile(path, '{broken');
    const c = new PollController(new PollStore(path)); controllers.push(c); await c.initialize();
    expect(c.view().available).toBe(false); expect(await readFile(path, 'utf8')).toBe('{broken');
    await expect(c.start()).rejects.toMatchObject({ code: 'POLL_UNAVAILABLE' });
  });
  it('roundtrips files and rejects inconsistent counts and anonymous records in closed polls', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'casmate-poll-')); directories.push(directory);
    const { saved, vote, c } = await fixture(); await vote('browser'); const store = new PollStore(join(directory, 'poll.json'));
    await store.save(saved()); expect(await store.load()).toEqual(saved());
    const bad = structuredClone(saved()); bad.current!.counts[0]++; expect(() => parsePollData(bad)).toThrow();
    await c.close(); const closed = structuredClone(saved()); closed.ballots['a'.repeat(64)] = { option: 0, version: 1, requestId: randomUUID() }; expect(() => parsePollData(closed)).toThrow();
  });
});
