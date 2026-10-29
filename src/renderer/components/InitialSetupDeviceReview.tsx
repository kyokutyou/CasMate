import { smartphoneDeviceDataReceiving } from '../../shared/smartphone';
import type { ReactNode } from 'react';
import { useContext } from 'react';
import type { AppSnapshot } from '../../shared/types';
import type { InitialSetupView } from '../../shared/initial-setup';
import { RecognitionResult } from './SpeechRecognitionPanel';
import { runtimeLabels, modelLabels } from './speech-recognition-labels';
import { SetupPresentation } from '../management-navigation';
import { smartphoneReceiverState } from './smartphone-status';

export function InitialSetupDeviceReview({ view, snapshot, children, blocked = false }: { blocked?: boolean; view: InitialSetupView; snapshot: AppSnapshot; children: ReactNode }) {
  const phone = view.position === 'smartphone';
  const video = view.smartphoneUses.includes('video');
  const { smartphoneNetwork, smartphoneCommentsReady, smartphoneSpeechReady, smartphoneSpeechEnabled } = useContext(SetupPresentation);
  const device = snapshot.smartphone;
  const network = smartphoneNetwork ?? device?.settings.activeNetwork ?? 'lan';
  const active = device?.settings.activeNetwork ?? null;
  const selected = active === network;
  const ready = selected && device?.networks[network]?.registrationReady;
  const profiles = device?.devices.flatMap(d => d.profiles[network]?.registered ? [d.profiles[network]!] : []) ?? [];
  const states = device?.devices.map(d => smartphoneReceiverState(d, network, active)) ?? [];
  const issue = states.find(state => state.includes('旧受信') || state === '要確認' || state.startsWith('受信エラー'));
  const receiving = selected && device?.available && device.devices.some(item => smartphoneDeviceDataReceiving(item, network, active));
  const reported = selected && profiles.some(p => p.report && !p.stale);
  const networkNames = { lan: '家庭内LAN', tailscale: 'Tailscale', direct: '直接接続' };
  const recognition = snapshot.speechRecognition;
  const settings = snapshot.settings.speechRecognition;
  const input = settings.inputSource === 'smartphone'
    ? recognition.inputs?.find(i => i.smartphoneDeviceId === settings.smartphoneDeviceId)?.name ?? '選択済みスマホ（未検出）'
    : settings.microphoneId ? recognition.microphones.find(m => m.id === settings.microphoneId)?.name ?? '選択済みマイク（未検出）' : 'Windowsの既定';
  const latest = recognition.previewActive ? recognition.previewHistory.at(-1) : undefined;
  const modelReady = recognition.modelStatus === 'ready';
  const inputReady = settings.inputSource === 'smartphone'
    ? Boolean(recognition.inputs?.some(item => item.smartphoneDeviceId === settings.smartphoneDeviceId && item.available))
    : recognition.microphones.some(item => settings.microphoneId ? item.id === settings.microphoneId : item.isDefault);
  const recognitionReady = modelReady && inputReady && !recognition.warning && !['unavailable', 'preparing', 'waitingForInput'].includes(recognition.status);
  const phoneReady = Boolean(device?.available && !device.warning && ready && profiles.length && !issue && view.smartphoneUses.length &&
    (!video || receiving) && (!view.smartphoneUses.some(use => use === 'comments' || use === 'speech') || smartphoneCommentsReady) &&
    (!view.smartphoneUses.includes('speech') || smartphoneSpeechReady && smartphoneSpeechEnabled && snapshot.mobileSpeech.audioAvailable && !snapshot.commentSpeech.warning && !snapshot.mobileSpeech.warning));
  const reviewReady = !blocked && !view.warning && (phone ? phoneReady : recognitionReady);
  const confirmed = view.confirmations[view.position as 'smartphone' | 'speechRecognition'] === view.fingerprints[view.position as 'smartphone' | 'speechRecognition'];
  const rows: [string, string, boolean][] = phone ? [
    ['PCの接続準備', !device?.available ? '利用不可' : !selected ? 'この接続方法はOFF' : ready ? '準備済み' : '準備中・要確認', Boolean(device?.available && !device.warning && ready)],
    ['スマホの登録', `${profiles.length}台登録済み`, profiles.length > 0],
    ['現在の接続', !device?.available ? '利用不可' : issue || (!selected ? '接続OFF' : receiving ? 'データ受信中' : reported ? 'スマホから報告あり' : 'スマホ側で確認'), Boolean(receiving && !issue)],
    [video ? '受信の確認' : '用途の本人確認', confirmed ? '確認済み' : '未確認', false],
  ] : [
    ['モデル', modelLabels[recognition.modelStatus], modelReady], ['適用済み入力', input, inputReady && recognitionReady], ['配信に使う', settings.enabled ? 'ON' : 'OFF', settings.enabled],
    ['文字の本人確認', confirmed ? '確認済み' : '未確認', false],
  ];
  return <aside className="initial-setup setup-review setup-device-review" data-ready={reviewReady} aria-label="状態と動作の確認">
    <span className="setup-eyebrow">{phone ? 'スマホとのつながり' : '認識の確認'}</span>
    <h2>{phone ? '登録と接続を確認' : '話した言葉を、文字に'}</h2>
    {phone && <p className="setup-phone-route">確認中：{networkNames[network]}<br />PCでON：{active ? networkNames[active] : '接続OFF'}</p>}
    {phone ? <div className="setup-phone-picture"><div aria-hidden="true">▣<small>このPC</small></div><span>{receiving ? 'データを受信中' : video ? 'PCの受信状態を確認' : '接続はスマホで確認'}</span><div aria-hidden="true">▯<small>Android</small></div></div>
      : <div className="setup-recognition-result" role="region" aria-label="最新の認識結果" aria-live="polite" tabIndex={0}>
        <small>{latest ? latest.sessionId === recognition.sessionId ? '前回の認識結果' : '前の入力・セッションの認識結果' : '認識結果'}</small>
        {latest ? <RecognitionResult result={latest} /> : <p>プレビューを開始して話すと、ここに言葉が表示されます。</p>}
      </div>}
    <dl className="setup-device-states">{rows.map(([label, value, itemReady]) => <div key={label}><dt>{label}</dt><dd className="setup-status-value" data-ready={Boolean(itemReady)}>{value}</dd></div>)}</dl>
    <div className="setup-device-feedback" data-ready={reviewReady} role="status" tabIndex={0}>{phone ? <>
      <strong>{device?.warning || (!ready ? 'まずPCの接続を準備しましょう。' : !profiles.length ? '次はAndroidでQRを読み取ります。' : video ? '映像・マイクのデータ受信を確認しましょう。' : '選んだ用途をスマホで確認しましょう。')}</strong>
      <p>{video ? 'このPCの端末欄が「受信中」で、受信データが届いていることを確かめてください。登録済み・スマホの送信中表示だけでは完了にできません。' : '登録済み・PCの準備済みは、スマホで表示・再生できたこととは別です。コメントだけの端末の接続有無は、スマホ側で確認します。'}</p>
    </> : <><strong>認識：{runtimeLabels[recognition.status]} ／ プレビュー：{recognition.previewActive ? '実行中' : '停止中'}</strong>
      <p>{recognition.warning || (recognition.status === 'waitingForInput' ? '選んだAndroidで映像・マイクの送信を開始してください。' : recognition.status === 'unavailable' ? 'マイクの接続・Windowsのマイク許可とモデルを確認し、入力の適用・再試行をしてください。' : '「配信に使う」がOFFでもプレビューできます。話し終えてから、文字を確かめてください。')}</p></>}{children}</div>
  </aside>;
}
