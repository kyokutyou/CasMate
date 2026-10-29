// Throwaway UI exploration: no services, persistence, camera or network.
export const OUTPUT = { width: 1280, height: 720 };
export const COLORS = [
  ['白', '#ffffff'], ['黒', '#101413'], ['赤', '#ff454b'],
  ['黄', '#ffd84b'], ['緑', '#36cb79'], ['青', '#4088ff'],
];
export const WIDTHS = [['細', .004], ['中', .008], ['太', .016]];
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function geometry(box, viewport) {
  const w = Math.max(1, Math.floor(box.width)), h = Math.max(1, Math.floor(box.height));
  let fw = w, fh = h, x = 0, y = 0;
  if (OUTPUT.width / OUTPUT.height > w / h) {
    fh = Math.max(1, Math.floor(OUTPUT.height * w / OUTPUT.width));
    y = Math.floor((h - fh) / 2);
  } else {
    fw = Math.max(1, Math.floor(OUTPUT.width * h / OUTPUT.height));
    x = Math.floor((w - fw) / 2);
  }
  const zoom = clamp(viewport.zoom, 1, 6);
  const width = fw * zoom, height = fh * zoom;
  const left = (x - w / 2) * zoom + w / 2;
  const top = (h - y - fh - h / 2) * zoom + h / 2;
  const offsetX = clamp(viewport.panX * width, Math.min(0, w - left - width), Math.max(0, -left));
  const offsetY = clamp(viewport.panY * height, Math.min(0, h - top - height), Math.max(0, -top));
  return { left: left + offsetX, top: top + offsetY, width, height, offsetX, offsetY, zoom };
}

export function initialViewport(box) {
  const fit = geometry(box, { zoom: 1, panX: 0, panY: 0 });
  return { zoom: clamp(Math.max(box.width / fit.width, box.height / fit.height), 1, 6), panX: 0, panY: 0 };
}

export function framePoint(box, viewport, point, clip = false) {
  const frame = geometry(box, viewport);
  const x = (point.x - frame.left) / frame.width, y = (point.y - frame.top) / frame.height;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (!clip && (x < 0 || x > 1 || y < 0 || y > 1)) return null;
  return { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
}

/** Preserve the output point under the old finger midpoint while moving/scaling it. */
export function transformViewport(box, viewport, oldFocus, newFocus, ratio) {
  const old = geometry(box, viewport);
  const x = (oldFocus.x - old.left) / old.width, y = (oldFocus.y - old.top) / old.height;
  const next = { zoom: clamp(viewport.zoom * ratio, 1, 6), panX: 0, panY: 0 };
  const base = geometry(box, next);
  next.panX = (newFocus.x - base.left - x * base.width) / base.width;
  next.panY = (newFocus.y - base.top - y * base.height) / base.height;
  const bounded = geometry(box, next);
  return { zoom: next.zoom, panX: bounded.offsetX / bounded.width, panY: bounded.offsetY / bounded.height };
}

export class DrawingDocument {
  constructor(onChange = () => {}, fold = () => {}) {
    this.onChange = onChange; this.fold = fold;
    this.operations = []; this.active = null; this.revision = 0; this.folded = 0;
  }
  changed() { this.revision++; this.onChange(); }
  begin(point, style) {
    this.end(); this.active = { kind: 'stroke', ...style, points: [point] }; this.changed();
  }
  append(point) {
    if (!this.active) return;
    this.active.points.push(point);
    // Keep the exploration bounded without storing full-frame history copies.
    if (this.active.points.length >= 4096) {
      const style = { tool: this.active.tool, color: this.active.color, width: this.active.width };
      this.end(); this.active = { kind: 'stroke', ...style, points: [point] };
    }
    this.changed();
  }
  end() {
    if (!this.active) return;
    this.operations.push(this.active); this.active = null; this.trim(); this.onChange();
  }
  trim() {
    while (this.operations.length > 50 || this.operations.reduce((sum, op) => sum + (op.points?.length ?? 0), 0) > 50000) {
      this.fold(this.operations.shift()); this.folded++;
    }
  }
  clear() { this.end(); this.operations.push({ kind: 'clear' }); this.trim(); this.changed(); }
  undo() {
    this.end(); if (!this.operations.length) return false;
    this.operations.pop(); this.changed(); return true;
  }
  reset() {
    this.operations = []; this.active = null; this.folded = 0;
    this.fold({ kind: 'clear' }); this.changed();
  }
  get canUndo() { return this.operations.length > 0 || this.active !== null; }
  snapshot() { return { revision: this.revision, folded: this.folded, operations: this.operations, active: this.active }; }
}

const grip = points => ({
  focus: { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 },
  distance: Math.max(1, Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)),
});

/** Event-level state machine, also used directly by the interaction verification. */
export class DrawingInteraction {
  constructor({ document, box, viewport, setViewport, style, canDraw, canNavigate,
    schedule = (callback, delay) => setTimeout(callback, delay), unschedule = id => clearTimeout(id), changed = () => {} }) {
    Object.assign(this, { document, box, viewport, setViewport, style, canDraw, canNavigate, schedule, unschedule, changed });
    this.contacts = new Map(); this.phase = 'idle'; this.primary = null;
    this.queue = []; this.timer = null; this.epoch = 0; this.pinch = null;
  }
  clearTimer() { if (this.timer !== null) this.unschedule(this.timer); this.timer = null; this.epoch++; }
  down(point, surface = 'canvas') {
    this.contacts.set(point.id, { ...point, surface });
    if (surface !== 'canvas') { this.abort(false); return; }
    // A palm or another finger never changes an ongoing stylus stroke into navigation.
    if (this.primary !== null && this.contacts.get(this.primary)?.kind === 'pen') return;
    const fingers = [...this.contacts.values()].filter(p => p.surface === 'canvas' && p.kind !== 'pen');
    if (this.phase === 'blocked') return;
    if (fingers.length === 2 && this.canNavigate()) {
      this.clearTimer(); this.queue = []; this.document.end(); this.primary = null;
      this.phase = 'transform'; this.pinchIds = fingers.map(p => p.id); this.pinch = grip(fingers); this.changed(); return;
    }
    if (this.contacts.size !== 1) { this.abort(false); return; }
    this.primary = point.id; this.queue = [point]; this.phase = 'waiting';
    if (this.canDraw()) {
      if (point.kind === 'pen') this.startInk();
      else {
        const epoch = this.epoch;
        this.timer = this.schedule(() => { if (epoch === this.epoch && this.phase === 'waiting') this.startInk(); }, 80);
      }
    }
    this.changed();
  }
  startInk() {
    this.clearTimer();
    if (!this.canDraw() || this.contacts.size !== 1 || !this.queue.length) return;
    const first = framePoint(this.box(), this.viewport(), this.queue[0]);
    if (!first) { this.queue = []; this.phase = 'blocked'; this.primary = null; this.changed(); return; }
    this.document.begin(first, this.style());
    for (const point of this.queue.slice(1)) this.document.append(framePoint(this.box(), this.viewport(), point, true));
    this.queue = []; this.phase = 'ink'; this.changed();
  }
  move(point) {
    const previous = this.contacts.get(point.id);
    if (!previous) return;
    this.contacts.set(point.id, { ...previous, ...point });
    if (this.phase === 'transform') {
      const points = this.pinchIds.map(id => this.contacts.get(id));
      if (points.some(p => !p)) return;
      const next = grip(points);
      this.setViewport(transformViewport(this.box(), this.viewport(), this.pinch.focus, next.focus, next.distance / this.pinch.distance));
      this.pinch = next;
    } else if (point.id === this.primary && this.canDraw()) {
      if (this.phase === 'waiting') {
        this.queue.push(point);
        const first = this.queue[0];
        if (Math.hypot(point.x - first.x, point.y - first.y) >= 8) this.startInk();
      } else if (this.phase === 'ink') this.document.append(framePoint(this.box(), this.viewport(), point, true));
    }
    this.changed();
  }
  up(point) {
    if (!this.contacts.has(point.id)) return;
    if (this.phase === 'ink' && point.id !== this.primary && this.contacts.get(this.primary)?.kind === 'pen') {
      this.contacts.delete(point.id); this.changed(); return;
    }
    if (point.id === this.primary) {
      if (this.phase === 'waiting' && this.contacts.size === 1) this.startInk();
      if (this.phase === 'ink') {
        if (this.canDraw()) this.document.append(framePoint(this.box(), this.viewport(), point, true));
        this.document.end();
      }
    }
    this.contacts.delete(point.id); this.clearTimer(); this.queue = [];
    this.phase = this.contacts.size ? 'blocked' : 'idle'; this.primary = null; this.pinch = null; this.changed();
  }
  cancel(id) {
    if (this.phase === 'ink' && id !== this.primary && this.contacts.get(this.primary)?.kind === 'pen') {
      this.contacts.delete(id); this.changed(); return;
    }
    this.contacts.delete(id); this.abort(false);
  }
  abort(dropContacts = true) {
    this.clearTimer(); this.queue = []; this.document.end(); this.primary = null; this.pinch = null;
    if (dropContacts) this.contacts.clear();
    this.phase = this.contacts.size ? 'blocked' : 'idle'; this.changed();
  }
  snapshot() { return { phase: this.phase, contacts: [...this.contacts.values()], pendingSamples: this.queue.length }; }
}
