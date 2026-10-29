import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoicevoxAdapter } from '../src/main/speech/voicevox-adapter';
import { createDefaultSettings } from '../src/main/core/settings';

describe('VOICEVOX Engine境界', () => {
  afterEach(() => vi.unstubAllEnvs());

  function discoveryFixture(found: string | null) {
    vi.stubEnv('LOCALAPPDATA', 'C:\\Users\\tester\\AppData\\Local');
    vi.stubEnv('ProgramW6432', 'C:\\Program Files');
    vi.stubEnv('ProgramFiles', 'C:\\Program Files');
    vi.stubEnv('ProgramFiles(x86)', 'C:\\Program Files (x86)');
    const exists = vi.fn(async (path: string) => path === found);
    const fetch = vi.fn().mockRejectedValueOnce(new Error('not ready')).mockResolvedValue(new Response('"1"'));
    const kill = vi.fn(() => true);
    const spawn = vi.fn(() => ({ kill }));
    const onExecutableDiscovered = vi.fn(async () => {});
    const installLocations = vi.fn(async () => ['D:\\音声ソフト\\VOICEVOX']);
    return { exists, fetch, kill, spawn, onExecutableDiscovered, installLocations };
  }

  it.each([
    'C:\\Users\\tester\\AppData\\Local\\Programs\\VOICEVOX\\vv-engine\\run.exe',
    'C:\\Program Files\\VOICEVOX\\vv-engine\\run.exe',
    'C:\\Program Files (x86)\\VOICEVOX\\vv-engine\\run.exe',
    'D:\\音声ソフト\\VOICEVOX\\vv-engine\\run.exe',
  ])('自動探索したEngineを起動確認後に保存する: %s', async path => {
    const deps = discoveryFixture(path);
    deps.spawn.mockImplementation(() => {
      expect(deps.onExecutableDiscovered).not.toHaveBeenCalled();
      return { kill: deps.kill };
    });
    const adapter = new VoicevoxAdapter(deps);
    await adapter.prepare();
    expect(deps.spawn).toHaveBeenCalledWith(path, ['--host', '127.0.0.1', '--port', '50021']);
    expect(deps.onExecutableDiscovered).toHaveBeenCalledExactlyOnceWith(path, undefined);
    expect(deps.installLocations).toHaveBeenCalledTimes(path.startsWith('D:') ? 1 : 0);
    await adapter.shutdown();
    expect(deps.kill).toHaveBeenCalledOnce();
  });

  it('保存済みの場所を最優先し、自動探索や再保存をしない', async () => {
    const path = 'E:\\VOICEVOX\\vv-engine\\run.exe';
    const deps = discoveryFixture(path);
    const adapter = new VoicevoxAdapter({ ...deps, executablePath: path });
    await adapter.prepare();
    expect(deps.exists).toHaveBeenCalledExactlyOnceWith(path);
    expect(deps.installLocations).not.toHaveBeenCalled();
    expect(deps.onExecutableDiscovered).not.toHaveBeenCalled();
    await adapter.shutdown();
  });

  it('保存先がなくなった場合は再探索する', async () => {
    const path = 'D:\\音声ソフト\\VOICEVOX\\vv-engine\\run.exe';
    const deps = discoveryFixture(path);
    const adapter = new VoicevoxAdapter({ ...deps, executablePath: 'E:\\deleted\\vv-engine\\run.exe' });
    await adapter.prepare();
    expect(deps.onExecutableDiscovered).toHaveBeenCalledExactlyOnceWith(path, 'E:\\deleted\\vv-engine\\run.exe');
    await adapter.shutdown();
  });

  it('未導入・インストール情報取得不能でも起動や保存を行わない', async () => {
    const deps = discoveryFixture(null);
    deps.installLocations.mockRejectedValue(new Error('access denied'));
    const adapter = new VoicevoxAdapter(deps);
    await expect(adapter.prepare()).rejects.toThrow('VOICEVOX Engineが見つかりません。');
    expect(deps.spawn).not.toHaveBeenCalled();
    expect(deps.onExecutableDiscovered).not.toHaveBeenCalled();
    expect(deps.exists).toHaveBeenCalledTimes(3);
  });

  it('自動発見しても起動失敗したEngineは保存しない', async () => {
    const deps = discoveryFixture('D:\\音声ソフト\\VOICEVOX\\vv-engine\\run.exe');
    deps.spawn.mockImplementation(() => { throw new Error('bad executable'); });
    const adapter = new VoicevoxAdapter(deps);
    await expect(adapter.prepare()).rejects.toThrow('VOICEVOX Engineを起動できませんでした。');
    expect(deps.onExecutableDiscovered).not.toHaveBeenCalled();
  });

  it('自動設定の保存失敗では所有プロセスを停止し、再試行で保存する', async () => {
    const path = 'D:\\音声ソフト\\VOICEVOX\\vv-engine\\run.exe';
    const deps = discoveryFixture(path);
    deps.onExecutableDiscovered.mockRejectedValueOnce(new Error('disk full'));
    const adapter = new VoicevoxAdapter(deps);
    await expect(adapter.prepare()).rejects.toThrow();
    expect(deps.kill).toHaveBeenCalledOnce();
    deps.fetch.mockRejectedValueOnce(new Error('not ready'));
    await adapter.prepare();
    expect(deps.onExecutableDiscovered).toHaveBeenCalledTimes(2);
    await adapter.shutdown();
  });

  it('インストール情報の照会中に終了した場合は起動や保存をしない', async () => {
    const deps = discoveryFixture(null);
    let finish!: (paths: string[]) => void;
    deps.installLocations.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const adapter = new VoicevoxAdapter(deps);
    const preparing = adapter.prepare();
    await vi.waitFor(() => expect(deps.installLocations).toHaveBeenCalledOnce());
    await adapter.shutdown();
    finish(['D:\\VOICEVOX']);
    await expect(preparing).rejects.toThrow();
    expect(deps.spawn).not.toHaveBeenCalled();
    expect(deps.onExecutableDiscovered).not.toHaveBeenCalled();
  });

  it('自動保存を見送った場合は、後から設定された手動の場所を維持する', async () => {
    const path = 'D:\\音声ソフト\\VOICEVOX\\vv-engine\\run.exe';
    const manual = 'E:\\manual\\vv-engine\\run.exe';
    const deps = discoveryFixture(path);
    deps.exists.mockImplementation(async candidate => candidate === path || candidate === manual);
    let fail!: (error: Error) => void;
    const spawn = vi.fn(() => ({ kill: deps.kill, once: (_event: 'error', listener: (error: Error) => void) => { fail = listener; } }));
    const adapter = new VoicevoxAdapter({ ...deps, spawn, onExecutableDiscovered: async () => {
      adapter.setExecutablePath(manual);
      return false;
    } });
    await adapter.prepare();
    fail(new Error('process failed'));
    deps.fetch.mockRejectedValueOnce(new Error('not ready'));
    await expect(adapter.prepare()).rejects.toThrow();
    deps.fetch.mockRejectedValueOnce(new Error('not ready'));
    await adapter.prepare();
    expect(spawn).toHaveBeenLastCalledWith(manual, ['--host', '127.0.0.1', '--port', '50021']);
    await adapter.shutdown();
  });

  it('終了中に遅れて完了する実行ファイル検証から確認プロセスを起動しない', async () => {
    let finish!: (exists: boolean) => void;
    const exists = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    const spawn = vi.fn(() => ({ kill: vi.fn(() => true) }));
    const adapter = new VoicevoxAdapter({ exists, spawn, probePort: async () => 50123 });
    const validating = adapter.validateExecutable('C:\\VOICEVOX\\vv-engine\\run.exe');
    await vi.waitFor(() => expect(exists).toHaveBeenCalledOnce());
    await adapter.shutdown();
    finish(true);
    await expect(validating).rejects.toThrow();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('終了時には起動確認中の所有プロセスも直ちに停止する', async () => {
    let finish!: () => void;
    const delay = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const kill = vi.fn(() => true);
    const adapter = new VoicevoxAdapter({ exists: async () => true, spawn: () => ({ kill }),
      probePort: async () => 50123, fetch: vi.fn().mockRejectedValue(new Error('not ready')), delay });
    const validating = adapter.validateExecutable('C:\\VOICEVOX\\vv-engine\\run.exe');
    await vi.waitFor(() => expect(delay).toHaveBeenCalledOnce());
    await adapter.shutdown();
    expect(kill).toHaveBeenCalledOnce();
    finish();
    await expect(validating).rejects.toThrow();
    expect(kill).toHaveBeenCalledOnce();
  });

  it('終了中に遅れて完了する実行ファイル探索からEngineを起動しない', async () => {
    let finish!: (exists: boolean) => void;
    const exists = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    const spawn = vi.fn(() => ({ kill: vi.fn(() => true) }));
    const adapter = new VoicevoxAdapter({ executablePath: 'C:\\VOICEVOX\\vv-engine\\run.exe',
      fetch: vi.fn().mockRejectedValueOnce(new Error('not ready')).mockResolvedValue(new Response('{}')),
      exists, spawn });
    const preparing = adapter.prepare();
    await vi.waitFor(() => expect(exists).toHaveBeenCalledOnce());
    await adapter.shutdown();
    finish(true);
    await expect(preparing).rejects.toThrow();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('同時の準備要求は一つのEngine起動を共有する', async () => {
    let finish!: (exists: boolean) => void;
    const lookup = new Promise<boolean>(resolve => { finish = resolve; });
    const exists = vi.fn(() => lookup);
    const kill = vi.fn(() => true);
    const spawn = vi.fn(() => ({ kill }));
    const fetch = vi.fn().mockRejectedValueOnce(new Error('not ready')).mockRejectedValueOnce(new Error('not ready'))
      .mockResolvedValue(new Response('{}'));
    const adapter = new VoicevoxAdapter({ executablePath: 'C:\\VOICEVOX\\vv-engine\\run.exe', exists, spawn, fetch });
    const first = adapter.prepare();
    const second = adapter.prepare();
    await vi.waitFor(() => expect(exists).toHaveBeenCalled());
    finish(true);
    await Promise.all([first, second]);
    expect(spawn).toHaveBeenCalledOnce();
    await adapter.shutdown();
    expect(kill).toHaveBeenCalledOnce();
  });

  it('既に利用可能なEngineは所有せず終了時にも停止しない', async () => {
    const kill = vi.fn();
    const adapter = new VoicevoxAdapter({
      fetch: vi.fn(async () => new Response('{}', { status: 200 })),
      spawn: vi.fn(() => ({ kill })),
      exists: vi.fn(async () => true),
      delay: vi.fn(async () => undefined),
    });

    await adapter.prepare();
    await adapter.shutdown();

    expect(kill).not.toHaveBeenCalled();
  });

  it('利用不可ならCPU版を起動し、きゃすメイトが起動した所有プロセスだけを停止する', async () => {
    const kill = vi.fn();
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error('not ready'))
      .mockResolvedValue(new Response('{}', { status: 200 }));
    const spawn = vi.fn(() => ({ kill }));
    const adapter = new VoicevoxAdapter({
      executablePath: 'C:\\VOICEVOX\\vv-engine\\run.exe',
      fetch,
      spawn,
      exists: vi.fn(async () => true),
      delay: vi.fn(async () => undefined),
    });

    await adapter.prepare();
    await adapter.shutdown();

    expect(spawn).toHaveBeenCalledWith(
      'C:\\VOICEVOX\\vv-engine\\run.exe',
      expect.arrayContaining(['--host', '127.0.0.1', '--port', '50021']),
    );
    expect(spawn.mock.calls[0]?.[1]).not.toContain('--use_gpu');
    expect(kill).toHaveBeenCalledOnce();
  });

  it('音声クエリへ選択した話し方を適用しWAVをメモリで返す', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ speedScale: 1 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const adapter = new VoicevoxAdapter({
      fetch,
      spawn: vi.fn(),
      exists: vi.fn(async () => false),
      delay: vi.fn(async () => undefined),
    });
    const settings = {
      ...createDefaultSettings().commentSpeech,
      voice: { speakerUuid: 'speaker', styleId: 7 },
      speedScale: 1.2,
      pitchScale: 0.1,
      intonationScale: 1.3,
      volumeScale: 0.8,
    };

    await adapter.prepare();
    const wav = await adapter.synthesize('秘密の本文', settings);

    expect(wav).toEqual(Buffer.from([1, 2, 3]));
    const synthesisRequest = fetch.mock.calls[2]?.[1] as RequestInit;
    expect(JSON.parse(String(synthesisRequest.body))).toMatchObject({
      speedScale: 1.2,
      pitchScale: 0.1,
      intonationScale: 1.3,
      volumeScale: 0.8,
    });
  });

  it('選択したrun.exeを別ポートで起動確認してから受理し、確認プロセスを停止する', async () => {
    const kill = vi.fn(() => true);
    const spawn = vi.fn(() => ({ kill }));
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error('not ready'))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const adapter = new VoicevoxAdapter({
      fetch,
      spawn,
      exists: vi.fn(async () => true),
      probePort: vi.fn(async () => 50123),
      delay: vi.fn(async () => undefined),
    });

    await adapter.validateExecutable('C:\\VOICEVOX\\vv-engine\\run.exe');

    expect(spawn).toHaveBeenCalledWith(
      'C:\\VOICEVOX\\vv-engine\\run.exe',
      ['--host', '127.0.0.1', '--port', '50123'],
    );
    expect(fetch).toHaveBeenLastCalledWith(
      'http://127.0.0.1:50123/version',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(kill).toHaveBeenCalledOnce();
  });

  it('起動エラーになったEngineを受理せず、確認プロセスだけを停止する', async () => {
    const kill = vi.fn(() => true);
    const adapter = new VoicevoxAdapter({
      fetch: vi.fn(async () => { throw new Error('not ready'); }),
      spawn: vi.fn(() => ({
        kill,
        once: (_event: 'error', listener: (error: Error) => void) => {
          listener(new Error('spawn failed'));
        },
      })),
      exists: vi.fn(async () => true),
      probePort: vi.fn(async () => 50123),
      delay: vi.fn(async () => undefined),
    });

    await expect(adapter.validateExecutable('C:\\VOICEVOX\\vv-engine\\run.exe'))
      .rejects.toThrow('選択したVOICEVOX Engineを起動できません。');
    expect(kill).toHaveBeenCalledOnce();
  });
});
