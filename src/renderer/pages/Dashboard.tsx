import { useCallback, useEffect, useRef, useState } from 'react';
import { connectionKeys, type AppSettings, type SettingsSection, type VoicevoxSpeaker } from '../../shared/types';
import { useApplicationState } from '../api';
import { SmartphonePanel } from '../components/SmartphonePanel';
import { CommentListPanel } from '../components/CommentListPanel';
import { CommentOverlayPanel } from '../components/CommentOverlayPanel';
import { SpeechRecognitionOverlayPanel } from '../components/SpeechRecognitionOverlayPanel';
import { openObsDesignBrowser } from '../obs-style-editor/open-editor';
import { useSuccessNoticeExpiry } from '../use-success-notice-expiry';
import { tailscaleStatusMessage } from '../mobile-speech-status';
import { NextThreadPanel } from '../components/NextThreadPanel';
import { CharacterImage } from '../components/CharacterImage';
import { SpeechRecognitionPanel } from '../components/SpeechRecognitionPanel';
import { ObsControlPanel } from '../components/ObsControlPanel';
import { AiListenerPanel } from '../components/AiListenerPanel';
import { CommentSpeechPanel } from '../components/CommentSpeechPanel';
import { CommentFilterPanel } from '../components/CommentFilterPanel';
import { CommentAcquisitionPanel } from '../components/CommentAcquisitionPanel';
import { ManagementShell, type ManagementWarning } from '../components/ManagementShell';
import { ManagementHome, type ManagementHomeProps } from '../components/ManagementHome';
import { ManagementLive, ObsWorkspaceStatus, SmartphoneWorkspaceStatus } from '../components/ManagementWorkspace';
import { PcStatus } from '../components/PcStatus';
import { ObsUrlsPanel } from '../components/ObsUrlsPanel';
import { ApplicationSettingsPanel } from '../components/ApplicationSettingsPanel';
import { ObsSourceRegistrationDialog, type ObsSourceRegistrationEntry, type ObsSourceRegistrationWarning } from '../components/ObsSourceRegistrationDialog';
import { SettingsCard } from '../components/SettingsCard';
import { TextEffectsPanel } from '../components/TextEffectsPanel';
import { messages, connectionLabel, statusLabels } from '../messages';
import { useAutoSavingSettings } from '../use-auto-saving-settings';

import { useCommentSourceActions } from '../use-comment-source-actions';
import { useCommentFilterEditing } from '../use-comment-filter-editing';
import { defaultManagementTheme, type ManagementThemeId } from '../../shared/management-theme';
import { defaultManagementTextSize, type ManagementTextSizeId } from '../../shared/management-text-size';
import { useManagementPreference } from '../use-management-preference';
import type { InitialSetupCommand } from '../../shared/initial-setup';
import { SetupCharacter } from '../components/SetupCharacter';
import { setupValidationEditors } from '../management-navigation';

type Notice = { message: string; tone: 'success' | 'error'; owner?: 'applicationTheme' | 'applicationTextSize' };
type ShortcutOperation = 'commentSpeech' | 'aiListener' | 'speechRecognition' | 'commentListWindow' | 'characterWindow' | 'settingsDirectory';

export function Dashboard() {
  const api = useApplicationState(true);
  const [setupVoices, setSetupVoices] = useState<VoicevoxSpeaker[]>([]);
  const [setupBusy, setSetupBusy] = useState(false);
  const setupPending = useRef(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const pendingShortcuts = useRef(new Set<ShortcutOperation>());
  const [shortcutsBusy, setShortcutsBusy] = useState<Partial<Record<ShortcutOperation, boolean>>>({});
  const [obsRegistrationRequest, setObsRegistrationRequest] = useState<ObsSourceRegistrationEntry | null>(null);
  const [obsRegistrationFeedback, setObsRegistrationFeedback] = useState<ObsSourceRegistrationWarning | undefined>(undefined);
  const [smartphoneRegistrationBlocked, setSmartphoneRegistrationBlocked] = useState('');
  const testNotice = useRef<string | null>(null);
  const testOperation = api.snapshot?.obsSourceTest?.current;
  useEffect(() => {
    if (!api.snapshot) return;
    const key = testOperation ? testOperation.id + ':' + testOperation.phase : '';
    if (testNotice.current === null) { testNotice.current = key; return; }
    if (key === testNotice.current) return;
    testNotice.current = key;
    if (testOperation && (testOperation.phase === 'sending' || testOperation.needsAttention && ['complete', 'unknown'].includes(testOperation.phase)))
      setNotice({ message: testOperation.message, tone: testOperation.needsAttention ? 'error' : 'success' });
  }, [api.snapshot, testOperation]);

  const reportError = useCallback((message: string) => {
    setNotice({ message, tone: 'error' });
  }, []);
  const reportApplicationError = useCallback((message: string, operation: 'theme' | 'textSize' | 'port') => {
    setNotice({ message, tone: 'error', owner: operation === 'theme' ? 'applicationTheme' : operation === 'textSize' ? 'applicationTextSize' : undefined });
  }, []);
  const savedTheme = api.snapshot?.settings.application.managementTheme ?? defaultManagementTheme;
  const savedTextSize = api.snapshot?.settings.application.managementTextSize ?? defaultManagementTextSize;
  const { value:managementTheme, edit:themeEdit, choose:chooseTheme, recover:recoverTheme, finish:finishThemeSave } = useManagementPreference(savedTheme, api.snapshot?.settingsRevision);
  const { value:managementTextSize, edit:textSizeEdit, choose:chooseTextSize, recover:recoverTextSize, finish:finishTextSizeSave } = useManagementPreference(savedTextSize, api.snapshot?.settingsRevision);
  const resolveThemeError = useCallback((id: ManagementThemeId) => {
    recoverTheme(id);
    setNotice(current => current?.owner === 'applicationTheme' ? null : current);
  }, [recoverTheme]);
  const resolveTextSizeError = useCallback((id: ManagementTextSizeId) => {
    recoverTextSize(id);
    setNotice(current => current?.owner === 'applicationTextSize' ? null : current);
  }, [recoverTextSize]);
  const queuedPortEdit = useRef<number | undefined>(undefined);
  const latestApplication = useRef({ value: api.snapshot?.settings.application, revision: api.snapshot?.settingsRevision ?? -1 });
  useEffect(() => {
    if (api.snapshot && api.snapshot.settingsRevision >= latestApplication.current.revision) {
      latestApplication.current = { value: api.snapshot.settings.application, revision: api.snapshot.settingsRevision };
    }
  }, [api.snapshot]);
  const updateSettings = api.updateSettings;
  const commentFontEdit = useRef<{ value: number } | undefined>(undefined);
  const saveSettings = useCallback(async (section: SettingsSection, value: AppSettings[SettingsSection]) => {
    // Application saves can wait behind another section. A queued port edit
    // omits both appearance fields. Keep its intent when the queue coalesces a
    // later appearance choice, and resolve untouched fields at dispatch.
    const payload = section === 'application' && 'port' in value
      ? { ...latestApplication.current.value,
          port: value.managementTheme === undefined && value.managementTextSize === undefined ? value.port : queuedPortEdit.current ?? latestApplication.current.value?.port ?? value.port,
          managementTheme: value.managementTheme ?? themeEdit.current?.id ?? latestApplication.current.value?.managementTheme ?? defaultManagementTheme,
          managementTextSize: value.managementTextSize ?? textSizeEdit.current?.id ?? latestApplication.current.value?.managementTextSize ?? defaultManagementTextSize }
      : value;
    if (section === 'application') queuedPortEdit.current = undefined;
    const fontEdit = section === 'commentOverlay' && 'mode' in value && 'fontSizePx' in value &&
      (value.design?.style.fontSize ?? value.fontSizePx) === commentFontEdit.current?.value ? commentFontEdit.current : undefined;
    const result = fontEdit ? await updateSettings(section, payload, { commentFontSizePx: fontEdit.value }) : await updateSettings(section, payload);
    if (fontEdit && commentFontEdit.current === fontEdit) commentFontEdit.current = undefined;
    if (result?.snapshot && result.snapshot.settingsRevision >= latestApplication.current.revision) {
      latestApplication.current = { value: result.snapshot.settings.application, revision: result.snapshot.settingsRevision };
    }
    return result;
  }, [updateSettings, themeEdit, textSizeEdit]);
  const saving = useAutoSavingSettings(
    api.snapshot?.settings,
    api.snapshot?.settingsRevision,
    saveSettings,
    reportError,
  );

  const { draft, changeSection, stageSection, saveSectionNow, hasPendingSave, saveErrors } = saving;
  const finishAppearanceSave = () => {
    finishThemeSave(managementTheme, latestApplication.current.value?.managementTheme ?? defaultManagementTheme);
    finishTextSizeSave(managementTextSize, latestApplication.current.value?.managementTextSize ?? defaultManagementTextSize);
  };
  const sources = useCommentSourceActions({ saving, savedSources: api.snapshot?.settings.sources, api, onNotice: setNotice });
  const filter = useCommentFilterEditing({ saving, saved: api.snapshot?.settings.commentFilter, clearNotice: () => setNotice(null) });

  useSuccessNoticeExpiry(notice, setNotice);

  const baseUrl = location.origin;
  if (!api.snapshot || !draft) return <main className="center-message startup-state"><div>{api.error ? <><h1>起動状態を読み込めませんでした</h1><p>きゃすメイトが起動していることを確認して、再読み込みしてください。</p><button type="button" onClick={() => location.reload()}>再読み込み</button><details><summary>技術詳細</summary><p>{api.error}</p></details></> : messages.loading}</div></main>;
  const snapshot = api.snapshot;

  const run = async (operation: () => Promise<unknown>, success: string) => {
    try {
      setNotice(null);
      await operation();
      setNotice({ message: success, tone: 'success' });
    } catch (error) {
      setNotice({
        message: error instanceof Error ? error.message : '操作に失敗しました。',
        tone: 'error',
      });
    }
  };
  const withShortcutLock = async (key: ShortcutOperation, operation: () => Promise<unknown>) => {
    if (pendingShortcuts.current.has(key)) return;
    pendingShortcuts.current.add(key);
    setShortcutsBusy(current => ({ ...current, [key]: true }));
    try { return await operation(); }
    finally {
      pendingShortcuts.current.delete(key);
      setShortcutsBusy(current => ({ ...current, [key]: false }));
    }
  };
  const runShortcut = async (key: ShortcutOperation, operation: () => Promise<unknown>, success: string) => {
    if (pendingShortcuts.current.has(key)) return;
    await run(() => withShortcutLock(key, operation), success);
  };
  const saveDeferred = <K extends SettingsSection>(section: K, value: AppSettings[K]) => {
    setNotice(null);
    changeSection(section, value);
  };
  const saveImmediate = <K extends SettingsSection>(section: K, value: AppSettings[K]) => {
    setNotice(null);
    return saveSectionNow(section, value);
  };
  const saveNextThread = (
    value: AppSettings['sources']['shitaraba']['nextThread'],
    immediate = false,
  ) => {
    const nextSources = {
      ...draft.sources,
      shitaraba: { ...draft.sources.shitaraba, nextThread: value },
    };
    if (immediate) return sources.save(nextSources);
    sources.change(nextSources);
    return Promise.resolve();
  };
  const warnings: ManagementWarning[] = [];
  const registrationOperation = snapshot.obsSourceRegistration?.lastOperation;
  const registrationOperations = [...(snapshot.obsSourceRegistration?.unfinishedOperations ?? []),
    ...(registrationOperation && ['failed', 'incomplete', 'unknown'].includes(registrationOperation.status) ? [registrationOperation] : [])]
    .filter((value, index, list) => list.findIndex(other => other.id === value.id) === index);
  const registrationRecoveries: ObsSourceRegistrationWarning[] = registrationOperations.map(operation => ({ key: operation.id, target: operation.target, title: operation.title,
    retryOperationId: operation.status === 'incomplete' || operation.status === 'unknown' ? operation.id : undefined,
    message: `${operation.title}・${operation.sceneName}${registrationOperations.some(other => other.id !== operation.id && other.title === operation.title && other.collection === operation.collection && other.sceneName === operation.sceneName) ? `（${operation.sceneUuid}）` : ''}：${operation.message}` }));
  if (obsRegistrationFeedback && !registrationOperations.some(operation => JSON.stringify(operation.target) === JSON.stringify(obsRegistrationFeedback.target)))
    registrationRecoveries.push(obsRegistrationFeedback);
  for (const operation of snapshot.obsSourceTest?.warnings ?? []) registrationRecoveries.push({ key: 'test-' + operation.id,
    target: operation.target, title: operation.title, message: `${operation.title}・表示テスト：${operation.message}` });
  for (const recovery of registrationRecoveries) {
    const owner = recovery.target.kind === 'smartphone' ? 'smartphone' : 'urls';
    warnings.push({ id: owner, target: `obs-registration-recovery-${encodeURIComponent(recovery.key)}`, key: recovery.key, message: recovery.message,
      onSelect: entry => setObsRegistrationRequest({ target: recovery.target, title: recovery.title, entry, retryOperationId: recovery.retryOperationId }) });
  }
  for (const source of connectionKeys) {
    const status = snapshot.sourceStatuses[source];
    if (status.state === 'error' || status.state === 'reconnecting') warnings.push({ id: 'sources', message: connectionLabel(source, status) + '：' + statusLabels[status.state] + '。接続を確認', target: 'source-' + source });
  }
  if (snapshot.commentSpeech.warning) warnings.push({ id: 'commentSpeech', message: snapshot.commentSpeech.warning });
  if (snapshot.speechRecognition.warning) warnings.push({ id: 'speechRecognition', message: snapshot.speechRecognition.warning });
  if (snapshot.mobileSpeech.warning) warnings.push({ id: 'smartphone', message: snapshot.mobileSpeech.warning });
  if (snapshot.character.assetWarning) warnings.push({ id: 'character', message: snapshot.character.assetWarning });
  if (snapshot.smartphone?.warning) warnings.push({ id: 'smartphone', message: snapshot.smartphone.warning });
  if (snapshot.obsControl?.error) warnings.push({ id: 'obsControl', key: 'connection', message: snapshot.obsControl.error });
  if (snapshot.obsControl?.publication.warning) warnings.push({ id: 'obsControl', key: 'publication', message: snapshot.obsControl.publication.warning });
  if (snapshot.smartphone?.settings.activeNetwork === 'lan' && !snapshot.mobileSpeech.urls.some(entry => entry.kind === 'lan')) warnings.push({ id: 'smartphone', key: 'lan', message: 'LAN用の接続先がありません。「スマホ連携」の設定を確認してください。' });
  if (snapshot.smartphone?.settings.activeNetwork === 'tailscale' && snapshot.mobileSpeech.tailscaleStatus !== 'ready') warnings.push({ id: 'smartphone', key: 'tailscale', message: tailscaleStatusMessage(snapshot.mobileSpeech.tailscaleStatus) });
  for (const entry of snapshot.mobileSpeech.urls) {
    if (!entry.available && (entry.kind === 'lan' ? draft.mobileSpeech.lanEnabled : draft.mobileSpeech.tailscaleEnabled)) {
      warnings.push({ id: 'smartphone', key: entry.url, message: `${entry.kind === 'lan' ? 'LAN' : 'Tailscale'}用URLを利用できません。ネットワークとファイアウォールを確認してください。 ${entry.url}` });
    }
  }
  if (snapshot.aiListener?.status === 'attention') warnings.push({ id: 'aiListener', message: '手動再開待ち：' + snapshot.aiListener.message });
  if (snapshot.obsControl?.confirmation) warnings.push({ id: 'obsControl', message: 'OBS操作の確認待ち・取消はこちら' });
  const activities: ManagementWarning[] = snapshot.speechRecognition.previewActive ? [{ id: 'speechRecognition', message: '音声認識プレビュー実行中・終了はこちら' }] : [];
  const homeProps: ManagementHomeProps = {
    snapshot, draft, sourcesBusy: sources.operation !== null, shitarabaStartBlocked: sources.intervalInvalid, operationsBusy: shortcutsBusy,
    toggleSource: sources.toggle,
    toggleSpeech: enabled => runShortcut('commentSpeech', () => saveImmediate('commentSpeech', { ...draft.commentSpeech, enabled }), '読み上げ設定を変更しました。'),
    toggleAi: enabled => runShortcut('aiListener', async () => { if (enabled) await saveSectionNow('aiListener', draft.aiListener); await api.mutate('/api/ai-listener/' + (enabled ? 'start' : 'stop')); }, 'AIリスナーへの要求を反映しました。'),
    toggleRecognition: enabled => runShortcut('speechRecognition', () => api.mutate('/api/speech-recognition/enabled', 'PUT', { enabled }), '音声認識設定を変更しました。'),
  };
  const previewSpeech = () => hasPendingSave('commentSpeech')
    ? Promise.reject(new Error('読み上げ設定の保存を完了してから試聴してください。'))
    : api.mutate('/api/speech/preview');
  const toggleCommentListWindow = () => runShortcut('commentListWindow', () => api.mutate('/api/windows/comment-list/toggle'), snapshot.settings.application.commentListWindowVisible ? messages.commentListWindowHidden : messages.commentListWindowShown);
  const windows = (keepFocus = false) => <div className="window-controls" role="group" aria-label={messages.windowControls}>
<h2>ウィンドウを開く</h2>
<div className="window-control"><span>コメント一覧・{snapshot.settings.application.commentListWindowVisible ? '表示中' : '閉じている'}</span><button type="button" className="secondary" aria-pressed={snapshot.settings.application.commentListWindowVisible} disabled={!keepFocus && shortcutsBusy.commentListWindow} aria-disabled={keepFocus ? Boolean(shortcutsBusy.commentListWindow) : undefined} onClick={() => void toggleCommentListWindow()}>{snapshot.settings.application.commentListWindowVisible ? messages.hideIndependentWindow : messages.showIndependentWindow}</button></div>
<div className="window-control"><span>キャラクター・{snapshot.settings.character.windowVisible ? '表示中' : '閉じている'}</span><button type="button" className="secondary" aria-pressed={snapshot.settings.character.windowVisible} disabled={!keepFocus && shortcutsBusy.characterWindow} aria-disabled={keepFocus ? Boolean(shortcutsBusy.characterWindow) : undefined} onClick={() => void runShortcut('characterWindow', () => api.mutate('/api/windows/character/toggle'), snapshot.settings.character.windowVisible ? messages.characterWindowHidden : messages.characterWindowShown)}>{snapshot.settings.character.windowVisible ? messages.hideIndependentWindow : messages.showIndependentWindow}</button></div>
</div>;
  return <ManagementShell theme={managementTheme} textSize={managementTextSize} connected={api.connected} pcStatus={<PcStatus />} warnings={warnings} activities={activities}
    onInitialSetupInterrupted={() => setNotice({ message: '続きは「設定 → アプリ設定」から再開できます。', tone: 'success' })}
    initialSetup={snapshot.initialSetup ? { view: snapshot.initialSetup, snapshot, pending: setupBusy, speechVoices: setupVoices,
      settingsPending: position => {
        const sections: Partial<Record<string, SettingsSection[]>> = { sources: ['sources'], commentSpeech: ['commentSpeech'], smartphone: ['mobileSpeech'], aiListener: ['aiListener'],
          textEffects: ['textEffects'], character: ['character'], commentOverlay: ['commentOverlay'], speechRecognitionOverlay: ['speechRecognitionOverlay'] };
        const checked = setupValidationEditors(snapshot.initialSetup!, position).flatMap(editor => sections[editor] ?? []);
        return checked.some(key => hasPendingSave(key));
      },
      onObsSource: setObsRegistrationRequest,
      onCharacterAssetError: api.reportCharacterAssetError,
      command: async (command: InitialSetupCommand) => {
        if (setupPending.current) throw new Error('進行を保存しています。');
        setupPending.current = true; setSetupBusy(true);
        try {
          const result = await api.mutate('/api/management/initial-setup', 'POST', command);
          if (command.action === 'finish') setNotice(null);
          return result;
        }
        catch (error) { reportError(error instanceof Error ? error.message : '初回設定を保存できませんでした。'); throw error; }
        finally { setupPending.current = false; setSetupBusy(false); }
      } } : undefined}
    connectionError={api.connected ? undefined : messages.backendDisconnected}
    settingsWarning={snapshot.warning}
    updateNotices={snapshot.updateNotices?.map(notice => ({ key: notice.id, message: notice.message,
      owner: notice.source === 'settings' ? undefined : notice.source,
      onAcknowledge: () => run(() => api.mutate('/api/management/update-notices/acknowledge', 'POST', { id: notice.id }), '更新案内を確認済みにしました。'),
    }))}
    operationNotice={notice ?? (api.error ? { message: api.error, tone: 'error' } : undefined)}
    windows={windows()}
    smartphoneStatus={<SmartphoneWorkspaceStatus snapshot={snapshot} />} obsStatus={<ObsWorkspaceStatus snapshot={snapshot} />}
    live={<ManagementLive homeProps={homeProps} windows={windows(true)} commentWindow={{ visible: snapshot.settings.application.commentListWindowVisible, busy: shortcutsBusy.commentListWindow, toggle: toggleCommentListWindow }} />}
    home={<ManagementHome {...homeProps} />}>
      <CommentAcquisitionPanel settings={draft.sources} savedSettings={snapshot.settings.sources} statuses={snapshot.sourceStatuses}
        operation={sources.operation} operationError={notice?.tone === 'error' && notice.message === sources.error ? sources.error : undefined} saveError={saveErrors.sources}
        onIntervalInvalidChange={sources.setIntervalInvalid} onChange={sources.change}
        onToggle={sources.toggle} onReconnect={sources.reconnect}
        onStartAll={sources.startAll} onStopAll={sources.stopAll} onAutoConnect={sources.setAutoConnect} />

      <CommentSpeechPanel settings={draft.commentSpeech} savedEnabled={snapshot.settings.commentSpeech.enabled} state={snapshot.commentSpeech} saveError={saveErrors.commentSpeech} externalBusy={shortcutsBusy.commentSpeech}
        onChange={value => saveDeferred('commentSpeech', value)} onSave={value => withShortcutLock('commentSpeech', () => saveImmediate('commentSpeech', value))}
        listVoices={api.listSpeechVoices} onVoicesLoaded={setSetupVoices} selectEngine={async () => {
          const result = await api.mutate('/api/speech/engine/select');
          return Boolean(result && 'selected' in result && result.selected === true);
        }}
        preview={previewSpeech} onSuccess={message => setNotice({ message, tone: 'success' })} />

      <SpeechRecognitionPanel
        externalBusy={shortcutsBusy.speechRecognition}
        settings={snapshot.settings.speechRecognition}
        state={snapshot.speechRecognition}
        updateSettings={(value) => withShortcutLock('speechRecognition', () => api.updateSettings('speechRecognition', value))}
        mutate={(...args) => ['/api/speech-recognition/enabled', '/api/speech-recognition/settings'].includes(args[0])
          ? withShortcutLock('speechRecognition', () => api.mutate(...args)) : api.mutate(...args)}
        onNotice={(message, tone) => setNotice({ message, tone })}
        onClearNotice={() => setNotice(null)}
      />

      {snapshot.obsControl && <ObsControlPanel
        view={snapshot.obsControl}
        configure={(value) => api.mutate('/api/obs-control/configure', 'POST', value)}
        retry={() => api.mutate('/api/obs-control/retry')}
        cancel={() => api.mutate('/api/obs-control/cancel')}
        onSuccess={message => setNotice({ message, tone: 'success' })}
      />}

      {snapshot.aiListener && <AiListenerPanel savedSettings={snapshot.settings.aiListener} settings={draft.aiListener} view={snapshot.aiListener} runtimeBusy={shortcutsBusy.aiListener}
        onSuccess={message => setNotice({ message, tone: 'success' })}
        change={value => changeSection('aiListener', value)} saveError={saveErrors.aiListener}
        mutate={async (path, method, body) => {
          const operation = async () => {
            if (['/api/ai-listener/start', '/api/ai-listener/test-api', '/api/ai-listener/visual/capture'].includes(path)) await saveSectionNow('aiListener', draft.aiListener);
            return api.mutate(path, method, body);
          };
          return ['/api/ai-listener/start', '/api/ai-listener/stop', '/api/ai-listener/resume', '/api/ai-listener/test-api'].includes(path)
            ? withShortcutLock('aiListener', operation) : operation();
        }} />}

      <CommentFilterPanel settings={draft.commentFilter} saveError={saveErrors.commentFilter}
        onChange={filter.change} onToggleAsciiArt={filter.toggleAsciiArt} />

      <TextEffectsPanel
        saveError={saveErrors.textEffects}
        value={draft.textEffects}
        saveDeferred={(value) => saveDeferred('textEffects', value)}
        saveImmediate={(value) => saveImmediate('textEffects', value)}
        testRule={async (ruleId) => {
          setNotice(null);
          await api.mutate(`/api/text-effects/rules/${encodeURIComponent(ruleId)}/test`);
          setNotice({ message: '文字演出をOBSへ送信しました。', tone: 'success' });
        }}
      />

      <NextThreadPanel settings={draft.sources.shitaraba.nextThread} state={snapshot.shitarabaNextThread}
        threadUrl={snapshot.settings.sources.shitaraba.threadUrl} saveError={saveErrors.sources}
        synchronized={!hasPendingSave('sources') && draft.sources.shitaraba.threadUrl === snapshot.settings.sources.shitaraba.threadUrl &&
          JSON.stringify(draft.sources.shitaraba.nextThread) === JSON.stringify(snapshot.settings.sources.shitaraba.nextThread)}
        onChange={value => { void saveNextThread(value); }} onSave={value => saveNextThread(value, true)}
        onCreate={() => { setNotice(null); return api.mutate('/api/shitaraba/next-thread/create'); }}
        onResolve={value => { setNotice(null); return api.mutate('/api/shitaraba/next-thread/resolve', 'POST', value); }}
        onSuccess={message => setNotice({ message, tone: 'success' })} />
      <CommentOverlayPanel settings={draft.commentOverlay}
        onFontSizeChange={value => { commentFontEdit.current = { value: value.design?.style.fontSize ?? value.fontSizePx }; saveDeferred('commentOverlay', value); }}
        onEditDesign={() => navigator.userAgent.includes('Electron') ? api.mutate('/api/windows/obs-design/show', 'POST', { target: 'comments' }) : openObsDesignBrowser('comments')}
        speechEnabled={snapshot.settings.commentSpeech.enabled}
        saveError={saveErrors.commentOverlay} onOperationStart={() => setNotice(null)}
        onChange={value => saveDeferred('commentOverlay', value)}
        onSave={value => saveImmediate('commentOverlay', value)} />
      <SpeechRecognitionOverlayPanel settings={draft.speechRecognitionOverlay} saveError={saveErrors.speechRecognitionOverlay}
        onEditDesign={() => navigator.userAgent.includes('Electron') ? api.mutate('/api/windows/obs-design/show', 'POST', { target: 'speech' }) : openObsDesignBrowser('speech')}
        onChange={value => saveDeferred('speechRecognitionOverlay', value)} onSave={value => saveImmediate('speechRecognitionOverlay', value)} onOperationStart={() => setNotice(null)}/>
<SettingsCard cardId="character" saveError={saveErrors.character} title="キャラクター" eyebrow="CHARACTER" summary={<><p className="muted">独立ウィンドウ {snapshot.settings.character.windowVisible ? '表示中' : '非表示'}</p></>} warning={snapshot.character.assetWarning}>
          <SetupCharacter snapshot={snapshot} upload={api.uploadAsset} onError={reportError} saveMotion={api.saveCharacterMotion} saveError={saveErrors.character} />
          <div className="character-normal-controls">
          <details><summary>キャラクターのプレビューを表示</summary><div className="character-preview"><CharacterImage mouthShape={snapshot.character.mouthShape} settings={snapshot.settings.character} motion={snapshot.character.motion} motionStartedAtMs={snapshot.character.motionStartedAtMs} alt="キャラクタープレビュー" onOpenAssetError={api.reportCharacterAssetError} /></div></details>
          <button id="character-settings-open" type="button" onClick={() => {
            if (navigator.userAgent.includes('Electron')) void run(() => api.mutate('/api/windows/character-settings/show'), '簡易キャラクター設定を開きました。');
            else window.open('/character/simple/settings', '_blank', 'noopener');
          }}>画像・動きを設定</button>

          <label className="check"><input type="checkbox" checked={draft.character.alwaysOnTop} onChange={(e) => saveImmediate('character', { ...draft.character, alwaysOnTop: e.target.checked })} />常に最前面</label>
          <label className="check"><input type="checkbox" checked={draft.character.clickThrough} onChange={(e) => saveImmediate('character', { ...draft.character, clickThrough: e.target.checked })} />クリック透過（キャラクター越しに背後の画面を操作）</label>

          </div>
      </SettingsCard>

      {snapshot.smartphone && <SmartphonePanel view={snapshot.smartphone} mobile={snapshot.mobileSpeech} audioSettings={draft.mobileSpeech}
        onRegisterSource={setObsRegistrationRequest} onRegistrationBlockedChange={setSmartphoneRegistrationBlocked}
        registrationWarning={registrationRecoveries.find(value => value.target.kind === 'smartphone')?.message}
        saveError={saveErrors.mobileSpeech} changeAudio={value => saveDeferred('mobileSpeech', value)}
        previewSpeech={previewSpeech} speechSettingsPending={hasPendingSave('commentSpeech')}
        configure={value => api.mutate('/api/smartphone/configure', 'POST', value)}
        deviceAction={(id, action, name) => action === 'add' ? api.mutate('/api/smartphone/devices', 'POST', { name })
          : api.mutate('/api/smartphone/devices/' + encodeURIComponent(id!) + (action === 'regenerate' ? '/regenerate' : ''),
            action === 'rename' ? 'PATCH' : action === 'delete' ? 'DELETE' : 'POST', action === 'rename' ? { name } : undefined)}
        invitation={api.smartphoneInvitation} obsInput={api.smartphoneObsInput} directAction={api.smartphoneDirectAction} listAdapters={api.smartphoneAdapters} listLanAdapters={api.smartphoneLanAdapters} onSuccess={message => setNotice({ message, tone: 'success' })} />}
      <CommentListPanel settings={draft.commentList} saveError={saveErrors.commentList}
        windowOperationBusy={shortcutsBusy.commentListWindow}
        windowVisible={snapshot.settings.application.commentListWindowVisible} commentsUrl={`${baseUrl}/comments`}
        onChange={value => saveDeferred('commentList', value)} onSave={value => saveImmediate('commentList', value)}
        onToggleWindow={() => withShortcutLock('commentListWindow', () => { setNotice(null); return api.mutate('/api/windows/comment-list/toggle'); })} onError={reportError}
        onSuccess={message => setNotice({ message, tone: 'success' })} />

      <ObsUrlsPanel baseUrl={baseUrl}
        onRegisterSource={setObsRegistrationRequest} registrationWarning={registrationRecoveries.find(value => value.target.kind === 'overlay')?.message}
        onOperationStart={() => setNotice(null)} onError={reportError}
        onSuccess={message => setNotice({ message, tone: 'success' })} />
      <ApplicationSettingsPanel baseUrl={baseUrl} port={snapshot.settings.application.port} theme={managementTheme} savedTheme={savedTheme}
        settingsDirectoryBusy={Boolean(shortcutsBusy.settingsDirectory)}
        onOpenSettingsDirectory={() => void runShortcut('settingsDirectory', () => api.mutate('/api/application/settings-directory/open'), '設定の保存先を開きました。')}
        textSize={managementTextSize} savedTextSize={savedTextSize}
        onSaveTheme={async value => {
          chooseTheme(value);
          await saveImmediate('application', { ...snapshot.settings.application, managementTheme: value, managementTextSize:undefined });
          finishThemeSave(value, latestApplication.current.value?.managementTheme ?? defaultManagementTheme);
          finishTextSizeSave(managementTextSize, latestApplication.current.value?.managementTextSize ?? defaultManagementTextSize);
        }}
        onSaveTextSize={async value => {
          chooseTextSize(value);
          await saveImmediate('application', { ...snapshot.settings.application, managementTheme:undefined, managementTextSize:value });
          finishTextSizeSave(value, latestApplication.current.value?.managementTextSize ?? defaultManagementTextSize);
          finishThemeSave(managementTheme, latestApplication.current.value?.managementTheme ?? defaultManagementTheme);
        }}
        onPortEdit={() => { queuedPortEdit.current = undefined; stageSection('application', draft.application); }}
        onSavePort={async port => {
          queuedPortEdit.current = port;
          await saveImmediate('application', { ...snapshot.settings.application, managementTheme: undefined, managementTextSize:undefined, port });
          finishAppearanceSave();
        }}
        onOperationStart={() => setNotice(null)} onError={reportApplicationError} onThemeRecovered={resolveThemeError} onTextSizeRecovered={resolveTextSizeError}
        onSuccess={message => setNotice({ message, tone: 'success' })} />
      <ObsSourceRegistrationDialog smartphoneObsInput={api.connected ? api.smartphoneObsInput : undefined} request={obsRegistrationRequest} onOpen={setObsRegistrationRequest} onClose={() => setObsRegistrationRequest(null)}
        state={snapshot.obsSourceRegistration} obs={snapshot.obsControl} smartphone={snapshot.smartphone} smartphoneBlockedReason={smartphoneRegistrationBlocked}
        baseUrl={baseUrl} recoveries={registrationRecoveries} context={api.obsSourceContext} add={api.obsSourceAdd}
        contextRevision={api.obsSourceContextRevision} testState={snapshot.obsSourceTest} testContext={api.obsTestContext} testAction={api.obsTestAction}
        onTestNotice={(message, error) => setNotice({ message, tone: error ? 'error' : 'success' })}
        onCopyStart={() => setNotice(null)} onCopyNotice={(message, error) => setNotice({ message, tone: error ? 'error' : 'success' })}
        onStart={() => { setNotice(null); setObsRegistrationFeedback(undefined); }}
        onNotice={(message, tone, target, title) => {
          const value = tone === 'error' ? `${title}：${message}` : message;
          setNotice(tone === 'success' ? { message: value, tone } : null);
          setObsRegistrationFeedback(tone === 'error' ? { key: 'feedback-' + JSON.stringify(target), target, title, message: value } : undefined);
        }} />
    </ManagementShell>;
}
