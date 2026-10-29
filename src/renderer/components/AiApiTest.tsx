import { CompactFeedback } from './CompactFeedback';
import { useEffect, useRef, useState } from 'react';

export function AiApiTest({ model, revision, hasKey, unsavedKey, requested, busy, saveError, mutate, onBusy, onError, onSuccess }: {
  model: string; revision: number; hasKey: boolean; unsavedKey: boolean; requested: boolean; busy: boolean; saveError?: string;
  mutate(path: string, method?: string, body?: unknown): Promise<unknown>;
  onBusy(value: boolean): void; onError(message: string): void; onSuccess?(message: string): void;
}) {
  const [result, setResult] = useState<{ model: string; message: string; failed: boolean } | null>(null);
  const [working, setWorking] = useState(false);
  const pending = useRef(false);
  const latest = useRef({ model, revision });
  useEffect(() => { latest.current = { model, revision }; setResult(null); }, [model, revision]);
  const disabled = busy || working || requested || !hasKey || unsavedKey || Boolean(saveError);
  const test = async () => {
    if (disabled || pending.current) return;
    pending.current = true; setWorking(true); onBusy(true); setResult(null); onError('');
    const submitted = { model, revision };
    try {
      const response = await mutate('/api/ai-listener/test-api', 'POST', {}) as { model?: string; message?: string } | undefined;
      if (submitted.model !== latest.current.model || submitted.revision !== latest.current.revision) return;
      if (response?.model !== submitted.model) throw new Error('確認するモデルが変わりました。設定を確認して再度テストしてください。');
      const message = `Gemini APIの文章応答を確認しました。モデル：${response.model}`;
      setResult({ model, message, failed: false }); onSuccess?.('Gemini APIのテストに成功しました。');
    } catch (error) {
      if (submitted.model !== latest.current.model || submitted.revision !== latest.current.revision) return;
      const message = error instanceof Error ? error.message : 'Gemini APIの応答を確認できませんでした。';
      setResult({ model, message, failed: true }); onError(message);
    } finally { pending.current = false; setWorking(false); onBusy(false); }
  };
  const current = result?.model === model && !unsavedKey ? result : null;
  const message = working ? 'Gemini APIをテストしています…'
    : current?.message ?? (!hasKey || unsavedKey ? 'APIキーを保存してからテストしてください。'
      : requested ? 'AIリスナーを停止してからテストしてください。' : 'APIテストはまだ行っていません。');
  return <div className="ai-api-test">
    <p className="ai-help">保存済みのAPIキーとモデルで短い生成を試します。会話・映像・人格は送信せず、投稿は行いません。</p>
    <div className="button-row"><button type="button" className="secondary ai-api-test-button" aria-disabled={disabled} aria-busy={working} onClick={() => void test()}><span>{working ? 'テスト中…' : 'Gemini接続をテスト'}</span></button></div>
    <CompactFeedback className="ai-api-test-status" role="status" aria-label="Gemini APIテストの結果" data-error={Boolean(current?.failed)} reserve={['APIキーを保存してからテストしてください。', 'AIリスナーを停止してからテストしてください。', 'Gemini APIの応答を確認できませんでした。']}>{message}</CompactFeedback>
  </div>;
}
