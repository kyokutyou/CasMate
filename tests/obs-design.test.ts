import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { AppState, speechRecognitionOverlayAppearance } from '../src/main/core/app-state';
import { createDefaultSettings, validateSettingsSection } from '../src/main/core/settings';
import { readStoredSettings } from '../src/main/core/settings/stored-format';
import { createHttpApplication } from '../src/main/server/local-server';
import { readOnlyEvent, readOnlySnapshot } from '../src/main/server/local-view-projections';
import { commentDesignFromSettings, speechDesignFromSettings, validateObsDesign } from '../src/shared/obs-design';

const headers = { Host: '127.0.0.1:3000', Origin: 'http://127.0.0.1:3000', 'X-CasMate-Token': 'secret' };
describe('OBSデザインの保存と公開', () => {
  it('初回設定の文字サイズを最新デザインへ部分保存し、保存失敗・不正値では変更しない', async () => {
    const saveSettings = vi.fn(async () => undefined);
    const state = new AppState(createDefaultSettings(), { saveSettings });
    try {
      const design = commentDesignFromSettings(state.snapshot().settings.commentOverlay);
      design.style.textColor = '#123456'; design.style.paddingX = 37;
      await Promise.all([state.updateObsDesign('comments', design), state.updateObsDesign('comments', { fontSizePx: 48 }, true)]);
      expect(state.snapshot().settings.commentOverlay).toMatchObject({ fontSizePx: 48, design: { ...design, style: { ...design.style, fontSize: 48 } } });
      const before = state.snapshot().settings;
      for (const fontSizePx of [7, 201, 48.5, '48', null]) {
        await expect(state.updateObsDesign('comments', { fontSizePx }, true)).rejects.toThrow('文字サイズ');
        expect(state.snapshot().settings).toEqual(before);
      }
      saveSettings.mockRejectedValueOnce(new Error('保存失敗'));
      await expect(state.updateObsDesign('comments', { fontSizePx: 60 }, true)).rejects.toThrow('保存失敗');
      expect(state.snapshot().settings).toEqual(before);
      await state.updateObsDesign('comments', { fontSizePx: 60, showSource: true }, true);
      expect(state.snapshot().settings.commentOverlay).toMatchObject({ fontSizePx: 60, showSource: true, design: { style: { ...design.style, fontSize: 60 } } });
      await expect(state.updateObsDesign('speech', { fontSizePx: 48 }, true)).rejects.toThrow('表示設定');
    } finally { state.dispose(); }
  });
  it('文字サイズの部分保存は従来の外観も保持し、管理APIの応答へ反映する', async () => {
    const settings = createDefaultSettings(); settings.commentOverlay.paddingPx = 42;
    const state = new AppState(settings);
    const app = createHttpApplication({ state, port: 3000, operationToken: 'secret' });
    try {
      const design = commentDesignFromSettings(settings.commentOverlay);
      const response = await request(app).put('/api/obs-design/comments/options').set(headers).send({ fontSizePx: 48 });
      expect(response.status).toBe(200);
      expect(response.body.snapshot.settings.commentOverlay).toMatchObject({ fontSizePx: 48, design: { ...design, style: { ...design.style, fontSize: 48 } } });
    } finally { state.dispose(); }
  });
  it('既存の文字・背景・透明度・広い余白を保持し、開くだけでは設定を変更しない', () => {
    const settings = createDefaultSettings(); const before = structuredClone(settings);
    settings.commentOverlay.paddingPx = 64; settings.commentOverlay.textColor = '#12345678';
    const comment = commentDesignFromSettings(settings.commentOverlay);
    expect(comment).toMatchObject({ variant: 'paper', paperColors: true, style: { paddingY: 64, paddingX: 96, fontWeight: 500, textColor: '#123456' } });
    expect(comment.textOpacity).toBe(120 / 255 * 100);
    expect(validateObsDesign('comments', comment)).toEqual(comment);
    expect(speechDesignFromSettings(settings.speechRecognitionOverlay).style).toMatchObject({ fontSize: 32, fontWeight: 400, backgroundOpacity: 60, paddingX: 8, paddingY: 8 });
    expect(settings.speechRecognitionOverlay).toEqual(before.speechRecognitionOverlay);
    expect(settings.commentOverlay.design).toBeUndefined();
  });
  it('デザインを現行形式で保存・再読込し、存在する不正デザインを拒否する', () => {
    const settings = createDefaultSettings();
    settings.commentOverlay.design = commentDesignFromSettings(settings.commentOverlay);
    settings.speechRecognitionOverlay.design = speechDesignFromSettings(settings.speechRecognitionOverlay);
    settings.application.obsDesignWindow = { x: 20, y: 30, width: 1200, height: 820, maximized: true };
    expect(readStoredSettings(JSON.parse(JSON.stringify(settings))).settings).toEqual(settings);
    const bad = structuredClone(settings); bad.commentOverlay.design!.style.fontSize = 201;
    expect(() => readStoredSettings(bad)).toThrow();
    expect(() => validateObsDesign('comments', { ...settings.commentOverlay.design, css: 'body{}' })).toThrow();
    expect(() => validateObsDesign('comments', { ...settings.commentOverlay.design, textOpacity: Infinity })).toThrow();
    expect(() => validateSettingsSection('application', { ...settings.application, obsDesignWindow: { width: -1, height: 820 } })).toThrow();
  });
  it('保存中の表示時間・表示項目・両デザインを更新キューでマージし、失敗では直前設定を保つ', async () => {
    const saveSettings = vi.fn(async () => undefined);
    const state = new AppState(createDefaultSettings(), { saveSettings });
    try {
      const comment = commentDesignFromSettings(state.snapshot().settings.commentOverlay); comment.style.fontSize = 53;
      const speech = speechDesignFromSettings(state.snapshot().settings.speechRecognitionOverlay); speech.style.fontSize = 65;
      await Promise.all([state.updateObsDesign('comments', comment), state.updateObsDesign('comments', { singleDurationSeconds: 16, showSource: true }, true), state.updateObsDesign('speech', speech), state.updateObsDesign('speech', { displayDurationSeconds: 18 }, true)]);
      expect(state.snapshot().settings.commentOverlay).toMatchObject({ design: comment, singleDurationSeconds: 16, showSource: true });
      expect(state.snapshot().settings.speechRecognitionOverlay).toMatchObject({ design: speech, displayDurationSeconds: 18 });
      const before = state.snapshot().settings;
      saveSettings.mockRejectedValueOnce(new Error('保存失敗'));
      await expect(state.updateObsDesign('comments', { ...comment, textOpacity: 5 })).rejects.toThrow('保存失敗');
      expect(state.snapshot().settings).toEqual(before);
      await state.updateObsDesign('comments', { ...comment, textOpacity: 5 });
      expect(state.snapshot().settings.commentOverlay.design?.textOpacity).toBe(5);
    } finally { state.dispose(); }
  });
  it('管理認証・対象・構造を検証し、非対応・終了中を成功扱いしない', async () => {
    const state = new AppState(createDefaultSettings());
    const showObsDesign = vi.fn(async () => undefined);
    const app = createHttpApplication({ state, port: 3000, operationToken: 'secret', windowActions: { toggleCharacter: async () => undefined, toggleCommentList: async () => undefined, showCharacterSettings: async () => undefined, showObsDesign } });
    try {
      const design = commentDesignFromSettings(state.snapshot().settings.commentOverlay);
      expect((await request(app).put('/api/obs-design/comments').set('Host', headers.Host).send(design)).status).toBe(403);
      expect((await request(app).put('/api/obs-design/comments').set({ ...headers, Origin: 'https://example.com' }).send(design)).status).toBe(403);
      expect((await request(app).put('/api/obs-design/comments').set(headers).send(design)).status).toBe(200);
      expect((await request(app).put('/api/obs-design/comments').set(headers)).status).toBe(400);
      expect(state.snapshot().settings.commentOverlay.design).toEqual(design);
      expect((await request(app).put('/api/obs-design/comments/options').set(headers).send({ design })).status).toBe(400);
      expect((await request(app).put('/api/obs-design/unknown').set(headers).send(design)).status).toBe(400);
      expect((await request(app).post('/api/windows/obs-design/show').set(headers).send({ target: 'speech', extra: true })).status).toBe(400);
      expect((await request(app).post('/api/windows/obs-design/show').set(headers).send({ target: 'speech' })).status).toBe(200);
      expect(showObsDesign).toHaveBeenCalledExactlyOnceWith('speech');
      const unavailable = createHttpApplication({ state, port: 3000, operationToken: 'secret' });
      expect((await request(unavailable).post('/api/windows/obs-design/show').set(headers).send({ target: 'speech' })).status).toBe(503);
      const stopping = createHttpApplication({ state, port: 3000, operationToken: 'secret', acceptingRequests: () => false });
      expect((await request(stopping).put('/api/obs-design/speech').set(headers).send({})).status).toBe(503);
    } finally { state.dispose(); }
  });
  it('音声認識専用外観へデザインを含め、窓位置は汎用読取面から除く', () => {
    const settings = createDefaultSettings(); settings.application.obsDesignWindow = { x: 40, y: 50, width: 1200, height: 820 };
    settings.speechRecognitionOverlay.design = speechDesignFromSettings(settings.speechRecognitionOverlay);
    const state = new AppState(settings);
    try {
      expect(speechRecognitionOverlayAppearance(settings.speechRecognitionOverlay).design).toEqual(settings.speechRecognitionOverlay.design);
      const readOnly = JSON.stringify(readOnlySnapshot(state.snapshot()));
      expect(readOnly).not.toContain('obsDesignWindow'); expect(readOnly).not.toContain('speechRecognitionOverlay');
      expect(JSON.stringify(readOnlyEvent({ type: 'settings.changed', revision: 1, payload: { section: 'application', value: settings.application } }))).not.toContain('obsDesignWindow');
    } finally { state.dispose(); }
  });
  it('窓位置の部分保存は順番が来た時点の配色・ポートを保持する', async () => {
    let release!: () => void;
    const saving = new Promise<void>(resolve => { release = resolve; });
    const saveSettings = vi.fn(async () => undefined);
    saveSettings.mockImplementationOnce(() => saving);
    const settings = createDefaultSettings(); const state = new AppState(settings, { saveSettings });
    try {
      const themeSave = state.updateSettings('application', { ...settings.application, managementTheme: 'pearl', port: 4000 });
      const boundsSave = state.updateObsDesignWindowBounds({ width: 1400, height: 900 });
      release(); await Promise.all([themeSave, boundsSave]);
      expect(state.snapshot().settings.application).toMatchObject({ managementTheme: 'pearl', port: 4000, obsDesignWindow: { width: 1400, height: 900 } });
      await Promise.all([state.updateObsDesignWindowBounds({ width: 1300, height: 850 }), state.updateSettings('application', { ...settings.application, managementTheme: 'ivory' })]);
      expect(state.snapshot().settings.application).toMatchObject({ managementTheme: 'ivory', obsDesignWindow: { width: 1300, height: 850 } });
    } finally { state.dispose(); }
  });
});
