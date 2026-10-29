import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { parseCLI, startVitest } from 'vitest/node';
import { assertSameTestFiles, groupTestFiles } from './test-scope.mjs';

const args = process.argv.slice(2);
const { filter, options } = parseCLI(['vitest', 'run', ...args]);
const started = performance.now();
const cli = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));

function runSingle() {
  const result = spawnSync(process.execPath, [cli, 'run', ...args, `--maxWorkers=${options.maxWorkers ?? 2}`], { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

async function run() {
  // Reporters may choose a default output path (for example blob), so any
  // explicit reporter/coverage request retains Vitest's single-run behavior.
  if (options.coverage || options.outputFile || options.reporter) { runSingle(); return; }
  if (options.watch) throw new Error('Use pnpm test:watch for watch mode.');
  if (options.json || options.filesOnly) throw new Error('Use pnpm exec vitest list for test listings.');
  const config = { ...options, run: true, watch: false };
  // parseCLI alone does not reject unknown options. Vitest's list command
  // validates them without importing tests. Keep --json LAST: it is boolean
  // here, whereas a following path would be interpreted as an output file.
  const listing = spawnSync(process.execPath, [cli, 'list', ...args, '--filesOnly', '--json'], {
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
  if (listing.error) throw listing.error;
  if (listing.stderr) process.stderr.write(listing.stderr);
  if (listing.status !== 0) throw new Error(`Vitest file discovery failed (${listing.status}).`);
  const inventory = JSON.parse(listing.stdout);
  // Named projects can intentionally execute the same file more than once.
  // Let Vitest keep their project identities and lifecycle in a single run.
  if (inventory.some(specification => specification.projectName)) { runSingle(); return; }
  const files = inventory.map(specification => specification.file);
  const groups = groupTestFiles(files);
  console.log(`Test scope: ${files.length} files = ${groups.light.length} light + ${groups.render.length} rendering (no overlap).`);
  for (const [group, workers] of [['light', 4], ['render', 2]]) {
    const selected = groups[group];
    if (!selected.length) continue;
    const phaseStarted = performance.now();
    const maxWorkers = options.maxWorkers ?? workers;
    console.log(`\nTest phase: ${group} (${selected.length} files, ${maxWorkers} workers)`);
    // Verify Vitest's actual selection before starting any test in this phase.
    const guard = { onTestRunStart(specifications) {
      assertSameTestFiles(specifications.map(specification => specification.moduleId), selected);
    } };
    await startVitest('test', filter, { ...config, include: selected, maxWorkers,
      reporters: [...(options.reporter ?? ['default']), guard] });
    if (process.exitCode) break;
    console.log(`Test phase ${group} completed in ${((performance.now() - phaseStarted) / 1000).toFixed(2)}s.`);
  }
  console.log(`Test command completed in ${((performance.now() - started) / 1000).toFixed(2)}s (exit ${process.exitCode ?? 0}).`);
}
await run();
