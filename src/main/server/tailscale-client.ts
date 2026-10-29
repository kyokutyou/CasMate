import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import { join } from 'node:path';

export type TailscaleDetection =
  | { status: 'ready'; address: string }
  | { status: 'notInstalled' | 'serviceStopped' | 'loginRequired' | 'ipUnavailable' };

export interface TailscaleClient {
  detect(signal?: AbortSignal): Promise<TailscaleDetection>;
}

export type TailscaleCommandRunner = (
  executable: string,
  args: string[],
  signal?: AbortSignal,
) => Promise<{ stdout: string }>;

interface WindowsTailscaleClientOptions {
  findExecutable?: () => Promise<string | null>;
  run?: TailscaleCommandRunner;
  interfaces?: () => NodeJS.Dict<NetworkInterfaceInfo[]>;
}

export class WindowsTailscaleClient implements TailscaleClient {
  constructor(private readonly options: WindowsTailscaleClientOptions = {}) {}

  async detect(signal?: AbortSignal): Promise<TailscaleDetection> {
    const executable = await (this.options.findExecutable ?? findTailscaleExecutable)();
    if (signal?.aborted) return { status: 'ipUnavailable' };
    if (!executable) return { status: 'notInstalled' };

    let stdout: string;
    try {
      ({ stdout } = await (this.options.run ?? runTailscaleCommand)(
        executable,
        ['status', '--json'],
        signal,
      ));
    } catch (error) {
      return classifyCommandError(error);
    }
    if (signal?.aborted) return { status: 'ipUnavailable' };

    let status: { BackendState?: unknown; TailscaleIPs?: unknown };
    try {
      status = JSON.parse(stdout) as typeof status;
    } catch {
      return { status: 'ipUnavailable' };
    }
    if (status.BackendState === 'NeedsLogin' || status.BackendState === 'NeedsMachineAuth') {
      return { status: 'loginRequired' };
    }
    if (status.BackendState !== 'Running') return { status: 'serviceStopped' };

    const addresses = Array.isArray(status.TailscaleIPs)
      ? status.TailscaleIPs.filter((value): value is string =>
        typeof value === 'string' && isTailscaleIpv4(value))
      : [];
    if (addresses.length !== 1) return { status: 'ipUnavailable' };

    const address = addresses[0]!;
    const interfaces = (this.options.interfaces ?? networkInterfaces)();
    const present = Object.values(interfaces).some((values) =>
      (values ?? []).some((info) =>
        info.family === 'IPv4' && !info.internal && info.address === address),
    );
    return present ? { status: 'ready', address } : { status: 'ipUnavailable' };
  }
}

async function findTailscaleExecutable(): Promise<string | null> {
  const programFiles = process.env.ProgramFiles ?? process.env.PROGRAMFILES;
  if (programFiles) {
    const installed = join(programFiles, 'Tailscale', 'tailscale.exe');
    try {
      await access(installed);
      return installed;
    } catch {
      // The official MSI path is preferred; PATH is used for other official installations.
    }
  }
  return 'tailscale.exe';
}

function runTailscaleCommand(executable: string, args: string[], signal?: AbortSignal): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(executable, args, {
      encoding: 'utf8',
      maxBuffer: 256 * 1024,
      timeout: 3_000,
      windowsHide: true,
      signal,
    }, (error, stdout) => {
      if (error) reject(error);
      else resolve({ stdout });
    });
  });
}

function classifyCommandError(error: unknown): TailscaleDetection {
  const details = error as { code?: unknown; message?: unknown; stderr?: unknown };
  if (details.code === 'ENOENT') return { status: 'notInstalled' };
  const text = `${String(details.message ?? '')}\n${String(details.stderr ?? '')}`.toLowerCase();
  if (text.includes('not logged in') || text.includes('needs login')) {
    return { status: 'loginRequired' };
  }
  if (text.includes('tailscaled') || text.includes('localapi') || text.includes('service')) {
    return { status: 'serviceStopped' };
  }
  return { status: 'ipUnavailable' };
}

function isTailscaleIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  return octets.length === 4 &&
    octets.every((value) => Number.isInteger(value) && value >= 0 && value <= 255) &&
    octets[0] === 100 &&
    octets[1]! >= 64 &&
    octets[1]! <= 127;
}
