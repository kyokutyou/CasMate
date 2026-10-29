// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import type { AppSnapshot, SpeechRecognitionOverlayBootstrap } from '../src/shared/types';
import { obsRegistrationSnapshot } from './fixtures/obs-registration-state';
import { runElectronFixture } from './helpers/electron-fixture';

const mocks = vi.hoisted(() => ({
  snapshot: null as AppSnapshot | null,
  speech: null as SpeechRecognitionOverlayBootstrap | null,
}));
vi.mock('../src/renderer/api', () => ({
  useApplicationState: () => ({ snapshot: mocks.snapshot }),
  useSpeechRecognitionOverlay: () => mocks.speech,
}));
vi.mock('../src/renderer/use-obs-display-test', () => ({ useObsDisplayTest: () => null }));
import { CommentOverlayPage } from '../src/renderer/pages/CommentOverlayPage';
import { SpeechRecognitionOverlayPage } from '../src/renderer/pages/SpeechRecognitionOverlayPage';

async function removeFixture(directory: string) {
  const target = resolve(directory);
  if (!target.startsWith(resolve(tmpdir()) + sep) || !target.split(sep).at(-1)?.startsWith('casmate-obs-custom-css-')) throw new Error('Unexpected fixture directory');
  await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

it('OBS用テンプレートで実表示のテーマ上書き・折り返し・配置・空表示の透明性を検証する', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'casmate-obs-custom-css-'));
  try {
    const snapshot = obsRegistrationSnapshot();
    const settings = snapshot.settings.commentOverlay;
    Object.assign(settings, { showSource: true, fontSizePx: 80, textColor: '#ff00ff', backgroundColor: '#00ff00', paddingPx: 30, borderRadiusPx: 0 });
    snapshot.commentOverlay.active = (['youtube', 'twitch', 'shitaraba'] as const).map((source, index) => ({
      comment: {
        id: source, externalId: source, sequence: index, source,
        authorName: 'とても長い投稿者名'.repeat(8),
        content: [{ type: 'text' as const, text: '長文の折り返しを確認します。'.repeat(6) + '\nhttps://example.invalid/' + 'x'.repeat(100) },
          { type: 'emote' as const, id: 'sample-emote', url: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="30" height="30"%3E%3Crect width="30" height="30" fill="red"/%3E%3C/svg%3E', alt: 'エモート' }],
        initialHistory: false, receivedAt: new Date().toISOString(),
      },
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }));
    mocks.snapshot = snapshot;
    mocks.speech = { state: { active: { id: 'speech', text: '長い認識結果を折り返します。'.repeat(16), expiresAt: new Date(Date.now() + 60_000).toISOString() } }, appearance: settings };
    const base = readFileSync(resolve('src/renderer/styles.css'), 'utf8');
    const html = join(directory, 'index.html');
    for (const mode of ['comments-bottom', 'comments-top', 'comments-single', 'speech']) {
      settings.stackDirection = mode === 'comments-top' ? 'newestTop' : 'newestBottom';
      settings.mode = mode === 'comments-single' ? 'single' : 'stack';
      if (mode === 'comments-single') snapshot.commentOverlay.active = snapshot.commentOverlay.active.slice(0, 1);
      const template = mode === 'speech' ? 'speech-recognition' : 'comments';
      const css = readFileSync(resolve(`docs/templates/obs/${template}.css`), 'utf8');
      const markup = renderToStaticMarkup(mode === 'speech' ? <SpeechRecognitionOverlayPage /> : <CommentOverlayPage />);
      await writeFile(html, `<!doctype html><meta charset="utf-8"><style>${base}</style><style>${css}</style><div id="root">${markup}</div>`);
      const result = await runElectronFixture('tests/fixtures/obs-custom-css-layout.mjs', html, directory, [mode]);
      expect(result.stdout, result.stderr).toContain(`PASS: ${mode}`);
    }
  } finally {
    await removeFixture(directory);
  }
}, 90_000);
