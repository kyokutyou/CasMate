import iconv from 'iconv-lite';
import { describe, expect, it, vi } from 'vitest';
import { JpnknSource, parseJpnknDat } from '../src/main/sources/jpnkn-source';
import { normalizeJpnknInput } from '../src/main/sources/source-inputs';
import type { SourceStatus } from '../src/main/sources/source-adapter';
import type { IncomingComment } from '../src/shared/types';

const input = normalizeJpnknInput('https://bbs.jpnkn.com/test/read.cgi/testboard/123/');
const row = (text: string, title = '') => '名前<>sage<>date ID:x<>' + text + '<>' + title + '\n';
const encode = (value: string) => iconv.encode(value, 'cp932');
function dat(bytes: Uint8Array, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(bytes, { status, headers: { 'Content-Type': 'text/plain; charset=Shift_JIS', ...headers } });
}
function range(bytes: Uint8Array, cursor: number): Response {
  return dat(bytes, 206, { 'Content-Range': 'bytes ' + cursor + '-' + (cursor + bytes.length - 1) + '/' + (cursor + bytes.length) });
}
function difference(previous: Uint8Array, added = new Uint8Array()): Response {
  const start = Math.max(0, previous.length - 128);
  return range(Buffer.concat([previous.subarray(start), added]), start);
}

async function polls(responses: Response[], count = responses.length) {
  const comments: IncomingComment[] = [];
  const statuses: SourceStatus[] = [];
  const progress: number[] = [];
  const batches: IncomingComment[][] = [];
  const order: string[] = [];
  const waits: number[] = [];
  let complete!: () => void;
  const done = new Promise<void>(resolve => { complete = resolve; });
  const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
    const response = responses.shift();
    if (!response) throw new Error('unexpected request');
    return response;
  });
  const source = new JpnknSource(input, {
    onStatus: status => { statuses.push(status); order.push(status.state); if (status.state === 'error') complete(); },
    onRawAuthor: () => order.push('author'),
    onBoardBatch: batch => { batches.push(batch); order.push('batch'); },
    onBoardProgress: maximum => { progress.push(maximum); order.push('progress'); },
    onComment: comment => { comments.push(comment); order.push('comment'); },
  }, {
    fetch: fetcher,
    delay: async milliseconds => {
      waits.push(milliseconds);
      if (waits.length >= count) { await source.stop(); complete(); }
    },
  }, 7);
  await source.start(); await done; await source.stop();
  return { comments, statuses, progress, batches, order, waits, fetcher };
}

describe('jpnkn DAT取得', () => {
  it('CP932拡張文字・HTMLを変換し、削除・空・変換不能行も番号に含める', async () => {
    const bad = Buffer.concat([encode('名<>mail<>date<>'), Buffer.from([0x81, 0x20]), encode('<>title\n')]);
    const bytes = Buffer.concat([
      encode(row('髙橋<br>二行 &lt;script&gt; &amp; &hearts;<script>bad()</script>', 'title')),
      encode('<><><><><>\n\n'), bad, encode(row('最後')),
    ]);
    const authors: string[] = [];
    const parsed = await parseJpnknDat(bytes, true, 'testboard:123', 1, (_id, name) => authors.push(name));
    expect(parsed.maxResponseNumber).toBe(5);
    expect(parsed.completedRows).toBe(5);
    expect(parsed.comments).toMatchObject([
      { externalId: 'testboard:123:1', source: 'jpnkn', authorName: 'レス1', initialHistory: true,
        content: [{ type: 'text', text: '髙橋\n二行 <script> & ♥' }] },
      { externalId: 'testboard:123:5', authorName: 'レス5' },
    ]);
    expect(authors).toEqual(['名前', '名前']);
  });

  it('CP932文字の途中と未完行をバイトのまま保留する', async () => {
    const bytes = encode(row('あいうえお'));
    const split = encode('名前<>sage<>date ID:x<>').length + 1;
    const first = await parseJpnknDat(bytes.subarray(0, split), false, 'board:thread', 20);
    expect(first.comments).toEqual([]);
    expect(first.maxResponseNumber).toBeNull();
    expect(first.remainder).toEqual(bytes.subarray(0, split));
    const second = await parseJpnknDat(Buffer.concat([first.remainder, bytes.subarray(split)]), false, 'board:thread', 20);
    expect(second.comments[0]).toMatchObject({ externalId: 'board:thread:20', content: [{ type: 'text', text: 'あいうえお' }] });
    expect(second.remainder).toHaveLength(0);
  });

  it('初回100レスの履歴・全行進捗・生バイト差分・304を扱い通知順を維持する', async () => {
    const initial = encode(Array.from({ length: 105 }, (_, index) => row('旧' + (index + 1))).join(''));
    const added = encode(row('新着'));
    const result = await polls([dat(initial), difference(initial, added), new Response(null, { status: 304 })]);
    expect(result.comments).toHaveLength(101);
    expect(result.comments[0]).toMatchObject({ externalId: 'testboard:123:6', initialHistory: true });
    expect(result.comments[99]).toMatchObject({ externalId: 'testboard:123:105', initialHistory: true });
    expect(result.comments[100]).toMatchObject({ externalId: 'testboard:123:106', initialHistory: false });
    expect(result.progress).toEqual([105, 106]);
    expect(result.batches.at(-1)).toEqual([]);
    expect(result.statuses.every(status => status.source === 'shitaraba' && status.service === 'jpnkn')).toBe(true);
    expect(result.statuses.filter(status => status.state === 'connecting')).toHaveLength(1);
    expect(result.waits).toEqual([7000, 7000, 7000]);
    expect(result.order.indexOf('batch')).toBeLessThan(result.order.indexOf('progress'));
    expect(result.order.indexOf('progress')).toBeLessThan(result.order.indexOf('comment'));
    expect(result.order.indexOf('comment')).toBeLessThan(result.order.indexOf('connected'));
    const firstInit = result.fetcher.mock.calls[0]?.[1];
    const secondInit = result.fetcher.mock.calls[1]?.[1];
    expect(firstInit?.headers).toEqual({ 'Accept-Encoding': 'identity' });
    expect(secondInit?.headers).toEqual({ 'Accept-Encoding': 'identity', Range: 'bytes=' + Math.max(0, initial.length - 128) + '-' });
  });

  it('初回の未完行は後で履歴になり、それ以降の新着と区別する', async () => {
    const full = encode(Array.from({ length: 105 }, (_, index) => row('旧' + (index + 1))).join(''));
    const initial = full.subarray(0, full.length - 2);
    const added = Buffer.concat([full.subarray(full.length - 2), encode(row('新着'))]);
    const result = await polls([dat(initial), difference(initial, added)]);
    expect(result.comments.filter(comment => comment.initialHistory)).toHaveLength(100);
    expect(result.comments.at(-2)).toMatchObject({ externalId: 'testboard:123:105', initialHistory: true });
    expect(result.comments.at(-1)).toMatchObject({ externalId: 'testboard:123:106', initialHistory: false });
  });

  it.each([false, true])('全文復旧でも初回のCP932未完レスを履歴として維持する（未完継続: %s）', async remainPartial => {
    const firstRows = encode(row('旧1') + row('旧2'));
    const lastRow = encode(row('履歴あ'));
    const split = encode('名前<>sage<>date ID:x<>履歴').length + 1;
    const initial = Buffer.concat([firstRows, lastRow.subarray(0, split)]);
    const changedRows = encode(row('編集1') + row('旧2'));
    const recovered = Buffer.concat([changedRows, remainPartial ? lastRow.subarray(0, split) : lastRow, ...(remainPartial ? [] : [encode(row('新4'))])]);
    const invalidRange = range(recovered, 0);
    const responses = [dat(initial), invalidRange, dat(recovered)];
    if (remainPartial) responses.push(difference(recovered, Buffer.concat([lastRow.subarray(split), encode(row('新4'))])));
    const result = await polls(responses, remainPartial ? 3 : 2);
    expect(result.comments.map(comment => comment.externalId)).toEqual([
      'testboard:123:1', 'testboard:123:2', 'testboard:123:3', 'testboard:123:4',
    ]);
    expect(result.comments.at(-2)).toMatchObject({ initialHistory: true, content: [{ type: 'text', text: '履歴あ' }] });
    expect(result.comments.at(-1)).toMatchObject({ initialHistory: false, content: [{ type: 'text', text: '新4' }] });
  });

  it.each([416, 205])('HTTP %sから全文へ戻し過去レスを再送しない', async status => {
    const initial = encode(row('以前1') + row('以前2'));
    const full = encode(row('削除後の短文') + row('以前2') + row('新着3'));
    const result = await polls([dat(initial), new Response(null, { status }), dat(full)], 2);
    expect(result.comments.map(comment => comment.externalId)).toEqual(['testboard:123:1', 'testboard:123:2', 'testboard:123:3']);
    expect(result.fetcher).toHaveBeenCalledTimes(3);
    expect(result.fetcher.mock.calls[2]?.[1]?.headers).toEqual({ 'Accept-Encoding': 'identity' });
  });

  it('Rangeを無視した200を全文として再同期し、新着だけを通知する', async () => {
    const initial = encode(row('旧'));
    const result = await polls([dat(initial), dat(encode(row('旧') + row('新')))]);
    expect(result.comments.map(comment => comment.externalId)).toEqual(['testboard:123:1', 'testboard:123:2']);
    expect(result.fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    { 'Content-Range': 'bytes 0-1/2' },
    { 'Content-Range': 'unknown' },
    { 'Content-Range': 'bytes 1-999/1000' },
    { 'Content-Length': '999' },
  ])('差分の位置・長さ不整合で全文復旧する: %j', async headers => {
    const initial = encode(row('旧'));
    const added = encode(row('新'));
    const invalid = dat(Buffer.concat([initial, added]), 206, { 'Content-Range': 'bytes 0-' + (initial.length + added.length - 1) + '/' + (initial.length + added.length), ...headers });
    const result = await polls([dat(initial), invalid, dat(Buffer.concat([initial, added]))], 2);
    expect(result.comments.map(comment => comment.externalId)).toEqual(['testboard:123:1', 'testboard:123:2']);
    expect(result.fetcher).toHaveBeenCalledTimes(3);
  });

  it('圧縮応答では進捗とカーソルを更新せず再試行する', async () => {
    const initial = encode(row('旧'));
    const added = encode(row('新'));
    const result = await polls([dat(initial), dat(added, 206, { 'Content-Encoding': 'gzip' }), difference(initial, added)]);
    expect(result.comments).toHaveLength(2);
    expect(result.statuses.some(status => status.state === 'reconnecting')).toBe(true);
    expect(result.fetcher.mock.calls[1]?.[1]?.headers).toEqual(result.fetcher.mock.calls[2]?.[1]?.headers);
  });

  it('128byte未満のDAT全体を重ねてもコメント・未完行へ二重追加しない', async () => {
    const initial = encode(row('旧'));
    const added = encode(row('新'));
    const result = await polls([dat(initial), difference(initial), difference(initial, added)]);
    expect(initial.length).toBeLessThan(128);
    expect(result.comments.map(comment => comment.externalId)).toEqual(['testboard:123:1', 'testboard:123:2']);
    expect(result.batches[1]).toEqual([]);
    expect(result.fetcher.mock.calls[1]?.[1]?.headers).toEqual({ 'Accept-Encoding': 'identity', Range: 'bytes=0-' });
  });

  it.each(['edit', 'shorten'])('旧行%sによるバイト位置ずれを重ね部分で検出し全文へ戻す', async change => {
    const initial = encode(row('以前'.repeat(100)) + row('最後'.repeat(100)));
    const changed = encode((change === 'edit' ? row('以前'.repeat(100)) + row('変更'.repeat(100)) : row('削除') + row('最後'.repeat(100))) +
      row('新着'.repeat(200)));
    const start = initial.length - 128;
    const result = await polls([dat(initial), range(changed.subarray(start), start), dat(changed)], 2);
    expect(result.fetcher).toHaveBeenCalledTimes(3);
    expect(result.comments).toHaveLength(3);
    expect(result.comments.at(-1)).toMatchObject({ externalId: 'testboard:123:3', initialHistory: false,
      content: [{ type: 'text', text: '新着'.repeat(200) }] });
    expect(result.progress).toEqual([2, 3]);
  });

  it('停止後に完了したGETからコメントや接続済み通知を出さない', async () => {
    let resolve!: (response: Response) => void;
    const pending = new Promise<Response>(complete => { resolve = complete; });
    const statuses: SourceStatus[] = [];
    const onComment = vi.fn();
    const source = new JpnknSource(input, { onComment, onStatus: status => statuses.push(status) }, {
      fetch: async () => pending, delay: async () => undefined,
    });
    await source.start(); await source.stop();
    resolve(dat(encode(row('遅延'))));
    await new Promise(complete => setTimeout(complete, 0));
    expect(onComment).not.toHaveBeenCalled();
    expect(statuses.at(-1)?.state).toBe('stopped');
    expect(statuses.some(status => status.state === 'connected')).toBe(false);
  });
});
