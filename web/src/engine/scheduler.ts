/** Pure scheduling arithmetic in `AudioContext.currentTime` seconds. */

/** Fade shapes are sampled into curves for `setValueCurveAtTime`. */
export const FADE_CURVE_STEPS = 64;

export interface Transition {
  /** Context time the current source stops producing sound. */
  readonly endAt: number;
  /** Context time the next source should be started at. */
  readonly startNextAt: number;
  /** Length of the overlap in seconds; zero schedules a gapless butt joint. */
  readonly overlap: number;
}

export interface TransitionInput {
  /** Context time at which the current source was started. */
  readonly startedAt: number;
  /** Offset into the current buffer that `startedAt` corresponds to. */
  readonly offset: number;
  /** Length of the current buffer in seconds. */
  readonly duration: number;
  /** Length of the next buffer, or null when it is not decoded yet. */
  readonly nextDuration: number | null;
  /** Requested crossfade; 0 (the default) means gapless. */
  readonly crossfadeSeconds: number;
  /** Current context time, used so a late decode still schedules sanely. */
  readonly now: number;
}

/**
 * Plans the next start time. Crossfade overlap is limited by the remaining
 * audio and half the duration of either track.
 */
export function planTransition(input: TransitionInput): Transition {
  const { startedAt, offset, duration, nextDuration, crossfadeSeconds, now } =
    input;

  const endAt = startedAt + Math.max(duration - offset, 0);
  const remaining = Math.max(endAt - Math.max(now, startedAt), 0);

  let overlap = Math.max(crossfadeSeconds, 0);
  overlap = Math.min(overlap, remaining, duration / 2);
  if (nextDuration !== null) overlap = Math.min(overlap, nextDuration / 2);
  if (!Number.isFinite(overlap) || overlap < 0) overlap = 0;

  // A late decode cannot be scheduled in the past.
  const startNextAt = Math.max(endAt - overlap, now);

  return { endAt, startNextAt, overlap };
}

/** Equal-power fade curve whose paired gains maintain constant power. */
export function equalPowerCurve(
  direction: "in" | "out",
  steps: number = FADE_CURVE_STEPS
): Float32Array {
  const count = Math.max(Math.floor(steps), 2);
  const curve = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    curve[i] =
      direction === "in"
        ? Math.sin((t * Math.PI) / 2)
        : Math.cos((t * Math.PI) / 2);
  }
  return curve;
}

/**
 * The playhead in track seconds. Clamped to the track so a reading taken a
 * frame after the source ended never reports past the end.
 */
export function positionAt(
  now: number,
  startedAt: number,
  offset: number,
  duration: number
): number {
  if (duration <= 0) return 0;
  const elapsed = Math.max(now - startedAt, 0);
  return Math.min(offset + elapsed, duration);
}

/** dB to a linear gain multiplier. */
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}
