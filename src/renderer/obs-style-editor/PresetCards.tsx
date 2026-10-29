import { memo, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import baseCss from '../styles.css?raw';
import { createDefaultDocument, createPreset, obsPresets } from './model';
import type { PresetName, Target } from './model';
import { createObsDesignPreset, defaultSpeechOverlayAppearance } from '../../shared/obs-design';
import type { ObsCommentDesign, ObsSpeechDesign } from '../../shared/obs-design';
import { applicationDesignCss } from './application-css';
import { generateCss } from './css';
import { PreviewContent } from './PreviewContent';
import { previewCommentSettings } from './samples';

// Share the large, static overlay stylesheet between all miniature shadow trees.
let overlaySheet: CSSStyleSheet | undefined;
// Adopted sheets follow ordinary style tags. A layer keeps the shared base
// behind each preset's normal rules, matching the live page's stylesheet order.
const thumbnailBaseCss = `@layer preset-base { ${baseCss} }`;
function installOverlayStyles(root: ShadowRoot) {
  if ('adoptedStyleSheets' in root && typeof CSSStyleSheet.prototype.replaceSync === 'function') {
    if (!overlaySheet) { overlaySheet = new CSSStyleSheet(); overlaySheet.replaceSync(thumbnailBaseCss); }
    root.adoptedStyleSheets = [overlaySheet];
  } else {
    const style = document.createElement('style'); style.textContent = thumbnailBaseCss; root.append(style);
  }
}

export const DesignThumbnail = memo(function DesignThumbnail({ target, name = 'standard', application = false, design }: { target: Target; name?: PresetName; application?: boolean; design?: ObsCommentDesign | ObsSpeechDesign }) {
  const host = useRef<HTMLSpanElement>(null);
  const [root, setRoot] = useState<ShadowRoot | null>(null);
  const [scale, setScale] = useState(0.25);
  const [canvasHeight, setCanvasHeight] = useState(240);
  useLayoutEffect(() => {
    const element = host.current!;
    const shadow = element.shadowRoot ?? element.attachShadow({ mode: 'open' });
    if (!element.shadowRoot?.childNodes.length) installOverlayStyles(shadow);
    setRoot(shadow);
    const update = () => { if (element.clientWidth > 0) setScale(Math.min(element.clientWidth / 480, element.clientHeight / canvasHeight)); };
    update();
    const observer = new ResizeObserver(update); observer.observe(element);
    return () => observer.disconnect();
  }, [canvasHeight]);
  useLayoutEffect(() => {
    if (!root || !design) return;
    const content = root.querySelector<HTMLElement>('.overlay-comment, .speech-recognition-overlay-text');
    if (!content) return;
    const shadow = design.style.cardShadow;
    const inset = Math.max(16, design.style.edge, shadow.enabled ? shadow.blur + Math.abs(shadow.y) : 0);
    const fit = () => setCanvasHeight(Math.ceil(Math.max(240, Math.max(content.offsetHeight, content.scrollHeight) + inset * 2)));
    fit();
    const observer = new ResizeObserver(fit); observer.observe(content);
    return () => observer.disconnect();
  }, [root, design]);
  const value = createDefaultDocument();
  value.previews.comments = { ...value.previews.comments, mode: 'single', source: 'youtube', text: '配信を楽しんでいます！', author: 'リスナー', emotes: false };
  value.previews.speech.text = '声を字幕でお届けします';
  if (target === 'comments') value.designs.comments = createPreset('comments', name);
  else value.designs.speech = createPreset('speech', name);
  const selected = application ? design ?? createObsDesignPreset(target, name) : undefined;
  const appearance = selected ? {
    comments: { ...previewCommentSettings(value.previews.comments), design: 'variant' in selected ? selected : createObsDesignPreset('comments', name) },
    speech: { ...defaultSpeechOverlayAppearance, design: !('variant' in selected) ? selected : createObsDesignPreset('speech', name) },
  } : undefined;
  const css = selected ? applicationDesignCss(target, selected) : generateCss(target, value.designs[target]);
  return <span ref={host} className="preset-thumbnail" aria-hidden="true" inert>
    {root && createPortal(<>
      <style>{css.replaceAll(':root', ':host')}</style>
      <style>{`.preset-surface { position:absolute; width:480px; height:${canvasHeight}px; left:50%; top:50%; transform-origin:center; } .preset-surface main { width:480px!important; height:${canvasHeight}px!important; min-width:0!important; min-height:0!important; margin:0!important; justify-content:center!important; align-items:center!important; }`}</style>
      <div className="preset-surface" style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>
        <PreviewContent target={target} document={value} application={appearance}/>
      </div>
    </>, root)}
  </span>;
});

export function PresetCards({ target, application = false, onSelect }: { target: Target; application?: boolean; onSelect(name: PresetName): void }) {
  const id = useId();
  return <><p className="panel-note">適用後はプレビューで見え方を確認してください。</p><div className="preset-buttons" role="group" aria-label="デザインのプリセット">
    {obsPresets.map(preset => <div className="preset-card" data-preset={preset.id} key={preset.id}>
      <button type="button" aria-label={preset.label} aria-describedby={`${id}-${preset.id}`} onClick={() => onSelect(preset.id)}>
        <span className="preset-name">{preset.label}</span><span id={`${id}-${preset.id}`} className="preset-summary">{preset.summary}</span>
      </button>
      <DesignThumbnail target={target} name={preset.id} application={application}/>
    </div>)}
  </div></>;
}
