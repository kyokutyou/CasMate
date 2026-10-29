import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const fragmentPath = new URL('./fragment.html', import.meta.url);
const outputPath = new URL('./index.html', import.meta.url);
const contentSecurityPolicy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

async function standalonePage() {
  const fragment = await readFile(fragmentPath, 'utf8');
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}">
  <title>きゃすメイト Android UI・UX 8案</title>
  <style>html{color-scheme:light}body{box-sizing:border-box;max-width:1100px;margin:auto;padding:24px;background:#f4f3ef}button,input,select{font:inherit}@media(max-width:600px){body{padding:12px}}</style>
</head>
<body>${fragment}</body>
</html>`;
}

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--build') || args.length > 1) {
  throw new Error('Usage: node prototypes/android-eight-concepts-throwaway/preview.mjs [--build]');
}

if (args.includes('--build')) {
  await writeFile(outputPath, await standalonePage(), 'utf8');
  console.log(`Standalone comparison saved: ${fileURLToPath(outputPath)}`);
} else {
  // This server only serves the fictional comparison; it exposes no app files or APIs.
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Security-Policy', contentSecurityPolicy);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end();
      return;
    }
    const path = new URL(request.url, 'http://127.0.0.1:5216').pathname;
    if (path === '/favicon.ico') {
      response.writeHead(204);
      response.end();
      return;
    }
    if (path !== '/' && path !== '/index.html') {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    try {
      const html = await standalonePage();
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : html);
    } catch (error) {
      console.error(error.message);
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('比較見本を読み込めません。fragment.htmlを確認してください。');
    }
  });
  server.on('error', error => {
    console.error(`Comparison preview failed: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(5216, '127.0.0.1', () => {
    console.log('Android comparison: http://127.0.0.1:5216/');
  });
}
