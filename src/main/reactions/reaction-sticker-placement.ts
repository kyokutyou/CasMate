import type { ReactionRegion } from '../../shared/listener-reactions';

const overlap = (a: ReactionRegion, b: ReactionRegion) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

/** One authoritative placement history; renderers never choose independently. */
export class ReactionStickerPlacement {
  private active: Array<{ box: ReactionRegion; until: number }> = [];
  clear() { this.active = []; }
  choose(identity: string, now: number, duration: number, canvasWidth = 1920, canvasHeight = 1080): ReactionRegion {
    // The next event replaces the oldest canvas at the existing three-sticker cap.
    this.active = this.active.filter(item => item.until > now).slice(-2);
    const aspect = canvasWidth / canvasHeight;
    const width = Math.min(.38, .82 * (736 / 414) / aspect);
    const height = width * aspect / (736 / 414);
    let seed = 2166136261;
    for (const character of identity) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619) >>> 0;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const candidates: ReactionRegion[] = [];
    for (let i = 0; i < 48; i++) {
      // Include jittered corners as escape routes when central space is occupied.
      const u = i < 4 ? (i % 2 ? .96 + random() * .04 : random() * .04) : random();
      const v = i < 4 ? (i < 2 ? random() * .04 : .96 + random() * .04) : random();
      candidates.push({x: .03 + u * (.94 - width), y: .03 + v * Math.max(0, .82 - height), width, height});
    }
    // A random first candidate also breaks ties without bias toward one corner.
    const first = Math.floor(random() * candidates.length);
    let best = candidates[first], score = Infinity;
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[(i + first) % candidates.length];
      const value = this.active.reduce((sum, item) => sum + overlap(candidate, item.box), 0);
      if (value < score) { best = candidate; score = value; }
    }
    this.active.push({ box: best, until: now + duration });
    return { ...best };
  }
}
