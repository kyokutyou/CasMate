import { TestActionButton } from './TestActionButton';
import { useLayoutEffect, useRef, useState } from 'react';
import type { AiSettings } from '../../shared/ai-listener';

export function AiReplyTest({ settings, blocked, mutate, onError, onSuccess }: {
  settings: AiSettings; blocked: boolean; mutate(path: string, method?: string, body?: unknown): Promise<unknown>;
  onError(message: string): void; onSuccess?(message: string): void;
}) {
  const [persona, setPersona] = useState('');
  const [text, setText] = useState('こんにちは。今日の配信について一言お願いします。');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ key: string; text: string } | null>(null);
  const working = useRef(false);
  const key = JSON.stringify([settings, persona, text, blocked]);
  const latest = useRef({});
  useLayoutEffect(() => { latest.current = {}; return () => { latest.current = {}; }; }, [key]);
  const invalid = !text.trim() || text.length > 2000 || !settings.personas.some(item => item.id === persona);
  const run = async () => {
    if (working.current || blocked || invalid) return;
    working.current = true; setPending(true); setError(''); setResult(null); onError('');
    const attempt = latest.current;
    try {
      const response = await mutate('/api/ai-listener/test-reply', 'POST', { personaId: persona, text }) as { reply?: string };
      if (latest.current !== attempt) return;
      if (typeof response?.reply !== 'string') throw new Error('返答を取得できませんでした。');
      setResult({ key, text: response.reply }); onSuccess?.('テストの返答を確認できます。');
    } catch (reason) {
      if (latest.current !== attempt) return;
      const message = reason instanceof Error ? reason.message : '返答を確認できませんでした。'; setError(message); onError(message);
    } finally { working.current = false; setPending(false); }
  };
  return <details className="ai-reply-test" aria-label="人格の返答テスト"><summary>人格の返答テスト</summary><div className="ai-reply-test-fields">
    <p className="ai-help">保存した人格とテスト用コメントをGeminiへ送ります。実コメント・共有記憶・画像は送らず、投稿・読み上げ・記憶への保存もしません。AIを停止して実行してください。</p>
    <label>テストする人格<select value={persona} disabled={pending} onChange={event => setPersona(event.target.value)}><option value="">選択してください</option>{settings.personas.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label>テスト用コメント<textarea rows={3} maxLength={2000} value={text} disabled={pending} onChange={event => setText(event.target.value)}/></label>
    <TestActionButton aria-disabled={pending || blocked || invalid} aria-busy={pending} onClick={() => void run()}>{pending ? '生成中…' : '返答をテスト'}</TestActionButton>
    <div className="ai-reply-test-status" role="status" tabIndex={0}>{error || (pending ? '返答を生成しています。' : blocked ? 'AIを停止し、設定の保存とAPIキーの登録を完了してください。' : invalid ? '人格を選び、テスト用コメントを入力してください。' : '返答はこの画面内だけで確認できます。')}</div>
    <div className="ai-reply-test-result" aria-label="投稿しないテストの返答" tabIndex={0}>{result?.key === key ? result.text : 'ここに返答を表示します。'}</div>
  </div></details>;
}
