import type {
  CharacterSettings,
  CharacterState,
  SimpleCharacterMotionSettings,
} from '../../shared/types';
import { defaultSimpleCharacterMotionSettings } from '../../shared/simple-character';
import { defaultCharacterAssets } from '../../shared/default-character-assets';

export { defaultSimpleCharacterMotionSettings } from '../../shared/simple-character';

export const defaultCharacterSettings: CharacterSettings = {
  mode: 'simple',
  simple: {
    closedAsset: defaultCharacterAssets.closed,
    openAsset: defaultCharacterAssets.open,
    motion: { ...defaultSimpleCharacterMotionSettings },
  },
  alwaysOnTop: true,
  clickThrough: false,
  windowVisible: false,
  windowBounds: { width: 420, height: 520 },
  settingsWindowBounds: { width: 760, height: 760 },
};

export class CharacterController {
  private settings: CharacterSettings;
  private effectiveMotion: SimpleCharacterMotionSettings;
  private mouthShape: CharacterState['mouthShape'] = 'closed';
  private motionStartedAtMs: number | null = null;
  private activeSpeechCommentId: string | null = null;
  private assetWarning: string | null = null;

  constructor(
    settings: Partial<CharacterSettings> = {},
    private readonly onChange: (state: CharacterState) => void = () => undefined,
    private readonly now: () => number = Date.now,
  ) {
    this.settings = {
      ...defaultCharacterSettings,
      ...settings,
      simple: {
        ...defaultCharacterSettings.simple,
        ...settings.simple,
        motion: {
          ...defaultCharacterSettings.simple.motion,
          ...settings.simple?.motion,
        },
      },
      windowBounds: {
        ...defaultCharacterSettings.windowBounds,
        ...settings.windowBounds,
      },
      settingsWindowBounds: {
        ...defaultCharacterSettings.settingsWindowBounds,
        ...settings.settingsWindowBounds,
      },
    };
    this.effectiveMotion = { ...this.settings.simple.motion };
    if (this.settings.simple.closedAsset && this.settings.simple.motion.enabled) {
      this.motionStartedAtMs = this.now();
    }
  }

  updateSettings(next: Partial<CharacterSettings>): void {
    const wasMotionEnabled = this.effectiveMotion.enabled;
    const hadClosedAsset = Boolean(this.settings.simple.closedAsset);
    this.settings = {
      ...this.settings,
      ...next,
      simple: next.simple
        ? {
            ...this.settings.simple,
            ...next.simple,
            motion: {
              ...this.settings.simple.motion,
              ...next.simple.motion,
            },
          }
        : this.settings.simple,
      windowBounds: next.windowBounds
        ? { ...this.settings.windowBounds, ...next.windowBounds }
        : this.settings.windowBounds,
      settingsWindowBounds: next.settingsWindowBounds
        ? { ...this.settings.settingsWindowBounds, ...next.settingsWindowBounds }
        : this.settings.settingsWindowBounds,
    };
    this.effectiveMotion = { ...this.settings.simple.motion };
    if (!this.effectiveMotion.enabled || !this.settings.simple.closedAsset) {
      this.motionStartedAtMs = null;
    } else if (!wasMotionEnabled || !hadClosedAsset) {
      this.motionStartedAtMs = this.now();
    }

    this.changed();
  }

  getSettings(): CharacterSettings {
    return {
      ...this.settings,
      simple: {
        ...this.settings.simple,
        motion: { ...this.settings.simple.motion },
      },
      windowBounds: { ...this.settings.windowBounds },
      settingsWindowBounds: { ...this.settings.settingsWindowBounds },
    };
  }

  snapshot(): CharacterState {
    return {
      mouthShape: this.mouthShape,
      motion: { ...this.effectiveMotion },
      motionStartedAtMs: this.motionStartedAtMs,
      assetWarning: this.assetWarning,
    };
  }

  previewMotion(motion: SimpleCharacterMotionSettings): void {
    const wasEnabled = this.effectiveMotion.enabled;
    this.effectiveMotion = { ...motion };
    if (!motion.enabled || !this.settings.simple.closedAsset) {
      this.motionStartedAtMs = null;
    } else if (!wasEnabled || this.motionStartedAtMs === null) {
      this.motionStartedAtMs = this.now();
    }
    this.changed();
  }

  restoreSavedMotion(): void {
    this.previewMotion(this.settings.simple.motion);
  }

  startSpeech(commentId: string): void {
    this.activeSpeechCommentId = commentId;
    this.setMouthShape('closed');
  }

  applyMouthShape(commentId: string, mouthShape: CharacterState['mouthShape']): void {
    if (commentId !== this.activeSpeechCommentId) return;
    this.setMouthShape(mouthShape);
  }

  stopSpeech(commentId?: string): void {
    if (commentId && commentId !== this.activeSpeechCommentId) return;
    this.activeSpeechCommentId = null;
    this.setMouthShape('closed');
  }

  setAssetWarning(warning: string | null): void {
    this.assetWarning = warning;
    this.changed();
  }

  dispose(): void {
    this.stopSpeech();
  }

  private changed(): void {
    this.onChange(this.snapshot());
  }

  private setMouthShape(next: CharacterState['mouthShape']): void {
    if (this.mouthShape === next) return;
    this.mouthShape = next;
    this.changed();
  }
}
