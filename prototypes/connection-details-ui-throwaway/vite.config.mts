// Disposable comparison only. This entry never loads the production app.
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defineConfig } from 'vite';

const runtime = pathToFileURL(join(homedir(), '.codex/plugins/cache/openai-bundled/visualize/1.0.46/skills/visualize/assets/'));
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [{ name: 'connection-details-comparison', configureServer(server) {
    server.middlewares.use((request, response, next) => {
      if (!['/', '/index.html'].includes((request.url ?? '').split('?')[0])) { next(); return; }
      void Promise.all([
        readFile(new URL('./fragment.html', import.meta.url), 'utf8'),
        readFile(new URL('visualize.html', runtime), 'utf8'),
        readFile(new URL('visualize.css', runtime), 'utf8'),
      ]).then(([fragment, shell, css]) => {
        const query = new URL(request.url ?? '/', 'http://localhost').searchParams.get('variant');
        const index = ['A', 'B', 'C', 'D'].indexOf(query ?? 'A');
        const preview = `<script>document.addEventListener('DOMContentLoaded',()=>{const choices=[...document.querySelectorAll('.viz-carousel-options button')];choices[${Math.max(0, index)}]?.click();document.querySelector('.viz-carousel-picker')?.removeAttribute('open');});</script>`;
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end('<!doctype html><html lang="ja" style="color-scheme:dark;background:#152129"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>接続の詳細設定 · 4案</title><style>' + css + 'body{margin:0 auto;max-width:1024px;padding:16px} @media(max-width:560px){body{padding:6px}}</style></head><body>' + shell.replace('<!--__INLINE_VISUALIZATION_FRAGMENT__-->', fragment) + preview + '</body></html>');
      }).catch(next);
    });
  } }],
  server: { host: '127.0.0.1', port: 5208, strictPort: true },
});
