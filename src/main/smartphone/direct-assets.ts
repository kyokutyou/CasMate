import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { isPublicAddress } from '../../shared/direct-connection';
import type { CommonComment } from '../../shared/types';

/** Only images actually received from a comment source can become authenticated PC assets. */
export class DirectCommentAssets {
  private readonly urls = new Map<string, string>();
  private readonly cache = new Map<string, { bytes: Buffer; type: string }>();
  project(comment: CommonComment): CommonComment {
    return { ...comment, content: comment.content.map(part => {
      if (part.type !== 'emote') return part;
      let url: URL;
      try { url = new URL(part.url); } catch { return { type: 'text' as const, text: part.alt }; }
      const allowed = url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash &&
        ['static-cdn.jtvnw.net', 'yt3.ggpht.com', 'yt4.ggpht.com', 'yt3.googleusercontent.com', 'www.gstatic.com', 'i.ytimg.com'].includes(url.hostname);
      if (!allowed) return { type: 'text' as const, text: part.alt };
      const id = createHash('sha256').update(url.href).digest('hex');
      if (!this.urls.has(id)) {
        if (this.urls.size >= 2048) { const oldest = this.urls.keys().next().value!; this.urls.delete(oldest); this.cache.delete(oldest); }
        this.urls.set(id, url.href);
      }
      return { ...part, url: `https://comments.casmate.invalid/mobile/assets/${id}` };
    }) };
  }
  async get(id: string, signal?: AbortSignal): Promise<{ bytes: Buffer; type: string } | null> {
    signal?.throwIfAborted();
    const target = this.urls.get(id); if (!target) return null;
    const cached = this.cache.get(id); if (cached) return cached;
    const deadline = AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]);
    let abort!: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(deadline.reason);
      deadline.addEventListener('abort', abort, { once: true });
    });
    try {
      const result = await Promise.race([this.load(new URL(target), deadline), cancelled]);
      deadline.throwIfAborted();
      if (result && this.urls.get(id) === target) {
        while ([...this.cache.values()].reduce((n, v) => n + v.bytes.length, 0) + result.bytes.length > 4 * 1024 * 1024 && this.cache.size) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(id, result);
      }
      return result;
    } finally { deadline.removeEventListener('abort', abort); }
  }
  private async load(url: URL, signal: AbortSignal): Promise<{ bytes: Buffer; type: string } | null> {
    signal.throwIfAborted();
    const addresses = await lookup(url.hostname, { all: true });
    // lookup itself cannot be cancelled; discard a late answer before opening HTTPS.
    signal.throwIfAborted();
    if (!addresses.length || addresses.some(a => !isPublicAddress(a.family === 6 ? 'ipv6' : 'ipv4', a.address))) return null;
    const address = addresses[0]!;
    return new Promise<{ bytes: Buffer; type: string } | null>((resolve, reject) => {
      let length = 0; const chunks: Buffer[] = [];
      const req = request(url, { signal, lookup: (_name, _options, callback) => callback(null, address.address, isIP(address.address)) }, res => {
        const type = res.headers['content-type']?.split(';')[0];
        if (res.statusCode !== 200 || !type || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(type)) { res.resume(); resolve(null); return; }
        res.on('data', (data: Buffer) => { length += data.length; if (length > 512 * 1024) req.destroy(); else chunks.push(data); });
        res.once('error', reject); res.once('end', () => resolve({ bytes: Buffer.concat(chunks), type }));
      });
      req.once('error', reject); req.end();
    });
  }
}
