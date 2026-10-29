import { useEffect, useRef, useState } from 'react';
import type { CharacterSettings, CharacterState } from '../../shared/types';
import {
  breathingKeyframes,
  synchronizedAnimationTime,
  tiltKeyframes,
  verticalKeyframes,
} from '../character-motion';

export function CharacterImage({
  mouthShape = 'closed',
  settings,
  motion = settings.simple.motion,
  motionStartedAtMs = null,
  alt = '',
  onOpenAssetError,
}: {
  mouthShape?: CharacterState['mouthShape'];
  settings: CharacterSettings;
  motion?: CharacterState['motion'];
  motionStartedAtMs?: number | null;
  alt?: string;
  onOpenAssetError?: () => void;
}) {
  const desiredClosed = settings.simple.closedAsset ?? '/placeholder.svg';
  const desiredOpen = settings.simple.openAsset;
  const [closedSource, setClosedSource] = useState(desiredClosed);
  const [openFailed, setOpenFailed] = useState(false);
  const verticalRef = useRef<HTMLSpanElement>(null);
  const tiltRef = useRef<HTMLSpanElement>(null);
  const breathingRef = useRef<HTMLSpanElement>(null);
  useEffect(() => setClosedSource(desiredClosed), [desiredClosed]);
  useEffect(() => setOpenFailed(false), [desiredOpen]);
  const hasClosedAsset = Boolean(settings.simple.closedAsset) && closedSource !== '/placeholder.svg';
  const showOpen = mouthShape === 'open' && !openFailed && hasClosedAsset;
  const canMove = motion.enabled && motionStartedAtMs !== null
    && hasClosedAsset;

  useEffect(() => {
    if (!canMove) return undefined;
    const now = Date.now();
    const definitions: Array<[HTMLElement | null, Keyframe[], number]> = [
      [verticalRef.current, verticalKeyframes(motion.verticalAmplitudePercent), motion.verticalPeriodSeconds * 1_000],
      [tiltRef.current, tiltKeyframes(motion.tiltAmplitudeDegrees), motion.tiltPeriodSeconds * 1_000],
      [breathingRef.current, breathingKeyframes(motion.breathingAmplitudePercent), motion.breathingPeriodSeconds * 1_000],
    ];
    const animations = definitions.flatMap(([element, keyframes, duration]) => {
      if (!element?.animate) return [];
      const animation = element.animate(keyframes, { duration, easing: 'ease-in-out', iterations: Infinity });
      animation.currentTime = synchronizedAnimationTime(now, motionStartedAtMs, duration);
      return [animation];
    });
    return () => animations.forEach((animation) => animation.cancel());
  }, [canMove, motion, motionStartedAtMs]);

  return (
    <span className="character-safe-area">
      <span className="character-motion-vertical" ref={verticalRef}>
        <span className="character-motion-tilt" ref={tiltRef}>
          <span className="character-motion-breathing" ref={breathingRef}>
            <span className="character-layers">
              <img
                src={closedSource}
                alt={alt}
                style={{ opacity: showOpen ? 0 : 1 }}
                onError={() => {
                  if (closedSource !== '/placeholder.svg') {
                    setClosedSource('/placeholder.svg');
                  }
                }}
              />
              <img
                src={hasClosedAsset && !openFailed ? desiredOpen ?? closedSource : closedSource}
                alt=""
                aria-hidden="true"
                style={{ opacity: showOpen ? 1 : 0 }}
                onError={() => {
                  if (!desiredOpen) return;
                  setOpenFailed(true);
                  onOpenAssetError?.();
                }}
              />
            </span>
          </span>
        </span>
      </span>
    </span>
  );
}
