import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const fragmentPath = join(root, 'fragment.html');
const virtualEntry = 'virtual:casmate-android-headerless-prototype';

// Use the same local carousel runtime as the inline comparison, without loading
// CDN scripts. The fallback is preview chrome and is never part of the product.
function findVisualizeAssets() {
  const cache = join(homedir(), '.codex', 'plugins', 'cache', 'openai-bundled', 'visualize');
  if (!existsSync(cache)) return null;
  for (const version of readdirSync(cache).sort().reverse()) {
    const assets = join(cache, version, 'skills', 'visualize', 'assets');
    if (existsSync(join(assets, 'visualize.html')) && existsSync(join(assets, 'visualize.css'))) return assets;
  }
  return null;
}

const fallbackStyle = `
.viz-carousel{position:relative;padding-bottom:80px}.viz-carousel>[hidden]{display:none!important}
.viz-carousel-controls{display:flex;align-items:center;justify-content:center;gap:8px;padding:14px}
.viz-carousel-controls button,.viz-carousel-controls select{min-height:44px;border:1px solid light-dark(#d5d5db,#45454d);border-radius:10px;padding:8px 12px;background:light-dark(#fff,#24242a);color:inherit;font:inherit}
`;
const fallbackCarousel = `
for(const root of document.querySelectorAll('.viz-carousel')){
  const panels=Array.from(root.querySelectorAll(':scope > [data-variant]'));
  if(!panels.length)continue;
  const controls=document.createElement('div');controls.className='viz-carousel-controls';
  const previous=document.createElement('button');previous.type='button';previous.className='viz-carousel-previous';previous.textContent='‹';previous.setAttribute('aria-label',root.dataset.previousLabel||'前の案');
  const next=document.createElement('button');next.type='button';next.className='viz-carousel-next';next.textContent='›';next.setAttribute('aria-label',root.dataset.nextLabel||'次の案');
  const picker=document.createElement('select');picker.className='viz-carousel-options';picker.setAttribute('aria-label','デザイン案');
  panels.forEach((panel,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=panel.dataset.variant;picker.append(option)});
  let active=0;
  const select=index=>{active=index;panels.forEach((panel,position)=>{panel.hidden=position!==index});root.dataset.activeVariant=panels[index].dataset.variant;picker.value=String(index)};
  previous.addEventListener('click',()=>select((active+panels.length-1)%panels.length));next.addEventListener('click',()=>select((active+1)%panels.length));picker.addEventListener('change',()=>select(Number(picker.value)));
  controls.append(previous,picker,next);root.append(controls);select(0);
}
`;
const hostSetup = `
(() => {
  const glyphs={'sun':'☀','moon':'☾','chevron-left':'‹','chevron-right':'›','settings':'⚙','settings-2':'⚙','sliders-horizontal':'☷','x':'×','arrow-left':'←','arrow-right':'→','check':'✓','volume-2':'♪','headphones':'♫','mic':'●','mic-off':'○','camera':'▣','video':'▣','video-off':'□','monitor-smartphone':'▤','qr-code':'▦','message-circle':'▱','radio':'◉','cast':'▣','more-horizontal':'⋯','activity':'⌁','square':'■','signal':'▥','wifi':'⌁','wifi-off':'—','battery-medium':'▰','download':'↓','rotate-cw':'↻'};
  globalThis.lucide={createIcons(){for(const icon of document.querySelectorAll('[data-lucide]')){icon.textContent=glyphs[icon.dataset.lucide]||'·';icon.removeAttribute('data-lucide')}}};
  globalThis.lucide.createIcons();
  const requested=new URLSearchParams(location.search).get('variant');
  const root=document.querySelector('.viz-carousel');
  if(!root||!requested)return;
  const panels=Array.from(root.querySelectorAll(':scope > [data-variant]'));
  const index=panels.findIndex(panel=>panel.dataset.design===requested.toUpperCase());
  if(index<0)return;
  const options=root.querySelector('.viz-carousel-options');
  if(options?.tagName==='SELECT'){options.value=String(index);options.dispatchEvent(new Event('change'))}
  else options?.querySelectorAll('button')[index]?.click();
})();
`;

function previewDocument() {
  const fragment = readFileSync(fragmentPath, 'utf8');
  const assets = findVisualizeAssets();
  let style = fallbackStyle;
  let carousel = fallbackCarousel;
  if (assets) {
    const kit = readFileSync(join(assets, 'visualize.html'), 'utf8');
    const match = kit.match(/<script id="codex-visualization-carousel">([\s\S]*?)<\/script>/);
    if (match) {
      style = readFileSync(join(assets, 'visualize.css'), 'utf8');
      carousel = match[1];
    }
  }
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'">
<title>きゃすメイト Android ヘッダーなし比較</title>
<style>:root{color-scheme:light dark}html,body{margin:0}body{padding:16px;box-sizing:border-box;color:light-dark(#25252b,#ededf0);background:light-dark(#fafafa,#17171a)}${style}</style>
</head><body>${fragment}<script>${carousel}</script><script>${hostSetup}</script></body></html>`;
}

export default defineConfig({
  root,
  plugins: [{
    name: 'isolated-android-headerless-ui-preview',
    resolveId(id) { return id === virtualEntry ? '\0' + virtualEntry : null; },
    load(id) { return id === '\0' + virtualEntry ? 'export {};' : null; },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
        if (pathname !== '/' && pathname !== '/index.html') return next();
        try {
          response.statusCode = 200;
          response.setHeader('Content-Type', 'text/html; charset=utf-8');
          response.setHeader('Cache-Control', 'no-store');
          response.end(previewDocument());
        } catch (error) {
          response.statusCode = 500;
          response.setHeader('Content-Type', 'text/plain; charset=utf-8');
          response.end(error instanceof Error ? error.message : 'Preview generation failed.');
        }
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'index.html', source: previewDocument() });
    },
  }],
  server: { host: '127.0.0.1', port: 5211, strictPort: true },
  build: {
    outDir: '../../tmp/android-headerless-ui-prototype-build',
    emptyOutDir: true,
    rollupOptions: { input: virtualEntry },
  },
});
