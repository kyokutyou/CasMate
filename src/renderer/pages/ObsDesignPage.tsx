import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useApplicationState } from '../api';
import { commentDesignFromSettings, speechDesignFromSettings, createObsDesignPreset, validateObsDesign } from '../../shared/obs-design';
import type { ObsCommentDesign, ObsSpeechDesign } from '../../shared/obs-design';
import type { AppSettings } from '../../shared/types';
import type { CommentDesign, SpeechDesign, Target, PresetName, EditorDocument } from '../obs-style-editor/model';
import { createDefaultDocument } from '../obs-style-editor/model';
import { CommentControls, SpeechControls, AdvancedControls, SampleControls } from '../obs-style-editor/EditorControls';
import { ApplicationDesignControls } from '../obs-style-editor/ApplicationDesignControls';
import { Preview } from '../obs-style-editor/Preview';
import { PresetCards } from '../obs-style-editor/PresetCards';
import { SavedDesigns } from '../obs-style-editor/SavedDesigns';
import type { SavedDesignOperation } from '../obs-style-editor/SavedDesigns';
import { createHistory, historyReducer } from '../obs-style-editor/history';
import { useDesignSaving } from '../obs-style-editor/use-design-saving';
import { loadWindowsFonts } from '../windows-fonts';
import { managementThemeStyle } from '../management-themes';
import { managementTextSizeStyle } from '../management-text-sizes';
import type {} from '../../shared/obs-design-bridge';
import '../obs-style-editor/editor.css';
import { ManagementToast } from '../components/ManagementToast';
import { useSuccessNoticeExpiry } from '../use-success-notice-expiry';
import './obs-design-page.css';

const names = { comments: 'コメント', speech: '音声認識' };
const editingTabs = [{ id: 'adjust', label: '調整' }, { id: 'presets', label: 'プリセット' }, { id: 'saved', label: '保存済み' }] as const;
type EditingTab = typeof editingTabs[number]['id'];
type EditState = { design: ObsCommentDesign | ObsSpeechDesign; document: EditorDocument };

function Editor({ target, settings, save, onPending, operateSaved, onNotice }: { target: Target; settings: AppSettings;
  save(value: ObsCommentDesign | ObsSpeechDesign): Promise<unknown>; onPending(target: Target, pending: boolean): void;
  operateSaved(operation: SavedDesignOperation): Promise<unknown>; onNotice(message: string): void }) {
  const [editingTab, setEditingTab] = useState<EditingTab>('adjust');
  const savedCollection = settings.application.obsSavedDesigns?.[target] ?? { nextNumber: 1, items: [] };
  const [copyPending, setCopyPending] = useState(false);
  const [history, dispatch] = useReducer(historyReducer<EditState>, undefined, () => createHistory({
    design: target === 'comments' ? commentDesignFromSettings(settings.commentOverlay) : speechDesignFromSettings(settings.speechRecognitionOverlay),
    document: createDefaultDocument(),
  }));
  const [revision, setRevision] = useState(0);
  const [fonts, setFonts] = useState<string[]>([]);
  const [fontStatus, setFontStatus] = useState('');
  const [fontBusy, setFontBusy] = useState(false);
  const fontWorking = useRef(false);
  const refreshFonts = useCallback(async () => {
    if (fontWorking.current) return;
    fontWorking.current = true;
    setFontBusy(true);
    try { setFonts(await loadWindowsFonts()); setFontStatus(''); }
    catch { setFontStatus('フォント一覧を取得できませんでした。現在の値は保持しています。'); }
    finally { fontWorking.current = false; setFontBusy(false); }
  }, []);
  useEffect(() => { void refreshFonts(); }, [refreshFonts]);
  const { design } = history.present;
  const saving = useDesignSaving(design, save);
  const remote = target === 'comments' ? settings.commentOverlay.design : settings.speechRecognitionOverlay.design;
  const adopt = saving.adopt;
  useEffect(() => {
    if (!remote || saving.pending || JSON.stringify(remote) === JSON.stringify(design) || documentHasInvalidInput(target)) return;
    adopt(remote);
    dispatch({ type: 'edit', transform: current => ({ ...current, design: remote }) });
    setRevision(value => value + 1);
  }, [remote, design, saving.pending, adopt, target]);
  useEffect(() => { onPending(target, saving.pending || copyPending); }, [target, saving.pending, copyPending, onPending]);
  const document = { ...history.present.document, designs: { ...history.present.document.designs, [target]: design.style } };
  const gesture = { revision, onBegin: () => dispatch({ type: 'begin' }), onEnd: () => dispatch({ type: 'end' }) };
  const patchDesign = (patch: Partial<CommentDesign & SpeechDesign>) => dispatch({ type: 'edit', transform: current => ({ ...current, design: validateObsDesign(target, { ...current.design, style: { ...current.design.style, ...patch } }) }) });
  const patchOuter = (patch: Partial<ObsCommentDesign & ObsSpeechDesign>) => dispatch({ type: 'edit', transform: current => ({ ...current, design: { ...current.design, ...patch } }) });
  const applyDesign = (next: ObsCommentDesign | ObsSpeechDesign) => {
    dispatch({ type: 'end' });
    dispatch({ type: 'edit', transform: current => ({ ...current, design: next }) });
    setRevision(current => current + 1);
  };
  return <>
    <div className="design-toolbar">
    <div className="history-buttons"><button type="button" disabled={history.past.length === 0 && history.gestureStart === null} onClick={() => { dispatch({ type: 'undo' }); setRevision(value => value + 1); }}>取り消し</button><button type="button" disabled={history.future.length === 0} onClick={() => { dispatch({ type: 'redo' }); setRevision(value => value + 1); }}>やり直し</button></div>
    <div className="design-save-status" aria-live="polite"><span role="status">{saving.error || (saving.pending ? '保存待ち・保存中…' : '自動保存済み')}</span><button type="button" aria-disabled={!saving.error} onClick={() => { if (saving.error) void saving.retry(); }}>再保存</button></div>
    </div>
    <main className="editor-layout">
      <section className="preview-column" aria-label="プレビューと見本"><h2>プレビュー</h2>
        <Preview target={target} document={document} application={{ comments: { ...settings.commentOverlay, ...(target === 'comments' ? { design: design as ObsCommentDesign } : {}) }, speech: { ...settings.speechRecognitionOverlay, ...(target === 'speech' ? { design: design as ObsSpeechDesign } : {}) } }} />
        <SampleControls target={target} document={document} {...gesture} onPatch={patch => dispatch({ type: 'edit', transform: current => ({ ...current, document: { ...current.document, previews: { ...current.document.previews, [target]: { ...current.document.previews[target], ...patch } } } }) })} />
      </section>
      <aside className="design-column" aria-label={`${names[target]}のデザイン編集`}>
        <SavedDesigns target={target} design={design} collection={savedCollection} invalid={() => documentHasInvalidInput(target)} operate={operateSaved} onApply={applyDesign} onPending={setCopyPending} onNotice={onNotice} showSaved={editingTab === 'saved'} navigation={
          <div className="design-editor-tabs" role="tablist" aria-label="デザインの編集項目">{editingTabs.map((tab, index) => <button key={tab.id} type="button" id={`design-editor-tab-${target}-${tab.id}`} role="tab" aria-selected={editingTab === tab.id} aria-controls={`design-editor-panel-${target}-${tab.id}`} tabIndex={editingTab === tab.id ? 0 : -1} onClick={() => setEditingTab(tab.id)} onKeyDown={event => {
            const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? editingTabs.length - 1 : event.key === 'ArrowRight' ? (index + 1) % editingTabs.length : event.key === 'ArrowLeft' ? (index + editingTabs.length - 1) % editingTabs.length : null;
            if (nextIndex === null) return;
            event.preventDefault();
            const next = editingTabs[nextIndex].id;
            setEditingTab(next);
            window.document.getElementById(`design-editor-tab-${target}-${next}`)?.focus();
          }}>{tab.label}{tab.id === 'saved' && <span className="saved-design-count">{savedCollection.items.length}</span>}</button>)}</div>
        }/>
        <section className="preset-section" role="tabpanel" id={`design-editor-panel-${target}-presets`} aria-labelledby={`design-editor-tab-${target}-presets`} hidden={editingTab !== 'presets'}><PresetCards target={target} application onSelect={(name: PresetName) => applyDesign(createObsDesignPreset(target, name))}/></section>
        <div className="design-adjust-panel" role="tabpanel" id={`design-editor-panel-${target}-adjust`} aria-labelledby={`design-editor-tab-${target}-adjust`} hidden={editingTab !== 'adjust'}>
        <ApplicationDesignControls design={design} fonts={fonts.includes(design.style.fontFamily) ? fonts : [design.style.fontFamily, ...fonts]} fontBusy={fontBusy} fontStatus={fontStatus} onRefreshFonts={() => { void refreshFonts(); }} onPatchStyle={patchDesign} onPatchOuter={patchOuter} {...gesture}/>
        {target === 'comments' ? <CommentControls application compact design={design.style as CommentDesign} onPatch={patchDesign} {...gesture} /> : <SpeechControls compact design={design.style as SpeechDesign} onPatch={patchDesign} {...gesture}/>}
        <AdvancedControls compact hideLineHeight target={target} document={document} onPatch={patchDesign} {...gesture}/>
        </div>
      </aside>
    </main>
  </>;
}

function documentHasInvalidInput(target: Target) { return !!window.document.querySelector(`#design-panel-${target} [aria-invalid="true"]`); }

export function ObsDesignPage() {
  const api = useApplicationState(true);
  const [target, setTarget] = useState<Target>(new URLSearchParams(location.search).get('target') === 'speech' ? 'speech' : 'comments');
  const [pending, setPending] = useState({ comments: false, speech: false });
  const [closeMessage, setCloseMessage] = useState('');
  const [closing, setClosing] = useState(false);
  const [notice, setNotice] = useState<{ message: string; tone: 'success' } | null>(null);
  useSuccessNoticeExpiry(notice, setNotice);
  const onPending = useCallback((key: Target, value: boolean) => setPending(current => current[key] === value ? current : { ...current, [key]: value }), []);
  const unsaved = pending.comments || pending.speech;
  useEffect(() => window.casmateObsDesign?.onTarget(next => { setClosing(false); setCloseMessage(''); setTarget(next); }), []);
  useEffect(() => {
    const receive = (event: MessageEvent) => { if (event.origin === location.origin && event.source === window.opener && (event.data?.target === 'comments' || event.data?.target === 'speech')) setTarget(event.data.target); };
    window.addEventListener('message', receive); return () => window.removeEventListener('message', receive);
  }, []);
  useEffect(() => {
    const blocked = () => unsaved || !!document.querySelector('.obs-design-page [aria-invalid="true"]');
    const unsubscribe = window.casmateObsDesign?.onCloseRequest(() => {
      if (blocked()) setCloseMessage('未保存の変更または入力エラーがあります。入力を修正し、保存完了後に閉じてください。');
      else { setClosing(true); window.casmateObsDesign?.closeReady(); }
    });
    const beforeUnload = (event: BeforeUnloadEvent) => { if (!window.casmateObsDesign && blocked()) event.preventDefault(); };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { unsubscribe?.(); window.removeEventListener('beforeunload', beforeUnload); };
  }, [unsaved]);
  if (!api.snapshot) return <main className="center-message">{api.error || 'デザイン設定を読み込み中…'}</main>;
  const settings = api.snapshot.settings;
  return <div className="obs-design-page obs-style-editor" style={{ ...managementThemeStyle(settings.application.managementTheme), ...managementTextSizeStyle(settings.application.managementTextSize) }}>
    <header className="editor-header"><h1>OBSデザイン編集</h1><div className="design-notifications"><ManagementToast notice={notice}/></div></header>
    <details className="design-help"><summary>使い方・OBSへの反映について</summary><p className="design-css-note">文字や背景を、見本を見ながら調整します。OBSにカスタムCSSを設定している場合、変更が見えないことがあります。見本の文章や寸法は配信へ反映しません。</p></details>
    <fieldset disabled={closing} className="design-editing-fields">
    <nav className="editor-navigation" aria-label="編集対象"><div className="target-tabs" role="tablist">{(['comments', 'speech'] as const).map(item => <button key={item} id={`design-tab-${item}`} role="tab" aria-selected={target === item} aria-controls={`design-panel-${item}`} tabIndex={target === item ? 0 : -1} onClick={() => setTarget(item)} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { const next = item === 'comments' ? 'speech' : 'comments'; setTarget(next); document.getElementById(`design-tab-${next}`)?.focus(); event.preventDefault(); } }}>{names[item]}</button>)}</div><p className="design-close-status" role="status">{closeMessage || api.error || '変更は自動保存され、OBS表示へ反映されます。'}</p></nav>
    {(['comments', 'speech'] as const).map(item => <section key={item} role="tabpanel" id={`design-panel-${item}`} aria-labelledby={`design-tab-${item}`} hidden={target !== item}>
      <Editor target={item} settings={settings} onPending={onPending} onNotice={message => setNotice({ message, tone: 'success' })} operateSaved={operation => operation.kind === 'add' ? api.mutate(`/api/obs-design/${item}/saved`, 'POST', operation.body) : api.mutate(`/api/obs-design/${item}/saved/${operation.id}`, 'DELETE')} save={async value => { await api.mutate(`/api/obs-design/${item}`, 'PUT', value); setNotice({ message: `${names[item]}のデザインを保存しました。`, tone: 'success' }); }}/>
    </section>)}
    </fieldset>
  </div>;
}
