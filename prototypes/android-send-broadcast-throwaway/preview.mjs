// Standalone viewer for a fictional, throwaway UI. Never imports product code.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';

const prototypeDirectory = dirname(fileURLToPath(import.meta.url));
const outputDirectory = resolve(prototypeDirectory, '../../tmp/android-send-broadcast-prototype-build');
const fragmentPath = join(prototypeDirectory, 'fragment.html');
const documentPath = join(outputDirectory, 'index.html');
const rendererPath = process.env.CASMATE_VISUALIZE_RENDERER || join(homedir(),
  '.codex/plugins/cache/openai-bundled/visualize/1.0.49/skills/visualize/scripts/render.py');
const bundledPython = join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
const pythonPath = process.env.CASMATE_PYTHON || (existsSync(bundledPython) ? bundledPython : 'python3');
const args = process.argv.slice(2);
if (args.some(arg => !['--build', '--verify'].includes(arg))) throw new Error('Usage: node preview.mjs [--build|--verify]');

await mkdir(outputDirectory, { recursive: true });
const fragment = await readFile(fragmentPath, 'utf8');
for (const match of fragment.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
  new Script(match[1], { filename: fragmentPath });
}
execFileSync(pythonPath, [rendererPath, fragmentPath, documentPath, '--force', '--title', 'きゃすメイト 送信・配信の操作見本'],
  { stdio: 'inherit', windowsHide: true });

if (args.includes('--verify')) {
  const electronPath = (await import('electron')).default;
  const verificationDirectory = await mkdtemp(join(outputDirectory, 'checks-'));
  execFileSync(electronPath, [join(prototypeDirectory, 'verify-layout.mjs'), documentPath, verificationDirectory],
    { cwd: verificationDirectory, windowsHide: true, stdio: 'inherit', timeout: 90_000 });
  console.log(`描画確認: ${verificationDirectory}`);
} else if (!args.includes('--build')) {
  const document = await readFile(documentPath);
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || !['/', '/index.html'].includes(new URL(request.url, 'http://127.0.0.1:5216').pathname)) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(document);
  });
  server.listen(5216, '127.0.0.1', () => console.log('操作見本: http://127.0.0.1:5216/'));
}
