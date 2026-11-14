import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { build } from 'vite';
import { expect, it } from 'vitest';
import { runElectronFixture } from './helpers/electron-fixture';

it('renders the poll management, listener and OBS views and preserves operation positions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'casmate-poll-layout-'));
  try {
    await build({ configFile: false, plugins: [react()], logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' }, oxc: { jsx: { development: false } }, build: { outDir: directory, emptyOutDir: false, cssCodeSplit: false, lib: { entry: resolve('tests/fixtures/listener-poll-renderer.tsx'), name: 'PollLayout', formats: ['iife'], fileName: () => 'harness.js', cssFileName: 'harness' } } });
    const html = join(directory, 'index.html'); await writeFile(html, '<!doctype html><html lang="ja"><meta charset="utf-8"><link rel="stylesheet" href="harness.css"><div id="root"></div><script src="harness.js"></script></html>');
    const { stdout } = await runElectronFixture('tests/fixtures/listener-poll-layout.mjs', html, directory, [resolve('tmp/listener-poll-layout')], 150_000);
    expect(stdout).toContain('PASS: 96 management layouts, copy pending/success/failure geometry, listener and OBS rendering');
  } finally {
    const safe = resolve(directory).startsWith(resolve(tmpdir()) + '\\casmate-poll-layout-');
    expect(safe).toBe(true);
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}, 180_000);
