import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { CommentListSettings, CommonComment } from '../../shared/types';
import { messages } from '../messages';
import { CommentItem } from './CommentItem';

export function CommentListView({
  comments,
  settings,
  connected,
  sourcesRunning,
  emptyHelp,
  controls,
  notices,
  className,
  style,
  embeddedHeader = false,
}: {
  comments: CommonComment[];
  settings: CommentListSettings;
  connected: boolean;
  sourcesRunning: boolean;
  emptyHelp?: string;
  controls?: ReactNode;
  notices?: ReactNode;
  className?: string;
  style?: CSSProperties;
  embeddedHeader?: boolean;
}) {
  const list = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const displayedComments = settings.stackDirection === 'newestTop'
    ? [...comments].reverse()
    : comments;

  useEffect(() => {
    if (!follow || !list.current) return;
    list.current.scrollTop = settings.stackDirection === 'newestTop' ? 0 : list.current.scrollHeight;
  }, [comments, settings.stackDirection, follow]);

  return <main className={['comment-list-page', className].filter(Boolean).join(' ')} style={style}>
    <header>
      <div className="comment-list-summary">
        {!embeddedHeader && <h1>コメント一覧</h1>}
        {!embeddedHeader && <span>{comments.length.toLocaleString()}件</span>}
        {embeddedHeader && <div className="comment-list-notices">
          <div className="comment-list-status-content">
          {notices}
          <p className="muted" role="status">
            {connected ? 'コメント接続済み' : 'コメント接続待ち'}{sourcesRunning ? '' : '・取得停止'}
          </p>
          </div>
        </div>}
        <div className="comment-list-controls">
          <button
            type="button"
            className="secondary small"
            aria-pressed={follow}
            onClick={() => setFollow((current) => !current)}
          >
            {messages.autoScroll}: {follow ? messages.on : messages.off}
          </button>
          {controls}
        </div>
      </div>
      {!embeddedHeader && <span className={connected ? 'connection-ok' : 'connection-bad'}>
        {connected ? 'アプリ接続済み' : 'アプリに再接続中'}
      </span>}
    </header>
    {!embeddedHeader && (connected && !sourcesRunning || notices) && <div className="comment-list-notices">
      {notices}
      {connected && !sourcesRunning && <p className="muted">コメント取得は停止中です</p>}
    </div>}
    <div
      className={`comment-stream direction-${settings.stackDirection}`}
      ref={list}
      onScroll={(event) => {
        const node = event.currentTarget;
        setFollow(settings.stackDirection === 'newestTop'
          ? node.scrollTop < 32
          : node.scrollHeight - node.scrollTop - node.clientHeight < 32);
      }}
    >
      {displayedComments.map((comment) => (
        <CommentItem
          key={comment.id}
          comment={comment}
          fields={settings}
          linkifyUrls
          appearance={settings}
        />
      ))}
      {comments.length === 0 && (emptyHelp ? <div className="center-message comment-list-empty" role="status"><div><p>{messages.noComments}</p><p>{emptyHelp}</p></div></div> : <p className="center-message">{messages.noComments}</p>)}
    </div>
  </main>;
}
