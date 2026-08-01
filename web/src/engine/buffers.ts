/** Holds only the current and next decoded buffers to bound PCM memory use. */

/** Bytes an AudioBuffer occupies as float32 PCM. */
export function estimateBytes(buffer: AudioBuffer): number {
  return buffer.length * buffer.numberOfChannels * 4;
}

export const MAX_RETAINED_BUFFERS = 2;

export class BufferCache {
  private readonly entries = new Map<string, AudioBuffer>();

  get(id: string): AudioBuffer | null {
    return this.entries.get(id) ?? null;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  set(id: string, buffer: AudioBuffer): void {
    this.entries.set(id, buffer);
  }

  /** Drops every buffer whose id is not in `keep`. */
  retain(keep: readonly (string | null)[]): void {
    const wanted = new Set(keep.filter((id): id is string => id !== null));
    for (const id of this.entries.keys()) {
      if (!wanted.has(id)) this.entries.delete(id);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  /** Approximate resident PCM, for diagnostics and tests. */
  get bytes(): number {
    let total = 0;
    for (const buffer of this.entries.values()) total += estimateBytes(buffer);
    return total;
  }
}
