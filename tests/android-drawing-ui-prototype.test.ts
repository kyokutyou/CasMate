import { describe, expect, it } from 'vitest';
import { DrawingDocument, DrawingInteraction, framePoint, geometry, initialViewport, transformViewport } from '../prototypes/android-drawing-throwaway/model.mjs';

function fixture() {
  let view = initialViewport({ width: 320, height: 700 });
  let timer: (() => void) | null = null;
  let enabled = true;
  const document = new DrawingDocument();
  const interaction = new DrawingInteraction({
    document, box: () => ({ width: 320, height: 700 }), viewport: () => view,
    setViewport: value => { view = value; }, style: () => ({ tool: 'pen', color: '#ffffff', width: .008 }),
    canDraw: () => enabled, canNavigate: () => true,
    schedule: callback => { timer = callback; return 1; }, unschedule: () => { timer = null; },
  });
  return { document, interaction, view: () => view, tick: () => timer?.(), disable: () => { enabled = false; interaction.abort(false); } };
}
const point = (id: number, x = 160, y = 350, kind = 'touch') => ({ id, x, y, kind });

describe('throwaway drawing interactions', () => {
  it('opens enlarged, preserves the pinch anchor and maps touched output coordinates', () => {
    const box = { width: 320, height: 700 };
    const original = initialViewport(box);
    expect(original.zoom).toBeGreaterThan(3);
    const focus = { x: 150, y: 360 };
    const before = framePoint(box, original, focus)!;
    const next = transformViewport(box, original, focus, { x: 170, y: 380 }, 1.2);
    const after = framePoint(box, next, { x: 170, y: 380 })!;
    expect(after.x).toBeCloseTo(before.x); expect(after.y).toBeCloseTo(before.y);
    const fit = geometry(box, { zoom: 1, panX: 0, panY: 0 });
    expect(fit.width).toBe(320); expect(fit.height).toBe(180);
    expect(framePoint(box, { zoom: 1, panX: 0, panY: 0 }, { x: 160, y: 0 })).toBeNull();
  });
  it('does not draw from the first finger of a pinch or from its remaining finger', () => {
    const f = fixture();
    f.interaction.down(point(1, 100)); f.interaction.down(point(2, 220));
    f.tick(); f.interaction.move(point(2, 270)); f.interaction.up(point(2, 270));
    f.interaction.move(point(1, 140)); f.interaction.up(point(1, 140));
    expect(f.document.revision).toBe(0); expect(f.document.canUndo).toBe(false);
    expect(f.view().zoom).toBeGreaterThan(initialViewport({ width: 320, height: 700 }).zoom);
  });
  it('retains valid ink before switching to two-finger navigation', () => {
    const f = fixture(); f.interaction.down(point(1)); f.interaction.move(point(1, 175));
    f.interaction.down(point(2, 240)); f.interaction.move(point(2, 260));
    f.interaction.up(point(1, 175)); f.interaction.up(point(2, 260));
    expect(f.document.operations).toHaveLength(1); expect(f.document.active).toBeNull();
  });
  it('draws taps on release and stylus immediately, without turning a palm into navigation', () => {
    const f = fixture(); f.interaction.down(point(1)); expect(f.document.revision).toBe(0);
    f.interaction.up(point(1)); expect(f.document.operations).toHaveLength(1);
    f.interaction.down(point(2, 160, 350, 'pen')); expect(f.document.active).not.toBeNull();
    const zoom = f.view().zoom;
    f.interaction.down(point(3, 230)); f.interaction.move(point(3, 280));
    expect(f.view().zoom).toBe(zoom);
    f.interaction.up(point(3, 280)); expect(f.document.active).not.toBeNull();
    f.interaction.move(point(2, 170, 350, 'pen')); f.interaction.up(point(2, 170, 350, 'pen'));
    expect(f.document.operations).toHaveLength(2);
  });
  it('cancels delayed input for tool touches, menus and pointer cancellation', () => {
    const f = fixture(); f.interaction.down(point(1)); f.interaction.down(point(2), 'tool');
    f.tick(); f.interaction.up(point(2)); f.interaction.up(point(1)); expect(f.document.revision).toBe(0);
    f.interaction.down(point(3)); f.disable(); f.tick(); f.interaction.up(point(3));
    expect(f.document.revision).toBe(0);
    const g = fixture(); g.interaction.down(point(1)); g.interaction.cancel(1); g.tick();
    expect(g.document.revision).toBe(0);
  });
  it('keeps exactly 50 undoable operations, folds older commands and can undo clear', () => {
    const folded: unknown[] = [];
    const document = new DrawingDocument(() => {}, operation => folded.push(operation));
    for (let i = 0; i < 53; i++) { document.begin({ x: .5, y: .5 }, { tool: 'pen', color: '#ff0000', width: .008 }); document.end(); }
    expect(document.operations).toHaveLength(50); expect(folded).toHaveLength(3);
    document.clear(); expect(document.operations.at(-1).kind).toBe('clear');
    expect(document.undo()).toBe(true); expect(document.operations.at(-1).kind).toBe('stroke');
  });
  it('discards a stroke started outside the output frame without retaining queued points', () => {
    const document = new DrawingDocument();
    const interaction = new DrawingInteraction({ document, box: () => ({ width: 320, height: 700 }),
      viewport: () => ({ zoom: 1, panX: 0, panY: 0 }), setViewport: () => {},
      style: () => ({ tool: 'pen', color: '#ffffff', width: .008 }), canDraw: () => true, canNavigate: () => true });
    interaction.down(point(1, 100, 10));
    for (let i = 0; i < 1000; i++) interaction.move(point(1, 120, 350));
    expect(interaction.snapshot().pendingSamples).toBe(0);
    interaction.up(point(1, 120, 350));
    expect(document.revision).toBe(0);
  });
});
