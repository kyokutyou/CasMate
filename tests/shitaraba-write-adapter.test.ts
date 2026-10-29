import iconv from 'iconv-lite';
import { describe, expect, it, vi } from 'vitest';
import {
  FetchShitarabaWriteAdapter,
  ShitarabaWriteFailure,
} from '../src/main/shitaraba/shitaraba-write-adapter';
import { normalizeShitarabaInput } from '../src/main/sources/source-inputs';

const current = normalizeShitarabaInput(
  'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/456/',
);

describe('したらば書き込みアダプター', () => {
  it('公開中スレッドから現行スレッドを除いたタイトル完全一致候補を返す', async () => {
    const subject = [
      '456.cgi,次スレ &amp; 案内 (10)',
      '789.cgi,  次スレ &amp; 案内  (1)',
      '790.cgi,次スレ &amp; 案内2 (2)',
      '791.cgi,次スレ &amp; 案内 (3)',
      '791.cgi,次スレ &amp; 案内 (3)',
    ].join('\n');
    const adapter = new FetchShitarabaWriteAdapter({
      fetch: vi.fn(async () => new Response(iconv.encode(subject, 'euc-jp'))),
    });

    await expect(adapter.findThreadsByTitle(current, '次スレ & 案内')).resolves.toEqual([
      'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/789/',
      'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/791/',
    ]);
  });

  it('公開スレッド一覧に解析できない行があれば作成前エラーにする', async () => {
    const adapter = new FetchShitarabaWriteAdapter({
      fetch: vi.fn(async () => new Response(iconv.encode(
        '456.cgi,現行スレッド (10)\n形式が変わった行',
        'euc-jp',
      ))),
    });

    await expect(adapter.findThreadsByTitle(current, '次スレ')).rejects.toMatchObject<
      Partial<ShitarabaWriteFailure>
    >({ kind: 'preflight' });
  });

  it('現行スレッドのタイトルと1レス目をEUC-JPからプレーンテキストへ変換する', async () => {
    const raw = '1<>名前<>sage<>date<>先頭<br>https://example.test/ &amp; &gt;&gt;2 &copy; &hearts;<script>bad()</script><>配信０９\n';
    const adapter = new FetchShitarabaWriteAdapter({
      fetch: vi.fn(async () => new Response(iconv.encode(raw, 'euc-jp'))),
    });

    await expect(adapter.fetchThreadContent(current)).resolves.toEqual({
      title: '配信０９',
      body: '先頭\nhttps://example.test/ & >>2 © ♥',
    });
  });

  it('公開フォームの送信先と隠し項目を使いEUC-JPで次スレッドを作成する', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const form = `
      <form method="post" action="/bbs/write.cgi/game/123/new/" accept-charset="EUC-JP">
        <input type="hidden" name="DIR" value="game">
        <input type="hidden" name="BBS" value="123">
        <input type="hidden" name="TIME" value="987654">
        <input name="SUBJECT"><input name="NAME"><input name="MAIL">
        <textarea name="MESSAGE"></textarea>
      </form>`;
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (!init?.method) return new Response(form);
      return new Response(null, {
        status: 302,
        headers: { Location: '/bbs/read.cgi/game/123/789/' },
      });
    });
    const adapter = new FetchShitarabaWriteAdapter({ fetch: fetcher as typeof fetch });

    await expect(adapter.createNextThread({
      currentThread: current,
      title: '新スレ',
      body: '本文',
      authorName: '配信者',
      email: 'sage',
    })).resolves.toEqual({
      threadUrl: 'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/789/',
    });

    expect(requests[0]?.url).toBe('https://jbbs.shitaraba.net/game/123/');
    expect(requests[1]?.url).toBe('https://jbbs.shitaraba.net/bbs/write.cgi/game/123/new/');
    expect(requests[1]?.init).toMatchObject({
      method: 'POST',
      redirect: 'manual',
      headers: expect.objectContaining({
        'Content-Type': 'application/x-www-form-urlencoded; charset=EUC-JP',
        Referer: 'https://jbbs.shitaraba.net/game/123/',
      }),
    });
    const body = Buffer.from(requests[1]?.init?.body as Uint8Array).toString('ascii');
    expect(body).toContain('TIME=987654');
    expect(body).toContain('SUBJECT=%BF%B7%A5%B9%A5%EC');
    expect(body).not.toContain('新スレ');
  });

  it('現行スレッドへ案内するURLはスキーム先頭のhを除いて送信する', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const form = `
      <form method="post" action="/bbs/write.cgi/game/123/456/" accept-charset="EUC-JP">
        <input type="hidden" name="TIME" value="987654">
        <input name="NAME"><input name="MAIL">
        <textarea name="MESSAGE"></textarea>
      </form>`;
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      if (!init?.method) return new Response(form);
      return new Response(iconv.encode('書きこみました。', 'euc-jp'));
    });
    const adapter = new FetchShitarabaWriteAdapter({ fetch: fetcher as typeof fetch });

    await expect(adapter.announceNextThread({
      currentThread: current,
      message: '次スレッド: https://example.test/next\n参考: http://example.test/help\n隣接: prefix_https://example.test/adjacent',
      authorName: '',
      email: '',
    })).resolves.toBeUndefined();

    const body = Buffer.from(requests[1]?.init?.body as Uint8Array).toString('ascii');
    expect(body).toContain('MESSAGE=%BC%A1%A5%B9%A5%EC%A5%C3%A5%C9%3A+ttps%3A%2F%2Fexample.test%2Fnext');
    expect(body).toContain('ttp%3A%2F%2Fexample.test%2Fhelp');
    expect(body).toContain('prefix_ttps%3A%2F%2Fexample.test%2Fadjacent');
    expect(body).not.toMatch(/https?%3A%2F%2F/i);
  });

  it('次スレッド作成で送信する全項目のURLはスキーム先頭のhを除く', async () => {
    const requests: Array<{ init?: RequestInit }> = [];
    const form = `
      <form method="post" action="/bbs/write.cgi/game/123/new/" accept-charset="EUC-JP">
        <input name="SUBJECT"><input name="NAME"><input name="MAIL">
        <textarea name="MESSAGE"></textarea>
      </form>`;
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      requests.push({ init });
      if (!init?.method) return new Response(form);
      return new Response(null, {
        status: 302,
        headers: { Location: '/bbs/read.cgi/game/123/789/' },
      });
    });
    const adapter = new FetchShitarabaWriteAdapter({ fetch: fetcher as typeof fetch });

    await adapter.createNextThread({
      currentThread: current,
      title: 'https://title.example/',
      body: 'http://body.example/',
      authorName: 'HTTPS://name.example/',
      email: 'HTTP://mail.example/',
    });

    const body = Buffer.from(requests[1]?.init?.body as Uint8Array).toString('ascii');
    expect(body).toContain('SUBJECT=ttps%3A%2F%2Ftitle.example%2F');
    expect(body).toContain('MESSAGE=ttp%3A%2F%2Fbody.example%2F');
    expect(body).toContain('NAME=TTPS%3A%2F%2Fname.example%2F');
    expect(body).toContain('MAIL=TTP%3A%2F%2Fmail.example%2F');
    expect(body).not.toMatch(/https?%3A%2F%2F/i);
  });

  it('成功応答にURLがなくても送信前後に増えた同一内容のスレッドを確認する', async () => {
    const form = `
      <a href="/bbs/read.cgi/game/123/456/">現行スレッド</a>
      <form method="post" action="/bbs/write.cgi/game/123/new/" accept-charset="EUC-JP">
        <input name="SUBJECT"><input name="NAME"><input name="MAIL">
        <textarea name="MESSAGE"></textarea>
      </form>`;
    const refreshedBoard = `
      <a href="/bbs/read.cgi/game/123/789/l50">新スレ</a>
      <a href="/bbs/read.cgi/game/123/456/">現行スレッド</a>`;
    const createdThread = '1<>配信者<>sage<>date<>ttps://example.test/body<>ttps://example.test/title\n';
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(iconv.encode(form, 'euc-jp')))
      .mockResolvedValueOnce(new Response(iconv.encode(
        '<title>書きこみました。</title><p>書きこみが終わりました。</p>',
        'euc-jp',
      )))
      .mockResolvedValueOnce(new Response(iconv.encode(refreshedBoard, 'euc-jp')))
      .mockResolvedValueOnce(new Response(iconv.encode(createdThread, 'euc-jp')));
    const adapter = new FetchShitarabaWriteAdapter({ fetch: fetcher });

    await expect(adapter.createNextThread({
      currentThread: current,
      title: 'https://example.test/title',
      body: 'https://example.test/body',
      authorName: '配信者',
      email: 'sage',
    })).resolves.toEqual({
      threadUrl: 'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/789/',
    });
  });

  it('送信前から存在する同一内容のスレッドを今回の作成成功と誤認しない', async () => {
    const form = `
      <a href="/bbs/read.cgi/game/123/789/">既存スレッド</a>
      <form method="post" action="/bbs/write.cgi/game/123/new/">
        <input name="SUBJECT"><input name="NAME"><input name="MAIL">
        <textarea name="MESSAGE"></textarea>
      </form>`;
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(form))
      .mockResolvedValueOnce(new Response('<title>書きこみました。</title>'))
      .mockResolvedValueOnce(new Response(
        '<a href="/bbs/read.cgi/game/123/789/">既存スレッド</a>',
      ));
    const adapter = new FetchShitarabaWriteAdapter({ fetch: fetcher });

    await expectCreateFailure(adapter, 'uncertain');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('送信後に増えても1レス目が一致しないスレッドを作成成功と誤認しない', async () => {
    const form = '<form method="post" action="/bbs/write.cgi/game/123/new/"><input name="SUBJECT"><input name="NAME"><input name="MAIL"><textarea name="MESSAGE"></textarea></form>';
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(form))
      .mockResolvedValueOnce(new Response('<title>書きこみました。</title>'))
      .mockResolvedValueOnce(new Response(
        '<a href="/bbs/read.cgi/game/123/789/">別スレッド</a>',
      ))
      .mockResolvedValueOnce(new Response('1<>名前<>sage<>date<>別の本文<>title\n'));
    const adapter = new FetchShitarabaWriteAdapter({ fetch: fetcher });

    await expectCreateFailure(adapter, 'uncertain');
  });

  it('送信後に成功URLを確認できない応答を結果不明として自動再試行可能にしない', async () => {
    const form = '<form method="post" action="/bbs/write.cgi/game/123/new/"><input name="SUBJECT"><input name="NAME"><input name="MAIL"><textarea name="MESSAGE"></textarea><input type="hidden" name="TIME" value="1"></form>';
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(form))
      .mockResolvedValueOnce(new Response('<html>処理中</html>'))
      .mockRejectedValueOnce(new Error('board unavailable'));
    const adapter = new FetchShitarabaWriteAdapter({ fetch: fetcher });

    await expect(adapter.createNextThread({
      currentThread: current,
      title: 'title',
      body: 'body',
      authorName: '',
      email: '',
    })).rejects.toMatchObject<Partial<ShitarabaWriteFailure>>({ kind: 'uncertain' });
  });

  it('送信後の応答本文を読み切れない場合はfailedではなく結果不明にする', async () => {
    const form = '<form method="post" action="/bbs/write.cgi/game/123/new/"><input name="SUBJECT"><input name="NAME"><input name="MAIL"><textarea name="MESSAGE"></textarea></form>';
    const brokenResponse = new Response();
    brokenResponse.arrayBuffer = vi.fn(async () => {
      throw new Error('connection reset');
    });
    const adapter = new FetchShitarabaWriteAdapter({
      fetch: vi.fn()
        .mockResolvedValueOnce(new Response(form))
        .mockResolvedValueOnce(brokenResponse)
        .mockRejectedValueOnce(new Error('board unavailable')),
    });

    await expect(adapter.createNextThread({
      currentThread: current,
      title: 'title',
      body: 'body',
      authorName: '',
      email: '',
    })).rejects.toMatchObject<Partial<ShitarabaWriteFailure>>({ kind: 'uncertain' });
  });

  it('送信後のLocationを解析できない場合は結果不明にする', async () => {
    const form = '<form method="post" action="/bbs/write.cgi/game/123/new/"><input name="SUBJECT"><input name="NAME"><input name="MAIL"><textarea name="MESSAGE"></textarea></form>';
    const adapter = new FetchShitarabaWriteAdapter({
      fetch: vi.fn()
        .mockResolvedValueOnce(new Response(form))
        .mockResolvedValueOnce(new Response(null, {
          status: 302,
          headers: { Location: 'http://[invalid' },
        }))
        .mockRejectedValueOnce(new Error('board unavailable')),
    });

    await expect(adapter.createNextThread({
      currentThread: current,
      title: 'title',
      body: 'body',
      authorName: '',
      email: '',
    })).rejects.toMatchObject<Partial<ShitarabaWriteFailure>>({ kind: 'uncertain' });
  });

  it('CAPTCHAや解析不能な公開フォームは送信前に停止する', async () => {
    const adapter = new FetchShitarabaWriteAdapter({
      fetch: vi.fn(async () => new Response('<form method="post" action="/bbs/write.cgi/game/123/new/"><input name="SUBJECT"><input name="NAME"><input name="MAIL"><textarea name="MESSAGE"></textarea><input type="password" name="password"></form>')),
    });

    await expect(adapter.createNextThread({
      currentThread: current,
      title: 'title',
      body: 'body',
      authorName: '',
      email: '',
    })).rejects.toMatchObject<Partial<ShitarabaWriteFailure>>({ kind: 'preflight' });
  });

  it('拒否応答に別スレッドのリンクがあっても作成成功と推測しない', async () => {
    const form = '<form method="post" action="/bbs/write.cgi/game/123/new/"><input name="SUBJECT"><input name="NAME"><input name="MAIL"><textarea name="MESSAGE"></textarea></form>';
    const rejected = '<p>エラー: 連続スレッド作成は禁止です</p><a href="/bbs/read.cgi/game/123/789/">掲示板へ戻る</a>';
    const adapter = new FetchShitarabaWriteAdapter({
      fetch: vi.fn()
        .mockResolvedValueOnce(new Response(form))
        .mockResolvedValueOnce(new Response(rejected, { status: 400 })),
    });

    await expect(adapter.createNextThread({
      currentThread: current,
      title: 'title',
      body: 'body',
      authorName: '',
      email: '',
    })).rejects.toMatchObject<Partial<ShitarabaWriteFailure>>({ kind: 'rejected' });
  });

  it('否定文と無関係なリンクを含む200応答を成功と推測しない', async () => {
    const adapter = adapterWithPostResponse(new Response(
      '<p>スレッド作成に失敗しました</p><a href="/bbs/read.cgi/game/123/789/">既存スレッド</a>',
    ));
    await expectCreateFailure(adapter, 'rejected');
  });

  it('Location付き4xxは成功とせず明確な拒否にする', async () => {
    const adapter = adapterWithPostResponse(new Response('', {
      status: 400,
      headers: { Location: '/bbs/read.cgi/game/123/789/' },
    }));
    await expectCreateFailure(adapter, 'rejected');
  });

  it('明確な拒否文言がない5xxは結果不明にする', async () => {
    const adapter = adapterWithPostResponse(new Response('', { status: 500 }));
    await expectCreateFailure(adapter, 'uncertain');
  });

  it('肯定的な作成完了文と検証済み新URLを拒否扱いしない', async () => {
    const adapter = adapterWithPostResponse(new Response(
      '<p>新規スレッドを作成できました</p><a href="/bbs/read.cgi/game/123/789/">新しいスレッド</a>',
    ));

    await expect(adapter.createNextThread({
      currentThread: current,
      title: 'title',
      body: 'body',
      authorName: '',
      email: '',
    })).resolves.toEqual({
      threadUrl: 'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/789/',
    });
  });

  it('フォーム文字コードで表せない文字はPOST前に拒否する', async () => {
    const fetcher = vi.fn(async () => new Response(
      '<form method="post" action="/bbs/write.cgi/game/123/new/" accept-charset="EUC-JP"><input name="SUBJECT"><input name="NAME"><input name="MAIL"><textarea name="MESSAGE"></textarea></form>',
    ));
    const adapter = new FetchShitarabaWriteAdapter({ fetch: fetcher });

    await expect(adapter.createNextThread({
      currentThread: current,
      title: 'emoji 😀',
      body: 'body',
      authorName: '',
      email: '',
    })).rejects.toMatchObject<Partial<ShitarabaWriteFailure>>({ kind: 'preflight' });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

function adapterWithPostResponse(response: Response): FetchShitarabaWriteAdapter {
  const form = '<form method="post" action="/bbs/write.cgi/game/123/new/"><input name="SUBJECT"><input name="NAME"><input name="MAIL"><textarea name="MESSAGE"></textarea></form>';
  return new FetchShitarabaWriteAdapter({
    fetch: vi.fn()
      .mockResolvedValueOnce(new Response(form))
      .mockResolvedValueOnce(response),
  });
}

async function expectCreateFailure(
  adapter: FetchShitarabaWriteAdapter,
  kind: ShitarabaWriteFailure['kind'],
): Promise<void> {
  await expect(adapter.createNextThread({
    currentThread: current,
    title: 'title',
    body: 'body',
    authorName: '',
    email: '',
  })).rejects.toMatchObject<Partial<ShitarabaWriteFailure>>({ kind });
}
