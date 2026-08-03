import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  SAMPLE_RATE,
  TRACK_FRAMES,
  encodeTrackWav
} from "../src/engine/testing/gaplessFixture.ts";

const NAMES = ["gapless-a.wav", "gapless-b.wav"];

const outDir = path.resolve(
  process.argv[2] ?? path.join(os.tmpdir(), "rhythm-gapless-fixtures")
);
await mkdir(outDir, { recursive: true });

for (const [index, frames] of TRACK_FRAMES.entries()) {
  const file = path.join(outDir, NAMES[index] ?? `gapless-${index}.wav`);
  await writeFile(file, encodeTrackWav(index));
  console.log(
    `${file}  ${frames} frames  ${(frames / SAMPLE_RATE).toFixed(6)}s`
  );
}
