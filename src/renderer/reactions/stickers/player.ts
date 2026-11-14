import { reactionSticker } from '../../../shared/reaction-stickers';
import type { ReactionEvent } from '../../../shared/listener-reactions';
import { validReactionRegion } from '../../../shared/listener-reactions';
import { reactionEventAge } from '../event-age';
import { scenes, H } from './scenes.mjs';
import { drawSurprise } from './surprise.mjs';
import { characterSources } from './art.mjs';

const images = new Map<string, HTMLImageElement>();
let loading: Promise<void> | undefined;
H.image = (name: string) => images.get(name)!;
function loadArt() {
  return loading ??= Promise.all(Object.entries(characterSources).map(async ([name, url]) => {
    const image = new Image(); image.src = url; await image.decode(); images.set(name, image);
  })).then(() => {}).catch(error => { loading = undefined; throw error; });
}
H.character = (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, expression = 'normal', t = 0, rotation = 0) => {
  const image = images.get(expression); if (!image) return;
  ctx.save(); ctx.translate(x, y); ctx.rotate(rotation);
  const breathe = 1 + Math.sin(t * 4.1) * .004; ctx.scale(breathe, 1 / breathe);
  ctx.drawImage(image, -width / 2, -width / 2, width, width); ctx.restore();
};

/** A removed canvas owns no live animation, including during async asset loading. */
export function playReactionSticker(container: HTMLElement, event: ReactionEvent) {
  const sticker = reactionSticker(event.sticker), age = reactionEventAge(event.at);
  const placement = event.stickerPlacement;
  if (!sticker || !validReactionRegion(placement) || !event.accepting || age === null || age >= sticker.duration || !container.clientWidth || !container.clientHeight) return;
  while (container.querySelectorAll('.reaction-sticker').length >= 3) container.querySelector('.reaction-sticker')?.remove();
  while (container.childElementCount >= 100) container.firstElementChild?.remove();
  const canvas = document.createElement('canvas'); canvas.className = 'reaction-sticker'; canvas.setAttribute('aria-label', sticker.name);
  Object.assign(canvas.style, { position:'absolute', left:`${placement.x * 100}%`, top:`${placement.y * 100}%`, pointerEvents:'none' });
  container.append(canvas);
  let frame = 0, disposed = false;
  const dispose = () => { if (disposed) return; disposed = true; cancelAnimationFrame(frame); clearTimeout(timeout); observer.disconnect(); canvas.remove(); };
  const observer = new MutationObserver(() => { if (!canvas.isConnected) dispose(); }); observer.observe(container, { childList: true });
  const timeout = setTimeout(dispose, sticker.duration - age);
  const born = performance.now();
  const draw = () => {
    const elapsed = age + performance.now() - born;
    if (disposed || !canvas.isConnected || elapsed >= sticker.duration) { dispose(); return; }
    const width = container.clientWidth * placement.width;
    const height = container.clientHeight * placement.height;
    if (!width || !height) { dispose(); return; }
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    }
    const ctx = canvas.getContext('2d'); if (!ctx) { dispose(); return; }
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
    // A stale/missing frame may not describe this surface's aspect ratio. Fit
    // uniformly inside the authoritative box rather than stretching the art.
    const scale = Math.min(canvas.width / 736, canvas.height / 414);
    ctx.setTransform(scale, 0, 0, scale, (canvas.width - 736 * scale) / 2, (canvas.height - 414 * scale) / 2);
    ctx.save(); ctx.translate(368, 207);
    const t = elapsed / 1000;
    if (sticker.sample === 3) drawSurprise(ctx, t);
    else { const end = H.smooth(H.range(elapsed, sticker.duration - 550, sticker.duration)); ctx.globalAlpha = 1 - end; ctx.translate(0, -end * 38); ctx.scale(1 - end * .15, 1 - end * .15); scenes.get(sticker.sample)?.draw(ctx, t); }
    ctx.restore(); frame = requestAnimationFrame(draw);
  };
  void loadArt().then(() => { if (!disposed && canvas.isConnected) draw(); }, dispose);
}
