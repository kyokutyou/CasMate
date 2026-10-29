import { useReducer, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { CommonControls, AdvancedControls, CommentControls, SpeechControls, SampleControls } from './EditorControls';
import { generateCss } from './css';
import { createHistory, historyReducer } from './history';
import { createDefaultDocument, createPreset, parseDocument } from './model';
import type { CommentDesign, CommentPreview, EditorDocument, PresetName, SpeechDesign, SpeechPreview, Target } from './model';
import { Preview } from './Preview';
import { PresetCards } from './PresetCards';
import './editor.css';

const targetNames: Record<Target, string> = { comments: 'コメント', speech: '音声認識' };
type DesignPatch = Partial<CommentDesign & SpeechDesign>;
type PreviewPatch = Partial<CommentPreview & SpeechPreview>;

function downloadFile(text: string, filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  try { anchor.click(); } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function ObsStyleEditorApp() {
  const [history, dispatch] = useReducer(historyReducer<EditorDocument>, undefined, () => createHistory(createDefaultDocument()));
  const [target, setTarget] = useState<Target>('comments');
  const [revisions, setRevisions] = useState<Record<Target, number>>({ comments: 0, speech: 0 });
  const [status, setStatus] = useState({ kind: 'idle', text: '見本を見ながらデザインを調整し、OBS用CSSをコピーしてください。' });
  const [manualCopy, setManualCopy] = useState(false);
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const manualInput = useRef<HTMLTextAreaElement>(null);
  const state = history.present;
  const preview = state.previews[target];
  const css = generateCss(target, state.designs[target]);
  const gesture = (panelTarget: Target) => ({
    revision: revisions[panelTarget],
    onBegin: () => { if (!loadingRef.current) dispatch({ type: 'begin' }); },
    onEnd: () => dispatch({ type: 'end' }),
  });
  function patchDesign(panelTarget: Target, patch: DesignPatch) {
    if (loadingRef.current) return;
    dispatch({ type: 'edit', transform: (current) => ({ ...current, designs: { ...current.designs, [panelTarget]: { ...current.designs[panelTarget], ...patch } } }) });
  }
  function patchPreview(panelTarget: Target, patch: PreviewPatch) {
    if (loadingRef.current) return;
    dispatch({ type: 'edit', transform: (current) => ({ ...current, previews: { ...current.previews, [panelTarget]: { ...current.previews[panelTarget], ...patch } } }) });
  }
  function preset(name: PresetName) {
    dispatch({ type: 'end' });
    dispatch({ type: 'edit', transform: (current) => ({ ...current, designs: { ...current.designs, [target]: createPreset(target, name) } }) });
    setRevisions((current) => ({ ...current, [target]: current[target] + 1 }));
    setStatus({ kind: 'success', text: `${targetNames[target]}のデザインを変更しました。取り消しで戻せます。` });
  }
  function restore(action: 'undo' | 'redo') {
    dispatch({ type: action });
    setRevisions((current) => ({ comments: current.comments + 1, speech: current.speech + 1 }));
  }
  async function copyCss() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(css);
      setStatus({ kind: 'success', text: `${targetNames[target]}のOBS用CSSをコピーしました。` });
    } catch {
      setManualCopy(true);
      setStatus({ kind: 'error', text: 'コピーできませんでした。プレビュー下の手動コピー欄でCSSを選択し、Ctrl+Cを押してください。' });
    }
  }
  function save(kind: 'css' | 'settings') {
    try {
      downloadFile(kind === 'css' ? css : JSON.stringify(state, null, 2), kind === 'css' ? `casmate-${target === 'comments' ? 'comments' : 'speech-recognition'}.css` : 'casmate-obs-style-settings.json', kind === 'css' ? 'text/css;charset=utf-8' : 'application/json;charset=utf-8');
      setStatus({ kind: 'success', text: kind === 'css' ? 'OBS用CSSを保存しました。' : '両方のデザインと見本を、再編集用設定として保存しました。' });
    } catch {
      setStatus({ kind: 'error', text: '保存できませんでした。ブラウザのダウンロード設定を確認してください。' });
    }
  }
  async function loadSettings(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    dispatch({ type: 'end' });
    setStatus({ kind: 'busy', text: '再編集用設定を確認しています。' });
    try {
      if (file.size > 1024 * 1024) throw new Error('設定ファイルは1MiB以下にしてください。');
      const loaded = parseDocument(await file.text());
      dispatch({ type: 'edit', transform: () => loaded });
      setRevisions((current) => ({ comments: current.comments + 1, speech: current.speech + 1 }));
      setStatus({ kind: 'success', text: '両方のデザインと見本を読み込みました。取り消しで戻せます。' });
    } catch (error) {
      setStatus({ kind: 'error', text: `読み込めませんでした。${error instanceof Error ? error.message : 'ファイルを読み取れません。'}` });
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }
  return <div className="obs-style-editor">
    <header className="editor-header"><div className="editor-brand"><span className="brand-mark" aria-hidden="true">◧</span><div><p className="eyebrow">きゃすメイト / OBS</p><h1>OBS着せ替えツール</h1></div></div><p className="header-description">見本を見ながら、OBSの表示を調整します。</p></header>
    <section className="output-toolbar" aria-label="出力と保存">
      <div className="output-buttons"><div className="output-purpose" role="group" aria-label="OBSへ反映"><strong>OBSへ反映</strong><button type="button" className="primary-button" disabled={loading} onClick={() => { void copyCss(); }}>OBS用CSSをコピー <span aria-hidden="true">↗</span></button><button type="button" disabled={loading} onClick={() => save('css')}>OBS用CSSを保存</button></div><div className="output-purpose" role="group" aria-label="編集の続きを保存"><strong>編集の続きを保存</strong><button type="button" disabled={loading} onClick={() => save('settings')}>再編集用設定を保存</button><button type="button" disabled={loading} onClick={() => fileInput.current?.click()}>再編集用設定を読み込む</button></div></div>
      <input className="visually-hidden" type="file" accept="application/json,.json" ref={fileInput} aria-label="再編集用設定ファイル" tabIndex={-1} onChange={(event) => { void loadSettings(event); }} />
      <div className="output-help"><p><strong>{targetNames[target]}用CSS</strong><span>OBSの幅 <b>{preview.width}px</b> / 高さ <b>{preview.height}px</b></span></p><p>OBSのブラウザソース → プロパティ →「カスタムCSS」へ貼り付けます。</p></div>
      <p className="save-help">続きから編集するには「再編集用設定を保存」。閉じると未保存の内容は失われます。</p>
      <div className="editor-status" role="status" aria-live="polite" data-kind={status.kind} title={status.text}>{status.text}</div>
    </section>
    <nav className="editor-navigation" aria-label="編集対象"><div className="target-tabs" role="tablist" aria-label="表示を選択">
      {(['comments', 'speech'] as const).map((item) => <button key={item} type="button" role="tab" id={`tab-${item}`} aria-selected={target === item} aria-controls={`panel-${item}`} tabIndex={target === item ? 0 : -1} disabled={loading} onClick={() => setTarget(item)} onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { const next = item === 'comments' ? 'speech' : 'comments'; setTarget(next); document.getElementById(`tab-${next}`)?.focus(); event.preventDefault(); } }}>{targetNames[item]}</button>)}
    </div><div className="history-buttons"><button type="button" disabled={loading || (history.past.length === 0 && history.gestureStart === null)} onClick={() => restore('undo')} aria-label="取り消し">↶ <span>取り消し</span></button><button type="button" disabled={loading || history.future.length === 0} onClick={() => restore('redo')} aria-label="やり直し">↷ <span>やり直し</span></button></div></nav>
    <main className="editor-layout">
      <section className="preview-column" aria-label="プレビューと見本"><div className="section-title"><h2>プレビュー</h2><span>見本 / オフライン</span></div><Preview target={target} document={state} />
        <fieldset disabled={loading} className="sample-fieldset"><SampleControls key={target} target={target} document={state} onPatch={(patch) => patchPreview(target, patch)} {...gesture(target)} /></fieldset>
        <section className="manual-copy-panel" aria-label="手動コピー欄" data-visible={manualCopy}>
          <div className="manual-copy-heading"><h3>OBS用CSSの手動コピー</h3><button type="button" onClick={() => setManualCopy((current) => !current)}>{manualCopy ? '欄を隠す' : '欄を表示'}</button></div>
          <div className="manual-copy-content" style={{ visibility: manualCopy ? 'visible' : 'hidden' }}><textarea ref={manualInput} aria-label="生成されたOBS用CSS" readOnly value={css} tabIndex={manualCopy ? 0 : -1} /><button type="button" tabIndex={manualCopy ? 0 : -1} onClick={() => { manualInput.current?.focus(); manualInput.current?.select(); }}>CSSをすべて選択</button></div>
        </section>
      </section>
      <aside className="design-column" aria-label="デザイン編集">
        {(['comments', 'speech'] as const).map((panelTarget) => <section role="tabpanel" id={`panel-${panelTarget}`} aria-labelledby={`tab-${panelTarget}`} key={panelTarget} hidden={target !== panelTarget}>
          <div className="section-title"><h2>デザイン</h2><button type="button" className="reset-button" disabled={loading} onClick={() => preset('standard')}>初期化</button></div>
          <fieldset disabled={loading} className="design-fieldset"><div className="preset-section"><h3>プリセットから始める</h3><PresetCards target={panelTarget} onSelect={preset}/><p className="panel-note">選択中のデザインを置き換えます。取り消しで戻せます。</p></div>
            <section className="basic-controls"><h3>基本のデザイン</h3><CommonControls key={revisions[panelTarget]} design={state.designs[panelTarget]} onPatch={(patch) => patchDesign(panelTarget, patch)} {...gesture(panelTarget)} />
              {panelTarget === 'comments' ? <CommentControls design={state.designs.comments} onPatch={(patch) => patchDesign(panelTarget, patch)} {...gesture(panelTarget)} /> : <SpeechControls design={state.designs.speech} onPatch={(patch) => patchDesign(panelTarget, patch)} {...gesture(panelTarget)} />}
            </section><AdvancedControls target={panelTarget} document={state} onPatch={(patch) => patchDesign(panelTarget, patch)} {...gesture(panelTarget)} />
          </fieldset>
        </section>)}
      </aside>
    </main><footer className="editor-footer">対応アプリ: きゃすメイト {createDefaultDocument().appVersion} ・このツールはネット接続を使いません。</footer>
  </div>;
}
