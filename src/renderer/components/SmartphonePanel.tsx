import { smartphoneReceiverState } from './smartphone-status';
import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { smartphoneNetworkNames, type SmartphoneConfiguration, type SmartphoneNetwork, type SmartphoneInvitation, type SmartphoneView } from '../../shared/smartphone';
import { LanAdapterSelect } from './LanAdapterSelect';
import { DirectSettingsPanel } from './DirectSettingsPanel';
import type { MobileSpeechSettings, MobileSpeechState } from '../../shared/types';
import { ManagementNavigation, SetupPresentation } from '../management-navigation';
import { smartphoneUses as allUses, type SmartphoneUse } from '../../shared/initial-setup';
import { SettingsCard } from './SettingsCard';
import { SlimSwitch } from './SlimSwitch';
import { CompactFeedback } from './CompactFeedback';
import { InitialSetupPhoneGuide } from './InitialSetupPhoneGuide';
import { InitialSetupPhonePrerequisite } from './InitialSetupPhonePrerequisite';
import { ObsSourceIcon } from './ObsSourceIcon';
import type { ObsSourceRegistrationEntry } from './ObsSourceRegistrationDialog';
import './smartphone-panel.css';

interface Props {
  listLanAdapters?: () => Promise<import('../../shared/direct-connection').DirectAdapterOption[]>;
  listAdapters?: () => Promise<import('../../shared/direct-connection').DirectAdapterOption[]>;
  view: SmartphoneView;
  mobile: MobileSpeechState;
  audioSettings: MobileSpeechSettings;
  saveError?: string;
  registrationWarning?: string;
  onRegisterSource?(request: ObsSourceRegistrationEntry): void;
  onRegistrationBlockedChange?(reason: string): void;
  changeAudio(value: MobileSpeechSettings): void;
  configure(value: SmartphoneConfiguration): Promise<unknown>;
  deviceAction(id: string | null, action: 'add' | 'rename' | 'delete' | 'regenerate', name?: string): Promise<unknown>;
  invitation(network: SmartphoneNetwork): Promise<SmartphoneInvitation>;
  obsInput(id: string): Promise<string>;
  onSuccess(message: string): void;
  previewSpeech?(): Promise<unknown>;
  speechSettingsPending?: boolean;
  directAction?: (action: 'retry' | 'cleanup' | 'manual-confirm' | 'reset-key', body?: unknown) => Promise<unknown>;
}
const statusLabels = { stopped: 'スマホで停止', preparing: '準備中', connecting: '接続中', sending: '送信中', reconnecting: '再接続中', actionRequired: 'スマホで確認が必要' };
const networkLabels = { lan: '家庭内LAN', tailscale: 'Tailscale', direct: '直接接続' };
const networkDescriptions = { lan: '自宅のWi-Fi・同じルーター', tailscale: '外出先からプライベート接続', direct: '外出先から接続・ルーター設定が必要な場合あり' };
const networkMarks = { lan: 'LAN', tailscale: 'TS', direct: 'IP' };
const networkOrder = ['lan', 'direct', 'tailscale'] as const;
const speechPreviewMessages = {
  progress: '進み具合の保存が終わってから試聴してください。',
  settings: '読み上げ設定の保存を完了してから試聴してください。',
  busy: 'スマホ連携の操作を処理中です。完了してから試聴してください。',
  network: 'この接続方法でPCの接続を準備してから試してください。',
  audio: 'PCの読み上げ設定で話者を選び、コメント読み上げをONにしてください。',
  clients: 'Androidのコメント画面で、右上のヘッドホンをONにし、音声接続を待ってください。つながらないときは左隣の歯車で接続状態を確認してください。',
  unavailable: '読み上げ設定を開き、そちらの「この声を試聴」を利用してください。',
  pending: '試聴を準備しています…',
  ready: 'PCでの再生完了は、スマホで聞こえたことの確認とは別です。',
};

export function SmartphonePanel({ view, mobile, audioSettings, saveError, registrationWarning, onRegisterSource, onRegistrationBlockedChange, changeAudio, configure, deviceAction, invitation, obsInput, onSuccess, directAction, listAdapters, listLanAdapters, previewSpeech, speechSettingsPending }: Props) {
  const navigation = useContext(ManagementNavigation);
  const setup = navigation?.initialSetup && navigation.setupPosition === 'smartphone';
  const { smartphoneCommentsReady, smartphoneSpeechEnabled, smartphoneSpeechReady, smartphoneUses = [], selectSmartphoneUses, selectionPending, confirmation, selectSmartphoneNetwork } = useContext(SetupPresentation);
  const [network, setNetwork] = useState<SmartphoneNetwork>(view.settings.activeNetwork ?? 'lan');
  useLayoutEffect(() => { if (setup) selectSmartphoneNetwork?.(network); }, [setup, network, selectSmartphoneNetwork]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [lanDraft, setLanDraft] = useState<string>();
  const [lanSaveFailed, setLanSaveFailed] = useState(false);
  const [ports, setPorts] = useState<Partial<Record<SmartphoneNetwork, string>>>({});
  const [bitrate, setBitrate] = useState<string>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [speechTesting, setSpeechTesting] = useState(false);
  const [speechTestError, setSpeechTestError] = useState('');
  const speechTestPending = useRef(false);
  const speechGuideControls = useRef<HTMLDivElement>(null);
  const [phoneUsesOpen, setPhoneUsesOpen] = useState(false);
  const [phoneHelpOpen, setPhoneHelpOpen] = useState<Partial<Record<SmartphoneUse, boolean>>>({});
  const [unsaved, setUnsaved] = useState(new Set<string>());
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [qr, setQr] = useState<{ image: string; title: string; features: string } | null>(null);
  const [obsGuideTarget, setObsGuideTarget] = useState<{ deviceId: string; name: string } | null>(null);
  const networkButtons = useRef<Partial<Record<SmartphoneNetwork, HTMLButtonElement>>>({});
  const restoreNetworkFocus = useRef(false);
  const activeNetworkLink = useCallback((element: HTMLButtonElement | null) => {
    if (element) return () => { if (document.activeElement === element) restoreNetworkFocus.current = true; };
  }, []);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const obsGuide = useRef<HTMLDialogElement>(null);
  const obsGuideEntry = useRef<HTMLButtonElement>(null);
  const obsGuideClose = useRef<HTMLButtonElement>(null);
  const deviceListHeading = useRef<HTMLHeadingElement>(null);
  const epoch = useRef(0);
  const queue = useRef(Promise.resolve());
  const count = useRef(0);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const revisions = useRef(new Map<string, number>());
  const composing = useRef(new Set<string>());
  const visible = !navigation || navigation.editor === 'smartphone';
  const fingerprint = JSON.stringify([view.settings, Object.values(view.networks).map(value =>
    [value.address, value.commentsUrl, value.registrationReady, value.invitationRevision])]);
  const hideQr = () => { epoch.current += 1; setQr(null); dialog.current?.close(); };
  useLayoutEffect(() => { epoch.current += 1; setQr(null); dialog.current?.close(); }, [fingerprint, visible, network]);
  useLayoutEffect(() => { if (qr) dialog.current?.showModal(); }, [qr]);
  useLayoutEffect(() => {
    if (!obsGuide.current?.open) return;
    const targetExists = view.devices.some(device => device.id === obsGuideTarget?.deviceId);
    if (!visible || !targetExists) {
      obsGuide.current.close();
      if (visible && !targetExists) deviceListHeading.current?.focus({ preventScroll: true });
    }
  }, [visible, obsGuideTarget, view.devices]);
  useEffect(() => {
    const hide = () => { epoch.current += 1; setQr(null); dialog.current?.close(); };
    document.addEventListener('visibilitychange', hide); window.addEventListener('blur', hide); window.addEventListener('pagehide', hide);
    const pending = timers.current;
    return () => { epoch.current += 1; for (const timer of pending.values()) clearTimeout(timer);
      document.removeEventListener('visibilitychange', hide); window.removeEventListener('blur', hide); window.removeEventListener('pagehide', hide); };
  }, []);
  const run = (action: () => Promise<unknown>, success?: string) => {
    hideQr(); count.current += 1; setBusy(true); setError('');
    const next = queue.current.then(async () => {
      setError('');
      try { await action(); if (success) onSuccess(success); }
      catch (reason) { setError(reason instanceof Error ? reason.message : '操作を完了できません。'); }
      finally { count.current -= 1; setBusy(count.current > 0); }
    });
    queue.current = next; return next;
  };
  const defer = (key: string, action: (() => Promise<unknown>) | null | undefined) => {
    hideQr(); clearTimeout(timers.current.get(key));
    timers.current.delete(key);
    const revision = (revisions.current.get(key) ?? 0) + 1;
    revisions.current.set(key, revision);
    if (action === undefined) {
      setUnsaved(previous => { const next = new Set(previous); next.delete(key); return next; });
      return;
    }
    setUnsaved(previous => new Set(previous).add(key));
    if (action) timers.current.set(key, setTimeout(() => {
      timers.current.delete(key);
      void run(async () => {
        await action();
        if (revisions.current.get(key) === revision) setUnsaved(previous => { const next = new Set(previous); next.delete(key); return next; });
      }, 'スマホの設定を保存しました。');
    }, 500));
  };
  const openQr = (button: HTMLElement, get: () => Promise<{ image: string; title: string; features: string }>) => {
    if (count.current) return;
    opener.current = button;
    const current = epoch.current + 1;
    void run(async () => { const result = await get();
      if (current === epoch.current && document.visibilityState !== 'hidden') setQr(result); });
  };
  const closeQr = () => { hideQr(); opener.current?.focus({ preventScroll: true }); };
  const restoreObsGuideFocus = () => {
    if (visible)
      (obsGuideEntry.current?.isConnected ? obsGuideEntry.current : deviceListHeading.current)?.focus({ preventScroll: true });
  };
  const closeObsGuide = () => { obsGuide.current?.close(); restoreObsGuideFocus(); };
  const editName = (id: string, value: string) => {
    setNames(previous => ({ ...previous, [id]: value }));
    const valid = value.trim() && !Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
    defer(`name:${id}`, valid && !composing.current.has(id) ? () => deviceAction(id, 'rename', value) : null);
  };
  const lanAdapter = network === 'lan' ? <LanAdapterSelect visible={visible} retryable={lanSaveFailed} busy={busy || !view.available} interfaceId={lanDraft ?? view.settings.lanInterfaceId} list={listLanAdapters}
    select={id => {
      setLanDraft(id); setLanSaveFailed(false); setUnsaved(previous => new Set(previous).add('lan'));
      return run(async () => {
        try { await configure({ lanInterfaceId: id }); }
        catch (reason) { setLanSaveFailed(true); throw reason; }
        setLanDraft(undefined); setUnsaved(previous => { const next = new Set(previous); next.delete('lan'); return next; });
      }, 'LANアダプターを保存しました。');
    }} /> : null;
  const selected = view.settings.activeNetwork === network;
  const speechPreviewBlockReason = navigation?.initialSetupPending ? speechPreviewMessages.progress
    : speechSettingsPending ? speechPreviewMessages.settings
    : busy ? speechPreviewMessages.busy
    : !selected ? speechPreviewMessages.network
    : !mobile.audioAvailable ? mobile.warning ? `スマホ音声を利用できません。${mobile.warning} PCの読み上げ設定と「要確認」を確認してください。` : speechPreviewMessages.audio
    : mobile.clientCount === 0 ? speechPreviewMessages.clients
    : !previewSpeech ? speechPreviewMessages.unavailable : '';
  const speechPreviewHelp = speechTesting ? speechPreviewMessages.pending
    : [speechPreviewBlockReason, speechTestError && `前回の試聴：${speechTestError}`].filter(Boolean).join('\n') || speechPreviewMessages.ready;
  useLayoutEffect(() => {
    const help = speechGuideControls.current?.querySelector<HTMLElement>('.setup-phone-speech-help');
    if (help) help.scrollTop = 0;
  }, [speechPreviewHelp]);
  const otherActiveNetwork = !selected ? view.settings.activeNetwork : null;
  const current = view.networks[network] ?? { address: null, commentsUrl: null, registrationReady: false, videoReady: false, obsReady: false, warning: null };
  const entries = mobile.urls.filter(entry => entry.kind === network);
  const statusPort = ports[network] ?? String(view.settings.statusPorts[network]);
  const validPort = /^\d+$/u.test(statusPort) && Number(statusPort) >= 1024 && Number(statusPort) <= 65535;
  const rate = bitrate ?? String(audioSettings.bitrateKbps);
  const validRate = /^\d+$/u.test(rate) && Number(rate) >= 16 && Number(rate) <= 128;
  const registrationBlocked = busy || unsaved.size > 0 || Boolean(saveError);
  const showActiveNetworkLink = view.available && Boolean(otherActiveNetwork) && !registrationBlocked;
  useLayoutEffect(() => {
    if (!showActiveNetworkLink && restoreNetworkFocus.current) {
      restoreNetworkFocus.current = false;
      networkButtons.current[network]?.focus({ preventScroll: true });
    }
  }, [network, showActiveNetworkLink]);
  const registrationBlockReason = busy ? 'スマホ連携の操作を処理中です。完了してからOBSへ追加してください。'
    : unsaved.size || saveError ? '未保存または保存に失敗した入力があります。入力を保存してからOBSへ追加してください。' : '';
  useEffect(() => { onRegistrationBlockedChange?.(registrationBlockReason); }, [onRegistrationBlockedChange, registrationBlockReason]);
  const invalidPorts = Object.values(ports).some(value => !/^\d+$/u.test(value) || Number(value) < 1024 || Number(value) > 65535);
  const invalidNames = Object.values(names).some(value => !value.trim() || Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127));
  const warning = [error, saveError, view.warning, ...Object.values(view.networks).map(v => v.warning),
    invalidPorts ? '登録・制御ポートは1024～65535の整数を入力してください。未保存です。' : '',
    invalidNames ? 'スマホの名前は空白以外の文字で入力してください。未保存です。' : '',
    !validRate ? '音質は16～128の整数を入力してください。未保存です。' : ''].filter(Boolean).join(' ');
  const profiles = view.devices.flatMap(device => device.profiles[network]?.registered ? [device.profiles[network]!] : []);
  const commentsReady = selected && Boolean(current.commentsUrl || (network === 'direct' && current.registrationReady));
  const videoError = profiles.some(profile => profile.preparation?.video === 'error' || profile.receiver?.state === 'error');
  const receiving = profiles.some(profile => profile.receiver?.state === 'receiving');
  const videoState = !view.available ? '利用不可' : !selected ? '受信OFF' : receiving ? videoError ? '受信中・一部要確認' : '受信中' :
    videoError ? '要確認' : !profiles.length ? '登録後に準備' : current.videoReady ? '受信待ち' : '準備中';
  const qrReason = !view.available ? 'スマホ連携を利用できません。要確認から原因を確認してください。' : busy ? '操作を処理しています…' :
    unsaved.size || saveError ? setup ? '未保存の入力があります。登録用QRは保存後に利用できます。' : '未保存の入力があります。登録用QRとOBS入力は保存後に利用できます。' :
    !selected ? otherActiveNetwork ? `${networkLabels[otherActiveNetwork]}がONです。` : 'このネットワークをONにすると、登録用QRを利用できます。' : !current.registrationReady ? '登録の入口を準備中です。利用できない場合は要確認を開いてください。' :
    'スマホのきゃすメイトで登録用QRを読み取ってください。';
  const registrationQr = (<button type="button" className="sp-qr-button" aria-disabled={!view.available || !selected || !current.registrationReady || registrationBlocked} onClick={event => {
        if (view.available && selected && current.registrationReady && !registrationBlocked) openQr(event.currentTarget, async () => {
          const value = await invitation(network);
          return { image: await QRCode.toDataURL(JSON.stringify(value), { width: 420, errorCorrectionLevel: 'M' }),
            title: `${network === 'lan' ? 'LAN' : network === 'direct' ? '直接接続' : 'Tailscale'}の共通QR`, features: 'コメント・読み上げ・映像と配信マイクの共通登録です。映像の準備中でも登録できます。撮影と送信はスマホで開始してください。映像の準備が終わると接続情報が自動で届きます。' };
        });
      }}>登録用QRを表示</button>);
  const connectionDetails = (<details key="connection-details" className="sp-disclosure sp-advanced" onToggle={event => setAdvancedOpen(event.currentTarget.open)}><summary><strong>接続の詳細設定</strong><span className="sp-note">通常は変更不要</span></summary>
      <DirectSettingsPanel initialSetup={Boolean(setup)} network={network} blocked={registrationBlocked} portEditor={<label className="sp-field">登録・制御ポート（TCP）<input aria-label="登録・制御のTCPポート" type="number" min={1024} max={65535} value={statusPort} aria-invalid={!validPort} onChange={event => {
        const value = event.target.value; setPorts(previous => ({ ...previous, [network]: value }));
        defer(`port:${network}`, /^\d+$/u.test(value) && Number(value) >= 1024 && Number(value) <= 65535 ? () => configure({ network, statusPort: Number(value) }) : null);
      }} /><small>{setup ? '通常3001。スマホの登録・制御に使うPC内部のポートです。' : network === 'direct' ? '通常3001。登録・コメント・OBS操作で共用するPC内部のポートです。公開ポートは「自宅のルーター」で設定します。' : '通常3001。コメント・OBS操作とは別のポートを指定します。'}</small></label>} view={view} busy={busy} configure={configure}
        run={run} action={directAction} defer={defer} visible={visible && advancedOpen} listAdapters={listAdapters} />
    </details>);
  const normalControls = (<>
    <section className="sp-registration-hub" aria-label="スマホを登録する"><h3>スマホを登録する</h3>
    <div className="sp-networks" aria-label="利用するネットワーク">{networkOrder.map(kind => <div key={kind} className="sp-network-choice">
      <button ref={element => { if (element) networkButtons.current[kind] = element; }} type="button" className="secondary" aria-label={smartphoneNetworkNames[kind]} aria-describedby={`sp-network-description-${kind}`} aria-pressed={network === kind} onClick={() => { hideQr(); setNetwork(kind); }}>
        <span className="sp-network-mark" aria-hidden="true">{networkMarks[kind]}</span>
        <strong>{networkLabels[kind]}</strong><small id={`sp-network-description-${kind}`}>{networkDescriptions[kind]}</small>
      </button>
      <div className="sp-network-switch"><span>接続を準備</span><SlimSwitch label={smartphoneNetworkNames[kind]} checked={view.settings.activeNetwork === kind} disabled={!view.available || busy} keepFocus
        onChange={enabled => run(() => configure({ activeNetwork: enabled ? kind : null }), 'ネットワーク設定を保存しました。')} />
      </div>
    </div>)}</div>
    <section className="sp-connect" aria-label="接続と登録">
      <div className="sp-connect-heading"><div><h3>{networkLabels[network]}の接続と登録</h3></div>
        {registrationQr}</div>
      <div className="sp-status sp-connection-state" role="status" tabIndex={0} data-attention={!view.available || registrationBlocked || Boolean(current.warning) || showActiveNetworkLink}>
        <svg className="sp-state-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></svg>
        <span className="sp-connection-hint"><span>{qrReason}</span>{showActiveNetworkLink && otherActiveNetwork && <button ref={activeNetworkLink} type="button" className="secondary sp-active-network-link" aria-label={`${networkLabels[otherActiveNetwork]}の設定を見る`}
        onClick={() => { hideQr(); setNetwork(otherActiveNetwork); networkButtons.current[otherActiveNetwork]?.focus({ preventScroll: true }); }}>設定を見る <span aria-hidden="true">→</span></button>}</span></div>
      <dl className="sp-feature-states" aria-label="機能ごとの状態">
        <div><dt>コメント表示</dt><dd data-tone={commentsReady ? 'ready' : 'idle'}>{!view.available ? '利用不可' : !selected ? '接続OFF' : commentsReady ? '準備済み' : current.warning ? '要確認' : '準備中'}</dd></div>
        <div><dt>読み上げ</dt><dd data-tone={commentsReady && mobile.audioAvailable ? 'ready' : 'idle'}>{!view.available ? '利用不可' : !selected ? '接続OFF' : !commentsReady ? '接続準備待ち' : mobile.audioAvailable ? '利用可能' : '設定を確認'}</dd></div>
        <div><dt>映像・マイク受信</dt><dd data-tone={selected && videoError ? 'warning' : selected && receiving ? 'ready' : 'idle'}>{videoState}</dd></div>
      </dl>
      <section className="sp-speech-summary" aria-label="読み上げ音声をスマホへ送る">
        <div><h4>読み上げ音声をスマホへ送る</h4><CompactFeedback className="sp-speech-state" reserve={['再生の開始・停止はスマホで操作します。', 'PCのコメント読み上げ設定を確認してください。']} role="status">
          {mobile.audioAvailable ? '再生の開始・停止はスマホで操作します。' : 'PCのコメント読み上げ設定を確認してください。'}
        </CompactFeedback><div className="sp-audio-state"><span>{view.settings.activeNetwork ? networkLabels[view.settings.activeNetwork] : 'ネットワークOFF'}</span><span>{mobile.audioAvailable ? '利用可能' : '読み上げ設定を確認'}</span><span>音声接続 {mobile.clientCount}台</span></div></div>
        {navigation && <button type="button" id="sp-speech-settings" className="secondary" onClick={event => navigation.open('commentSpeech', event.currentTarget)}>読み上げ設定を開く</button>}
      </section>
      {network === 'direct' && <p className="sp-recovery-note">直接接続はAndroidの共通QR専用です。接続先をすべて失うとPCでQR再登録が必要になり、外出中は復旧できない場合があります。</p>}
      <details className="sp-help"><summary>{network === 'lan' ? '家庭内LANで接続する手順' : network === 'direct' ? '直接接続する手順' : 'Tailscaleで接続する手順'}</summary>
        <p>{!view.available ? 'スマホ連携を利用できません' : selected ? commentsReady ? 'コメントの接続準備済み' : '接続先を準備中・要確認' : 'このネットワークはOFF'}</p><code>{current.address ?? '接続先アドレスなし'}</code>
        <p>同じQRで複数のスマホを登録できます。QRは配信画面に映さないでください。準備済みは実接続・実表示の確認とは異なります。</p>
        <ol className="sp-flow" aria-label="スマホで使い始める手順"><li><span>1</span>ネットワークをON</li><li><span>2</span>QRで初回登録</li><li><span>3</span>スマホで開始</li></ol>
        {network === 'direct' ? <p>コメントと登録の入口が準備できたら、Androidで共通QRを登録できます。映像の準備状況はスマホにも表示されます。外出先から接続を確認してください。保存済みの接続先がすべて変わった場合はPCでQRを読み直す必要があります。</p> : network === 'lan' ? <p>PCとスマホを信頼できる同じルーターへ接続してください。接続できない場合はWindowsファイアウォールも確認します。</p> : <><p>PCとAndroidの両方にTailscaleを導入し、同じTailscaleネットワークへ接続してください。</p><p><a href="https://tailscale.com/docs/install/windows" target="_blank" rel="noreferrer">Windows版の導入</a> ／ <a href="https://tailscale.com/docs/install/android" target="_blank" rel="noreferrer">Android版の導入</a> ／ <a href="https://tailscale.com/pricing" target="_blank" rel="noreferrer">料金と利用条件</a></p></>}
      </details>
    </section></section>
    <section className="sp-section sp-devices" aria-label="スマホ一覧・登録">
      <div className="sp-section-heading"><h3 id="sp-device-list-heading" ref={deviceListHeading} tabIndex={-1}>登録済みのスマホ</h3><span>{view.devices.length}台</span></div>
      <div className="sp-device-list">{view.devices.map(device => {
        const profile = device.profiles[network];
        const receiverState = smartphoneReceiverState(device, network, view.settings.activeNetwork);
        const sendingState = !profile?.registered ? 'QRでこの経路を登録' : profile.stale || !profile.report ? 'スマホ側で確認' : statusLabels[profile.report.status];
        return <article className="sp-device" key={device.id}>
          <div className="sp-device-heading" tabIndex={0}><span className="sp-device-icon" aria-hidden="true"><ObsSourceIcon name="smartphone" /></span><div><h4>{names[device.id]?.trim() || device.name}</h4><span className="sp-registration-state">{networkLabels[network]} · {profile?.registered ? 'PC登録済み' : '未登録'}</span></div></div>
          <div className="sp-device-status" role="status" tabIndex={0}><div><small>PCの映像受信</small><span>{receiverState}</span></div><div><small>スマホの送信</small><span>{sendingState}</span></div></div>
          <div className="sp-device-obs">
            <button id={`sp-obs-guide-entry-${device.id}`} type="button" className="sp-obs-guide-entry" aria-label={`${device.name}の映像をOBSに追加`} aria-haspopup="dialog" aria-controls={onRegisterSource ? 'obs-source-registration-dialog' : 'sp-obs-guide-dialog'} onClick={event => {
              hideQr();
              if (onRegisterSource) {
                const blockedReason = !view.available ? 'スマホ連携を利用できません。要確認から原因を確認してください。'
                  : registrationBlocked ? registrationBlockReason
                    : !device.obsLocalPort ? '端末共通のOBS入力を準備中です。入力の割当後に追加してください。' : undefined;
                onRegisterSource({ target: { kind: 'smartphone', deviceId: device.id },
                  title: device.name, entry: event.currentTarget, blockedReason });
                return;
              }
              obsGuideEntry.current = event.currentTarget;
              setObsGuideTarget({ deviceId: device.id, name: device.name });
              obsGuide.current?.showModal(); obsGuideClose.current?.focus({ preventScroll: true });
            }}>映像をOBSに追加</button>
            <button type="button" className="secondary" aria-disabled={!view.available || !device.obsLocalPort || registrationBlocked} onClick={() => { if (view.available && device.obsLocalPort && !registrationBlocked) void run(async () => navigator.clipboard.writeText(await obsInput(device.id)), 'OBS入力をコピーしました。'); }}>OBS入力をコピー</button>
          </div>
          <details className="sp-device-management"><summary>名前・登録設定</summary><label>スマホの名前<input aria-label={`${device.name}の名前`} maxLength={64} value={names[device.id] ?? device.name}
            onCompositionStart={event => { composing.current.add(device.id); editName(device.id, event.currentTarget.value); }}
            onCompositionEnd={event => { composing.current.delete(device.id); editName(device.id, event.currentTarget.value); }}
            onChange={event => editName(device.id, event.target.value)} /></label><p>OBS入力は全ネットワーク共通・このPC専用で、秘密情報を含みません。</p><p>端末共通のOBS受信UDPポート：{device.obsLocalPort || '準備中に割当'}</p>
            {network === 'direct' && <p>ルーターの転送先SRT UDPポート：{device.profiles.direct?.obsPort || '登録時に割当'}</p>}
            <div className="button-row"><button type="button" className="secondary" aria-disabled={busy} onClick={() => {
              if (!busy && window.confirm('秘密情報を再発行します。\n・このスマホのPC受信を再起動します。\n・すべてのネットワークの古い共通QRが無効になります。\n・スマホで送信を止め、共通QRを読み直してください。\n続けますか？')) void run(() => deviceAction(device.id, 'regenerate'), '秘密情報を再発行しました。Androidで共通QRを読み直してください。');
            }}>秘密情報を再発行</button><button type="button" className="secondary danger" aria-disabled={busy} onClick={() => {
              if (!busy && window.confirm('このスマホの登録を削除します。\n・PCの受信を停止します。\n・すべてのネットワークの古い共通QRが無効になります。\n・OBSソースは残ります。撮影・マイクはスマホで止めてください。\n削除しますか？')) {
                const key = `name:${device.id}`; clearTimeout(timers.current.get(key)); timers.current.delete(key);
                void run(async () => { await deviceAction(device.id, 'delete'); setUnsaved(previous => { const next = new Set(previous); next.delete(key); return next; }); setNames(previous => { const next = { ...previous }; delete next[device.id]; return next; }); }, 'スマホの登録を削除しました。');
              }
            }}>登録を削除</button></div></details>
        </article>;
      })}</div>
      {!view.devices.length && <div className="sp-empty"><span aria-hidden="true">▯</span><strong>スマホはまだ登録されていません</strong><p>ネットワークをONにして「登録用QRを表示」。スマホで読み取ると、ここに追加されます。</p></div>}
    </section>
  </>);
  return <SettingsCard cardId="smartphone" title="スマホ連携" eyebrow="SMARTPHONE" className="smartphone-panel" navigationWarning={warning || registrationWarning || (unsaved.size ? 'スマホ連携に未保存の入力があります。入力を確認して保存してください。' : busy ? 'スマホ連携の操作を処理中です。' : undefined)}>
    <div className="sp-normal-controls" hidden={setup}>{normalControls}</div>
    <div key="phone-settings" className={setup ? "setup-phone-steps" : "sp-shared-layout"}>
      {setup && <section className="setup-phone-use-overview" aria-labelledby="setup-phone-uses-title"><div className="setup-phone-use-heading"><h3 id="setup-phone-uses-title">スマホで使う機能</h3><p className="setup-phone-use-summary">{smartphoneUses.length ? allUses.filter(use => smartphoneUses.includes(use)).map(use => ({ comments: 'コメントを見る', speech: '読み上げを聞く', video: '映像・配信マイクを送る' })[use]).join('・') : '使いたい機能を1つ以上選んでください。'}</p></div>
        <details className="setup-phone-use-editor" open={phoneUsesOpen} onToggle={event => setPhoneUsesOpen(event.currentTarget.open)}><summary id="setup-phone-change-uses">使う機能を変更</summary>
        <fieldset className="setup-phone-uses"><legend className="visually-hidden">スマホの用途</legend>{allUses.map(use => <label key={use}><input type="checkbox" checked={smartphoneUses.includes(use)} aria-disabled={Boolean(selectionPending)} onChange={() => { if (!selectionPending) selectSmartphoneUses?.(smartphoneUses.includes(use) ? smartphoneUses.filter(v => v !== use) : [...smartphoneUses, use]); }} /><span><strong>{{ comments: 'コメントを見る', speech: '読み上げを聞く', video: '映像・配信マイクを送る' }[use]}</strong><small>{{ comments: 'PCが取得したコメントをAndroidで表示。', speech: 'PCのVOICEVOXで作った音声をスマホで再生。', video: 'Androidのカメラ・マイクをPCへ送信。' }[use]}</small></span></label>)}</fieldset></details>
        {smartphoneUses.some(use => use === 'comments' || use === 'speech') && <div className="setup-phone-prerequisites">
          <InitialSetupPhonePrerequisite kind="comment" ready={Boolean(smartphoneCommentsReady)}
            message={smartphoneCommentsReady ? '✓ コメント接続は準備済み' : 'コメント接続の準備が必要です。先に使うサービスの接続先と接続状態を確認してください。'}
            reserve={['✓ コメント接続は準備済み', 'コメント接続の準備が必要です。先に使うサービスの接続先と接続状態を確認してください。']} />
          {smartphoneUses.includes('speech') && <InitialSetupPhonePrerequisite kind="speech" ready={Boolean(smartphoneSpeechReady && smartphoneSpeechEnabled)}
            message={smartphoneSpeechReady ? smartphoneSpeechEnabled ? '✓ 読み上げは準備済み' : '声の準備は済んでいます。スマホへ送るには、読み上げ設定で「コメント読み上げ」をONにしてください。' : '読み上げの準備が必要です。先にVOICEVOXと声を準備してください。'}
            reserve={['✓ 読み上げは準備済み', '声の準備は済んでいます。スマホへ送るには、読み上げ設定で「コメント読み上げ」をONにしてください。', '読み上げの準備が必要です。先にVOICEVOXと声を準備してください。']} />}
          <p className="muted setup-phone-return-help" style={{ visibility: !smartphoneCommentsReady || smartphoneUses.includes('speech') && !(smartphoneSpeechReady && smartphoneSpeechEnabled) ? 'visible' : 'hidden' }}>設定後は画面上部の戻るボタンで、このスマホの設定へ戻れます。</p>
        </div>}
      </section>}
      <section key="connection-settings" className={setup ? "setup-step-card" : "sp-compact-settings"}>
      {setup && <div key="setup-preparation"><h3><span className="setup-number">1</span>PCの接続を準備</h3>
        <label className="setup-phone-network">PCとスマホをどこで使いますか？<select aria-label="初回設定の接続方法" value={network} onChange={event => { hideQr(); setNetwork(event.target.value as SmartphoneNetwork); }}><option value="lan">同じWi-Fi・LAN</option><option value="tailscale">外出先・Tailscale</option><option value="direct">外出先・直接接続</option></select></label>
        <p>{network === 'lan' ? 'PCとAndroidを、同じ信頼できるルーター・Wi-Fiにつなぎます。' : network === 'tailscale' ? 'PCとAndroidにTailscaleを用意し、同じプライベートネットワークに参加します。' : '外部からPCへ接続するための公開アドレス・ルーター設定などを確認します。'}</p>
        {lanAdapter}
        <button type="button" className="setup-primary setup-phone-preparation" aria-disabled={!view.available || busy || !selected && !smartphoneUses.length} onClick={() => { if (view.available && !busy && (selected || smartphoneUses.length)) void run(() => configure({ activeNetwork: selected ? null : network }), 'ネットワーク設定を保存しました。'); }}><span>{selected ? 'PCの接続準備を停止する' : 'PCの接続を準備する'}</span></button>
        <p className="muted">接続方法を選んだだけでは有効になりません。別の経路がONの場合、準備をONにすると切り替わります。</p>
        <CompactFeedback className="setup-phone-feedback" reserve={['このネットワークをONにすると、登録用QRを利用できます。', '登録の入口を準備中です。利用できない場合は要確認を開いてください。']} role="status">{warning || qrReason}</CompactFeedback>
        {network === 'tailscale' && <details><summary>Tailscaleをまだ用意していない場合</summary><p><a href="https://tailscale.com/download" target="_blank" rel="noreferrer">Tailscale公式サイト</a>からPCとAndroidへ導入し、同じプライベートネットワークに参加してください。</p></details>}
        {network === 'direct' && <p className="sp-recovery-note">接続先をすべて失うと、PCでQRの再登録が必要です。外出中は復旧できない場合があります。</p>}
      </div>}
      {!setup && lanAdapter}
      {!setup && <div key="normal-options" className="sp-normal-options">    <section className="sp-section sp-comments" aria-label="コメント・読み上げの接続案内">
      <div className="sp-comments-columns">
      <section className="sp-comments-column" aria-label={network === 'direct' ? 'Androidで利用する' : 'ブラウザで開く'}>
      <h3>{network === 'direct' ? 'Androidで利用する' : 'ブラウザでコメントを見る'}</h3>
      <div className="sp-url-list">{network === 'direct' ? <p>直接接続はAndroidの共通QR登録から利用してください。</p> : entries.length ? entries.map(entry => <div key={entry.url} className="sp-url"><code>{entry.url}</code><div className="button-row">
        <button type="button" aria-disabled={!selected || !entry.available || busy} onClick={() => { if (selected && entry.available && !busy) void run(() => navigator.clipboard.writeText(entry.url), 'コメント用URLをコピーしました。'); }}>URLをコピー</button>
      </div></div>) : <p>このネットワークをONにすると、利用可能なURLを表示します。</p>}</div>
      {network !== 'direct' && <p className="sp-note">読み上げは、開いた画面の「読み上げを聞く」で聞けます。</p>}
      </section>
      </div>
    </section>
    <section className="sp-audio-quality sp-compact-row" aria-label="読み上げ音声の音質">
      <div><h3>読み上げ音声の音質</h3><p className="sp-note" id="sp-audio-range">AAC目標ビットレート・16〜128・標準64 kbps</p></div>
      <label className="sp-audio-input"><input aria-label="音質（kbps）" aria-describedby="sp-audio-range" type="number" min={16} max={128} value={rate} aria-invalid={!validRate} onChange={event => {
        const value = event.target.value; setBitrate(value);
        if (/^\d+$/u.test(value) && Number(value) >= 16 && Number(value) <= 128) changeAudio({ ...audioSettings, bitrateKbps: Number(value) });
      }} /><span>kbps</span></label>
    </section>
    <section className="sp-compact-row" aria-label="AndroidからのOBS操作の設定">
      <h3>スマホからOBSを操作</h3>
      {navigation && <button type="button" id="sp-obs-settings" className="secondary" onClick={event => navigation.open('obsControl', event.currentTarget)}>OBS操作の設定</button>}
    </section>

</div>}
      {connectionDetails}
      </section>
      {setup && <section className="setup-step-card"><h3><span className="setup-number">2</span>スマホを登録</h3><p>Android版きゃすメイトの登録画面で、PCに表示したQRを読み取ります。</p>{registrationQr}
        <p className="muted">同じQRで複数のスマホを登録できます。QRは配信画面に映さないでください。登録だけではカメラ・マイクの送信は始まりません。</p>
      </section>}
      {setup && <section className="setup-step-card"><h3><span className="setup-number">3</span>使えるか確認</h3><p>登録したAndroidできゃすメイトを開きます。映像・マイクはこのPCで受信を、コメント表示・読み上げはスマホで確認します。</p>
        <InitialSetupPhoneGuide uses={smartphoneUses} helpOpen={phoneHelpOpen} onHelpToggle={(use, open) => setPhoneHelpOpen(previous => previous[use] === open ? previous : { ...previous, [use]: open })} speechControls={<div ref={speechGuideControls} className="setup-phone-speech">
          <p>読み上げ：{mobile.audioAvailable ? '利用可能' : 'PCの読み上げ設定を確認'} ／ 現在ONの経路の音声接続 {mobile.clientCount}台</p>
          <div className="setup-phone-preview-notes"><p>保存済みの声を、このPCでも再生します。</p><strong>スマホにも届けるには</strong><ul><li>PCのコメント読み上げをON</li><li>Androidで読み上げを開始済み</li></ul><p>接続中のほかのスマホにも届きます。</p></div>
          <button type="button" id="setup-phone-speech-preview" className="setup-primary" aria-disabled={Boolean(speechPreviewBlockReason) || speechTesting} aria-busy={speechTesting} aria-describedby="setup-phone-speech-preview-help" onClick={() => {
            if (speechTestPending.current || speechPreviewBlockReason || !previewSpeech) return;
            speechTestPending.current = true; setSpeechTesting(true); setSpeechTestError('');
            void run(async () => { try { await previewSpeech(); } catch (failure) { setSpeechTestError(failure instanceof Error ? failure.message : '試聴できませんでした。読み上げ設定と接続を確認してください。'); throw failure; } }, 'PCで試聴を再生しました。').finally(() => { speechTestPending.current = false; setSpeechTesting(false); });
          }}><span>{speechTesting ? '試聴を準備中…' : '▷ この声を試聴'}</span></button>
          <CompactFeedback id="setup-phone-speech-preview-help" className="setup-phone-speech-help" role="status" tabIndex={0} reserve={Object.values(speechPreviewMessages)}>
            {speechPreviewHelp}
          </CompactFeedback>
        </div>} />
        <div className="setup-phone-device-list">{view.devices.map(device => { const profile = device.profiles[network]; return <article key={device.id}><strong>{device.name}</strong><p>{profile?.registered ? `${networkLabels[network]}で登録済み` : 'この接続方法では未登録'}</p>{smartphoneUses.includes('video') && <><p>PC受信：{smartphoneReceiverState(device, network, view.settings.activeNetwork)} ／ スマホ送信：{profile?.registered && profile.report && !profile.stale ? statusLabels[profile.report.status] : 'スマホ側で確認'}</p><CompactFeedback role="status" reserve={['受信データ：9,007,199,254,740,991 バイト']}>受信データ：{(profile?.registered && selected ? profile.receiver?.receivedBytes ?? 0 : 0).toLocaleString()} バイト</CompactFeedback></>}</article>; })}</div>
        {confirmation}
      </section>}
    </div>
    {!setup && <p className="sp-stop-note">ネットワークOFFはPCの受信のみ停止します。撮影・マイクはスマホで、配信はOBSで停止してください。</p>}
    <dialog ref={obsGuide} id="sp-obs-guide-dialog" className="sp-obs-guide-dialog" aria-labelledby="sp-obs-guide-title"
      onCancel={event => { event.preventDefault(); closeObsGuide(); }} onClose={restoreObsGuideFocus}
      onKeyDown={event => {
        if (event.key !== 'Tab') return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]'));
        const first = controls[0]; const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
      <div className="sp-obs-guide-heading"><h2 id="sp-obs-guide-title">映像をOBSに追加</h2><button ref={obsGuideClose} type="button" className="secondary" autoFocus onClick={closeObsGuide}>閉じる</button></div>
      <div className="sp-obs-guide-body" tabIndex={0} aria-label="OBSへの登録手順">
        <p className="sp-obs-guide-target" aria-label="対象のスマホ"><strong>{obsGuideTarget?.name}</strong></p>
        <p>OBSのメディアソースは端末ごとに初回に追加します。ネットワークを切り替えても同じソースを使えます。</p>
        <ol>
          <li>手順を閉じて、スマホ一覧の「{obsGuideTarget?.name}」の<strong>「OBS入力をコピー」</strong>を押します。</li>
          <li>OBSのソースの<strong>「＋」→「メディアソース」</strong>を選びます。</li>
          <li><strong>「ローカルファイル」をOFF</strong>にし、「入力」へ貼り付けます。入力形式は<strong>「mpegts」</strong>にします。</li>
          <li>ソース名を「きゃすメイト {obsGuideTarget?.name}」などにして配置します。スマホで送信を開始し、OBSで映像・音声を確認します。</li>
        </ol>
        <p>家庭内LAN・Tailscale・直接接続で入力は共通です。配信中はPCアプリを起動しておいてください。</p>
        <p>受信中でもOBSでの表示成功を保証しません。スマホの報告が10秒以上途絶えた場合は状態不明と表示します。</p>
      </div>
    </dialog>
    <dialog ref={dialog} className="sp-qr-dialog" aria-labelledby="sp-qr-title" onCancel={event => { event.preventDefault(); closeQr(); }} onKeyDown={event => { if (event.key === 'Tab') { event.preventDefault(); dialog.current?.querySelector('button')?.focus(); } }}>
      <h2 id="sp-qr-title">{qr?.title ?? 'スマホの接続'}</h2>{qr && <><img src={qr.image} width={420} height={420} alt="スマホ接続用QR" /><p>{qr.features}</p></>}
      <p><strong>QRは配信画面に映さないでください。</strong></p><button type="button" autoFocus onClick={closeQr}>QRを隠す</button>
    </dialog>
  </SettingsCard>;
}
