import type { CSSProperties } from 'react';
import { commentPaperColors, defaultCommentOverlayAppearance } from '../../shared/comment-overlay-theme';
import type { CommonComment, CommentOverlaySettings, SpeechRecognitionOverlayAppearance } from '../../shared/types';
import { CommentItem } from './CommentItem';
import { applicationDesignCss } from '../obs-style-editor/application-css';

/** Presentation only: the live pages own subscriptions, expiry and test state. */
export function CommentOverlayView({ comments, settings }: {
  comments: readonly CommonComment[];
  settings: CommentOverlaySettings;
}) {
  const items = settings.stackDirection === 'newestTop' ? [...comments].reverse() : comments;
  // Internal fallbacks only. Public --cm-* values and ordinary OBS CSS win
  // without !important; no appearance properties are locked inline.
  const appearance = {
    '--cm-app-font': settings.fontFamily,
    '--cm-app-size': `${settings.fontSizePx}px`,
    '--cm-app-text': settings.textColor,
    '--cm-app-padding': `${settings.paddingPx}px`,
    '--cm-app-radius': `${settings.borderRadiusPx}px`,
  } as CSSProperties;
  const usePaperColors = settings.backgroundColor.toLowerCase() === defaultCommentOverlayAppearance.backgroundColor;
  return <>{settings.design && <style>{applicationDesignCss('comments', settings.design)}</style>}
    <main className={`overlay-comments direction-${settings.stackDirection}`} style={appearance}>
    {items.map((comment) => <div className="overlay-comment" key={comment.id} style={{
      '--cm-app-background': (settings.design ? settings.design.variant === 'paper' && settings.design.paperColors : usePaperColors)
        ? settings.design ? commentPaperColors[Math.abs(comment.sequence) % commentPaperColors.length].slice(0, 7) + Math.round(settings.design.style.backgroundOpacity / 100 * 255).toString(16).padStart(2, '0') : commentPaperColors[Math.abs(comment.sequence) % commentPaperColors.length]
        : settings.backgroundColor,
    } as CSSProperties}><CommentItem comment={comment} fields={settings} /></div>)}
  </main></>;
}

export function SpeechRecognitionOverlayView({ text, appearance }: {
  text: string;
  appearance: SpeechRecognitionOverlayAppearance;
}) {
  return <main className="speech-recognition-overlay" style={appearance.design ? undefined : { fontFamily: appearance.fontFamily, fontSize: appearance.fontSizePx, color: appearance.textColor }}>
    {appearance.design && <style>{applicationDesignCss('speech', appearance.design)}</style>}
    <div className="speech-recognition-overlay-text" style={appearance.design ? undefined : { backgroundColor: appearance.backgroundColor, padding: appearance.paddingPx, borderRadius: appearance.borderRadiusPx }}>{text}</div>
  </main>;
}
