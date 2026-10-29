import { execFile } from 'node:child_process';
import { win32 } from 'node:path';

// Read installation metadata only; never execute commands from registry values.
const installationScript = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$roots = @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', 'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*')
$locations = @(Get-ItemProperty $roots -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq 'VOICEVOX' } | ForEach-Object { $_.InstallLocation } | Where-Object { $_ })
ConvertTo-Json -Compress -InputObject $locations
`;

export async function voicevoxInstallLocations(): Promise<string[]> {
  if (process.platform !== 'win32') return [];
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', installationScript],
      { windowsHide: true, timeout: 3_000, maxBuffer: 64 * 1024, encoding: 'utf8' }, (error, stdout) => {
        if (error) { resolve([]); return; }
        try {
          const values: unknown = JSON.parse(stdout.replace(/^\uFEFF/, ''));
          resolve(Array.isArray(values) ? values.filter((value): value is string =>
            typeof value === 'string' && win32.isAbsolute(value)) : []);
        } catch { resolve([]); }
      });
  });
}

export function standardVoicevoxExecutables(env: NodeJS.ProcessEnv): string[] {
  const roots = [
    env.LOCALAPPDATA && win32.join(env.LOCALAPPDATA, 'Programs'),
    env.ProgramW6432, env.ProgramFiles, env['ProgramFiles(x86)'],
  ];
  return [...new Set(roots.filter((root): root is string => Boolean(root))
    .map(root => win32.join(root, 'VOICEVOX', 'vv-engine', 'run.exe')))];
}
