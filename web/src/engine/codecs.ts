/** Native decode is attempted before extension-based fallback routing. */

export type DecodeTier =
  /** The browser decodes it natively. */
  | "native"
  /** Needs an in-browser decoder. */
  | "browser"
  /** Needs server-side compatibility decoding. */
  | "server"
  /** Extension carries more than one codec; only a decode attempt can tell. */
  | "ambiguous";

interface FormatInfo {
  readonly tier: DecodeTier;
  /** Display label used in playback errors. */
  readonly label: string;
}

/** Keyed by extension until the library exposes codec metadata. */
const FORMATS: Record<string, FormatInfo> = {
  flac: { tier: "native", label: "FLAC" },
  mp3: { tier: "native", label: "MP3" },
  ogg: { tier: "native", label: "Vorbis" },
  opus: { tier: "native", label: "Opus" },
  wav: { tier: "native", label: "WAV" },
  aiff: { tier: "native", label: "AIFF" },
  aif: { tier: "native", label: "AIFF" },
  // Containers can hold codecs that require different decode paths.
  m4a: { tier: "ambiguous", label: "MPEG-4 audio" },
  mka: { tier: "ambiguous", label: "Matroska audio" },
  dsf: { tier: "browser", label: "DSD" },
  dff: { tier: "browser", label: "DSD" },
  wma: { tier: "browser", label: "Windows Media Audio" },
  thd: { tier: "server", label: "Dolby TrueHD" },
  dts: { tier: "server", label: "DTS" }
};

export function normalizeExt(ext: string | undefined | null): string {
  return (ext ?? "").replace(/^\./, "").toLowerCase();
}

/** The tier an extension is expected to need. Unknown extensions try native. */
export function tierForExtension(ext: string | undefined | null): DecodeTier {
  return FORMATS[normalizeExt(ext)]?.tier ?? "native";
}

/** A listener-facing format name, or null when the extension is unknown. */
export function formatLabel(ext: string | undefined | null): string | null {
  return FORMATS[normalizeExt(ext)]?.label ?? null;
}

/**
 * An in-browser decoder for a format the browser itself cannot handle.
 * Loaders are async so a FLAC-only library never downloads an ALAC decoder.
 */
export interface AuxDecoder {
  decode(bytes: ArrayBuffer, sampleRate: number): Promise<AudioBuffer>;
}

const decoders = new Map<string, () => Promise<AuxDecoder>>();

/** Registers an auxiliary decoder for an extension. */
export function registerDecoder(
  ext: string,
  load: () => Promise<AuxDecoder>
): void {
  decoders.set(normalizeExt(ext), load);
}

export function hasDecoder(ext: string | undefined | null): boolean {
  return decoders.has(normalizeExt(ext));
}

export async function loadDecoder(
  ext: string | undefined | null
): Promise<AuxDecoder | null> {
  const load = decoders.get(normalizeExt(ext));
  return load ? await load() : null;
}

/** Test seam: drops every registered decoder. */
export function clearDecoders(): void {
  decoders.clear();
}

/** Distinguishes unsupported formats from failures in native formats. */
export function describeDecodeFailure(
  name: string | undefined,
  ext: string | undefined | null
): string {
  const subject = name ? `“${name}”` : "This track";
  const label = formatLabel(ext);
  const tier = tierForExtension(ext);

  switch (tier) {
    case "browser":
      return (
        `${subject} is ${label}, which no browser can decode. Rhythm's ` +
        `in-browser decoder for it is not built yet.`
      );
    case "server":
      return (
        `${subject} is ${label}, which no browser can decode. Rhythm will ` +
        `decode it on the server in a later release.`
      );
    case "ambiguous":
      return (
        `${subject} could not be decoded. ${label} files can hold several ` +
        `codecs, and this one needs a decoder Rhythm does not have yet.`
      );
    case "native":
      return label
        ? `${subject} could not be decoded. The ${label} file may be damaged.`
        : `${subject} could not be decoded. The file may be damaged, or its ` +
            `format may not be supported.`;
  }
}
