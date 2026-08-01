/** Test AudioContext with a manually advanced clock. */

export interface RecordedCall {
  readonly kind: "setValueCurveAtTime" | "setTargetAtTime" | "cancel";
  readonly time: number;
  readonly duration?: number;
  readonly curve?: readonly number[];
  readonly target?: number;
}

export class FakeAudioParam {
  value = 1;
  readonly calls: RecordedCall[] = [];

  setValueCurveAtTime(
    curve: Float32Array,
    startTime: number,
    duration: number
  ): this {
    this.calls.push({
      kind: "setValueCurveAtTime",
      time: startTime,
      duration,
      curve: Array.from(curve)
    });
    return this;
  }

  setTargetAtTime(target: number, startTime: number): this {
    this.calls.push({ kind: "setTargetAtTime", time: startTime, target });
    this.value = target;
    return this;
  }

  cancelScheduledValues(startTime: number): this {
    this.calls.push({ kind: "cancel", time: startTime });
    return this;
  }
}

class FakeNode {
  readonly outputs = new Set<FakeNode>();
  readonly context: FakeAudioContext;

  constructor(context: FakeAudioContext) {
    this.context = context;
  }

  connect(target: FakeNode): FakeNode {
    this.outputs.add(target);
    return target;
  }

  disconnect(): void {
    this.outputs.clear();
  }

  /** True when this node reaches the destination through the current graph. */
  reachesDestination(seen = new Set<FakeNode>()): boolean {
    if (this === (this.context.destination as unknown as FakeNode)) return true;
    if (seen.has(this)) return false;
    seen.add(this);
    for (const out of this.outputs) {
      if (out.reachesDestination(seen)) return true;
    }
    return false;
  }
}

export class FakeGainNode extends FakeNode {
  readonly gain = new FakeAudioParam();
}

export class FakeBufferSource extends FakeNode {
  buffer: AudioBuffer | null = null;
  onended: (() => void) | null = null;

  startedAt: number | null = null;
  startOffset = 0;
  /** Context time the source is due to end, or null once it has. */
  endsAt: number | null = null;
  stopped = false;

  start(when?: number, offset?: number): void {
    if (this.startedAt !== null) throw new Error("source already started");
    this.startedAt = when ?? this.context.currentTime;
    this.startOffset = offset ?? 0;
    const length = this.buffer ? this.buffer.duration - this.startOffset : 0;
    this.endsAt = this.startedAt + Math.max(length, 0);
    this.context.register(this);
  }

  stop(when?: number): void {
    if (this.startedAt === null) throw new Error("source never started");
    this.stopped = true;
    this.endsAt = Math.min(
      this.endsAt ?? Infinity,
      when ?? this.context.currentTime
    );
    this.context.retire(this);
    // Web Audio also emits `ended` for deliberately stopped sources. The
    // engine distinguishes those from boundaries by checking the active voice.
    queueMicrotask(() => this.onended?.());
  }
}

export interface FakeBufferSpec {
  readonly duration: number;
  readonly channels?: number;
  readonly sampleRate?: number;
}

export function fakeBuffer(spec: FakeBufferSpec | number): AudioBuffer {
  const resolved = typeof spec === "number" ? { duration: spec } : spec;
  const sampleRate = resolved.sampleRate ?? 48000;
  const channels = resolved.channels ?? 2;
  return {
    duration: resolved.duration,
    length: Math.round(resolved.duration * sampleRate),
    numberOfChannels: channels,
    sampleRate
  } as AudioBuffer;
}

export class FakeAudioContext {
  currentTime = 0;
  sampleRate = 48000;
  state: AudioContextState = "suspended";
  readonly destination = new FakeNode(this) as unknown as AudioDestinationNode;

  /** Buffers `decodeAudioData` should return, keyed by call order. */
  decodeResults: AudioBuffer[] = [];
  decodeError: Error | null = null;
  decodeCalls = 0;

  private live = new Set<FakeBufferSource>();

  createGain(): GainNode {
    return new FakeGainNode(this) as unknown as GainNode;
  }

  createBufferSource(): AudioBufferSourceNode {
    return new FakeBufferSource(this) as unknown as AudioBufferSourceNode;
  }

  async decodeAudioData(_bytes: ArrayBuffer): Promise<AudioBuffer> {
    this.decodeCalls += 1;
    if (this.decodeError) throw this.decodeError;
    const buffer = this.decodeResults.shift();
    if (!buffer) throw new Error("fake context: no decode result queued");
    return buffer;
  }

  async suspend(): Promise<void> {
    this.state = "suspended";
  }

  async resume(): Promise<void> {
    this.state = "running";
  }

  async close(): Promise<void> {
    this.state = "closed";
    this.live.clear();
  }

  register(source: FakeBufferSource): void {
    this.live.add(source);
  }

  retire(source: FakeBufferSource): void {
    this.live.delete(source);
  }

  /** Advances the clock and ends due sources in chronological order. */
  advanceTo(time: number): void {
    for (;;) {
      const due = [...this.live]
        .filter((s) => s.endsAt !== null && s.endsAt <= time)
        .sort((a, b) => (a.endsAt ?? 0) - (b.endsAt ?? 0));
      const next = due[0];
      if (!next) break;
      this.live.delete(next);
      this.currentTime = Math.max(this.currentTime, next.endsAt ?? time);
      next.onended?.();
    }
    this.currentTime = Math.max(this.currentTime, time);
  }

  /** Sources currently scheduled or playing. */
  get scheduled(): readonly FakeBufferSource[] {
    return [...this.live];
  }

  asAudioContext(): AudioContext {
    return this as unknown as AudioContext;
  }
}
