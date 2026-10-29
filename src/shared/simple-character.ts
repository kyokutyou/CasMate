import type { SimpleCharacterMotionSettings } from './types';

export const defaultSimpleCharacterMotionSettings: SimpleCharacterMotionSettings = {
  enabled: true,
  verticalAmplitudePercent: 0.5,
  verticalPeriodSeconds: 3.6,
  tiltAmplitudeDegrees: 0.4,
  tiltPeriodSeconds: 5.2,
  breathingAmplitudePercent: 1,
  breathingPeriodSeconds: 3.2,
};
