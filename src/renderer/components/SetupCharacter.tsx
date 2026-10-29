import { useContext, useEffect, useRef, useState } from 'react';
import type { AppSnapshot, CharacterAssetSlot, SimpleCharacterMotionSettings } from '../../shared/types';
import { ManagementNavigation, SetupPresentation } from '../management-navigation';
import { AssetUploadControl } from '../pages/SimpleCharacterSettingsPage';
import { CompactFeedback } from './CompactFeedback';
import { SlimSwitch } from './SlimSwitch';

export function SetupCharacter({ snapshot, upload, onError, saveMotion, saveError }: {
  saveError?: string;
  snapshot: AppSnapshot; upload(slot: CharacterAssetSlot, file: File): Promise<unknown>; onError(message: string): void;
  saveMotion(value: SimpleCharacterMotionSettings): Promise<unknown>;
}) {
  const navigation = useContext(ManagementNavigation);
  const { confirmation, setCharacterMouth } = useContext(SetupPresentation);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [failure, setFailure] = useState<{ message: string; scope: CharacterAssetSlot | 'motion'; value: string | null } | null>(null);
  const [failedAssets, setFailedAssets] = useState<Partial<Record<CharacterAssetSlot, string>>>({});
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const active = navigation?.initialSetup && navigation.editor === 'character';
  const report = navigation?.reportError;
  const simple = snapshot.settings.character.simple;
  const operationValue = (scope: CharacterAssetSlot | 'motion') => scope === 'motion' ? JSON.stringify(simple.motion) : simple[scope === 'closed' ? 'closedAsset' : 'openAsset'];
  const failedValue = failure ? operationValue(failure.scope) : null;
  const error = failure && failure.value === failedValue ? failure.message : '';
  useEffect(() => { if (failure && failure.value !== failedValue) setFailure(null); }, [failure, failedValue]);
  const assetError = (['closed', 'open'] as const).some(slot => Boolean(simple[slot === 'closed' ? 'closedAsset' : 'openAsset']) && failedAssets[slot] === simple[slot === 'closed' ? 'closedAsset' : 'openAsset']) ? '画像を読み込めません。画像を選び直してください。' : '';
  useEffect(() => { report?.('character', saveError || error || assetError || (busy ? 'キャラクターの設定を保存しています。' : undefined)); }, [busy, error, assetError, report, saveError]);
  useEffect(() => {
    if (!active) { if (timer.current) clearInterval(timer.current); timer.current = null; setTesting(false); setCharacterMouth?.('closed'); }
    return () => { if (timer.current) clearInterval(timer.current); timer.current = null; setCharacterMouth?.('closed'); };
  }, [active, setCharacterMouth]);
  const run = async (scope: CharacterAssetSlot | 'motion', action: () => Promise<unknown>) => {
    if (inFlight.current) return;
    const value = operationValue(scope);
    inFlight.current = true; setBusy(true); setFailure(current => current?.scope === scope ? null : current);
    try { await action(); } catch (failure) { const message = failure instanceof Error ? failure.message : 'キャラクターの設定を保存できませんでした。'; setFailure({ message, scope, value }); onError(message); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const summary = (slot: CharacterAssetSlot) => <AssetSummary asset={simple[slot === 'closed' ? 'closedAsset' : 'openAsset']} onReadState={(asset, failed) => setFailedAssets(current => ({ ...current, [slot]: failed ? asset : undefined }))} />;
  const asset = (slot: CharacterAssetSlot) => <div className="setup-asset-picker"><button type="button" className="setup-primary" aria-disabled={busy || slot === 'open' && !simple.closedAsset} onClick={event => { if (!busy && (slot === 'closed' || simple.closedAsset)) event.currentTarget.parentElement?.querySelector('input')?.click(); }}>{slot === 'closed' ? '口を閉じた画像（PNG）を選ぶ' : '口を開けた画像（PNG）を選ぶ'}</button><AssetUploadControl slot={slot} label={slot === 'closed' ? '口を閉じた画像（PNG）' : '口を開けた画像（PNG）'} disabled={busy || slot === 'open' && !simple.closedAsset}
    onSelect={event => { const file = event.target.files?.[0]; if (file) void run(slot, () => upload(slot, file)); event.target.value = ''; }} onDropFile={file => void run(slot, () => upload(slot, file))} /></div>;
  return active ? <div className="setup-character setup-creative-panel">
    <section className="setup-step-card"><h2><span className="setup-number">1</span>口を閉じた画像を用意する</h2><p>まずは普段の姿になる、口を閉じたPNG画像を1枚用意します。</p>{asset('closed')}{summary('closed')}
      <p className="setup-inline-note">静止PNG・20 MiB以下・縦横それぞれ8192 px以下。</p>
      <CompactFeedback className="setup-creative-status" role="status" tabIndex={0} reserve={['画像を登録しています。', '画像を登録できませんでした。元の画像は保持しています。']}>{saveError || error || assetError || (busy ? 'キャラクターの設定を保存しています…' : snapshot.character.assetWarning || 'サイズが違う画像や読み込めない画像は登録せず、元の画像を保持します。')}</CompactFeedback>
    </section>
    <section className="setup-step-card"><h2><span className="setup-number">2</span>口を開けた画像を追加する</h2><span className="setup-optional">任意・後から追加できます</span><p>口パクさせたい場合は、口を閉じた画像と同じ大きさの口を開けたPNG画像を追加します。</p>{asset('open')}{summary('open')}<p className="muted">{simple.closedAsset ? '' : '先に口を閉じた画像を登録してください。'}位置やキャンバスの大きさをそろえると、口パク時のずれを防げます。</p></section>
    <section className="setup-step-card"><h2><span className="setup-number">3</span>見た目・口パクを試す</h2><p>口パクは、PCでのコメント読み上げに合わせて動きます。</p><p className="setup-inline-note">自分のマイク・配信者音声認識・スマホの音声・VOICEVOXの試聴では口パクしません。</p>
      <button className="setup-primary" aria-disabled={busy || testing || Boolean(assetError) || !simple.closedAsset || !simple.openAsset} aria-busy={testing} onClick={() => {
        if (busy || timer.current || assetError || !simple.closedAsset || !simple.openAsset) return;
        let count = 0; setTesting(true); setCharacterMouth?.('open');
        timer.current = setInterval(() => { count++; setCharacterMouth?.(count % 2 ? 'closed' : 'open'); if (count >= 10) { clearInterval(timer.current!); timer.current = null; setTesting(false); setCharacterMouth?.('closed'); } }, 200);
      }}><span>{testing ? '口パク確認中…' : '口パクを試す（このプレビューのみ・2秒）'}</span></button><small>画像2枚が必要です。この確認ではOBSや独立ウィンドウのキャラクターは動きません。</small>
      <SlimSwitch keepFocus label="控えめな動きを使う" checked={simple.motion.enabled} disabled={busy} onChange={enabled => void run('motion', () => saveMotion({ ...simple.motion, enabled }))} /><small>動きの設定は保存され、OBSや独立ウィンドウにも反映されます。細かい調整は詳細設定から行えます。</small>
    </section>
    <section className="setup-step-card"><h2><span className="setup-number">4</span>準備を確認する</h2><p>保存済み画像とプレビューの見え方を確認してください。</p>{confirmation}<p className="setup-inline-note">OBSへの追加と実際の配信画面での確認は、この後の「OBS表示」で行います。</p></section>
  </div> : null;
}

function AssetSummary({ asset, onReadState }: { asset: string | null; onReadState(asset: string, failed: boolean): void }) {
  const [size, setSize] = useState<{ asset: string; width?: number; height?: number; failed?: boolean }>();
  return <div className="setup-asset-summary"><span>{asset ? `登録済みPNG：${asset.split('/').at(-1)}` : '画像は未登録です。'}</span><span>{asset && size?.asset === asset ? size.failed ? '画像を読み込めません。画像を選び直してください。' : `${size.width} × ${size.height} px` : asset ? '画像の大きさを読み込み中' : '画像を選ぶか、ここへドロップできます。'}</span>{asset && <img hidden src={asset} alt="" onError={() => { setSize({ asset, failed: true }); onReadState(asset, true); }} onLoad={event => { setSize({ asset, width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }); onReadState(asset, false); }} />}</div>;
}
