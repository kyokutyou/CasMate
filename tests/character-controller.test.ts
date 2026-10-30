import { describe, expect, it, vi } from 'vitest';
import {
  CharacterController,
  defaultCharacterSettings,
} from '../src/main/core/character-controller';

function characterSettings(
  change: Partial<typeof defaultCharacterSettings.simple> = {},
) {
  return {
    ...defaultCharacterSettings,
    simple: {
      ...defaultCharacterSettings.simple,
      ...change,
      motion: {
        ...defaultCharacterSettings.simple.motion,
        ...change.motion,
      },
    },
  };
}

describe('簡易キャラクター状態', () => {
  it('口開き素材がなくても読み上げ中の口形を同期し古い通知を捨てる', () => {
    const controller = new CharacterController(characterSettings({ closedAsset: '/closed.png', openAsset: null }));

    controller.startSpeech('comment-1');
    controller.applyMouthShape('comment-1', 'open');
    expect(controller.snapshot().mouthShape).toBe('open');

    controller.applyMouthShape('old-comment', 'closed');
    expect(controller.snapshot().mouthShape).toBe('open');

    controller.stopSpeech('comment-1');
    expect(controller.snapshot().mouthShape).toBe('closed');
  });

  it('有効な閉口素材で開始時刻を作り設定変更では維持する', () => {
    const now = vi.fn(() => 1_000);
    const controller = new CharacterController(
      characterSettings({ closedAsset: '/closed.png' }),
      () => undefined,
      now,
    );
    expect(controller.snapshot().motionStartedAtMs).toBe(1_000);

    controller.updateSettings(characterSettings({
      closedAsset: '/closed.png',
      motion: { ...defaultCharacterSettings.simple.motion, verticalAmplitudePercent: 2 },
    }));
    expect(controller.snapshot().motionStartedAtMs).toBe(1_000);
    expect(now).toHaveBeenCalledOnce();
  });

  it('微動を再度オンにした時だけ新しい開始時刻から再開する', () => {
    const now = vi.fn().mockReturnValueOnce(1_000).mockReturnValueOnce(2_000);
    const enabled = characterSettings({ closedAsset: '/closed.png' });
    const controller = new CharacterController(enabled, () => undefined, now);

    controller.updateSettings(characterSettings({
      closedAsset: '/closed.png',
      motion: { ...enabled.simple.motion, enabled: false },
    }));
    expect(controller.snapshot().motionStartedAtMs).toBeNull();

    controller.updateSettings(enabled);
    expect(controller.snapshot().motionStartedAtMs).toBe(2_000);
  });

  it('閉口素材がない間は微動を開始しない', () => {
    const controller = new CharacterController(characterSettings({ closedAsset: null, openAsset: null }));
    expect(controller.snapshot().motionStartedAtMs).toBeNull();
  });

  it('一時プレビューは保存設定を書き換えず開始時刻を維持する', () => {
    const controller = new CharacterController(characterSettings({ closedAsset: '/closed.png' }), () => undefined, () => 1_000);
    controller.previewMotion({
      ...defaultCharacterSettings.simple.motion,
      verticalAmplitudePercent: 2.5,
    });

    expect(controller.snapshot().motion.verticalAmplitudePercent).toBe(2.5);
    expect(controller.snapshot().motionStartedAtMs).toBe(1_000);
    expect(controller.getSettings().simple.motion.verticalAmplitudePercent).toBe(0.5);

    controller.restoreSavedMotion();
    expect(controller.snapshot().motion.verticalAmplitudePercent).toBe(0.5);
  });
});
