import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { commentPaperColors, defaultCommentOverlayAppearance } from '../../shared/comment-overlay-theme';
import type { CommonComment, CommentOverlaySettings, SpeechRecognitionOverlayAppearance } from '../../shared/types';
import { CommentItem } from './CommentItem';
import { applicationDesignCss } from '../obs-style-editor/application-css';
import { updateCommentInkGap } from '../comment-ink-gap';

/** Presentation only: the live pages own subscriptions, expiry and test state. */
export function CommentOverlayView({ comments, settings }: {
  comments: readonly CommonComment[];
  settings: CommentOverlaySettings;
}) {
  const mainRef = useRef<HTMLElement>(null);
  // Snapshots may recreate these objects even when the rendered content and
  // appearance did not change. Keep the measurement subscriptions in that case.
  const layoutKey = JSON.stringify([comments, settings]);
  useLayoutEffect(() => {
    const main = mainRef.current;
    const view = main?.ownerDocument.defaultView;
    if (!main || !view || !('CanvasRenderingContext2D' in view)) return;
    const update = () => updateCommentInkGap(main);
    update();
    const observer = new view.ResizeObserver(update);
    observer.observe(main);
    const mutations = new view.MutationObserver(update);
    // Generated styles are replaced on edits; custom CSS may also arrive later.
    mutations.observe(main.getRootNode(), { childList: true, characterData: true, subtree: true });
    main.addEventListener('load', update, true);
    view.addEventListener('resize', update);
    main.ownerDocument.fonts.addEventListener('loadingdone', update);
    return () => {
      observer.disconnect(); mutations.disconnect();
      main.removeEventListener('load', update, true);
      view.removeEventListener('resize', update);
      main.ownerDocument.fonts.removeEventListener('loadingdone', update);
    };
  }, [layoutKey]);
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
    <main ref={mainRef} className={`overlay-comments direction-${settings.stackDirection} mode-${settings.mode} alignment-${settings.mode === 'stack' ? settings.stackAlignment : 'top'}`} style={appearance}>
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
