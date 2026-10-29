import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ManagementNavigation, SetupPresentation, managementPages, managementSections, isSmartphoneEditor, isSetupWorkspace, setupEditor, setupValidationEditors, type ManagementEditor, type ManagementPage } from '../management-navigation';
import { ManagementWarnings, type ManagementWarningItem } from './ManagementWarnings';
import { ManagementToast } from './ManagementToast';
import { ManagementEditorHeading } from './ManagementEditorHeading';
import { managementThemeStyle } from '../management-themes';
import { defaultManagementTheme, type ManagementThemeId } from '../../shared/management-theme';
import { defaultManagementTextSize, type ManagementTextSizeId } from '../../shared/management-text-size';
import { managementTextSizeStyle } from '../management-text-sizes';
import { InitialSetupObsConnectionStatus, InitialSetupHeader, InitialSetupFooter, InitialSetupReview, InitialSetupWorkspaceActions, InitialSetupConfirmation, InitialSetupObsRegistration, type InitialSetupProps } from './InitialSetup';
import type { ConnectionKey } from '../../shared/types';
import type { SmartphoneNetwork } from '../../shared/smartphone';
import type { InitialSetupAction } from '../../shared/initial-setup';
import { initialSetupSteps, setupConfigured, type SetupStep } from '../../shared/initial-setup';
import { useManagementHistory } from '../use-management-history';

const introductions: Partial<Record<ManagementEditor, string>> = {
  application: 'PCアプリの配色・文字サイズ・接続設定を変更します。',
  urls: 'コメントや演出など、使う表示をOBSへ追加します。',
  smartphone: 'コメント・音声・映像を使うスマホの接続を準備します。',
  obsControl: '音声・Androidから、確認付きでOBS配信を操作します。',
  textEffects: '専用のOBS表示で、コメントに反応する文字や絵文字を出します。',
  commentOverlay: 'OBSに表示するコメントの見え方を調整します。',
  speechRecognitionOverlay: 'OBSに表示する音声認識の見え方を調整します。',
  nextThread: '次スレッドの作成と、接続先の切替を設定します。',
  commentList: '手元・ブラウザ・スマホのコメント一覧を調整します（OBS表示は別設定）。',
  aiListener: '配信に参加するAIの話し方や参加先を設定します。',
  sources: 'YouTube・Twitch・掲示板の接続先と自動接続を設定します。',
  commentSpeech: 'VOICEVOXで新着コメントを読み上げます。',
  commentFilter: '不要なコメントを、表示・読み上げ・演出から除外します。',
  speechRecognition: '配信者の声をPC内で日本語に認識します。',
  character: 'キャラクターの表示・ウィンドウと詳細設定を確認します。',
};

export type OpenEditor = (editor: ManagementEditor, entry: HTMLElement, target?: string) => void;
export interface ManagementWarning {
  id: ManagementEditor;
  message: string;
  target?: string;
  key?: string;
  onSelect?(entry: HTMLButtonElement): void;
}
// Both editors save the sources settings section; other editors own separate settings.
const warningOwner = (id: ManagementEditor) => id === 'nextThread' ? 'sources' : id;

export function ManagementShell({ children, home, live, smartphoneStatus, obsStatus, windows, connected, pcStatus, connectionError, settingsWarning, operationNotice, warnings, activities, initialSetup, onInitialSetupInterrupted, updateNotices = [], theme = defaultManagementTheme, textSize = defaultManagementTextSize }: {
  initialSetup?: InitialSetupProps;
  onInitialSetupInterrupted?(): void;
  theme?: ManagementThemeId;
  textSize?: ManagementTextSizeId;
  children: ReactNode; home: ReactNode; connected: boolean;
  live?: ReactNode; smartphoneStatus?: ReactNode; obsStatus?: ReactNode;
  pcStatus: ReactNode; connectionError?: string; settingsWarning?: string; operationNotice?: { message: string; tone: 'success' | 'error' };
  warnings: ManagementWarning[]; activities: ManagementWarning[];
  updateNotices?: (ManagementWarningItem & { owner?: ManagementEditor })[];
  windows: ReactNode;
}) {
  const [page, setPage] = useState<ManagementPage>('home');
  const [visitedPages, setVisitedPages] = useState<Partial<Record<ManagementPage, boolean>>>({ home: true });
  const [editor, setEditor] = useState<ManagementEditor | null>(null);
  const [setupOpen, setSetupOpen] = useState(initialSetup?.view.autoShow === true);
  const [setupSource, setSetupSource] = useState<ConnectionKey>('youtube');
  const [effectExample, setEffectExample] = useState('ww と www');
  const [effectRuleId, setEffectRuleId] = useState('');
  const [characterMouth, setCharacterMouth] = useState<'closed' | 'open'>('closed');
  const [setupPhoneNetwork, setSetupPhoneNetwork] = useState<SmartphoneNetwork>();
  const [setupDisclosures, setSetupDisclosures] = useState<Record<string, boolean>>({});
  const setupNavigation = useRef(0);
  const setupCommandPending = useRef(false);
  const setupReloadOrigin = useRef<{ element: Element | null; navigation: number } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const scroll = useRef<HTMLDivElement>(null);
  const origin = useRef<{ page: ManagementPage; top: number; entry: string } | null>(null);
  const focus = useRef<{ id: string; element?: HTMLElement; top?: number } | null>(null);
  const reportError = useCallback((id: string, error: string | undefined) => {
    setErrors(current => current[id] === (error ?? '') ? current : { ...current, [id]: error ?? '' });
  }, []);
  const open: OpenEditor = (id, entry, target) => {
    if (setupOpen && !editor && (initialSetup?.pending || setupCommandPending.current)) return;
    setupNavigation.current++;
    history.cancel();
    history.remember();
    if (isSmartphoneEditor(id)) id = 'smartphone';
    if (!editor) origin.current = { page, top: scroll.current?.scrollTop ?? 0, entry: entry.id };
    focus.current = { id: target ?? 'editor-heading' };
    setEditor(id);
    // Also support links into another field of the editor already being displayed.
    if (editor === id) requestAnimationFrame(() => focusTarget());
  };
  const focusTarget = () => {
    const requested = focus.current;
    if (!requested || !scroll.current) return;
    const target = (requested.element?.isConnected ? requested.element : null) ?? document.getElementById(requested.id) ?? document.getElementById(editor ? 'editor-heading' : setupOpen ? 'setup-heading' : 'page-heading');
    if (requested.top !== undefined) {
      scroll.current.scrollTop = Math.min(requested.top, Math.max(0, scroll.current.scrollHeight - scroll.current.clientHeight));
      target?.focus({ preventScroll: true });
    } else {
      // Reveal only the disclosures containing the requested item.
      for (let ancestor = target?.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
      }
      scroll.current.scrollTop = 0;
      target?.focus({ preventScroll: true });
      if (requested.id !== 'editor-heading' && requested.id !== 'page-heading') target?.scrollIntoView?.({ block: 'center' });
    }
    focus.current = null;
  };
  useLayoutEffect(focusTarget, [page, editor, setupOpen, initialSetup?.view.position]);
  useLayoutEffect(() => {
    const requested = setupReloadOrigin.current;
    if (!requested || initialSetup?.pending) return;
    setupReloadOrigin.current = null;
    if (!initialSetup?.view.warning && requested.navigation === setupNavigation.current &&
      !requested.element?.isConnected && document.activeElement === document.body) {
      document.getElementById('setup-heading')?.focus({ preventScroll: true });
    }
  }, [initialSetup?.pending, initialSetup?.view.warning, initialSetup?.view.position]);
  const leaveSetup = (interrupted = false) => {
    setupNavigation.current++;
    history.cancel();
    history.remember();
    if (interrupted) onInitialSetupInterrupted?.();
    setSetupOpen(false); setEditor(null); setPage('home'); origin.current = null; focus.current = { id: 'page-heading', top: 0 };
  };
  const openSetup = () => { setupNavigation.current++; history.cancel(); history.remember(); setSetupOpen(true); setEditor(null); origin.current = null; focus.current = { id: 'setup-heading', top: 0 }; };
  const performSetup = async (command: InitialSetupAction) => {
    if (!initialSetup || initialSetup.pending || setupCommandPending.current) return false;
    setupCommandPending.current = true;
    const navigation = setupNavigation.current;
    if (command.action === 'reload') setupReloadOrigin.current = { element: document.activeElement, navigation };
    history.remember();
    try {
      if (command.action === 'move' || command.action === 'defer') focus.current = { id: 'setup-heading', top: 0 };
      await initialSetup.command({ ...command, revision: initialSetup.view.revision });
      return navigation === setupNavigation.current;
    } catch { if (navigation === setupNavigation.current) focus.current = null; return false; }
    finally { setupCommandPending.current = false; }
  };
  const go = (next: ManagementPage) => {
    setupNavigation.current++;
    history.cancel();
    history.remember();
    if (setupOpen) onInitialSetupInterrupted?.();
    setSetupOpen(false);
    setVisitedPages(current => current[next] ? current : { ...current, [next]: true });
    origin.current = null; focus.current = { id: 'page-heading', top: 0 }; setPage(next); setEditor(null);
    if (page === next && editor === null && !setupOpen) focusTarget();
  };
  const back = () => {
    setupNavigation.current++;
    history.cancel();
    history.remember();
    if (setupOpen) { focus.current = { id: origin.current?.entry || 'setup-detail', top: origin.current?.top ?? 0 }; setEditor(null); origin.current = null; return; }
    const previous = origin.current;
    focus.current = { id: previous?.entry || 'page-heading', top: previous?.top ?? 0 };
    setPage(previous?.page ?? 'home'); setEditor(null); origin.current = null;
  };
  const history = useManagementHistory({
    capture: () => ({ page, editor, setup: setupOpen, position: setupOpen ? initialSetup?.view.position : undefined,
      origin: origin.current ? { ...origin.current } : null,
      focus: { id: document.activeElement?.id || (editor ? 'editor-heading' : setupOpen ? 'setup-heading' : 'page-heading'),
        element: document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : undefined,
        top: scroll.current?.scrollTop ?? 0 } }),
    blocked: Boolean(initialSetup?.pending),
    canRestore: visit => !visit.setup || Boolean(initialSetup && visit.position &&
      (['welcome', 'features', 'summary'].includes(visit.position) || initialSetupSteps(initialSetup.view).includes(visit.position as SetupStep))),
    restore: async (visit, isCurrent) => {
      if (visit.setup && visit.position && visit.position !== initialSetup?.view.position &&
        !await performSetup({ action: 'move', position: visit.position })) return false;
      if (!isCurrent()) return false;
      if (setupOpen && !visit.setup) onInitialSetupInterrupted?.();
      origin.current = visit.origin ? { ...visit.origin } : null;
      focus.current = { ...visit.focus };
      setVisitedPages(current => ({ ...current, [visit.page]: true }));
      setPage(visit.page); setEditor(visit.editor); setSetupOpen(visit.setup);
      return true;
    },
    focusRestored: focusTarget,
  });
  const allWarnings: ManagementWarning[] = [...warnings, ...Object.entries(errors).filter(([, message]) => message)
    .map(([id, message]) => ({ id: id as ManagementEditor, message, key: 'save' }))]
    .filter((warning, index, list) => list.findIndex(other => other.id === warning.id && other.message === warning.message) === index);
  const warningItems: ManagementWarningItem[] = [
    ...(initialSetup?.view.warning ? [{ key: 'initialSetup', message: initialSetup.view.warning, onSelect: openSetup }] : []),
    ...(connectionError ? [{ key: 'backend', message: connectionError }] : []),
    ...(settingsWarning ? [{ key: 'settings', message: settingsWarning }] : []),
    ...updateNotices.map(({ owner, ...item }) => ({ ...item, ...(owner ? {
      onSelect: (entry: HTMLButtonElement) => open(owner, entry),
    } : {}) })),
    ...(operationNotice?.tone === 'error' && !allWarnings.some(warning => warning.message === operationNotice.message)
      ? [{ key: 'operation', message: operationNotice.message }] : []),
    ...allWarnings.filter((warning, index, list) => warning.key !== 'save' ||
      list.findIndex(other => other.key === 'save' && warningOwner(other.id) === warningOwner(warning.id) && other.message === warning.message) === index)
      .sort((a, b) => operationNotice?.tone === 'error'
        ? Number(b.message === operationNotice.message) - Number(a.message === operationNotice.message) : 0)
      .map(warning => ({ key: `warning-${warning.id}-${warning.target ?? warning.key ?? 'state'}`, message: warning.message,
      onSelect: (entry: HTMLButtonElement) => {
        open(warning.id, entry, warning.target);
        warning.onSelect?.(entry);
      } })),
  ];
  const displayEditor = isSmartphoneEditor(editor) ? 'smartphone' : editor;
  const selected = managementSections.flatMap(g => [...g.items]).find(item => item[0] === displayEditor);
  const visibleActivities = activities.filter(activity => activity.id !== 'speechRecognition' || !(editor === 'speechRecognition' || setupOpen && !editor && initialSetup?.view.position === 'speechRecognition' || page === 'live' && !editor));
  const entry = (id: ManagementEditor, title: string, description: string, icon: string, prefix: string) => (
    <button key={id} id={`${prefix}-${id}`} className="management-entry" onClick={event => open(id, event.currentTarget)}>
      <span className="entry-icon" aria-hidden="true">{icon}</span><span><strong>{title}</strong><small>{description}</small></span>
      <span className="management-entry-trailing">
      {(allWarnings.some(warning => warning.id === id || (id === 'smartphone' && isSmartphoneEditor(warning.id))) ||
        updateNotices.some(notice => notice.owner === id || (id === 'smartphone' && isSmartphoneEditor(notice.owner ?? null)))) && <small className="field-error">要確認</small>}<span aria-hidden="true">›</span></span>
    </button>
  );
  const activePage = managementPages.find(item => item[0] === page)!;
  const setupActive = setupOpen && !editor && Boolean(initialSetup);
  const effectiveEditor = setupActive ? initialSetup!.view.position === 'obsDisplay' && !initialSetup!.view.selected.includes('commentOverlay') ? null : setupEditor(initialSetup!.view.position) : editor;
  const showPcStatus = page !== 'settings' && !editor && !setupActive;
  const setupBlocked = Boolean(initialSetup && (initialSetup.settingsPending(initialSetup.view.position) || initialSetup.view.position === 'obsDisplay' && initialSetup.settingsPending('obsControl') ||
    setupValidationEditors(initialSetup.view, initialSetup.view.position).some(id => errors[id])));
  const workspace = setupActive && initialSetup && isSetupWorkspace(initialSetup.view.position);
  const entryScreen = setupActive && initialSetup && ['welcome', 'features', 'summary'].includes(initialSetup.view.position);
  const setupProps = initialSetup ? { ...initialSetup, perform: performSetup, leave: leaveSetup, open, blocked: setupBlocked,
    disclosures: { open: setupDisclosures, change: (id: string, expanded: boolean) => setSetupDisclosures(current => current[id] === expanded ? current : { ...current, [id]: expanded }) } } : null;
  return <ManagementNavigation.Provider value={{ editor: effectiveEditor, page, go, reportError, open, isHistoryNavigation: history.isRestoring, initialSetup: setupActive, setupPosition: setupActive ? initialSetup?.view.position : undefined,
    initialSetupPending: setupActive && Boolean(initialSetup?.pending), initialSetupEntry: initialSetup ? { resume: initialSetup.view.started && !initialSetup.view.completed, open: openSetup } : undefined }}>
    <SetupPresentation.Provider value={{ obsDisplayPlanned: Boolean(initialSetup && initialSetupSteps(initialSetup.view).includes('obsDisplay')), effectExample, setEffectExample, effectRuleId, setEffectRuleId, characterMouth, setCharacterMouth, source: setupSource, selectSource: setSetupSource, smartphoneNetwork: setupPhoneNetwork, selectSmartphoneNetwork: setSetupPhoneNetwork, smartphoneCommentsReady: Boolean(initialSetup && Object.values(initialSetup.snapshot.sourceStatuses).some(status => status.state === 'connected' || status.state === 'waiting') && !initialSetup.settingsPending('sources') && !errors.sources), smartphoneSpeechEnabled: initialSetup?.snapshot.settings.commentSpeech.enabled, smartphoneSpeechReady: Boolean(initialSetup && setupConfigured('commentSpeech', initialSetup.snapshot) && !initialSetup.settingsPending('commentSpeech') && !errors.commentSpeech), smartphoneUses: initialSetup?.view.smartphoneUses, selectionPending: initialSetup?.pending || Boolean(initialSetup?.view.warning), selectSmartphoneUses: uses => { if (initialSetup) void performSetup({ action: 'select', selected: initialSetup.view.selected, smartphoneUses: uses }); }, confirmation: workspace && setupProps ? <InitialSetupConfirmation {...setupProps} /> : undefined, obsRegistration: workspace && setupProps && initialSetup?.view.position === 'obsDisplay' && initialSetup.view.selected.includes('commentOverlay') ? <InitialSetupObsRegistration {...setupProps} /> : undefined }}>
    <main className={`dashboard management-shell${setupActive ? ' management-initial-setup' : ''}${workspace ? ' setup-workspace-active' : ''}${entryScreen ? ' setup-entry-active' : ''}${page === 'live' && !editor && !setupActive ? ' management-live-active' : ''}`} data-setup-step={setupActive ? initialSetup?.view.position : undefined} data-management-theme={theme} data-management-text-size={textSize} style={{ ...managementThemeStyle(theme), ...managementTextSizeStyle(textSize) }} onKeyDown={event => {
      if (event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.type === 'checkbox') {
        event.preventDefault(); event.target.click();
      }
    }}>
      <header className="management-header" data-home={showPcStatus}>
        <div className="management-brand" aria-label="きゃすメイト"><span aria-hidden="true">▤</span><strong>きゃすメイト</strong></div>
        <div className="pc-header-slot" hidden={!showPcStatus}>{pcStatus}</div>
        {!showPcStatus && <span className={`management-connection ${connected ? 'connection-ok' : 'connection-bad'}`}
          role="status" aria-label={connected ? 'アプリ接続済み' : 'アプリに再接続中'} title={connected ? 'アプリ接続済み' : 'アプリに再接続中'}>
          <span className="connection-label" aria-hidden="true">{connected ? 'アプリ接続済み' : 'アプリに再接続中'}</span>
          <span className="connection-symbol" aria-hidden="true">{connected ? '✓' : '↻'}</span>
        </span>}
        <ManagementToast notice={operationNotice}/>
      </header>
      <nav className="management-nav" aria-label="メインナビゲーション">
        {managementPages.map(([id, label]) => <button key={id} data-page={id}
          aria-label={label} aria-current={(editor ? id === 'settings' : page === id) ? 'page' : undefined} onClick={() => go(id)}>
          <span className="management-tab-full">{label}</span><span className="management-tab-compact" aria-hidden="true">{id === 'live' ? '配信' : label}</span></button>)}
        <ManagementWarnings items={warningItems} />
      </nav>
      <div ref={scroll} className="management-body">
        {!editor && !setupActive && <div className="management-page-heading"><h1 id="page-heading" tabIndex={-1}>{activePage[2]}</h1></div>}
        {setupActive && initialSetup && <InitialSetupHeader {...initialSetup} perform={performSetup} leave={leaveSetup} open={open} blocked={setupBlocked}
          disclosures={{ open: setupDisclosures, change: (id, expanded) => setSetupDisclosures(current => current[id] === expanded ? current : { ...current, [id]: expanded }) }} />}
        {visibleActivities.length > 0 && <aside aria-label="実行中の操作" className="management-activities">
          {visibleActivities.map(activity => <button key={activity.id} id={`activity-${activity.id}`} onClick={event => open(activity.id, event.currentTarget)}>{activity.message} ›</button>)}
        </aside>}
        <div hidden={Boolean(editor) || setupActive || page !== 'home'} className="management-home">
          {home}
          <section className="studio-card studio-display"><h2>表示・演出</h2><div className="management-shortcuts">
            {entry('commentOverlay', 'OBSコメント表示', '表示方法・表示項目・デザイン', '▤', 'home')}
            {entry('textEffects', 'コメント文字演出', '反応ワード・ルール・テスト', '✧', 'home')}
            {entry('character', 'キャラクター', '画像・微動・ウィンドウ', '♧', 'home')}
            {entry('commentList', 'コメント一覧', '外観・表示項目', '☷', 'home')}
          </div></section>
          <section className="studio-card"><h2>スマホ・外配信</h2>{smartphoneStatus}<div className="management-shortcuts">
            {entry('smartphone', 'スマホ連携', 'コメント・読み上げ・映像送信', '▯', 'home')}
          </div></section>
          <section className="studio-card studio-obs-application"><h2>OBS・アプリ</h2>{obsStatus}<div className="management-shortcuts">
            {entry('obsControl', 'OBS操作', '接続・音声・Android操作', '◎', 'home')}
            {entry('urls', 'OBSにソースを追加', '表示の追加・URL', '↗', 'home')}
            {entry('application', 'アプリ設定', '配色・文字サイズ・ポート・バージョン', '⚙', 'home')}
          </div></section>
          <div className="studio-windows">{windows}</div>
        </div>
        <div hidden={Boolean(editor) || setupActive || page !== 'live'} className="management-live">{visitedPages.live && live}</div>
        <div hidden={Boolean(editor) || setupActive || page !== 'settings'} className="management-categories">
          {managementSections.map(group => <section key={group.group} className="management-category"><h2>{group.group}</h2>
            {group.items.map(([id, title, description, icon]) => entry(id, title, description, icon, 'settings'))}
          </section>)}
        </div>
        {editor && <ManagementEditorHeading title={selected?.[1] ?? ''} onBack={back}
          backPage={setupOpen ? 'はじめての設定' : activePage[1]} introduction={introductions[displayEditor ?? editor]} description={selected?.[2]} />}
        <div className={workspace ? 'setup-workspace' : 'management-editors'}>
          <div className="management-editor-content">{workspace && setupProps?.view.position === 'obsDisplay' && <InitialSetupObsConnectionStatus {...setupProps} needsSettings={Boolean(initialSetup?.settingsPending('obsControl') || errors.obsControl)} />}{children}
            {workspace && setupProps && <InitialSetupWorkspaceActions {...setupProps} />}
          </div>
          {workspace && setupProps && <InitialSetupReview {...setupProps} />}
        </div>
        {setupActive && !workspace && !entryScreen && setupProps && <InitialSetupFooter {...setupProps} />}
      </div>
      {(workspace || entryScreen) && setupProps && <InitialSetupFooter {...setupProps} />}
    </main>
    </SetupPresentation.Provider>
  </ManagementNavigation.Provider>;
}
