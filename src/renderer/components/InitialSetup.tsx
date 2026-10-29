import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AppSnapshot, VoicevoxSpeaker } from '../../shared/types';
import { initialSetupSteps, setupProgressLabel, setupConfigured, setupStepLabels, type InitialSetupCommand, type InitialSetupAction, type InitialSetupView, type SetupStep, type SetupPosition } from '../../shared/initial-setup';
import { SetupPresentation, isSetupWorkspace, setupEditor, type ManagementEditor } from '../management-navigation';
import type { ObsSourceRegistrationEntry } from './ObsSourceRegistrationDialog';
import { obsOverlayDefinitions } from '../../shared/obs-source-registration';
import { InitialSetupEntry, InitialSetupFlow } from './InitialSetupEntry';
import './initial-setup.css';
import './initial-setup-workspace.css';
import './initial-setup-creative.css';
import { InitialSetupCreativeReview } from './InitialSetupCreativeReview';
import { InitialSetupDeviceReview } from './InitialSetupDeviceReview';
import { CompactFeedback } from './CompactFeedback';
import { ObsConnectionGuide } from './ObsConnectionGuide';


export interface InitialSetupProps {
  speechVoices?: VoicevoxSpeaker[];
  view: InitialSetupView;
  snapshot: AppSnapshot;
  pending: boolean;
  settingsPending(position: SetupPosition): boolean;
  command(command: InitialSetupCommand): Promise<unknown>;
  onObsSource(request: ObsSourceRegistrationEntry): void;
  onCharacterAssetError?(): void;
}
type Props = InitialSetupProps & {
  perform(command: InitialSetupAction): Promise<boolean>;
  leave(interrupted?: boolean): void;
  open(editor: ManagementEditor, entry: HTMLElement, target?: string): void;
  blocked: boolean;
};
interface Disclosures {
  open: Record<string, boolean>;
  change(id: string, expanded: boolean): void;
}
export function InitialSetupHeader({ view, snapshot, pending, blocked, perform, open, leave, disclosures }: Props & { disclosures: Disclosures }) {
  const opened = useRef(false);
  useEffect(() => {
    if ((view.autoShow || !view.started) && !opened.current) { opened.current = true; void perform({ action: 'open' }); }
  }, [view.autoShow, view.started, perform]);
  const steps = initialSetupSteps(view);
  const step = steps.includes(view.position as SetupStep) ? view.position as SetupStep : null;
  const titles: Partial<Record<SetupStep, string>> = { aiListener: 'AIリスナーを準備しましょう', textEffects: '文字演出を準備しましょう', character: 'キャラクターを準備しましょう', smartphone: 'スマホをつないで使う', speechRecognition: '自分の声を文字にする', sources: 'コメントを受け取る', commentSpeech: '好きな声で読み上げる', obsControl: 'このPCのOBSに接続する', obsDisplay: view.selected.includes('commentOverlay') ? '配信画面にコメントを表示する' : '配信画面に表示する' };
  const title = view.position === 'welcome' ? 'ようこそ、きゃすメイトへ' : view.position === 'features' ? '使いたい機能を選びましょう' : view.position === 'summary' ? 'ここまでの設定を確認しましょう' : titles[step!] ?? setupStepLabels[step!];
  const groupedObs = steps.indexOf('obsDisplay') === steps.indexOf('obsControl') + 1 && steps.includes('obsControl');
  const navigationSteps = steps.filter(item => !(groupedObs && item === 'obsDisplay'));
  return <div className="initial-setup" data-setup-position={view.position}>
    <div className="setup-title-row"><div><span className="setup-eyebrow">はじめての設定</span><h1 id="setup-heading" tabIndex={-1}>{title}</h1></div>
      {view.position !== 'summary' && <button id="setup-interrupt" type="button" className="secondary" aria-label="中断してホームへ" disabled={pending} title="続きは「設定 → アプリ設定」から再開できます。" onClick={() => leave(true)}>{step && !isSetupWorkspace(step) ? '中断してホームへ' : '中断する'}</button>}</div>
    {step ? <nav className="setup-topic-nav" aria-label="設定する機能">{navigationSteps.map((item, index) => <button key={item} id={`setup-topic-${item}`} type="button" aria-disabled={pending || blocked} aria-current={step === item || groupedObs && step === 'obsDisplay' && item === 'obsControl' ? 'step' : undefined} onClick={() => { if (!pending && !blocked) void perform({ action: 'move', position: item }); }}><span>{index + 1}</span>{item === 'sources' ? 'コメント接続' : item === 'commentSpeech' ? '読み上げ' : groupedObs && item === 'obsControl' ? 'OBS表示' : setupStepLabels[item]}</button>)}</nav> : <InitialSetupFlow position={view.position} />}
    <InitialSetupEntry key={view.position} view={view} snapshot={snapshot} pending={pending} perform={perform} currentStatus={id => runtimeText(id, snapshot)} />
    {step && !isSetupWorkspace(step) && <><div className="setup-guide"><SetupGuide step={step} view={view} disclosures={disclosures} />
      <p className="setup-current-status" role="status">現在：{runtimeText(step, snapshot)}<br />記録：{setupProgressLabel(step, view, snapshot)}</p></div>
      {step === 'speechRecognition' && <button className="secondary" id="setup-smartphone-input" aria-disabled={pending} onClick={event => { if (!pending) open('smartphone', event.currentTarget); }}>スマホを入力に使う場合：先に登録する</button>}
      <div className="setup-detail-link"><button type="button" id="setup-detail" className="feature-link" aria-disabled={pending} onClick={event => { if (!pending) open(setupEditor(view.position, view.selected)!, event.currentTarget); }}>詳細設定を開く ›</button></div>
    </>}
    {step && isSetupWorkspace(step) && <p className="setup-purpose">{{ aiListener: 'AIがコメント欄に参加するための準備をします。ここでは投稿を開始しません。', textEffects: 'コメントの言葉に合わせて、草や拍手を画面に降らせます。まずは1つ、ルールを作りましょう。', character: '画像1枚で配信にキャラクターを表示できます。口パクを使う場合は、もう1枚追加します。', smartphone: 'AndroidとPCをつなぎ、映像・マイクのPC受信やスマホで使う機能を確認します。', speechRecognition: 'モデルとマイクを準備して、話した言葉が文字になるか試します。', sources: '使うサービスに接続して、コメントをひとつの画面に集めます。', commentSpeech: 'VOICEVOXを準備して、テスト音声を聞いてみましょう。', obsControl: 'OBSを起動して、このPCから接続できるようにします。', obsDisplay: '使う表示をOBSへ追加し、実際の見え方を確かめます。' }[step as 'aiListener' | 'textEffects' | 'character' | 'sources' | 'commentSpeech' | 'smartphone' | 'speechRecognition' | 'obsControl' | 'obsDisplay']}</p>}
    {!isSetupWorkspace(view.position) && <SetupRecordWarning view={view} pending={pending} perform={perform} />}
  </div>;
}

export function InitialSetupFooter({ view, pending, blocked, perform, leave, snapshot }: Props) {
  const steps = initialSetupSteps(view);
  const positions: SetupPosition[] = ['welcome', 'features', ...steps, 'summary'];
  const index = positions.indexOf(view.position);
  const step = steps.includes(view.position as SetupStep) ? view.position as SetupStep : null;
  const advance = async () => { await perform({ action: 'move', position: positions[index + 1] ?? 'summary' }); };
  const nextUnavailable = pending || Boolean(view.warning) || blocked && Boolean(step) || (view.position === 'features' && view.selected.includes('smartphone') || view.position === 'smartphone') && !view.smartphoneUses.length;
  const confirmationUnavailable = !step || pending || blocked || Boolean(view.warning) || !setupConfigured(step, snapshot, view.smartphoneUses);
  const skipRequested = useRef(false);
  useEffect(() => {
    if (!skipRequested.current || pending) return;
    skipRequested.current = false;
    if (view.position === 'features' && !view.selected.length && !view.warning) void perform({ action: 'move', position: 'summary' });
  }, [pending, view.position, view.selected, view.warning, perform]);
  const entry = ['welcome', 'features', 'summary'].includes(view.position);
  const remaining = steps.filter(id => view.confirmations[id] !== view.fingerprints[id]).length;
  return <div className="initial-setup setup-footer">
    <p className="setup-save-help" role="status">{entry ? <strong className="setup-footer-lead">{view.position === 'welcome' ? '必要な機能だけ、あなたのペースで' : view.position === 'features' ? `${view.selected.length}機能を選択中` : remaining ? '残った項目は、あとから続けられます' : steps.length ? '選んだ項目に確認の記録があります' : '必要になったら、いつでも設定できます'}</strong> : isSetupWorkspace(view.position) && <strong className="setup-footer-lead">準備できない項目は、後で設定できます</strong>}<span>{pending ? '進み具合を保存しています…' : blocked ? '未保存・未適用の入力またはエラーがあります。設定を反映するか「後で設定する」を選んでください。' : step && !isSetupWorkspace(step) ? '音・表示・選んだ用途を実際に確認できたら、確認済みとして記録できます。' : view.position === 'summary' ? '終了しても、接続・読み上げ・配信は開始しません。' : entry ? view.position === 'features' && view.selected.includes('smartphone') && !view.smartphoneUses.length ? 'スマホでしたいことを1つ以上選んでください。' : '選択だけでは機能はONになりません。' : '進み具合はこのPCに保存します。'}</span></p>
    {step && !isSetupWorkspace(step) && <button id={`setup-confirm-${step}`} className="secondary setup-confirm" aria-disabled={confirmationUnavailable} onClick={() => { if (!confirmationUnavailable) void perform({ action: 'confirm', step, fingerprint: view.fingerprints[step] }); }}>{step === 'aiListener' ? 'AIの利用準備を確認できた' : 'この設定で動作を確認できた'}</button>}
    <div className="setup-footer-actions"><button id="setup-back" className="secondary" disabled={index <= 0} aria-disabled={pending || index <= 0} onClick={() => { if (!pending && index > 0) void perform({ action: 'move', position: view.position === 'summary' ? 'features' : positions[index - 1] }); }}>戻る</button>
      {view.position === 'features' && <button id="setup-skip-selection" className="secondary" aria-disabled={pending || Boolean(view.warning)} onClick={async () => {
        if (pending || view.warning) return;
        if (!view.selected.length) { void perform({ action: 'move', position: 'summary' }); return; }
        skipRequested.current = true;
        if (!await perform({ action: 'select', selected: [], smartphoneUses: view.smartphoneUses })) skipRequested.current = false;
      }}>今回は選ばない</button>}
      {step && <button id={`setup-defer-${step}`} className="secondary" aria-disabled={pending || Boolean(view.warning)} onClick={() => { if (!pending && !view.warning) void perform({ action: 'defer', step }); }}>後で設定する</button>}
      {view.position === 'summary' ? <button id="setup-finish" aria-disabled={pending || blocked || Boolean(view.warning)} onClick={async () => { if (!pending && !blocked && !view.warning && await perform({ action: 'finish' })) leave(); }}>設定を終えてホームへ</button>
        : <button id="setup-next" aria-disabled={nextUnavailable} onClick={() => { if (!nextUnavailable) void advance(); }}>{view.position === 'welcome' ? '使いたい機能を選ぶ →' : step ? positions[index + 1] === 'summary' ? '確認結果を見る →' : `次は${positions[index + 1] === 'commentSpeech' ? '読み上げ' : positions[index + 1] === 'obsControl' ? 'OBSの接続' : positions[index + 1] === 'obsDisplay' ? 'OBSの表示確認' : setupStepLabels[positions[index + 1] as SetupStep]} →` : view.selected.length ? '選んだ機能の設定へ →' : '確認結果へ →'}</button>}
    </div>
  </div>;
}

function SetupRecordWarning({ view, pending, perform }: Pick<Props, 'view' | 'pending' | 'perform'>) {
  const status = useRef<HTMLDivElement>(null);
  const focusedReload = useRef(false);
  useLayoutEffect(() => {
    if (!view.warning && focusedReload.current) {
      if (document.activeElement === document.body) status.current?.focus({ preventScroll: true });
      focusedReload.current = false;
    }
  }, [view.warning]);
  return <div className="setup-record-area"><div ref={status} className="setup-record-warning" role="status" tabIndex={-1} aria-label="進行記録の状態">{view.warning || '\u00a0'}</div>
    {view.warning && <button id="setup-reload" className="secondary" aria-disabled={pending} onFocus={() => { focusedReload.current = true; }} onBlur={event => { if (event.relatedTarget) focusedReload.current = false; }} onClick={() => { if (!pending) void perform({ action: 'reload' }); }}>進行記録を再読込</button>}</div>;
}

export function InitialSetupObsConnectionStatus({ view, snapshot, pending, perform, needsSettings = false }: Props & { needsSettings?: boolean }) {
  const [focused, setFocused] = useState(false);
  const connected = snapshot.obsControl?.connection === 'connected';
  const unavailable = pending || Boolean(view.warning);
  const showReturn = !connected || needsSettings || focused;
  return <section className="initial-setup setup-step-card setup-obs-connection-state" aria-label="OBSの接続状態">
    <h2><span className="setup-number">1</span>OBSの接続状態</h2>
    <CompactFeedback role="status" reserve={['現在：OBS連携OFF', '現在：OBS接続中', '現在：OBS接続済み', '現在：OBS接続不可', '現在：OBSを利用できません']}>
      現在：{runtimeText('obsControl', snapshot)}
    </CompactFeedback>
    <div style={{ visibility: showReturn ? 'visible' : 'hidden' }} aria-hidden={!showReturn}>
      <p>接続設定を確認してから、表示の追加・テストを続けてください。</p>
      <button type="button" id="setup-obs-connection-back" className="secondary" aria-disabled={unavailable} disabled={!showReturn} tabIndex={showReturn ? 0 : -1}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        onClick={() => { if (!unavailable) void perform({ action: 'move', position: 'obsControl' }); }}>OBSの接続設定に戻る</button>
    </div>
  </section>;
}

export function InitialSetupWorkspaceActions({ view, pending, open, onObsSource, disclosures }: Props & { disclosures: Disclosures }) {
  const { confirmation } = useContext(SetupPresentation);
  return <div className="initial-setup setup-workspace-actions">
    {view.position === 'obsDisplay' && <>{!view.selected.includes('commentOverlay') && <section className="setup-step-card"><h2><span className="setup-number">2</span>使う表示をOBSに追加する</h2><InitialSetupObsRegistration view={view} onObsSource={onObsSource} disclosures={disclosures} /></section>}<section className="setup-step-card setup-obs-actions"><h2><span className="setup-number">3</span>OBSで表示を確認する</h2><p>追加・テストのダイアログでテストを送り、OBS上で文字・位置・大きさを確かめてください。</p>

      {confirmation}
    </section></>}
    {view.position === 'obsControl' && <section className="setup-step-card"><h2><span className="setup-number">2</span>OBSの接続状態を確認する</h2>{confirmation}</section>}
    <div className="setup-detail-link"><button type="button" id="setup-detail" className="feature-link" aria-disabled={pending} onClick={event => { if (!pending) open(setupEditor(view.position, view.selected)!, event.currentTarget); }}>詳細設定を開く ›</button></div>
  </div>;
}

function setupDisplayTargets(view: InitialSetupView) {
  return (Object.keys(obsOverlayDefinitions) as (keyof typeof obsOverlayDefinitions)[]).filter(id => view.selected.includes(({ comments: 'commentOverlay', speech: 'speechRecognition', effects: 'textEffects', character: 'character' } as const)[id]));
}

export function InitialSetupObsRegistration({ view, onObsSource, disclosures }: Pick<Props, 'view' | 'onObsSource'> & { disclosures: Disclosures }) {
  return <div className="setup-displays"><p>OBSで追加先のシーンを開いてから進んでください。</p>{setupDisplayTargets(view).map(id => <div className="setup-display-row" key={id}><strong>{obsOverlayDefinitions[id].title}</strong>
    <button className="setup-primary" id={`setup-register-${id}`} onClick={event => onObsSource({ target: { kind: 'overlay', overlay: id }, title: obsOverlayDefinitions[id].title, entry: event.currentTarget, initialSetup: true })}>OBSに追加して表示を確認…</button>
    <details open={disclosures.open[`obs-${id}`] ?? false} onToggle={event => disclosures.change(`obs-${id}`, event.currentTarget.open)}><summary id={`setup-manual-${id}`} tabIndex={0}>URLを手動で登録する場合</summary><p>OBSのソースで「＋」→「ブラウザ」を選び、次のURLを指定します。幅・高さは配信レイアウトに合わせて調整し、OBS上で確認してください。</p><input id={`setup-url-${id}`} aria-label={`${obsOverlayDefinitions[id].title}のOBS用URL`} readOnly value={`${location.origin}${obsOverlayDefinitions[id].path}`} onFocus={event => event.currentTarget.select()} /></details></div>)}</div>;
}

export function InitialSetupConfirmation({ view, snapshot, pending, blocked, perform }: Props) {
  const step = view.position as SetupStep;
  const { smartphoneNetwork } = useContext(SetupPresentation);
  const wrongPhoneNetwork = step === 'smartphone' && view.smartphoneUses.includes('video') && Boolean(smartphoneNetwork && smartphoneNetwork !== snapshot.smartphone?.settings.activeNetwork);
  const checked = view.confirmations[step] === view.fingerprints[step];
  const unavailable = pending || Boolean(view.warning) || step === 'smartphone' && !view.smartphoneUses.length || !checked && (wrongPhoneNetwork || blocked || !setupConfigured(step, snapshot, view.smartphoneUses));
  const label = ({ aiListener: 'AIの利用準備を確認できた', textEffects: '反応ワードと表示文字を確認できた', character: 'キャラクターの画像を確認できた', smartphone: view.smartphoneUses.includes('video') ? `このPCで映像・マイクのデータを受信できた${view.smartphoneUses.some(use => use !== 'video') ? `（${view.smartphoneUses.filter(use => use !== 'video').map(use => use === 'comments' ? 'コメント表示' : '読み上げ').join('・')}はスマホで確認できた）` : ''}` : '選んだ用途がスマホで使えることを確認できた', speechRecognition: '話した言葉が文字で表示された', sources: 'コメントの接続状態を確認できた', commentSpeech: 'テスト音声が聞こえた', obsControl: 'OBSの接続状態を確認できた', obsDisplay: 'OBSで選んだ表示を確認できた' } as Partial<Record<SetupStep, string>>)[step];
  return <div className="setup-personal-check"><button id={`setup-confirm-${step}`} className="secondary setup-confirm" aria-label={label} role="checkbox" aria-checked={checked} aria-disabled={unavailable} onClick={() => { if (!unavailable) void perform(checked ? { action: 'unconfirm', step } : { action: 'confirm', step, fingerprint: view.fingerprints[step] }); }}><span className="setup-check-box" aria-hidden="true">{checked ? '✓' : ''}</span><span>{label}<small>ご自身で確かめてからチェックしてください。</small></span></button><p className="setup-confirm-record">記録：{setupProgressLabel(step, view, snapshot)}</p></div>;
}

export function InitialSetupReview({ view, snapshot, pending, blocked, perform, disclosures, speechVoices = [], onCharacterAssetError }: Props & { disclosures: Disclosures }) {
  const { source } = useContext(SetupPresentation);
  if (view.position === 'smartphone' || view.position === 'speechRecognition') return <InitialSetupDeviceReview view={view} snapshot={snapshot} blocked={blocked || Boolean(view.warning)}><SetupRecordWarning view={view} pending={pending} perform={perform} /></InitialSetupDeviceReview>;
  if (['aiListener', 'textEffects', 'character'].includes(view.position)) return <InitialSetupCreativeReview view={view} snapshot={snapshot} blocked={blocked || Boolean(view.warning)} onOpenAssetError={onCharacterAssetError}><SetupRecordWarning view={view} pending={pending} perform={perform} /></InitialSetupCreativeReview>;
  const step = view.position as SetupStep;
  const overlay = snapshot.settings.commentOverlay;
  const voice = snapshot.settings.commentSpeech.voice;
  const speaker = speechVoices.find(item => item.speakerUuid === voice?.speakerUuid);
  const style = speaker?.styles.find(item => item.id === voice?.styleId);
  const voiceLabel = speaker && style ? `${speaker.name} · ${style.name}` : voice ? '保存済みの声（話者一覧を更新して確認）' : '声は未選択です';
  const sourceState = snapshot.sourceStatuses[source];
  const sourceReady = sourceState.state === 'connected' || sourceState.state === 'waiting';
  const voiceReady = snapshot.commentSpeech.engineStatus === 'ready' && Boolean(speaker && style);
  const obsReady = snapshot.obsControl?.connection === 'connected' && !snapshot.obsControl.error;
  const displayConfirmed = view.confirmations.obsDisplay === view.fingerprints.obsDisplay;
  const ready = !blocked && !view.warning && (step === 'sources' ? sourceReady : step === 'commentSpeech' ? voiceReady && !snapshot.commentSpeech.warning : step === 'obsControl' ? obsReady : displayConfirmed && obsReady);

  const sourceStateLabel = { stopped: 'まだ接続していません', connecting: '接続しています…', connected: '接続済み', waiting: '配信開始待ち', reconnecting: '再接続中', error: '確認が必要です' }[sourceState.state];
  const sourceHelp = sourceState.state === 'waiting' ? 'YouTubeの配信開始を待っています。正常な待機です。このまま次へ進めます。' : sourceState.message || ( sourceState.state === 'connected' ? '接続できました。新しいコメントを受け取れる状態です。' : sourceState.state === 'error' ? '接続先を確認して、もう一度お試しください。' : '左の入力欄と接続操作を確認してください。');
  return <aside className="initial-setup setup-review" data-ready={ready} aria-label="状態と動作の確認">
    <span className="setup-eyebrow">確認するもの</span><h2>{step === 'sources' ? '接続先と受信の状態' : step === 'commentSpeech' ? '試聴して声を確かめる' : step === 'obsControl' ? 'このPCのOBSとの接続' : 'OBSの実際の表示'}</h2>
    {step === 'sources' && <><div className="setup-source-preview"><span aria-hidden="true">◉</span><strong>{{ youtube: 'YouTube', twitch: 'Twitch', shitaraba: '掲示板' }[source]}</strong><p>{source === 'youtube' ? snapshot.settings.sources.youtube.target || '接続先を入力してください' : source === 'twitch' ? snapshot.settings.sources.twitch.channel || '接続先を入力してください' : snapshot.settings.sources.shitaraba.threadUrl || '接続先を入力してください'}</p></div><details className="setup-all-source-states" open={disclosures.open['source-states'] ?? false} onToggle={event => disclosures.change('source-states', event.currentTarget.open)}><summary id="setup-source-states" tabIndex={0}>サービスごとの接続状態</summary><dl className="setup-source-states">{(['youtube', 'twitch', 'shitaraba'] as const).map(source => <div key={source}><dt>{{ youtube: 'YouTube', twitch: 'Twitch', shitaraba: '掲示板' }[source]}</dt><dd className="setup-status-value" data-ready={snapshot.sourceStatuses[source].state === 'connected' || snapshot.sourceStatuses[source].state === 'waiting'}>{({ stopped: '停止中', connecting: '接続中', connected: '接続済み', waiting: '配信開始待ち', reconnecting: '再接続中', error: '要確認' })[snapshot.sourceStatuses[source].state]}</dd></div>)}</dl></details></>}
    {step === 'commentSpeech' && <div className="setup-voice-sample"><span aria-hidden="true">♫</span><strong className="setup-status-value" data-ready={voiceReady}>保存済みの声：{voiceLabel}</strong><div className="setup-wave" aria-hidden="true">▂ ▅ ▃ ▇ ▄ ▆ ▂ ▅ ▃</div></div>}
    {step === 'obsDisplay' && <div className="setup-display-sample"><span>説明用の見本 · OBSの実映像ではありません</span>{view.selected.includes('commentOverlay') ? <div style={{ fontSize: `${overlay.design?.style.fontSize ?? overlay.fontSizePx}px` }}>{overlay.showSource && <small>YouTube </small>}{overlay.showAuthor && <strong>視聴者 </strong>}{overlay.showContent && <span>こんにちは！</span>}</div> : <p>選んだ音声認識・文字演出・キャラクターを、OBS上で確かめます。</p>}</div>}
    <div className="setup-review-state" data-ready={ready} role="status">{step !== 'obsControl' && <strong className="setup-status-value" data-ready={ready}>現在：{step === 'sources' ? sourceStateLabel : step === 'obsDisplay' && displayConfirmed ? '前回の表示確認済み' : runtimeText(step, snapshot)}</strong>}<p>{step === 'sources' ? sourceHelp : step === 'commentSpeech' ? '試聴後、Windowsの出力先・音量と、実際に声が聞こえたことを確認してください。' : step === 'obsControl' ? snapshot.obsControl?.error || (snapshot.obsControl?.connection === 'connected' ? initialSetupSteps(view).includes('obsDisplay') ? 'OBS連携をONにするだけでは配信は始まりません。次はOBS上の表示を確認してください。' : 'OBS連携をONにするだけでは配信は始まりません。次の設定へ進んでください。' : snapshot.obsControl?.connection === 'connecting' ? 'OBSとの接続を待っています。' : 'OBSを起動し、接続情報とOBS連携の設定を確認してください。') : '追加とテスト送信の成功は、OBSで見えたことの確認とは別です。OBS上で表示・位置・大きさを確認してください。'}</p><SetupRecordWarning view={view} pending={pending} perform={perform} /></div>
    <p className="setup-review-help">{step === 'obsDisplay' ? '本人確認はOBSの実際の画面を見てから記録してください。' : '操作の結果と、次に確かめることをここにまとめます。'}</p>
  </aside>;
}

function SetupGuide({ step, view, disclosures }: { step: SetupStep; view: InitialSetupView; disclosures: Disclosures }) {
  switch (step) {
    case 'sources': return <><h2>使うサービスだけ接続します</h2><ol><li>配信URL・チャンネル名・スレッドURLを入力します。</li><li>使うサービスのスイッチをONにして、接続状態を確認します。</li></ol><p>例：YouTubeは「@あなたのハンドル」、Twitchは「https://www.twitch.tv/チャンネル名」。掲示板はトップページでなくスレッドURLを入力します。</p><p>YouTubeの配信開始待ちは正常な待機です。未配信でも後で確認できます。</p></>;
    case 'commentSpeech': return <><h2>VOICEVOXを準備して、声を聞きます</h2><ol><li><a href="https://voicevox.hiroshiba.jp/" target="_blank" rel="noreferrer">VOICEVOX公式サイト</a>からWindows版を入手・インストールします。</li><li>VOICEVOXを起動するか、下の「VOICEVOX」で実行ファイルを指定します。</li><li>「話者一覧を更新」から声を選び、「この声を試聴」で聞こえるか確認します。</li><li>新着を読み上げる場合は、コメント読み上げをONにします。</li></ol><p>試聴はOFFでも使えます。音が出ないときはWindowsの出力先・音量も確認してください。</p></>;
    case 'smartphone': return <><h2>使う場所に合わせて接続します</h2><ol><li>同じルーター・Wi-Fiなら「家庭内LAN」。外出先からはTailscaleか直接接続を選びます。</li><li>Tailscaleは<a href="https://tailscale.com/download" target="_blank" rel="noreferrer">公式サイト</a>からPCとAndroidへ導入し、同じプライベートネットワークへ参加します。直接接続は下の設定で公開アドレスと開放状態を確認します。</li><li>使う経路の接続準備をONにし、QRを表示します。</li><li>配布されたAndroid版きゃすメイトをスマホへインストールして起動し、スマホ連携からQRを読み取ってこのPCを登録します。</li></ol><p>選んだ用途：{view.smartphoneUses.map(id => ({ comments: 'コメントを見る', speech: '読み上げを聞く', video: '映像・配信マイクをPCへ送る' })[id]).join('、') || '未選択'}</p><p>コメントはスマホで表示、読み上げはスマホでONにして試聴、映像・マイクはスマホで送信を開始し、このPCの端末欄で受信できたことを確認します。PCの準備やQR登録だけでは映像・マイクの送信は始まりません。</p></>;
    case 'speechRecognition': return <><h2>入力を選び、自分の声で試します</h2><ol><li>「モデルを準備」で認識モデルを取得します。初回の容量案内を確認してください。</li><li>PCマイクか登録したスマホを選び、「この設定を適用」を押します。</li><li>プレビューを開始し、短く話してから話し終えます。認識結果を確認して終了します。</li></ol><p>プレビューは「配信に使う」がOFFでも確認できます。スマホ入力は端末の登録と音声送信が先に必要です。字幕表示は最後のOBS表示確認で追加できます。</p></>;
    case 'obsControl': return <ObsConnectionGuide initialSetup />;
    case 'aiListener': return <><h2>AIの利用準備をします</h2><ol><li>「連携」で<a href="https://aistudio.google.com/" target="_blank" rel="noreferrer">Google AI Studio</a>のAPIキーを保存します。利用条件と料金・上限は利用するプロジェクトで確認してください。</li><li>「人格」で名前・性格などを登録します。</li><li>「参加先」で使うサービスと人格を選びます。</li><li>YouTube・Twitchは「連携」で投稿用アカウントを認証します。掲示板は名前などを確認します。</li></ol><details open={disclosures.open['ai-preparation'] ?? false} onToggle={event => disclosures.change('ai-preparation', event.currentTarget.open)}><summary id="setup-ai-preparation" tabIndex={0}>YouTube・Twitchの準備手順</summary><p>YouTube：Google CloudでYouTube Data API v3とOAuth同意画面を準備し、Desktop appのクライアントJSONを保存して認証します。</p><p>Twitch：開発者コンソールでPublicアプリを登録し、Client IDを保存して表示された認証画面で許可します。</p><p><a href="https://developers.google.com/youtube/v3/guides/auth/installed-apps" target="_blank" rel="noreferrer">YouTube公式手順</a> · <a href="https://dev.twitch.tv/docs/authentication/register-app/" target="_blank" rel="noreferrer">Twitch公式手順</a></p></details><p>会話内容を外部AIへ送る機能です。この案内では実投稿を開始しません。音声認識とOBS接続の準備が済んだら、通常画面で開始してください。</p></>;
    case 'textEffects': return <><h2>最初の反応ルールを作ります</h2><ol><li>「ルールを追加」から、反応ワードと表示文字を設定します。</li><li>例：「w」に反応して「草」を表示するルールを保存します。</li><li>最後のOBS表示確認でソースを追加し、テストします。</li></ol><p>ルールのテスト再生はOBSへ送信します。試すときはOBSの表示先を確認してください。</p></>;
    case 'character': return <><h2>表示する画像を用意します</h2><ol><li>口を閉じた画像（PNG）を登録します。</li><li>口パクには同じ寸法の口を開けた画像（PNG）も登録します。</li><li>プレビューを開き、口パクを試します。詳しい微動の調整は詳細設定を開きます。</li></ol><p>口を開けた画像なしでも静止表示できます。OBSへの追加は最後に案内します。</p></>;
    case 'obsDisplay': return <><h2>使う表示だけOBSで確認します</h2><ol><li>追加先のシーンをOBSで開きます。</li><li>「追加・表示テスト」から対象を確認し、明示的に追加・テストします。手動登録も選べます。</li><li>OBS上で表示・位置・大きさを確認します。テスト送信の成功と実表示の成功は別です。</li></ol><p>音声認識・文字演出・キャラクターは必要な表示だけ確認してください。</p></>;
  }
}
function runtimeText(step: SetupStep, s: AppSnapshot): string {
  switch (step) {
    case 'sources': return `${Object.values(s.sourceStatuses).filter(v => v.state === 'connected').length}件接続中`;
    case 'commentSpeech': return s.commentSpeech.warning || ({ disabled: 'VOICEVOX未起動', preparing: 'VOICEVOX準備中', ready: 'VOICEVOX準備完了', unavailable: 'VOICEVOX利用不可' })[s.commentSpeech.engineStatus];
    case 'smartphone': return s.smartphone?.warning || `${s.smartphone?.devices.length ?? 0}台登録済み（実接続・映像成功とは別です）`;
    case 'speechRecognition': return s.speechRecognition.warning || `モデル：${s.speechRecognition.modelStatus === 'ready' ? '準備済み' : '準備を確認'}／プレビュー${s.speechRecognition.previewActive ? '実行中' : '停止中'}`;
    case 'obsControl': return s.obsControl ? `${({ disabled: 'OBS連携OFF', connecting: 'OBS接続中', connected: 'OBS接続済み', unavailable: 'OBS接続不可' })[s.obsControl.connection]}${s.obsControl.error ? `：${s.obsControl.error}` : ''}` : 'OBSを利用できません';
    case 'aiListener': return s.aiListener?.message || '利用準備を確認してください';
    case 'textEffects': return `${s.settings.textEffects.rules.length}件のルール保存済み`;
    case 'character': return s.character.assetWarning || (s.settings.character.simple.closedAsset ? '口を閉じた画像登録済み' : '画像未登録');
    case 'obsDisplay': return 'OBS上の実表示は本人が確認してください';
  }
}
