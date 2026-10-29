import { readFile } from 'node:fs/promises';
import type { AppSettings } from '../../../shared/types';
import { createDefaultSettings } from './schema';
import { readStoredSettings } from './stored-format';
import { atomicBytes, compatibilityNotice, replaceRetiredBytes } from '../compatibility-storage';
import { nonEmptyString } from './values';

export interface SettingsLoadResult {
  firstRun?: boolean;
  settings: AppSettings;
  warning?: string;
  compatibilityBackupPath?: string;
  voicevoxExecutablePath?: string;
}

export class SettingsStore {
  private voicevoxExecutablePath: string | undefined;
  private latestSettings: AppSettings | undefined;
  private saveQueue = Promise.resolve();

  constructor(
    private readonly filePath: string,
  ) {}

  async load(): Promise<SettingsLoadResult> {
    try { return await this.readSavedSettings(); }
    catch (error) {
      const detail = error instanceof SyntaxError ? '設定JSONを読み込めません。原本を保持しています。' : error instanceof Error ? error.message : '設定を読み込めません。原本を保持しています。';
      const guidance = detail + '\n保存先: ' + this.filePath + '\n新しい版の保存は対応するきゃすメイトを使用してください。再設定する場合はアプリ終了後、この設定ファイルと、存在する場合は ' + this.filePath + '.compatibility-reset.json を別の場所へ手動で退避し、再起動して設定し直してください。素材・ログ・退避ファイルは削除しないでください。';
      // Preserve the unsupported-version classification for callers.
      if (error instanceof Error) { error.message = guidance; throw error; }
      throw new Error(guidance, { cause: error });
    }
  }

  private async readSavedSettings(): Promise<SettingsLoadResult> {
    const previousNotice = await compatibilityNotice(this.filePath);
    let original: Buffer;
    try { original = await readFile(this.filePath); }
    catch (error) { if (!isMissingFile(error)) throw error; const settings = createDefaultSettings(); this.latestSettings = structuredClone(settings); return { settings, firstRun: true }; }
    const { settings, retired, migrated, voicevoxExecutablePath } = readStoredSettings(JSON.parse(original.toString('utf8')));
    let compatibilityBackupPath: string | undefined;
    if (migrated && !retired) {
      const replacement = Buffer.from(JSON.stringify({ ...settings, ...(voicevoxExecutablePath ? { voicevoxExecutablePath } : {}) }, null, 2) + '\n');
      compatibilityBackupPath = await replaceRetiredBytes(this.filePath, original, replacement,
        '音声認識の入力設定とjpnknのAI設定に対応しました。既存の設定は保持しています。');
    }
    if (retired) compatibilityBackupPath = await replaceRetiredBytes(this.filePath, original,
      Buffer.from(JSON.stringify({ ...settings, ...(voicevoxExecutablePath ? { voicevoxExecutablePath } : {}) }, null, 2) + '\n'),
      '対応を終了した設定を退避し、対象設定を既定値にしました。設定を確認してください。');
    this.voicevoxExecutablePath = voicevoxExecutablePath;
    this.latestSettings = structuredClone(settings);
    return { settings, ...(voicevoxExecutablePath ? { voicevoxExecutablePath } : {}),
      ...(compatibilityBackupPath ? { compatibilityBackupPath } : {}),
      ...((compatibilityBackupPath || previousNotice) ? { warning: await compatibilityNotice(this.filePath) ?? undefined } : {}) };
  }

  async save(settings: AppSettings): Promise<void> {
    const settingsSnapshot = structuredClone(settings);
    await this.enqueueSave(() => this.writeSettings(
      settingsSnapshot,
      this.voicevoxExecutablePath,
    ));
  }

  async saveVoicevoxExecutablePath(path: string, settings: AppSettings): Promise<void> {
    await this.saveEnginePath(path, settings);
  }

  async saveDiscoveredVoicevoxExecutablePath(path: string, settings: AppSettings, expectedPath: string | undefined): Promise<boolean> {
    return this.saveEnginePath(path, settings, { expectedPath });
  }

  private async saveEnginePath(path: string, settings: AppSettings, condition?: { expectedPath: string | undefined }): Promise<boolean> {
    const nextPath = nonEmptyString(path, 'VOICEVOX Engine実行ファイル', 2_000);
    const settingsSnapshot = structuredClone(settings);
    let saved = false;
    await this.enqueueSave(async () => {
      if (condition && this.voicevoxExecutablePath !== condition.expectedPath) return;
      await this.writeSettings(
        this.latestSettings ?? settingsSnapshot,
        nextPath,
      );
      this.voicevoxExecutablePath = nextPath;
      saved = true;
    });
    return saved;
  }

  private enqueueSave(operation: () => Promise<void>): Promise<void> {
    const result = this.saveQueue.then(operation);
    this.saveQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async writeSettings(
    settings: AppSettings,
    voicevoxExecutablePath: string | undefined,
  ): Promise<void> {
    const persisted = {
      ...settings,
      ...(voicevoxExecutablePath
        ? { voicevoxExecutablePath }
        : {}),
    };
    await atomicBytes(this.filePath, Buffer.from(`${JSON.stringify(persisted, null, 2)}\n`));
    this.latestSettings = structuredClone(settings);
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
