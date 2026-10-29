import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ManagementHistoryBridge, ManagementHistoryDirection } from '../shared/management-history';
import type { SetupPosition } from '../shared/initial-setup';
import type { ManagementEditor, ManagementPage } from './management-navigation';

declare global { interface Window { casmateNavigation?: ManagementHistoryBridge } }
export interface ManagementVisit {
  page: ManagementPage;
  editor: ManagementEditor | null;
  setup: boolean;
  position?: SetupPosition;
  origin: { page: ManagementPage; top: number; entry: string } | null;
  focus: { id: string; element?: HTMLElement; top: number };
}
const locationKey = (visit: Pick<ManagementVisit, 'page' | 'editor' | 'setup' | 'position'>) => JSON.stringify([visit.page, visit.editor, visit.setup, visit.position]);

export function useManagementHistory(options: {
  capture(): ManagementVisit;
  restore(visit: ManagementVisit, isCurrent: () => boolean): Promise<boolean>;
  canRestore(visit: ManagementVisit): boolean;
  blocked: boolean;
  focusRestored(): void;
}) {
  const entries = useRef<ManagementVisit[]>([]);
  const index = useRef(-1);
  const moving = useRef(false);
  const restored = useRef(false);
  const generation = useRef(0);
  const pendingGeneration = useRef(0);
  const [, setRevision] = useState(0);
  const moveRef = useRef<(direction: ManagementHistoryDirection) => Promise<void>>(async () => {});
  const remember = () => { if (index.current >= 0) entries.current[index.current] = options.capture(); };
  useLayoutEffect(() => {
    if (moving.current && pendingGeneration.current === generation.current) return;
    if (restored.current) {
      options.focusRestored();
      restored.current = false;
      remember();
      return;
    }
    const visit = options.capture();
    if (index.current >= 0 && locationKey(entries.current[index.current]) === locationKey(visit)) return;
    entries.current = [...entries.current.slice(0, index.current + 1), visit];
    index.current = entries.current.length - 1;
  });
  useLayoutEffect(() => {
    moveRef.current = async direction => {
      if (moving.current || options.blocked || document.querySelector('dialog[open]')) return;
      const delta = direction === 'back' ? -1 : 1;
      let target = index.current + delta;
      while (entries.current[target] && !options.canRestore(entries.current[target])) target += delta;
      const visit = entries.current[target];
      if (!visit) return;
      remember(); moving.current = true;
      const currentGeneration = ++generation.current;
      pendingGeneration.current = currentGeneration;
      const isCurrent = () => generation.current === currentGeneration;
      try {
        if (await options.restore(visit, isCurrent) && isCurrent()) { index.current = target; restored.current = true; }
      } finally { moving.current = false; setRevision(value => value + 1); }
    };
  });
  useEffect(() => {
    const bridge = window.casmateNavigation;
    let unmatched: { direction: ManagementHistoryDirection; source: 'native' | 'mouse'; at: number }[] = [];
    const navigate = (direction: ManagementHistoryDirection, source: 'native' | 'mouse') => {
      const at = performance.now();
      // A driver may report one click through both paths. Pair opposite sources,
      // while allowing consecutive clicks from the same source without a delay.
      unmatched = unmatched.filter(input => at - input.at < 100);
      const paired = unmatched.findIndex(input => input.direction === direction && input.source !== source);
      if (paired !== -1) {
        unmatched.splice(paired, 1);
        return;
      }
      unmatched.push({ direction, source, at });
      void moveRef.current(direction);
    };
    const unsubscribe = bridge?.subscribe(direction => { navigate(direction, 'native'); });
    const preventNative = (event: MouseEvent) => { if (event.button === 3 || event.button === 4) event.preventDefault(); };
    const mouse = (event: MouseEvent) => {
      preventNative(event);
      if (event.button === 3 || event.button === 4) navigate(event.button === 3 ? 'back' : 'forward', 'mouse');
    };
    window.addEventListener('mousedown', preventNative, true);
    window.addEventListener('mouseup', mouse, true);
    window.addEventListener('auxclick', preventNative, true);
    return () => {
      unsubscribe?.();
      window.removeEventListener('mousedown', preventNative, true);
      window.removeEventListener('mouseup', mouse, true);
      window.removeEventListener('auxclick', preventNative, true);
    };
  }, []);
  return { remember,
    cancel: () => { generation.current++; restored.current = false; },
    isRestoring: () => moving.current && pendingGeneration.current === generation.current || restored.current };
}
