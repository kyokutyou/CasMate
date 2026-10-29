import type { WindowBounds } from '../shared/types';
export function managementWindowBounds(saved: WindowBounds): WindowBounds {
  return { ...saved, width: Math.max(320, saved.width), height: Math.max(360, saved.height) };
}

export function restoreManagementSize(window: { setSize(width: number, height: number): void; getSize(): number[] }, bounds: WindowBounds): void {
  window.setSize(bounds.width, bounds.height);
  const [width, height] = window.getSize();
  // Windows at fractional display scales can round a restored outer size upward.
  // Compensate once so saving and reopening does not grow the window each time.
  if (width > bounds.width || height > bounds.height) {
    window.setSize(Math.max(320, bounds.width - Math.max(0, width - bounds.width)),
      Math.max(360, bounds.height - Math.max(0, height - bounds.height)));
  }
}
