import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { build } from 'vite';
import { afterEach, expect, it } from 'vitest';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    const target = resolve(directory);
    if (!target.startsWith(resolve(tmpdir()) + sep) || !target.split(sep).at(-1)?.startsWith('casmate-obs-style-build-')) throw new Error('Unexpected build fixture directory');
    await rm(target, { recursive: true, force: true });
  }
});

async function buildFixture(css: string, javascript: string, external: string[] = []) {
  const directory = await mkdtemp(join(tmpdir(), 'casmate-obs-style-build-'));
  directories.push(directory);
  const entry = join(directory, 'fixture.ts');
  await writeFile(join(directory, 'fixture.css'), css);
  await writeFile(join(directory, 'embedded.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><path d="M0 0h8v8H0z" fill="red"/></svg>');
  await writeFile(entry, `import './fixture.css';\n${javascript}`);
  const result = await build({
    configFile: resolve('vite.obs-style-editor.config.mts'),
    logLevel: 'silent',
    build: {
      write: false,
      outDir: join(directory, 'output'),
      lib: { entry, name: 'BuildFixture' },
      rolldownOptions: { external },
    },
  });
  const single = Array.isArray(result) && result.length === 1 ? result[0] : result;
  if (Array.isArray(single) || !('output' in single)) throw new Error('Unexpected standalone build result');
  return { output: single.output, directory };
}

it('JSとCSSを一つのHTMLへ埋め込み、終了タグを含む文字をfile://で実行せず表示する', async () => {
  const text = '</SCRIPT><script>globalThis.unexpected = true</script>';
  const { output, directory } = await buildFixture(
    '.fixture::after { content: "</style><script>globalThis.unexpected = true</script>"; } .fixture { background: url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E"); }',
    `import icon from './embedded.svg'; document.getElementById('root').textContent = ${JSON.stringify(text)}; const image = document.createElement('img'); image.src = icon; document.getElementById('root').append(image);`,
  );
  expect(output.map(item => item.fileName)).toEqual(['obs-style-editor.html']);
  const artifact = output[0];
  if (artifact.type !== 'asset' || typeof artifact.source !== 'string') throw new Error('Expected HTML asset');
  const dom = new JSDOM(artifact.source, {
    url: pathToFileURL(join(directory, artifact.fileName)).href,
    runScripts: 'dangerously',
  });
  try {
    expect(dom.window.document.getElementById('root')?.textContent).toBe(text);
    expect(dom.window.unexpected).toBeUndefined();
    expect(dom.window.document.querySelectorAll('script')).toHaveLength(1);
    expect(dom.window.document.querySelectorAll('style')).toHaveLength(1);
    expect(dom.window.document.querySelector('script[src], link, img:not([src^="data:"])')).toBeNull();
    expect(dom.window.document.querySelector('img')?.src).toMatch(/^data:image\/svg\+xml/);
    expect(dom.window.document.querySelector('style')?.textContent).toContain('<\\/style>');
    expect(artifact.source).not.toContain('sourceMappingURL');
  } finally {
    dom.window.close();
  }
});

it('単独HTMLから外部CSS・素材を参照するビルドを拒否する', async () => {
  await expect(buildFixture('.fixture { background: url("https://example.invalid/image.png"); }', '')).rejects.toThrow(/must not load external files/);
});

it('単独HTMLのJavaScriptから外部モジュールを参照するビルドを拒否する', async () => {
  await expect(buildFixture('', "import dependency from 'external-fixture'; globalThis.fixture = dependency;", ['external-fixture'])).rejects.toThrow(/no external imports/);
});

it('専用出力は通常ビルド対象に含み、HTTP・Electron包装から隔離する', async () => {
  const packageJson = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
  const config = await readFile(resolve('vite.obs-style-editor.config.mts'), 'utf8');
  const rendererTsconfig = JSON.parse(await readFile(resolve('tsconfig.renderer.json'), 'utf8'));
  expect(packageJson.scripts.build).toContain('pnpm build:obs-style-editor');
  expect(packageJson.scripts['build:obs-style-editor']).toBe('vite build --config vite.obs-style-editor.config.mts');
  expect(config).toContain("outDir: 'dist-tools'");
  expect(config).toContain('publicDir: false');
  expect(packageJson.build.files).toEqual(['dist/**/*', 'dist-electron/**/*', 'package.json']);
  expect(packageJson.build.extraResources.some((item: { from: string }) => item.from.startsWith('dist-tools'))).toBe(false);
  expect(rendererTsconfig.include).toContain('vite.obs-style-editor.config.mts');
  expect(await readFile(resolve('.gitignore'), 'utf8')).toMatch(/^dist-tools\/$/m);
});
