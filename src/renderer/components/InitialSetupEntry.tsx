import type { AppSnapshot } from '../../shared/types';
import { useState } from 'react';
import { initialSetupSteps, setupConfigured, setupFeatures, setupProgressLabel, setupStepLabels, type InitialSetupAction, type InitialSetupView, type SetupFeature, type SetupStep } from '../../shared/initial-setup';
import './initial-setup-entry.css';

interface Props {
  view: InitialSetupView;
  snapshot: AppSnapshot;
  pending: boolean;
  perform(command: InitialSetupAction): Promise<boolean>;
  currentStatus(step: SetupStep): string;
}

const basic: SetupFeature[] = ['sources', 'commentSpeech', 'commentOverlay'];
const extra: SetupFeature[] = ['smartphone', 'speechRecognition', 'aiListener', 'textEffects', 'character'];
const nextActions: Record<SetupStep, string> = {
  sources: '接続先と、コメントを受け取れる状態を確かめます。',
  commentSpeech: 'VOICEVOXを起動し、試聴して声を確かめます。',
  obsControl: 'OBSの接続情報と接続状態を確かめます。',
  obsDisplay: 'OBS上で実際の表示・位置・大きさを確かめます。',
  smartphone: '接続する場所と、スマホで使う用途を確かめます。',
  speechRecognition: '入力を選び、自分の声で認識を試します。',
  aiListener: 'APIキー・人格・参加先の準備を確かめます。',
  textEffects: '反応する言葉と表示内容を確かめます。',
  character: '画像とプレビューの動きを確かめます。',
};

export function InitialSetupFlow({ position }: Pick<InitialSetupView, 'position'>) {
  return <nav className="setup-flow" aria-label="初回設定の流れ">{([
    ['welcome', 'ようこそ'], ['features', '機能を選ぶ'], ['settings', '設定・確認'], ['summary', '確認結果'],
  ] as const).map(([id, name], index) => <span key={id}>{index > 0 && <i aria-hidden="true">›</i>}<span aria-current={position === id ? 'step' : undefined}>{name}</span></span>)}</nav>;
}

export function InitialSetupEntry({ view, snapshot, pending, perform, currentStatus }: Props) {
  const steps = initialSetupSteps(view);
  const unavailable = pending || Boolean(view.warning);
  const record = (step: SetupStep) => view.confirmations[step] === view.fingerprints[step] ? 'confirmed'
    : view.deferred.includes(step) ? 'deferred' : setupConfigured(step, snapshot) ? 'configured' : 'needs';
  const priority = steps.find(step => record(step) === 'needs') ?? steps.find(step => record(step) === 'configured') ?? steps.find(step => record(step) === 'deferred');
  const [focusedPriority, setFocusedPriority] = useState<SetupStep | null>(null);
  const activePriority = focusedPriority && steps.includes(focusedPriority) ? focusedPriority : priority;
  const displayedPriority = activePriority ?? steps[0];
  const choice = (id: SetupFeature) => {
    const [, name, description] = setupFeatures.find(item => item[0] === id)!;
    return <label key={id} className="setup-feature" data-selected={view.selected.includes(id)}>
      <input id={`setup-feature-${id}`} type="checkbox" aria-disabled={unavailable} checked={view.selected.includes(id)} onChange={event => { if (!unavailable) void perform({ action: 'select', selected: event.target.checked ? [...view.selected, id] : view.selected.filter(item => item !== id), smartphoneUses: view.smartphoneUses }); }} />
      <span><strong>{name}</strong><small>{description}</small></span>
    </label>;
  };
  if (view.position === 'welcome') return <div className="setup-entry-split setup-welcome-split">
    <section className="setup-welcome-copy"><p className="setup-entry-lead">コメントを見る・声で聞く・配信画面に表示する。<br/>あなたの使い方に合わせて、準備しましょう。</p>
      <ol className="setup-journey">{[
        '使いたいものを選ぶ',
        '設定し、結果を確かめる',
        '残りはあとから続ける',
      ].map((title, index) => <li key={title}><span>{index + 1}</span><div><strong>{title}</strong></div></li>)}</ol>
      <p className="setup-entry-hint">機能を選ぶだけでは、接続や読み上げは始まりません。</p>
    </section>
    <aside className="setup-entry-surface setup-outcome"><span className="setup-eyebrow">たとえば、こんな使い方に</span><h2>コメントが、配信のそばに。</h2>
      <div className="setup-stream-scene"><span>配信画面のイメージ</span><div className="setup-scene-motif" aria-hidden="true">▧</div><div className="setup-comment-bubble"><strong>視聴者</strong> こんにちは！</div></div>
      <div className="setup-outcome-caption"><span aria-hidden="true">♫</span><p>届いたコメントを、選んだ声で読み上げ。<small>イメージです。実際のコメント・音声ではありません。</small></p></div>
    </aside>
  </div>;
  if (view.position === 'features') return <><p className="setup-entry-description">必要なものだけ選んでください。あとから追加・変更できます。</p>
    <div className="setup-entry-split setup-selection-split"><div>
      <fieldset className="setup-feature-rows"><legend>コメントの基本</legend>{basic.map(choice)}</fieldset>
      <fieldset className="setup-feature-rows setup-extra-features"><legend>必要に応じて追加</legend>{extra.map(choice)}</fieldset>
      {view.selected.includes('smartphone') && <fieldset className="setup-phone-uses" aria-disabled={unavailable}><legend>スマホでしたいこと</legend>{([['comments', 'コメントを見る'], ['speech', '読み上げを聞く'], ['video', 'カメラ・マイクを使う']] as const).map(([id, name]) => <label key={id}><input id={`setup-phone-use-${id}`} type="checkbox" aria-disabled={unavailable} checked={view.smartphoneUses.includes(id)} onChange={event => { if (!unavailable) void perform({ action: 'select', selected: view.selected, smartphoneUses: event.target.checked ? [...view.smartphoneUses, id] : view.smartphoneUses.filter(item => item !== id) }); }} />{name}</label>)}<small className="setup-entry-hint">{view.smartphoneUses.length ? '選んだ用途に必要な準備も案内します。' : '使いたい用途を1つ以上選んでください。'}</small></fieldset>}
    </div><aside className="setup-entry-surface setup-selection-plan" aria-label="今回の案内"><span className="setup-eyebrow">必要な準備を自動で追加します。</span><h2>今回の案内</h2>
      {steps.length ? <ol>{steps.map((step, index) => <li key={step}><span>{index + 1}</span><strong>{setupStepLabels[step]}</strong>{!view.selected.includes(step as SetupFeature) && <small>必要な準備</small>}</li>)}</ol> : <p className="setup-entry-muted">使いたい機能を選ぶと、必要な手順がここに並びます。</p>}
      <p className="setup-entry-hint">選択だけでは機能はONになりません。準備できない項目は、途中でも後回しにできます。</p>
    </aside></div></>;
  if (view.position !== 'summary') return null;
  if (!steps.length) return <section className="setup-entry-surface setup-empty-result"><span aria-hidden="true">☷</span><h2>今回は、機能を選んでいません</h2><p>必要になったら「設定 → アプリ設定」から<br/>はじめての設定を開けます。</p><button id="setup-reselect" className="secondary" aria-disabled={unavailable} onClick={() => { if (!unavailable) void perform({ action: 'move', position: 'features' }); }}>使いたい機能を選び直す</button></section>;
  const sourceNames = { youtube: 'YouTube', twitch: 'Twitch', shitaraba: '掲示板' };
  const sourceStates = { stopped: '停止中', connecting: '接続中', connected: '接続済み', waiting: '配信開始待ち', reconnecting: '再接続中', error: '要確認' };
  const current = (step: SetupStep) => step === 'sources' ? (Object.keys(sourceNames) as (keyof typeof sourceNames)[]).filter(id => snapshot.settings.sources[id].enabled || snapshot.sourceStatuses[id].state !== 'stopped').map(id => `${sourceNames[id]}：${sourceStates[snapshot.sourceStatuses[id].state]}`).join(' ／ ') || '停止中（接続サービス未選択）'
    : step === 'commentSpeech' ? `${currentStatus(step)} ／ 読み上げ：${snapshot.settings.commentSpeech.enabled ? 'オン' : 'オフ'}` : currentStatus(step);
  return <div className="setup-entry-split setup-results-split">
    <section className="setup-entry-surface setup-result-list" aria-label="選んだ機能の確認結果"><h2>選んだ機能の確認結果</h2>{steps.map(step => <article key={step} className="setup-result-row" data-record={record(step)}>
      <div><h3>{setupStepLabels[step]}</h3><span className="setup-record-badge" data-record={record(step)} data-reserve="✓ 前回の利用準備確認済み"><span>{record(step) === 'confirmed' ? '✓ ' : record(step) === 'needs' ? '! ' : ''}{setupProgressLabel(step, view, snapshot)}</span></span><p className="setup-result-description" data-reserve={nextActions[step]}><span>{record(step) === 'confirmed' ? 'ご自身で確認した記録があります。' : nextActions[step]}</span></p><small className="setup-result-current">現在の状態：{current(step)}</small></div>
      <button id={`setup-result-${step}`} className="secondary" aria-disabled={unavailable} onClick={() => { if (!unavailable) void perform({ action: 'move', position: step }); }}>{record(step) === 'confirmed' ? '設定を見る →' : '続きを設定する →'}</button>
    </article>)}{steps.includes('sources') && <details><summary>全サービスの現在状態</summary><ul>{(Object.keys(sourceNames) as (keyof typeof sourceNames)[]).map(id => <li key={id}>{sourceNames[id]}：{sourceStates[snapshot.sourceStatuses[id].state]}</li>)}</ul></details>}</section>
    <aside className="setup-entry-surface setup-next-panel" aria-label="このあとの操作"><span className="setup-eyebrow">このあと</span><h2 className="setup-next-heading" data-reserve="残った項目を進めますか？"><span>{priority ? '残った項目を進めますか？' : 'ホームで状態を確認'}</span></h2>
      <div className="setup-next-options">
        <div className="setup-next-pending" aria-hidden={!activePriority} inert={!activePriority} style={{ visibility: activePriority ? 'visible' : 'hidden' }}>
          <h3 data-reserve="配信者音声認識"><span>{setupStepLabels[displayedPriority]}</span></h3><p className="setup-next-action">{nextActions[displayedPriority]}</p>
          <button id="setup-priority" data-step={activePriority} className="setup-primary" aria-disabled={unavailable} onFocus={() => { if (activePriority) setFocusedPriority(activePriority); }} onBlur={() => setFocusedPriority(null)} onClick={() => { if (!unavailable && activePriority) void perform({ action: 'move', position: activePriority }); }}>この項目を確認する →</button><p className="setup-entry-hint">ここで終えて、あとから続けることもできます。</p>
        </div>
        <p className="setup-next-complete" aria-hidden={Boolean(activePriority)} style={{ visibility: activePriority ? 'hidden' : 'visible' }}>ホームへ戻り、接続や機能の状態を確認できます。</p>
      </div>
      <hr/><h3>続きの開き方</h3><p className="setup-resume-path">設定 <span>›</span> アプリ設定 <span>›</span><br/>はじめての設定</p>
      <p className="setup-entry-hint">「前回の動作確認済み」は、ご自身で確認した記録です。現在の接続やOBSの実表示とは別に確認できます。</p>
    </aside>
  </div>;
}
