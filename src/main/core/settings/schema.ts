import { compatibilityPolicy } from '../../../shared/compatibility-policy.generated';
import { isRecord, nonEmptyString, string } from './values';
import type {
  AppSettings,
  CommentSpeechSettings,
  CommentListSettings,
  CommentOverlaySettings,
  MobileSpeechSettings,
  ShitarabaNextThreadSettings,
  SpeechRecognitionSettings,
  SimpleCharacterMotionSettings,
  SettingsSection,
  TextEffectRule,
  TextEffectsSettings,
  WindowBounds,
} from '../../../shared/types';
import { defaultCommentFilterSettings, validateCommentFilterSettings } from '../comment-filter';
export { defaultCommentFilterSettings } from '../comment-filter';
import { graphemes } from '../../../shared/unicode';
import { defaultCharacterSettings } from '../character-controller';
import { defaultCommentOverlaySettings } from '../comment-overlay-controller';
import { ValidationError } from '../validation-error';
import { defaultAiSettings, validateAiSettings } from '../../../shared/ai-listener';
import { defaultManagementTheme, isManagementTheme } from '../../../shared/management-theme';
import { defaultManagementTextSize, isManagementTextSize } from '../../../shared/management-text-size';
import { defaultSpeechOverlayAppearance, validateObsDesign } from '../../../shared/obs-design';
import { validateSavedObsDesigns } from '../../../shared/saved-obs-designs';

export function createDefaultSettings(): AppSettings {
  return {
    schemaVersion: compatibilityPolicy.contracts.pcSettings.current,
    aiListener: defaultAiSettings(),
    application: {
      port: 3000,
      managementTheme: defaultManagementTheme,
      managementTextSize: defaultManagementTextSize,
      managementWindow: { width: 1180, height: 820 },
      commentListWindow: { width: 520, height: 760 },
      commentListWindowVisible: false,
    },
    sources: {
      autoConnect: false,
      youtube: { enabled: false, target: '' },
      twitch: { enabled: false, channel: '' },
      shitaraba: {
        enabled: false,
        threadUrl: '',
        pollIntervalSeconds: 5,
        nextThread: { ...defaultShitarabaNextThreadSettings },
      },
    },
    commentOverlay: { ...defaultCommentOverlaySettings },
    speechRecognitionOverlay: {
      displayDurationSeconds: 10,
      ...defaultSpeechOverlayAppearance,
    },
    commentList: { ...defaultCommentListSettings },
    commentFilter: { ...defaultCommentFilterSettings, ngWords: [] },
    character: {
      ...defaultCharacterSettings,
      simple: {
        ...defaultCharacterSettings.simple,
        motion: { ...defaultCharacterSettings.simple.motion },
      },
      windowBounds: { ...defaultCharacterSettings.windowBounds },
      settingsWindowBounds: { ...defaultCharacterSettings.settingsWindowBounds },
    },
    commentSpeech: { ...defaultCommentSpeechSettings },
    mobileSpeech: { ...defaultMobileSpeechSettings },
    speechRecognition: { ...defaultSpeechRecognitionSettings },
    textEffects: structuredClone(defaultTextEffectsSettings),
  };
}

export function validateSettingsSection<K extends SettingsSection>(
  section: K,
  value: unknown,
): AppSettings[K] {
  if (!isRecord(value)) {
    throw new ValidationError('設定の形式が正しくありません。');
  }

  switch (section) {
    case 'aiListener': {
      try { return validateAiSettings(value) as AppSettings[K]; }
      catch { throw new ValidationError('AIリスナー設定の形式・範囲を確認してください。'); }
    }
    case 'application': {
      const managementTheme = value.managementTheme === undefined ? defaultManagementTheme : value.managementTheme;
      if (!isManagementTheme(managementTheme)) throw new ValidationError('管理画面の配色が正しくありません。');
      const managementTextSize = value.managementTextSize === undefined ? defaultManagementTextSize : value.managementTextSize;
      if (!isManagementTextSize(managementTextSize)) throw new ValidationError('管理画面の文字サイズが正しくありません。');
      const port = integer(value.port, 'ポート');
      if (port < 1024 || port > 65535) {
        throw new ValidationError('ポートは1024～65535で指定してください。');
      }
      return {
        port,
        ...optionalSavedDesigns(value.obsSavedDesigns),
        ...(value.obsDesignWindow === undefined ? {} : { obsDesignWindow: windowBounds(value.obsDesignWindow, 'OBSデザイン編集') }),
        managementTheme,
        managementTextSize,
        managementWindow: windowBounds(value.managementWindow, '管理画面'),
        commentListWindow: windowBounds(value.commentListWindow, 'コメント一覧'),
        commentListWindowVisible:
          boolean(value.commentListWindowVisible, 'コメント一覧の表示状態'),
      } as AppSettings[K];
    }
    case 'sources': {
      const youtube = record(value.youtube, 'YouTube設定');
      const twitch = record(value.twitch, 'Twitch設定');
      const shitaraba = record(value.shitaraba, '掲示板設定');
      const nextThread = validateShitarabaNextThreadSettings(
        shitaraba.nextThread,
      );
      return {
        autoConnect:
          boolean(value.autoConnect, '起動時の自動接続'),
        youtube: {
          enabled: boolean(youtube.enabled, 'YouTubeの有効状態'),
          target: string(youtube.target, 'YouTube接続先', 500),
        },
        twitch: {
          enabled: boolean(twitch.enabled, 'Twitchの有効状態'),
          channel: string(twitch.channel, 'Twitch接続先', 500),
        },
        shitaraba: {
          enabled: boolean(shitaraba.enabled, '掲示板の有効状態'),
          threadUrl: string(shitaraba.threadUrl, '掲示板接続先', 2_000),
          pollIntervalSeconds:
            rangeInteger(
                shitaraba.pollIntervalSeconds,
                3,
                60,
                '掲示板の取得間隔は3～60秒で指定してください。',
              ),
          nextThread,
        },
      } as AppSettings[K];
    }
    case 'speechRecognitionOverlay': {
      return {
        ...optionalDesign('speech', value.design),
        displayDurationSeconds: rangeNumber(value.displayDurationSeconds, 1, 60, '表示時間は1～60秒で指定してください。'),
        fontFamily: string(value.fontFamily, 'フォント', 200),
        fontSizePx: rangeNumber(value.fontSizePx, 8, 200, '文字サイズは8～200pxで指定してください。'),
        textColor: color(value.textColor, '文字色'),
        backgroundColor: color(value.backgroundColor, '背景色'),
        paddingPx: rangeNumber(value.paddingPx, 0, 64, '余白は0～64pxで指定してください。'),
        borderRadiusPx: rangeNumber(value.borderRadiusPx, 0, 64, '角丸は0～64pxで指定してください。'),
      } as AppSettings[K];
    }
    case 'commentOverlay': {
      const result: CommentOverlaySettings = {
        ...optionalDesign('comments', value.design),
        mode:
          value.mode === 'stack' || value.mode === 'single'
            ? value.mode
            : fail('OBSコメント表示モードが正しくありません。'),
        stackDurationSeconds: rangeNumber(
          value.stackDurationSeconds,
          1,
          60,
          '積み上げ表示時間は1～60秒で指定してください。',
        ),
        singleDurationSeconds: rangeNumber(
          value.singleDurationSeconds,
          1,
          60,
          '1件表示時間は1～60秒で指定してください。',
        ),
        stackDirection:
          value.stackDirection === 'newestBottom' ||
          value.stackDirection === 'newestTop'
            ? value.stackDirection
            : fail('積み上げ方向が正しくありません。'),
        showSource: boolean(value.showSource, 'サービス名表示'),
        showAuthor: boolean(value.showAuthor, '投稿者名表示'),
        showContent: boolean(value.showContent, '本文表示'),
        fontFamily: string(value.fontFamily, 'フォント', 200),
        fontSizePx: rangeNumber(
          value.fontSizePx,
          8,
          200,
          '文字サイズは8～200pxで指定してください。',
        ),
        textColor: color(value.textColor, '文字色'),
        backgroundColor: color(value.backgroundColor, '背景色'),
        paddingPx: rangeNumber(
          value.paddingPx,
          0,
          64,
          '余白は0～64pxで指定してください。',
        ),
        borderRadiusPx: rangeNumber(
          value.borderRadiusPx,
          0,
          64,
          '角丸は0～64pxで指定してください。',
        ),
      };
      requireVisibleField(result);
      return result as AppSettings[K];
    }
    case 'commentList': {
      const result: CommentListSettings = {
        showSource: boolean(value.showSource, 'サービス名表示'),
        showAuthor: boolean(value.showAuthor, '投稿者名表示'),
        showContent: boolean(value.showContent, '本文表示'),
        stackDirection:
          value.stackDirection === 'newestBottom' || value.stackDirection === 'newestTop'
              ? value.stackDirection
              : fail('コメント一覧の積み上げ方向が正しくありません。'),
        fontFamily:
          string(value.fontFamily, 'コメント一覧のフォント', 200),
        fontSizePx:
          rangeNumber(
              value.fontSizePx,
              8,
              200,
              'コメント一覧の文字サイズは8～200pxで指定してください。',
            ),
        textColor:
          color(value.textColor, 'コメント一覧の文字色'),
        backgroundColor:
          color(value.backgroundColor, 'コメント一覧の背景色'),
      };
      requireVisibleField(result);
      return result as AppSettings[K];
    }
    case 'commentFilter': {
      return validateCommentFilterSettings(value) as AppSettings[K];
    }
    case 'character': {
      const simple = record(value.simple, '簡易キャラクター設定');
      const motion = record(simple.motion, '簡易キャラクターの微動設定');
      return {
        mode: value.mode === 'simple' ? 'simple' : fail('キャラクター表示方式が正しくありません。'),
        simple: {
          closedAsset: nullableString(simple.closedAsset, '閉口素材'),
          openAsset: nullableString(simple.openAsset, '口開き素材'),
          motion: validateSimpleCharacterMotionSettings(motion),
        },
        alwaysOnTop: boolean(value.alwaysOnTop, '最前面'),
        clickThrough: boolean(value.clickThrough, 'クリック透過'),
        windowVisible:
          boolean(value.windowVisible, 'キャラクターの表示状態'),
        windowBounds: windowBounds(value.windowBounds, 'キャラクター'),
        settingsWindowBounds: windowBounds(
          value.settingsWindowBounds,
          '簡易キャラクター設定画面',
        ),
      } as AppSettings[K];
    }
    case 'commentSpeech': {
      let voice: CommentSpeechSettings['voice'] = null;
      if (value.voice !== null) {
        const selected = record(value.voice, '話者とスタイル');
        const styleId = integer(selected.styleId, 'スタイルID');
        if (styleId < 0) throw new ValidationError('スタイルIDが正しくありません。');
        voice = {
          speakerUuid: nonEmptyString(selected.speakerUuid, '話者', 200),
          styleId,
        };
      }
      return {
        enabled: boolean(value.enabled, 'コメント読み上げ'),
        readSource: boolean(value.readSource, 'コメントソース名の読み上げ'),
        readAuthor: boolean(value.readAuthor, '投稿者名の読み上げ'),
        maxTextLength: rangeInteger(
          value.maxTextLength,
          50,
          500,
          '本文の最大文字数は50～500文字で指定してください。',
        ),
        voice,
        speedScale: rangeNumber(value.speedScale, 0.5, 2, '話速は0.5～2.0で指定してください。'),
        pitchScale: rangeNumber(value.pitchScale, -0.15, 0.15, '音高は-0.15～0.15で指定してください。'),
        intonationScale: rangeNumber(value.intonationScale, 0, 2, '抑揚は0.0～2.0で指定してください。'),
        volumeScale: rangeNumber(value.volumeScale, 0, 2, '音量は0.0～2.0で指定してください。'),
      } as AppSettings[K];
    }
    case 'mobileSpeech': {
      const result: MobileSpeechSettings = {
        lanEnabled: boolean(value.lanEnabled, 'LAN公開'),
        tailscaleEnabled: boolean(value.tailscaleEnabled, 'Tailscale公開'),
        bitrateKbps: rangeInteger(
          value.bitrateKbps,
          16,
          128,
          'AAC目標ビットレートは16～128 kbpsで指定してください。',
        ),
      };
      return result as AppSettings[K];
    }
    case 'speechRecognition': {
      if (value.inputSource === 'smartphone' && (typeof value.smartphoneDeviceId !== 'string' || !/^[a-f0-9-]{36}$/iu.test(value.smartphoneDeviceId))) {
        throw new ValidationError('認識するスマホを選択してください。');
      }
      const minSpeechDurationSeconds = rangeNumber(
        value.minSpeechDurationSeconds,
        0.05,
        5,
        '最短発話は0.05～5秒で指定してください。',
      );
      const maxSpeechDurationSeconds = rangeNumber(
        value.maxSpeechDurationSeconds,
        0.05,
        300,
        '最長発話は300秒以下で指定してください。',
      );
      if (maxSpeechDurationSeconds <= minSpeechDurationSeconds) {
        throw new ValidationError('最長発話は最短発話より長くしてください。');
      }
      return {
        enabled: boolean(value.enabled, '配信者音声認識'),
        microphoneId: nullableString(value.microphoneId, 'マイク'),
        inputSource: value.inputSource === undefined || value.inputSource === 'microphone' ? 'microphone' : value.inputSource === 'smartphone' ? 'smartphone' : invalidSpeechInput(),
        smartphoneDeviceId: value.smartphoneDeviceId === undefined ? null : nullableString(value.smartphoneDeviceId, 'スマホ入力'),
        vadThreshold: exclusiveRangeNumber(
          value.vadThreshold,
          0,
          1,
          'VAD閾値は0より大きく1未満で指定してください。',
        ),
        minSpeechDurationSeconds,
        minSilenceDurationSeconds: rangeNumber(
          value.minSilenceDurationSeconds,
          0.05,
          5,
          '無音判定は0.05～5秒で指定してください。',
        ),
        maxSpeechDurationSeconds,
        preRollDurationSeconds: rangeNumber(
          value.preRollDurationSeconds,
          0,
          3,
          '発話前は0～3秒で指定してください。',
        ),
        postRollDurationSeconds: rangeNumber(
          value.postRollDurationSeconds,
          0,
          3,
          '発話後は0～3秒で指定してください。',
        ),
      } satisfies SpeechRecognitionSettings as AppSettings[K];
    }
    case 'textEffects': {
      if (!Array.isArray(value.rules) || value.rules.length > 50) {
        throw new ValidationError('文字演出ルールは50件以下にしてください。');
      }
      const ids = new Set<string>();
      const rules = value.rules.map((candidate, index) => {
        const rule = record(candidate, `文字演出ルール${index + 1}`);
        const id = nonEmptyString(rule.id, '文字演出ルールID', 200);
        if (ids.has(id)) throw new ValidationError('文字演出ルールIDが重複しています。');
        ids.add(id);
        const trigger = graphemeString(rule.trigger, '反応ワード', 1, 50);
        const displayText = graphemeString(rule.displayText, '表示文字', 1, 1);
        const base = {
          id,
          enabled: boolean(rule.enabled, '文字演出ルールの有効状態'),
          trigger,
          displayText,
          color: color(rule.color, '文字演出の色'),
        };
        let result: TextEffectRule;
        if (rule.countMode === 'fixed') {
          result = {
            ...base,
            countMode: 'fixed',
            fixedCount: rangeInteger(rule.fixedCount, 1, 20, '固定個数は1～20で指定してください。'),
          };
        } else if (rule.countMode === 'consecutive') {
          if (graphemes(trigger).length !== 1) {
            throw new ValidationError('連動型の反応ワードは1文字で指定してください。');
          }
          result = {
            ...base,
            countMode: 'consecutive',
            minimumConsecutiveCount: rangeInteger(
              rule.minimumConsecutiveCount,
              2,
              20,
              '連動型の最低連続数は2～20で指定してください。',
            ),
          };
        } else {
          throw new ValidationError('文字演出の個数設定が正しくありません。');
        }
        return result;
      });
      return {
        enabled: boolean(value.enabled, 'コメント文字演出'),
        fontSizePx: rangeNumber(value.fontSizePx, 16, 200, '文字サイズは16～200pxで指定してください。'),
        fallDurationSeconds: rangeNumber(value.fallDurationSeconds, 1, 10, '落下時間は1～10秒で指定してください。'),
        maxActiveItems: rangeInteger(value.maxActiveItems, 1, 30, '画面内上限は1～30個で指定してください。'),
        rules,
      } satisfies TextEffectsSettings as AppSettings[K];
    }
  }
}

function optionalDesign<T extends 'comments' | 'speech'>(target: T, value: unknown) {
  if (value === undefined) return {};
  try { return { design: validateObsDesign(target, value) }; }
  catch (error) { throw new ValidationError(error instanceof Error ? error.message : 'デザインを確認してください。'); }
}

function optionalSavedDesigns(value: unknown) {
  if (value === undefined) return {};
  try { return { obsSavedDesigns: validateSavedObsDesigns(value) }; }
  catch (error) { throw new ValidationError(error instanceof Error ? error.message : '保存したデザインを確認してください。'); }
}

export function validateSimpleCharacterMotionSettings(
  input: unknown,
): SimpleCharacterMotionSettings {
  const value = record(input, '簡易キャラクターの微動設定');
  return {
    enabled: boolean(value.enabled, '簡易キャラクターの微動'),
    verticalAmplitudePercent: tenthRangeNumber(
      value.verticalAmplitudePercent,
      0,
      5,
      '上下移動は0～5%で指定してください。',
    ),
    verticalPeriodSeconds: tenthRangeNumber(
      value.verticalPeriodSeconds,
      1,
      20,
      '上下一往復は1～20秒で指定してください。',
    ),
    tiltAmplitudeDegrees: tenthRangeNumber(
      value.tiltAmplitudeDegrees,
      0,
      5,
      '左右の傾きは0～5度で指定してください。',
    ),
    tiltPeriodSeconds: tenthRangeNumber(
      value.tiltPeriodSeconds,
      1,
      20,
      '傾き一往復は1～20秒で指定してください。',
    ),
    breathingAmplitudePercent: tenthRangeNumber(
      value.breathingAmplitudePercent,
      0,
      5,
      '呼吸の縦伸縮は0～5%で指定してください。',
    ),
    breathingPeriodSeconds: tenthRangeNumber(
      value.breathingPeriodSeconds,
      1,
      20,
      '呼吸一往復は1～20秒で指定してください。',
    ),
  };
}

export const defaultCommentListSettings: CommentListSettings = {
  showSource: true,
  showAuthor: true,
  showContent: true,
  stackDirection: 'newestBottom',
  fontFamily: 'Yu Gothic UI',
  fontSizePx: 16,
  textColor: '#edf0ffff',
  backgroundColor: '#131524ff',
};

export const defaultCommentSpeechSettings: CommentSpeechSettings = {
  enabled: false,
  readSource: false,
  readAuthor: true,
  maxTextLength: 100,
  voice: null,
  speedScale: 1,
  pitchScale: 0,
  intonationScale: 1,
  volumeScale: 1,
};

export const defaultMobileSpeechSettings: MobileSpeechSettings = {
  lanEnabled: false,
  tailscaleEnabled: false,
  bitrateKbps: 64,
};

export const defaultSpeechRecognitionSettings: SpeechRecognitionSettings = {
  inputSource: 'microphone',
  smartphoneDeviceId: null,
  enabled: false,
  microphoneId: null,
  vadThreshold: 0.3,
  minSpeechDurationSeconds: 0.25,
  minSilenceDurationSeconds: 0.5,
  maxSpeechDurationSeconds: 30,
  preRollDurationSeconds: 0.3,
  postRollDurationSeconds: 0,
};

function invalidSpeechInput(): never { throw new ValidationError('音声認識の入力種別が正しくありません。'); }

export const defaultTextEffectsSettings: TextEffectsSettings = {
  enabled: true,
  fontSizePx: 64,
  fallDurationSeconds: 3,
  maxActiveItems: 30,
  rules: [{
    id: 'default-grass',
    enabled: true,
    trigger: 'w',
    displayText: '草',
    color: '#66cc66ff',
    countMode: 'consecutive',
    minimumConsecutiveCount: 2,
  }, {
    id: 'default-clap',
    enabled: true,
    trigger: '8888',
    displayText: '👏',
    color: '#ffd782ff',
    countMode: 'fixed',
    fixedCount: 6,
  }, {
    id: 'default-celebrate',
    enabled: false,
    trigger: 'おめでとう',
    displayText: '🎉',
    color: '#ffb8daff',
    countMode: 'fixed',
    fixedCount: 8,
  }],
};

export const defaultShitarabaNextThreadSettings: ShitarabaNextThreadSettings = {
  enabled: false,
  createAtResponseNumber: 980,
  switchAtResponseNumber: 1000,
  titleMode: 'auto',
  manualTitle: '',
  bodyMode: 'auto',
  manualBody: '',
  announceCurrentThread: false,
  announcementTemplate: '次スレッドはこちらです。\n{url}',
  authorName: '',
  email: '',
};

function requireVisibleField(value: CommentListSettings): void {
  if (!value.showSource && !value.showAuthor && !value.showContent) {
    throw new ValidationError('表示項目を少なくとも1項目選択してください。');
  }
}

function graphemeString(value: unknown, label: string, minimum: number, maximum: number): string {
  const result = typeof value === 'string' ? value.trim() : fail(`${label}が正しくありません。`);
  const length = graphemes(result).length;
  if (length < minimum || length > maximum) {
    throw new ValidationError(`${label}は${minimum}～${maximum}文字で指定してください。`);
  }
  return result;
}

function validateShitarabaNextThreadSettings(value: unknown): ShitarabaNextThreadSettings {
  const input = record(value, '次スレッド設定');
  const createAtResponseNumber = rangeInteger(
    input.createAtResponseNumber,
    1,
    10_000,
    '作成開始レス番号は1～10000で指定してください。',
  );
  const switchAtResponseNumber = rangeInteger(
    input.switchAtResponseNumber,
    1,
    10_000,
    '切替レス番号は1～10000で指定してください。',
  );
  if (createAtResponseNumber > switchAtResponseNumber) {
    throw new ValidationError('作成開始レス番号は切替レス番号以下にしてください。');
  }
  const announcementTemplate = string(
    input.announcementTemplate,
    '案内文テンプレート',
    100_000,
  );
  if ((announcementTemplate.match(/\{url\}/g) ?? []).length !== 1) {
    throw new ValidationError('案内文テンプレートに{url}を1回だけ含めてください。');
  }
  const authorName = string(input.authorName, '投稿者名', 100_000);
  const email = string(input.email, 'E-mail', 100_000);
  if (authorName.includes('#')) {
    throw new ValidationError('投稿者名に#は使用できません。');
  }
  return {
    enabled: boolean(input.enabled, '次スレッド自動作成'),
    createAtResponseNumber,
    switchAtResponseNumber,
    titleMode:
      input.titleMode === 'auto' || input.titleMode === 'manual'
        ? input.titleMode
        : fail('タイトルモードが正しくありません。'),
    manualTitle: string(input.manualTitle, '手動タイトル', 100_000),
    bodyMode:
      input.bodyMode === 'auto' || input.bodyMode === 'manual'
        ? input.bodyMode
        : fail('本文モードが正しくありません。'),
    manualBody: string(input.manualBody, '手動本文', 1_000_000),
    announceCurrentThread: boolean(input.announceCurrentThread, '現行スレッドへのURL案内'),
    announcementTemplate,
    authorName,
    email,
  };
}

function windowBounds(value: unknown, label: string): WindowBounds {
  const input = record(value, `${label}のウィンドウ位置`);
  const width = rangeNumber(input.width, 200, 10_000, `${label}の幅が正しくありません。`);
  const height = rangeNumber(input.height, 120, 10_000, `${label}の高さが正しくありません。`);
  const result: WindowBounds = { width, height };
  if (input.x !== undefined) result.x = integer(input.x, `${label}のX位置`);
  if (input.y !== undefined) result.y = integer(input.y, `${label}のY位置`);
  if (input.maximized !== undefined) {
    result.maximized = boolean(input.maximized, `${label}の最大化状態`);
  }
  return result;
}

function color(value: unknown, label: string): string {
  const result = string(value, label, 9);
  if (!/^#[\da-fA-F]{8}$/.test(result)) {
    throw new ValidationError(`${label}は#RRGGBBAA形式で指定してください。`);
  }
  return result.toLowerCase();
}

function rangeNumber(
  value: unknown,
  min: number,
  max: number,
  message: string,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new ValidationError(message);
  }
  return value;
}

function tenthRangeNumber(value: unknown, min: number, max: number, message: string): number {
  const result = rangeNumber(value, min, max, message);
  if (Math.abs(result * 10 - Math.round(result * 10)) > 1e-8) {
    throw new ValidationError(`${message.replace(/。$/u, '')}。値は0.1刻みで指定してください。`);
  }
  return result;
}

function exclusiveRangeNumber(
  value: unknown,
  min: number,
  max: number,
  message: string,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= min || value >= max) {
    throw new ValidationError(message);
  }
  return value;
}

function integer(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ValidationError(`${label}は整数で指定してください。`);
  }
  return value;
}

function rangeInteger(value: unknown, min: number, max: number, message: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new ValidationError(message);
  }
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ValidationError(`${label}が正しくありません。`);
  }
  return value;
}



function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return string(value, label, 500);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ValidationError(`${label}が正しくありません。`);
  }
  return value;
}


function fail(message: string): never {
  throw new ValidationError(message);
}
