export interface MouthShapeTransition {
  atMs: number;
  shape: 'closed' | 'open';
}

export function analyzeRmsFrames(
  samples: Float32Array,
  sampleRate: number,
): MouthShapeTransition[] {
  const frameSize = Math.max(1, Math.round(sampleRate * 0.04));
  const rmsValues: number[] = [];
  for (let offset = 0; offset < samples.length; offset += frameSize) {
    let sum = 0;
    const end = Math.min(samples.length, offset + frameSize);
    for (let index = offset; index < end; index += 1) sum += samples[index]! ** 2;
    rmsValues.push(Math.sqrt(sum / Math.max(1, end - offset)));
  }
  const maximum = Math.max(0, ...rmsValues);
  if (maximum === 0) return [];

  const transitions: MouthShapeTransition[] = [];
  let shape: MouthShapeTransition['shape'] = 'closed';
  let changedAt = -80;
  for (let index = 0; index < rmsValues.length; index += 1) {
    const atMs = index * 40;
    if (atMs - changedAt < 80) continue;
    const normalized = rmsValues[index]! / maximum;
    const next: MouthShapeTransition['shape'] = normalized >= 0.18
      ? 'open'
      : normalized <= 0.1
        ? 'closed'
        : shape;
    if (next !== shape) {
      shape = next;
      changedAt = atMs;
      transitions.push({ atMs, shape });
    }
  }
  return transitions;
}

export function analyzeVoicevoxWav(wav: Buffer): MouthShapeTransition[] {
  const parsed = parsePcm16Wav(wav);
  return analyzeRmsFrames(parsed.samples, parsed.sampleRate);
}

function parsePcm16Wav(wav: Buffer): { samples: Float32Array; sampleRate: number } {
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('WAV形式が正しくありません。');
  }
  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let audioFormat = 0;
  let data: Buffer | null = null;
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ' && size >= 16) {
      audioFormat = wav.readUInt16LE(body);
      channels = wav.readUInt16LE(body + 2);
      sampleRate = wav.readUInt32LE(body + 4);
      bitsPerSample = wav.readUInt16LE(body + 14);
    } else if (id === 'data') {
      data = wav.subarray(body, Math.min(wav.length, body + size));
    }
    offset = body + size + (size % 2);
  }
  if (!data || audioFormat !== 1 || bitsPerSample !== 16 || channels < 1 || sampleRate < 1) {
    throw new Error('対応するPCM WAVではありません。');
  }
  const frames = Math.floor(data.length / (2 * channels));
  const samples = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    let mixed = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      mixed += data.readInt16LE((frame * channels + channel) * 2) / 32768;
    }
    samples[frame] = mixed / channels;
  }
  return { samples, sampleRate };
}
