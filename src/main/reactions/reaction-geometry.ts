import { reactionRecord as record, validReactionRegion, type ReactionRegion, type ReactionWindow, type ReactionInsets } from '../../shared/listener-reactions';
export function reactionViewport(target: ReactionWindow, insets: ReactionInsets, canvasWidth: number, canvasHeight: number, region: ReactionRegion) {
  if (!validCaptureRegion(region)) return null;
  const width = target.width - insets.left - insets.right, height = target.height - insets.top - insets.bottom;
  const sourceWidth = canvasWidth * region.width, sourceHeight = canvasHeight * region.height;
  if (width < 8 || height < 8 || sourceWidth <= 0 || sourceHeight <= 0) return null;
  const scale = Math.min(width / sourceWidth, height / sourceHeight), w = Math.min(width, sourceWidth * scale), h = Math.min(height, sourceHeight * scale);
  return { x: Math.round(target.x + insets.left + (width - w) / 2), y: Math.round(target.y + insets.top + (height - h) / 2), width: Math.round(w), height: Math.round(h) };
}
export function reactionCanvasViewport(target: ReactionWindow, insets: ReactionInsets, canvasWidth: number, canvasHeight: number, region: ReactionRegion) {
  const game = reactionViewport(target, insets, canvasWidth, canvasHeight, region);
  if (!game) return null;
  const width = game.width / region.width, height = game.height / region.height;
  // A tiny manual region must never allocate an enormous transparent GPU surface.
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width > 16384 || height > 16384 || width * height > 33554432) return null;
  return { x: Math.round(game.x - region.x * width), y: Math.round(game.y - region.y * height), width: Math.round(width), height: Math.round(height) };
}
export function reactionSourceRegion(value: unknown, canvasWidth: number, canvasHeight: number): ReactionRegion | null {
  const geometry = reactionItemGeometry(value);
  if (!geometry || canvasWidth <= 0 || canvasHeight <= 0) return null;
  const visible = intersectReactionRect(geometry.visible, { x: 0, y: 0, width: canvasWidth, height: canvasHeight });
  if (!visible) return null;
  const region = { x: visible.x / canvasWidth, y: visible.y / canvasHeight, width: visible.width / canvasWidth, height: visible.height / canvasHeight };
  return validReactionRegion(region) ? region : null;
}
// Only internal mappings may extend outside the canvas. Saved/manual regions stay clipped.
function validCaptureRegion(r: ReactionRegion) {
  return [r.x, r.y, r.width, r.height, r.x + r.width, r.y + r.height].every(Number.isFinite)
    && r.width > 0 && r.height > 0 && r.x < 1 && r.y < 1 && r.x + r.width > 0 && r.y + r.height > 0;
}
export function reactionCaptureRegion(value: unknown, canvasWidth: number, canvasHeight: number): ReactionRegion | null {
  const geometry = reactionItemGeometry(value);
  if (!geometry || !reactionSourceRegion(value, canvasWidth, canvasHeight)) return null;
  const r = geometry.full;
  const region = { x: r.x / canvasWidth, y: r.y / canvasHeight, width: r.width / canvasWidth, height: r.height / canvasHeight };
  return validCaptureRegion(region) ? region : null;
}
export function intersectReactionRect(a: ReactionRegion, b: ReactionRegion): ReactionRegion | null {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y), width = Math.min(a.x + a.width, b.x + b.width) - x, height = Math.min(a.y + a.height, b.y + b.height) - y;
  return [x,y,width,height].every(Number.isFinite) && width > 0 && height > 0 ? { x,y,width,height } : null;
}
/** Original source and visible crop, in parent source pixels (before canvas clipping). */
export function reactionItemGeometry(value: unknown) {
  if (!record(value)) return null; const t = value;
  const n = (key: string) => typeof t[key] === 'number' ? Number(t[key]) : NaN;
  const [px, py, sw, sh, sx, sy, rotation, align] = ['positionX','positionY','sourceWidth','sourceHeight','scaleX','scaleY','rotation','alignment'].map(n);
  if (![px,py,sw,sh,sx,sy,rotation,align].every(Number.isFinite) || sx <= 0 || sy <= 0 || sw <= 0 || sh <= 0 || rotation !== 0 || Math.abs(sx / sy - 1) > .002) return null;
  const [cl,ct,cr,cb] = ['cropLeft','cropTop','cropRight','cropBottom'].map(n);
  if (![cl,ct,cr,cb].every(v => Number.isSafeInteger(v) && v >= 0) || cl + cr >= sw || ct + cb >= sh || t.cropToBounds || ![0,1,2,4,5,6,8,9,10].includes(align)) return null;
  let width = (sw - cl - cr) * sx, height = (sh - ct - cb) * sy, bw = width, bh = height, ox = 0, oy = 0;
  if (t.boundsType === 'OBS_BOUNDS_SCALE_INNER') {
    bw = n('boundsWidth'); bh = n('boundsHeight'); const ba = n('boundsAlignment');
    if (![bw,bh,ba].every(Number.isFinite) || bw <= 0 || bh <= 0 || ![0,1,2,4,5,6,8,9,10].includes(ba)) return null;
    const fit = Math.min(bw / width, bh / height); width *= fit; height *= fit;
    ox = (bw - width) * (ba & 1 ? 0 : ba & 2 ? 1 : .5); oy = (bh - height) * (ba & 4 ? 0 : ba & 8 ? 1 : .5);
  } else if (t.boundsType !== 'OBS_BOUNDS_NONE') return null;
  const x = px - bw * (align & 1 ? 0 : align & 2 ? 1 : .5) + ox, y = py - bh * (align & 4 ? 0 : align & 8 ? 1 : .5) + oy;
  const scaleX = width / (sw - cl - cr), scaleY = height / (sh - ct - cb);
  const full = { x: x - cl * scaleX, y: y - ct * scaleY, width: sw * scaleX, height: sh * scaleY };
  return [...Object.values(full),x,y,width,height].every(Number.isFinite) && width > 0 && height > 0 ? { full, visible: {x,y,width,height}, sourceWidth: sw, sourceHeight: sh } : null;
}
