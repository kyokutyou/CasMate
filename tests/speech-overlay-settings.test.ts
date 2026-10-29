import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createDefaultSettings, SettingsStore, validateSettingsSection } from '../src/main/core/settings';
import { readStoredSettings } from '../src/main/core/settings/stored-format';

it.each([13, 14, 15])('版%sの外観を一度だけ引き継ぎ、原本・既存値と再起動後の独立設定を保持する', async schemaVersion => {
  const root = await mkdtemp(join(tmpdir(), 'casmate-speech-overlay-'));
  const file = join(root, 'settings.json');
  const source = createDefaultSettings();
  source.commentOverlay.fontSizePx = 55;
  source.commentOverlay.backgroundColor = '#12345678';
  source.aiListener.participants.jpnkn.enabled = true;
  const old = Object.fromEntries(Object.entries(source).filter(([key]) => key !== 'speechRecognitionOverlay'));
  const bytes = JSON.stringify({ ...old, schemaVersion });
  await writeFile(file, bytes);
  const loaded = await new SettingsStore(file).load();
  expect(loaded.settings.schemaVersion).toBe(16);
  expect(loaded.settings.speechRecognitionOverlay).toMatchObject({ displayDurationSeconds: 10, fontSizePx: 55, backgroundColor: '#12345678' });
  expect(loaded.settings.aiListener).toEqual(source.aiListener);
  expect(loaded.settings.commentOverlay).toEqual(source.commentOverlay);
  expect(await readFile(loaded.compatibilityBackupPath!, 'utf8')).toBe(bytes);
  loaded.settings.speechRecognitionOverlay.fontSizePx = 70;
  loaded.settings.speechRecognitionOverlay.displayDurationSeconds = 12;
  await new SettingsStore(file).save(loaded.settings);
  const reopened = await new SettingsStore(file).load();
  expect(reopened.settings.speechRecognitionOverlay).toMatchObject({ displayDurationSeconds: 12, fontSizePx: 70 });
  expect(reopened.settings.commentOverlay.fontSizePx).toBe(55);
  expect(reopened.compatibilityBackupPath).toBeUndefined();
});

it('現行版の専用設定欠落を拒否し、旧AI形状を15から再補完しない', () => {
  const settings = createDefaultSettings();
  const missing = Object.fromEntries(Object.entries(settings).filter(([key]) => key !== 'speechRecognitionOverlay'));
  expect(() => readStoredSettings(missing)).toThrow();
  const participants = Object.fromEntries(Object.entries(settings.aiListener.participants).filter(([key]) => key !== 'jpnkn'));
  expect(() => readStoredSettings({ ...settings, schemaVersion: 15, aiListener: { ...settings.aiListener, participants } })).toThrow();
});

it.each([0, 61, NaN, Infinity, '10', null])('不正な表示秒数%sを保存しない', displayDurationSeconds => {
  expect(() => validateSettingsSection('speechRecognitionOverlay', { ...createDefaultSettings().speechRecognitionOverlay, displayDurationSeconds })).toThrow();
});
it.each([1, 10, 60])('表示秒数%sを受理する', displayDurationSeconds => {
  expect(validateSettingsSection('speechRecognitionOverlay', { ...createDefaultSettings().speechRecognitionOverlay, displayDurationSeconds }).displayDurationSeconds).toBe(displayDurationSeconds);
});
