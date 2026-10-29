import type { ChildProcess } from 'node:child_process';
export interface OwnedProcessIdentity { pid: number; earliest: number; latest: number; descendants: boolean }
const owned = new Map<ChildProcess, OwnedProcessIdentity>();
// Pin the native creation time inside the spawn interval of a live owned process.
export function trackOwnedProcess<T extends ChildProcess>(launch: () => T): T {
  const earliest = Date.now();
  const child = launch();
  if (child.pid !== undefined) owned.set(child, { pid: child.pid, earliest, latest: Date.now() + 1, descendants: true });
  const remove = () => owned.delete(child);
  child.once('exit', remove); child.once('error', remove);
  return child;
}
export function ownedProcessIdentities(): OwnedProcessIdentity[] { return [...owned.values()]; }
