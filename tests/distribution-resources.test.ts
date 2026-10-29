import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { imageSize } from 'image-size';
import { describe, expect, it } from 'vitest';
import { FfmpegTranscoder } from '../src/main/speech/ffmpeg-transcoder';
import { APP_DISPLAY_NAME, legacyUserDataDirectory, withAppWindowTitle } from '../src/main/window-branding';

describe('v0.2.0配布リソース', () => {
  it('本体のAGPL-3.0-or-laterの本文と通知をWindowsとAndroidへ同梱する', async () => {
    const root = process.cwd();
    const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
      license: string;
      build: { extraResources: Array<{ from: string; to?: string }> };
    };
    expect(packageJson.license).toBe('AGPL-3.0-or-later');
    expect(packageJson.build.extraResources).toContainEqual({ from: 'LICENSE', to: 'LICENSE' });
    expect(packageJson.build.extraResources).toContainEqual({ from: 'NOTICE.md', to: 'NOTICE.md' });

    const license = await readFile(join(root, 'LICENSE'), 'utf8');
    const notice = await readFile(join(root, 'NOTICE.md'), 'utf8');
    expect(license).toContain('GNU AFFERO GENERAL PUBLIC LICENSE');
    expect(license).toContain('Version 3, 19 November 2007');
    expect(license).toContain('END OF TERMS AND CONDITIONS');
    expect(notice).toContain('AGPL-3.0-or-later');
    expect(notice).toContain('either version 3 of the License, or');
    expect(notice).toContain('(at your option) any later version');
    expect(notice).toContain('https://github.com/kyokutyou/CasMate');

    const assets = join(root, 'android', 'app', 'src', 'main', 'assets', 'licenses');
    const normalize = (text: string) => text.replace(/\r\n/g, '\n');
    expect(normalize(await readFile(join(assets, 'CasMate-AGPL-3.0.txt'), 'utf8'))).toBe(normalize(license));
    expect(normalize(await readFile(join(assets, 'CasMate-NOTICE.md'), 'utf8'))).toBe(normalize(notice));
  });

  it('Windows実行ファイルとプロセス名にCasMateを使う', async () => {
    const packageJson = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8')) as {
      build: {
        productName: string;
        win: { executableName: string };
      };
    };

    expect(packageJson.build.productName).toBe('CasMate');
    expect(packageJson.build.win.executableName).toBe('CasMate');

    expect(APP_DISPLAY_NAME).toBe('CasMate');
    expect(withAppWindowTitle({ width: 800 })).toEqual({ width: 800, title: 'CasMate' });
    expect(legacyUserDataDirectory(join('C:', 'AppData'))).toBe(join('C:', 'AppData', 'CasMate'));

    const html = await readFile(join(process.cwd(), 'index.html'), 'utf8');
    expect(html).toContain('<title>CasMate</title>');
  });

  it('Windows配布物にきゃすメイトのアプリアイコンを含む', async () => {
    const root = process.cwd();
    const png = await readFile(join(root, 'resources', 'icon.png'));
    const ico = await readFile(join(root, 'resources', 'icon.ico'));
    const svg = await readFile(join(root, 'resources', 'icon.svg'), 'utf8');

    expect(imageSize(png)).toMatchObject({ width: 1024, height: 1024, type: 'png' });
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(7);
    expect(svg).toContain('#8667FF');
    expect(svg).toContain('#FF6FAE');
    expect(svg).not.toMatch(/<text\b/);

    const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
      build: {
        win: { icon: string };
        extraResources: Array<{ from: string; to?: string }>;
      };
    };
    expect(packageJson.build.win.icon).toBe('resources/icon.ico');
    expect(packageJson.build.extraResources).toContainEqual({ from: 'resources/icon.png', to: 'icon.png' });
  });

  it('固定LGPL共有版FFmpegと告知を含み、VOICEVOX本体を配布対象にしない', async () => {
    const root = process.cwd();
    await expect(access(join(root, 'resources', 'ffmpeg', 'ffmpeg.exe'))).resolves.toBeUndefined();
    await expect(access(join(root, 'resources', 'ffmpeg', 'avcodec-63.dll'))).resolves.toBeUndefined();
    const notice = await readFile(join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
    expect(notice).toContain('n9.0.1-6-g9d4ca21220');
    expect(notice).toContain('win64-lgpl-shared');
    expect(notice).toContain('VOICEVOX本体およびVOICEVOX Engineは、きゃすメイトへ同梱しない');

    const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
      build: { extraResources: Array<{ from: string }> };
    };
    expect(packageJson.build.extraResources.map((entry) => entry.from)).toContain('resources/ffmpeg');
    expect(packageJson.build.extraResources.some((entry) => /voicevox/i.test(entry.from))).toBe(false);
  });

  it('同梱FFmpegがメモリ上のWAVをAAC-LC・M4A・モノラルへ変換できる', async () => {
    const executable = join(process.cwd(), 'resources', 'ffmpeg', 'ffmpeg.exe');
    const transcoder = new FfmpegTranscoder(executable);

    const m4a = await transcoder.transcode(silentPcmWav(), 32);

    expect(m4a.subarray(4, 8).toString('ascii')).toBe('ftyp');
    expect(m4a.length).toBeGreaterThan(100);
  }, 15_000);

  it('自己完結型の音声認識ワーカーを配布対象にし、モデル本体は同梱しない', async () => {
    const root = process.cwd();
    const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
      build: { extraResources: Array<{ from: string }> };
    };
    expect(packageJson.scripts['build:worker']).toContain('--self-contained true');
    expect(packageJson.build.extraResources.map((entry) => entry.from))
      .toContain('resources/speech-recognition-worker');
    expect(packageJson.build.extraResources.some((entry) => /reazonspeech.*\.(onnx|tar)/i.test(entry.from)))
      .toBe(false);

    const notice = await readFile(join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
    expect(notice).toContain('sherpa-onnx');
    expect(notice).toContain('Parakeet CTC');
    expect(notice).toContain('CC BY 4.0');
    expect(notice).toContain('nvidia/parakeet-tdt_ctc-0.6b-ja');
    expect(notice).toContain('モデル本体はアプリへ同梱せず');
    expect(notice).toContain('Dotnet-ThirdPartyNotices.txt');
    await expect(access(join(root, 'resources', 'licenses', 'Apache-2.0.txt'))).resolves.toBeUndefined();
    await expect(access(join(root, 'resources', 'licenses', 'NAudio-MIT.txt'))).resolves.toBeUndefined();
    await expect(access(join(root, 'resources', 'licenses', 'ONNX-Runtime-MIT.txt'))).resolves.toBeUndefined();
    await expect(access(join(root, 'resources', 'licenses', 'Silero-VAD-MIT.txt'))).resolves.toBeUndefined();
    await expect(access(join(root, 'resources', 'licenses', 'CC-BY-4.0.txt'))).resolves.toBeUndefined();
  });
});

function silentPcmWav(): Buffer {
  const sampleRate = 24_000;
  const samples = 2_400;
  const dataSize = samples * 2;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write('WAVEfmt ', 8, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(dataSize, 40);
  return wav;
}
