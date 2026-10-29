import { CommentOverlayView, SpeechRecognitionOverlayView } from '../components/OverlayViews';
import type { EditorDocument, Target } from './model';
import { previewAppearance, previewComments, previewCommentSettings } from './samples';
import type { ApplicationPreview } from './Preview';

export function PreviewContent({ target, document, application }: { target: Target; document: EditorDocument; application?: ApplicationPreview }) {
  return target === 'comments'
    ? <CommentOverlayView comments={previewComments(document.previews.comments)} settings={{ ...(application?.comments ?? previewCommentSettings(document.previews.comments)), mode: document.previews.comments.mode, stackDirection: document.previews.comments.stackDirection }} />
    : <SpeechRecognitionOverlayView text={document.previews.speech.text} appearance={application?.speech ?? previewAppearance} />;
}
