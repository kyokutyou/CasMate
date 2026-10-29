import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { TextEffectItem } from '../../shared/types';
import { useTextEffectsOverlay } from '../api';
import { useObsDisplayTest } from '../use-obs-display-test';

interface ActiveItem extends TextEffectItem {
  id: string;
  left: number;
  sway: number;
  rotation: number;
  expiresAt: number;
}

export function TextEffectsOverlayPage() {
  const { settings, trigger, reportError } = useTextEffectsOverlay();
  const test = useObsDisplayTest('effects');
  const [active, setActive] = useState<ActiveItem[]>([]);
  const settingsRef = useRef(settings);
  const processedIds = useRef(new Set<string>());
  const processedOrder = useRef<string[]>([]);

  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    return () => {
      document.documentElement.style.background = '';
      document.body.style.background = '';
    };
  }, []);

  useEffect(() => { settingsRef.current = settings; }, [settings]);

  useEffect(() => {
    const currentSettings = settingsRef.current;
    if (!currentSettings || !trigger || processedIds.current.has(trigger.eventId)) return;
    processedIds.current.add(trigger.eventId);
    processedOrder.current.push(trigger.eventId);
    if (processedOrder.current.length > 1_000) {
      const oldest = processedOrder.current.shift();
      if (oldest) processedIds.current.delete(oldest);
    }
    const expiresAt = Date.now() + currentSettings.fallDurationSeconds * 1_000;
    setActive((current) => {
      const room = Math.max(0, currentSettings.maxActiveItems - current.length);
      const added = trigger.items.slice(0, room).map((item, index) => {
        const random = seededNumbers(`${trigger.seed}:${index}`);
        return {
          ...item,
          id: `${trigger.eventId}:${index}`,
          left: 5 + random[0] * 90,
          sway: 30 + random[1] * 90,
          rotation: -180 + random[2] * 360,
          expiresAt,
        };
      });
      return [...current, ...added];
    });
  }, [trigger]);

  useEffect(() => {
    const handleError = () => reportError();
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, [reportError]);

  useEffect(() => {
    if (active.length === 0) return;
    const expiry = Math.min(...active.map(item => item.expiresAt));
    const timer = window.setTimeout(() => {
      const now = Date.now();
      setActive(items => items.filter(item => item.expiresAt > now));
    }, Math.max(0, expiry - Date.now()));
    return () => window.clearTimeout(timer);
  }, [active]);

  if (!settings) return <div className="text-effects-overlay" aria-hidden="true" />;
  const appearance = test?.data.kind === 'effects' ? test.data.appearance : settings;
  const samples: ActiveItem[] = test ? [0, 1, 2].map(index => ({ id: `${test.testId}:${index}`, text: 'テスト', color: '#ffffff', left: 25 + index * 25, sway: 45, rotation: 90, expiresAt: test.expiresAt })) : [];
  return <><div className="text-effects-overlay" aria-label="コメント文字演出" style={{ visibility: test ? 'hidden' : undefined }}>
    {active.map((item) => <span
      className="text-effect-item"
      key={item.id}
      style={{
        color: item.color,
        fontSize: `${settings.fontSizePx}px`,
        left: `${item.left}%`,
        animationDuration: `${settings.fallDurationSeconds}s`,
        '--text-effect-sway': `${item.sway}px`,
        '--text-effect-rotation': `${item.rotation}deg`,
      } as CSSProperties}
    >{item.text}</span>)}
  </div><div className="text-effects-overlay" aria-label="OBS文字演出テスト" style={{ position: 'absolute', inset: 0 }}>
    {samples.map(item => <span key={item.id} className="text-effect-item" style={{ color: item.color,
      fontSize: `${appearance.fontSizePx}px`, left: `${item.left}%`, animationDuration: `${appearance.fallDurationSeconds}s`,
      animationDelay: `${-test!.elapsed / 1000}s`, animationPlayState: 'paused', '--text-effect-sway': `${item.sway}px`, '--text-effect-rotation': `${item.rotation}deg`,
    } as CSSProperties}>{item.text}</span>)}
  </div></>;
}

function seededNumbers(seed: string): [number, number, number] {
  let state = 2166136261;
  for (const character of seed) state = Math.imul(state ^ character.charCodeAt(0), 16777619);
  const next = () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  return [next(), next(), next()];
}
