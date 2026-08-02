import {
  DEFAULT_DSP,
  EQ_BAND_FREQUENCIES_HZ,
  type DspSettings,
  type EqBandGainsDb
} from "./types";

export const EQ_BAND_COUNT = EQ_BAND_FREQUENCIES_HZ.length;

export const EQ_BAND_LIMIT_DB = 12;
export const PREAMP_MIN_DB = -24;
export const PREAMP_MAX_DB = 12;

export function flatBandGains(): EqBandGainsDb {
  return [...DEFAULT_DSP.bandGainsDb];
}

function mapBandGains(
  bands: EqBandGainsDb,
  transform: (gain: number) => number
): EqBandGainsDb {
  // map preserves the tuple length even though TypeScript widens its type.
  return bands.map(transform) as unknown as EqBandGainsDb;
}

export function bandGainsEqual(a: EqBandGainsDb, b: EqBandGainsDb): boolean {
  return a.every((gain, band) => gain === b[band]);
}

export function dspEquals(a: DspSettings, b: DspSettings): boolean {
  return (
    a.bypass === b.bypass &&
    a.preampDb === b.preampDb &&
    bandGainsEqual(a.bandGainsDb, b.bandGainsDb)
  );
}

function clamp(value: number, min: number, max: number): number {
  // Never pass a non-finite value to an AudioParam.
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, min), max);
}

/** Preserves object identity when no normalization is needed. */
export function normalizeDsp(settings: DspSettings): DspSettings {
  const preampDb = clamp(settings.preampDb, PREAMP_MIN_DB, PREAMP_MAX_DB);
  const bandGainsDb = mapBandGains(settings.bandGainsDb, (gain) =>
    clamp(gain, -EQ_BAND_LIMIT_DB, EQ_BAND_LIMIT_DB)
  );

  if (
    preampDb === settings.preampDb &&
    bandGainsEqual(bandGainsDb, settings.bandGainsDb)
  ) {
    return settings;
  }
  return { bypass: settings.bypass, preampDb, bandGainsDb };
}
