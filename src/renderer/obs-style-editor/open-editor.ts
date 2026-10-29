import type { Target } from '../../shared/obs-style';
let browserEditor: Window | null = null;
export function openObsDesignBrowser(target: Target) {
  if (browserEditor && !browserEditor.closed) { browserEditor.postMessage({ target }, location.origin); browserEditor.focus(); return; }
  browserEditor = window.open(`/obs/design?target=${target}`, 'casmate-obs-design', 'popup,width=1200,height=820');
  if (!browserEditor) throw new Error('編集ウィンドウを開けませんでした。ポップアップの許可を確認してください。');
}
