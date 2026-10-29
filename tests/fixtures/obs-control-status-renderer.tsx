import { useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ObsControlPanel } from '../../src/renderer/components/ObsControlPanel';
import { managementThemeStyle } from '../../src/renderer/management-themes';
import { managementTextSizeStyle } from '../../src/renderer/management-text-sizes';
import { obsControlView } from './obs-control-view';
import type { ObsControlView } from '../../src/shared/obs-control';
import type { ManagementThemeId } from '../../src/shared/management-theme';
import type { ManagementTextSizeId } from '../../src/shared/management-text-size';
import '../../src/renderer/styles.css';

function Harness() {
  const [version, reset] = useState(0);
  const [view, setView] = useState({ ...obsControlView, connection: 'unavailable' } as ObsControlView);
  const [theme, setTheme] = useState<ManagementThemeId>('ocean');
  const [textSize, setTextSize] = useState<ManagementTextSizeId>('medium');
  const fail = useRef<((error: Error) => void) | undefined>(undefined);
  useLayoutEffect(() => {
    window.obsControlStatusHarness = { reset: () => reset(value => value + 1), fail: message => fail.current?.(new Error(message)),
      display: (patch, appearance, size) => { setView(current => ({ ...current, ...patch })); setTheme(appearance); setTextSize(size); } };
  }, []);
  return <main className="dashboard management-shell" data-management-theme={theme} data-management-text-size={textSize}
    style={{ ...managementThemeStyle(theme), ...managementTextSizeStyle(textSize), display: 'block', padding: 16 }}>
    <ObsControlPanel key={version} view={view}
      configure={async () => {}} cancel={async () => {}}
      retry={() => new Promise<void>((_resolve, reject) => { fail.current = reject; })} />
  </main>;
}

declare global {
  interface Window { obsControlStatusHarness: { reset(): void; fail(message: string): void;
    display(view: Partial<ObsControlView>, theme: ManagementThemeId, size: ManagementTextSizeId): void } }
}

createRoot(document.getElementById('root')!).render(<Harness />);
