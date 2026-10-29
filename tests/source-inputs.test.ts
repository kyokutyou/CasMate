import { describe, expect, it } from 'vitest';
import {
  normalizeShitarabaInput,
  normalizeBoardInput,
  normalizeJpnknInput,
  boardThreadKey,
  normalizeTwitchInput,
  normalizeYouTubeInput,
} from '../src/main/sources/source-inputs';

describe('コメントソースの接続入力', () => {
  it('YouTubeのハンドルとハンドルURLを正規化する', () => {
    expect(normalizeYouTubeInput('@kyokutyou2061')).toEqual({
      kind: 'handle',
      target: '@kyokutyou2061',
    });
    expect(
      normalizeYouTubeInput('https://www.youtube.com/@kyokutyou2061'),
    ).toEqual({ kind: 'handle', target: '@kyokutyou2061' });
  });

  it('YouTubeのLive ID・配信URL・チャンネルIDを正規化する', () => {
    expect(normalizeYouTubeInput(' abcDEF12345 ')).toEqual({
      kind: 'liveId',
      target: 'abcDEF12345',
    });
    expect(
      normalizeYouTubeInput('https://www.youtube.com/watch?v=abcDEF12345&t=1'),
    ).toEqual({ kind: 'liveId', target: 'abcDEF12345' });
    expect(
      normalizeYouTubeInput('https://www.youtube.com/live/hN48nFAiGzE'),
    ).toEqual({ kind: 'liveId', target: 'hN48nFAiGzE' });
    expect(
      normalizeYouTubeInput('UC1234567890abcdefghijkL'),
    ).toEqual({ kind: 'channelId', target: 'UC1234567890abcdefghijkL' });
    expect(
      normalizeYouTubeInput('https://www.youtube.com/channel/UCk6_d4MCUjsSBpoy1JUzLAw'),
    ).toEqual({ kind: 'channelId', target: 'UCk6_d4MCUjsSBpoy1JUzLAw' });
    expect(() => normalizeYouTubeInput('not an id')).toThrow(
      'YouTube接続先',
    );
  });

  it('Twitchのチャンネル名とURLを正規化する', () => {
    expect(normalizeTwitchInput(' Some_Channel ')).toBe('some_channel');
    expect(normalizeTwitchInput('https://www.twitch.tv/Some_Channel')).toBe(
      'some_channel',
    );
    expect(normalizeTwitchInput('https://www.twitch.tv/kyokutyou')).toBe(
      'kyokutyou',
    );
    expect(() => normalizeTwitchInput('invalid/channel')).toThrow(
      'Twitchチャンネル名',
    );
  });

  it('したらばのスレッドURLだけをHTTPSへ正規化する', () => {
    expect(
      normalizeShitarabaInput(
        'http://jbbs.shitaraba.net/bbs/read.cgi/game/12345/1700000000/',
      ),
    ).toEqual({
      category: 'game',
      boardId: '12345',
      threadId: '1700000000',
      url: 'https://jbbs.shitaraba.net/bbs/read.cgi/game/12345/1700000000/',
    });
    expect(
      normalizeShitarabaInput(
        'https://jbbs.shitaraba.net/bbs/read.cgi/radio/25607/1787306283/',
      ),
    ).toMatchObject({ category: 'radio', boardId: '25607', threadId: '1787306283' });
    expect(() =>
      normalizeShitarabaInput('https://example.com/bbs/read.cgi/game/1/2/'),
    ).toThrow('したらばスレッドURL');
  });

  it('同じ掲示板入力から実サービスを判別しjpnknの表示範囲を正規化する', () => {
    expect(normalizeJpnknInput(' http://bbs.jpnkn.com/test/read.cgi/clarahas/1789177017/l50?x=1#20 ')).toEqual({
      service: 'jpnkn', boardId: 'clarahas', threadId: '1789177017',
      url: 'https://bbs.jpnkn.com/test/read.cgi/clarahas/1789177017/',
    });
    const shitaraba = normalizeBoardInput('https://jbbs.shitaraba.net/bbs/read.cgi/radio/1/2/');
    const jpnkn = normalizeBoardInput('https://bbs.jpnkn.com/test/read.cgi/radio/2/1-100');
    expect(shitaraba).toMatchObject({ service: 'shitaraba', category: 'radio', boardId: '1', threadId: '2' });
    expect(boardThreadKey(shitaraba)).toBe('shitaraba:radio:1:2');
    expect(boardThreadKey(jpnkn)).toBe('jpnkn:radio:2');
  });

  it.each([
    'https://bbs.jpnkn.com/clarahas/',
    'https://bbs.jpnkn.com/test/read.cgi/clarahas/0/',
    'https://bbs.jpnkn.com/test/read.cgi/clarahas/123/not-a-range',
    'https://bbs.jpnkn.com.evil.test/test/read.cgi/clarahas/123/',
    'https://user:secret@bbs.jpnkn.com/test/read.cgi/clarahas/123/',
    'https://bbs.jpnkn.com:8443/test/read.cgi/clarahas/123/',
    'ftp://bbs.jpnkn.com/test/read.cgi/clarahas/123/',
  ])('jpnknの非スレッド・不正ホスト・資格情報を拒否する: %s', input => {
    expect(() => normalizeJpnknInput(input)).toThrow('jpnknスレッドURL');
    expect(() => normalizeBoardInput(input)).toThrow();
  });

  it('共通掲示板入力はしたらばURLの資格情報・非HTTPスキームも拒否する', () => {
    expect(() => normalizeBoardInput('https://user@jbbs.shitaraba.net/bbs/read.cgi/game/1/2/')).toThrow();
    expect(() => normalizeBoardInput('ftp://jbbs.shitaraba.net/bbs/read.cgi/game/1/2/')).toThrow();
  });
});
