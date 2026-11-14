import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { basename, dirname, join, resolve } from 'node:path';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import type { SecretProtection } from '../core/secret-protection';

const execute = promisify(execFile);
export interface TunnelCallbacks { url(url: string): void; disconnected(message: string, terminal: boolean): void }
export interface PollTunnel { close(): Promise<void> }
export interface PollTunnelDriver { open(port: number, callbacks: TunnelCallbacks): Promise<PollTunnel> }
export function canonicalSrvUrl(value: string): string | null {
  return /^https:\/\/[a-z2-7]{26}\.srv\.us\/$/u.test(value) ? value : null;
}
export class SrvUsTunnel implements PollTunnelDriver {
  constructor(private readonly directory: string, private readonly protection: SecretProtection) {}
  async open(port: number, callbacks: TunnelCallbacks): Promise<PollTunnel> {
    if (process.platform !== 'win32') throw new Error('Windows OpenSSHが必要です。');
    const system = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
    const ssh = join(system, 'OpenSSH', 'ssh.exe'), keygen = join(system, 'OpenSSH', 'ssh-keygen.exe');
    try { await execute(ssh, ['-V'], { windowsHide: true, timeout: 5000 }); }
    catch { throw new Error('Windows OpenSSHが見つかりません。Windowsの「オプション機能」から「OpenSSH クライアント」を追加してください。'); }
    if (!this.protection.isEncryptionAvailable()) throw new Error('接続鍵の暗号化を利用できません。Windowsの利用者で起動し直してください。');
    await mkdir(this.directory, { recursive: true });
    const { stdout } = await execute(join(system, 'whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { windowsHide: true, timeout: 5000 });
    const sid = stdout.match(/S-1-5-(?:\d+-)*\d+/u)?.[0];
    if (!sid) throw new Error('接続鍵を保存するWindows利用者を確認できません。');
    await execute(join(system, 'icacls.exe'), [this.directory, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`], { windowsHide: true, timeout: 5000 });
    // Previous interrupted runs belong to this dedicated directory, never to another SSH setup.
    for (const entry of await readdir(this.directory, { withFileTypes: true })) {
      if (entry.isDirectory() && /^run-[\da-z]{6}$/iu.test(entry.name)) await this.cleanupRuntime(join(this.directory, entry.name));
    }
    const runtime = await mkdtemp(join(this.directory, 'run-'));
    const key = join(runtime, 'identity'), config = join(runtime, 'config'), encrypted = join(this.directory, 'identity.encrypted');
    try {
      try {
        const data = await readFile(encrypted);
        await writeFile(key, this.protection.decryptString(data), { flag: 'wx' });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('保存した接続鍵を復号できません。原本を保持しています。', { cause: error });
        await execute(keygen, ['-q', '-t', 'ed25519', '-N', '', '-C', 'casmate-listener-poll', '-f', key], { windowsHide: true, timeout: 10_000 });
        await writeFile(encrypted, this.protection.encryptString(await readFile(key, 'utf8')), { flag: 'wx' });
      }
      await writeFile(config, '', { flag: 'wx' });
      // Relative SSH paths avoid config token/whitespace expansion in Windows profile names.
      const child = spawn(ssh, ['-F', join(basename(runtime), 'config'), '-i', join(basename(runtime), 'identity'), '-T',
        '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none', '-o', 'ForwardAgent=no', '-o', 'ForwardX11=no',
        '-o', 'PermitLocalCommand=no', '-o', 'ProxyCommand=none', '-o', 'ProxyJump=none', '-o', 'ExitOnForwardFailure=yes',
        '-o', 'StrictHostKeyChecking=accept-new', '-o', 'UserKnownHostsFile=known_hosts', '-o', 'GlobalKnownHostsFile=NUL',
        '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=10', '-o', 'ServerAliveCountMax=3',
        '-R', `1:127.0.0.1:${port}`, 'nomatch@srv.us'], {
        cwd: this.directory, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, SSH_AUTH_SOCK: undefined, SSH_AGENT_PID: undefined },
      });
      let output = '', errors = '', intentional = false, reported = false;
      const closed = new Promise<boolean>(resolve => {
        const finish = () => { void this.cleanupRuntime(runtime).then(() => resolve(true), () => resolve(false)); };
        child.once('close', finish);
      });
      const report = () => {
        if (intentional || reported) return; reported = true;
        const changed = /REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed/iu.test(errors);
        callbacks.disconnected(changed ? 'srv.usのホスト鍵を確認できません。接続を停止しました。専用known_hostsを確認してください。' : 'srv.usへの接続が切れました。再接続しています。', changed);
      };
      child.stdout.on('data', (data: Buffer) => {
        output = (output + data.toString('utf8')).slice(-8192);
        for (const match of output.matchAll(/https:\/\/[a-z2-7]{26}\.srv\.us\/?/gu)) callbacks.url(match[0].replace(/\/?$/u, '/'));
      });
      child.stderr.on('data', (data: Buffer) => { errors = (errors + data.toString('utf8')).slice(-8192); });
      child.once('error', report); child.once('close', report);
      return { close: async () => { intentional = true; child.kill(); if (!await closed) throw new Error('実行用の接続鍵を削除できませんでした。次の公開開始時に再度削除を試みます。'); } };
    } catch (error) { await this.cleanupRuntime(runtime); throw error; }
  }
  private async cleanupRuntime(path: string): Promise<void> {
    const target = resolve(path);
    if (dirname(target) !== resolve(this.directory) || !/^run-[\da-z]{6}$/iu.test(basename(target))) throw new Error('接続鍵の削除対象を確認できません。');
    await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}
