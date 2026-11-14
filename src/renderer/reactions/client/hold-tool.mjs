// A hold schedules individual bounded requests; the server never keeps a hold alive.
export function setupHoldTool({ button, hint, submit, isBusy = () => false, onStart = () => {}, onChange = () => {} }) {
 let active = false, revision = 0, pointer = null, heldKey = null, next = null, deadline = null, expiresAt = 0;
 const expiredMessage = '10秒経過したため停止しました。離してから、もう一度長押ししてください。';
 const refresh = () => { button.disabled = !active && isBusy(); button.setAttribute('aria-pressed', String(active)); };
 const stop = (message = '停止しました。もう一度長押しすると応援できます。') => {
  active = false; revision++; clearTimeout(next); clearTimeout(deadline); next = deadline = null;
  const id = pointer; pointer = null; heldKey = null;
  if (id !== null && button.hasPointerCapture?.(id)) button.releasePointerCapture(id);
  hint.textContent = message; refresh(); onChange();
 };
 const live = operation => {
  if (!active || operation !== revision || document.hidden) return false;
  // An overdue pulse may run before the ten-second timer after an event-loop stall.
  if (performance.now() >= expiresAt) { stop(expiredMessage); return false; }
  return true;
 };
 const pulse = async (operation, continuing = false) => {
  if (!live(operation)) return;
  if (!continuing) hint.textContent = '応援を送信しています…';
  try {
   const result = await submit({ kind: 'cheer' }, { announcePending: !continuing });
   if (!live(operation)) return;
   if (!result) { stop('応援を停止しました。送信結果を確認してから押し直してください。自動では再送しません。'); return; }
   if (!continuing) hint.textContent = '応援中！ 離すと追加送信を停止します（最大10秒）。';
   next = setTimeout(() => { next = null; void pulse(operation, true); }, 1000);
  } catch { if (live(operation)) stop('送信結果を確認できません。応援を停止しました。自動では再送しません。'); }
 };
 const start = () => {
  if (active || isBusy() || document.hidden) return false;
  onStart(); active = true; expiresAt = performance.now() + 10000; const operation = ++revision; refresh(); onChange();
  deadline = setTimeout(() => stop(expiredMessage), 10000);
  void pulse(operation); return true;
 };
 const down = event => { if (event.button !== 0 || event.isPrimary === false) return; event.preventDefault(); if (start()) { button.focus({ preventScroll: true }); pointer = event.pointerId; button.setPointerCapture?.(pointer); } };
 const up = event => { if (pointer === event.pointerId) stop(); };
 const keydown = event => { if (!['Enter', ' '].includes(event.key)) return; event.preventDefault(); if (!event.repeat && start()) heldKey = event.key; };
 const keyup = event => { if (heldKey === event.key) { event.preventDefault(); stop(); } };
 const escape = event => { if (active && event.key === 'Escape') { event.preventDefault(); stop(); } };
 const blur = () => { if (active) stop(); };
 const visibility = () => { if (document.hidden) blur(); };
 const click = event => event.preventDefault();
 button.addEventListener('pointerdown', down); button.addEventListener('pointerup', up); button.addEventListener('pointercancel', up); button.addEventListener('lostpointercapture', up);
 button.addEventListener('keydown', keydown); button.addEventListener('blur', blur); button.addEventListener('click', click);
 document.addEventListener('keyup', keyup); document.addEventListener('keydown', escape); document.addEventListener('visibilitychange', visibility);
 window.addEventListener('blur', blur); window.addEventListener('pagehide', blur);
 refresh();
 return { refresh, active: () => active, close() {
  stop(); button.removeEventListener('pointerdown', down); button.removeEventListener('pointerup', up); button.removeEventListener('pointercancel', up); button.removeEventListener('lostpointercapture', up);
  button.removeEventListener('keydown', keydown); button.removeEventListener('blur', blur); button.removeEventListener('click', click);
  document.removeEventListener('keyup', keyup); document.removeEventListener('keydown', escape); document.removeEventListener('visibilitychange', visibility);
  window.removeEventListener('blur', blur); window.removeEventListener('pagehide', blur);
 } };
}
