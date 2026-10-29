// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSnapshot } from '../src/shared/types';
const styles = readFileSync(resolve('src/renderer/styles.css'), 'utf8');

const mocks = vi.hoisted(() => ({
  snapshot: null as AppSnapshot | null,
  speechRecognitionOverlay: null as import('../src/shared/types').SpeechRecognitionOverlayBootstrap | null,
  textEffectsOverlay: { settings: null, trigger: null, reportError: vi.fn() } as ReturnType<typeof import('../src/renderer/api').useTextEffectsOverlay>,
}));

vi.mock('../src/renderer/api', () => ({
  useApplicationState: () => ({ snapshot: mocks.snapshot }),
  useSpeechRecognitionOverlay: () => mocks.speechRecognitionOverlay,
  useTextEffectsOverlay: () => mocks.textEffectsOverlay,
}));

// These appearance tests render the normal overlay, without a live OBS test connection.
vi.mock('../src/renderer/use-obs-display-test', () => ({ useObsDisplayTest: () => null }));

import { CharacterPage } from '../src/renderer/pages/CharacterPage';
import { CommentOverlayPage } from '../src/renderer/pages/CommentOverlayPage';
import { SpeechRecognitionOverlayPage } from '../src/renderer/pages/SpeechRecognitionOverlayPage';
import { TextEffectsOverlayPage } from '../src/renderer/pages/TextEffectsOverlayPage';

describe('OBS表示面と独立キャラクター窓の透明背景', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
  beforeEach(() => {
    cleanup();
    document.documentElement.removeAttribute('style');
    document.body.removeAttribute('style');
    document.head.innerHTML = `<style>${styles}</style>`;
    mocks.snapshot = snapshot();
    mocks.speechRecognitionOverlay = {
      state: {
        active: {
          id: 'result-1',
          text: '<script>危険</script>',
          expiresAt: new Date(Date.now() + 10_000).toISOString(),
        },
      },
      appearance: {
        fontFamily: 'Yu Gothic UI', fontSizePx: 32, textColor: '#ffffffff',
        backgroundColor: '#00000099', paddingPx: 8, borderRadiusPx: 8,
      },
    };
    mocks.textEffectsOverlay = {
      settings: snapshot().settings.textEffects,
      trigger: {
        eventId: 'event-1', occurredAt: '2026-08-29T00:00:00.000Z', seed: 'seed',
        items: [{ text: '<script>危険</script>', color: '#ffffffff' }],
      },
      reportError: vi.fn(),
    };
  });

  it('コメント表示面とキャラクター表示面の文書背景を透明にする', () => {
    render(<CommentOverlayPage />);
    expect(document.documentElement.style.background).toBe('transparent');
    expect(document.body.style.background).toBe('transparent');

    cleanup();
    render(<CharacterPage />);
    expect(document.documentElement.style.background).toBe('transparent');
    expect(document.body.style.background).toBe('transparent');
  });

  it('音声認識表示面を透明にし、認識結果を通常テキストとして描画する', () => {
    const view = render(<SpeechRecognitionOverlayPage />);
    expect(document.documentElement.style.background).toBe('transparent');
    expect(document.body.style.background).toBe('transparent');
    expect(view.getByText('<script>危険</script>')).toBeInTheDocument();
    expect(view.container.querySelector('script')).toBeNull();
  });

  it.each(['newestBottom', 'newestTop'] as const)('コメントを左上へ配置し、%s の並び順を維持する', (stackDirection) => {
    const state = snapshot();
    state.settings.commentOverlay.stackDirection = stackDirection;
    state.commentOverlay.active = [1, 2].map((number) => ({
      comment: {
        id: `comment-${number}`, externalId: `${number}`, sequence: number,
        source: 'youtube', authorName: '配信視聴者',
        content: [{ type: 'text', text: `コメント${number}` }],
        receivedAt: new Date().toISOString(), initialHistory: false,
      },
      expiresAt: new Date(Date.now() + 10_000).toISOString(),
    }));
    mocks.snapshot = state;
    const view = render(<CommentOverlayPage />);
    const main = view.getByRole('main');
    expect(getComputedStyle(main).textAlign).toBe('left');
    expect(getComputedStyle(main.lastElementChild!).marginBottom).toBe('auto');
    expect(main.textContent).toMatch(stackDirection === 'newestBottom'
      ? /コメント1.*コメント2/ : /コメント2.*コメント1/);
  });

  it('認識結果を左下へ左揃えで配置する', () => {
    const view = render(<SpeechRecognitionOverlayPage />);
    const layout = getComputedStyle(view.getByRole('main'));
    expect(layout.alignItems).toBe('flex-end');
    expect(layout.justifyContent).toBe('flex-start');
    expect(getComputedStyle(view.getByText('<script>危険</script>')).textAlign).toBe('left');
  });

  it.each(['comments', 'speech'] as const)('待機後に到着した期限切れの%sを表示しない', kind => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    mocks.snapshot!.commentOverlay.active = [];
    mocks.speechRecognitionOverlay!.state.active = null;
    const page = () => kind === 'comments' ? <CommentOverlayPage /> : <SpeechRecognitionOverlayPage />;
    const view = render(page());
    vi.setSystemTime(20_000);
    const expired = new Date(15_000).toISOString();
    if (kind === 'speech') mocks.speechRecognitionOverlay!.state.active = { id: 'late', text: '期限切れ本文', expiresAt: expired };
    else mocks.snapshot!.commentOverlay.active = [{ expiresAt: expired, comment: {
      id: 'late', externalId: 'late', sequence: 1, source: 'youtube', authorName: 'viewer',
      content: [{ type: 'text', text: '期限切れ本文' }], initialHistory: false, receivedAt: new Date(0).toISOString(),
    } }];
    view.rerender(page());
    expect(view.queryByText('期限切れ本文')).not.toBeInTheDocument();
  });

  it('文字演出の有効な期限だけを監視し、長時間利用後も完了済みタイマーを保持しない', () => {
    vi.useFakeTimers();
    const view = render(<TextEffectsOverlayPage />);
    act(() => { vi.advanceTimersByTime(10_000); });
    const clear = vi.spyOn(window, 'clearTimeout');
    for (let batch = 0; batch < 20; batch++) {
      mocks.textEffectsOverlay.trigger = { ...mocks.textEffectsOverlay.trigger!, eventId: `batch-${batch}`,
        items: Array.from({ length: 20 }, () => ({ text: '演出', color: '#ffffffff' })) };
      view.rerender(<TextEffectsOverlayPage />);
      expect(view.getAllByText('演出')).toHaveLength(20);
      expect(vi.getTimerCount()).toBe(1);
      act(() => { vi.advanceTimersByTime(10_000); });
      expect(view.queryByText('演出')).not.toBeInTheDocument();
      expect(vi.getTimerCount()).toBe(0);
    }
    clear.mockClear();
    view.unmount();
    expect(clear).not.toHaveBeenCalled();
  });

  it('時計が戻って最初の確認で期限前だった認識結果も、残り時間後に消す', () => {
    vi.useFakeTimers(); vi.setSystemTime(1000);
    mocks.speechRecognitionOverlay!.state.active = { id: 'clock', text: '時計変更の結果', expiresAt: new Date(11_000).toISOString() };
    const view = render(<SpeechRecognitionOverlayPage />);
    vi.setSystemTime(500);
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(view.getByText('時計変更の結果')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(500); });
    expect(view.queryByText('時計変更の結果')).not.toBeInTheDocument();
  });

  it('文字演出の設定変更・重複通知で既存期限を延ばさず、表示上限を維持する', () => {
    vi.useFakeTimers();
    mocks.textEffectsOverlay.settings = { ...mocks.textEffectsOverlay.settings!, fallDurationSeconds: 3, maxActiveItems: 2 };
    const view = render(<TextEffectsOverlayPage />);
    act(() => { vi.advanceTimersByTime(1000); });
    mocks.textEffectsOverlay.settings = { ...mocks.textEffectsOverlay.settings!, fallDurationSeconds: 1 };
    mocks.textEffectsOverlay.trigger = { ...mocks.textEffectsOverlay.trigger!, eventId: 'short',
      items: Array.from({ length: 3 }, () => ({ text: '短い演出', color: '#ffffffff' })) };
    view.rerender(<TextEffectsOverlayPage />);
    expect(view.getAllByText('短い演出')).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(view.queryByText('短い演出')).not.toBeInTheDocument();
    expect(view.getByText('<script>危険</script>')).toBeInTheDocument();
    mocks.textEffectsOverlay.trigger = { ...mocks.textEffectsOverlay.trigger! };
    view.rerender(<TextEffectsOverlayPage />);
    expect(view.queryByText('短い演出')).not.toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(view.queryByText('<script>危険</script>')).not.toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('文字演出表示面を透明にし、表示文字を通常テキストとして描画する', () => {
    const view = render(<TextEffectsOverlayPage />);
    expect(document.documentElement.style.background).toBe('transparent');
    expect(document.body.style.background).toBe('transparent');
    expect(view.getByText('<script>危険</script>')).toBeInTheDocument();
    expect(view.container.querySelector('script')).toBeNull();

    mocks.textEffectsOverlay = {
      ...mocks.textEffectsOverlay,
      settings: { ...mocks.textEffectsOverlay.settings!, fontSizePx: 80 },
      trigger: { ...mocks.textEffectsOverlay.trigger! },
    };
    view.rerender(<TextEffectsOverlayPage />);
    expect(view.getAllByText('<script>危険</script>')).toHaveLength(1);
  });
});

function snapshot(): AppSnapshot {
  return {
    settings: {
      schemaVersion: 12,
      application: {
        port: 3000,
        managementWindow: { width: 1180, height: 820 },
        commentListWindow: { width: 520, height: 760 },
        commentListWindowVisible: false,
      },
      sources: {
        autoConnect: false,
        youtube: { enabled: false, target: '' },
        twitch: { enabled: false, channel: '' },
        shitaraba: { enabled: false, threadUrl: '', pollIntervalSeconds: 5 },
      },
      commentOverlay: {
        mode: 'stack',
        stackDurationSeconds: 10,
        singleDurationSeconds: 10,
        stackDirection: 'newestBottom',
        showSource: true,
        showAuthor: true,
        showContent: true,
        fontFamily: 'Yu Gothic UI',
        fontSizePx: 32,
        textColor: '#ffffffff',
        backgroundColor: '#00000000',
        paddingPx: 8,
        borderRadiusPx: 8,
      },
      commentList: { showSource: true, showAuthor: true, showContent: true },
      commentFilter: { ngWords: [], asciiArtEnabled: false },
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
        alwaysOnTop: true,
        clickThrough: false,
        windowVisible: false,
        windowBounds: { width: 420, height: 520 },
        settingsWindowBounds: { width: 760, height: 760 },
      },
      commentSpeech: {
        enabled: false, readSource: false, readAuthor: false, maxTextLength: 200,
        voice: null, speedScale: 1, pitchScale: 0, intonationScale: 1, volumeScale: 1,
      },
      mobileSpeech: { lanEnabled: false, tailscaleEnabled: false, bitrateKbps: 32 },
      speechRecognition: {
        enabled: false, microphoneId: null, vadThreshold: 0.3,
        minSpeechDurationSeconds: 0.25, minSilenceDurationSeconds: 0.5,
        maxSpeechDurationSeconds: 30, preRollDurationSeconds: 0.3,
        postRollDurationSeconds: 0,
      },
      textEffects: {
        enabled: true, fontSizePx: 64, fallDurationSeconds: 3, maxActiveItems: 30,
        rules: [{ id: 'default-grass', enabled: true, trigger: 'w', displayText: '草', color: '#66cc66ff', countMode: 'consecutive', minimumConsecutiveCount: 2 }],
      },
    },
    settingsRevision: 1,
    comments: [],
    sourceStatuses: {
      youtube: { source: 'youtube', state: 'stopped', message: null, updatedAt: '' },
      twitch: { source: 'twitch', state: 'stopped', message: null, updatedAt: '' },
      shitaraba: { source: 'shitaraba', state: 'stopped', message: null, updatedAt: '' },
    },
    commentOverlay: { active: [], queue: [] },
    character: {
      mouthShape: 'closed',
      motion: {
        enabled: true,
        verticalAmplitudePercent: 0.5,
        verticalPeriodSeconds: 3.6,
        tiltAmplitudeDegrees: 0.4,
        tiltPeriodSeconds: 5.2,
        breathingAmplitudePercent: 1,
        breathingPeriodSeconds: 3.2,
      },
      motionStartedAtMs: null,
      assetWarning: null,
    },
    commentSpeech: { engineStatus: 'disabled', currentCommentId: null, queueLength: 0, droppedCount: 0, warning: null },
    mobileSpeech: { urls: [], tailscaleStatus: 'disabled', activeClient: false, currentCommentId: null, queueLength: 0, droppedCount: 0, audioAvailable: false, warning: null },
    speechRecognition: {
      status: 'disabled', modelStatus: 'missing', modelDownloadProgress: null,
      microphones: [], previewActive: false, wavSaving: false, previewHistory: [],
      sessionId: null, warning: null,
    },
    speechRecognitionOverlay: { active: null },
  };
}
