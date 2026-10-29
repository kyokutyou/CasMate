import type { ObsCommentDesign, ObsSpeechDesign } from '../../shared/obs-design';
import { generateCss } from './css';

/** Internal fallback variables leave OBS's existing custom CSS in control. */
export function applicationDesignCss(target: 'comments' | 'speech', design: ObsCommentDesign | ObsSpeechDesign): string {
  let css = generateCss(target, design.style).replaceAll(' !important', '');
  const alpha = Math.round(design.textOpacity / 100 * 255).toString(16).padStart(2, '0');
  css = css.replace(/--cm-text: [^;]+;/u, `--cm-text: ${design.style.textColor}${alpha};`);
  if ('authorColor' in design.style) {
    css = css.replace(/--cm-author-color: [^;]+;/u, `--cm-author-color: ${design.style.authorColor}${alpha};`)
      .replace(/--cm-source-color: [^;]+;/u, `--cm-source-color: ${design.style.sourceColor}${alpha};`);
  }
  const variables = [...css.matchAll(/--cm-([a-z-]+):/gu)].map(match => match[1]);
  for (const key of variables) {
    css = css.replaceAll(`--cm-${key}:`, `--cm-design-${key}:`)
      .replaceAll(`var(--cm-${key})`, `var(--cm-${key}, var(--cm-design-${key}))`);
  }
  if (target === 'comments' && 'variant' in design && design.variant === 'paper') {
    css += `
.overlay-comments .overlay-comment { max-width: min(100%, var(--cm-max-width, 440px)); transform: rotate(var(--cm-tilt, var(--cm-paper-tilt))); }
.overlay-comments .overlay-comment::before { display: var(--cm-tape-display, block); }
.overlay-comments .overlay-comment::after { display: var(--cm-fold-display, block); }
.overlay-comments .comment-meta { margin-bottom: var(--cm-meta-gap, 2px); }
.overlay-comments .comment-meta strong { font-weight: 500; }
.overlay-comments .source-badge { font-size: .72em; padding: .15em .4em; }
`;
    if (design.paperColors) css += '.overlay-comments .overlay-comment { background: var(--cm-background, var(--cm-app-background)); }';
  }
  return css;
}
