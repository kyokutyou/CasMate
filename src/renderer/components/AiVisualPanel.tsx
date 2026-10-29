import { CompactFeedback } from './CompactFeedback';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { AiSettings, AiView } from '../../shared/ai-listener';
import type { AiCapture, AiImageStatus, AiVisualSource } from '../../shared/ai-visual';
import { ManagementNavigation } from '../management-navigation';
import { SlimSwitch } from './SlimSwitch';
import { AiVisualDebug } from './AiVisualDebug';
import './ai-visual-panel.css';

export interface AiVisualProps {
  settings: AiSettings; view: AiView; active: boolean; saveError?: string;
  change(settings: AiSettings): void; mutate(path: string, method?: string, body?: unknown): Promise<unknown>;
  onSuccess?(message: string): void;
  onError?(message: string): void;
}
export function AiVisualPanel({ settings, view, active, saveError, change, mutate, onSuccess, onError }: AiVisualProps) {
  const mutateRef = useRef(mutate);
  useEffect(() => { mutateRef.current = mutate; }, [mutate]);
  const call = useCallback((path: string, method?: string, body?: unknown) => mutateRef.current(path, method, body), []);
  const visual = settings.visual ?? { enabled: false, source: null };
  const [sources, setSources] = useState<AiVisualSource[]>([]);
  const [capture, setCapture] = useState<AiCapture | null>(null);
  const [status, setStatus] = useState<AiImageStatus | null>(null);
  const [debug, setDebug] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sourceError, setSourceError] = useState('');
  const [captureError, setCaptureError] = useState('');
  const error = captureError || sourceError;
  const [debugError, setDebugError] = useState('');
  const [enableRequested, setEnableRequested] = useState(false);
  const sourceSelect = useRef<HTMLSelectElement>(null);
  const sourcesRequested = useRef(false);
  const navigation = useContext(ManagementNavigation);
  const revision = useRef(0); const sourceKey = JSON.stringify(visual.source);
  const inFlight = useRef(false);
  useEffect(() => { revision.current++; setCapture(null); setStatus(null); }, [sourceKey]);
  useEffect(() => () => { revision.current++; }, []);
  useEffect(() => { onError?.(error || debugError); }, [onError, error, debugError]);
  useEffect(() => {
    if (!active) return;
    let closed = false;
    const refresh = async () => {
      try {
        const response = await call('/api/ai-listener/visual/status', 'POST') as { status?: AiImageStatus; debugEnabled?: boolean } | undefined;
        if (!closed && response) { setStatus(response.status ?? null); setDebug(Boolean(response.debugEnabled)); }
      } catch { /* Explicit actions report actionable failures; polling cannot overwrite them. */ }
    };
    void refresh(); const timer = setInterval(() => void refresh(), 3000);
    return () => { closed = true; clearInterval(timer); };
  }, [active, call]);
  const run = useCallback(async (action: 'sources' | 'capture', notify = true) => {
    if (inFlight.current) return; inFlight.current = true;
    const current = ++revision.current; setBusy(true); if (notify) (action === 'sources' ? setSourceError : setCaptureError)('');
    if (action === 'capture') setCapture(null);
    try {
      const response = await call(`/api/ai-listener/visual/${action}`, 'POST', action === 'capture' ? { source: visual.source } : undefined) as { sources?: AiVisualSource[]; capture?: AiCapture };
      if (current !== revision.current) return;
      if (action === 'sources') { setSources(response.sources ?? []); setSourceError(''); if (notify) onSuccess?.('映像ソース一覧を更新しました。'); }
      else { setCapture(response.capture ?? null); if (!response.capture?.image) setCaptureError(response.capture?.reason ?? '撮影できませんでした。'); else onSuccess?.('撮影画像を確認できます。'); }
    } catch (e) { if (current === revision.current) (action === 'sources' ? setSourceError : setCaptureError)(e instanceof Error ? e.message : '映像を取得できません。'); }
    finally { inFlight.current = false; setBusy(false); }
  }, [call, visual.source, onSuccess]);
  useEffect(() => {
    if (!active) { sourcesRequested.current = false; return; }
    if (sourcesRequested.current || inFlight.current) return;
    sourcesRequested.current = true;
    void run('sources', false);
  }, [active, run, busy]);
  const selectedKey = visual.source ? `${visual.source.collection}\n${visual.source.uuid}` : '';
  const listed = sources.some(s => s.uuid === visual.source?.uuid && s.collection === visual.source.collection);
  return <section className="ai-section ai-visual">
    <div className="ai-section-heading"><h3>OBSの映像をAIに見せる</h3><div className="ai-visual-heading-actions"><span className="ai-save-note">自動保存</span>
    <SlimSwitch label="配信映像をAIに見せる" checked={visual.enabled || enableRequested} disabled={busy} keepFocus
      onChange={enabled => {
        if (enabled && !visual.source) { setEnableRequested(true); sourceSelect.current?.focus({ preventScroll: true }); return; }
        setEnableRequested(false);
        if (visual.enabled !== enabled) change({ ...settings, visual: { ...visual, enabled } });
      }} /></div></div>
    <CompactFeedback className="ai-help ai-visual-toggle-help" role="status" reserve={['ソースを選ぶとオン設定を保存します（未保存）', '撮影するOBSソースを先に選択してください。', '選んだソースの画像を発言生成時に送ります。']}>{enableRequested ? 'ソースを選ぶとオン設定を保存します（未保存）'
      : !visual.source ? '撮影するOBSソースを先に選択してください。'
      : visual.enabled ? '選んだソースの画像を発言生成時に送ります。' : '映像の送信はオフです。'}</CompactFeedback>
    <p className="ai-help">発言生成時に、選んだソースの画像1枚を会話と一緒にGeminiへ送ります。画像内の文字や名前も含まれます。画像の利用量は会話本文の文字数上限とは別です。</p>
    <label>撮影するOBSソース<select ref={sourceSelect} value={selectedKey} aria-disabled={busy} onChange={event => {
      if (inFlight.current) return;
      const source = sources.find(s => `${s.collection}\n${s.uuid}` === event.target.value) ?? null;
      revision.current++; setCapture(null); setCaptureError(''); setEnableRequested(false);
      change({ ...settings, visual: { enabled: Boolean(source && (visual.enabled || enableRequested)), source } });
    }}><option value="">選択してください</option>
      {visual.source && !listed && <option value={selectedKey}>{visual.source.name}（保存済み・一覧を更新して確認）</option>}
      {sources.map(s => <option key={`${s.collection}\n${s.uuid}`} value={`${s.collection}\n${s.uuid}`}>{s.name}</option>)}
    </select></label>
    <div className="button-row ai-visual-actions"><button className="secondary" aria-disabled={busy} onClick={() => void run('sources')}>ソース一覧を更新</button>
      <button aria-disabled={busy} disabled={!visual.source || Boolean(saveError)} onClick={() => void run('capture')}>画像を取得して確認</button>
      <button className="secondary" onClick={() => { revision.current++; setCapture(null); setCaptureError(''); }}>画像をクリア</button></div>
    <p className="ai-help">撮影確認はローカル表示だけです。Geminiへの送信・コメント投稿は行いません。</p>
    <div className="ai-visual-status" role="status">{busy ? '処理中…' : error || (enableRequested ? 'オンの希望は未保存です。撮影するOBSソースを選ぶと、オン設定を一緒に保存します。'
      : !visual.source ? sources.length ? '撮影するOBSソースを選んでください。' : '映像ソースがありません。OBS接続を確認して一覧を再取得してください。'
      : capture?.reason || '上の操作から画像を取得できます。')}
      {capture?.image && <span> 撮影：{new Date(capture.image.capturedAt).toLocaleString()} · {capture.image.width}×{capture.image.height} · {Math.ceil(capture.image.bytes / 1024)} KB</span>}</div>
    <div className="ai-obs-recovery"><button className="secondary small" hidden={!navigation || busy || !error} onClick={e => navigation?.open('obsControl', e.currentTarget)}>OBS設定を開く</button></div>
    <div className="ai-visual-image">{capture?.image ? <img alt="撮影確認したOBSソース" src={`data:${capture.image.mimeType};base64,${capture.image.data}`} /> : <span>取得画像のプレビュー</span>}</div>
    <div className="ai-visual-status" aria-label="通常生成の画像状態">{status ? `通常生成：${status.reason}${status.image ? ` 撮影 ${new Date(status.image.capturedAt).toLocaleTimeString()}` : ''}` : '通常生成の画像状態はまだありません。'}</div>
    <details className="ai-details"><summary>撮影範囲・失敗時の動作</summary><p className="ai-help">配信側シーンで表示中のソースだけを撮影します。別ソースのキャラクターやコメントは合成しません。指定ソース自体に含まれる表示や、OBSで切り抜いた外側も撮影範囲に含まれます。</p><p className="ai-help">撮影に失敗した場合は画像なしで生成します。OBS接続・配信状態を確認できない場合は、通常の生成・投稿を休止します。</p></details>
    {debug && <AiVisualDebug settings={settings} view={view} mutate={call} onError={setDebugError} />}
  </section>;
}
