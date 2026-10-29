// Throwaway preview only. No production imports or backend connection.
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [{ name: 'raw-prototype-fragment', configureServer(server) {
    server.middlewares.use((request, response, next) => {
      if (!['/', '/index.html', '/fragment.html'].includes((request.url ?? '').split('?')[0])) { next(); return; }
      void readFile(new URL('./fragment.html', import.meta.url), 'utf8').then(html => {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end('<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>コメント読み上げ · 5案の比較</title><style>html{color-scheme:dark;background:#14232d}body{margin:0 auto;padding:0 16px;max-width:1100px} @media(max-width:480px){body{padding:0 8px}}</style></head><body>' + html + '</body></html>');
      }).catch(next);
    });
  } }],
  server: { host: '127.0.0.1', port: 5193, strictPort: true },
});
