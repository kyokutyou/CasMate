import type { ReactionEvent } from '../../shared/listener-reactions';
import { reactionEventAge } from './event-age';
import { playReactionSticker } from './stickers/player';

/** Stable per-event locations shared by OBS and the one-way desktop bridge. */
export function playReactionParticles(container: HTMLElement, event: ReactionEvent) {
  if (event.kind === 'sticker') { playReactionSticker(container, event); return; }
  const age = reactionEventAge(event.at);
  const cheer = event.kind === 'cheer';
  if (!event.accepting || !['heart', 'clap', 'cheer'].includes(event.kind) || age === null || age >= (cheer ? 2100 : 2340)) return;
  const width = container.clientWidth, height = container.clientHeight;
  if (!width || !height) return;
  let seed = 2166136261;
  for (const character of `${event.instance}:${event.sequence}:${event.kind}`) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619) >>> 0;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < (cheer ? 1 : 5); i++) {
    const left = cheer ? 35 + random() * 30 : 8 + random() * 84;
    if (age >= 2100 + i * 60) continue;
    while (container.childElementCount >= 100) container.firstElementChild?.remove();
    if (cheer) while (container.querySelectorAll('.reaction-cheer').length >= 5) container.querySelector('.reaction-cheer')?.remove();
    const item = document.createElement('span');
    item.className = cheer ? 'reaction-particle reaction-cheer' : 'reaction-particle'; item.textContent = cheer ? 'がんばれ！' : event.kind === 'heart' ? '❤️' : '👏';
    item.style.left = `${left}%`;
    item.style.fontSize = `${(cheer ? 36 : 64) * width / (event.frame?.canvasWidth ?? 1920)}px`;
    container.append(item);
    const animation = item.animate([
      { transform: 'translate3d(-50%,0,0)', opacity: 0 },
      { offset: .15, opacity: 1 },
      { transform: `translate3d(-50%,-${height * .7}px,0)`, opacity: 0 },
    ], { duration: 2100, delay: i * 60, fill: 'both', easing: 'linear' });
    animation.currentTime = age;
    void animation.finished.then(() => item.remove(), () => item.remove());
    setTimeout(() => item.remove(), Math.max(0, (cheer ? 2100 : 3000) - age));
  }
}
