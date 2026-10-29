import iconv from 'iconv-lite';
import { describe, expect, it, vi } from 'vitest';
import { FetchJpnknWriteAdapter } from '../src/main/board/jpnkn-write-adapter';
import { BoardWriteFailure, createBoardWriteAdapter } from '../src/main/board/board-write-adapter';
import { normalizeBoardInput, normalizeJpnknInput } from '../src/main/sources/source-inputs';
import { ShitarabaWriteFailure } from '../src/main/shitaraba/shitaraba-write-adapter';

const current = normalizeJpnknInput('https://bbs.jpnkn.com/test/read.cgi/testboard/123/');
const createRequest = { currentThread: current, title: '新スレ2', body: '本文', authorName: '', email: '' };
const replyRequest = { currentThread: current, message: '案内 https://example.test/', authorName: 'AI', email: 'sage' };
// Structure from the public GET forms; no real comment, poster, or token data.
function form(create: boolean): string {
  return '<meta charset="Shift_JIS"><form method="POST" action="/test/bbs.cgi">' +
    (create ? '<input type="text" name="subject">' : '') +
    '<input type="text" name="FROM"><input type="text" name="mail">' +
    '<input type="submit" id="submit" value="書き込む">' +
    '<textarea name="MESSAGE" required></textarea>' +
    (create ? '' : '<input type="hidden" name="key" value="123">') +
    '<input type="hidden" name="bbs" value="testboard"></form>';
}
function html(text: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(iconv.encode(text, 'cp932'), { status, headers: { 'Content-Type': 'text/html; charset=Shift_JIS', ...headers } });
}
function plain(text: string): Response { return html(text, 200, { 'Content-Type': 'text/plain; charset=Shift_JIS' }); }
function mockWrite(page: string, result: () => Response = () => html('<title>書きこみました</title>')) {
  const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) =>
    init?.method === 'POST' ? result() : html(page));
  return { fetcher, writer: new FetchJpnknWriteAdapter({ fetch: fetcher }) };
}
function submitted(fetcher: ReturnType<typeof mockWrite>['fetcher']): Array<[string, string]> {
  const body = fetcher.mock.calls.find(call => call[1]?.method === 'POST')?.[1]?.body;
  const source = Buffer.from(body as Uint8Array).toString('ascii');
  return source.split('&').map(field => {
    const [name, value = ''] = field.split('=');
    const decode = (text: string) => iconv.decode(Buffer.from(text.replace(/\+/g, ' ').replace(/%([0-9a-f]{2})/gi,
      (_token, byte: string) => String.fromCharCode(Number.parseInt(byte, 16))), 'latin1'), 'cp932');
    return [decode(name), decode(value)];
  });
}

describe('jpnkn書き込みアダプター', () => {
  it.each(['CAPTCHAの仕組みを教えて', 'turnstileという単語', '利用認証が必要です',
    '<a href="https://auth.bbs.jpnkn.com/">認証の説明リンク</a>'])('通常スレッドの引用を認証要求と誤認しない: %s', async quoted => {
    const { writer, fetcher } = mockWrite('<title>利用認証の相談</title><div class="post">' + quoted + '</div>' + form(false));
    await expect(writer.postAiComment(replyRequest)).resolves.toBeUndefined();
    expect(fetcher.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(1);
  });

  it('本文の行内インデントと末尾空白を保ち、前後の空白行だけを除く', async () => {
    const writer = new FetchJpnknWriteAdapter({ fetch: async () =>
      plain('名前<>sage<>date<> <br>  一行目<br> 二行目  <br> <br><>新スレ1\n') });
    await expect(writer.fetchThreadContent(current)).resolves.toEqual({ title: '新スレ1', body: '  一行目\n 二行目  ' });
  });
  it('subject一覧の完全一致だけを返し現行と重複を除外する', async () => {
    const fetcher = vi.fn(async () => plain('123.dat<>新スレ2 (8)\n456.dat<>  新スレ2  (1)\n457.dat<>新スレ3 (1)\n456.dat<>新スレ2 (1)\n458.dat<>新スレ2 (1)\n'));
    const writer = new FetchJpnknWriteAdapter({ fetch: fetcher });
    await expect(writer.findThreadsByTitle(current, '新スレ2')).resolves.toEqual([
      'https://bbs.jpnkn.com/test/read.cgi/testboard/456/',
      'https://bbs.jpnkn.com/test/read.cgi/testboard/458/',
    ]);
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://bbs.jpnkn.com/testboard/subject.txt');
  });

  it('一覧の未知の非空行を0件扱いして作成へ進まない', async () => {
    const writer = new FetchJpnknWriteAdapter({ fetch: async () => plain('123.dat<>現行 (8)\nchanged-format\n') });
    await expect(writer.findThreadsByTitle(current, '新')).rejects.toMatchObject({ kind: 'preflight' });
  });

  it('DATの1レス目からCP932拡張・HTML本文とタイトルを取得する', async () => {
    const writer = new FetchJpnknWriteAdapter({ fetch: async () =>
      plain('名前<>sage<>date<>髙橋<br>本文 &copy;<script>bad()</script><>配信09 &amp; 次\n名前<>mail<>date<>後続<>\n') });
    await expect(writer.fetchThreadContent(current)).resolves.toEqual({ title: '配信09 & 次', body: '髙橋\n本文 ©' });
  });

  it('HTML応答を空のsubject一覧やDATとして扱わない', async () => {
    const writer = new FetchJpnknWriteAdapter({ fetch: async () => html('') });
    await expect(writer.findThreadsByTitle(current, '次スレ')).rejects.toMatchObject({ kind: 'preflight' });
    await expect(writer.fetchThreadContent(current)).rejects.toMatchObject({ kind: 'preflight' });
  });

  it('公開フォームに従いCP932送信しURLのhを維持する', async () => {
    const { writer, fetcher } = mockWrite(form(true), () => new Response(null, {
      status: 302, headers: { Location: 'read.cgi/testboard/456/' },
    }));
    await expect(writer.createNextThread({ ...createRequest, title: '髙橋2 https://example.test/',
      body: '本文 https://example.test/', authorName: '名前', email: 'sage' })).resolves.toEqual({
      threadUrl: 'https://bbs.jpnkn.com/test/read.cgi/testboard/456/',
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://bbs.jpnkn.com/testboard/');
    expect(fetcher.mock.calls[1]?.[0]).toBe('https://bbs.jpnkn.com/test/bbs.cgi');
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://bbs.jpnkn.com/testboard/' } });
    expect(submitted(fetcher)).toEqual([
      ['bbs', 'testboard'], ['subject', '髙橋2 https://example.test/'], ['FROM', '名前'],
      ['mail', 'sage'], ['MESSAGE', '本文 https://example.test/'],
    ]);
    expect(submitted(fetcher).some(([name]) => name === 'key')).toBe(false);
  });

  it('ブラウザの公開フォームと同じContent-TypeでCP932の生バイトを送る', async () => {
    const { writer, fetcher } = mockWrite(form(true), () => new Response(null, {
      status: 302, headers: { Location: 'read.cgi/testboard/456/' },
    }));
    await writer.createNextThread(createRequest);
    const post = fetcher.mock.calls.find(call => call[1]?.method === 'POST')?.[1];
    expect(new Headers(post?.headers).get('Content-Type')).toBe('application/x-www-form-urlencoded');
    expect(submitted(fetcher)).toContainEqual(['MESSAGE', createRequest.body]);
  });

  it('案内とAI投稿でも直前に返信フォームをGETして対象keyを使う', async () => {
    const { writer, fetcher } = mockWrite(form(false));
    await writer.announceNextThread(replyRequest);
    await writer.postAiComment(replyRequest);
    expect(fetcher.mock.calls.map(call => call[1]?.method ?? 'GET')).toEqual(['GET', 'POST', 'GET', 'POST']);
    expect(submitted(fetcher)).toEqual([
      ['key', '123'], ['bbs', 'testboard'], ['FROM', 'AI'], ['mail', 'sage'], ['MESSAGE', '案内 https://example.test/'],
    ]);
  });

  it.each([
    form(true).replace('/test/bbs.cgi', 'https://evil.test/test/bbs.cgi'),
    form(true).replace('/test/bbs.cgi', '/test/changed.cgi'),
    form(true).replace('value="testboard"', 'value="otherboard"'),
    form(true).replace('</form>', '<input type="hidden" name="key" value="123"></form>'),
    form(true).replace('name="MESSAGE"', 'name="changed"'),
    form(true).replace('</form>', '<input type="hidden" name="unknown" value="secret"></form>'),
    form(true).replace('</form>', '<select name="unknown"><option>value</option></select></form>'),
    form(true).replace('</form>', '<button name="unknown">送信</button></form>'),
    form(true).replace('method="POST"', 'method="GET"'),
    form(true).replace('<form ', '<form accept-charset="UTF-8" '),
    form(true).replace('name="FROM"', 'name="FROM" disabled'),
  ])('未知・不正フォームを無送信で止める: %s', async page => {
    const { writer, fetcher } = mockWrite(page);
    await expect(writer.createNextThread(createRequest)).rejects.toMatchObject({ kind: 'preflight' });
    expect(fetcher.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(0);
  });

  it('返信の別keyを無送信で拒否する', async () => {
    const { writer, fetcher } = mockWrite(form(false).replace('value="123"', 'value="456"'));
    await expect(writer.postAiComment(replyRequest)).rejects.toMatchObject({ kind: 'preflight' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    { title: '🙂' }, { title: 'a'.repeat(129) }, { body: 'a'.repeat(4097) },
    { authorName: 'a'.repeat(129) }, { email: 'a'.repeat(129) }, { authorName: 'name#trip' }, { body: ' ' },
  ])('文字コード・文字数・トリップを送信前に止める: %j', async changed => {
    const { writer, fetcher } = mockWrite(form(true));
    await expect(writer.createNextThread({ ...createRequest, ...changed })).rejects.toMatchObject({ kind: 'preflight' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    '<title>利用認証が必要です</title>',
    '<div class="cf-turnstile"></div>',
    form(true).replace('type="text" name="FROM"', 'type="password" name="FROM"'),
  ])('認証があるフォームはbrowserRequiredとして無送信にする: %s', async page => {
    const { writer, fetcher } = mockWrite(page);
    await expect(writer.createNextThread(createRequest)).rejects.toMatchObject({ kind: 'browserRequired' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('GETのUTF-8認証拒否もbrowserRequiredで止める', async () => {
    const fetcher = vi.fn(async () => new Response('<html><title>利用認証</title><div class="cf-turnstile"></div></html>',
      { status: 403, headers: { 'Content-Type': 'text/html; charset=UTF-8' } }));
    const writer = new FetchJpnknWriteAdapter({ fetch: fetcher });
    await expect(writer.createNextThread(createRequest)).rejects.toMatchObject({ kind: 'browserRequired' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('送信後の認証要求を成功や再試行にしない', async () => {
    const { writer, fetcher } = mockWrite(form(true), () => html('利用認証が必要です。認証トークンを取得してください。', 403));
    await expect(writer.createNextThread(createRequest)).rejects.toMatchObject({ kind: 'browserRequired' });
    expect(fetcher.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(1);
  });

  it.each([
    '<title>書きこみました</title>',
    '<title>unknown</title>',
    '<title>書きこみました</title><a href="/test/read.cgi/otherboard/456/">新スレ</a>',
    '<title>書きこみました</title><a href="/test/read.cgi/testboard/123/">元スレ</a>',
  ])('200や成功見出しだけでは作成確定せずuncertainにする: %s', async result => {
    const { writer, fetcher } = mockWrite(form(true), () => html(result));
    await expect(writer.createNextThread(createRequest)).rejects.toMatchObject({ kind: 'uncertain' });
    expect(fetcher.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(1);
  });

  it('成功見出しと同じ板の別スレッドURLを確認して確定する', async () => {
    const { writer } = mockWrite(form(true), () =>
      html('<title>書きこみました</title><meta http-equiv="refresh" content="0;url=/test/read.cgi/testboard/456/">'));
    await expect(writer.createNextThread(createRequest)).resolves.toEqual({ threadUrl: 'https://bbs.jpnkn.com/test/read.cgi/testboard/456/' });
  });

  it('明確な拒否は固定文言へ変換し外部本文を返さない', async () => {
    const { writer } = mockWrite(form(true), () => html('<title>ERROR</title>secret body NGワード'));
    try { await writer.createNextThread(createRequest); throw new Error('not rejected'); }
    catch (error) {
      expect(error).toBeInstanceOf(BoardWriteFailure);
      expect(error).toMatchObject({ kind: 'rejected' });
      expect((error as Error).message).not.toContain('secret body');
    }
  });

  it('送信後の切断をuncertainとしPOSTを再送しない', async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') throw new Error('timeout with secret body');
      return html(form(true));
    });
    const writer = new FetchJpnknWriteAdapter({ fetch: fetcher });
    await expect(writer.createNextThread(createRequest)).rejects.toMatchObject({ kind: 'uncertain' });
    expect(fetcher.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(1);
  });

  it('共通adapterはサービス別subjectへ振り分け、failure instanceofを維持する', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => String(url).includes('bbs.jpnkn.com')
      ? plain('456.dat<>次スレ (1)\n')
      : new Response(iconv.encode('456.cgi,次スレ (1)\n', 'euc-jp')));
    const writer = createBoardWriteAdapter({ fetch: fetcher });
    await expect(writer.findThreadsByTitle(normalizeBoardInput(current.url), '次スレ')).resolves.toEqual([
      'https://bbs.jpnkn.com/test/read.cgi/testboard/456/',
    ]);
    await expect(writer.findThreadsByTitle(normalizeBoardInput('https://jbbs.shitaraba.net/bbs/read.cgi/game/1/123/'), '次スレ')).resolves.toEqual([
      'https://jbbs.shitaraba.net/bbs/read.cgi/game/1/456/',
    ]);
    expect(new BoardWriteFailure('browserRequired', 'fixed')).toBeInstanceOf(ShitarabaWriteFailure);
  });

  it('共通adapterは識別子とURLが違う対象をGET前に止める', async () => {
    const fetcher = vi.fn();
    const writer = createBoardWriteAdapter({ fetch: fetcher });
    await expect(writer.postAiComment({ ...replyRequest, currentThread: { ...current, boardId: 'otherboard' } }))
      .rejects.toMatchObject({ kind: 'preflight' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
