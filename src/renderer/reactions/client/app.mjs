// Listener browser client. A configured live player is loaded in its own frame.
import { REACTION_STICKERS } from '../../../shared/reaction-stickers.ts';
import { scaleMarkerLayer, watchFrames } from './pointing.mjs';
import { setupRangeTool } from './range-tool.mjs';
import { setupArrowTool } from './arrow-tool.mjs';
import { setupPointingTool } from './pointing-tool.mjs';
import { setupHoldTool } from './hold-tool.mjs';
import { setupPreviewWidth } from './preview-width.mjs';
import { watchPreviewSettings } from './preview-settings.mjs';
import { readLivePreview, setupLivePreview } from './live-preview.mjs';

if (document.body.dataset.page === 'listener') {
  const stickers = document.querySelector('#character-reactions');
  for (const entry of REACTION_STICKERS) { const button = document.createElement('button'); button.type = 'button'; button.dataset.kind = 'sticker'; button.dataset.sticker = entry.id; button.textContent = entry.name; stickers?.append(button); }
  const buttons = [...document.querySelectorAll('[data-kind]')];
  const status = document.querySelector('#status');
  status.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || status.scrollHeight <= status.clientHeight) return;
    const next = {ArrowUp:status.scrollTop-20,ArrowDown:status.scrollTop+20,PageUp:status.scrollTop-status.clientHeight,PageDown:status.scrollTop+status.clientHeight,Home:0,End:status.scrollHeight-status.clientHeight};
    if (!Object.hasOwn(next,event.key)) return;
    event.preventDefault(); status.scrollTop = next[event.key];
  });
  const feedback = document.querySelector('.reaction-feedback');
  const showResult = (state, message) => {
    if (feedback.dataset.state === state && status.textContent === message) return;
    feedback.dataset.state = state;
    feedback.querySelector('.feedback-icon').textContent = {pending:'…',success:'✓',error:'!',unknown:'?'}[state] ?? '○';
    status.textContent = message;
  };
  const stage = document.querySelector('#screen-stage');
  const localMarkers = document.createElement('div'); localMarkers.className = 'local-markers';
  const localAreas = document.createElement('div'); localAreas.className = 'area-layer';
  let sending = false, generation = null, pointTool, areaTool, arrowTool, holdTool, liveControl;
  const busy = () => sending || !!holdTool?.active();
  const refreshTools = () => {
    pointTool?.refresh(); areaTool?.refresh(); arrowTool?.refresh(); holdTool?.refresh();
    const disabled = String(busy());
    for (const button of buttons) button.setAttribute('aria-disabled', disabled);
  };
  const invalidateTools = () => { pointTool?.invalidate(); areaTool?.invalidate(); arrowTool?.invalidate(); localAreas.replaceChildren(); };
  const livePreview = readLivePreview();
  const frames = watchFrames({ stage, enabled: !livePreview, metadataOnly: !!livePreview, status: document.querySelector('#screen-status'), onFrame: frame => {
    liveControl?.layout(frame);
    if (generation !== frame.generation) { localMarkers.replaceChildren(); invalidateTools(); }
    generation = frame.generation;
    if (!localMarkers.isConnected) stage.append(localMarkers);
    if (!localAreas.isConnected) stage.append(localAreas);
    scaleMarkerLayer(localMarkers, frame.canvasWidth);
    scaleMarkerLayer(localAreas, frame.canvasWidth);
    refreshTools();
  }, onUnavailable: () => { localMarkers.replaceChildren(); invalidateTools(); } });
  const send = async (payload, { announcePending = true } = {}) => {
    if (sending) return null;
    const submittedFrame = payload.frameId ? frames.current() : null;
    sending = true;
    refreshTools();
    if (announcePending) showResult('pending', '送信中…');
    try {
      const response = await fetch('/react', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(8000) });
      const result = await response.json();
      if (response.ok) showResult('success', payload.kind === 'sticker' ? `${REACTION_STICKERS.find(entry => entry.id === payload.sticker)?.name ?? 'リアクション'}を送りました` : {point:'場所を送りました',area:'範囲を送りました',arrow:'矢印を送りました',heart:'ハートを送りました',clap:'拍手を送りました',cheer:'応援を送りました'}[payload.kind]);
      else showResult('error', `送信できません：${result.message || 'もう一度確認してください。'}`);
      if (response.status === 409 && submittedFrame) {
        const retired = result.code === 'FRAME_RETIRED' ? result : {};
        const confirmedGeneration = Number.isSafeInteger(retired.generation) ? retired.generation : undefined;
        const confirmedInstance = typeof retired.instance === 'string' ? retired.instance : undefined;
        frames.rejectPlacement(submittedFrame, confirmedGeneration, confirmedInstance);
      }
      return response.ok ? result : null;
    } catch { showResult('unknown', '送信結果を確認できません。接続を確認してください。自動では再送しません。'); return null; }
    finally { setTimeout(() => { sending = false; refreshTools(); }, 800); }
  };
  pointTool = setupPointingTool({ buttons: {look:document.querySelector('#point-tool'),question:document.querySelector('#question-tool'),danger:document.querySelector('#danger-tool')}, stage, layer: localMarkers,
    hint: document.querySelector('#point-hint'), getFrame: frames.current, getPoint: frames.point, submit: send, isBusy: busy, onArm: () => {areaTool?.invalidate();arrowTool?.invalidate();},
  });
  areaTool = setupRangeTool({buttons:{ellipse:document.querySelector('#ellipse-tool'),rectangle:document.querySelector('#rectangle-tool')},stage,layer:localAreas,hint:document.querySelector('#range-hint'),getFrame:frames.current,getPoint:frames.point,submit:send,isBusy:busy,onArm:()=>{pointTool.invalidate();arrowTool?.invalidate();},pause:frames.pause,resume:frames.resume,remaining:frames.remaining});
  arrowTool = setupArrowTool({button:document.querySelector('#arrow-tool'),stage,layer:localAreas,hint:document.querySelector('#arrow-hint'),getFrame:frames.current,getPoint:frames.point,submit:send,isBusy:busy,onArm:()=>{pointTool.invalidate();areaTool.invalidate();},pause:frames.pause,resume:frames.resume,remaining:frames.remaining});
  holdTool = setupHoldTool({button:document.querySelector('#cheer-hold'),hint:document.querySelector('#hold-hint'),submit:send,isBusy:()=>sending,onStart:()=>{pointTool.invalidate();areaTool.invalidate();arrowTool.invalidate();},onChange:refreshTools});
  liveControl = setupLivePreview(livePreview, frames.setEnabled, { setMetadataOnly: frames.setMetadataOnly, cancel: invalidateTools });
  setupPreviewWidth(invalidateTools);
  watchPreviewSettings(config => liveControl.update(readLivePreview(config)));
  for (const button of buttons) button.addEventListener('click', () => { if (!busy()) void send({ kind: button.dataset.kind, ...(button.dataset.sticker ? {sticker:button.dataset.sticker} : {}) }); });
}
