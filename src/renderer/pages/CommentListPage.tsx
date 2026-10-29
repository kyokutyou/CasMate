import { useState } from 'react';
import {
  commentListAlwaysOnTopActionUrl,
  isIndependentCommentList,
} from '../../shared/comment-list-window-actions';
import { areCommentSourcesRunning } from '../../shared/comment-source-status';
import { useApplicationState } from '../api';
import { CommentListView } from '../components/CommentListView';
import { messages } from '../messages';

export function CommentListPage() {
  const { snapshot, connected } = useApplicationState();
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const independentWindow = isIndependentCommentList(location.search);
  if (!snapshot) return <main className="center-message">{messages.loading}</main>;
  const settings = snapshot.settings.commentList;
  const sourcesRunning = areCommentSourcesRunning(snapshot.sourceStatuses);
  const states = Object.values(snapshot.sourceStatuses).map(status => status.state);
  const emptyHelp = !connected ? 'きゃすメイトへの再接続を待っています。'
    : states.includes('connected') ? '新着コメントを待っています。'
    : states.includes('waiting') ? '配信開始を待っています。'
    : sourcesRunning ? '管理画面でコメントサービスの接続状態を確認してください。'
    : '管理画面でコメントサービスに接続してください。';
  const toggleAlwaysOnTop = () => {
    const next = !alwaysOnTop;
    setAlwaysOnTop(next);
    window.open(commentListAlwaysOnTopActionUrl(next), '_blank', 'noopener');
  };
  return <CommentListView
    comments={snapshot.comments}
    settings={settings}
    connected={connected}
    sourcesRunning={sourcesRunning}
    emptyHelp={emptyHelp}
    controls={independentWindow && <button
      type="button"
      className="secondary small"
      aria-pressed={alwaysOnTop}
      onClick={toggleAlwaysOnTop}
    >
      {messages.alwaysOnTop}: {alwaysOnTop ? messages.on : messages.off}
    </button>}
  />;
}
