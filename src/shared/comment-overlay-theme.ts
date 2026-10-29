import type { CommentOverlaySettings } from './types';

/** Shared by fresh settings and the renderer; saved user themes are preserved. */
export const defaultCommentOverlayAppearance = {
  fontFamily: 'Yu Gothic UI',
  fontSizePx: 36,
  textColor: '#183b3bff',
  backgroundColor: '#6ed2ba73',
  paddingPx: 4,
  borderRadiusPx: 0,
} satisfies Pick<CommentOverlaySettings, 'fontFamily' | 'fontSizePx' | 'textColor' | 'backgroundColor' | 'paddingPx' | 'borderRadiusPx'>;

export const commentPaperColors = ['#6ed2ba73', '#ff998b73', '#f9dd8473', '#87d3c773'] as const;
