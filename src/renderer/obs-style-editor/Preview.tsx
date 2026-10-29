import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import baseCss from '../styles.css?raw';
import { generateCss } from './css';
import type { EditorDocument, Target } from './model';
import { PreviewContent } from './PreviewContent';
import type { CommentOverlaySettings, SpeechRecognitionOverlayAppearance } from '../../shared/types';
export interface ApplicationPreview { comments: CommentOverlaySettings; speech: SpeechRecognitionOverlayAppearance }

// Only static HTML enters srcdoc. Editable CSS/text enter DOM text nodes below.
const frameHtml = '<!doctype html><html lang="ja"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; font-src \'none\'"><title>OBS表示の見本</title></head><body><div id="root"></div></body></html>';

export function Preview({ target, document, application }: { target: Target; document: EditorDocument; application?: ApplicationPreview }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [frameDocument, setFrameDocument] = useState<Document | null>(null);
  const [stageSize, setStageSize] = useState({ width: 500, height: 480 });
  const [overflow, setOverflow] = useState(false);
  const preview = document.previews[target];
  const css = application ? '' : generateCss(target, document.designs[target]);
  const scale = Math.max(0.001, Math.min(1, (stageSize.width - 24) / preview.width, (stageSize.height - 24) / preview.height));

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const update = () => setStageSize({ width: stage.clientWidth, height: stage.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!frameDocument) return;
    let base = frameDocument.getElementById('app-base-css');
    if (!base) {
      base = frameDocument.createElement('style'); base.id = 'app-base-css';
      base.textContent = baseCss; frameDocument.head.append(base);
    }
    let style = frameDocument.getElementById('generated-css');
    if (!style) {
      style = frameDocument.createElement('style'); style.id = 'generated-css'; frameDocument.head.append(style);
    }
    style.textContent = css;
  }, [frameDocument, css]);

  useEffect(() => {
    if (!frameDocument) return;
    const check = () => {
      const main = frameDocument.querySelector('main');
      const boxes = main ? [main, ...main.querySelectorAll('.overlay-comment, .speech-recognition-overlay-text, .comment-body, .comment-meta')] : [];
      const design = document.designs[target];
      const outside = (rect: DOMRect, shadow: typeof design.cardShadow, stroke = 0) => {
        // Blur is a conservative estimate of the painted extent, so a warning
        // also covers effects that do not change CSS layout/scroll dimensions.
        const blur = shadow.enabled ? shadow.blur : 0;
        const x = shadow.enabled ? shadow.x : 0, y = shadow.enabled ? shadow.y : 0;
        return rect.left - Math.max(stroke, blur - x) < -1 || rect.right + Math.max(stroke, blur + x) > preview.width + 1
          || rect.top - Math.max(stroke, blur - y) < -1 || rect.bottom + Math.max(stroke, blur + y) > preview.height + 1;
      };
      const effectOverflow = !!main && [...main.querySelectorAll('.overlay-comment, .speech-recognition-overlay-text')].some((card) => {
        if (outside(card.getBoundingClientRect(), design.cardShadow)) return true;
        const range = frameDocument.createRange(); range.selectNodeContents(card);
        const textRect = range.getBoundingClientRect();
        return outside(textRect, design.textShadow, design.outline.enabled ? design.outline.width / 2 : 0);
      });
      setOverflow(effectOverflow || boxes.some((box) => {
        const rect = box.getBoundingClientRect();
        return box.scrollHeight > box.clientHeight + 1 || box.scrollWidth > box.clientWidth + 1
          || rect.top < -1 || rect.left < -1 || rect.bottom > preview.height + 1 || rect.right > preview.width + 1;
      }));
    };
    const frameWindow = frameDocument.defaultView;
    const timer = frameWindow?.requestAnimationFrame(check);
    const image = frameDocument.querySelector('img');
    image?.addEventListener('load', check);
    return () => { if (timer !== undefined) frameWindow?.cancelAnimationFrame(timer); image?.removeEventListener('load', check); };
  }, [frameDocument, document, target, preview.width, preview.height]);

  const root = frameDocument?.getElementById('root');
  return <section className="editor-preview" aria-label="OBS表示プレビュー">
    <div ref={stageRef} className={`editor-preview-stage background-${preview.background}`}>
      <div className="editor-preview-scaled" style={{ position: 'relative', width: preview.width * scale, height: preview.height * scale }}>
        <iframe ref={frameRef} title="OBS表示の見本" srcDoc={frameHtml} sandbox="allow-same-origin" tabIndex={-1}
          onLoad={() => setFrameDocument(frameRef.current?.contentDocument ?? null)}
          style={{ position: 'absolute', top: 0, left: 0, border: 0, width: preview.width, height: preview.height, transform: `scale(${scale})`, transformOrigin: 'top left', pointerEvents: 'none' }} />
      </div>
    </div>
    <p className="editor-preview-caption">{preview.width} × {preview.height} px · 表示倍率 {(scale * 100).toFixed(1)}%（文字サイズは元のまま）</p>
    <p className="editor-preview-warning" role="status">{overflow ? '文字・影・縁取りが切れる可能性があります。見本の寸法や、文字・外周余白・効果を調整してください。' : '見本の背景・文章・表示方式はCSSに含まれません。'}</p>
    {root && createPortal(<PreviewContent target={target} document={document} application={application} />, root)}
  </section>;
}
