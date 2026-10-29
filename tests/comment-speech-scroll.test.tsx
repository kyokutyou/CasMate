import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { runElectronFixture } from './helpers/electron-fixture';
import { createDefaultSettings } from '../src/main/core/settings';
import { CommentSpeechPanel } from '../src/renderer/components/CommentSpeechPanel';
import { ManagementNavigation } from '../src/renderer/management-navigation';

it('初回の読み上げ設定で両ボタンにホバーしてもスクロールと操作位置が動かない', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'casmate-speech-scroll-'));
  try {
    const css = await Promise.all(['src/renderer/styles.css', 'src/renderer/components/comment-speech-panel.css']
      .map(path => readFile(resolve(path), 'utf8')));
    const markup = renderToStaticMarkup(<main className="management-shell">
      <header /><nav /><div className="management-body">
        <ManagementNavigation.Provider value={{ editor: 'commentSpeech', reportError: () => {}, open: () => {} }}>
          <CommentSpeechPanel settings={{ ...createDefaultSettings().commentSpeech, enabled: true }}
            state={{ engineStatus: 'unavailable', warning: 'VOICEVOXが見つかりません。', currentCommentId: null, queueLength: 0, droppedCount: 0 }}
            synchronized={false} onChange={() => {}} onSave={async () => {}} listVoices={async () => []}
            selectEngine={async () => true} preview={async () => {}} onSuccess={() => {}} />
        </ManagementNavigation.Provider>
      </div>
    </main>);
    const html = join(directory, 'index.html');
    await writeFile(html, `<!doctype html><meta charset="utf-8"><style>${css.join('\n')}</style>${markup}`);
    const { stdout } = await runElectronFixture('tests/fixtures/comment-speech-scroll.mjs', html, directory);
    expect(stdout).toContain('PASS: 6 hover checks');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
