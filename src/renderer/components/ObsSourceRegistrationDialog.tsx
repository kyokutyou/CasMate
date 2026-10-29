import { useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { obsOverlayDefinitions, type ObsSourceAddRequest, type ObsSourceContext, type ObsSourceOperation, type ObsSourceRegistrationState, type ObsSourceTarget } from '../../shared/obs-source-registration';
import type { ObsControlView } from '../../shared/obs-control';
import type { SmartphoneView } from '../../shared/smartphone';
import { ManagementNavigation, type ManagementPage } from '../management-navigation';
import './obs-source-registration-dialog.css';
import { ObsSourceTestControls, type ObsSourceTestControlsProps } from './ObsSourceTestControls';

export interface ObsSourceRegistrationEntry {
  target: ObsSourceTarget;
  title: string;
  entry: HTMLElement;
  page?: ManagementPage;
  initialSetup?: boolean;
  blockedReason?: string;
  retryOperationId?: string;
}
export interface ObsSourceRegistrationWarning {
  key: string;
  target: ObsSourceTarget;
  title: string;
  message: string;
  retryOperationId?: string;
}
interface Props {
  smartphoneObsInput?(deviceId: string): Promise<string>;
  contextRevision?: number;
  testState?: ObsSourceTestControlsProps['state'];
  testContext?: ObsSourceTestControlsProps['context'];
  testAction?: ObsSourceTestControlsProps['action'];
  onTestNotice?: (message: string, error: boolean) => void;
  onCopyNotice(message: string, error: boolean): void;
  onCopyStart(): void;
  request: ObsSourceRegistrationEntry | null;
  state?: ObsSourceRegistrationState;
  obs?: ObsControlView;
  smartphone?: SmartphoneView;
  smartphoneBlockedReason?: string;
  baseUrl: string;
  recoveries?: ObsSourceRegistrationWarning[];
  context(target: ObsSourceTarget): Promise<ObsSourceContext>;
  add(request: ObsSourceAddRequest): Promise<ObsSourceOperation | null>;
  onOpen(request: ObsSourceRegistrationEntry): void;
  onClose(): void;
  onStart(): void;
  onNotice(message: string, tone: 'success' | 'error', target: ObsSourceTarget, title: string): void;
}

const operationLabels = { running: '処理中', succeeded: '登録設定を確認済み', failed: '要確認・失敗', incomplete: '要確認・未完了', unknown: '要確認・結果不明' };
const phaseLabels = { checking: '登録先を確認しています', creatingInput: 'ソースを作成しています', addingItem: 'シーンに追加しています', configuring: '初期配置を設定しています', verifying: '登録設定を読み戻して確認しています', complete: '確認が完了しました' };
const keyOf = (target: ObsSourceTarget) => JSON.stringify(target);
const ownerOf = (target: ObsSourceTarget) => target.kind === 'smartphone' ? 'smartphone' : 'urls';
const needsRecovery = (operation: ObsSourceOperation) => operation.status === 'failed' || operation.status === 'incomplete' || operation.status === 'unknown';
const canResume = (operation: ObsSourceOperation) => operation.status === 'incomplete' || operation.status === 'unknown';
const missingResultMessage = '前回のOBS登録の最終結果を受信できませんでした。閉じて登録対象を開き直し、OBS側と登録設定を再確認してください。';

function StatusIcon({ warning, complete }: { warning: boolean; complete: boolean }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {warning ? <><path d="m12 3 10 18H2Z"/><path d="M12 9v5M12 17h.01"/></> : <><circle cx="12" cy="12" r="9"/>{complete ? <path d="m8 12 3 3 5-6"/> : <path d="M12 7v5l3 2"/>}</>}
  </svg>;
}

function targetBlocked(request: ObsSourceRegistrationEntry | null, smartphone?: SmartphoneView): string {
  if (!request) return '';
  if (request.blockedReason) return request.blockedReason;
  if (request.target.kind !== 'smartphone') return '';
  if (!smartphone?.available) return 'スマホ連携を利用できません。スマホ連携の要確認を確認してください。';
  const { deviceId } = request.target;
  const device = smartphone.devices.find(value => value.id === deviceId);
  if (!device) return '対象のスマホ登録がありません。スマホを登録してから追加してください。';
  if (!device.obsLocalPort) return '端末共通のOBS入力を準備中です。入力の割当後に追加してください。';
  return '';
}

export function ObsSourceRegistrationDialog({ request, state, obs, smartphone, smartphoneBlockedReason, smartphoneObsInput, baseUrl, recoveries = [], context, contextRevision = 0, add, onOpen, onClose, onStart, onNotice, testState, testContext, testAction, onTestNotice, onCopyNotice, onCopyStart }: Props) {
  const navigation = useContext(ManagementNavigation);
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const latestRequest = useRef(request);
  const contextVersion = useRef(0);
  const pending = useRef(false);
  const callbacks = useRef({ context, add, onOpen, onClose, onStart, onNotice });
  const [loaded, setLoaded] = useState<{ request: ObsSourceRegistrationEntry; value: ObsSourceContext; revision: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [contextError, setContextError] = useState('');
  const [inputUuid, setInputUuid] = useState('');
  const [selectedUnfinished, setSelectedUnfinished] = useState<{ request: ObsSourceRegistrationEntry; id: string } | null>(null);
  const [contextRefreshError, setContextRefreshError] = useState('');
  const [contextRefreshWarning, setContextRefreshWarning] = useState('');
  const [inputSelectionRequired, setInputSelectionRequired] = useState(false);
  const [sourceSelectFocused, setSourceSelectFocused] = useState(false);
  const [recoverySelectFocused, setRecoverySelectFocused] = useState(false);
  const [connectionFocused, setConnectionFocused] = useState(false);
  const [copyBusy, setCopyBusy] = useState(false);
  const copyPending = useRef(false);
  const recoverySlots = useRef<Partial<Record<'urls' | 'smartphone', HTMLElement>>>({});
  const recoveryFocus = useRef<'urls' | 'smartphone' | null>(null);
  const selection = useRef({ inputUuid: '' });
  const selectionEdits = useRef(0);
  const revision = useRef(contextRevision);
  const refreshedRevision = useRef(contextRevision);
  const [pendingTarget, setPendingTarget] = useState<string | null>(null);
  const [responseOperation, setResponseOperation] = useState<ObsSourceOperation | null>(null);
  const [confirmed, setConfirmed] = useState<{ request: ObsSourceRegistrationEntry; id: string; revision: number } | null>(null);
  const [awaitingOperation, setAwaitingOperation] = useState<{ operation: ObsSourceOperation; request: ObsSourceRegistrationEntry; revision: number } | null>(null);
  const blockedReason = request?.target.kind === 'smartphone' && smartphoneBlockedReason ? smartphoneBlockedReason : targetBlocked(request, smartphone);
  const manualCopyDeviceId = request?.target.kind === 'smartphone' ? request.target.deviceId : undefined;
  const manualCopyPort = smartphone?.devices.find(device => device.id === manualCopyDeviceId)?.obsLocalPort;
  const manualCopyContext = useRef({ request, allowed: !blockedReason && Boolean(smartphoneObsInput), port: manualCopyPort, revision: 0 });
  useLayoutEffect(() => {
    const previous = manualCopyContext.current;
    const allowed = !blockedReason && Boolean(smartphoneObsInput);
    if (previous.request !== request || previous.allowed !== allowed || previous.port !== manualCopyPort)
      manualCopyContext.current = { request, allowed, port: manualCopyPort, revision: previous.revision + 1 };
  }, [request, blockedReason, smartphoneObsInput, manualCopyPort]);
  const connected = Boolean(obs?.enabled && obs.connection === 'connected');
  const connectionReason = !obs?.enabled ? 'OBS連携がOFFです。接続設定を確認してください。'
    : obs.connection !== 'connected' ? '先にOBSの接続設定を確認してください。' : '';
  const targetKey = request ? keyOf(request.target) : '';
  const sourceContext = loaded?.request === request ? loaded.value : null;
  const lastOperation = state?.lastOperation;
  const unfinished = state?.unfinishedOperations ?? [lastOperation, responseOperation].filter((value): value is ObsSourceOperation => Boolean(value && canResume(value)))
    .filter((value, index, list) => list.findIndex(other => other.id === value.id) === index);
  const targetUnfinished = unfinished.filter(value => keyOf(value.target) === targetKey);
  const requestedRetry = selectedUnfinished?.request === request ? selectedUnfinished.id : request?.retryOperationId;
  const retry = targetUnfinished.find(value => value.id === requestedRetry) ?? (!requestedRetry && targetUnfinished.length === 1 ? targetUnfinished[0] : null);
  const operation = retry ?? (lastOperation && keyOf(lastOperation.target) === targetKey
    ? lastOperation : state?.unfinishedOperations === undefined && responseOperation && keyOf(responseOperation.target) === targetKey ? responseOperation : null);
  const busy = Boolean(pendingTarget || awaitingOperation || state?.busy || obs?.busy || testState?.busy);
  const selectedScene = retry?.sceneUuid ?? sourceContext?.currentSceneUuid ?? '';
  const chosenInput = retry?.inputUuid ?? inputUuid;
  const selectedCandidate = sourceContext?.candidates.find(candidate => candidate.uuid === chosenInput);
  const presentInScene = Boolean(connected && sourceContext && !loading && !contextError && !contextRefreshError
    && loaded?.revision === contextRevision && selectedCandidate && sourceContext.presentInputUuids.includes(chosenInput));
  const currentSuccess = operation?.status === 'succeeded' && confirmed?.request === request && confirmed.id === operation.id
    && confirmed.revision === contextRevision
    && (!sourceContext || sourceContext.collection === operation.collection && sourceContext.currentSceneUuid === operation.sceneUuid);

  useLayoutEffect(() => {
    latestRequest.current = request; callbacks.current = { context, add, onOpen, onClose, onStart, onNotice };
    selection.current = { inputUuid: chosenInput }; revision.current = contextRevision;
  }, [request, context, add, onOpen, onClose, onStart, onNotice, chosenInput, contextRevision]);
  const refreshContext = useCallback(async (entry: ObsSourceRegistrationEntry, preferred: { collection: string; inputUuid?: string | null }, forAction = false) => {
    const refreshEntry = latestRequest.current;
    if (!refreshEntry || keyOf(refreshEntry.target) !== keyOf(entry.target) || forAction && refreshEntry !== entry) return null;
    const preferredInput = refreshEntry === entry ? preferred.inputUuid : selection.current.inputUuid || preferred.inputUuid;
    const version = ++contextVersion.current;
    const edits = selectionEdits.current;
    const previousInput = selection.current.inputUuid;
    setLoading(true); setContextRefreshError(''); setContextRefreshWarning('');
    const requestedRevision = revision.current;
    refreshedRevision.current = requestedRevision;
    try {
      const value = await callbacks.current.context(refreshEntry.target);
      if (version !== contextVersion.current || latestRequest.current !== refreshEntry) return null;
      if (keyOf(value.target) !== keyOf(refreshEntry.target)) throw new Error('OBS登録の対象が変わりました。');
      const collectionChanged = value.collection !== preferred.collection;
      const inputEdited = !collectionChanged && selectionEdits.current !== edits;
      const input = collectionChanged ? '' : inputEdited ? selection.current.inputUuid : preferredInput ?? previousInput;
      const inputExists = value.candidates.some(candidate => candidate.uuid === input);
      setLoaded({ request: refreshEntry, value, revision: requestedRevision });
      const chosen = inputExists ? input! : input || inputEdited ? '' : value.candidates.length === 1 ? value.candidates[0].uuid : '';
      const required = Boolean(value.candidates.length && !collectionChanged && ((!inputExists && input) || (inputEdited && !input)));
      setInputUuid(chosen); setInputSelectionRequired(required);
      setContextRefreshWarning(collectionChanged ? 'OBSのコレクションが変わりました。使用するOBSソースを確認してください。'
        : input && !inputExists ? '今回のソースが候補に見つかりません。OBS側と最新の候補を確認してください。' : '');
      return { value, inputUuid: chosen, selectionRequired: required };
    } catch (reason) {
      if (version === contextVersion.current && latestRequest.current === refreshEntry)
        setContextRefreshError(`一覧を更新できませんでした。${reason instanceof Error ? reason.message : ''} ダイアログを閉じて開き直し、一覧を再確認してください。`);
      if (forAction && version === contextVersion.current && latestRequest.current === refreshEntry) throw reason;
      return null;
    } finally {
      if (version === contextVersion.current && latestRequest.current === refreshEntry) setLoading(false);
    }
  }, []);
  useLayoutEffect(() => {
    if (request) {
      if (!dialog.current?.open) dialog.current?.showModal();
      closeButton.current?.focus({ preventScroll: true });
    } else dialog.current?.close();
  }, [request]);
  useLayoutEffect(() => {
    if (request?.target.kind !== 'smartphone' || !smartphone?.available) return;
    const deviceId = request.target.deviceId;
    if (smartphone.devices.some(device => device.id === deviceId)) return;
    contextVersion.current += 1;
    dialog.current?.close(); callbacks.current.onClose();
    document.getElementById('sp-device-list-heading')?.focus({ preventScroll: true });
  }, [request, smartphone]);
  useEffect(() => {
    const version = ++contextVersion.current;
    setLoaded(null); setContextError(''); setContextRefreshError(''); setContextRefreshWarning(''); setInputSelectionRequired(false); setInputUuid('');
    const requestedRevision = revision.current;
    refreshedRevision.current = requestedRevision;
    if (!request || !connected || blockedReason) { setLoading(false); return; }
    setLoading(true);
    void callbacks.current.context(request.target).then(value => {
      if (version !== contextVersion.current || latestRequest.current !== request) return;
      if (keyOf(value.target) !== keyOf(request.target)) throw new Error('OBS登録の対象が変わりました。閉じて開き直してください。');
      setLoaded({ request, value, revision: requestedRevision });
      setInputUuid(value.candidates.length === 1 ? value.candidates[0].uuid : '');
    }).catch(reason => {
      if (version === contextVersion.current && latestRequest.current === request)
        setContextError(reason instanceof Error ? reason.message : 'OBSの登録先を取得できません。');
    }).finally(() => {
      if (version === contextVersion.current && latestRequest.current === request) setLoading(false);
    });
    return () => { contextVersion.current += 1; };
  }, [request, connected, blockedReason]);
  useEffect(() => { setSourceSelectFocused(false); setRecoverySelectFocused(false); setConnectionFocused(false); }, [request]);
  useEffect(() => {
    if (!request || !connected || blockedReason || busy || loading || !sourceContext || refreshedRevision.current === contextRevision) return;
    void refreshContext(request, { collection: sourceContext.collection, inputUuid: selection.current.inputUuid });
  }, [contextRevision, request, connected, blockedReason, busy, loading, sourceContext, refreshContext]);
  useEffect(() => {
    const onEntryPage = request?.page && navigation?.page === request.page && !navigation.editor;
    const onEntry = request?.initialSetup
      ? navigation?.initialSetup && request.entry.isConnected
      : onEntryPage || request && navigation?.editor === ownerOf(request.target);
    if (request && navigation && !onEntry) {
      dialog.current?.close(); callbacks.current.onClose();
    }
  }, [request, navigation]);
  useEffect(() => {
    if (!awaitingOperation) return;
    const operationId = awaitingOperation.operation.id;
    const current = lastOperation?.id === operationId ? lastOperation : state?.unfinishedOperations?.find(value => value.id === operationId);
    if (current?.status === 'running') return;
    if (current) {
      setAwaitingOperation(null);
      if (current.status === 'succeeded') setConfirmed({ request: awaitingOperation.request, id: current.id, revision: awaitingOperation.revision });
      callbacks.current.onNotice(current.message, current.status === 'succeeded' ? 'success' : 'error', current.target, current.title);
      refreshContext(awaitingOperation.request, current);
    } else if (state && !state.busy && state.unfinishedOperations !== undefined) {
      setAwaitingOperation(null);
      setResponseOperation(value => value?.id === operationId ? null : value);
      if (latestRequest.current === awaitingOperation.request) setContextError(missingResultMessage);
      refreshContext(awaitingOperation.request, awaitingOperation.operation);
    }
  }, [awaitingOperation, lastOperation, state, refreshContext]);

  const close = (restoreFocus = true) => {
    const entry = latestRequest.current?.entry;
    dialog.current?.close(); callbacks.current.onClose();
    if (restoreFocus) {
      const destination = entry?.isConnected && !entry.closest('[hidden]') ? entry
        : document.getElementById('editor-heading') ?? document.getElementById('page-heading');
      destination?.focus({ preventScroll: true });
    }
  };
  const unfinishedBlocked = targetUnfinished.length > 1 && !retry ? '未完了・結果不明の登録が複数あります。「登録の詳細」で再確認する操作を選んでください。'
    : requestedRetry && !retry && !(lastOperation?.id === requestedRetry && ['succeeded', 'failed'].includes(lastOperation.status))
      ? '前回の操作が未完了一覧にありません。閉じて登録対象を選び直し、OBSでも確認してください。' : '';
  const retryBlocked = retry && sourceContext && (sourceContext.collection !== retry.collection || sourceContext.currentSceneUuid !== retry.sceneUuid)
    ? `OBSで前回のコレクションとシーン「${retry.sceneName}」を開いてから再試行してください。` : '';
  const incompatibleBlocked = sourceContext && !sourceContext.candidates.length && sourceContext.incompatible.length
    ? '同じ入力の既存ソースに不適合な設定があります。「登録の詳細」で理由を確認し、OBSで修正してください。' : '';
  const selectionBlocked = sourceContext && !retry && (sourceContext.candidates.length > 1 || inputSelectionRequired) && !inputUuid
    ? '使用するOBSソースを選んでください。同名の候補は「登録の詳細」で確認できます。' : '';
  const cannotAdd = busy || !request || !connected || Boolean(blockedReason || loading || contextError || contextRefreshError || unfinishedBlocked || retryBlocked || incompatibleBlocked || selectionBlocked)
    || !sourceContext || !sourceContext.scenes.some(scene => scene.uuid === selectedScene);
  const registrationPending = pendingTarget === targetKey || operation?.status === 'running' || Boolean(awaitingOperation && awaitingOperation.request === request);
  const destinationName = !connected ? 'OBSに接続していません'
    : blockedReason ? '追加の準備が必要です。下の理由を確認してください。'
    : retry ? retry.sceneName
    : operation?.status === 'running' ? operation.sceneName || '確認中…'
    : loading || loaded?.revision !== contextRevision && !contextError && !contextRefreshError ? '確認中…'
    : contextError || contextRefreshError ? '取得できません。OBSの接続を確認してください。'
    : sourceContext?.scenes.find(scene => scene.uuid === sourceContext.currentSceneUuid)?.name || 'OBSで追加先のシーンを開いてください。';
  const statusWarning = Boolean(blockedReason || connectionReason || contextError || contextRefreshError || contextRefreshWarning || unfinishedBlocked || retryBlocked || incompatibleBlocked || selectionBlocked || sourceContext && !selectedScene || operation && needsRecovery(operation));
  const statusTitle = registrationPending ? '登録設定を確認しています' : currentSuccess ? operationLabels.succeeded : operation && operation.status !== 'succeeded' ? operationLabels[operation.status] : !connected ? (!obs?.enabled ? 'OBS連携がOFFです' : 'OBSに接続していません') : statusWarning ? '確認が必要です' : loading ? 'OBSソースを確認しています' : busy ? '別のOBS操作を実行中です' : presentInScene ? 'このシーンに追加済みです' : selectedCandidate ? '既存ソースをこのシーンに追加できます' : '新しいソースを作成します';
  const statusMessage = registrationPending ? `${operation?.status === 'running' ? phaseLabels[operation.phase] : 'OBSへの登録を実行しています'}。閉じても処理は継続します。`
    : blockedReason || connectionReason || contextError || unfinishedBlocked || retryBlocked || incompatibleBlocked || (loading && !sourceContext ? 'OBSのシーンと既存ソースを確認しています…' : '')
      || (operation && needsRecovery(operation) ? `OBSで対象のソースと追加先シーンを確認してから、登録を再確認してください。 ${operation.message}`
        : currentSuccess ? `${operation.message} 配置の微調整と実際の表示はOBSで確認してください。`
          : busy ? '別のOBS操作を実行中です。完了してから追加してください。'
          : selectionBlocked || (!selectedScene && sourceContext ? 'OBSで追加先のシーンを開いてください。'
            : selectedCandidate ? `${selectedCandidate.name}。既存ソースの設定と配置を保持${presentInScene ? 'して、登録を再確認できます' : 'して追加します'}。`
            : `ソース名：きゃすメイト ${request?.target.kind === 'overlay' ? obsOverlayDefinitions[request.target.overlay].title : request?.title ?? ''}`));

  const submit = async () => {
    if (cannotAdd || pending.current || !request || !sourceContext) return;
    const submittedRequest = request;
    const submittedTarget = keyOf(request.target);
    let submission: ObsSourceAddRequest = { target: request.target, collection: retry?.collection ?? sourceContext.collection,
      sceneUuid: selectedScene, ...(chosenInput ? { inputUuid: chosenInput } : {}), ...(retry ? { retryOperationId: retry.id } : {}) };
    pending.current = true; setPendingTarget(submittedTarget); callbacks.current.onStart();
    try {
      const fresh = await refreshContext(submittedRequest, submission, true);
      if (!fresh) return;
      if (retry && (fresh.value.collection !== retry.collection || fresh.value.currentSceneUuid !== retry.sceneUuid)) return;
      if (!fresh.value.currentSceneUuid || fresh.value.incompatible.length && !fresh.value.candidates.length) return;
      if (!retry && (fresh.selectionRequired || fresh.value.candidates.length > 1 && !fresh.inputUuid)) return;
      submission = { target: submittedRequest.target, collection: fresh.value.collection, sceneUuid: fresh.value.currentSceneUuid,
        ...(retry ? { retryOperationId: retry.id, ...(retry.inputUuid ? { inputUuid: retry.inputUuid } : {}) } : fresh.inputUuid ? { inputUuid: fresh.inputUuid } : {}) };
      const submittedRevision = revision.current;
      const result = await callbacks.current.add(submission);
      setResponseOperation(result);
      if (result?.status === 'succeeded') setConfirmed({ request: submittedRequest, id: result.id, revision: submittedRevision });
      if (!result) {
        if (latestRequest.current === submittedRequest) setContextError(missingResultMessage);
        refreshContext(submittedRequest, submission);
        return;
      }
      if (result.status === 'running') setAwaitingOperation({ operation: result, request: submittedRequest, revision: submittedRevision });
      else {
        callbacks.current.onNotice(result.message, result.status === 'succeeded' ? 'success' : 'error', result.target, result.title);
        refreshContext(submittedRequest, result);
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'OBSソースの登録を完了できません。';
      if (latestRequest.current === submittedRequest) setContextError(message);
      callbacks.current.onNotice(message, 'error', submittedRequest.target, submittedRequest.title);
      refreshContext(submittedRequest, submission);
    } finally { pending.current = false; setPendingTarget(null); }
  };
  const openRecovery = (warning: ObsSourceRegistrationWarning, entry: HTMLElement) => {
    callbacks.current.onOpen({ target: warning.target, title: warning.title, entry, retryOperationId: warning.retryOperationId });
  };
  const targetTitle = request?.target.kind === 'overlay' ? obsOverlayDefinitions[request.target.overlay].title : request?.title ?? '';
  const sourceChoiceVisible = sourceSelectFocused || !retry && Boolean(sourceContext && (sourceContext.candidates.length > 1 || inputSelectionRequired));
  const openConnection = () => { const entry = request?.entry; close(false); if (entry) navigation?.open('obsControl', entry); };
  const connectionAction = !connected || connectionFocused;
  const registrationAction = <button type="button" data-action="register" aria-describedby={`${id}-status`} aria-disabled={connectionAction ? !navigation : cannotAdd} aria-busy={Boolean(registrationPending)}
    onFocus={() => { if (!connected) setConnectionFocused(true); }} onBlur={() => setConnectionFocused(false)}
    onClick={() => { if (connectionAction) { if (navigation) openConnection(); } else void submit(); }}>
    {connectionAction ? 'OBS接続を設定' : registrationPending ? '確認中…' : retry || currentSuccess || presentInScene ? '登録を再確認' : 'OBSに追加'}</button>;
  const manualUrl = request?.target.kind === 'overlay' ? baseUrl.replace(/\/$/, '') + obsOverlayDefinitions[request.target.overlay].path : '';
  const copyUrl = async () => {
    if (copyPending.current || !request || request.target.kind !== 'overlay') return;
    copyPending.current = true; setCopyBusy(true); onCopyStart();
    const title = targetTitle;
    try { await navigator.clipboard.writeText(manualUrl); onCopyNotice(`${title}のURLをコピーしました。`, false); }
    catch { onCopyNotice('URLをコピーできませんでした。表示されているURLを選択してコピーしてください。', true); }
    finally { copyPending.current = false; setCopyBusy(false); }
  };
  const copySmartphoneInput = async () => {
    if (copyPending.current || blockedReason || !smartphoneObsInput || request?.target.kind !== 'smartphone') return;
    const copyingRequest = request;
    const copyingRevision = manualCopyContext.current.revision;
    const stillCurrent = () => manualCopyContext.current.request === copyingRequest && manualCopyContext.current.allowed && manualCopyContext.current.revision === copyingRevision;
    copyPending.current = true; setCopyBusy(true); onCopyStart();
    try {
      const input = await smartphoneObsInput(request.target.deviceId);
      if (!stillCurrent()) return;
      await navigator.clipboard.writeText(input);
      if (stillCurrent()) onCopyNotice(`${copyingRequest.title}のOBS入力をコピーしました。`, false);
    }
    catch { if (stillCurrent()) onCopyNotice('OBS入力をコピーできませんでした。端末の登録と保存状態を確認して再試行してください。', true); }
    finally { copyPending.current = false; setCopyBusy(false); }
  };
  const prepareTest = async () => {
    if (!request || request.target.kind !== 'overlay' || !sourceContext) return null;
    const fresh = await refreshContext(request, { collection: sourceContext.collection, inputUuid: chosenInput }, true);
    if (!fresh) return null;
    const input = retry?.inputUuid ?? fresh.inputUuid;
    if (!fresh.value.currentSceneUuid || !input || !fresh.value.candidates.some(candidate => candidate.uuid === input)) throw new Error('使用するOBSソースを確認し、OBSへ追加してからテストしてください。');
    return { target: request.target, collection: fresh.value.collection, sceneUuid: fresh.value.currentSceneUuid, inputUuid: input };
  };

  useLayoutEffect(() => {
    const slot = recoveryFocus.current ? recoverySlots.current[recoveryFocus.current] : null;
    if (slot?.hidden) {
      recoveryFocus.current = null;
      document.getElementById('editor-heading')?.focus({ preventScroll: true });
    }
  }, [recoveries, navigation?.editor]);

  return <>
    {(['urls', 'smartphone'] as const).map(owner => <section key={owner} ref={element => { recoverySlots.current[owner] = element ?? undefined; }} className="obs-registration-recovery-slot" aria-label="OBS登録の復旧一覧"
      onFocusCapture={() => { recoveryFocus.current = owner; }} onBlurCapture={event => { if (event.relatedTarget instanceof Node && event.relatedTarget !== document.body && !event.currentTarget.contains(event.relatedTarget)) recoveryFocus.current = null; }}
      hidden={!recoveries.some(value => ownerOf(value.target) === owner) || Boolean(navigation && navigation.editor !== owner)}>
      <h3>OBS登録の確認</h3><div className="obs-registration-recovery-list" tabIndex={0}>
        {recoveries.filter(value => ownerOf(value.target) === owner).map(warning => <div key={warning.key}>
          <span id={`obs-registration-recovery-${encodeURIComponent(warning.key)}`} className="obs-registration-focus-target" tabIndex={-1} />
          <button type="button" className="secondary" aria-label={`${warning.message}・OBS登録の要確認を開く`}
            aria-haspopup="dialog" aria-controls="obs-source-registration-dialog" onClick={event => openRecovery(warning, event.currentTarget)}>{warning.message} ›</button>
        </div>)}
      </div>
    </section>)}
    <dialog ref={dialog} id="obs-source-registration-dialog" className="obs-source-registration-dialog" aria-labelledby={`${id}-title`}
      onCancel={event => { event.preventDefault(); close(); }}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); close(); return; }
        if (event.key !== 'Tab') return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), summary, a[href], [tabindex="0"]'))
          .filter(element => {
            if (element.closest('[hidden]')) return false;
            const details = element.closest('details');
            return !details || details.open || element === details.querySelector('summary');
          });
        const first = controls[0]; const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
      {request && <><div className="obs-registration-heading" aria-label="OBSに追加する対象"><h2 id={`${id}-title`}>{targetTitle}をOBSに追加</h2><button ref={closeButton} type="button" className="secondary" aria-label="閉じる" onClick={() => close()}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg>
      </button></div>
      <div className="obs-registration-body">
        <div className="obs-registration-destination" role="group" aria-label="追加先のシーン" tabIndex={0}><span>追加先シーン</span><strong>{destinationName}</strong></div>
        <div id={`${id}-status`} className="obs-registration-status" role="status" tabIndex={0} aria-label="OBS登録の状態" data-error={statusWarning} data-complete={(currentSuccess || presentInScene) && !statusWarning}>
          <StatusIcon warning={statusWarning} complete={currentSuccess || presentInScene}/>
          <div className="obs-registration-source-value" role="group" tabIndex={sourceChoiceVisible ? -1 : 0} aria-label="使用するOBSソースの内容" data-input-uuid={chosenInput}>
            <strong>{statusTitle}</strong>
            <span id={`${id}-input-label`} className="obs-registration-label" hidden={!sourceChoiceVisible}>使用するOBSソース</span>
            <select id={`${id}-input`} aria-labelledby={`${id}-input-label`} value={chosenInput} hidden={!sourceChoiceVisible}
              aria-disabled={!sourceContext || busy || Boolean(retry)} disabled={!sourceSelectFocused && (!sourceContext || busy || Boolean(retry))}
              onFocus={() => setSourceSelectFocused(true)} onBlur={() => setSourceSelectFocused(false)} onChange={event => { if (!sourceContext || busy || retry) return; selectionEdits.current += 1; setConfirmed(null); setInputUuid(event.target.value); }}>
              <option value="">使用するOBSソースを選択</option>
              {sourceContext?.candidates.map((candidate, index) => <option key={candidate.uuid} value={candidate.uuid}>{candidate.name}（候補{index + 1}）</option>)}
              {retry?.inputUuid && !selectedCandidate && <option value={retry.inputUuid}>前回のソース（詳細で確認）</option>}
            </select>
            <p>{statusMessage}</p>
            {(contextRefreshError || contextRefreshWarning || (loading && sourceContext)) && <p>{contextRefreshError || contextRefreshWarning || 'OBSの一覧を更新しています…'}</p>}
          </div>
        </div>
        {request.target.kind === 'overlay' ? <ObsSourceTestControls selection={sourceContext && selectedScene && chosenInput ? { target: request.target, collection: sourceContext.collection, sceneUuid: selectedScene, inputUuid: chosenInput } : null}
          state={testState} context={testContext} contextRevision={contextRevision} action={testAction} prepare={prepareTest} blocked={!connected || Boolean(blockedReason || state?.busy || loading || contextRefreshError || retryBlocked)}
          notice={(message, error) => onTestNotice?.(message, error)} registrationAction={registrationAction}/>
          : <><div className="obs-registration-actions">{registrationAction}</div><div className="obs-registration-phone-guide" tabIndex={0}><strong>追加したら、スマホから送信</strong><p>スマホで映像送信を開始し、OBSで映像と音声を確認してください。</p></div></>}
        <details className="obs-registration-details"><summary>登録の詳細</summary><div className="obs-registration-details-content" tabIndex={0} aria-label="OBS登録の詳細">
          {operation?.status === 'succeeded' && <p>前回の登録結果：{operation.message}</p>}
          <p>スタジオモードではプレビュー側のシーンに追加します。</p>
          {sourceContext && <p>初期配置：{sourceContext.canvas.width} × {sourceContext.canvas.height} のキャンバス内</p>}
          {chosenInput && <p>使用する入力UUID：<code>{chosenInput}</code></p>}
          {sourceContext && sourceContext.candidates.length > 1 && <ul aria-label="候補の識別情報">{sourceContext.candidates.map((candidate, index) => <li key={candidate.uuid}>候補{index + 1}：{candidate.name}<code>{candidate.uuid}</code></li>)}</ul>}
          <label htmlFor={`${id}-unfinished`} hidden={targetUnfinished.length < 2 && !recoverySelectFocused}>未完了・結果不明の登録<select id={`${id}-unfinished`} value={retry?.id ?? ''}
            aria-disabled={busy} disabled={busy && !recoverySelectFocused} onFocus={() => setRecoverySelectFocused(true)} onBlur={() => setRecoverySelectFocused(false)}
            onChange={event => { if (busy) return; selectionEdits.current += 1; setSelectedUnfinished({ request, id: event.target.value }); }}>
            <option value="">再確認する操作を選択</option>
            {targetUnfinished.map(value => <option key={value.id} value={value.id}>{value.collection}・{value.sceneName}（{value.id}）</option>)}
          </select></label>
          {retry && <p hidden={targetUnfinished.length > 1 || recoverySelectFocused}>再確認する登録：{retry.collection}・{retry.sceneName}（{retry.id}）</p>}
          {Boolean(sourceContext?.incompatible.length) && <><h4>既存ソースの不適合理由（{sourceContext?.incompatible.length}件）</h4><ul>{sourceContext?.incompatible.map(candidate => <li key={candidate.uuid}><strong>{candidate.name}</strong><code>{candidate.uuid}</code><p>{candidate.reason}</p></li>)}</ul></>}
        </div>
        </details>
        <details className="obs-registration-manual"><summary>{request.target.kind === 'overlay' ? 'URLを使って手動で追加' : '手動で追加する'}</summary><div tabIndex={0} aria-label="OBSへの手動登録手順">
          {request?.target.kind === 'smartphone' ? <>
            <p>端末共通のOBS入力は、家庭内LAN・Tailscale・直接接続で共有します。ネットワーク切り替えやOFFでも同じソースを使えます。</p>
            <button type="button" className="secondary obs-registration-copy" aria-disabled={copyBusy || Boolean(blockedReason) || !smartphoneObsInput} aria-busy={copyBusy} onClick={() => void copySmartphoneInput()}>OBS入力をコピー</button>
            <ol><li>上の<strong>「OBS入力をコピー」</strong>を押します。共通入力の割当と保存が完了していれば、ネットワークOFF・表示経路未登録でもコピーできます。未保存の入力は先に保存してください。</li>
              <li>OBSのソースで<strong>「＋」→「メディアソース」</strong>を選びます。</li>
              <li><strong>「ローカルファイル」をOFF</strong>にし、「入力」へ貼り付けます。入力形式は<strong>「mpegts」</strong>にします。</li>
              <li>名前と配置を調整します。スマホで送信を開始し、OBSで映像・音声を確認します。</li></ol>
            <p>同じ入力は既存ソースを共有し、UDP受信の重複を避けてください。受信中の表示だけではOBSでの映像・音声の成功を保証しません。</p>
          </> : <><code>{manualUrl}</code><button type="button" className="secondary obs-registration-copy" aria-disabled={copyBusy} aria-busy={copyBusy} onClick={() => void copyUrl()}>URLをコピー</button>
            <ol><li>OBSの「ソース」で<strong>「＋」→「ブラウザ」</strong>を選ぶ</li><li>URLを貼り付ける</li><li>幅・高さを調整して「OK」</li></ol></>}
        </div></details>
      </div>
      </>}
    </dialog>
  </>;
}
