import { useContext, type ReactNode } from 'react';
import type { AppSnapshot } from '../../shared/types';
import { setupConfigured, type InitialSetupView } from '../../shared/initial-setup';
import { SetupPresentation } from '../management-navigation';
import { setupEffectExampleCount } from '../initial-setup-effects-example';
import { CharacterImage } from './CharacterImage';

export function InitialSetupCreativeReview({ view, snapshot, children, onOpenAssetError, blocked = false }: { blocked?: boolean; view: InitialSetupView; snapshot: AppSnapshot; children: ReactNode; onOpenAssetError?(): void }) {
  const { characterMouth, effectExample = '', effectRuleId } = useContext(SetupPresentation);
  const screen = view.position;
  const ai = snapshot.aiListener;
  const settings = snapshot.settings;
  const rule = settings.textEffects.rules.find(item => item.id === effectRuleId) ?? settings.textEffects.rules[0];
  const count = setupEffectExampleCount(effectExample, rule);
  const simple = settings.character.simple;
  const aiReady = setupConfigured('aiListener', snapshot) && ai?.status !== 'attention';
  const assetsReady = Boolean(simple.closedAsset && !snapshot.character.assetWarning);
  const reviewReady = !blocked && !view.warning && (screen === 'aiListener' ? aiReady : screen === 'textEffects' ? Boolean(rule) : assetsReady);
  const rows: [string, string, boolean][] = screen === 'aiListener' ? [
    ['利用準備', setupConfigured('aiListener', snapshot) ? '準備済み' : '準備中', aiReady],
    ['AIの実状態', ai ? { stopped: '停止中', running: '稼働中', waiting: '待機中', preparing: '準備中', paused: '休止中', attention: '要確認' }[ai.status] ?? ai.status : '未取得', ai?.status === 'running'],
    ['APIキー', ai?.hasKey ? '保存済み' : '未設定', Boolean(ai?.hasKey)],
    ['話し方（人格）', `${settings.aiListener.personas.length}件保存済み`, settings.aiListener.personas.length > 0],
  ] : screen === 'textEffects' ? [
    ['保存したルール', rule ? `${rule.trigger} → ${rule.displayText}` : '未設定', Boolean(rule)],
    ['説明用の反応数', `${count}個`, false],
    ['通常の動作設定', settings.textEffects.enabled ? 'ON' : 'OFF', settings.textEffects.enabled],
    ['OBSでの実表示', 'この後の手順で確認', false],
  ] : [
    ['口を閉じた画像', simple.closedAsset ? '登録済み' : '未設定', assetsReady],
    ['口を開けた画像', simple.openAsset ? '登録済み' : '任意・未設定', Boolean(simple.openAsset && !snapshot.character.assetWarning)],
    ['口パクの準備', simple.openAsset && simple.closedAsset ? '画像2枚を登録済み' : simple.closedAsset ? '口を開けた画像は未設定' : '口を閉じた画像を用意してください', Boolean(simple.openAsset && assetsReady)],
    ['OBSでの実表示', 'この後の手順で確認', false],
  ];
  return <aside className="initial-setup setup-review setup-creative-review" data-ready={reviewReady} aria-label="状態と動作の確認"><span className="setup-eyebrow">いまの準備状況</span>
    <h2>{screen === 'aiListener' ? '投稿を始める前の準備' : screen === 'textEffects' ? 'こんな演出ができます' : 'キャラクターの見え方'}</h2>
    {screen === 'aiListener' ? <div className="setup-creative-preview setup-ai-example"><small>説明用の発言例・生成結果ではありません</small><p><strong>{settings.aiListener.personas[0]?.name || 'AIリスナー'}</strong><br />今日の配信も楽しみ！</p></div>
      : screen === 'textEffects' ? <div className="setup-creative-preview setup-effects-example"><small>保存したルールによる説明用プレビュー</small><div aria-hidden="true" style={{ color: rule?.color }}>{Array.from({ length: Math.min(8, count) }, () => rule?.displayText).join(' ')}</div><p>コメント例：{effectExample || '（未入力）'}</p><small>最大8個まで描画。OFFのルールも条件の説明として表示します。</small></div>
      : <div className="setup-creative-preview setup-character-preview"><small>保存済み画像のプレビュー・OBSの実映像ではありません</small>{simple.closedAsset ? <CharacterImage mouthShape={characterMouth} settings={settings.character} motion={snapshot.character.motion} motionStartedAtMs={snapshot.character.motionStartedAtMs} alt="初回設定のキャラクター" onOpenAssetError={onOpenAssetError} /> : <p className="setup-character-empty"><span aria-hidden="true">＋</span>口を閉じた画像を選ぶと、ここに表示されます。</p>}</div>}
    <dl className="setup-device-states">{rows.map(([label, value, itemReady]) => <div key={label}><dt>{label}</dt><dd className="setup-status-value" data-ready={Boolean(itemReady)} tabIndex={0}>{value}</dd></div>)}</dl>
    <div className="setup-device-feedback" data-ready={reviewReady} role="status" tabIndex={0}>{screen === 'aiListener' ? <><strong>{ai?.message || '必要な設定を保存して、準備を確認しましょう。'}</strong><p>既に動作中の場合も現在の状態を表示します。コメント接続・配信者音声認識・OBS接続の準備を確認してください。</p></>
      : <><strong>{screen === 'textEffects' ? '説明用プレビューはOBSへ送信しません。' : snapshot.character.assetWarning || '保存済み画像をプレビューで確認してください。'}</strong><p>OBSへの追加と、実際の配信画面での確認は、この後の「OBS表示」で行います。</p></>}{children}</div>
  </aside>;
}
