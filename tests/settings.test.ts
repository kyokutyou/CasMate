import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createDefaultSettings,
  SettingsStore,
  UnsupportedSettingsVersionError,
  validateSettingsSection,
} from '../src/main/core/settings';

describe('アプリ設定', () => {
  it('新規コメントはタイトな付箋を使い、保存済みの外観と音声認識の初期値は保持する', async () => {
    const root = await mkdtemp(join(tmpdir(), 'casmate-sticky-default-'));
    const file = join(root, 'settings.json');
    const fresh = createDefaultSettings();
    expect(fresh.commentOverlay).toMatchObject({ fontSizePx: 36, paddingPx: 4, borderRadiusPx: 0,
      textColor: '#183b3bff', backgroundColor: '#6ed2ba73', showSource: false, showAuthor: true, showContent: true });
    expect(fresh.speechRecognitionOverlay).toMatchObject({ fontSizePx: 32, textColor: '#ffffffff',
      backgroundColor: '#00000099', paddingPx: 8, borderRadiusPx: 8 });
    const saved = { ...fresh.commentOverlay, fontSizePx: 32, textColor: '#ffffffff', backgroundColor: '#00000099',
      paddingPx: 8, borderRadiusPx: 8, showSource: true, mode: 'stack' as const };
    await new SettingsStore(file).save({ ...fresh, commentOverlay: saved });
    expect((await new SettingsStore(file).load()).settings.commentOverlay).toEqual(saved);
  });
  it('投稿者名の読み上げは新規設定でオンになり、保存済みのオン・オフを保持する', async () => {
    const root = await mkdtemp(join(tmpdir(), 'casmate-read-author-default-'));
    const file = join(root, 'settings.json');
    const store = new SettingsStore(file);
    const fresh = (await store.load()).settings;
    expect(fresh.commentSpeech.readAuthor).toBe(true);
    expect(fresh.commentSpeech.readSource).toBe(false);
    for (const readAuthor of [false, true]) {
      await store.save({ ...fresh, commentSpeech: { ...fresh.commentSpeech, readAuthor } });
      expect((await new SettingsStore(file).load()).settings.commentSpeech.readAuthor).toBe(readAuthor);
    }
  });
  it('スマホ連携のAACは新規設定で64kbpsになり、保存済みの値は保持する', async () => {
    const root = await mkdtemp(join(tmpdir(), 'casmate-aac-default-'));
    const store = new SettingsStore(join(root, 'settings.json'));
    const fresh = (await store.load()).settings;
    expect(fresh.mobileSpeech.bitrateKbps).toBe(64);
    for (const bitrateKbps of [32, 48, 64]) {
      await store.save({ ...fresh, mobileSpeech: { ...fresh.mobileSpeech, bitrateKbps } });
      expect((await new SettingsStore(join(root, 'settings.json')).load()).settings.mobileSpeech.bitrateKbps).toBe(bitrateKbps);
    }
  });
  it('新しい既定値を使い、既存の作成開始番号と読み上げ文字数は保存値を保持する', async () => {
    const root = await mkdtemp(join(tmpdir(), 'casmate-default-limits-'));
    const store = new SettingsStore(join(root, 'settings.json'));
    const fresh = (await store.load()).settings;
    expect(fresh.sources.shitaraba.nextThread.createAtResponseNumber).toBe(980);
    expect(fresh.commentSpeech.maxTextLength).toBe(100);
    expect(fresh.aiListener.maxCharacters).toBe(20);
    fresh.sources.shitaraba.nextThread.createAtResponseNumber = 950;
    fresh.commentSpeech.maxTextLength = 200;
    fresh.aiListener.maxCharacters = 60;
    await store.save(fresh);
    const loaded = (await store.load()).settings;
    expect(loaded.sources.shitaraba.nextThread.createAtResponseNumber).toBe(950);
    expect(loaded.commentSpeech.maxTextLength).toBe(200);
    expect(loaded.aiListener.maxCharacters).toBe(60);
  });
  it('管理文字サイズの3種類を復元し、既存の保存は中で補完して原本を保持する', async () => {
    const root = await mkdtemp(join(tmpdir(), 'casmate-management-text-size-'));
    for (const managementTextSize of ['small', 'medium', 'large'] as const) {
      const settings = createDefaultSettings();
      const application = validateSettingsSection('application', { ...settings.application, managementTextSize });
      const file = join(root, `${managementTextSize}.json`);
      await new SettingsStore(file).save({ ...settings, application });
      expect((await new SettingsStore(file).load()).settings.application).toMatchObject({ managementTextSize });
    }
    for (const schemaVersion of [13, 14, 15]) {
      const settings = createDefaultSettings(); settings.schemaVersion = schemaVersion;
      delete settings.application.managementTextSize;
      settings.application.managementTheme = 'ivory'; settings.application.port = 4321;
      const file = join(root, `existing-${schemaVersion}.json`); const bytes = JSON.stringify(settings);
      await writeFile(file, bytes);
      const loaded = await new SettingsStore(file).load();
      expect(loaded.settings.application).toMatchObject({ managementTextSize:'medium', managementTheme:'ivory', port:4321 });
      expect(await readFile(loaded.compatibilityBackupPath ?? file, 'utf8')).toBe(bytes);
    }
  });
  it.each(['unknown', '16', 16, null, {}, false])('不正な管理文字サイズ %s の保存原本を保持する', async managementTextSize => {
    const root = await mkdtemp(join(tmpdir(), 'casmate-invalid-text-size-')); const file = join(root, 'settings.json');
    const bytes = JSON.stringify({ ...createDefaultSettings(), application:{ ...createDefaultSettings().application, managementTextSize } });
    await writeFile(file, bytes);
    await expect(new SettingsStore(file).load()).rejects.toThrow('管理画面の文字サイズ');
    expect(await readFile(file, 'utf8')).toBe(bytes); expect(await readdir(root)).toEqual(['settings.json']);
  });
  it('管理画面の8配色を保存・復元し、配色未指定の既存設定はオーシャンで開く', async () => {
    const root = await mkdtemp(join(tmpdir(), 'casmate-management-theme-'));
    for (const theme of ['graphite', 'midnight', 'ocean', 'burgundy', 'pearl', 'ivory', 'sakura', 'lavender'] as const) {
      const settings = createDefaultSettings();
      const file = join(root, `${theme}.json`);
      const application = validateSettingsSection('application', { ...settings.application, managementTheme: theme });
      await new SettingsStore(file).save({ ...settings, application });
      expect((await new SettingsStore(file).load()).settings.application.managementTheme).toBe(theme);
    }
    const settings = createDefaultSettings();
    expect(settings.application.managementTheme).toBe('ocean');
    delete settings.application.managementTheme;
    settings.application.port = 4321;
    const file = join(root, 'existing.json');
    const bytes = JSON.stringify(settings);
    await writeFile(file, bytes);
    expect((await new SettingsStore(file).load()).settings.application).toMatchObject({ port: 4321, managementTheme: 'ocean' });
    expect(await readFile(file, 'utf8')).toBe(bytes);
  });

  it.each(['studio', 'forest', 'twilight', 'mint', 'unknown', null, 1])('未採用・不正な管理配色 %s を受け付けない', theme => {
    expect(() => validateSettingsSection('application', { ...createDefaultSettings().application, managementTheme: theme })).toThrow('管理画面の配色');
  });
  it.each([13, 14])('配色追加前の版%sを移行し、既存値と退避原本を保持する', async schemaVersion => {
    const root = await mkdtemp(join(tmpdir(), 'casmate-theme-migration-'));
    const settings = createDefaultSettings(); settings.schemaVersion = schemaVersion;
    delete settings.application.managementTheme;
    settings.application.port = 4321; settings.commentList.fontSizePx = 28;
    const file = join(root, 'settings.json'); const original = JSON.stringify(settings);
    await writeFile(file, original);
    const loaded = await new SettingsStore(file).load();
    expect(loaded.settings.application).toMatchObject({ port: 4321, managementTheme: 'ocean' });
    expect(loaded.settings.commentList.fontSizePx).toBe(28);
    expect(loaded.compatibilityBackupPath).toBeDefined();
    expect(await readFile(loaded.compatibilityBackupPath!, 'utf8')).toBe(original);
  });
  it('保存済み配色が不正なら原本を維持して起動エラーにする', async () => {
    const root = await mkdtemp(join(tmpdir(), 'casmate-invalid-theme-')); const file = join(root, 'settings.json');
    const settings = createDefaultSettings(); const original = JSON.stringify({ ...settings, application: { ...settings.application, managementTheme: 'unknown' } });
    await writeFile(file, original);
    await expect(new SettingsStore(file).load()).rejects.toThrow('管理画面の配色');
    expect(await readFile(file, 'utf8')).toBe(original); expect(await readdir(root)).toEqual(['settings.json']);
  });
  it('新しいバージョンの設定は書き換えず起動エラーにする', async () => {
    const root = await mkdtemp(join(tmpdir(), 'casmate-future-settings-'));
    const file = join(root, 'settings.json');
    const content = JSON.stringify({ ...createDefaultSettings(), schemaVersion: 999 });
    await writeFile(file, content);

    await expect(new SettingsStore(file).load()).rejects.toBeInstanceOf(UnsupportedSettingsVersionError);
    expect(await readFile(file, 'utf8')).toBe(content);
    expect(await readdir(root)).toEqual(['settings.json']);
  });
  it('保存済みの文字演出ルールへ既定ルールを再追加しない', async () => {
    const root = await mkdtemp(join(tmpdir(), 'casmate-text-effects-default-'));
    for (const schemaVersion of [13, 14, 15]) {
      for (const empty of [false, true]) {
        const settings = createDefaultSettings(); settings.schemaVersion = schemaVersion;
        settings.textEffects.rules = empty ? [] : [{ ...settings.textEffects.rules[0], trigger: 'a', displayText: '葉' }];
        const file = join(root, `v${schemaVersion}-${empty}.json`);
        await writeFile(file, JSON.stringify(settings));
        expect((await new SettingsStore(file).load()).settings.textEffects).toEqual(settings.textEffects);
      }
    }
  });
  it('新規OBS設定は1件表示で、保存済みの積み上げは現行版で維持する', async () => {
    const root = await mkdtemp(join(tmpdir(), 'casmate-overlay-default-'));
    const fresh = await new SettingsStore(join(root, 'new.json')).load();
    expect(fresh.settings.commentOverlay.mode).toBe('single');
    for (const schemaVersion of [13, 14, 15]) {
      const settings = createDefaultSettings(); settings.schemaVersion = schemaVersion;
      settings.commentOverlay.mode = 'stack';
      const path = join(root, `v${schemaVersion}.json`);
      await writeFile(path, JSON.stringify(settings));
      expect((await new SettingsStore(path).load()).settings.commentOverlay.mode).toBe('stack');
    }
  });
  it('簡易キャラクター表示のv12既定値を生成する', () => {
    expect(createDefaultSettings()).toMatchObject({
      schemaVersion: 16,
      aiListener: { contextCharacters: 3000, model: 'gemini-3.1-flash-lite' },
      character: {
        mode: 'simple',
        simple: {
          closedAsset: null,
          openAsset: null,
          motion: {
            enabled: true,
            verticalAmplitudePercent: 0.5,
            verticalPeriodSeconds: 3.6,
            tiltAmplitudeDegrees: 0.4,
            tiltPeriodSeconds: 5.2,
            breathingAmplitudePercent: 1,
            breathingPeriodSeconds: 3.2,
          },
        },
        settingsWindowBounds: { width: 760, height: 760 },
      },
    });
  });

  it('仕様で定めた既定値を生成する', () => {
    const settings = createDefaultSettings();

    expect(settings).toMatchObject({
      schemaVersion: 16,
      textEffects: {
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
      },
      application: { port: 3000, commentListWindowVisible: false },
      sources: {
        autoConnect: false,
        shitaraba: {
          pollIntervalSeconds: 5,
          nextThread: {
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
          },
        },
      },
      commentOverlay: {
        mode: 'single',
        stackDurationSeconds: 10,
        singleDurationSeconds: 10,
        showSource: false,
        showAuthor: true,
        showContent: true,
      },
      commentList: {
        showSource: true,
        showAuthor: true,
        showContent: true,
        stackDirection: 'newestBottom',
        fontFamily: 'Yu Gothic UI',
        fontSizePx: 16,
        textColor: '#edf0ffff',
        backgroundColor: '#131524ff',
      },
      commentFilter: { ngWords: [], asciiArtEnabled: false },
      character: {
        mode: 'simple',
        simple: { closedAsset: null, openAsset: null },
        alwaysOnTop: true,
        clickThrough: false,
        windowVisible: false,
      },
      commentSpeech: {
        enabled: false,
        readSource: false,
        readAuthor: true,
        maxTextLength: 100,
        voice: null,
        speedScale: 1,
        pitchScale: 0,
        intonationScale: 1,
        volumeScale: 1,
      },
      mobileSpeech: { lanEnabled: false, tailscaleEnabled: false, bitrateKbps: 64 },
      speechRecognition: {
        enabled: false,
        microphoneId: null,
        vadThreshold: 0.3,
        minSpeechDurationSeconds: 0.25,
        minSilenceDurationSeconds: 0.5,
        maxSpeechDurationSeconds: 30,
        preRollDurationSeconds: 0.3,
        postRollDurationSeconds: 0,
      },
    });
  });

  it('現在版の設定を保存した次回起動でも読み込める', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'casmate-settings-current-'));
    const filePath = join(directory, 'settings.json');
    const settings = createDefaultSettings();
    settings.application.port = 4321;
    await new SettingsStore(filePath).save(settings);

    const loaded = await new SettingsStore(filePath).load();

    expect(loaded.settings).toMatchObject({
      schemaVersion: 16,
      application: { port: 4321 },
    });
    expect(loaded.warning).toBeUndefined();
  });

  it.each([13, 14])('版%sの3サービスAI設定を保持し、jpnkn初期値だけを加えて15へ移行する', async (schemaVersion) => {
    const directory = await mkdtemp(join(tmpdir(), 'casmate-settings-board-migration-'));
    const filePath = join(directory, 'settings.json');
    const expected = createDefaultSettings();
    // This legacy file predates the sticky theme; do not derive its appearance
    // from today's defaults. Migration copies these saved values to speech.
    Object.assign(expected.commentOverlay, { fontSizePx: 32, textColor: '#ffffffff',
      backgroundColor: '#00000099', paddingPx: 8, borderRadiusPx: 8, showSource: true });
    expected.application.port = 4321;
    expected.sources.shitaraba = {
      ...expected.sources.shitaraba,
      enabled: true,
      threadUrl: 'https://jbbs.shitaraba.net/bbs/read.cgi/radio/123/456/',
      pollIntervalSeconds: 7,
      nextThread: { ...expected.sources.shitaraba.nextThread, enabled: true, authorName: '配信者' },
    };
    expected.speechRecognition.microphoneId = 'saved-microphone';
    expected.speechRecognition.vadThreshold = 0.4;
    if (schemaVersion === 14) {
      expected.speechRecognition.inputSource = 'smartphone';
      expected.speechRecognition.smartphoneDeviceId = '00000000-0000-4000-8000-000000000001';
    }
    expected.aiListener = {
      ...expected.aiListener,
      waitSeconds: 123,
      contextCharacters: 4567,
      debugPromptLog: true,
      shitarabaName: '既存の投稿名',
      shitarabaEmail: 'sage',
      personas: [{ id: 'existing', name: '既存人格', personality: '親切', tone: '普通', firstPerson: '私', topics: '配信', notes: '既存の補足' }],
      participants: {
        youtube: { enabled: true, personaId: 'existing' },
        twitch: { enabled: false, personaId: 'existing' },
        shitaraba: { enabled: true, personaId: 'existing' },
        jpnkn: { enabled: false, personaId: '' },
      },
    };
    const legacy = structuredClone(expected);
    legacy.schemaVersion = schemaVersion;
    Reflect.deleteProperty(legacy.aiListener, 'jpnknName');
    Reflect.deleteProperty(legacy.aiListener, 'jpnknEmail');
    Reflect.deleteProperty(legacy.aiListener.participants, 'jpnkn');
    if (schemaVersion === 13) {
      Reflect.deleteProperty(legacy.speechRecognition, 'inputSource');
      Reflect.deleteProperty(legacy.speechRecognition, 'smartphoneDeviceId');
    }
    const voicevoxExecutablePath = 'C:\\VOICEVOX\\vv-engine\\run.exe';
    const original = JSON.stringify({ ...legacy, voicevoxExecutablePath }, null, 2) + '\n';
    await writeFile(filePath, original);

    const migrated = await new SettingsStore(filePath).load();

    expect(migrated.settings).toEqual(expected);
    expect(migrated.voicevoxExecutablePath).toBe(voicevoxExecutablePath);
    expect(migrated.compatibilityBackupPath).toBeDefined();
    expect(migrated.warning).toContain(migrated.compatibilityBackupPath);
    expect(await readFile(migrated.compatibilityBackupPath!, 'utf8')).toBe(original);
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual({ ...expected, voicevoxExecutablePath });
    const filesAfterMigration = await readdir(directory);

    const reloaded = await new SettingsStore(filePath).load();
    expect(reloaded.settings).toEqual(expected);
    expect(reloaded.voicevoxExecutablePath).toBe(voicevoxExecutablePath);
    expect(await readdir(directory)).toEqual(filesAfterMigration);
    expect(await readFile(migrated.compatibilityBackupPath!, 'utf8')).toBe(original);
  });

  it.each([
    'missingName', 'missingEmail', 'missingParticipant', 'invalidName', 'invalidEmail',
    'invalidParticipant', 'unknownPersona',
  ])('現行15のjpnkn AI設定が%sなら補完せず原本を保持して拒否する', async (invalid) => {
    const directory = await mkdtemp(join(tmpdir(), 'casmate-settings-board-invalid-'));
    const filePath = join(directory, 'settings.json');
    const settings = createDefaultSettings();
    settings.aiListener.shitarabaName = '保持する既存名';
    if (invalid === 'missingName') Reflect.deleteProperty(settings.aiListener, 'jpnknName');
    if (invalid === 'missingEmail') Reflect.deleteProperty(settings.aiListener, 'jpnknEmail');
    if (invalid === 'missingParticipant') Reflect.deleteProperty(settings.aiListener.participants, 'jpnkn');
    if (invalid === 'invalidName') Reflect.set(settings.aiListener, 'jpnknName', 123);
    if (invalid === 'invalidEmail') Reflect.set(settings.aiListener, 'jpnknEmail', null);
    if (invalid === 'invalidParticipant') Reflect.set(settings.aiListener.participants.jpnkn, 'enabled', 'true');
    if (invalid === 'unknownPersona') settings.aiListener.participants.jpnkn.personaId = 'missing';
    const original = JSON.stringify(settings, null, 2) + '\n';
    await writeFile(filePath, original);

    await expect(new SettingsStore(filePath).load()).rejects.toThrow('AIリスナー設定');
    expect(await readFile(filePath, 'utf8')).toBe(original);
    expect(await readdir(directory)).toEqual(['settings.json']);
  });

  it('配信者音声認識設定の範囲と項目間の関係を検証する', () => {
    const current = createDefaultSettings().speechRecognition;
    expect(validateSettingsSection('speechRecognition', current)).toEqual(current);
    for (const invalid of [
      { vadThreshold: 1 },
      { minSpeechDurationSeconds: 0.04 },
      { minSilenceDurationSeconds: 5.1 },
      { maxSpeechDurationSeconds: 0.25 },
      { preRollDurationSeconds: -0.1 },
      { postRollDurationSeconds: 3.1 },
    ]) {
      expect(() => validateSettingsSection('speechRecognition', {
        ...current,
        ...invalid,
      })).toThrow();
    }
  });

  it('文字演出設定の件数・文字数・個数・色を検証する', () => {
    const current = createDefaultSettings().textEffects;
    expect(validateSettingsSection('textEffects', current)).toEqual(current);
    expect(validateSettingsSection('textEffects', {
      ...current,
      rules: [{ ...current.rules[0], displayText: '👨‍👩‍👧‍👦' }],
    }).rules[0].displayText).toBe('👨‍👩‍👧‍👦');
    for (const invalid of [
      { ...current, fontSizePx: 15 },
      { ...current, fallDurationSeconds: 11 },
      { ...current, maxActiveItems: 31 },
      { ...current, rules: Array.from({ length: 51 }, (_, index) => ({ ...current.rules[0], id: `rule-${index}` })) },
      { ...current, rules: [{ ...current.rules[0], trigger: 'ww' }] },
      { ...current, rules: [{ ...current.rules[0], displayText: '草草' }] },
      { ...current, rules: [{ ...current.rules[0], color: '#00ff00' }] },
    ]) expect(() => validateSettingsSection('textEffects', invalid)).toThrow();
  });

  it('NGワードの空行と前後空白を除き正規化後の重複を統合する', () => {
    const result = validateSettingsSection('commentFilter', {
      ngWords: [' 禁止語 ', '', 'ＢＡＤ', 'bad'],
      asciiArtEnabled: true,
    });

    expect(result).toEqual({ ngWords: ['禁止語', 'ＢＡＤ'], asciiArtEnabled: true });
  });

  it('次スレッド設定の範囲と外部書き込みに影響する文字を検証する', () => {
    const current = createDefaultSettings();
    const valid = validateSettingsSection('sources', {
      ...current.sources,
      shitaraba: {
        ...current.sources.shitaraba,
        nextThread: {
          ...current.sources.shitaraba.nextThread,
          enabled: true,
          createAtResponseNumber: 900,
          switchAtResponseNumber: 990,
          announcementTemplate: '移動先: {url}',
          authorName: '配信者',
          email: 'sage#tag',
        },
      },
    });
    expect(valid.shitaraba.nextThread).toMatchObject({
      enabled: true,
      createAtResponseNumber: 900,
      switchAtResponseNumber: 990,
      email: 'sage#tag',
    });

    const invalidValues = [
      { createAtResponseNumber: 0 },
      { switchAtResponseNumber: 10_001 },
      { createAtResponseNumber: 1000, switchAtResponseNumber: 999 },
      { announcementTemplate: '移動先なし' },
      { announcementTemplate: '{url} {url}' },
      { authorName: '配信者#password' },
    ];
    for (const change of invalidValues) {
      expect(() => validateSettingsSection('sources', {
        ...current.sources,
        shitaraba: {
          ...current.sources.shitaraba,
          nextThread: { ...current.sources.shitaraba.nextThread, ...change },
        },
      })).toThrow();
    }
  });

  it('設定保存とVOICEVOXパス保存が重なっても両方を保持し内部記録を作らない', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'casmate-concurrent-settings-'));
    const filePath = join(directory, 'settings.json');
    const store = new SettingsStore(filePath);
    const staleSettings = createDefaultSettings();
    const latestSettings = structuredClone(staleSettings);
    latestSettings.sources.shitaraba.threadUrl =
      'https://jbbs.shitaraba.net/bbs/read.cgi/game/123/789/';
    await Promise.all([
      store.save(latestSettings),
      store.saveVoicevoxExecutablePath('C:\\VOICEVOX\\vv-engine\\run.exe', staleSettings),
    ]);

    const persisted = JSON.parse(await readFile(filePath, 'utf8'));
    expect(persisted).toMatchObject({
      voicevoxExecutablePath: 'C:\\VOICEVOX\\vv-engine\\run.exe',
      sources: { shitaraba: { threadUrl: latestSettings.sources.shitaraba.threadUrl } },
    });
    expect(persisted).not.toHaveProperty('internal');
  });

  it('手動指定の保存待ちに自動探索が完了しても、手動指定を上書きしない', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'casmate-discovered-settings-'));
    const store = new SettingsStore(join(directory, 'settings.json'));
    const settings = createDefaultSettings();
    const manualPath = 'D:\\manual\\vv-engine\\run.exe';
    const discoveredPath = 'C:\\VOICEVOX\\vv-engine\\run.exe';
    const manual = store.saveVoicevoxExecutablePath(manualPath, settings);
    const automatic = store.saveDiscoveredVoicevoxExecutablePath(discoveredPath, settings, undefined);
    await manual;
    expect(await automatic).toBe(false);
    expect((await new SettingsStore(join(directory, 'settings.json')).load()).voicevoxExecutablePath).toBe(manualPath);
  });

  it('削除済みの保存先を自動発見した場所へ置換し、並行する設定を保持する', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'casmate-discovered-replace-'));
    const store = new SettingsStore(join(directory, 'settings.json'));
    const settings = createDefaultSettings();
    await store.saveVoicevoxExecutablePath('C:\\old\\vv-engine\\run.exe', settings);
    const updated = structuredClone(settings);
    updated.commentSpeech.enabled = true;
    const saving = store.save(updated);
    const discovered = store.saveDiscoveredVoicevoxExecutablePath('D:\\VOICEVOX\\vv-engine\\run.exe', settings, 'C:\\old\\vv-engine\\run.exe');
    await saving;
    expect(await discovered).toBe(true);
    const loaded = await new SettingsStore(join(directory, 'settings.json')).load();
    expect(loaded.voicevoxExecutablePath).toBe('D:\\VOICEVOX\\vv-engine\\run.exe');
    expect(loaded.settings.commentSpeech.enabled).toBe(true);
  });

  it('読み上げとスマホ音声の範囲外設定を拒否する', () => {
    const current = createDefaultSettings();
    expect(() => validateSettingsSection('commentSpeech', {
      ...current.commentSpeech,
      maxTextLength: 49,
    })).toThrow('50～500');
    expect(() => validateSettingsSection('commentSpeech', {
      ...current.commentSpeech,
      speedScale: 2.1,
    })).toThrow('話速');
    expect(() => validateSettingsSection('mobileSpeech', {
      ...current.mobileSpeech,
      bitrateKbps: 129,
    })).toThrow('16～128');
  });

  it('アプリ起動時の自動接続を保存できる', () => {
    const current = createDefaultSettings();
    const sources = validateSettingsSection('sources', {
      ...current.sources,
      autoConnect: true,
    });

    expect(sources.autoConnect).toBe(true);
  });

  it('したらばの取得間隔を3～60秒で保存し不足項目を拒否する', () => {
    const current = createDefaultSettings();
    const minimum = validateSettingsSection('sources', {
      ...current.sources,
      shitaraba: { ...current.sources.shitaraba, pollIntervalSeconds: 3 },
    });
    const maximum = validateSettingsSection('sources', {
      ...current.sources,
      shitaraba: { ...current.sources.shitaraba, pollIntervalSeconds: 60 },
    });
    const legacy = structuredClone(current.sources);
    Reflect.deleteProperty(legacy.shitaraba, 'pollIntervalSeconds');

    expect(minimum.shitaraba.pollIntervalSeconds).toBe(3);
    expect(maximum.shitaraba.pollIntervalSeconds).toBe(60);
    expect(() => validateSettingsSection('sources', legacy)).toThrow();
    for (const pollIntervalSeconds of [2, 3.5, 61]) {
      expect(() => validateSettingsSection('sources', {
        ...current.sources,
        shitaraba: { ...current.sources.shitaraba, pollIntervalSeconds },
      })).toThrow('3～60秒');
    }
  });

  it('表示項目が全て非表示になる設定を拒否する', () => {
    const current = createDefaultSettings();
    expect(() =>
      validateSettingsSection('commentList', {
        ...current.commentList,
        showSource: false,
        showAuthor: false,
        showContent: false,
      }),
    ).toThrow('少なくとも1項目');
  });

  it('ポートと表示時間の仕様範囲を拒否する', () => {
    const current = createDefaultSettings();
    expect(() =>
      validateSettingsSection('application', { ...current.application, port: 80 }),
    ).toThrow('1024');
    expect(() =>
      validateSettingsSection('commentOverlay', {
        ...current.commentOverlay,
        stackDurationSeconds: 61,
      }),
    ).toThrow('1～60');
    expect(() =>
      validateSettingsSection('commentList', {
        ...current.commentList,
        fontSizePx: 201,
      }),
    ).toThrow('8～200');
  });

  it('簡易キャラクターの微動値を範囲内の0.1刻みに限定する', () => {
    const current = createDefaultSettings();
    expect(() => validateSettingsSection('character', {
      ...current.character,
      simple: {
        ...current.character.simple,
        motion: { ...current.character.simple.motion, verticalAmplitudePercent: 0.15 },
      },
    })).toThrow('0.1刻み');
  });
});
