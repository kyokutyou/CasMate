import { CompactFeedback } from './CompactFeedback';
import { useId, useMemo, useState } from 'react';
import { canonicalizeNgWords, evaluateCommentFilter } from '../../shared/comment-filter';
import type { CommentFilterSettings } from '../../shared/types';
import { SettingsCard } from './SettingsCard';
import { SlimSwitch } from './SlimSwitch';
import './comment-filter-panel.css';

const artSample = '  /\\_/\\\n ( o.o )\n  > ^ <';

interface Props {
  settings: CommentFilterSettings;
  saveError?: string;
  onChange(settings: CommentFilterSettings): void;
  onToggleAsciiArt(enabled: boolean): Promise<unknown>;
}

export function CommentFilterPanel({ settings, saveError, onChange, onToggleAsciiArt }: Props) {
  const id = useId();
  // This editor stays mounted during management navigation; samples never leave local React state.
  const [author, setAuthor] = useState('');
  const [body, setBody] = useState('');
  const words = useMemo(() => canonicalizeNgWords(settings.ngWords), [settings.ngWords]);
  const result = useMemo(() => evaluateCommentFilter(author, body, settings), [author, body, settings]);
  const empty = !author.trim() && !body.trim();
  const reason = empty ? '投稿者名だけでも判定できます。'
    : !result.blocked ? 'NGワード・アスキーアートに該当しません。'
    : result.reason === 'asciiArt' ? '複数行のアスキーアートに該当します。'
    : `${result.target === 'author' ? '投稿者名' : '本文'}に「${result.word}」が含まれています。`;
  const sample = (text: string) => { setAuthor('視聴者さん'); setBody(text); };

  return <SettingsCard cardId="commentFilter" title="コメントフィルター" eyebrow="COMMENT FILTER"
    className="comment-filter-panel" navigationWarning={saveError}>
    <div className="filter-columns">
      <div className="filter-editors">
        <section className="filter-section" aria-labelledby={`${id}-words`}>
          <div className="filter-section-heading"><h3 id={`${id}-words`}>NGワード</h3><span className="filter-count" aria-label="NGワード登録件数">{words.length}件</span></div>
          <p className="filter-help">投稿者名・本文のどちらかに含まれると除外します。</p>
          <label htmlFor={`${id}-word-input`}>1行に1件</label>
          <textarea id={`${id}-word-input`} aria-label="NGワード（1行に1件）" className="ng-word-editor" rows={6} spellCheck={false}
            value={settings.ngWords.join('\n')} aria-describedby={`${id}-save-state`}
            placeholder={'例：ネタバレ\n宣伝です'} onChange={event => onChange({ ...settings, ngWords: event.target.value.split(/\r?\n/u) })} />
          <CompactFeedback reserve={['空行・重複は自動で整理します。', '保存できませんでした。入力は保持しています。']} id={`${id}-save-state`} className={`filter-save-state${saveError ? ' field-error' : ''}`} role="status" aria-label="設定の保存状態">
            {saveError ? `保存できませんでした。${saveError} 入力は保持しています。変更すると再試行します。` : '空行・重複は自動で整理します。'}
          </CompactFeedback>
          <details className="filter-rules"><summary>一致のルール</summary><p>部分一致で判定します。英字の大文字・小文字、全角・半角は区別しません。正規表現は使えません。</p></details>
        </section>
        <section className="filter-section" aria-labelledby={`${id}-art`}>
          <div className="filter-art-heading"><h3 id={`${id}-art`}>アスキーアートを除外</h3>
            <SlimSwitch label="アスキーアートを除外" checked={settings.asciiArtEnabled}
              onChange={enabled => onToggleAsciiArt(enabled).catch(() => undefined)} /></div>
          <p className="filter-help">複数行の記号アートが対象です。</p>
          <div className="filter-art-examples"><div><span>除外の対象</span><pre>{artSample}</pre><span>複数行のアート</span></div>
            <div><span>そのまま通す</span><pre>(^_^)</pre><span>1行の顔文字</span></div></div>
        </section>
      </div>
      <section className="filter-section filter-tester" aria-labelledby={`${id}-test`}>
        <div className="filter-section-heading"><h3 id={`${id}-test`}>判定を試す</h3><span className="filter-count">入力中の設定を使用</span></div>
        <div className="filter-samples" role="group" aria-label="テスト用サンプル">
          <button type="button" className="secondary" onClick={() => sample('こんにちは！ (^_^)')}>通常文</button>
          <button type="button" className="secondary" disabled={!words.length} aria-describedby={`${id}-sample-help`}
            onClick={() => sample(`このコメントには${words[0]}が含まれます。`)}>NGワード入り</button>
          <button type="button" className="secondary" onClick={() => sample(artSample)}>アート</button>
        </div>
        <CompactFeedback id={`${id}-sample-help`} className="filter-sample-help" reserve={['NGワード入りは先頭の語を使います。', 'NGワードを登録するとサンプルを選べます。']}>{words.length ? 'NGワード入りは先頭の語を使います。' : 'NGワードを登録するとサンプルを選べます。'}</CompactFeedback>
        <label htmlFor={`${id}-author`}>投稿者名</label><input id={`${id}-author`} value={author} autoComplete="off" onChange={event => setAuthor(event.target.value)} placeholder="例：視聴者さん" />
        <label htmlFor={`${id}-body`}>コメント本文</label><textarea id={`${id}-body`} value={body} rows={3} onChange={event => setBody(event.target.value)} placeholder="確認したいコメントを入力" />
        <div className="filter-result" data-state={empty ? 'empty' : result.blocked ? 'blocked' : 'allowed'} role="status" aria-label="判定結果" aria-live="polite" aria-atomic="true" tabIndex={0}>
          <strong>{empty ? 'コメントを入力してください' : result.blocked ? '⊘ 除外されます' : '✓ 表示・読み上げの対象です'}</strong><span>{reason}</span>
        </div>
        <p className="filter-help">テスト内容は投稿・読み上げされません。</p>
        <details className="filter-test-details"><summary>テストについて</summary><p>テスト内容は送信・保存しません。エモートは代替テキストで入力してください。</p></details>
      </section>
    </div>
  </SettingsCard>;
}
