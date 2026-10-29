import { useState } from 'react';
import type { Target } from '../../shared/obs-style';
import { CompactFeedback } from './CompactFeedback';
import { openObsDesignBrowser } from '../obs-style-editor/open-editor';
export function ObsDesignButton({ target, onEdit }: { target: Target; onEdit?(): Promise<unknown> | void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const open = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try { if (onEdit) await onEdit(); else openObsDesignBrowser(target); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '編集画面を開けませんでした。'); }
    finally { setBusy(false); }
  };
  return <section className="overlay-setting-section"><button id={target === 'comments' ? 'comment-overlay-appearance' : 'speech-overlay-appearance'} type="button" className="secondary" aria-disabled={busy} onClick={() => { void open(); }}>デザインを編集</button>
    <CompactFeedback role="status" reserve={['別ウィンドウで文字や背景を調整します。', '編集ウィンドウを開けませんでした。ポップアップの許可を確認してください。']}>{error || '別ウィンドウで文字や背景を調整します。'}</CompactFeedback></section>;
}
