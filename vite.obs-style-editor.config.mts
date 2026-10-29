import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

/** Keep the browser tool outside the HTTP assets and Electron packaging. */
function singleHtml(): Plugin {
  return {
    name: 'casmate-obs-style-editor-single-html',
    enforce: 'post',
    generateBundle(options, bundle) {
      const chunks = Object.values(bundle).filter(item => item.type === 'chunk');
      if (options.format !== 'iife' || chunks.length !== 1
        || chunks.some(chunk => chunk.imports.length || chunk.dynamicImports.length)) {
        this.error('OBS style editor must contain one IIFE with no external imports.');
      }
      const styles: string[] = [];
      for (const item of Object.values(bundle)) {
        if (item.type !== 'asset') continue;
        if (!item.fileName.endsWith('.css')) {
          this.error(`OBS style editor contains an external asset: ${item.fileName}`);
        }
        const css = typeof item.source === 'string' ? item.source : new TextDecoder().decode(item.source);
        const urls = [...css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\)/giu)];
        if (/@import\b/iu.test(css) || urls.some(match => !/^(?:data:|#)/iu.test((match[1] ?? match[2] ?? match[3]).trim()))) {
          this.error('OBS style editor CSS must not load external files.');
        }
        styles.push(css);
      }
      // Escaped slashes preserve JS/CSS string values while keeping the HTML
      // parser from treating bundled text as the end of its enclosing element.
      const javascript = chunks[0].code.replace(/<\/script/giu, match => match.replace('/', '\\/'));
      const css = styles.join('\n').replace(/<\/style/giu, match => match.replace('/', '\\/'));
      for (const name of Object.keys(bundle)) delete bundle[name];
      this.emitFile({
        type: 'asset',
        fileName: 'obs-style-editor.html',
        source: `<!doctype html>\n<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>きゃすメイト OBS着せ替えツール</title><style>${css}</style></head><body><div id="root"></div><script>${javascript}</script></body></html>\n`,
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), singleHtml()],
  publicDir: false,
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: 'dist-tools',
    emptyOutDir: true,
    sourcemap: false,
    cssCodeSplit: false,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    lib: {
      entry: fileURLToPath(new URL('./src/renderer/obs-style-editor/main.tsx', import.meta.url)),
      name: 'CasMateObsStyleEditor',
      formats: ['iife'],
    },
    rolldownOptions: { output: { codeSplitting: false } },
  },
});
