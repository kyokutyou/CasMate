const WIDTH_SETTLE_MS = 200;

export function readLivePreview(config = document.querySelector('meta[name="casmate-preview"]')?.dataset) {
  const { mode, id } = config ?? {};
  if (mode === 'twitch' && id && /^[a-z0-9_]{1,25}$/.test(id)) {
    const query = new URLSearchParams({ channel: id, parent: location.hostname, autoplay: 'true', muted: 'true' });
    return { mode, label: 'Twitch', minWidth: 400, src: `https://player.twitch.tv/?${query}`, link: `https://www.twitch.tv/${id}` };
  }
  if (mode === 'youtube' && id && /^[A-Za-z0-9_-]{11}$/.test(id)) {
    return { mode, label: 'YouTube Live', minWidth: 200, src: `https://www.youtube.com/embed/${id}?playsinline=1&autoplay=1&mute=1`, link: `https://www.youtube.com/watch?v=${id}` };
  }
  return null;
}

export function setupLivePreview(preview, setStillEnabled, { setMetadataOnly = () => {}, cancel = () => {} } = {}) {
  const section = document.querySelector('#screen-section');
  const controls = document.querySelector('#live-preview-controls');
  const modes = document.querySelector('#live-preview-modes');
  const link = document.querySelector('#live-preview-link');
  const player = document.querySelector('#live-preview');
  const still = document.querySelector('#still-preview');
  const locationTools = document.querySelector('.point-toolbar');
  const buttons = [...modes.querySelectorAll('button')];
  let selected = 'live';
  let iframe = null;
  const stage = document.querySelector('#screen-stage');
  const toggle = document.querySelector('#player-controls-toggle');
  let nativeControls = true, overlay = false, ratio = 16 / 9;
  const sync = () => {
    const armed = !!locationTools.querySelector('[aria-pressed="true"]');
    if (overlay && armed) nativeControls = false;
    const allowControls = !overlay || nativeControls;
    player.dataset.controls = String(allowControls);
    stage.dataset.active = String(overlay && armed);
    if (iframe) iframe.tabIndex = allowControls ? 0 : -1;
    if (toggle) { toggle.hidden = !overlay; toggle.setAttribute('aria-pressed', String(nativeControls)); }
  };
  const layout = frame => {
    if (frame) ratio = frame.canvasWidth / frame.canvasHeight;
    if (!overlay) return;
    const width = Math.min(player.clientWidth, player.clientHeight * ratio), height = width / ratio;
    Object.assign(stage.style, { width: `${width}px`, height: `${height}px`, left: `${(player.clientWidth-width)/2}px`, top: `${(player.clientHeight-height)/2}px` });
  };
  const observer = new MutationObserver(sync);
  for (const button of locationTools.querySelectorAll('button')) observer.observe(button, {attributes:true,attributeFilter:['aria-pressed']});
  toggle?.addEventListener('click', () => { nativeControls = !nativeControls; cancel(); sync(); toggle.focus({preventScroll:true}); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { nativeControls = false; sync(); }
    else if (overlay && document.activeElement === iframe) toggle?.focus({preventScroll:true});
  });


  const hasRoom = () => !!preview && section.getBoundingClientRect().width >= preview.minWidth;
  let fits = hasRoom();
  let reopen = null;
  const render = () => {
    const focused = document.activeElement;
    controls.hidden = !preview;
    if (preview) { link.href = preview.link; link.textContent = `${preview.label}で開く`; player.dataset.provider = preview.mode; }
    const showPlayer = !!preview && fits && selected === 'live';
    const showStill = !fits || selected === 'still';
    const nextOverlay = showPlayer && !showStill;
    if (overlay !== nextOverlay) {
      if (stage.contains(focused)) link.focus({preventScroll:true});
      cancel(); overlay = nextOverlay;
      if (overlay) player.append(stage);
      else { still.prepend(stage); for (const key of ['width','height','left','top']) stage.style[key] = ''; }
    }
    if ((!fits && (modes.contains(focused) || player.contains(focused))) ||
        (!showStill && (still.contains(focused) || locationTools.contains(focused)))) {
      link.focus({ preventScroll: true });
    }
    modes.hidden = !fits;
    player.hidden = !showPlayer;
    still.hidden = !showStill;
    const caption = document.querySelector('.screen-caption');
    if (caption) {
      caption.hidden = !showStill && !overlay;
      caption.querySelector('span').textContent = overlay ? '配信映像 · 遅延で位置がずれる場合があります' : '静止画 · 配信より遅れる場合があります';
    }
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.previewView === selected));
    if (showPlayer && !iframe) {
      iframe = document.createElement('iframe');
      iframe.title = `${preview.label}のライブ配信`;
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      iframe.allowFullscreen = true;
      iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
      iframe.src = preview.src;
      player.prepend(iframe);
      nativeControls = true;
    } else if (!showPlayer && iframe) {
      iframe.remove();
      iframe = null;
    }
    setMetadataOnly(overlay);
    setStillEnabled(showStill || overlay);
    layout(); sync();
  };
  const updateWidth = () => {
    if (!hasRoom()) {
      clearTimeout(reopen);
      reopen = null;
      const wasFit = fits;
      fits = false;
      return wasFit;
    }
    if (!fits && reopen === null) {
      // Keep the still image active through short width changes during resize.
      reopen = setTimeout(() => {
        reopen = null;
        if (hasRoom()) {
          fits = true;
          render();
        }
      }, WIDTH_SETTLE_MS);
    }
    return false;
  };
  for (const button of buttons) button.addEventListener('click', () => {
    selected = button.dataset.previewView;
    updateWidth();
    render();
  });
  new ResizeObserver(() => { if (updateWidth()) render(); layout(); }).observe(section);
  render();
  return { layout, update(next) {
    if (preview?.src === next?.src) return;
    const moveFocus = controls.contains(document.activeElement) || modes.contains(document.activeElement) || player.contains(document.activeElement);
    cancel(); setStillEnabled(false);
    clearTimeout(reopen); reopen = null;
    if (iframe) { if (document.activeElement === iframe) link.focus({preventScroll:true}); iframe.remove(); iframe = null; }
    preview = next; selected = 'live'; nativeControls = true; fits = hasRoom(); render();
    if (!next && moveFocus) stage.focus({preventScroll:true});
  } };
}
