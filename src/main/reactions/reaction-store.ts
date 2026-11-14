import { access, mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { defaultReactionSettings, validReactionSettings, readReactionSettings, type ReactionSettings } from '../../shared/listener-reactions';
export interface ReactionPersistence { load(): Promise<ReactionSettings>; save(settings: ReactionSettings): Promise<void>; beginStartupChange?(): Promise<void>; completeStartupChange?(): undefined }
class StartupSavePending extends Error {}
export class ReactionStore implements ReactionPersistence {
  constructor(private readonly path: string) {}
  private get startupGuard() { return `${this.path}.startup-pending`; }
  async load(): Promise<ReactionSettings> {
    try {
      // Checking separately keeps a missing settings file from bypassing a pending guard.
      let pending = false; try { await access(this.startupGuard); pending = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (pending) throw new StartupSavePending('起動時公開の保存が未完了のため自動公開を停止しました。アプリ終了後、listener-reactions/settings.jsonとsettings.json.startup-pendingを確認して退避し、再設定してください。');
      const data = readReactionSettings(JSON.parse(await readFile(this.path, 'utf8'))); if (!data) throw new Error('invalid'); return data;
    }
    catch (error) { if (error instanceof StartupSavePending) throw error; if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultReactionSettings(); throw new Error('リアクション設定を読み込めません。原本を保持しています。', { cause: error }); }
  }
  async beginStartupChange(): Promise<void> { await mkdir(dirname(this.path), { recursive: true }); await writeFile(this.startupGuard, 'pending\n', { flag: 'wx' }); }
  // Finalize this tiny marker synchronously so OBS callbacks cannot interleave
  // between the controller's last validation and its in-memory commit.
  completeStartupChange(): undefined { rmSync(this.startupGuard, { force: true }); return undefined; }
  async save(settings: ReactionSettings): Promise<void> {
    if (!validReactionSettings(settings)) throw new Error('リアクション設定を確認してください。');
    await mkdir(dirname(this.path), { recursive: true }); const temporary = `${this.path}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, JSON.stringify(settings), { flag: 'wx' }); await rename(temporary, this.path); }
    finally { await rm(temporary, { force: true }).catch(() => undefined); }
  }
}
