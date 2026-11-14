import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { expect, it, vi } from 'vitest';
import { NativeReactionDesktop } from '../src/main/reactions/reaction-desktop';

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn }));
vi.mock('electron', () => ({ BrowserWindow: vi.fn(), screen: {} }));

const target = { id:'1', title:'game', processName:'game.exe', className:'Game', pid:1,
  x:0, y:0, width:640, height:360, minimized:false };

async function trackerFixture() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => child.emit('close', 0)),
  });
  spawn.mockReturnValue(child);
  const desktop = new NativeReactionDesktop('resources/reactions', () => '');
  desktop.demand(true);
  await vi.waitFor(() => expect(spawn).toHaveReturnedWith(child));
  return { child, desktop };
}

it.each(['stderr', 'broken JSON', 'incomplete window', 'oversized line'])(
  'keeps the last complete inventory through %s and invalidates on exit', async noise => {
  const { child, desktop } = await trackerFixture();
  const windows = [target];
  try {
    child.stdout.write(JSON.stringify({ windows, foreground:'1' }) + '\n');
    const lastGood = { ...desktop.inventory() };
    expect(lastGood.windows).toEqual(windows);
    expect(lastGood.observedMonotonicAt).toEqual(expect.any(Number));

    if (noise === 'stderr') child.stderr.write('diagnostic only\n');
    if (noise === 'broken JSON') child.stdout.write('broken line\n');
    if (noise === 'incomplete window') child.stdout.write(JSON.stringify({ windows:[{ id:'1' }], foreground:'0' }) + '\n');
    if (noise === 'oversized line') child.stdout.write('x'.repeat(4 * 1024 * 1024 + 1));
    expect(desktop.inventory()).toEqual(lastGood);

    child.stdout.write((noise === 'oversized line' ? 'discard this tail\n' : '') + JSON.stringify({ windows:[], foreground:'0' }) + '\n');
    expect(desktop.inventory().windows).toEqual([]);
    child.stdout.write(JSON.stringify({ windows, foreground:'1' }) + '\n');
    child.emit('close', 1);
    expect(desktop.inventory()).toEqual({ windows:[], foreground:'', observedAt:0 });
  } finally {
    await desktop.close();
  }
  });

it('withholds expired candidates without publishing a fresh empty inventory', async () => {
  const { child, desktop } = await trackerFixture();
  const now = vi.spyOn(performance, 'now');
  try {
    const snapshot = JSON.stringify({ windows:[target], foreground:'1' }) + '\n';
    now.mockReturnValue(1000);
    child.stdout.write(snapshot);
    const initial = desktop.inventory();

    now.mockReturnValue(2499);
    child.stdout.write('broken line\n');
    expect(desktop.inventory()).toEqual(initial);

    now.mockReturnValue(2500);
    expect(desktop.inventory()).toEqual({ ...initial, windows:[], foreground:'' });

    child.stdout.write(snapshot);
    expect(desktop.inventory()).toMatchObject({ windows:[target], foreground:'1', observedMonotonicAt:2500 });
  } finally {
    now.mockRestore();
    await desktop.close();
  }
});

it('accepts a complete native-sized inventory with long titles', async () => {
  const { child, desktop } = await trackerFixture();
  try {
    const title = 'あ'.repeat(1023);
    const windows = Array.from({ length:240 }, (_, index) => ({ ...target, id:String(index + 1), title }));
    const message = JSON.stringify({ windows, foreground:'1' }) + '\n';
    expect(message.length).toBeGreaterThan(262144);
    child.stdout.write(message);
    expect(desktop.inventory().windows).toHaveLength(240);
    expect(desktop.inventory().windows.at(-1)).toEqual(windows.at(-1));
  } finally {
    await desktop.close();
  }
});
