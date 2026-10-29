// @vitest-environment jsdom
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'vite';
import { expect, it, vi } from 'vitest';
import type { AppSnapshot, SpeechRecognitionOverlayBootstrap } from '../src/shared/types';
import { createDefaultDocument, createPreset } from '../src/renderer/obs-style-editor/model';
import { generateCss } from '../src/renderer/obs-style-editor/css';
import { previewAppearance, previewComments, previewCommentSettings } from '../src/renderer/obs-style-editor/samples';
import { obsRegistrationSnapshot } from './fixtures/obs-registration-state';
import { runElectronFixture } from './helpers/electron-fixture';

const mocks = vi.hoisted(() => ({ snapshot: null as AppSnapshot | null, speech: null as SpeechRecognitionOverlayBootstrap | null }));
vi.mock('../src/renderer/api', () => ({ useApplicationState: () => ({ snapshot: mocks.snapshot }), useSpeechRecognitionOverlay: () => mocks.speech }));
vi.mock('../src/renderer/use-obs-display-test', () => ({ useObsDisplayTest: () => null }));
import { CommentOverlayPage } from '../src/renderer/pages/CommentOverlayPage';
import { SpeechRecognitionOverlayPage } from '../src/renderer/pages/SpeechRecognitionOverlayPage';

async function removeFixture(directory: string) {
  const target = resolve(directory);
  if (!target.startsWith(resolve(tmpdir()) + sep) || !target.split(sep).at(-1)?.startsWith('casmate-style-rendering-')) throw new Error('Unexpected fixture directory');
  await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

it('単独HTMLをfileで開き、iframeプレビューと実表示の描画・折返し・透明性を比較する', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'casmate-style-rendering-'));
  try {
    // Vite's production CLI runs outside Vitest's NODE_ENV=test. Match that
    // environment so the JSX transform and bundled React runtime agree.
    const previousEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    let built: Awaited<ReturnType<typeof build>>;
    try { built = await build({ configFile: resolve('vite.obs-style-editor.config.mts'), logLevel: 'silent', build: { outDir: directory, write: false } }); }
    finally { process.env.NODE_ENV = previousEnvironment; }
    const outputs = Array.isArray(built) ? built : [built];
    const html = outputs.flatMap((output) => 'output' in output ? output.output : []).find((item) => item.type === 'asset' && item.fileName === 'obs-style-editor.html');
    if (!html || html.type !== 'asset') throw new Error('Single HTML not built');
    const editor = join(directory, 'editor.html');
    await writeFile(editor, html.source);
    const base = await readFile(resolve('src/renderer/styles.css'), 'utf8');
    const cases = [];
    for (const name of ['stack', 'single', 'hidden', 'speech', 'position', 'hostile', 'shadow'] as const) {
      const doc = createDefaultDocument();
      const speech = name === 'speech' || name === 'position';
      const target = speech ? 'speech' : 'comments';
      if (name === 'single') { doc.previews.comments.mode = 'single'; doc.previews.comments.source = 'twitch'; }
      if (name === 'stack') { doc.previews.comments.width = 320; doc.previews.comments.stackDirection = 'newestTop'; doc.previews.comments.text = '折り返しを確認する長い文章です。'.repeat(8) + '\n改行の見本'; }
      if (name === 'hidden') { doc.designs.comments.showSource = false; doc.designs.comments.showAuthor = false; doc.designs.comments.backgroundOpacity = 0; }
      if (name === 'position') { doc.designs.speech = createPreset('speech', 'outlined'); Object.assign(doc.designs.speech, { horizontal: 'center', vertical: 'top', textAlign: 'right', maxWidth: 500 }); doc.previews.speech.text = '長い字幕の配置と折り返しを確認します。'.repeat(8) + '\n改行の見本'; }
      if (name === 'hostile') { doc.designs.comments.fontFamily = 'font";$&</style><script>window.__injected=1</script>\n'; doc.previews.comments.text = '</div><img src="https://invalid.example/image" onerror="alert(1)">\n<script>window.__injected=1</script>'; }
      if (name === 'shadow') { doc.previews.comments.mode = 'single'; doc.designs.comments.edge = 0; Object.assign(doc.designs.comments.cardShadow, { enabled: true, blur: 64, x: 0, y: 0 }); }
      const snapshot = obsRegistrationSnapshot();
      snapshot.settings.commentOverlay = previewCommentSettings(doc.previews.comments);
      snapshot.commentOverlay.active = previewComments(doc.previews.comments).map((comment) => ({ comment, expiresAt: new Date(Date.now() + 120_000).toISOString() }));
      mocks.snapshot = snapshot;
      mocks.speech = { appearance: previewAppearance, state: { active: { id: 'sample', text: doc.previews.speech.text, expiresAt: new Date(Date.now() + 120_000).toISOString() } } };
      const markup = renderToStaticMarkup(speech ? <SpeechRecognitionOverlayPage /> : <CommentOverlayPage />);
      const css = speech ? generateCss('speech', doc.designs.speech) : generateCss('comments', doc.designs.comments);
      const path = join(directory, `${name}.html`);
      await writeFile(path, `<!doctype html><meta charset="utf-8"><style>${base}</style><style>${css}</style><div id="root">${markup}</div>`);
      if (process.env.CASMATE_STYLE_OBS_DIRECTORY) {
        const exported = join(process.env.CASMATE_STYLE_OBS_DIRECTORY, `${name}.html`);
        await writeFile(exported, `<!doctype html><meta charset="utf-8"><style>${base}</style><div id="root">${markup}</div>`);
        await writeFile(join(process.env.CASMATE_STYLE_OBS_DIRECTORY, `${name}.css`), css);
      }
      cases.push({ name, target, document: doc, path });
    }
    await writeFile(join(directory, 'cases.json'), JSON.stringify(cases));
    const result = await runElectronFixture('tests/fixtures/obs-style-editor-rendering.mjs', editor, directory, [], 60_000);
    expect(result.stdout, result.stderr).toContain('PASS: standalone preview equals live overlay (7 cases), no network');
  } finally {
    await removeFixture(directory);
  }
}, 90_000);
