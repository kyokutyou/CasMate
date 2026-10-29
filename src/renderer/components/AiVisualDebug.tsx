import { useEffect, useRef, useState } from 'react';
import type { AiGenerationEvent } from '../../shared/ai-visual';
import type { AiVisualProps } from './AiVisualPanel';

/** Temporary UI: delete this component and its mounting point after verification. */
export function AiVisualDebug({ settings, view, mutate, onError }: Pick<AiVisualProps, 'settings' | 'view' | 'mutate' | 'onError'>) {
  const [event, setEvent] = useState<AiGenerationEvent | null>(null);
  const [persona, setPersona] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const running = useRef(false);
  const displayRevision = useRef(0);
  useEffect(() => { onError?.(error); }, [onError, error]);
  useEffect(() => {
    let closed = false;
    const refresh = async () => {
      const revision = displayRevision.current;
      try { const response = await mutate('/api/ai-listener/visual-debug/status', 'POST') as { event: AiGenerationEvent | null }; if (!closed && revision === displayRevision.current) setEvent(response.event); }
      catch { if (!closed) setError('デバッグ状態を取得できません。'); }
    };
    void refresh(); const timer = setInterval(() => void refresh(), 2000);
    const close = () => { void mutate('/api/ai-listener/visual-debug/close', 'POST').catch(() => undefined); };
    window.addEventListener('pagehide', close);
    return () => { closed = true; clearInterval(timer); window.removeEventListener('pagehide', close); close(); };
  }, [mutate]);
  const run = async () => {
    if (running.current) return; running.current = true;
    displayRevision.current++; setBusy(true); setError(''); setEvent(null);
    try { await mutate('/api/ai-listener/visual-debug/generate', 'POST', { personaId: persona }); }
    catch (e) { setError(e instanceof Error ? e.message : 'テスト生成に失敗しました。'); }
    finally { running.current = false; setBusy(false); }
  };
  return <section className="ai-visual-debug"><h3>画像送信のデバッグ（開発用）</h3>
    <p className="ai-help">テスト生成は会話・画像をGeminiへ送信します。コメント投稿や共有記憶への保存は行いません。AIを停止して実行してください。</p>
    <label>テストする人格<select value={persona} disabled={busy} onChange={e => setPersona(e.target.value)}><option value="">選択してください</option>{settings.personas.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <div className="button-row"><button aria-disabled={busy} disabled={view.requested || !view.hasKey || !settings.personas.some(p => p.id === persona)} onClick={() => void run()}>テスト生成</button>
      <button className="secondary" onClick={() => { displayRevision.current++; setEvent(null); setError(''); void mutate('/api/ai-listener/visual-debug/clear', 'POST').catch(() => setError('表示をクリアできません。')); }}>実行を取り消して表示を消去</button></div>
    <div className="ai-visual-status" role="status">{error || (event ? `${event.message} ${event.capture.image ? '画像あり' : '画像なし'} · 撮影 ${event.capture.durationMs}ms · API ${event.apiDurationMs}ms` : 'まだ送信していません。')}
      {event?.capture.image && <span> · {event.capture.image.width}×{event.capture.image.height} · {event.capture.image.bytes} bytes · {new Date(event.capture.image.capturedAt).toLocaleString()}</span>}</div>
    <div className="ai-visual-image">{event?.capture.image ? <img alt="実際のAPI送信用画像" src={`data:${event.capture.image.mimeType};base64,${event.capture.image.data}`} /> : <span>{event?.capture.reason || '実送信画像'}</span>}</div>
    <div className="ai-visual-result" aria-label="テスト生成の返答">{event?.text || 'テスト生成の返答がここに表示されます。'}</div>
  </section>;
}
