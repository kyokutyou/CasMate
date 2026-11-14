// Shared marker geometry: source image percentages, never page/container margins.
import { REACTION_POINT_INTENTS, validReactionPointIntent } from '../../../shared/reaction-point.ts';
import { createPointScene } from './point-scene.mjs';
export function imagePoint(rect, clientX, clientY) {
  if (!(rect.width > 0 && rect.height > 0)) return null;
  const x = (clientX - rect.left) / rect.width, y = (clientY - rect.top) / rect.height;
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}

const markerLayers = new WeakMap();
const markerScenes = new WeakMap();

export function scaleMarkerLayer(container, canvasWidth) {
  if (!Number.isFinite(canvasWidth) || canvasWidth <= 0) return;
  let state = markerLayers.get(container);
  if (!state) {
    state = { canvasWidth, observer: null };
    const update = () => {
      container.style.setProperty('--marker-scale', String(container.getBoundingClientRect().width / state.canvasWidth));
      for (const marker of container.querySelectorAll('.point-marker')) markerScenes.get(marker)?.resize();
    };
    state.observer = new ResizeObserver(update);
    state.observer.observe(container);
    state.update = update;
    markerLayers.set(container, state);
  }
  state.canvasWidth = canvasWidth;
  state.update();
}

export function moveMarker(marker, x, y) {
  const dot = marker.querySelector('.point-dot'), label = marker.querySelector('.point-label');
  dot.style.left = `${x * 100}%`; dot.style.top = `${y * 100}%`;
  label.style.left = `clamp(4em, ${x * 100}%, calc(100% - 4em))`;
  label.style.top = `${y * 100}%`; label.classList.toggle('below', y < .22);
  markerScenes.get(marker)?.move(x,y);
}

export function placeMarker(container, x, y, canvasWidth = 1920, { duration = 4000, variant = '', intent = 'look' } = {}) {
  scaleMarkerLayer(container, canvasWidth);
  while (container.childElementCount >= 10) container.firstElementChild.remove();
  const marker = document.createElement('div'); marker.className = 'point-marker';
  marker.dataset.intent = validReactionPointIntent(intent) ? intent : 'look';
  marker.style.setProperty('--point-age', `${-Math.max(0, 4000-duration)}ms`);
  if (!duration) marker.style.setProperty('--point-age', '0ms');
  const dot = document.createElement('span'); dot.className = 'point-dot';
  const label = document.createElement('span'); label.className = 'point-label'; label.textContent = REACTION_POINT_INTENTS[marker.dataset.intent];
  const body = document.createElement('span');body.className='point-label-body';body.textContent=label.textContent;label.replaceChildren(body);
  marker.append(dot, label); container.append(marker);
  if (variant) marker.classList.add(variant);
  const scene=createPointScene(marker,container,canvasWidth,marker.dataset.intent,Math.max(0,4000-duration),duration===0);
  markerScenes.set(marker,scene);moveMarker(marker,x,y);scene.start();
  if (duration > 0) {
    const timer = setTimeout(() => marker.remove(), duration);
    const observer = new MutationObserver(() => { if (!marker.isConnected) { clearTimeout(timer);scene.close();observer.disconnect(); } });
    observer.observe(container, { childList: true });
  }
  return marker;
}

const WAITING_FOR_OBS_IMAGE = 'OBSの最新画像を待っています。';
const WAITING_FOR_REPLACEMENT = '画像が更新されました。次の更新を待ってください。';
const FRAME_EXPIRED = '画像が古くなりました。次の更新を待ってください。';
const POLL_TIMEOUT_MS = 5000;
const frameState = response => {
  if (response.headers?.get('X-CasMate-Frame-State') !== 'unavailable') return;
  return response.headers.get('X-CasMate-Frame-Reason') === 'retired' ? 'retired' : 'unavailable';
};
const sameGeneration = (left, right) => !!left && !!right && left.instance === right.instance && left.generation === right.generation;

export function watchFrames({ stage, status, enabled = true, metadataOnly = false, onFrame = () => {}, onUnavailable = () => {}, clock = () => performance.now() }) {
  let current = null, image = null, currentUrl = null, stopped = false;
  let held = false, currentExpires = 0, waitingInForeground = false;
  let expiryTimer;
  let revision = 0, active = null, nextTimer = null, immediate = false;
  const unavailable = (message, temporary = false) => {
    clearTimeout(expiryTimer);
    const foreground = enabled && !document.hidden;
    if (!foreground) waitingInForeground = false;
    const waiting = stage.querySelector('.screen-wait');
    if (!current && waiting && waiting.textContent === status.textContent &&
        (temporary && waitingInForeground || waiting.textContent === message)) return;
    image?.removeAttribute('src');
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = null;
    current = null; image = null;
    stage.replaceChildren(Object.assign(document.createElement('span'), { className: 'screen-wait', textContent: message }));
    stage.setAttribute('aria-disabled', 'true'); status.textContent = message;
    waitingInForeground = foreground;
    onUnavailable();
  };
  const scheduleExpiry = expires => {
    currentExpires = expires;
    clearTimeout(expiryTimer);
    expiryTimer = setTimeout(() => unavailable(FRAME_EXPIRED), Math.max(0, Math.ceil(expires - clock())));
  };
  const poll = async () => {
    if (!enabled || stopped || document.hidden || held || active) return;
    clearTimeout(nextTimer); nextTimer = null; immediate = false;
    const operation = { revision, controller: new AbortController(), url: null, candidate: null, nextFrame: null, acceptReplacement: null, cancelDecode: null };
    active = operation;
    const started = clock();
    const live = () => !stopped && !document.hidden && !held && revision === operation.revision && !operation.controller.signal.aborted;
    let deadline = setTimeout(() => operation.controller.abort(), POLL_TIMEOUT_MS);
    let retainCurrent = true, temporary = true;
    try {
      const response = await fetch('/frame', { signal: operation.controller.signal });
      if (!live()) return;
      const unavailableState = frameState(response) === 'unavailable';
      retainCurrent = !unavailableState && (response.ok || response.status >= 500);
      temporary = retainCurrent || !unavailableState && (response.status === 404 || response.status === 429);
      if (unavailableState || response.status === 404 || response.status >= 500) {
        void response.body?.cancel().catch(() => {});
        throw new Error(retainCurrent ? 'OBS映像を取得できません。' : WAITING_FOR_OBS_IMAGE);
      }
      const frame = await response.json();
      if (!live()) return;
      if (!response.ok) {
        if (response.status === 429) retainCurrent = sameGeneration(current, frame);
        throw new Error(frame?.message);
      }
      // Use request start conservatively so transport time cannot extend image validity.
      const expires = started + frame.validForMs;
      if (operation.acceptReplacement && !operation.acceptReplacement(frame, expires)) { immediate = true; return; }
      retainCurrent = sameGeneration(current, frame);
      if (current && !retainCurrent) unavailable(WAITING_FOR_REPLACEMENT);
      if (!(frame.validForMs > 0)) {
        retainCurrent = false;
        temporary = false;
        throw new Error(FRAME_EXPIRED);
      }
      if (frame.id === current?.id) {
        // A faster, authoritative sample can tighten the lower bound on this same deadline.
        if (expires > currentExpires) scheduleExpiry(expires);
        return;
      }
      const remaining = expires - clock();
      if (remaining <= 0) throw new Error(FRAME_EXPIRED);
      operation.nextFrame = { frame, expires };
      if (metadataOnly) {
        if (clock() >= expires) throw new Error('画像が古くなりました。次の更新を待ってください。');
        current = frame;
        stage.style.aspectRatio = `${frame.canvasWidth} / ${frame.canvasHeight}`;
        scheduleExpiry(expires);
        stage.querySelectorAll('img,.screen-wait').forEach(element => element.remove());
        stage.setAttribute('aria-disabled', 'false');
        status.textContent = '位置指定の情報を更新しました。';
        onFrame(frame);
        return;
      }
      if (frame.validForMs < POLL_TIMEOUT_MS) {
        clearTimeout(deadline);
        deadline = setTimeout(() => operation.controller.abort(), Math.ceil(remaining));
      }
      const jpeg = await fetch(frame.url, { signal: operation.controller.signal });
      if (!live()) return;
      if (!jpeg.ok) {
        void jpeg.body?.cancel().catch(() => {});
        const state = frameState(jpeg);
        temporary = state !== 'unavailable' && state !== 'retired' && (jpeg.status === 429 || jpeg.status >= 500);
        retainCurrent &&= temporary;
        throw new Error(state === 'unavailable' ? WAITING_FOR_OBS_IMAGE : WAITING_FOR_REPLACEMENT);
      }
      const blob = await jpeg.blob();
      if (!live()) return;
      const next = new Image(); next.alt = 'OBSの配信画面（静止画）'; next.draggable = false;
      operation.candidate = next; operation.url = URL.createObjectURL(blob); next.src = operation.url;
      const aborted = new Promise((_, no) => {
        operation.cancelDecode = () => no(new Error('画像の取得が時間切れになりました。'));
        operation.controller.signal.addEventListener('abort', operation.cancelDecode, { once: true });
      });
      await Promise.race([next.decode(), aborted]);
      if (!live()) return;
      if (clock() >= expires) throw new Error(FRAME_EXPIRED);
      if (currentUrl) URL.revokeObjectURL(currentUrl);
      currentUrl = operation.url; operation.url = null;
      image = next; current = frame;
      if (next.naturalWidth && next.naturalHeight) stage.style.aspectRatio = `${next.naturalWidth} / ${next.naturalHeight}`;
      scheduleExpiry(expires);
      stage.querySelectorAll('img,.screen-wait').forEach(element => element.remove());
      stage.prepend(next); stage.setAttribute('aria-disabled', 'false');
      status.textContent = `${new Date(frame.capturedAt).toLocaleTimeString('ja-JP')} 更新`;
      onFrame(frame);
    } catch (error) {
      if (!stopped && !document.hidden && revision === operation.revision && !(retainCurrent && current && clock() < currentExpires)) {
        const message = operation.controller.signal.aborted
          ? (operation.nextFrame && clock() >= operation.nextFrame.expires ? FRAME_EXPIRED : '画像の取得が時間切れになりました。')
          : error.message || 'OBS映像を取得できません。';
        unavailable(message, temporary);
      }
    } finally {
      clearTimeout(deadline);
      if (operation.cancelDecode) operation.controller.signal.removeEventListener('abort', operation.cancelDecode);
      if (operation.candidate && operation.candidate !== image) operation.candidate.removeAttribute('src');
      if (operation.url) URL.revokeObjectURL(operation.url);
      if (active === operation) active = null;
      if (enabled && !stopped && !document.hidden && !held) {
        if (immediate) void poll();
        else nextTimer = setTimeout(() => { nextTimer = null; void poll(); }, Math.max(0, 500 - (clock() - started)));
      }
    }
  };
  const reset = message => {
    revision++; clearTimeout(nextTimer); nextTimer = null;
    active?.controller.abort(); unavailable(message);
  };
  const visibility = () => {
    if (!enabled) return;
    if (document.hidden) { reset('背景のため画像更新を停止しています。'); return; }
    immediate = true;
    if (!active) void poll();
  };
  document.addEventListener('visibilitychange', visibility);
  if (enabled && document.hidden) unavailable('背景のため画像更新を停止しています。'); else void poll();
  return {
    setMetadataOnly: value => {
      if (metadataOnly === value) return;
      metadataOnly = value;
      held = false;
      reset(WAITING_FOR_OBS_IMAGE); immediate = true;
      if (enabled && !stopped && !document.hidden && !active) void poll();
    },
    setEnabled: value => {
      if (stopped || enabled === value) return;
      enabled = value;
      if (!enabled) reset(WAITING_FOR_OBS_IMAGE);
      else visibility();
    },
    pause: () => { held = true; revision++; clearTimeout(nextTimer); nextTimer = null; active?.controller.abort(); },
    resume: () => { if (!held) return; held = false; immediate = true; if (!stopped && !document.hidden && !active) void poll(); },
    remaining: () => current ? Math.max(0,currentExpires-clock()) : 0,
    current: () => current,
    point: (x, y, clamp = false) => {
      if ((!image && !metadataOnly) || !current) return null; const rect = (metadataOnly ? stage : image).getBoundingClientRect();
      return imagePoint(rect, clamp ? Math.max(rect.left,Math.min(rect.right,x)) : x, clamp ? Math.max(rect.top,Math.min(rect.bottom,y)) : y);
    },
    rejectPlacement: (submitted, confirmedGeneration, confirmedInstance) => {
      if (!enabled || stopped || document.hidden) return;
      const isReplacement = (frame, expires) => {
        if (!frame || clock() >= expires || frame.id === submitted.id) return false;
        // Generation numbers can start over on a new public server.
        if (confirmedInstance && frame.instance !== confirmedInstance) return frame.instance !== submitted.instance;
        return confirmedGeneration === undefined ? !sameGeneration(frame, submitted) : frame.generation >= confirmedGeneration;
      };
      if (isReplacement(current, currentExpires)) return;
      if (active?.revision === revision && !active.controller.signal.aborted) {
        const next = active.nextFrame;
        if (next ? isReplacement(next.frame, next.expires) : confirmedGeneration !== undefined || confirmedInstance) {
          if (!next) active.acceptReplacement = isReplacement;
          unavailable(WAITING_FOR_REPLACEMENT);
          return;
        }
      }
      reset(WAITING_FOR_REPLACEMENT); immediate = true;
      if (!stopped && !document.hidden && !active) void poll();
    },
    close: () => { stopped = true; document.removeEventListener('visibilitychange', visibility); reset('画像更新を終了しました。'); },
  };
}
