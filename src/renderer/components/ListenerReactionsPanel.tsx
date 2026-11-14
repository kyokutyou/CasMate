import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type PointerEvent } from 'react';
import QRCode from 'qrcode';
import { normalizeYouTubeInput } from '../../main/sources/source-inputs';
import { defaultReactionSettings, isReactionDisplay, REACTION_MANAGEMENT_POLL_INTERVAL_MS, REACTION_MANAGEMENT_POLL_TIMEOUT_MS,
  type ReactionSettings, type ReactionManagementSnapshot, type ReactionPreviewSettings, type ReactionWindowHint } from '../../shared/listener-reactions';
import { ManagementNavigation } from '../management-navigation';
import { SettingsCard } from './SettingsCard';
import { TestActionButton } from './TestActionButton';
import type { ObsSourceRegistrationEntry } from './ObsSourceRegistrationDialog';
import './listener-reactions-panel.css';
interface Props {
  request(action?: string, body?: unknown, signal?: AbortSignal, expectedInstance?: string): Promise<ReactionManagementSnapshot>;
  image(id: string, signal: AbortSignal): Promise<Blob>;
  onNotice(message: string, tone: 'success' | 'error'): void;
  onRegisterSource(request: ObsSourceRegistrationEntry): void;
}
type RequestedSnapshot = ReactionManagementSnapshot & { requestedInstance: string | undefined };
type EditPreparation = { instance: string | undefined; result: Promise<ReactionManagementSnapshot | undefined> };
function Action({ disabled, onClick, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...props} aria-disabled={disabled || undefined} onClick={event => { if (!disabled) onClick?.(event); }}/>;
}
function matchesTarget(target: ReactionWindowHint, hint: ReactionWindowHint | null | undefined) {
  return hint?.title === target.title && hint.className === target.className && hint.processName.toLowerCase() === target.processName.toLowerCase();
}
const unresolvedTargetId = '@unresolved-target';
const restartedDuringOperation = 'アプリの再起動後に操作が反映されたか確認できません。現在の状態を確認してください。';
type PreviewDraft = { mode: ReactionPreviewSettings['mode']; twitchChannel: string; youtubeUrl: string };
const previewInput = (settings: ReactionPreviewSettings): PreviewDraft => ({
  mode: settings.mode,
  twitchChannel: settings.twitchChannel,
  youtubeUrl: settings.youtubeTarget ?? (settings.youtubeVideoId ? `https://www.youtube.com/watch?v=${settings.youtubeVideoId}` : ''),
});
function twitchChannel(input: string): string | null {
  const value = input.trim();
  return !value || /^[A-Za-z0-9_]{1,25}$/u.test(value) ? value.toLowerCase() : null;
}
function youtubeVideoId(input: string): string | null {
  const value = input.trim();
  if (!value) return value;
  try { return normalizeYouTubeInput(value).target; } catch { return null; }
}
export function ListenerReactionsPanel({ request: requestSnapshot, image, onNotice, onRegisterSource }: Props) {
  const navigation = useContext(ManagementNavigation), active = !navigation || navigation.editor === 'listenerReactions';
  const [view, setView] = useState<ReactionManagementSnapshot | null>(null), [draft, setDraft] = useState(defaultReactionSettings);
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [src, setSrc] = useState('');
  const [previewDraft, setPreviewDraft] = useState<PreviewDraft | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false), [previewError, setPreviewError] = useState('');
  const previewPending = useRef(false), previewVersion = useRef(0);
  const preview = previewDraft ?? previewInput(view?.settings.preview ?? draft.preview);
  const previewValidation = preview.mode === 'twitch' && twitchChannel(preview.twitchChannel) === null ? 'Twitchのチャンネル名を半角英数字とアンダースコアで入力してください。'
    : preview.mode === 'youtube' && youtubeVideoId(preview.youtubeUrl) === null ? 'YouTube Liveの配信URL・LIVE ID・@ハンドルを入力してください。' : '';
  const [qr, setQr] = useState<{ url: string; src: string } | null>(null);
  const publication = view?.publication;
  const namedShare = view?.namedShare;
  const [shareName, setShareName] = useState(''), [invite, setInvite] = useState(''), [shareBusy, setShareBusy] = useState(false);
  const [expiredShare, setExpiredShare] = useState<number>();
  const sharePending = useRef(false);
  const directShareUrl = publication?.status === 'online' ? publication.url : null;
  const shareUrl = directShareUrl && (expiredShare !== namedShare?.expiresAt && namedShare?.url || directShareUrl);
  const dirtyRef = useRef(false), version = useRef(0), current = useRef<ReactionManagementSnapshot | null>(null), mounted = useRef(true), pending = useRef(false);
  const [imageIdentity, setImageIdentity] = useState('');
  const [aspectRatio, setAspectRatio] = useState('16/9');
  const refreshPreview = useRef<(() => void) | null>(null);
  const desktopOperation = useRef(0);
  const editPreparation = useRef<EditPreparation | null>(null);
  const drag = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const pan = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null);
  const previewViewport = useRef<HTMLDivElement>(null), previewImage = useRef<HTMLDivElement>(null);
  const zoomCenter = useRef<{ x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState<number | null>(null), [panning, setPanning] = useState(false);
  const [preparingDesktop, setPreparingDesktop] = useState(false), [stoppingDesktop, setStoppingDesktop] = useState(false);
  const notice = useRef(onNotice);
  const [dragRegion, setDragRegion] = useState<ReactionSettings['region'] | null>(null);
  const cancelDrag = useCallback(() => { drag.current = null; pan.current = null; setDragRegion(null); }, []);
  useEffect(() => { notice.current = onNotice; }, [onNotice]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const request = useCallback(async (...args: Parameters<Props['request']>): Promise<RequestedSnapshot> => {
    const requestedInstance = current.current?.instance;
    return { ...await requestSnapshot(...args), requestedInstance };
  }, [requestSnapshot]);
  const apply = useCallback((next: RequestedSnapshot, { fromPoll = false, savedSettings = false } = {}) => {
    const previous = current.current;
    if (!mounted.current) return null;
    if (previous && previous.instance !== next.instance && previous.instance !== next.requestedInstance) {
      if (fromPoll) return null;
      throw new Error(restartedDuringOperation);
    }
    if (savedSettings) { dirtyRef.current = false; setDirty(false); }
    if (previous?.instance === next.instance && previous.revision > next.revision) return null;
    if (next.frame && !(next.frame.validForMs > 0)) next = { ...next, frame: null };
    if (current.current?.instance === next.instance && current.current.namedShare && next.namedShare && current.current.namedShare.revision > next.namedShare.revision) {
      next = { ...next, namedShare: current.current.namedShare };
    }
    const contextChanged = previous?.instance !== next.instance || previous.generation !== next.generation;
    if (contextChanged || !next.frame) { setImageIdentity(''); cancelDrag(); setSrc(''); }
    current.current = next; setView(next);
    if (!dirtyRef.current) setDraft(next.settings);
    else setDraft(old => old.autoStartOnPublish === next.settings.autoStartOnPublish && old.publishOnStartup === next.settings.publishOnStartup ? old : { ...old, autoStartOnPublish: next.settings.autoStartOnPublish, publishOnStartup: next.settings.publishOnStartup });
    if (!fromPoll && (contextChanged || !!previous?.frame !== !!next.frame)) refreshPreview.current?.();
    return next;
  }, [cancelDrag]);
  const abandonDrag = useCallback(() => {
    if (!drag.current) return;
    cancelDrag();
    if (dirtyRef.current) return;
    const preparation = editPreparation.current;
    const operation = desktopOperation.current;
    void Promise.resolve(preparation?.result).then(snapshot => {
      if (preparation !== editPreparation.current || operation !== desktopOperation.current) return;
      const editToken = snapshot?.instance === current.current?.instance ? snapshot?.desktop.editToken : undefined;
      if (editToken) return request('edit-cancel', { editToken }).then(apply);
    }).catch(failure => { if (mounted.current && operation === desktopOperation.current && preparation === editPreparation.current) setError(failure instanceof Error ? failure.message : 'PC表示を再開できません。'); });
  }, [apply, cancelDrag, request]);
  useEffect(() => {
    if (!active) return;
    let stopped = false, inFlight = false, revision = 0, immediate = false, timer: ReturnType<typeof setTimeout>, abort: AbortController | undefined, url = '', frameId = '';
    let displayedIdentity = '', expiresAt = 0, expiryTimer: ReturnType<typeof setTimeout> | undefined;
    const clearImage = () => { clearTimeout(expiryTimer); if (url) URL.revokeObjectURL(url); url = ''; frameId = ''; displayedIdentity = ''; setImageIdentity(''); pan.current = null; abandonDrag(); setSrc(''); };
    const setExpiry = (deadline: number) => {
      clearTimeout(expiryTimer);
      expiresAt = deadline;
      expiryTimer = setTimeout(clearImage, Math.ceil(deadline - performance.now()));
    };
    const release = () => { revision++; abort?.abort(); clearImage(); };
    const load = async () => {
      if (stopped || document.hidden || inFlight) return;
      inFlight = true; const requestRevision = revision; immediate = false;
      const live = () => !stopped && !document.hidden && requestRevision === revision;
      const started = performance.now();
      let imageDeadline: ReturnType<typeof setTimeout> | undefined;
      try {
        const operation = new AbortController(); abort = operation;
        const signal = AbortSignal.any([operation.signal, AbortSignal.timeout(REACTION_MANAGEMENT_POLL_TIMEOUT_MS)]);
        const race = <T,>(work: Promise<T>) => new Promise<T>((resolve, reject) => { const fail = () => reject(new Error('取得を取り消しました。')); signal.addEventListener('abort', fail, { once: true }); if (signal.aborted) fail(); void work.then(resolve,reject).finally(() => signal.removeEventListener('abort', fail)); });
        const response = await race(request(undefined, undefined, signal));
        if (!live()) return;
        const next = apply(response, { fromPoll: true });
        if (!next) return;
        if (!next.frame) { release(); return; }
        const confirmedIdentity = `${next.instance}:${next.generation}`;
        if (url && confirmedIdentity !== displayedIdentity) clearImage();
        const deadline = started + next.frame.validForMs;
        if (next.frame.id === frameId) {
          // A faster metadata reply can narrow the original conservative estimate.
          if (deadline > expiresAt) setExpiry(deadline);
          return;
        }
        const remaining = deadline - performance.now();
        if (remaining <= 0 || signal.aborted) return;
        if (next.frame.validForMs < REACTION_MANAGEMENT_POLL_TIMEOUT_MS) {
          imageDeadline = setTimeout(() => operation.abort(), Math.ceil(remaining));
        }
        const blob = await race(image(next.frame.id, signal));
        if (!live() || signal.aborted) return;
        const candidate = URL.createObjectURL(blob); const decoded = new Image(); decoded.src = candidate;
        try { await race(decoded.decode()); } catch { URL.revokeObjectURL(candidate); throw new Error('画像を読み込めません。'); }
        const latest = current.current;
        if (!live() || signal.aborted || !latest?.frame || latest.instance !== next.instance || latest.generation !== next.generation) { URL.revokeObjectURL(candidate); return; }
        if (performance.now() >= deadline) { URL.revokeObjectURL(candidate); return; }
        if (url) URL.revokeObjectURL(url);
        url = candidate; frameId = next.frame.id; displayedIdentity = confirmedIdentity;
        setAspectRatio(`${next.frame.canvasWidth}/${next.frame.canvasHeight}`);
        setImageIdentity(displayedIdentity); setSrc(url);
        setExpiry(deadline);
      } catch (failure) {
        const status = failure instanceof Error && 'status' in failure ? failure.status : undefined;
        const temporary = typeof status !== 'number' || status === 429 || status >= 500;
        const latest = current.current;
        const identity = latest?.frame ? `${latest.instance}:${latest.generation}` : '';
        if (live() && !(temporary && url && identity === displayedIdentity && performance.now() < expiresAt)) release();
      }
      finally { clearTimeout(imageDeadline); inFlight = false; if (!stopped && !document.hidden) { if (immediate) void load(); else timer = setTimeout(() => void load(), REACTION_MANAGEMENT_POLL_INTERVAL_MS); } }
    };
    const refresh = () => {
      clearTimeout(timer);
      release();
      immediate = true;
      if (!inFlight) void load();
    };
    refreshPreview.current = refresh;
    const visible = () => { clearTimeout(timer); if (document.hidden) release(); else { immediate = true; if (!inFlight) void load(); } };
    document.addEventListener('visibilitychange', visible); void load();
    return () => { stopped = true; refreshPreview.current = null; clearTimeout(timer); document.removeEventListener('visibilitychange', visible); release(); };
  }, [active, request, image, apply, abandonDrag]);
  useEffect(() => {
    if (!namedShare?.url) return;
    const expiresAt = namedShare.expiresAt;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) { setExpiredShare(expiresAt); return; }
      timer = setTimeout(schedule, Math.min(remaining, 2_147_483_647));
    };
    schedule();
    return () => clearTimeout(timer);
  }, [namedShare?.url, namedShare?.expiresAt]);
  useEffect(() => {
    if (!shareUrl) return;
    let cancelled = false;
    void QRCode.toDataURL(shareUrl, { width: 160, margin: 1 }).then(
      src => { if (!cancelled) setQr({ url: shareUrl, src }); },
      () => { if (!cancelled) setQr({ url: shareUrl, src: '' }); },
    );
    return () => { cancelled = true; };
  }, [shareUrl]);
  useLayoutEffect(() => {
    const viewport = previewViewport.current, preview = previewImage.current, center = zoomCenter.current;
    zoomCenter.current = null;
    if (!viewport || !preview) return;
    viewport.scrollLeft = center ? center.x * preview.offsetWidth - viewport.clientWidth / 2 : 0;
    viewport.scrollTop = center ? center.y * preview.offsetHeight - viewport.clientHeight / 2 : 0;
  }, [zoom]);
  const beginEdit = () => {
    const state = current.current;
    if (!state?.available) return;
    const operation = desktopOperation.current;
    const instance = state.instance;
    const result = Promise.resolve(editPreparation.current?.result).catch(() => undefined).then(async () => {
      if (!mounted.current || operation !== desktopOperation.current) return;
      if (instance !== current.current?.instance) throw new Error(restartedDuringOperation);
      const next = await request('edit', undefined, undefined, instance);
      apply(next);
      if (instance !== next.instance) throw new Error(restartedDuringOperation);
      return next;
    });
    const preparation = { instance, result };
    editPreparation.current = preparation;
    void result.catch(failure => { if (mounted.current && preparation === editPreparation.current && operation === desktopOperation.current) setError(failure instanceof Error ? failure.message : 'PC表示を一時停止できません。'); });
  };
  const edit = (next: ReactionSettings) => {
    if (!current.current?.available) return;
    const wasDragging = !!drag.current;
    cancelDrag();
    desktopOperation.current++;
    if (!wasDragging) beginEdit();
    version.current++; dirtyRef.current = true; setDirty(true); setDraft({ ...next, binding: null }); setError('');
  };
  const save = useCallback(async (candidate: ReactionSettings, revision: number) => {
    if (pending.current || !current.current?.available) return;
    pending.current = true; setBusy(true);
    try {
      const preparation = editPreparation.current;
      await preparation?.result;
      if (!mounted.current || version.current !== revision) return;
      if (preparation && preparation.instance !== current.current?.instance) throw new Error(restartedDuringOperation);
      const next = await request('settings', candidate, undefined, preparation?.instance);
      if (mounted.current && version.current === revision) {
        apply(next, { savedSettings: true });
        setError(''); notice.current('設定を保存しました。', 'success');
      }
    }
    catch (failure) { if (mounted.current && version.current === revision) setError(failure instanceof Error ? failure.message : '保存できません。'); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }, [request, apply]);
  useEffect(() => { if (!dirty || busy || error || dragRegion) return; const timer = setTimeout(() => void save(draft, version.current), 500); return () => clearTimeout(timer); }, [dirty, busy, error, draft, save, dragRegion]);
  const editPreview = (next: PreviewDraft) => {
    previewVersion.current++;
    setPreviewDraft(next);
    setPreviewError('');
  };
  const savePreview = useCallback(async (candidate: PreviewDraft, revision: number) => {
    const saved = current.current?.settings.preview;
    if (previewPending.current || !saved || previewVersion.current !== revision) return;
    const channel = twitchChannel(candidate.twitchChannel), videoId = youtubeVideoId(candidate.youtubeUrl);
    if (candidate.mode === 'twitch' && channel === null || candidate.mode === 'youtube' && videoId === null) return;
    previewPending.current = true;
    setPreviewBusy(true);
    setPreviewError('');
    try {
      const next = await request('preview-settings', {
        mode: candidate.mode, twitchChannel: channel ?? saved.twitchChannel, youtubeVideoId: videoId?.startsWith('@') || /^UC[\w-]{22}$/u.test(videoId ?? '') ? '' : videoId ?? saved.youtubeVideoId,
        ...(videoId === null && saved.youtubeTarget ? {youtubeTarget:saved.youtubeTarget} : videoId?.startsWith('@') || /^UC[\w-]{22}$/u.test(videoId ?? '') ? {youtubeTarget:videoId} : {}),
      });
      apply(next);
      if (mounted.current && previewVersion.current === revision) {
        setPreviewDraft(null);
        notice.current('設定を保存しました。', 'success');
      }
    } catch (failure) {
      if (mounted.current && previewVersion.current === revision) setPreviewError(failure instanceof Error ? failure.message : 'リスナーページの映像設定を保存できません。');
    } finally {
      previewPending.current = false;
      if (mounted.current) setPreviewBusy(false);
    }
  }, [request, apply]);
  useEffect(() => {
    if (!previewDraft || previewBusy || previewError || previewValidation) return;
    const revision = previewVersion.current;
    const timer = setTimeout(() => void savePreview(previewDraft, revision), 500);
    return () => clearTimeout(timer);
  }, [previewDraft, previewBusy, previewError, previewValidation, savePreview]);
  const action = async (name: string, body?: unknown) => {
    if (pending.current && name !== 'stop' && name !== 'unpublish') return;
    if (name === 'stop' && stoppingDesktop) return;
    if (name === 'stop' || name === 'unpublish') desktopOperation.current++;
    const desktopAction = ['detect','start','test','auto-start'].includes(name), operation = desktopAction ? ++desktopOperation.current : 0;
    const currentOperation = () => !desktopAction || operation === desktopOperation.current;
    const serial = name !== 'stop' && name !== 'unpublish'; if (serial) { pending.current = true; setBusy(true); }
    const preparing = name === 'start' || name === 'detect';
    const before = preparing ? current.current : null;
    if (preparing) setPreparingDesktop(true);
    if (name === 'stop') setStoppingDesktop(true);
    try {
      const editResult = desktopAction && name !== 'test' ? await editPreparation.current?.result.catch(() => undefined) : undefined;
      if (!currentOperation()) return;
      const prepared = before && editResult?.instance === before.instance && editResult.revision > before.revision ? editResult : before;
      const operationToken = prepared?.desktop.operationToken;
      const requestBody = operationToken ? { ...(body && typeof body === 'object' ? body : {}), operationToken } : body;
      const next = await request(name, requestBody);
      if (!currentOperation()) return;
      apply(next);
      if (name === 'stop') setPreparingDesktop(false);
      setError('');
      onNotice(name === 'test' ? 'テスト演出を送信しました。' : '操作を反映しました。', 'success');
    }
    catch (failure) { if (!currentOperation()) return; const message = failure instanceof Error ? failure.message : '操作できません。'; setError(message); onNotice(message, 'error'); }
    finally {
      if (serial) pending.current = false;
      if (mounted.current) {
        if (serial) setBusy(false);
        if (preparing) setPreparingDesktop(false);
        if (name === 'stop') setStoppingDesktop(false);
      }
    }
  };
  const imageReady = !!src && imageIdentity === `${view?.instance}:${view?.generation}`;
  const canEdit = !!view?.available;
  const unavailable = busy || dirty || !!dragRegion || !view?.available;
  const coordinate = (event: PointerEvent<HTMLDivElement>) => { const rect = event.currentTarget.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) }; };
  const rangeAt = (event: PointerEvent<HTMLDivElement>) => { const a = drag.current!, b = coordinate(event); return { x: Math.min(a.x,b.x), y: Math.min(a.y,b.y), width: Math.abs(a.x-b.x), height: Math.abs(a.y-b.y) }; };
  const changeZoom = (next: number | null) => {
    if (drag.current || pan.current || zoom === next) return;
    const viewport = previewViewport.current, preview = previewImage.current;
    if (next !== null && viewport && preview) {
      zoomCenter.current = zoom === null
        ? { x: draft.region.x + draft.region.width / 2, y: draft.region.y + draft.region.height / 2 }
        : { x: (viewport.scrollLeft + viewport.clientWidth / 2) / preview.offsetWidth, y: (viewport.scrollTop + viewport.clientHeight / 2) / preview.offsetHeight };
    }
    if (next === null) setPanning(false);
    setZoom(next);
  };
  const pressPreview = (event: PointerEvent<HTMLDivElement>) => {
    if (!imageReady || drag.current || pan.current || event.button !== 0) return;
    if (panning && previewViewport.current) {
      const { scrollLeft, scrollTop } = previewViewport.current;
      event.currentTarget.setPointerCapture(event.pointerId);
      pan.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: scrollLeft, top: scrollTop };
    } else if (!busy && canEdit) {
      event.currentTarget.setPointerCapture(event.pointerId);
      desktopOperation.current++;
      drag.current = { ...coordinate(event), pointerId: event.pointerId };
      setDragRegion(rangeAt(event));
      beginEdit();
    }
  };
  const movePreview = (event: PointerEvent<HTMLDivElement>) => {
    const moving = pan.current, viewport = previewViewport.current;
    if (moving && moving.pointerId === event.pointerId && viewport) {
      viewport.scrollLeft = moving.left + moving.x - event.clientX;
      viewport.scrollTop = moving.top + moving.y - event.clientY;
    } else if (drag.current && drag.current.pointerId === event.pointerId && imageReady) {
      setDragRegion(rangeAt(event));
    }
  };
  const cancelPreview = (event: PointerEvent<HTMLDivElement>) => {
    if (pan.current && pan.current.pointerId === event.pointerId) pan.current = null;
    if (drag.current && drag.current.pointerId === event.pointerId) abandonDrag();
  };
  const finishPreview = (event: PointerEvent<HTMLDivElement>) => {
    if (pan.current && pan.current.pointerId === event.pointerId) { pan.current = null; return; }
    if (!drag.current || event.pointerId !== drag.current.pointerId || !imageReady) return;
    const region = rangeAt(event);
    if (region.width > .005 && region.height > .005) edit({ ...draft, region });
    else abandonDrag();
  };
  const copyShareLink = async () => {
    const copyUrl = namedShare?.url && namedShare.expiresAt <= Date.now() ? directShareUrl : shareUrl;
    if (!copyUrl) return;
    try {
      await navigator.clipboard.writeText(copyUrl);
      onNotice('共有リンクをコピーしました。', 'success');
    } catch {
      onNotice('コピーできません。表示されている共有リンクを選択してコピーしてください。', 'error');
    }
  };
  const manageShareLink = async (claim: boolean) => {
    if (sharePending.current || !directShareUrl) return;
    sharePending.current = true;
    setShareBusy(true);
    try {
      const next = await request(claim ? 'share-claim' : 'share-refresh', claim ? { name: shareName, invite } : {});
      apply(next);
      if (claim && mounted.current) { setInvite(''); setShareName(''); }
      notice.current(claim ? '名前付きリンクを保存しました。' : '共有リンクを確認しました。', 'success');
    } catch (failure) {
      notice.current(failure instanceof Error ? failure.message : '名前付きリンクを確認できません。', 'error');
    } finally {
      sharePending.current = false;
      if (mounted.current) setShareBusy(false);
    }
  };
  const shownRegion = dragRegion ?? draft.region;
  const target = draft.target;
  const savedTargetMatches = target && matchesTarget(target, view?.settings.target);
  const draftMatches = target && !savedTargetMatches ? view?.windows.filter(window => matchesTarget(target, window)) : undefined;
  const targetId = savedTargetMatches ? view?.selectedId ?? '' : draftMatches?.length === 1 ? draftMatches[0].id : '';
  const targetPlaceholder = !view ? '表示先を確認しています…'
    : target && !targetId ? `${isReactionDisplay(target) ? '設定済みのモニター' : target.title}（確認待ち）` : null;
  const canPublish = !publication || publication.status === 'off' || publication.status === 'error';
  const autoStartUnavailable = busy || dirty || !view?.available || (!draft.autoStartOnPublish && !!draft.target && !draft.binding?.fingerprint && !imageReady);
  const desktop = view?.desktop;
  const canTestDesktop = !busy && !dirty && !dragRegion && !stoppingDesktop && !!desktop?.enabled;
  const waitingForDesktop = preparingDesktop || desktop?.preparing;
  const waitingForScene = desktop?.resume === 'scene';
  const canStopDesktop = stoppingDesktop || waitingForDesktop || waitingForScene || desktop?.enabled || desktop?.resume === 'editing';
  const desktopState = stoppingDesktop ? 'stopping' : waitingForDesktop ? 'preparing' : desktop?.showing ? 'showing' : desktop?.enabled || desktop?.resume === 'editing' || waitingForScene ? 'paused' : desktop?.resume === 'confirmation' ? 'confirmation' : 'stopped';
  const desktopLabels = { stopping: '停止処理中', preparing: '準備中', showing: '表示中', paused: '一時停止中', confirmation: '確認待ち', stopped: '停止中' };
  const startUnavailable = unavailable || !imageReady || !draft.target || !view?.selectedId;
  const desktopMessage = desktop?.message === 'PC表示を停止しました。' ? '' : desktop?.message;
  const obsFrameMissing = !view?.frame;
  const startHint = !draft.target ? '手動で開始するには表示先を選んでください。' : !view?.selectedId ? '表示先のウィンドウやモニターを確認してください。' : obsFrameMissing ? 'OBSの最新画像を待っています。' : '';
  const minimized = view?.windows.some(window => window.id === view.selectedId && window.minimized);
  const foregroundOnly = !isReactionDisplay(draft.target) && draft.foregroundOnly;
  const pausedReason = obsFrameMissing ? 'OBSの最新画像を待っています。' : minimized ? '表示先が最小化されています。' : foregroundOnly ? '表示先を前面に出してください。' : '表示先のウィンドウやモニターを確認してください。';
  const desktopReason = desktopState === 'paused' ? desktop?.enabled ? pausedReason : desktop?.message
    : desktopState === 'confirmation' ? [startHint, desktopMessage || '赤枠を確認してください。'].filter(Boolean).join(' ')
    : desktopState === 'preparing' ? preparingDesktop ? '' : desktopMessage
    : desktopState === 'stopped' ? [view?.available ? startHint : '', desktopMessage].filter(Boolean).join(' ') : '';
  return <SettingsCard cardId="listenerReactions" title="リスナーリアクション" eyebrow="LISTENER REACTIONS" navigationWarning={error || previewError || previewValidation || (dirty || previewDraft ? '設定が未保存です。' : undefined)}>
    <div className="reaction-settings">
      <section className="reaction-section reaction-publication" aria-label="リスナーページ">
        <div className="reaction-section-heading">
          <h3>リスナーページ</h3>
          <p className="reaction-public-status" role="status" data-online={publication?.status === 'online'}>{publication?.status === 'online' ? '公開中' : publication?.message || '未公開'}</p>
        </div>
        <div className="reaction-public-controls">
          <div className="reaction-fields">
            <p>{preview.mode === 'obs' ? 'OBSの出力映像を静止画で公開し、リアクションを受け付けます。' : 'ライブ動画と、場所の指定に使うOBS静止画を公開し、リアクションを受け付けます。'}</p>
            <div className="button-row">
              <Action disabled={!canPublish || busy || dirty || !!previewDraft || !view?.available} onClick={() => void action('publish')}>リスナーページを公開</Action>
              <Action className="secondary" disabled={!publication || publication.status === 'off'} onClick={() => void action('unpublish')}>公開を停止</Action>
            </div>
            <label>リスナーページの映像<select value={preview.mode} disabled={!view?.available} aria-describedby="reaction-preview-save-status" onChange={event => {
              const mode = event.target.value;
              if (mode === 'obs' || mode === 'twitch' || mode === 'youtube') editPreview({ ...preview, mode });
            }}>
              <option value="obs">OBS静止画</option>
              <option value="twitch">Twitch</option>
              <option value="youtube">YouTube Live</option>
            </select></label>
            {preview.mode === 'twitch' && <label>Twitchチャンネル名<input type="text" value={preview.twitchChannel} maxLength={25} autoComplete="off" spellCheck={false} disabled={!view?.available} aria-invalid={!!previewValidation || undefined} aria-describedby="reaction-preview-save-status" onChange={event => editPreview({ ...preview, twitchChannel: event.target.value })}/></label>}
            {preview.mode === 'youtube' && <label>YouTube Liveの配信URL<input type="text" inputMode="url" placeholder="配信URL・LIVE ID・@ハンドル" value={preview.youtubeUrl} maxLength={2048} autoComplete="off" spellCheck={false} disabled={!view?.available} aria-invalid={!!previewValidation || undefined} aria-describedby="reaction-preview-save-status" onChange={event => editPreview({ ...preview, youtubeUrl: event.target.value })}/></label>}
            <div className="reaction-save">
              <p className="reaction-save-status" id="reaction-preview-save-status" role="status">{previewValidation || previewError || (previewBusy ? '保存中です…' : previewDraft ? '保存を待っています…' : preview.mode === 'obs' ? '' : '未入力の場合はOBS静止画を表示します。')}</p>
              <Action className="secondary" disabled={previewBusy || !previewError || !!previewValidation || !view?.available} onClick={() => { if (previewDraft) void savePreview(previewDraft, previewVersion.current); }}>映像設定を再保存</Action>
            </div>
            <p>@ハンドルは公開開始時に現在のライブを探します。公開中の変更はリスナーページへ自動で反映されます。</p>
          </div>
          <div className="reaction-fields">
            <div className="reaction-share">
              <div><strong>共有リンク</strong><div className="reaction-url-slot"><a href={shareUrl ?? undefined} target="_blank" rel="noreferrer" aria-disabled={!shareUrl || undefined} tabIndex={shareUrl ? undefined : -1}>{shareUrl ?? '公開後に表示'}</a></div></div>
              <Action className="secondary" disabled={!shareUrl} onClick={() => void copyShareLink()}>リンクをコピー</Action>
            </div>
            {namedShare && <details><summary>名前付きリンク（テスト）</summary><div className="reaction-fields">
              <p>名前は半角英数字とハイフンで3〜40文字。30日間使われなかった名前は、別の配信者が取得できます。</p>
              <label>リンクの名前<input value={shareName} onChange={event => setShareName(event.target.value)} maxLength={40} placeholder={namedShare.name ?? 'yofukashi'} autoComplete="off" /></label>
              {!namedShare.enrolled && <label>テスト利用者用の招待コード<input type="password" value={invite} onChange={event => setInvite(event.target.value)} maxLength={64} autoComplete="off" /></label>}
              <div className="button-row">
                <Action disabled={shareBusy || !directShareUrl || !shareName.trim() || !namedShare.enrolled && !invite.trim()} onClick={() => void manageShareLink(true)}>{namedShare.name ? 'リンクの名前を変更' : '名前付きリンクを発行'}</Action>
                <Action className="secondary" disabled={shareBusy || !directShareUrl} onClick={() => void manageShareLink(false)}>リンクを再確認</Action>
              </div>
              <p className="reaction-url-slot" role="status">{namedShare.message || (namedShare.name ? `登録中の名前 ${namedShare.name}` : '公開後に発行できます。')}</p>
            </div></details>}
            <details><summary>QRコード</summary><div className="reaction-qr-slot">
              {!shareUrl && <p>公開後に表示されます。</p>}
              {shareUrl && qr?.url === shareUrl && (qr.src
                ? <img src={qr.src} width="160" height="160" alt="リスナーページのQRコード"/>
                : <p>QRコードを作成できません。共有リンクを使ってください。</p>)}
            </div></details>
          </div>
        </div>
        <details className="reaction-details"><summary>自動公開・PC表示の連動</summary><div className="reaction-fields">
          <label className="check"><input type="checkbox" checked={draft.publishOnStartup} aria-disabled={busy || dirty || !view?.available || undefined} onChange={event => { if (busy || dirty || !view?.available) return; void action('startup-publication', { enabled: event.target.checked }); }}/>起動時に公開する</label>
          <p>次回起動時から、場所の指定に使うOBS静止画も公開します。</p>
          <label className="check"><input type="checkbox" checked={draft.autoStartOnPublish} aria-disabled={autoStartUnavailable || undefined} onChange={event => { if (!autoStartUnavailable) void action('auto-start', { enabled: event.target.checked }); }}/>公開時にPC表示も開始する</label>
          <p>表示先が未設定ならOBSから選びます。手動で範囲を決めた場合は赤枠を確認してください。PC表示を開始できなくても公開は続きます。</p>
        </div></details>
      </section>
      <section className="reaction-section reaction-obs" aria-label="OBS表示">
        <h3>OBS表示</h3>
        <Action className="secondary" onClick={event => onRegisterSource({ target: { kind: 'overlay', overlay: 'reactions' }, title: 'リスナーリアクション', entry: event.currentTarget })}>OBSにソースを追加</Action>
      </section>
      <section className="reaction-section" aria-label="PC表示">
        <div className="reaction-section-heading">
          <h3>PC表示</h3>
          <TestActionButton aria-disabled={!canTestDesktop} onClick={() => { if (canTestDesktop) void action('test'); }}>テスト表示</TestActionButton>
        </div>
        <div className="reaction-desktop-layout" data-expanded={zoom !== null}>
          <div className="reaction-fields">
            <label>表示先<select value={targetPlaceholder ? unresolvedTargetId : targetId} disabled={!canEdit} onChange={event => {
              const id = event.target.value;
              const w = view?.windows.find(w => w.id === id);
              if (!w && id) return;
              edit({ ...draft, target: w ? { title: w.title, processName: w.processName, className: w.className } : null });
            }}>
              {targetPlaceholder && <option value={unresolvedTargetId} disabled>{targetPlaceholder}</option>}
              <option value="">OBSから自動選択（公開時）</option>
              {view?.windows.map(w => <option key={w.id} value={w.id}>{isReactionDisplay(w) ? w.label ?? `モニター ${w.displayName ?? w.title}` : `${w.title}（${w.processName}）`}</option>)}
            </select></label>
            <strong>表示範囲</strong>
            <div className="button-row">
              <Action className="secondary" disabled={unavailable || !imageReady || !view?.selectedId} onClick={() => void action('detect', { targetId: view?.selectedId })}>自動で合わせる</Action>
              <Action className="secondary" disabled={busy || !canEdit} onClick={() => edit({ ...draft, region: { x: 0,y: 0,width: 1,height: 1 } })}>画像全体に戻す</Action>
            </div>
            <p>手動で合わせるときは、画像をドラッグしてコメント欄や上下の帯まで囲みます。</p>
            <Action className="secondary reaction-expand-preview" aria-expanded={zoom !== null} aria-controls="reaction-preview-tools" disabled={!!dragRegion} onClick={() => changeZoom(zoom === null ? 150 : null)}>{zoom === null ? 'プレビューを拡大' : '元の表示に戻す'}</Action>
          </div>
          <div className="reaction-fields">
            <div className="reaction-fields" id="reaction-preview-tools" hidden={zoom === null}>
              <div className="button-row">
                <label className="reaction-zoom-label">倍率<select value={zoom ?? 150} disabled={!!dragRegion} onChange={event => changeZoom(Number(event.target.value))}>
                  <option value={100}>100%</option><option value={150}>150%</option><option value={200}>200%</option>
                </select></label>
                <Action className="secondary" disabled={!!dragRegion} onClick={() => { if (!pan.current) setPanning(!panning); }}>{panning ? '範囲指定に戻る' : '画像を移動'}</Action>
              </div>
              <p aria-live="polite">{panning ? 'ドラッグして画像を移動します。' : 'ドラッグして赤枠を描きます。'}</p>
            </div>
            <div ref={previewViewport} className="reaction-preview-viewport" data-expanded={zoom !== null} data-panning={panning} style={{ aspectRatio }}>
              <div ref={previewImage} className="reaction-range-preview" style={{ aspectRatio, width: zoom ? `${zoom}%` : undefined }} onPointerDown={pressPreview} onPointerMove={movePreview} onPointerUp={finishPreview} onPointerCancel={cancelPreview} onLostPointerCapture={cancelPreview}>
                {src ? <img src={src} alt="範囲を指定するOBS映像の静止画" draggable={false}/> : <span>OBSの最新画像を待っています</span>}
                <div className="reaction-range-border" hidden={!src} style={{ left: `${shownRegion.x*100}%`, top: `${shownRegion.y*100}%`, width: `${shownRegion.width*100}%`, height: `${shownRegion.height*100}%` }}/>
              </div>
            </div>
            <div className="reaction-resume-panel" data-state={desktopState}>
              <div className="reaction-resume-status" role="status">
                <div className="reaction-state-label"><span className="reaction-state-mark" aria-hidden="true"/><strong>{waitingForScene && desktopState === 'paused' ? '再判定待ち' : desktopLabels[desktopState]}</strong></div>
                {desktopReason && <p>{desktopReason}</p>}
              </div>
              <Action className={canStopDesktop ? 'secondary' : undefined} disabled={stoppingDesktop || (!canStopDesktop && startUnavailable)} onClick={() => void action(canStopDesktop ? 'stop' : 'start')}>
                {canStopDesktop ? 'PC表示を停止' : desktopState === 'confirmation' ? '範囲を確認して再開' : 'PC表示を開始'}
              </Action>
            </div>
          </div>
        </div>
        <details className="reaction-details"><summary>数値で調整・表示条件</summary><div className="reaction-fields">
          <div className="reaction-number-grid">{(['x','y','width','height'] as const).map((key,i) => <label key={key}>{['左端','上端','幅','高さ'][i]}（%）<input type="number" min="0" max="100" step="0.1" disabled={!canEdit} value={Math.round(draft.region[key]*10000)/100} onChange={event => edit({ ...draft, region: { ...draft.region, [key]: Number(event.target.value)/100 } })}/></label>)}</div>
          <div className="reaction-number-grid">{(['left','top','right','bottom'] as const).map((key,i) => <label key={key}>ウィンドウ余白 {['左','上','右','下'][i]}（px）<input type="number" min="0" max="8192" disabled={!canEdit || isReactionDisplay(draft.target)} value={isReactionDisplay(draft.target)?0:draft.insets[key]} onChange={event => edit({ ...draft, insets: { ...draft.insets, [key]: Number(event.target.value) } })}/></label>)}</div>
          <label className="check"><input type="checkbox" disabled={!canEdit || isReactionDisplay(draft.target)} checked={!isReactionDisplay(draft.target) && draft.foregroundOnly} onChange={event => edit({ ...draft, foregroundOnly: event.target.checked })}/>対象ウィンドウが前面のときだけ表示</label>
          <p>OBS画面全体に合わせるため、対象ウィンドウの外側にも重なります。前面に限定しない場合は、対象が背面でも表示します。</p>
          <p>モニターには余白と前面の設定は適用されません。</p>
          <p>ウィンドウは通常またはボーダーレス表示で使用してください。OBSへの映り込みは取り込み方式によって異なります。</p>
        </div></details>
        <div className="reaction-save">
          <div className="reaction-save-status" role="status">{error || view?.error || (busy ? '処理中です…' : dirty ? '未保存の設定があります' : '')}</div>
          <Action className="secondary" disabled={busy || !dirty || !canEdit} onClick={() => { setError(''); beginEdit(); void save(draft, version.current); }}>設定を再保存</Action>
        </div>
      </section>
    </div>
  </SettingsCard>;
}
