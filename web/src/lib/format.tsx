import type { ReactNode } from "react";

import { cn } from "./utils";

// Defaults to `singular + "s"`; pass `plural` for irregular nouns. 0 is
// plural, as in English.
function nounForm(count: number, singular: string, plural?: string) {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}

/** "N noun" as a string. */
export function pluralize(count: number, singular: string, plural?: string) {
  return `${count.toLocaleString()} ${nounForm(count, singular, plural)}`;
}

/** "N noun" with the count in mono + tabular-nums. */
export function Count({
  count,
  singular,
  plural,
  className
}: {
  count: number;
  singular: string;
  plural?: string;
  className?: string;
}): ReactNode {
  return (
    <>
      <span className={cn("font-mono tabular-nums", className)}>
        {count.toLocaleString()}
      </span>{" "}
      {nounForm(count, singular, plural)}
    </>
  );
}

/** Seconds as m:ss. Unknown reads as dashes, not "0:00". */
export function formatTime(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return "—:—";
  }
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, "0")}`;
}

/** Byte count, as a file browser shows it. */
export function formatSize(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
