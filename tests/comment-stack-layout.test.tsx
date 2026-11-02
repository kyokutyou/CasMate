// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { defaultCommentOverlaySettings } from '../src/main/core/comment-overlay-controller';
import { CommentOverlayView } from '../src/renderer/components/OverlayViews';
import type { CommonComment } from '../src/shared/types';
import { runElectronFixture } from './helpers/electron-fixture';

it('新着位置と上下配置の4通りで少数・長文・領域超過と拡大を描画する', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'casmate-comment-stack-'));
  const target = resolve(directory);
  if (!target.startsWith(resolve(tmpdir()) + sep) || !target.split(sep).at(-1)?.startsWith('casmate-comment-stack-')) throw new Error('Unexpected fixture directory');
  const captures = resolve('tmp/comment-stack-layout');
  await mkdir(captures, { recursive: true });
  try {
    const css = readFileSync(resolve('src/renderer/styles.css'), 'utf8');
    const comments: CommonComment[] = Array.from({ length: 50 }, (_, sequence) => ({
      id: `stack-${sequence}`, externalId: String(sequence), sequence, source: 'youtube', authorName: '視聴者',
      content: [{ type: 'text', text: sequence === 49 ? '新着の長いコメントを折り返して表示します。'.repeat(5) : `コメント${sequence}` }],
      initialHistory: false, receivedAt: new Date(0).toISOString(),
    }));
    for (const stackDirection of ['newestTop', 'newestBottom'] as const) {
      for (const stackAlignment of ['top', 'bottom'] as const) {
        for (const size of ['few', 'many'] as const) {
          const settings = { ...defaultCommentOverlaySettings, mode: 'stack' as const, stackMaxComments: 50,
            stackDirection, stackAlignment, fontSizePx: 20 };
          const markup = renderToStaticMarkup(<CommentOverlayView settings={settings} comments={size === 'few' ? comments.slice(0, 2) : comments}/>);
          const html = `<!doctype html><meta charset="utf-8"><style>${css}</style><style>:root { --cm-tilt: 0deg; --cm-tape-display: none; --cm-fold-display: none; }</style><div id="root">${markup}</div>`;
          const name = `${stackDirection}-${stackAlignment}-${size}.html`;
          await writeFile(join(directory, name), html);
          if (process.env.CASMATE_STACK_OBS_DIRECTORY) {
            await mkdir(process.env.CASMATE_STACK_OBS_DIRECTORY, { recursive: true });
            await writeFile(join(process.env.CASMATE_STACK_OBS_DIRECTORY, name), html);
          }
        }
      }
    }
    const result = await runElectronFixture('tests/fixtures/comment-stack-layout.mjs', join(directory, 'newestBottom-top-few.html'), directory, [captures], 40_000);
    expect(result.stdout, result.stderr).toContain('PASS: 4 stack placements, overflow and resize');
  } finally {
    await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}, 60_000);
