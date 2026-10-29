// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import type { AppSnapshot, SpeechRecognitionOverlayBootstrap } from '../src/shared/types';
import { obsRegistrationSnapshot } from './fixtures/obs-registration-state';
import { createDefaultDocument } from '../src/renderer/obs-style-editor/model';
import { previewAppearance, previewComments, previewCommentSettings } from '../src/renderer/obs-style-editor/samples';
import { PreviewContent } from '../src/renderer/obs-style-editor/PreviewContent';
import { Preview } from '../src/renderer/obs-style-editor/Preview';

const mocks = vi.hoisted(() => ({ snapshot: null as AppSnapshot | null, speech: null as SpeechRecognitionOverlayBootstrap | null }));
vi.mock('../src/renderer/api', () => ({ useApplicationState: () => ({ snapshot: mocks.snapshot }), useSpeechRecognitionOverlay: () => mocks.speech }));
vi.mock('../src/renderer/use-obs-display-test', () => ({ useObsDisplayTest: () => null }));
import { CommentOverlayPage } from '../src/renderer/pages/CommentOverlayPage';
import { SpeechRecognitionOverlayPage } from '../src/renderer/pages/SpeechRecognitionOverlayPage';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each(['newestBottom', 'newestTop'] as const)('プレビューが実表示と同じ見本・構造・表示方向 %s を描画する', (direction) => {
  const doc = createDefaultDocument();
  doc.previews.comments.stackDirection = direction;
  doc.previews.comments.author = '名前"</style><script>危険</script>';
  doc.previews.comments.text = '長いコメントを折り返して表示します。'.repeat(8) + '\n<img src="https://invalid.example/">';
  const snapshot = obsRegistrationSnapshot();
  snapshot.settings.commentOverlay = previewCommentSettings(doc.previews.comments);
  snapshot.commentOverlay.active = previewComments(doc.previews.comments).map((comment) => ({ comment, expiresAt: new Date(Date.now() + 60_000).toISOString() }));
  mocks.snapshot = snapshot;
  mocks.speech = { appearance: previewAppearance, state: { active: { id: 'sample', text: doc.previews.speech.text, expiresAt: new Date(Date.now() + 60_000).toISOString() } } };
  expect(renderToStaticMarkup(<PreviewContent target="comments" document={doc} />)).toBe(renderToStaticMarkup(<CommentOverlayPage />));
  expect(renderToStaticMarkup(<PreviewContent target="speech" document={doc} />)).toBe(renderToStaticMarkup(<SpeechRecognitionOverlayPage />));
});

it('任意のフォント名・見本文をiframeの文字列として扱いHTML終了タグを解釈しない', () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const doc = createDefaultDocument();
  doc.designs.comments.fontFamily = '";}</style><script>alert(1)</script>\nfont';
  doc.previews.comments.text = '</div><img src="https://invalid.example/image" onerror="alert(1)"><script>alert(1)</script>';
  const view = render(<Preview target="comments" document={doc} />);
  const frame = view.getByTitle('OBS表示の見本') as HTMLIFrameElement;
  const inner = frame.contentDocument!;
  const root = inner.createElement('div'); root.id = 'root'; inner.body.append(root);
  fireEvent.load(frame);
  expect(inner.querySelector('script')).toBeNull();
  expect(inner.querySelector('.comment-body')?.textContent).toContain(doc.previews.comments.text);
  expect([...inner.querySelectorAll('img')].every((img) => img.src.startsWith('data:'))).toBe(true);
  expect(inner.getElementById('generated-css')?.textContent).toContain('--cm-font:');
  expect(inner.getElementById('app-base-css')?.textContent).toContain('.overlay-comments');
  expect(frame.srcdoc).not.toContain('alert');
  expect(frame.getAttribute('sandbox')).toBe('allow-same-origin');
});
