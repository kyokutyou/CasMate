import { describe, expect, it } from 'vitest';
import { parseShitarabaRaw } from '../src/main/sources/shitaraba-source';
import { parseTwitchMessage } from '../src/main/sources/twitch-source';
import { parseYouTubeActions } from '../src/main/sources/youtube-source';

describe('コメントソース応答の共通コメント変換', () => {
  it('YouTubeの通常コメントと公式エモートだけを変換する', () => {
    const comments = parseYouTubeActions(
      [
        {
          addChatItemAction: {
            item: {
              liveChatTextMessageRenderer: {
                id: 'yt-message-1',
                authorName: { simpleText: '視聴者A' },
                message: {
                  runs: [
                    { text: 'こんにちは ' },
                    {
                      emoji: {
                        emojiId: 'wave',
                        shortcuts: [':wave:'],
                        image: { thumbnails: [{ url: 'https://yt3.ggpht.com/wave' }] },
                      },
                    },
                  ],
                },
              },
            },
          },
        },
        {
          addChatItemAction: {
            item: { liveChatPaidMessageRenderer: { id: 'paid-event' } },
          },
        },
      ],
      true,
    );

    expect(comments).toEqual([
      {
        externalId: 'yt-message-1',
        source: 'youtube',
        authorName: '視聴者A',
        initialHistory: true,
        content: [
          { type: 'text', text: 'こんにちは ' },
          {
            type: 'emote',
            id: 'wave',
            alt: ':wave:',
            url: 'https://yt3.ggpht.com/wave',
          },
        ],
      },
    ]);
  });

  it('Twitch IRCの表示名・本文・公式エモートを変換する', () => {
    const result = parseTwitchMessage(
      '@display-name=Viewer;emotes=25:0-4;id=twitch-message-1 :viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #channel :Kappa hello',
      false,
    );

    expect(result).toEqual({
      externalId: 'twitch-message-1',
      source: 'twitch',
      authorName: 'Viewer',
      initialHistory: false,
      content: [
        {
          type: 'emote',
          id: '25',
          alt: 'Kappa',
          url: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0',
        },
        { type: 'text', text: ' hello' },
      ],
    });
  });

  it('したらばrawmodeは投稿者名をレス番号へ置き換え、本文を安全なテキストへ変換する', () => {
    const { comments } = parseShitarabaRaw(
      '101<>名無しさん<>sage<>2026/08/23(日) 12:00:00 ID:abc<>一行目<br>二行目 &lt;script&gt;<>配信スレ\n',
      true,
    );

    expect(comments).toEqual([
      {
        externalId: '101',
        source: 'shitaraba',
        authorName: 'レス101',
        initialHistory: true,
        content: [{ type: 'text', text: '一行目\n二行目 <script>' }],
      },
    ]);
  });

  it('したらばは接続先を外部IDに含め、本文にできない行のレス番号も抽出する', () => {
    const parsed = parseShitarabaRaw(
      '101<>名前<>sage<>date<>本文<>配信 1\n102<>名前<>sage<>date<><>配信 1\n',
      true,
      'game:123:456',
    );

    expect(parsed.comments[0]?.externalId).toBe('game:123:456:101');
    expect(parsed.maxResponseNumber).toBe(102);
  });
});
