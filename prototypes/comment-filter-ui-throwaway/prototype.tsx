// Throwaway: three structurally different editors in the existing home/settings shell.
// All edits are memory-only. The proposed tester uses the production pure predicate.
import { useEffect, useRef, useState } from 'react';
import { canonicalizeNgWords, normalizeCommentFilterText } from '../../src/shared/comment-filter';
import { blocksComment, isAsciiArt } from '../../src/main/core/comment-filter';

const variants = ['A', 'B', 'C'] as const;
type Variant = typeof variants[number];
const names = { A: '編集 ＋ 確認', B: 'ワード管理', C: '順番に設定' };
const descriptions = {
  A: '設定と判定テストを一画面に。調整しながら、その場で確かめる。',
  B: 'NGワードを一件ずつ見直す。登録数が多い配信者向け。',
  C: 'NGワード → アスキーアート → 確認。初めてでも迷わない順序。',
};
const art = '  /\\_/\\\n ( o.o )\n  > ^ <';
const initialWords = 'ネタバレ\n宣伝です\nspam';

function readVariant(): Variant {
  const value = new URLSearchParams(window.location.search).get('variant');
  return variants.find(item => item === value) ?? 'A';
}

export function FilterPrototype() {
  const [variant, setVariant] = useState<Variant>(readVariant);
  const [words, setWords] = useState(initialWords);
  const [aa, setAa] = useState(true);
  const [saved, setSaved] = useState({ ngWords: canonicalizeNgWords(initialWords.split('\n')), asciiArtEnabled: true });
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState(false);
  const [simulateFailure, setSimulateFailure] = useState(false);
  const [toast, setToast] = useState('');
  const [page, setPage] = useState('editor');
  const [warnings, setWarnings] = useState(false);
  const [tab, setTab] = useState('words');
  const [step, setStep] = useState(0);
  const [query, setQuery] = useState('');
  const [newWord, setNewWord] = useState('');
  const [addError, setAddError] = useState('');
  const [bulk, setBulk] = useState(false);
  const [author, setAuthor] = useState('視聴者さん');
  const [body, setBody] = useState('今日はネタバレなしで楽しもう！');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const warningDialog = useRef<HTMLDialogElement>(null);
  const warningButton = useRef<HTMLButtonElement>(null);
  const ngWords = canonicalizeNgWords(words.split(/\r?\n/u));
  const dirty = saving || failure;

  useEffect(() => () => { clearTimeout(saveTimer.current); clearTimeout(toastTimer.current); }, []);
  useEffect(() => {
    function sync() { setVariant(readVariant()); }
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  useEffect(() => {
    function key(event: KeyboardEvent) {
      const target = event.target;
      if (event.altKey || event.metaKey || event.ctrlKey || warnings || target instanceof HTMLElement && (target.closest('input,textarea,select,[contenteditable="true"],[role="tablist"]'))) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      switchVariant(variants[(variants.indexOf(variant) + (event.key === 'ArrowRight' ? 1 : 2)) % 3]);
    }
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [variant, warnings]);
  useEffect(() => {
    if (warnings) warningDialog.current?.showModal();
    else warningDialog.current?.close();
  }, [warnings]);

  function switchVariant(value: Variant) {
    setVariant(value);
    const url = new URL(window.location.href);
    url.searchParams.set('variant', value);
    window.history.replaceState(null, '', url);
  }
  function notify(text: string) {
    clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = setTimeout(() => setToast(''), 4000);
  }
  function commit(text: string, enabled: boolean) {
    setSaving(false);
    if (simulateFailure) { setFailure(true); return; }
    setFailure(false);
    setSaved({ ngWords: canonicalizeNgWords(text.split(/\r?\n/u)), asciiArtEnabled: enabled });
    notify('設定を反映しました（見本）');
  }
  function editWords(text: string) {
    setWords(text); setSaving(true);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => commit(text, aa), 500);
  }
  function toggleAa(enabled: boolean) {
    setAa(enabled);
    // A switch saves only its value immediately; unfinished text retains its delay.
    if (simulateFailure) setFailure(true);
    else { setSaved(previous => ({ ...previous, asciiArtEnabled: enabled })); notify('設定を反映しました（見本）'); }
    if (saving) {
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => commit(words, enabled), 500);
    }
  }
  function addWord() {
    const trimmed = newWord.trim();
    if (!trimmed) { setAddError('追加するNGワードを入力してください。'); return; }
    if (ngWords.some(word => normalizeCommentFilterText(word) === normalizeCommentFilterText(trimmed))) {
      setAddError('同じNGワードが登録されています。'); return;
    }
    editWords([...ngWords, trimmed].join('\n')); setNewWord(''); setAddError('');
  }
  function scenario(value: string) {
    clearTimeout(saveTimer.current); clearTimeout(toastTimer.current);
    const text = value === 'empty' ? '' : value === 'many' ? Array.from({ length: 60 }, (_, index) => `サンプル語句${index + 1}`).join('\n') : initialWords;
    setWords(text); setAa(value !== 'empty'); setSaving(false); setFailure(false); setToast('');
    setSimulateFailure(value === 'failure'); setQuery(''); setNewWord(''); setAddError('');
    setSaved({ ngWords: canonicalizeNgWords(text.split('\n')), asciiArtEnabled: value !== 'empty' });
  }
  const matched = ngWords.find(word => [author, body].some(text => normalizeCommentFilterText(text).includes(normalizeCommentFilterText(word))));
  const blocked = blocksComment({ source: 'youtube', externalId: 'prototype-only', authorName: author, initialHistory: false, content: [{ type: 'text', text: body }] }, { ngWords, asciiArtEnabled: aa });

  const WordEditor = <section className="cf-section">
    <div className="cf-section-title"><h2>NGワード</h2><span className="cf-count">{ngWords.length}件</span></div>
    <p className="cf-muted">投稿者名・本文に含まれるコメントを除外します。</p>
    <label className="cf-field">NGワード（1行1件）<textarea className="cf-words" rows={6} value={words} onChange={event => editWords(event.target.value)} spellCheck={false} placeholder={'例：ネタバレ\n宣伝です'} /></label>
    <div className="cf-row cf-between cf-caption"><span>空行・重複は自動で整理</span><span>入力後に自動反映</span></div>
    <details className="cf-details"><summary>一致のしかた</summary><p>部分一致で判定します。英字の大文字・小文字、全角・半角の違いは区別しません。正規表現は使えません。</p></details>
  </section>;

  const AaEditor = <section className="cf-aa cf-section">
    <div className="cf-row cf-between cf-nowrap"><div><h2>アスキーアート判定</h2><p className="cf-muted">大きな複数行の記号アートを除外</p></div>
      <label className="cf-switch"><input type="checkbox" aria-label="アスキーアート判定" checked={aa} onChange={event => toggleAa(event.target.checked)} /><span>{aa ? 'オン' : 'オフ'}</span></label></div>
    <div className="cf-art-examples"><div><span className="cf-caption">判定の対象</span><pre>{art}</pre><span className="cf-caption">複数行のアート</span></div><div><span className="cf-caption">そのまま通す</span><pre>(^_^)</pre><span className="cf-caption">1行の顔文字</span></div></div>
  </section>;

  const Tester = <section className="cf-tester cf-section">
    <div className="cf-section-title"><h2>判定を試す</h2><span className="cf-pill">入力中の設定</span></div>
    <p className="cf-muted">サンプルを入力して、除外されるか確認。</p>
    <div className="cf-samples" aria-label="テスト用サンプル">
      <button onClick={() => { setAuthor('視聴者さん'); setBody('こんにちは！ (^_^)'); }}>通常文</button>
      <button onClick={() => { setAuthor('視聴者さん'); setBody('今日はネタバレなしで楽しもう！'); }}>NGワード入り</button>
      <button onClick={() => { setAuthor('視聴者さん'); setBody(art); }}>アート</button>
    </div>
    <label className="cf-field">投稿者名<input value={author} onChange={event => setAuthor(event.target.value)} /></label>
    <label className="cf-field">コメント本文<textarea rows={3} value={body} onChange={event => setBody(event.target.value)} /></label>
    <div className={`cf-result ${blocked ? 'blocked' : 'allowed'}`} role="status" aria-live="polite">
      <strong>{!author.trim() && !body.trim() ? '— コメントを入力してください' : blocked ? '⊘ このコメントは除外されます' : '✓ このコメントは通過します'}</strong>
      <span>{matched ? `NGワード「${matched}」に一致` : aa && isAsciiArt(body) ? '複数行のアスキーアートに該当' : 'NGワード・アスキーアートへの該当なし'}</span>
    </div>
    <p className="cf-caption">見本内だけのテストです。投稿・表示・読み上げは行いません。</p>
  </section>;

  const Impact = <div className="cf-impact"><span className="cf-impact-icon" aria-hidden="true">◇</span><div><strong>すべてのコメントソースに共通で適用</strong><p>除外したコメントは、コメント一覧・OBS・スマホに表示されず、読み上げ・文字演出も行いません。</p></div></div>;
  const scopeNote = <p className="cf-footnote">反映後に受信するコメントから適用します。以前のコメントは再判定せず、除外済みのコメントも復元しません。</p>;

  return <div id="filter-designs">
    <div className="cf-intro"><div><span className="cf-eyebrow">COMMENT FILTER / DESIGN STUDY</span><h1>少ない操作で、安心して配信を。</h1></div><span className="cf-demo-label">操作できる見本 · 実設定への保存なし</span></div>
    <div className="cf-window">
      <header className="cf-header"><span className="cf-brand"><span className="cf-logo">き</span><span className="cf-brand-text">きゃすメイト</span></span><div className="cf-toast" role="status" hidden={!toast} title={toast}>✓ <span>{toast}</span></div><span className="cf-server" aria-label="プレビューはローカルのみ">◇ <span>ローカルプレビュー</span></span></header>
      <nav className="cf-nav" aria-label="メイン"><button aria-current={page === 'home' ? 'page' : undefined} onClick={() => setPage('home')}>ホーム</button><button aria-current={page !== 'home' ? 'page' : undefined} onClick={() => setPage('settings')}>設定</button><button ref={warningButton} className="cf-warnings" onClick={() => setWarnings(true)}>⚠ 要確認 {failure ? 1 : 0}件</button></nav>
      <main className="cf-content">
        {page !== 'editor' ? <section className="cf-placeholder"><h1>{page === 'home' ? 'ホーム' : '設定'}</h1><p>コメントの表示と読み上げに共通の設定</p><button className="cf-entry" onClick={() => setPage('editor')}><span>◇ コメントフィルター</span><span>NGワード {ngWords.length}件 / アスキーアート判定 {aa ? 'オン' : 'オフ'} →</span></button></section> : <>
          <div className="cf-heading"><button className="cf-back" aria-label="設定一覧へ戻る" onClick={() => setPage('settings')}>←</button><h1>コメントフィルター</h1><span className="cf-save-state" aria-live="polite">{failure ? '⚠ 未反映の変更あり' : saving ? '◌ 反映待ち' : '✓ 反映済み'}</span></div>
          {variant === 'A' && <>{Impact}<div className="cf-layout-a"><div className="cf-stack">{WordEditor}{AaEditor}</div>{Tester}</div>{scopeNote}</>}
          {variant === 'B' && <><div className="cf-tabs" aria-label="編集する項目">{[['words', 'NGワード', `${ngWords.length}件`], ['art', 'アスキーアート判定', aa ? 'オン' : 'オフ'], ['test', '判定を試す', 'テスト']].map(([id, title, detail]) => <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}><span>{title}</span><small>{detail}</small></button>)}</div>
            {tab === 'words' && <section className="cf-library"><div className="cf-section-title"><div><h2>NGワードを管理</h2><p className="cf-muted">投稿者名・本文への部分一致で除外します。</p></div><button className="cf-quiet" onClick={() => setBulk(!bulk)}>{bulk ? '一覧に戻る' : 'まとめて編集'}</button></div>
              {bulk ? WordEditor : <><form className="cf-add" onSubmit={event => { event.preventDefault(); addWord(); }}><label className="cf-field">NGワードを追加<input value={newWord} aria-describedby="add-help" onChange={event => { setNewWord(event.target.value); setAddError(''); }} placeholder="例：ネタバレ" /></label><button className="cf-primary" type="submit">＋ 追加</button></form><p className="cf-add-help" id="add-help" role="status">{addError || 'Enterで追加。空白・重複は整理されます。'}</p>
                <div className="cf-list-heading"><label className="cf-search">登録済みを検索<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="NGワードを検索" /></label><span className="cf-caption">{ngWords.filter(word => normalizeCommentFilterText(word).includes(normalizeCommentFilterText(query))).length} / {ngWords.length}件</span></div>
                <ul className="cf-word-list">{ngWords.filter(word => normalizeCommentFilterText(word).includes(normalizeCommentFilterText(query))).map(word => <li key={word}><span>{word}</span><span className="cf-word-match">部分一致</span><button className="cf-quiet" aria-label={`${word}を削除`} onClick={() => editWords(ngWords.filter(item => item !== word).join('\n'))}>削除</button></li>)}{!ngWords.filter(word => normalizeCommentFilterText(word).includes(normalizeCommentFilterText(query))).length && <li className="cf-empty">{query ? '一致する登録がありません。' : 'NGワードは未登録です。上の入力欄から追加できます。'}</li>}</ul>
                <p className="cf-caption">大文字・小文字、全角・半角の違いは区別しません。</p></>}
            </section>}{tab === 'art' && <div className="cf-focused">{AaEditor}</div>}{tab === 'test' && <div className="cf-focused">{Tester}</div>}{Impact}{scopeNote}</>}
          {variant === 'C' && <><div className="cf-steps" aria-label="設定の手順">{['NGワード', 'アスキーアート', '確認'].map((title, index) => <button key={title} aria-current={step === index ? 'step' : undefined} onClick={() => setStep(index)}><span>{index + 1}</span>{title}</button>)}</div><div className="cf-guided"><aside><span className="cf-eyebrow">STEP 0{step + 1}</span><h2>{['表示したくない\n言葉を登録', '大きなアートを\n控えめに', '配信前に\n確かめる'][step]}</h2><p>{['投稿者名と本文の両方が対象です。NGワードがなければ空のまま進めます。', '1行の顔文字や通常の文章は残し、複数行の記号アートを判定します。', '入力中の設定でテストできます。各設定は操作した時点で自動反映されます。'][step]}</p><span className="cf-caption">{step + 1} / 3</span></aside><div>{step === 0 ? WordEditor : step === 1 ? AaEditor : Tester}</div></div><div className="cf-step-footer"><button disabled={step === 0} onClick={() => setStep(step - 1)}>← 前へ</button><span className="cf-caption">各項目は自動反映</span><button className="cf-primary" onClick={() => step === 2 ? setPage('settings') : setStep(step + 1)}>{step === 2 ? '設定一覧へ' : '次へ →'}</button></div>{Impact}{scopeNote}</>}
        </>}
      </main>
    </div>
    <div className="cf-evaluation"><p><strong>{variant}：{names[variant]}</strong><span>{descriptions[variant]}</span></p><label>比較する状態<select aria-label="比較する状態" defaultValue="normal" onChange={event => scenario(event.target.value)}><option value="normal">設定済み</option><option value="empty">初回・未登録</option><option value="many">NGワード60件</option><option value="failure">保存失敗（次の変更から）</option></select></label></div>
    <details className="cf-debug"><summary>見本の状態を確認</summary><pre>{JSON.stringify({ variant, page, step, tab, draft: { ngWords, asciiArtEnabled: aa }, applied: saved, unsaved: dirty, simulateFailure, sample: { author, body }, blocked }, null, 2)}</pre></details>
    {import.meta.env.DEV && <div className="cf-switcher" role="group" aria-label="デザイン案を比較"><button aria-label="前の案" onClick={() => switchVariant(variants[(variants.indexOf(variant) + 2) % 3])}>←</button>{variants.map(value => <button key={value} aria-pressed={variant === value} onClick={() => switchVariant(value)}><b>{value}</b><span>{names[value]}</span></button>)}<button aria-label="次の案" onClick={() => switchVariant(variants[(variants.indexOf(variant) + 1) % 3])}>→</button></div>}
    <dialog className="cf-dialog" ref={warningDialog} aria-labelledby="warning-title" onCancel={() => setWarnings(false)} onClose={() => { setWarnings(false); warningButton.current?.focus(); }}><div className="cf-section-title"><h2 id="warning-title">要確認</h2><button onClick={() => setWarnings(false)}>閉じる</button></div><p>{failure ? '設定を反映できませんでした。入力値は保持しています。直前に反映できた設定が有効です。' : '現在、要確認事項はありません。'}</p>{failure && <><p className="cf-caption">見本では、ここから保存できる状態に戻して再試行できます。</p><button className="cf-primary" onClick={() => { setSimulateFailure(false); setFailure(false); setSaving(false); clearTimeout(saveTimer.current); setSaved({ ngWords, asciiArtEnabled: aa }); notify('設定を反映しました（見本）'); }}>復旧して再試行（見本）</button></>}</dialog>
  </div>;
}
