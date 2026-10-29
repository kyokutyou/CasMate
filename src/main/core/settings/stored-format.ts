import type { AppSettings, SettingsSection } from '../../../shared/types';
import { compatibilityPolicy } from '../../../shared/compatibility-policy.generated';
import { createDefaultSettings, validateSettingsSection } from './schema';
import { isRecord, nonEmptyString } from './values';
import { ValidationError } from '../validation-error';
import { defaultAiSettings, validateAiSettings } from '../../../shared/ai-listener';

export const settingsSections: SettingsSection[] = ['aiListener', 'application', 'sources', 'commentOverlay', 'speechRecognitionOverlay', 'commentList', 'commentFilter', 'character', 'commentSpeech', 'mobileSpeech', 'speechRecognition', 'textEffects'];
export function readStoredSettings(parsed: unknown): { settings: AppSettings; retired: boolean; migrated?: boolean; voicevoxExecutablePath?: string } {
  if (!isRecord(parsed)) throw new ValidationError('設定の形式が正しくありません。');
  const policy = compatibilityPolicy.contracts.pcSettings;
  const version = parsed.schemaVersion;
  if (policy.retired.includes(version as never)) {
    // Recognition only: never turn historical values into usable current settings.
    recognizeRetiredSettings(parsed, Number(version));
    return { settings: createDefaultSettings(), retired: true };
  }
  if (!policy.supported.includes(version as never)) throw new UnsupportedSettingsVersionError();
  const settings = createDefaultSettings(); let retired = false;
  for (const section of settingsSections) {
    let value = parsed[section];
    if (section === 'speechRecognitionOverlay' && typeof version === 'number' && version < 16) {
      const { fontFamily, fontSizePx, textColor, backgroundColor, paddingPx, borderRadiusPx } = settings.commentOverlay;
      value = { displayDurationSeconds: 10, fontFamily, fontSizePx, textColor, backgroundColor, paddingPx, borderRadiusPx };
    }
    if (section === 'aiListener' && typeof version === 'number' && version < 15 && isRecord(value)) value = addBoardAiSettings(value);
    if (section === 'aiListener' && typeof version === 'number' && version < 15 && isRecord(value) && isRetiredAiShape(value)) {
      // Validate all the existing values before deciding that this is a known retired shape.
      validateAiSettings({ ...value, waitSeconds: isRetiredWait(value.waitSeconds) ? 30 : value.waitSeconds,
        visual: value.visual === undefined ? { enabled: false, source: null } : value.visual, contextCharacters: value.contextCharacters === undefined ? 3000 : value.contextCharacters, debugPromptLog: value.debugPromptLog === undefined ? false : value.debugPromptLog });
      value = defaultAiSettings(); retired = true;
    }
    settings[section] = validateSettingsSection(section, value) as never;
  }
  return { settings, retired, migrated: version !== policy.current, ...(parsed.voicevoxExecutablePath === undefined ? {} : { voicevoxExecutablePath: nonEmptyString(parsed.voicevoxExecutablePath, 'VOICEVOX Engine実行ファイル', 2000) }) };
}
function addBoardAiSettings(value: Record<string, unknown>): Record<string, unknown> {
  return { ...value,
    jpnknName: value.jpnknName === undefined ? '' : value.jpnknName,
    jpnknEmail: value.jpnknEmail === undefined ? '' : value.jpnknEmail,
    participants: isRecord(value.participants)
      ? { ...value.participants, jpnkn: value.participants.jpnkn === undefined ? { enabled: false, personaId: '' } : value.participants.jpnkn }
      : value.participants,
  };
}
function isRetiredAiShape(value: Record<string, unknown>): boolean {
  return isRetiredWait(value.waitSeconds) ||
    value.visual === undefined || value.contextCharacters === undefined || value.debugPromptLog === undefined;
}
function isRetiredWait(value: unknown): value is number { return typeof value === 'number' && Number.isInteger(value) && value >= 10 && value < 30; }
function recognizeRetiredSettings(parsed: Record<string, unknown>, version: number): void {
  const required: SettingsSection[] = ['application', 'sources', 'commentOverlay', 'commentList', 'character',
    ...(version >= 2 ? ['commentSpeech', 'mobileSpeech'] as const : []), ...(version >= 6 ? ['commentFilter'] as const : []),
    ...(version >= 7 ? ['speechRecognition'] as const : []), ...(version >= 8 ? ['textEffects'] as const : [])];
  const defaults = createDefaultSettings();
  for (const section of required) {
    const value = parsed[section];
    if (!isRecord(value) || Object.keys(value).length === 0) throw new ValidationError('旧設定の構造を確認できません。');
    if (section === 'character' && version < 12 && !isRecord(value.simple)) {
      if (typeof value.alwaysOnTop !== 'boolean' || typeof value.clickThrough !== 'boolean' || !isRecord(value.windowBounds)) throw new ValidationError('旧キャラクター設定の構造を確認できません。');
      for (const key of version < 5 ? ['idleAsset', 'idleMouthOpenAsset', 'reactionAsset', 'reactionMouthOpenAsset'] : ['closedAsset', 'openAsset']) {
        if (value[key] !== null && typeof value[key] !== 'string' && !(key.endsWith('MouthOpenAsset') && value[key] === undefined)) throw new ValidationError('旧素材設定の構造を確認できません。');
      }
      validateSettingsSection('character', { ...defaults.character, ...value, mode: 'simple', simple: defaults.character.simple });
    } else if (section === 'sources') {
      if (!isRecord(value.youtube) || !isRecord(value.twitch) || !isRecord(value.shitaraba)) throw new ValidationError('旧接続先の構造を確認できません。');
      validateSettingsSection(section, { ...defaults.sources, ...value, shitaraba: { ...defaults.sources.shitaraba, ...value.shitaraba } });
    } else if (section === 'character') {
      const simple = value.simple;
      validateSettingsSection(section, { ...defaults.character, ...value, ...(isRecord(simple) ? { simple: { ...defaults.character.simple, ...simple } } : {}) });
    } else {
      // Defaults validate fields absent from historical layouts; no converted value is returned or saved.
      const oldDefaults = defaults[section] as unknown as Record<string, unknown>;
      const requiredKeys = section === 'application' ? ['port', 'managementWindow', 'commentListWindow'] :
        section === 'commentList' ? ['showSource', 'showAuthor', 'showContent'] : Object.keys(oldDefaults).filter(key => section !== 'speechRecognition' || !['inputSource', 'smartphoneDeviceId'].includes(key));
      if (!requiredKeys.every(key => Object.hasOwn(value, key) || section === 'mobileSpeech' && key === 'tailscaleEnabled' && version < 11)) throw new ValidationError('旧設定の必須項目を確認できません。');
      validateSettingsSection(section, { ...oldDefaults, ...value });
    }
  }
}
export class UnsupportedSettingsVersionError extends Error {
  constructor() { super('未対応の設定形式です。原本を保持しています。対応するきゃすメイトを使用してください。'); }
}
