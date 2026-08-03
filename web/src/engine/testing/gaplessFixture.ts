/**
 * Two adjacent slices of a deterministic stereo sweep. Correct playback
 * matches `expectedSample`; PCM avoids encoder delay and padding.
 */

export const SAMPLE_RATE = 48_000;
export const CHANNEL_COUNT = 2;
export const AMPLITUDE = 0.5;

export const TRACK_FRAMES = [24_001, 18_007] as const;

export const TOTAL_FRAMES = TRACK_FRAMES.reduce((sum, count) => sum + count, 0);

/** Opposing sweeps make channel swaps detectable. */
const SWEEP_HZ: readonly (readonly [number, number])[] = [
  [400, 6000],
  [6000, 400]
];

/** Signed 16-bit PCM: the encoder scales by 32767, decoders divide by 32768. */
const ENCODE_SCALE = 32_767;
const DECODE_SCALE = 32_768;

const WAV_HEADER_BYTES = 44;
const BYTES_PER_SAMPLE = 2;

function sweepSample(channel: number, frame: number): number {
  const sweep = SWEEP_HZ[channel % SWEEP_HZ.length] as readonly [
    number,
    number
  ];
  const [startHz, endHz] = sweep;
  const seconds = frame / SAMPLE_RATE;
  const span = TOTAL_FRAMES / SAMPLE_RATE;
  // Integrating the frequency ramp keeps phase continuous across the join.
  const phase =
    2 *
    Math.PI *
    (startHz * seconds + ((endHz - startHz) * seconds ** 2) / (2 * span));
  return AMPLITUDE * Math.sin(phase);
}

function quantize(value: number): number {
  return Math.min(Math.max(Math.round(value * ENCODE_SCALE), -32_768), 32_767);
}

/** Applies fixture quantization to the analytic reference. */
export function expectedSample(channel: number, frame: number): number {
  return quantize(sweepSample(channel, frame)) / DECODE_SCALE;
}

function trackStartFrame(track: number): number {
  let start = 0;
  for (let index = 0; index < track; index += 1) {
    start += TRACK_FRAMES[index] ?? 0;
  }
  return start;
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

export function encodeTrackWav(track: number): Uint8Array<ArrayBuffer> {
  const frames = TRACK_FRAMES[track];
  if (frames === undefined)
    throw new Error(`no gapless fixture track ${track}`);
  const startFrame = trackStartFrame(track);

  const dataBytes = frames * CHANNEL_COUNT * BYTES_PER_SAMPLE;
  const bytes = new Uint8Array(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(bytes.buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, WAV_HEADER_BYTES - 8 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM fmt chunk length
  view.setUint16(20, 1, true); // WAVE_FORMAT_PCM
  view.setUint16(22, CHANNEL_COUNT, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * CHANNEL_COUNT * BYTES_PER_SAMPLE, true);
  view.setUint16(32, CHANNEL_COUNT * BYTES_PER_SAMPLE, true);
  view.setUint16(34, 8 * BYTES_PER_SAMPLE, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = WAV_HEADER_BYTES;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < CHANNEL_COUNT; channel += 1) {
      view.setInt16(
        offset,
        quantize(sweepSample(channel, startFrame + frame)),
        true
      );
      offset += BYTES_PER_SAMPLE;
    }
  }
  return bytes;
}
