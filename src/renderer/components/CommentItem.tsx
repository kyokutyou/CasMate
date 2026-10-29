import { memo } from 'react';
import type { CommonComment, CommentListSettings, DisplayFields } from '../../shared/types';
import { sourceLabels } from '../messages';

export const CommentItem = memo(function CommentItem({
  comment,
  fields,
  linkifyUrls = false,
  appearance,
}: {
  comment: CommonComment;
  fields: DisplayFields;
  linkifyUrls?: boolean;
  appearance?: Pick<CommentListSettings, 'fontFamily' | 'fontSizePx' | 'textColor' | 'backgroundColor'>;
}) {
  return (
    <article className={`comment comment-${comment.source}`} data-initial={comment.initialHistory} style={appearance ? {
      fontFamily: appearance.fontFamily,
      fontSize: appearance.fontSizePx,
      color: appearance.textColor,
      backgroundColor: appearance.backgroundColor,
    } : undefined}>
      <div className="comment-meta">
        {fields.showSource && <span className="source-badge">{sourceLabels[comment.source]}</span>}
        {fields.showAuthor && <strong>{comment.authorName}</strong>}
      </div>
      {fields.showContent && (
        <div className="comment-body">
          {comment.content.map((part, index) =>
            part.type === 'text' ? (
              <span key={index}>{linkifyUrls ? linkedText(part.text) : part.text}</span>
            ) : (
              <img key={index} className="emote" src={part.url} alt={part.alt} title={part.alt} />
            ),
          )}
        </div>
      )}
    </article>
  );
});

function linkedText(text: string) {
  const nodes: React.ReactNode[] = [];
  const pattern = /h?ttps?:\/\/[^\s<>"']+/giu;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) continue;
    const url = match[0].replace(/[.,!?、。！？]+$/u, '');
    if (!url) continue;
    const href = /^h/iu.test(url) ? url : `h${url}`;
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    nodes.push(<a key={`${match.index}-${url}`} href={href} target="_blank" rel="noopener noreferrer">{url}</a>);
    cursor = match.index + url.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}
