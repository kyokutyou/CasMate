// Local-only selection/preview. Only a committed placement calls submit().
import { moveMarker, placeMarker } from './pointing.mjs';

export function setupPointingTool({ button, buttons = { look: button }, stage, layer, hint, getFrame, getPoint, submit, isBusy = () => false, onArm = () => {} }) {
  let intent = 'look';
  let armed = false, pending = false, revision = 0, ghost = null, pendingMarker = null;
  let aim = { x: .5, y: .5 };
  const removeGhost = () => { ghost?.remove(); ghost = null; };
  const refresh = () => {
    for (const [id, control] of Object.entries(buttons)) {
      control.disabled = !getFrame() || pending || isBusy();
      control.setAttribute('aria-pressed', String(armed && intent === id));
    }
    stage.classList.toggle('is-pointing', armed && !pending);
    stage.setAttribute('aria-disabled', String(!armed || !getFrame() || pending || isBusy()));
  };
  const cancel = () => {
    armed = false; removeGhost(); refresh();
    hint.textContent = '選んで、画面をタップ';
  };
  const invalidate = () => {
    revision++; pendingMarker?.remove(); pendingMarker = null; cancel();
  };
  const preview = coordinates => {
    const frame = getFrame();
    if (!armed || pending || isBusy() || !frame || !coordinates) { removeGhost(); return; }
    aim = coordinates;
    if (!ghost?.isConnected) ghost = placeMarker(layer, aim.x, aim.y, frame.canvasWidth, { duration: 0, variant: 'marker-preview', intent });
    else moveMarker(ghost, aim.x, aim.y);
  };
  const place = async coordinates => {
    const frame = getFrame();
    if (!armed || pending || isBusy() || !frame || !coordinates) return;
    armed = false; pending = true; const operation = ++revision; removeGhost();
    pendingMarker = placeMarker(layer, coordinates.x, coordinates.y, frame.canvasWidth, { duration: 0, variant: 'marker-pending', intent });
    const placed = pendingMarker;
    hint.textContent = '指定した場所を送信しています…'; refresh();
    const sentAt = performance.now();
    try {
      const result = await submit({ kind: 'point', intent, frameId: frame.id, ...coordinates });
      if (operation !== revision || getFrame()?.generation !== frame.generation) return;
      if (result) {
        const duration = 4000 - (performance.now() - sentAt);
        if (duration > 0) placeMarker(layer, coordinates.x, coordinates.y, frame.canvasWidth, { duration, intent });
        hint.textContent = '続けるには、もう一度道具を選んでください。';
      } else hint.textContent = '配置できませんでした。送信結果を確認してから、もう一度選んでください。';
    } catch { if (operation === revision) hint.textContent = '送信結果を確認できません。自動では再送しません。'; }
    finally { placed.remove(); if (pendingMarker === placed) pendingMarker = null; pending = false; refresh(); }
  };
  const toggle = next => {
    if (buttons[next].disabled || pending || isBusy() || !getFrame()) return;
    if (armed && intent === next) { cancel(); return; }
    onArm(); intent = next; armed = true; aim = { x: .5, y: .5 }; removeGhost(); refresh();
    hint.textContent = '伝えたい場所をクリック／タップ';
    stage.focus({ preventScroll: true });
  };
  const move = event => {
    if (event.pointerType === 'touch') return;
    preview(getPoint(event.clientX, event.clientY));
  };
  const click = event => { void place(getPoint(event.clientX, event.clientY)); };
  const key = event => {
    if (!armed || pending || isBusy() || !getFrame()) return;
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void place(aim); return; }
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    preview({ x: Math.max(0, Math.min(1, aim.x + (event.key === 'ArrowLeft' ? -.05 : event.key === 'ArrowRight' ? .05 : 0))), y: Math.max(0, Math.min(1, aim.y + (event.key === 'ArrowUp' ? -.05 : event.key === 'ArrowDown' ? .05 : 0))) });
  };
  const escape = event => { if (event.key === 'Escape' && armed && !pending) { event.preventDefault(); cancel(); } };
  const background = () => { if (document.hidden) invalidate(); };
  const toggles = Object.entries(buttons).map(([id, control]) => { const handler = () => toggle(id); control.addEventListener('click', handler); return () => control.removeEventListener('click', handler); });
  stage.addEventListener('pointermove', move); stage.addEventListener('pointerleave', removeGhost);
  stage.addEventListener('click', click); stage.addEventListener('keydown', key);
  document.addEventListener('keydown', escape); document.addEventListener('visibilitychange', background);
  cancel();
  return { refresh, invalidate, close() {
    invalidate();
    toggles.forEach(remove => remove());
    stage.removeEventListener('pointermove', move); stage.removeEventListener('pointerleave', removeGhost);
    stage.removeEventListener('click', click); stage.removeEventListener('keydown', key);
    document.removeEventListener('keydown', escape); document.removeEventListener('visibilitychange', background);
  } };
}
