import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { ReactionNamedShare } from '../src/main/reactions/reaction-named-share';

it('scopes proof to the current publication and reconciles an accepted operation after response loss', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'casmate-named-share-'));
  const target = `https://${'a'.repeat(26)}.srv.us/`;
  const invite = 'b'.repeat(64);
  let now = 100_000, revision = 0, name: string | null = null, expiresAt = 0;
  let lastOperation = '', loseResponse = false, failBeforeCommit = false, refreshes = 0;
  const connection = new AbortController();
  const request: typeof fetch = async (url, options) => {
    const action = String(url).split('/').at(-1);
    const input = JSON.parse(String(options?.body));
    if (action !== 'status') {
      expect(input.revision).toBe(revision);
      expect(service.verifyProof({ ...input, proof: '0'.repeat(64) })).toBe(false);
      expect(service.verifyProof({ ...input, target: 'https://not-the-publication.test/' })).toBe(false);
      expect(service.verifyProof(input)).toBe(true);
      if (failBeforeCommit) { failBeforeCommit = false; throw new Error('connection closed before commit'); }
      if (action === 'claim') { expect(input.invite).toBe(name ? '' : invite); name = input.name; }
      else refreshes++;
      revision++;
      lastOperation = input.id;
      expiresAt = now + 2_592_000_000;
      if (loseResponse) { loseResponse = false; throw new Error('lost response'); }
    }
    return Response.json({ enrolled: !!name, active: !!name, name, target: name ? target : null, expiresAt, now, revision, completed: input.id === lastOperation });
  };
  const service = new ReactionNamedShare(join(directory, 'share.protected'), {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(value),
    decryptString: value => value.toString(),
  }, request, () => now);
  try {
    service.ready(target, 1, connection.signal);
    await expect(service.claim({ name: 'yofukashi' })).rejects.toThrow('招待コード');
    loseResponse = true;
    await expect(service.claim({ name: 'YO-FUKASHI', invite })).rejects.toThrow('lost response');
    expect(service.view().url).toBeNull();
    await service.refresh();
    expect(service.view().url).toBe('https://kyokutyou.com/live/yo-fukashi');
    expect(revision).toBe(1);
    service.ready(target, 1, connection.signal);
    await service.refresh();
    expect(refreshes).toBe(0);
    service.ready(target, 2, connection.signal);
    await service.refresh();
    expect(refreshes).toBe(1);
    failBeforeCommit = true;
    await expect(service.claim({ name: 'abandoned' })).rejects.toThrow('before commit');
    connection.abort();
    const nextConnection = new AbortController();
    service.ready(target, 3, nextConnection.signal);
    await service.refresh();
    expect(service.view().name).toBe('yo-fukashi');
    expect(refreshes).toBe(2);
    now = expiresAt;
    expect(service.view().url).toBeNull();
    nextConnection.abort();
    expect(service.verifyProof({})).toBe(false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
