import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AMPLITUDE,
  CHANNEL_COUNT,
  SAMPLE_RATE,
  TOTAL_FRAMES,
  TRACK_FRAMES,
  encodeTrackWav,
  expectedSample
} from "./testing/gaplessFixture";
import type { EngineTrack } from "./types";
import { WebAudioEngine } from "./webAudioEngine";

/**
 * Exercises fetch, decode and scheduling in a browser `OfflineAudioContext`.
 * AAC encoder delay and padding are outside this test's scope.
 */

const JOIN_FRAME = TRACK_FRAMES[0];
const TAIL_FRAMES = 480;
const RENDER_FRAMES = TOTAL_FRAMES + TAIL_FRAMES;

/**
 * Allows one 16-bit LSB for browser decoder scaling differences. A one-frame
 * alignment error is much larger.
 */
const SAMPLE_TOLERANCE = 1 / 32_768;

const ARM_AT_SECONDS = 0.25;

const JOIN_WINDOW = 256;
const ALIGNMENT_SHIFTS = [-4, -3, -2, -1, 0, 1, 2, 3, 4];

const TRACKS: readonly EngineTrack[] = [
  { id: "fixture/gapless-a.wav", name: "Gapless A", ext: "wav" },
  { id: "fixture/gapless-b.wav", name: "Gapless B", ext: "wav" }
];

const revocations: string[] = [];
let engine: WebAudioEngine | null = null;

afterEach(async () => {
  await engine?.dispose();
  engine = null;
  for (const url of revocations.splice(0)) URL.revokeObjectURL(url);
});

function fixtureUrls(): Map<string, string> {
  const urls = new Map<string, string>();
  TRACKS.forEach((track, index) => {
    const blob = new Blob([encodeTrackWav(index)], { type: "audio/wav" });
    const url = URL.createObjectURL(blob);
    revocations.push(url);
    urls.set(track.id, url);
  });
  return urls;
}

/**
 * Adapts OfflineAudioContext's one-shot rendering lifecycle to the transport
 * methods used by WebAudioEngine while forwarding all audio operations.
 */
function offlineTransport(context: OfflineAudioContext): AudioContext {
  let state: AudioContextState = "suspended";
  const overrides: Record<string, unknown> = {
    get state() {
      return state;
    },
    resume: async () => {
      state = "running";
    },
    suspend: async () => {
      state = "suspended";
    },
    close: async () => {
      state = "closed";
    }
  };

  return new Proxy(context, {
    get(target, property) {
      // hasOwn, not `in`: everything inherited from Object.prototype must
      // still come from the real context.
      if (Object.hasOwn(overrides, property)) {
        return Reflect.get(overrides, property, overrides);
      }
      // Native accessors such as currentTime need the real context as `this`.
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    }
  }) as unknown as AudioContext;
}

function sample(data: Float32Array, frame: number): number {
  return data[frame] ?? 0;
}

function worstDeviation(rendered: AudioBuffer): {
  error: number;
  frame: number;
  channel: number;
} {
  let worst = { error: 0, frame: 0, channel: 0 };
  for (let channel = 0; channel < CHANNEL_COUNT; channel += 1) {
    const data = rendered.getChannelData(channel);
    for (let frame = 0; frame < TOTAL_FRAMES; frame += 1) {
      const error = Math.abs(
        sample(data, frame) - expectedSample(channel, frame)
      );
      if (error > worst.error) worst = { error, frame, channel };
    }
  }
  return worst;
}

/** At an exact join, the minimum alignment error occurs at shift zero. */
function alignmentError(
  rendered: AudioBuffer,
  channel: number,
  shift: number
): number {
  const data = rendered.getChannelData(channel);
  let worst = 0;
  for (let index = 0; index < JOIN_WINDOW; index += 1) {
    const frame = JOIN_FRAME + index;
    const error = Math.abs(
      sample(data, frame + shift) - expectedSample(channel, frame)
    );
    if (error > worst) worst = error;
  }
  return worst;
}

function bestAlignment(rendered: AudioBuffer, channel: number): number {
  let best = ALIGNMENT_SHIFTS[0] as number;
  let bestError = Infinity;
  for (const shift of ALIGNMENT_SHIFTS) {
    const error = alignmentError(rendered, channel, shift);
    if (error < bestError) {
      bestError = error;
      best = shift;
    }
  }
  return best;
}

function reference(channel: number, from: number, count: number): Float32Array {
  const data = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    data[index] = expectedSample(channel, from + index);
  }
  return data;
}

function largestStep(data: Float32Array, from: number, count: number): number {
  let worst = 0;
  for (let index = 1; index < count; index += 1) {
    const step = Math.abs(
      sample(data, from + index) - sample(data, from + index - 1)
    );
    if (step > worst) worst = step;
  }
  return worst;
}

function peak(data: Float32Array, from: number, count: number): number {
  let worst = 0;
  for (let index = 0; index < count; index += 1) {
    const value = Math.abs(sample(data, from + index));
    if (value > worst) worst = value;
  }
  return worst;
}

function rms(data: Float32Array, from: number, count: number): number {
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    total += sample(data, from + index) ** 2;
  }
  return Math.sqrt(total / count);
}

async function decodeFixture(
  context: OfflineAudioContext,
  track: number
): Promise<AudioBuffer> {
  return await context.decodeAudioData(encodeTrackWav(track).buffer);
}

/** Renders a deliberately shifted join; positive offsets start track two late. */
async function renderSplice(offsetFrames: number): Promise<AudioBuffer> {
  const offline = new OfflineAudioContext(
    CHANNEL_COUNT,
    RENDER_FRAMES,
    SAMPLE_RATE
  );
  const starts = [0, JOIN_FRAME + offsetFrames];
  for (const [track, startFrame] of starts.entries()) {
    const source = offline.createBufferSource();
    source.buffer = await decodeFixture(offline, track);
    source.connect(offline.destination);
    source.start(startFrame / SAMPLE_RATE);
  }
  return await offline.startRendering();
}

describe("gapless playback through OfflineAudioContext", () => {
  it("joins adjacent tracks into one continuous waveform", async () => {
    const offline = new OfflineAudioContext(
      CHANNEL_COUNT,
      RENDER_FRAMES,
      SAMPLE_RATE
    );
    const urls = fixtureUrls();
    const advanced: string[] = [];

    const player = new WebAudioEngine({
      createContext: () => offlineTransport(offline),
      streamUrl: (id) => urls.get(id) ?? "about:blank"
    });
    engine = player;
    player.on("advanced", (id) => advanced.push(id));

    const [first, second] = TRACKS as readonly [EngineTrack, EngineTrack];
    await player.load(first);
    expect(player.getSnapshot().error).toBeNull();
    expect(player.getSnapshot().crossfadeSeconds).toBe(0);

    // Arm the successor after rendering starts to match normal queue playback.
    const midTrack = offline.suspend(ARM_AT_SECONDS);
    const rendering = offline.startRendering();
    await midTrack;
    expect(offline.currentTime).toBeGreaterThanOrEqual(ARM_AT_SECONDS);

    player.setNext(second);
    await vi.waitFor(() => expect(player.decodedBufferCount).toBe(2));
    await offline.resume();

    const rendered = await rendering;
    expect(rendered.length).toBe(RENDER_FRAMES);

    const worst = worstDeviation(rendered);
    expect(
      worst.error,
      `channel ${worst.channel} frame ${worst.frame} deviates by ${worst.error}`
    ).toBeLessThan(SAMPLE_TOLERANCE);

    for (let channel = 0; channel < CHANNEL_COUNT; channel += 1) {
      const data = rendered.getChannelData(channel);
      const from = JOIN_FRAME - JOIN_WINDOW;
      const count = JOIN_WINDOW * 2;
      const expected = reference(channel, from, count);

      expect(bestAlignment(rendered, channel)).toBe(0);
      expect(alignmentError(rendered, channel, 0)).toBeLessThan(
        SAMPLE_TOLERANCE
      );
      expect(alignmentError(rendered, channel, 1)).toBeGreaterThan(0.05);
      expect(alignmentError(rendered, channel, -1)).toBeGreaterThan(0.05);

      expect(largestStep(data, from, count)).toBeLessThanOrEqual(
        largestStep(expected, 0, count) + SAMPLE_TOLERANCE
      );

      expect(peak(data, from, count)).toBeLessThanOrEqual(
        AMPLITUDE + SAMPLE_TOLERANCE
      );

      expect(rms(data, JOIN_FRAME, JOIN_WINDOW)).toBeGreaterThan(0.1);

      expect(peak(data, TOTAL_FRAMES, TAIL_FRAMES)).toBe(0);
    }

    await vi.waitFor(() => expect(advanced).toEqual([second.id]));
    expect(player.getSnapshot().trackId).toBe(second.id);
  });

  it("would catch a join three frames late", async () => {
    const rendered = await renderSplice(3);

    for (let channel = 0; channel < CHANNEL_COUNT; channel += 1) {
      expect(bestAlignment(rendered, channel)).toBe(3);
      expect(alignmentError(rendered, channel, 0)).toBeGreaterThan(0.05);
    }
  });

  it("would catch a silent gap at the join", async () => {
    const rendered = await renderSplice(480);

    for (let channel = 0; channel < CHANNEL_COUNT; channel += 1) {
      const data = rendered.getChannelData(channel);
      expect(rms(data, JOIN_FRAME, JOIN_WINDOW)).toBe(0);
      expect(alignmentError(rendered, channel, 0)).toBeGreaterThan(0.05);
    }
  });

  it("would catch tracks overlapping at the join", async () => {
    const rendered = await renderSplice(-480);

    for (let channel = 0; channel < CHANNEL_COUNT; channel += 1) {
      const data = rendered.getChannelData(channel);
      expect(
        peak(data, JOIN_FRAME - JOIN_WINDOW, JOIN_WINDOW * 2)
      ).toBeGreaterThan(AMPLITUDE + SAMPLE_TOLERANCE);
      expect(alignmentError(rendered, channel, 0)).toBeGreaterThan(0.05);
    }
  });
});
