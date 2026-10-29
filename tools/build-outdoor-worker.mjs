import './prepare-outdoor-native.mjs';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let cmake = process.env.CMAKE ?? 'cmake';
if (process.platform === 'win32' && !process.env.CMAKE) {
  const vswhere = resolve(process.env['ProgramFiles(x86)'] ?? 'C:/Program Files (x86)', 'Microsoft Visual Studio/Installer/vswhere.exe');
  cmake = execFileSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
    '-find', 'Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe'], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/u)[0];
  if (!cmake) throw new Error('Install Visual Studio C++ build tools with CMake');
}
const build = resolve(root, 'tmp/outdoor-native-build');
const run = args => execFileSync(cmake, args, { cwd: root, windowsHide: true, stdio: 'inherit' });
run(['-S', 'native/outdoor', '-B', build, ...(process.platform === 'win32' ? ['-A', 'x64'] : []), '-DCMAKE_POLICY_VERSION_MINIMUM=3.5']);
run(['--build', build, '--config', 'Release', '--parallel', '4']);
const executable = name => resolve(build, ...(process.platform === 'win32' ? ['Release', `${name}.exe`] : [name]));
if (process.argv.includes('--test')) execFileSync(executable('outdoor-native-tests'), [], { windowsHide: true, stdio: 'inherit' });
const output = resolve(root, 'resources/outdoor-worker');
await mkdir(resolve(output, 'licenses'), { recursive: true });
await copyFile(executable('casmate-outdoor-worker'), resolve(output, `casmate-outdoor-worker${process.platform === 'win32' ? '.exe' : ''}`));
for (const name of ['srt', 'mbedtls']) {
  await copyFile(resolve(root, 'tmp/outdoor-native-deps', name, 'LICENSE'), resolve(output, 'licenses', `${name}-LICENSE`));
}
await copyFile(resolve(root, 'native/outdoor/dependencies.json'), resolve(output, 'dependencies.json'));
const dependencies = JSON.parse(await readFile(resolve(root, 'native/outdoor/dependencies.json'), 'utf8'));
await mkdir(resolve(output, 'patches'), { recursive: true });
for (const patch of dependencies.srt.patches ?? []) await copyFile(resolve(root, 'native/outdoor/patches', patch.file), resolve(output, 'patches', patch.file));
