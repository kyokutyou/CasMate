// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { defaultCommentOverlaySettings } from '../src/main/core/comment-overlay-controller';
import { CommentOverlayView, SpeechRecognitionOverlayView } from '../src/renderer/components/OverlayViews';
import { commentDesignFromSettings, speechDesignFromSettings, defaultSpeechOverlayAppearance } from '../src/shared/obs-design';
import type { CommonComment } from '../src/shared/types';
import { runElectronFixture } from './helpers/electron-fixture';

async function removeFixture(directory: string) {
  const target = resolve(directory);
  if (!target.startsWith(resolve(tmpdir()) + sep) || !target.split(sep).at(-1)?.startsWith('casmate-sticky-theme-')) throw new Error('Unexpected fixture directory');
  await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

it('標準付箋の可変幅・透明性と、重要度指定なしのOBSカスタムCSSを実描画で確認する', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'casmate-sticky-theme-'));
  try {
    const comments: CommonComment[] = ['こんばんは', 'この配信の雰囲気が好きです。', '長い文章も折り返します。'.repeat(8) + 'https://example.invalid/' + 'x'.repeat(100)]
      .map((text, sequence) => ({ id: `sticky-${sequence}`, externalId: `${sequence}`, sequence, source: 'youtube', authorName: 'そら',
        content: [{ type: 'text', text }], initialHistory: false, receivedAt: '2026-10-18T00:00:00Z' }));
    const css = readFileSync(resolve('src/renderer/styles.css'), 'utf8');
    const normal = renderToStaticMarkup(<CommentOverlayView comments={comments} settings={defaultCommentOverlaySettings} />);
    const legacy = renderToStaticMarkup(<CommentOverlayView comments={comments} settings={{ ...defaultCommentOverlaySettings,
      fontSizePx: 32, textColor: '#ffffffff', backgroundColor: '#00000099', paddingPx: 8, borderRadiusPx: 8 }} />);
    const hidden = renderToStaticMarkup(<CommentOverlayView comments={comments.slice(0, 1)} settings={{ ...defaultCommentOverlaySettings, showAuthor: false }} />);
    const empty = renderToStaticMarkup(<CommentOverlayView comments={[]} settings={defaultCommentOverlaySettings} />);
    for (const [name, markup] of Object.entries({ normal, legacy, hidden, empty })) {
      await writeFile(join(directory, `${name}.html`), `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="root">${markup}</div>`);
    }
    const inherited = { ...defaultCommentOverlaySettings, showSource: true, textColor: '#183b3b78', paddingPx: 64 };
    const inheritedSpeech = { ...defaultSpeechOverlayAppearance, textColor: '#ffffff78' };
    const paired = {
      'comment-before': <CommentOverlayView comments={comments} settings={inherited}/>,
      'comment-after': <CommentOverlayView comments={comments} settings={{ ...inherited, design: commentDesignFromSettings(inherited) }}/>,
      'speech-before': <SpeechRecognitionOverlayView text="認識結果の見本です。\n折り返しを確認します。" appearance={inheritedSpeech}/>,
      'speech-after': <SpeechRecognitionOverlayView text="認識結果の見本です。\n折り返しを確認します。" appearance={{ ...inheritedSpeech, design: speechDesignFromSettings(inheritedSpeech) }}/>,
    };
    for (const [name, view] of Object.entries(paired)) await writeFile(join(directory, `${name}.html`), `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="root">${renderToStaticMarkup(view)}</div>`);
    const result = await runElectronFixture('tests/fixtures/comment-overlay-theme.mjs', join(directory, 'normal.html'), directory);
    expect(result.stdout, result.stderr).toContain('PASS: sticky defaults, saved appearance and CSS overrides');
  } finally {
    await removeFixture(directory);
  }
}, 45_000);
