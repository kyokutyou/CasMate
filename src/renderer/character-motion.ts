export function verticalKeyframes(amplitudePercent: number): Keyframe[] {
  return [
    { transform: 'translateY(0%)' },
    { transform: `translateY(-${amplitudePercent}%)` },
    { transform: 'translateY(0%)' },
  ];
}

export function tiltKeyframes(amplitudeDegrees: number): Keyframe[] {
  return [
    { transform: 'rotate(0deg)' },
    { transform: `rotate(${amplitudeDegrees}deg)` },
    { transform: 'rotate(0deg)' },
    { transform: `rotate(-${amplitudeDegrees}deg)` },
    { transform: 'rotate(0deg)' },
  ];
}

export function breathingKeyframes(amplitudePercent: number): Keyframe[] {
  return [
    { transform: 'scaleY(1)' },
    { transform: `scaleY(${1 + amplitudePercent / 100})` },
    { transform: 'scaleY(1)' },
  ];
}

export function synchronizedAnimationTime(nowMs: number, startedAtMs: number, durationMs: number): number {
  return Math.max(0, nowMs - startedAtMs) % durationMs;
}
