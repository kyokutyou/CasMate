import { mkdtemp, readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createDefaultSettings, SettingsStore } from '../src/main/core/settings';
import { archiveBytes, compatibilityNotice } from '../src/main/core/compatibility-storage';

describe('対応終了保存の保全', () => {
  it('版13の入力設定追加で全既存値とVOICEVOXパスを保持し、再起動で再移行しない', async () => {
    const root = await mkdtemp(join(tmpdir(), 'casmate-settings-migrate-')); const file = join(root, 'settings.json');
    const expected = createDefaultSettings(); expected.application.port = 4321;
    // Version 13 used the shared pre-sticky appearance for both OBS views.
    Object.assign(expected.commentOverlay, { fontSizePx: 32, textColor: '#ffffffff',
      backgroundColor: '#00000099', paddingPx: 8, borderRadiusPx: 8, showSource: true });
    expected.sources.twitch.channel = 'keep-channel'; expected.speechRecognition.enabled = true;
    expected.speechRecognition.microphoneId = 'keep-mic'; expected.speechRecognition.vadThreshold = 0.42;
    const oldSpeech = { ...expected.speechRecognition }; delete oldSpeech.inputSource; delete oldSpeech.smartphoneDeviceId;
    const original = Buffer.from(JSON.stringify({ ...expected, schemaVersion: 13, speechRecognition: oldSpeech, voicevoxExecutablePath: 'C:\\VOICEVOX\\run.exe' }));
    await writeFile(file, original);
    const first = await new SettingsStore(file).load();
    expect(first.settings).toEqual(expected); expect(first.voicevoxExecutablePath).toBe('C:\\VOICEVOX\\run.exe');
    expect(await readFile(first.compatibilityBackupPath!)).toEqual(original);
    expect(JSON.parse(await readFile(file, 'utf8')).schemaVersion).toBe(16);
    const second = await new SettingsStore(file).load();
    expect(second.settings).toEqual(expected); expect(second.voicevoxExecutablePath).toBe(first.voicevoxExecutablePath);
    expect((await readdir(root)).filter(name => name.endsWith('.backup'))).toHaveLength(1);
  });
  it('版13の認識設定が壊れている場合は移行で補わず原本を保持する', async () => {
    const root = await mkdtemp(join(tmpdir(), 'casmate-settings-invalid-migrate-')); const file = join(root, 'settings.json');
    const settings = createDefaultSettings(); const original = JSON.stringify({ ...settings, schemaVersion: 13,
      speechRecognition: { ...settings.speechRecognition, vadThreshold: -1 } });
    await writeFile(file, original); await expect(new SettingsStore(file).load()).rejects.toThrow();
    expect(await readFile(file, 'utf8')).toBe(original); expect(await readdir(root)).toEqual(['settings.json']);
  });
  it('版13の原本退避に失敗した場合は移行しない', async () => {
    const root = await mkdtemp(join(tmpdir(), 'casmate-settings-migrate-backup-')); const file = join(root, 'settings.json');
    const original = Buffer.from(JSON.stringify({ ...createDefaultSettings(), schemaVersion: 13 }));
    await writeFile(file, original); await mkdir(`${file}.retired-${createHash('sha256').update(original).digest('hex')}.backup`);
    await expect(new SettingsStore(file).load()).rejects.toThrow(); expect(await readFile(file)).toEqual(original);
  });
  it.each(Array.from({ length: 12 }, (_, index) => index + 1))('旧設定版%iを生バイトで退避して既定値にする', async schemaVersion => {
    const root = await mkdtemp(join(tmpdir(), 'casmate-retired-')); const file = join(root, 'settings.json');
    const bytes = Buffer.from(JSON.stringify({ ...createDefaultSettings(), schemaVersion, application: { ...createDefaultSettings().application, port: 4321 } }));
    await writeFile(file, bytes);
    const result = await new SettingsStore(file).load();
    expect(result.settings).toEqual(createDefaultSettings());
    expect(await readFile(result.compatibilityBackupPath!)).toEqual(bytes);
    expect((await new SettingsStore(file).load()).settings).toEqual(result.settings);
    expect((await readdir(root)).filter(name => name.endsWith('.backup'))).toHaveLength(1);
  });
  it('旧AI形状の初期化で他の現行設定と素材参照を維持する', async () => {
    const root = await mkdtemp(join(tmpdir(), 'casmate-ai-retired-')); const file = join(root, 'settings.json');
    const settings = createDefaultSettings(); settings.schemaVersion = 14; settings.application.port = 4321; settings.aiListener.waitSeconds = 10;
    settings.character.simple.closedAsset = '/assets/keep.png';
    await writeFile(file, JSON.stringify(settings));
    const result = await new SettingsStore(file).load();
    expect(result.settings.aiListener).toEqual(createDefaultSettings().aiListener);
    expect(result.settings.application).toEqual(settings.application);
    expect(result.settings.character).toEqual(settings.character);
    expect(JSON.parse(await readFile(result.compatibilityBackupPath!, 'utf8'))).toEqual(settings);
  });
  it.each(['{broken', '{"schemaVersion":1}', JSON.stringify({ ...createDefaultSettings(), schemaVersion: 999 })])('判別できない保存を上書きしない', async content => {
    const root = await mkdtemp(join(tmpdir(), 'casmate-preserve-')); const file = join(root, 'settings.json');
    await writeFile(file, content); await expect(new SettingsStore(file).load()).rejects.toThrow();
    expect(await readFile(file, 'utf8')).toBe(content); expect(await readdir(root)).toEqual(['settings.json']);
  });
  it.each(['negative-port', 'empty-section', 'invalid-old-ai'])('旧版として判定できない%sは原本を保持する', async kind => {
    const root = await mkdtemp(join(tmpdir(), 'casmate-invalid-retired-')); const file = join(root, 'settings.json');
    const settings = createDefaultSettings();
    const value: Record<string, unknown> = { ...settings, schemaVersion: 12 };
    if (kind === 'negative-port') value.application = { ...settings.application, port: -1 };
    if (kind === 'empty-section') value.application = {};
    if (kind === 'invalid-old-ai') {
      value.schemaVersion = 13;
      const ai: Record<string, unknown> = { ...settings.aiListener, waitSeconds: -1 }; delete ai.visual; value.aiListener = ai;
    }
    const original = JSON.stringify(value); await writeFile(file, original);
    await expect(new SettingsStore(file).load()).rejects.toThrow();
    expect(await readFile(file, 'utf8')).toBe(original); expect(await readdir(root)).toEqual(['settings.json']);
  });
  it.each(['visual', 'contextCharacters', 'debugPromptLog'])('旧AIの明示null %sは初期化で隠さない', async field => {
    const root = await mkdtemp(join(tmpdir(), 'casmate-null-ai-')); const file = join(root, 'settings.json');
    const settings = createDefaultSettings();
    const ai: Record<string, unknown> = { ...settings.aiListener, waitSeconds: 10, [field]: null };
    const original = JSON.stringify({ ...settings, schemaVersion: 14, aiListener: ai }); await writeFile(file, original);
    await expect(new SettingsStore(file).load()).rejects.toThrow();
    expect(await readFile(file, 'utf8')).toBe(original); expect(await readdir(root)).toEqual(['settings.json']);
  });
  it.each([1, 2, 4])('旧版%iの省略可能な口開き素材を認識して退避する', async schemaVersion => {
    const root = await mkdtemp(join(tmpdir(), 'casmate-flat-character-')); const file = join(root, 'settings.json');
    const settings = createDefaultSettings();
    const character = { controlMode: 'auto', idleAsset: '/assets/idle.png', reactionAsset: null, alwaysOnTop: true, clickThrough: true,
      windowBounds: settings.character.windowBounds };
    const original = Buffer.from(JSON.stringify({ ...settings, schemaVersion, character })); await writeFile(file, original);
    const result = await new SettingsStore(file).load(); expect(result.settings).toEqual(createDefaultSettings());
    expect(await readFile(result.compatibilityBackupPath!)).toEqual(original);
  });
  it.each(['{broken', JSON.stringify({ ...createDefaultSettings(), schemaVersion: 999 })])('起動エラーで保存先と手動復旧手順を案内する', async original => {
    const root = await mkdtemp(join(tmpdir(), 'casmate-startup-guide-')); const file = join(root, 'settings.json');
    await writeFile(file, original);
    const error = await new SettingsStore(file).load().catch(value => value as Error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(file); expect((error as Error).message).toContain('.compatibility-reset.json');
    expect((error as Error).message).toContain('手動で退避'); expect((error as Error).message).toContain('対応するきゃすメイト');
    expect(await readFile(file, 'utf8')).toBe(original);
  });
  it('退避不能なら旧原本を維持して初期化しない', async () => {
    const root = await mkdtemp(join(tmpdir(), 'casmate-backup-fail-')); const file = join(root, 'settings.json');
    const bytes = Buffer.from(JSON.stringify({ ...createDefaultSettings(), schemaVersion: 12 }));
    await writeFile(file, bytes); await mkdir(`${file}.retired-${createHash('sha256').update(bytes).digest('hex')}.backup`);
    await expect(new SettingsStore(file).load()).rejects.toThrow(); expect(await readFile(file)).toEqual(bytes);
  });
  it('中断後の不一致は現在原本を保持し、次回も失敗を通知する', async () => {
    const root = await mkdtemp(join(tmpdir(), 'casmate-interrupted-')); const file = join(root, 'settings.json');
    const original = Buffer.from('original'); await archiveBytes(file, original);
    await writeFile(file, 'partial'); const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex');
    await writeFile(`${file}.compatibility-reset.json`, JSON.stringify({ state: 'pending', originalHash: digest(original), replacementHash: digest(Buffer.from('replacement')), notice: 'reset' }));
    await expect(compatibilityNotice(file)).rejects.toThrow('保持'); expect(await readFile(file, 'utf8')).toBe('partial');
    await expect(compatibilityNotice(file)).rejects.toThrow('保存に失敗');
  });
});
