import { useCallback, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { AppSnapshot, CommonComment, CommentListSettings } from '../../shared/types';
import { ManagementNavigation, type ManagementEditor } from '../management-navigation';
import { messages } from '../messages';
import { CommentItem } from './CommentItem';
import { ManagementHome, ManagementOperations, type ManagementHomeProps } from './ManagementHome';
import { connectionKeys } from '../../shared/types';
import { connectionLabel, statusLabels } from '../messages';
import './management-live.css';

const obsStreamLabels = { unknown: '状態不明', stopped: '停止中', starting: '開始中', streaming: '配信中', reconnecting: '再接続中', stopping: '終了中' };

function smartphonePreparation(snapshot: AppSnapshot) {
  const phone = snapshot.smartphone;
  const network = phone?.settings.activeNetwork;
  const current = network ? phone.networks[network] : undefined;
  const ready = Boolean(current?.commentsUrl || network === 'direct' && current?.registrationReady);
  return {
    network: network ? { lan: '家庭内LAN', tailscale: '外配信Tailscale', direct: '直接接続' }[network] : '選択なし',
    status: !phone?.available ? '利用不可' : !network ? 'OFF' : phone.warning || current?.warning ? '要確認' : ready ? '準備済み' : '準備中',
    warning: phone?.warning || current?.warning,
  };
}

function SettingLink({ id, editor, target, children }: { id: string; editor: ManagementEditor; target?: string; children: ReactNode }) {
  const navigation = useContext(ManagementNavigation);
  return <button id={id} className="feature-link" onClick={event => navigation?.open(editor, event.currentTarget, target)}>{children} ›</button>;
}

export function ObsWorkspaceStatus({ snapshot }: { snapshot: AppSnapshot }) {
  const obs = snapshot.obsControl;
  return <div className="studio-integration-status" aria-label="OBSの状態">
    <div><small>OBS接続</small><strong>{obs ? { disabled: '連携オフ', connecting: '接続中', connected: '接続済み', unavailable: '利用不可' }[obs.connection] : '状態を取得中'}</strong></div>
    <div><small>OBS配信</small><strong>{obs ? obsStreamLabels[obs.stream] : '状態不明'}</strong></div>
    <p className="muted">{obs?.confirmation ? '確認待ち・OBS操作で確認／取消' : ''}</p>
  </div>;
}

export function SmartphoneWorkspaceStatus({ snapshot }: { snapshot: AppSnapshot }) {
  const phone = smartphonePreparation(snapshot);
  return <div className="studio-integration-status" aria-label="スマホの接続準備">
    <div><small>ネットワーク</small><strong>{phone.network}</strong></div>
    <div><small>接続準備</small><strong>{phone.status}</strong></div>
    <p className="muted">PCの接続準備です。スマホの接続・送信は端末で開始します。</p>
  </div>;
}

interface CommentWindowControl { visible: boolean; busy?: boolean; toggle(): Promise<unknown> }

export function ManagementCommentFeed({ comments, settings, active, commentWindow }: { comments: CommonComment[]; settings: CommentListSettings; active: boolean; commentWindow?: CommentWindowControl }) {
  const navigation = useContext(ManagementNavigation);
  const list = useRef<HTMLDivElement>(null);
  const position = useRef(0);
  const readingAnchor = useRef<{ id: string; offset: number } | null>(null);
  const wasActive = useRef(false);
  const [follow, setFollow] = useState(true);
  const receivedSequence = useRef(comments.reduce((latest, comment) => Math.max(latest, comment.sequence), -1));
  const receivedTail = useRef<Pick<CommonComment, 'sequence' | 'id' | 'receivedAt'> | null>(null);
  const [newCount, setNewCount] = useState(0);
  useLayoutEffect(() => {
    const latest = comments.reduce((sequence, comment) => Math.max(sequence, comment.sequence), -1);
    const previous = receivedTail.current;
    const overlap = previous && comments.find(comment => comment.sequence === previous.sequence);
    const reset = latest < receivedSequence.current || Boolean(previous && overlap && (overlap.id !== previous.id || overlap.receivedAt !== previous.receivedAt));
    const added = comments.filter(comment => comment.sequence > receivedSequence.current && !comment.initialHistory).length;
    receivedSequence.current = latest;
    const tail = comments.find(comment => comment.sequence === latest);
    receivedTail.current = tail ? { sequence: tail.sequence, id: tail.id, receivedAt: tail.receivedAt } : null;
    setNewCount(count => follow || reset ? 0 : count + added);
  }, [comments, follow]);
  const rememberPosition = useCallback((node: HTMLDivElement) => {
    position.current = node.scrollTop;
    const top = node.getBoundingClientRect().top;
    const row = [...node.children].find(child => child.getBoundingClientRect().bottom > top);
    const id = row && (row as HTMLElement).dataset.commentId;
    readingAnchor.current = id ? { id, offset: row!.getBoundingClientRect().top - top } : null;
  }, []);
  useLayoutEffect(() => {
    const returning = active && !wasActive.current;
    wasActive.current = active;
    if (!active || !list.current) return;
    if (follow) list.current.scrollTop = settings.stackDirection === 'newestTop' ? 0 : list.current.scrollHeight;
    else {
      const node = list.current;
      const anchor = readingAnchor.current;
      const row = anchor && [...node.children].find(child => (child as HTMLElement).dataset.commentId === anchor.id);
      if (row) node.scrollTop += row.getBoundingClientRect().top - node.getBoundingClientRect().top - anchor.offset;
      else if (returning) node.scrollTop = position.current;
    }
    rememberPosition(list.current);
  }, [active, comments, follow, settings.stackDirection, rememberPosition]);
  const displayed = settings.stackDirection === 'newestTop' ? [...comments].reverse() : comments;
  return <section className="studio-card studio-comment-feed" aria-label="取得したコメント">
    <div className="home-section-heading"><h2>コメント</h2><div className="studio-live-feed-actions"><button className="secondary studio-live-auto-scroll" aria-pressed={follow} aria-label={`自動スクロール ${follow ? 'ON' : 'OFF'}`} title={follow ? '自動スクロールをOFFにする' : '新着側へ移動して自動スクロールをONにする'} onClick={() => {
      if (follow && list.current) rememberPosition(list.current);
      setFollow(current => !current);
    }}><span>自動スクロール</span><span className="studio-live-auto-scroll-value">{follow ? 'ON' : 'OFF'}</span></button>{commentWindow && <button id="live-comment-window" type="button" className="secondary studio-live-comment-window" aria-label="コメント一覧の独立ウィンドウ"
      aria-pressed={commentWindow.visible} aria-disabled={Boolean(commentWindow.busy)} aria-busy={Boolean(commentWindow.busy)} title={commentWindow.visible ? messages.hideIndependentWindow : messages.showIndependentWindow}
      onClick={() => { if (!commentWindow.busy) void commentWindow.toggle(); }}><span aria-hidden="true">↗</span><span className="studio-live-window-label" aria-hidden="true"> 独立窓</span></button>}<button id="live-list-settings" className="feature-link" aria-label="コメント一覧の表示設定" onClick={event => navigation?.open('commentList', event.currentTarget)}>⚙</button></div></div>
    <div ref={list} className="studio-comment-stream" tabIndex={0} aria-label="コメントを読み返す" onScroll={event => {
      if (!active) return;
      const node = event.currentTarget;
      // Layout restoration also emits scroll events; it must not undo an explicit pause.
      if (node.scrollTop === position.current) return;
      rememberPosition(node);
      setFollow(settings.stackDirection === 'newestTop' ? node.scrollTop < 32 : node.scrollHeight - node.scrollTop - node.clientHeight < 32);
    }}>
      {displayed.map(comment => <div key={comment.id} data-comment-id={comment.id}><CommentItem comment={comment} fields={settings} appearance={settings} linkifyUrls /></div>)}
      {comments.length === 0 && <p className="center-message">{messages.noComments}</p>}
    </div>
    <div className="studio-footer-links"><span className="muted studio-live-follow-state"><span>{follow ? '自動スクロール ON' : '読み返し中・自動スクロール OFF'}{!follow && newCount > 0 ? `\u3000新着${newCount > 9999 ? '9999+' : newCount}件` : ''}</span></span><span className="muted">{comments.length}件</span></div>
  </section>;
}

export function ManagementLive({ homeProps, windows, commentWindow }: { homeProps: ManagementHomeProps; windows: ReactNode; commentWindow?: CommentWindowControl }) {
  const navigation = useContext(ManagementNavigation);
  const { snapshot } = homeProps;
  const recognition = snapshot.speechRecognition;
  const latest = recognition.previewActive ? recognition.previewHistory.at(-1) : undefined;
  const active = navigation?.page === 'live' && !navigation.editor;
  const [detail, setDetail] = useState<'sources' | 'obs' | 'smartphone' | 'windows' | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const close = (restoreFocus = true) => {
    dialog.current?.close(); setDetail(null);
    if (restoreFocus && opener.current?.isConnected) opener.current.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    if (!active) { dialog.current?.close(); setDetail(null); }
    else if (detail && !dialog.current?.open) dialog.current?.showModal();
  }, [active, detail]);
  const openDetail = (kind: NonNullable<typeof detail>, entry: HTMLButtonElement) => { opener.current = entry; setDetail(kind); };
  const detailNavigation = navigation ? { ...navigation, open: (editor: ManagementEditor, entry: HTMLElement, target?: string) => {
    const origin = opener.current ?? entry;
    close(false); navigation.open(editor, origin, target);
  } } : null;
  const connected = connectionKeys.filter(source => snapshot.sourceStatuses[source].state === 'connected').length;
  const sourceAttention = connectionKeys.filter(source => ['error', 'reconnecting'].includes(snapshot.sourceStatuses[source].state));
  const sourceSummary = `${connected}件接続中${sourceAttention.length ? '・要確認' : ''}`;
  const sourceDetails = connectionKeys.map(source => `${connectionLabel(source, snapshot.sourceStatuses[source])}：${statusLabels[snapshot.sourceStatuses[source].state]}`).join('、');
  const obs = snapshot.obsControl;
  const obsWarning = obs?.error || obs?.publication.warning || (obs?.confirmation ? 'OBS操作の確認待ちです。OBS操作の設定で確認または取消できます。' : '');
  const obsSummary = `${obs ? obsStreamLabels[obs.stream] : '状態不明'}${obsWarning ? ' · 要確認' : ''}`;
  const phone = smartphonePreparation(snapshot);
  const titles = { sources: 'コメントの接続', obs: 'OBSとの連携', smartphone: 'スマホの接続準備', windows: '別ウィンドウを開く・設定' };
  return <div className="studio-live-layout">
    <ManagementOperations {...homeProps} prefix="live" compact />
    <div className="studio-live-connections" aria-label="接続と連携の状態">
      <button id="live-connections-summary" className={sourceAttention.length ? 'live-summary-attention' : undefined} title={sourceDetails} onClick={event => openDetail('sources', event.currentTarget)}><span>コメント接続</span><strong><span>{sourceSummary}</span></strong><span aria-hidden="true">›</span></button>
      <button id="live-obs-settings" className={obsWarning ? 'live-summary-attention' : undefined} title={obsWarning || obsSummary} onClick={event => openDetail('obs', event.currentTarget)}><span>OBS</span><strong>{obsSummary}</strong><span aria-hidden="true">›</span></button>
      <button id="live-smartphone-settings" className={phone.warning ? 'live-summary-attention' : undefined} title={`${phone.network}・${phone.status}。接続準備と実接続・送信・OBS表示は異なります。`} onClick={event => openDetail('smartphone', event.currentTarget)}><span>スマホ</span><strong>{phone.network}・{phone.status}</strong><span aria-hidden="true">›</span></button>
    </div>
    <ManagementCommentFeed comments={snapshot.comments} settings={snapshot.settings.commentList} active={active} commentWindow={commentWindow} />
    <section className="studio-live-transcript" aria-label="音声認識プレビュー"><span title="配信に使う音声認識とは別に、設定画面から開始・停止できます。">音声認識プレビュー</span><p title={latest?.text}>{latest?.text ?? (recognition.previewActive ? '認識結果を待っています。' : '停止中')}</p><SettingLink id="live-recognition-settings" editor="speechRecognition">音声認識の設定</SettingLink></section>
    <div className="studio-live-utilities"><button id="live-windows" className="feature-link" onClick={event => openDetail('windows', event.currentTarget)}>別ウィンドウを開く・設定 ›</button></div>
    <dialog ref={dialog} className="studio-live-dialog" aria-labelledby="live-detail-title" onCancel={event => { event.preventDefault(); close(); }} onClose={event => { if (!event.currentTarget.open) setDetail(null); }} onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(node => !node.closest('[hidden]'));
      const first = controls[0]; const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <div className="studio-live-dialog-heading"><h2 id="live-detail-title">{detail ? titles[detail] : ''}</h2><button autoFocus type="button" onClick={() => close()}>閉じる</button></div>
      <ManagementNavigation.Provider value={detailNavigation}><div className="studio-live-dialog-body">
        {detail === 'sources' && <ManagementHome {...homeProps} prefix="live" sections="sources" />}
        {detail === 'obs' && <><ObsWorkspaceStatus snapshot={snapshot} /><p className="studio-live-detail-message" role="status" tabIndex={0}>{obsWarning}</p><SettingLink id="live-obs-editor" editor="obsControl">OBS操作の設定</SettingLink></>}
        {detail === 'smartphone' && <><SmartphoneWorkspaceStatus snapshot={snapshot} /><p className="studio-live-detail-message" role="status" tabIndex={0}>{phone.warning}</p><SettingLink id="live-smartphone-editor" editor="smartphone">スマホ連携の設定</SettingLink></>}
        {detail === 'windows' && <>{windows}<div className="studio-footer-links"><SettingLink id="live-window-list-settings" editor="commentList">コメント一覧の設定</SettingLink><SettingLink id="live-character-settings" editor="character">キャラクターの設定</SettingLink><button className="feature-link" onClick={() => { close(false); navigation?.go?.('settings'); }}>すべての設定 ›</button></div></>}
      </div></ManagementNavigation.Provider>
    </dialog>
  </div>;
}
