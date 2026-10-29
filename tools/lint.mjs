import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { ESLint } from 'eslint';
import prototypeTests from './prototype-tests.json' with { type: 'json' };

const args = process.argv.slice(2);
if (args.length > 1 || (args.length && !['--scope=product', '--scope=prototypes'].includes(args[0]))) {
  throw new Error('Usage: node tools/lint.mjs [--scope=product|--scope=prototypes]');
}
const scope = args[0] === '--scope=prototypes' ? 'prototypes' : 'product';
const prototypeTestSet = new Set(prototypeTests);

// Enumerate source files without asking ESLint to traverse local build caches.
// Git includes both tracked files and new, non-ignored files in any directory.
const listing = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--deduplicate', '-z'], {
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
});
if (listing.error) throw listing.error;
if (listing.stderr) process.stderr.write(listing.stderr);
if (listing.status !== 0) throw new Error(`Git file enumeration failed (${listing.status}).`);

const files = [...new Set(listing.stdout.split('\0'))]
  .filter(file => /\.(?:[cm]?[jt]s|[jt]sx)$/i.test(file) && existsSync(file))
  .filter(file => (file.startsWith('prototypes/') || prototypeTestSet.has(file)) === (scope === 'prototypes'));
if (!files.length) throw new Error(`No source files found for lint (${scope}).`);

const eslint = new ESLint({ warnIgnored: false });
const results = await eslint.lintFiles(files);
if (!results.length) throw new Error('No source files were checked by ESLint.');
const formatter = await eslint.loadFormatter('stylish');
const output = formatter.format(results);
if (output) process.stdout.write(output);
process.stdout.write(`ESLint checked ${results.length} source files (${scope}).\n`);
process.exitCode = results.some(result => result.errorCount > 0 || result.fatalErrorCount > 0) ? 1 : 0;
