import { describe, expect, it, vi } from 'vitest';
import { ObsCaptureCoordinator } from '../src/main/obs/obs-capture-coordinator';

describe('shared OBS physical capture slot', () => {
  it('keeps a pending physical request exclusive and gives manual retries priority', async () => {
    let now = 0; const slot = new ObsCaptureCoordinator(() => now);
    let finish!: () => void;
    const capture = slot.run('background', () => new Promise<void>(resolve => { finish = resolve; }));
    await expect(slot.run('foreground', async () => 1)).rejects.toThrow('BUSY');
    await expect(slot.run('background', async () => 1)).rejects.toThrow('BUSY');
    finish(); await capture;
    await expect(slot.run('background', async () => 1)).rejects.toThrow('BUSY');
    now = 4000;
    await expect(slot.run('foreground', async () => 2)).resolves.toBe(2);
    now = 4999; await expect(slot.run('background', async () => 3)).rejects.toThrow('BUSY');
    now = 5000; await expect(slot.run('background', async () => 3)).resolves.toBe(3);
  });
  it('allows the next background capture after a foreground capture succeeds without contention', async () => {
    const slot = new ObsCaptureCoordinator(() => 10000);
    await expect(slot.run('foreground', async () => 1)).resolves.toBe(1);
    await expect(slot.run('background', async () => 2)).resolves.toBe(2);
  });
  it.each([-60000, 60000])('measures retry priority through a %d ms system clock correction', async offset => {
    let elapsed = 10000, wall = 100000;
    const monotonicClock = vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
    const systemClock = vi.spyOn(Date, 'now').mockImplementation(() => wall);
    const slot = new ObsCaptureCoordinator();
    try {
      let finish!: () => void;
      const capture = slot.run('background', () => new Promise<void>(resolve => { finish = resolve; }));
      await expect(slot.run('foreground', async () => 1)).rejects.toThrow('BUSY');
      finish();
      await capture;
      wall += offset + 4999;
      elapsed += 4999;
      await expect(slot.run('background', async () => 2)).rejects.toThrow('BUSY');
      wall++;
      elapsed++;
      await expect(slot.run('background', async () => 3)).resolves.toBe(3);
    } finally {
      monotonicClock.mockRestore();
      systemClock.mockRestore();
    }
  });
  it('releases only its own completed failed request', async () => {
    const slot = new ObsCaptureCoordinator();
    await expect(slot.run('background', async () => { throw new Error('failed'); })).rejects.toThrow('failed');
    await expect(slot.run('background', async () => 1)).resolves.toBe(1);
  });
});
