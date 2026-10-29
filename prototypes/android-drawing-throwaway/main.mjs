import { OUTPUT, COLORS, WIDTHS, geometry, initialViewport, transformViewport, DrawingDocument, DrawingInteraction } from './model.mjs';

const $ = selector => document.querySelector(selector);
const phone = $('#phone'), area = $('#viewport'), canvas = $('#preview');
const state = { tool: 'pen', color: COLORS[0][1], width: WIDTHS[1][1], mode: true,
  session: 1, status: 'normal', viewport: null, nextView: 'whole', modal: null, outputRevision: 0 };
const icons = {
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  sending: '<path d="M3 9a14 14 0 0 1 18 0M6 12a9 9 0 0 1 12 0M9 15a4 4 0 0 1 6 0"/><circle cx="12" cy="19" r="1"/>',
  pen: '<path d="m15 4 5 5-11 11H4v-5Z M12 7l5 5M4 20l5-1"/>',
  eraser: '<path d="m14 3 7 7-10 11H6L2 17Z M7 12l7 7M11 21h11"/>',
  undo: '<path d="M8 5 3 10l5 5M3 10h11a6 6 0 0 1 0 12"/>',
  whole: '<path d="M9 3H3v6M15 3h6v6M3 15v6h6M21 15v6h-6"/><rect x="7" y="8" width="10" height="8" rx="1"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
};
const svg = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
document.querySelectorAll('[data-action]').forEach(button => {
  const action = button.dataset.action;
  if (action === 'palette') button.innerHTML = '<span class="swatch" aria-hidden="true"></span>';
  else if (icons[action] || action === 'dismiss' || action === 'clear') button.innerHTML = svg(action === 'dismiss' ? 'close' : action === 'clear' ? 'trash' : action);
});
if (new URLSearchParams(location.search).has('device')) document.body.classList.add('device');

const makeCanvas = () => Object.assign(document.createElement('canvas'), OUTPUT);
const scene = makeCanvas(), baseline = makeCanvas(), ink = makeCanvas(), published = makeCanvas();
const sceneContext = scene.getContext('2d'), baselineContext = baseline.getContext('2d');
const inkContext = ink.getContext('2d'), publishedContext = published.getContext('2d');
// Generated locally: an intentionally fictional portrait camera in a landscape output frame.
function paintScene() {
  const c = sceneContext;
  c.fillStyle = '#151d19'; c.fillRect(0, 0, OUTPUT.width, OUTPUT.height);
  c.save(); c.beginPath(); c.rect(437, 0, 406, 720); c.clip();
  const light = c.createLinearGradient(437, 0, 843, 720);
  light.addColorStop(0, '#dddfbd'); light.addColorStop(1, '#8ea18b');
  c.fillStyle = light; c.fillRect(437, 0, 406, 720);
  c.fillStyle = '#b69167'; c.fillRect(437, 335, 406, 385);
  for (let y = 350; y < 720; y += 55) {
    c.strokeStyle = '#8c6b4844'; c.lineWidth = 2; c.beginPath(); c.moveTo(437, y); c.lineTo(843, y + 5); c.stroke();
  }
  c.save(); c.translate(645, 490); c.rotate(-.09);
  c.shadowColor = '#2e432b50'; c.shadowBlur = 20; c.shadowOffsetY = 8;
  c.fillStyle = '#fff7e5'; c.fillRect(-143, -143, 286, 285); c.shadowBlur = 0;
  c.strokeStyle = '#b1c5b6'; c.lineWidth = 1;
  for (let y = -89; y < 135; y += 26) { c.beginPath(); c.moveTo(-120, y); c.lineTo(120, y); c.stroke(); }
  c.strokeStyle = '#dda692'; c.beginPath(); c.moveTo(-94, -130); c.lineTo(-94, 142); c.stroke();
  c.fillStyle = '#376748'; c.font = 'bold 27px sans-serif'; c.fillText('今日のメモ', -73, -102);
  c.restore();
  c.fillStyle = '#98735d'; c.beginPath(); c.ellipse(759, 274, 43, 12, 0, 0, Math.PI * 2); c.fill();
  c.fillRect(723, 266, 72, 71); c.fillStyle = '#5d8666';
  for (const [x, y, r] of [[743, 212, -.5], [774, 221, .6], [759, 182, .15]]) {
    c.beginPath(); c.ellipse(x, y, 17, 42, r, 0, Math.PI * 2); c.fill();
  }
  c.strokeStyle = '#426e48'; c.lineWidth = 5; c.beginPath(); c.moveTo(760, 277); c.lineTo(759, 191); c.stroke();
  c.fillStyle = '#faf4df'; c.beginPath(); c.ellipse(507, 361, 38, 18, 0, 0, Math.PI * 2); c.fill();
  c.fillRect(469, 312, 76, 48); c.beginPath(); c.ellipse(507, 312, 38, 18, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#714d37'; c.beginPath(); c.ellipse(507, 312, 30, 12, 0, 0, Math.PI * 2); c.fill();
  c.restore();
}
function paintOperation(c, op) {
  if (op.kind === 'clear') { c.clearRect(0, 0, OUTPUT.width, OUTPUT.height); return; }
  c.save(); c.globalCompositeOperation = op.tool === 'eraser' ? 'destination-out' : 'source-over';
  c.strokeStyle = op.color; c.fillStyle = op.color; c.lineWidth = op.width * OUTPUT.height;
  c.lineCap = 'round'; c.lineJoin = 'round';
  const first = op.points[0];
  if (op.points.length === 1) { c.beginPath(); c.arc(first.x * OUTPUT.width, first.y * OUTPUT.height, c.lineWidth / 2, 0, Math.PI * 2); c.fill(); }
  else {
    c.beginPath(); c.moveTo(first.x * OUTPUT.width, first.y * OUTPUT.height);
    for (const p of op.points.slice(1)) c.lineTo(p.x * OUTPUT.width, p.y * OUTPUT.height);
    c.stroke();
  }
  c.restore();
}
let renderRequest = null, ready = false;
const drawing = new DrawingDocument(() => { if (ready) updateInk(); }, op => paintOperation(baselineContext, op));
function updateInk() {
  inkContext.clearRect(0, 0, OUTPUT.width, OUTPUT.height); inkContext.drawImage(baseline, 0, 0);
  for (const op of drawing.operations) paintOperation(inkContext, op);
  if (drawing.active) paintOperation(inkContext, drawing.active);
  if (state.status === 'normal') publish();
  updateControls(); requestRender();
}
function publish() {
  publishedContext.clearRect(0, 0, OUTPUT.width, OUTPUT.height); publishedContext.drawImage(ink, 0, 0);
  state.outputRevision = drawing.revision;
}
const box = () => ({ width: area.clientWidth, height: area.clientHeight });
const blocked = () => !state.mode || !!state.modal || state.status === 'hidden';
const canDraw = () => !blocked() && state.status !== 'error';
let zoomTimer, mousePan = null, space = false;
function setViewport(next) {
  state.viewport = next;
  $('#zoom-label').textContent = `${next.zoom.toFixed(1)}×`; $('#zoom-label').hidden = false;
  clearTimeout(zoomTimer); zoomTimer = setTimeout(() => { $('#zoom-label').hidden = true; }, 900);
  requestRender();
}
const interaction = new DrawingInteraction({ document: drawing, box, viewport: () => state.viewport,
  setViewport, style: () => ({ tool: state.tool, color: state.color, width: state.width }),
  canDraw, canNavigate: () => !blocked(), changed: () => requestRender() });
function cancelInput(dropContacts = true) { mousePan = null; interaction.abort(dropContacts); }
function render() {
  renderRequest = null;
  const size = box(), dpr = window.devicePixelRatio || 1;
  if (!state.viewport) state.viewport = initialViewport(size);
  if (canvas.width !== Math.round(size.width * dpr) || canvas.height !== Math.round(size.height * dpr)) {
    canvas.width = Math.round(size.width * dpr); canvas.height = Math.round(size.height * dpr);
  }
  const c = canvas.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = '#151d19'; c.fillRect(0, 0, size.width, size.height);
  if (state.status !== 'hidden') {
    const frame = geometry(size, state.mode ? state.viewport : { zoom: 1, panX: 0, panY: 0 });
    c.drawImage(scene, frame.left, frame.top, frame.width, frame.height);
    c.drawImage(state.mode ? ink : published, frame.left, frame.top, frame.width, frame.height);
  }
  if ($('#inspector').open) $('#payload').textContent = JSON.stringify(snapshot(), null, 2);
}
function requestRender() { if (renderRequest === null) renderRequest = requestAnimationFrame(render); }
function updateControls() {
  $('#tools').hidden = !state.mode; $('#top-controls').hidden = !state.mode;
  $('#inline-reopen').hidden = state.mode;
  for (const name of ['pen', 'eraser']) $(`[data-action=${name}]`).setAttribute('aria-pressed', String(state.tool === name));
  for (const name of ['pen', 'eraser', 'palette', 'undo']) $(`[data-action=${name}]`).disabled = !canDraw() || (name === 'undo' && !drawing.canUndo);
  $(`[data-action=whole]`).disabled = blocked();
  $(`[data-action=clear]`).disabled = !canDraw() || !(drawing.canUndo || drawing.folded > 0);
  const viewLabel = state.nextView === 'whole' ? '送信映像全体を表示' : '映像中央を表示領域いっぱいに拡大';
  $(`[data-action=whole]`).setAttribute('aria-label', viewLabel);
  $(`[data-action=whole]`).title = viewLabel;
  $('.swatch').style.background = state.color; $('.swatch').style.color = state.color;
  $('.swatch').style.setProperty('--stroke', `${state.width * 400}px`);
  $(`[data-action=palette]`).setAttribute('aria-label', `色と太さ。${COLORS.find(c => c[1] === state.color)[0]}、${WIDTHS.find(w => w[1] === state.width)[0]}`);
  const chip = $('#state-chip'), retry = $('[data-action=retry]');
  chip.hidden = state.status === 'normal'; chip.classList.toggle('error', state.status === 'error');
  $('#state-label').textContent = { pending: '反映待ち', error: '手書きを更新できません', hidden: '映像非表示中' }[state.status] ?? '';
  chip.setAttribute('aria-label', state.status === 'pending' ? '配信映像への反映待ち' : $('#state-label').textContent);
  retry.hidden = state.status !== 'error';
}
let returnFocus, beforeError = 'normal';
function dismiss() {
  state.modal = null; $('#scrim').hidden = true; cancelInput(false);
  updateControls(); returnFocus?.focus(); requestRender();
}
function openSheet(kind) {
  cancelInput(false); state.modal = kind; returnFocus = $(`[data-action=${kind}]`);
  const content = $('#sheet-content'); content.replaceChildren();
  const title = { palette: '色と太さ', sending: '送信・配信' }[kind];
  $('#sheet-title').textContent = title; $('#sheet').setAttribute('aria-label', title); $('#scrim').hidden = false;
  if (kind === 'palette') {
    for (const [heading, choices, field] of [['色', COLORS, 'color'], ['太さ', WIDTHS, 'width']]) {
      const h = document.createElement('h3'); h.textContent = heading; content.append(h);
      const grid = document.createElement('div'); grid.className = `${field === 'color' ? 'color' : 'width'}-grid`; content.append(grid);
      for (const [label, value] of choices) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'choice';
        button.dataset[field] = String(value); button.setAttribute('aria-pressed', String(state[field] === value));
        const mark = document.createElement('span'); mark.setAttribute('aria-hidden', 'true');
        mark.className = field === 'color' ? 'color-dot' : 'weight-line';
        if (field === 'color') mark.style.background = value; else mark.style.height = `${value * 400}px`;
        button.append(mark, document.createTextNode(label));
        button.addEventListener('click', () => { state[field] = value; if (field === 'color') state.tool = 'pen'; dismiss(); });
        grid.append(button);
      }
    }
  } else {
    const note = document.createElement('p'); note.className = 'sheet-note';
    note.textContent = 'これは画面の見本です。実際の送信は行いません。'; content.append(note);
    const button = document.createElement('button'); button.type = 'button'; button.className = 'menu-item destructive';
    button.innerHTML = svg('sending');
    button.append(document.createTextNode('見本の送信を停止'));
    button.dataset.action = 'stop';
    button.addEventListener('click', () => {
      dismiss(); endSession();
    }); content.append(button);
  }
  $('#sheet').focus(); updateControls(); requestRender();
}
function closeMode() { dismiss(); cancelInput(); state.mode = false; updateControls(); requestRender(); }
function endSession() { cancelInput(); state.mode = false; state.status = 'normal'; drawing.reset(); updateControls(); requestRender(); }
function newSession() {
  dismiss(); cancelInput(); state.session++; state.mode = true; state.status = 'normal'; state.viewport = null; state.nextView = 'whole';
  $('#scenario').value = 'normal'; drawing.reset(); updateControls(); requestRender();
}
function setScenario(value) {
  cancelInput(); if (value === 'error' && state.status !== 'error') beforeError = state.status;
  state.status = value; $('#scenario').value = value;
  if (value === 'normal') publish(); updateControls(); requestRender();
}
let tooltipTimer, tooltipHide, suppressClick = null;
area.addEventListener('click', event => {
  const button = event.target.closest('[data-action]'); if (!button || button.disabled) return;
  if (suppressClick === button) { suppressClick = null; return; }
  const action = button.dataset.action;
  if (action === 'pen' || action === 'eraser') { cancelInput(false); state.tool = action; }
  else if (action === 'palette' || action === 'sending') openSheet(action);
  else if (action === 'undo') { cancelInput(false); drawing.undo(); }
  else if (action === 'clear') { cancelInput(false); drawing.clear(); }
  else if (action === 'whole') {
    cancelInput(false);
    setViewport(state.nextView === 'whole' ? { zoom: 1, panX: 0, panY: 0 } : initialViewport(box()));
    state.nextView = state.nextView === 'whole' ? 'fill' : 'whole';
  }
  else if (action === 'close') closeMode();
  else if (action === 'dismiss') dismiss();
  else if (action === 'retry') setScenario(beforeError);
  updateControls(); requestRender();
});
$('#scrim').addEventListener('click', event => { if (event.target === $('#scrim')) dismiss(); });
const pointer = event => {
  const rect = area.getBoundingClientRect();
  return { id: event.pointerId, kind: event.pointerType || 'mouse', x: event.clientX - rect.left, y: event.clientY - rect.top };
};

area.addEventListener('pointerdown', event => {
  const onCanvas = event.target === canvas;
  if (onCanvas) {
    event.preventDefault(); if (event.isTrusted) canvas.setPointerCapture(event.pointerId);
    if (space && event.pointerType === 'mouse' && !blocked()) { cancelInput(); mousePan = pointer(event); return; }
  }
  if (!onCanvas) mousePan = null;
  interaction.down(pointer(event), onCanvas ? 'canvas' : 'tool');
  const button = event.target.closest('button[title]');
  if (button && !button.disabled) {
    suppressClick = null;
    clearTimeout(tooltipHide); $('#tooltip').hidden = true;
    tooltipTimer = setTimeout(() => { $('#tooltip').textContent = button.title; $('#tooltip').hidden = false; suppressClick = button; }, 500);
  }
}, true);
area.addEventListener('pointermove', event => {
  if (mousePan?.id === event.pointerId) {
    if (blocked()) { cancelInput(); return; }
    const next = pointer(event); setViewport(transformViewport(box(), state.viewport, mousePan, next, 1)); mousePan = next;
  } else interaction.move(pointer(event));
});
document.addEventListener('pointerup', event => {
  clearTimeout(tooltipTimer); tooltipHide = setTimeout(() => { $('#tooltip').hidden = true; }, 1200);
  if (mousePan?.id === event.pointerId) mousePan = null;
  else interaction.up(pointer(event));
}, true);
area.addEventListener('pointercancel', event => { clearTimeout(tooltipTimer); mousePan = null; interaction.cancel(event.pointerId); });
canvas.addEventListener('lostpointercapture', event => {
  if (mousePan?.id === event.pointerId) mousePan = null;
  if (interaction.contacts.has(event.pointerId)) interaction.cancel(event.pointerId);
});
canvas.addEventListener('wheel', event => {
  event.preventDefault(); if (blocked()) return; cancelInput();
  const focus = pointer(event); setViewport(transformViewport(box(), state.viewport, focus, focus, Math.exp(-event.deltaY * .002)));
}, { passive: false });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { if (state.modal) dismiss(); else if (state.mode) closeMode(); }
  if (event.code === 'Space' && !event.target.closest('button,select,a,input,summary')) { event.preventDefault(); space = true; }
  if (state.modal && event.key === 'Tab') {
    const buttons = [...$('#sheet').querySelectorAll('button:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement), next = (index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
    event.preventDefault(); buttons[next].focus();
  }
});
document.addEventListener('keyup', event => { if (event.code === 'Space') space = false; });
window.addEventListener('blur', () => { space = false; mousePan = null; clearTimeout(tooltipTimer); cancelInput(); });

function setSize(value) {
  cancelInput(); mousePan = null;
  phone.style.width = `${value}px`; phone.style.height = value === 760 ? '400px' : value === 320 ? '690px' : '820px';
  $('#size').value = String(value); requestRender();
}
$('#size').addEventListener('change', event => setSize(Number(event.target.value)));
$('#theme').addEventListener('change', event => { phone.dataset.theme = event.target.value; });
$('#font').addEventListener('change', event => { phone.style.setProperty('--text-scale', event.target.value); });
$('#scenario').addEventListener('change', event => setScenario(event.target.value));
for (const selector of ['#reopen', '#inline-reopen']) $(selector).addEventListener('click', () => { cancelInput(); state.mode = true; updateControls(); requestRender(); });
$('#new-session').addEventListener('click', newSession);
$('#inspector').addEventListener('toggle', requestRender);
new ResizeObserver(() => { cancelInput(); mousePan = null; requestRender(); }).observe(area);
function snapshot() {
  return { ...state, output: OUTPUT, box: box(), document: drawing.snapshot(), gesture: interaction.snapshot(),
    previewRevision: state.mode ? drawing.revision : state.outputRevision, simulated: true };
}
// Local review/testing interface. It exposes only the fictional in-memory scene.
window.casmateDrawingPrototype = {
  getState: snapshot,
  setState(options) {
    if (options.size) setSize(options.size);
    if (options.theme) { phone.dataset.theme = options.theme; $('#theme').value = options.theme; }
    if (options.font) { phone.style.setProperty('--text-scale', options.font); $('#font').value = String(options.font); }
    if (options.status) setScenario(options.status);
    if (options.reset) newSession();
  },
};
paintScene(); ready = true; updateInk(); requestRender();
