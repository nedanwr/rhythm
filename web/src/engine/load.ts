import { describeDecodeFailure, loadDecoder, tierForExtension } from "./codecs";
import type { EngineErrorKind } from "./types";

/** Downloads a complete track before decoding it to PCM. */

export class LoadError extends Error {
  readonly kind: EngineErrorKind;

  constructor(kind: EngineErrorKind, message: string) {
    super(message);
    this.name = "LoadError";
    this.kind = kind;
  }
}

export interface LoadOptions {
  readonly url: string;
  readonly name: string;
  readonly ext: string | undefined;
  readonly context: BaseAudioContext;
  readonly signal: AbortSignal;
  /**
   * Download progress. `total` is null when the server sent no length, which
   * a caller must treat as "unknown" rather than as zero.
   */
  readonly onProgress?: (loaded: number, total: number | null) => void;
}

/** Fetches a track and decodes it, or throws a LoadError explaining why not. */
export async function loadTrack(options: LoadOptions): Promise<AudioBuffer> {
  const bytes = await fetchBytes(options);
  return decodeBytes(bytes, options);
}

async function fetchBytes(options: LoadOptions): Promise<ArrayBuffer> {
  const { url, signal, onProgress } = options;

  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (cause) {
    if (signal.aborted) throw abortError();
    throw new LoadError(
      "network",
      "Could not reach the Rhythm server to load this track."
    );
  }

  if (!response.ok) {
    throw new LoadError(
      "network",
      response.status === 404
        ? "This file is no longer in the library."
        : `The Rhythm server refused to send this track (${response.status}).`
    );
  }

  const header = response.headers.get("Content-Length");
  const total = header !== null && header !== "" ? Number(header) : null;
  const declared = total !== null && Number.isFinite(total) ? total : null;

  if (!response.body) {
    const buffer = await response.arrayBuffer();
    onProgress?.(buffer.byteLength, declared ?? buffer.byteLength);
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      onProgress?.(received, declared);
    }
  } catch (cause) {
    if (signal.aborted) throw abortError();
    throw new LoadError(
      "network",
      "The connection dropped while loading this track."
    );
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  chunks.length = 0;
  return merged.buffer;
}

async function decodeBytes(
  bytes: ArrayBuffer,
  options: LoadOptions
): Promise<AudioBuffer> {
  const { context, ext, name, signal } = options;
  const tier = tierForExtension(ext);

  // decodeAudioData detaches its input, so fallback decoders need a copy.
  const spare = tier === "native" ? null : bytes.slice(0);

  try {
    const buffer = await context.decodeAudioData(bytes);
    if (signal.aborted) throw abortError();
    return buffer;
  } catch (cause) {
    if (cause instanceof LoadError) throw cause;
    if (signal.aborted) throw abortError();

    const decoder = await loadDecoder(ext);
    if (decoder && spare) {
      try {
        const buffer = await decoder.decode(spare, context.sampleRate);
        if (signal.aborted) throw abortError();
        return buffer;
      } catch (decoderCause) {
        if (decoderCause instanceof LoadError) throw decoderCause;
        if (signal.aborted) throw abortError();
      }
    }

    throw new LoadError(
      tier === "native" ? "decode" : "unsupported",
      describeDecodeFailure(name, ext)
    );
  }
}

function abortError(): LoadError {
  // Internal cancellation is filtered by isAbort and never shown to the user.
  return new LoadError("network", "aborted");
}

/** True when a thrown value is the engine cancelling its own load. */
export function isAbort(error: unknown): boolean {
  return error instanceof LoadError && error.message === "aborted";
}
