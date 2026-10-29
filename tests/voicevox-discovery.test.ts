import { afterEach, expect, it, vi } from 'vitest';
import { standardVoicevoxExecutables, voicevoxInstallLocations } from '../src/main/speech/voicevox-discovery';

const registry = vi.hoisted(() => ({
  execFile: vi.fn<(file: string, args: string[], options: object, callback: (error: Error | null, stdout: string) => void) => void>(),
}));
vi.mock('node:child_process', () => ({ execFile: registry.execFile }));
afterEach(() => { registry.execFile.mockReset(); });

it('標準探索は欠けた環境変数を除き、64ビットの重複をまとめる', () => {
  expect(standardVoicevoxExecutables({ ProgramW6432: 'C:\\Program Files', ProgramFiles: 'C:\\Program Files' }))
    .toEqual(['C:\\Program Files\\VOICEVOX\\vv-engine\\run.exe']);
  expect(standardVoicevoxExecutables({})).toEqual([]);
});

it.each([
  ['\uFEFF["D:\\\\音声ソフト\\\\VOICEVOX"]', ['D:\\音声ソフト\\VOICEVOX']],
  ['[]', []], ['null', []], ['invalid', []],
  ['[123,null,"relative/path","D:\\\\VOICEVOX"]', ['D:\\VOICEVOX']],
])('インストール情報から絶対パスだけを読み取る: %s', async (output, expected) => {
  registry.execFile.mockImplementation((_file, _args, _options, callback) => callback(null, output));
  expect(await voicevoxInstallLocations()).toEqual(expected);
  expect(registry.execFile).toHaveBeenCalledWith('powershell.exe',
    expect.arrayContaining(['-NoProfile', '-NonInteractive', '-Command']),
    expect.objectContaining({ windowsHide: true, timeout: 3000, maxBuffer: 65536 }), expect.any(Function));
});

it('インストール情報の取得失敗・期限切れでは探索候補を空で返す', async () => {
  registry.execFile.mockImplementation((_file, _args, _options, callback) => callback(new Error('timeout'), '[]'));
  expect(await voicevoxInstallLocations()).toEqual([]);
});
