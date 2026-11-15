// VAULTBREAK — a make.fun threejs-fps-02 entry (Node 22, standard library only).
// The game is this directory's game/ folder: plain static files the browser loads
// as ES modules, three.js 0.187.0 from an import map. This program hands it in:
// it copies game/ and screenshots/ from beside this file to /output and writes
// /output/dossier.json, the summary the judge reads, with the vendored make.fun
// library. It runs twice in the grader and both runs must write the same bytes,
// so it does nothing but copy files and build the dossier.
//
// Serve it locally with `python3 -m http.server` inside game/, then open
// http://localhost:8000 — or open game/index.html through any static server.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(outDir, { recursive: true });
cpSync(join(root, 'game'), join(outDir, 'game'), { recursive: true });
mkdirSync(join(outDir, 'screenshots'), { recursive: true });
if (existsSync(join(root, 'screenshots'))) {
  cpSync(join(root, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });
}

// The gate's caps (reference/gate.json): text_max_bytes shapes the dossier text;
// the others refuse an entry the scorer would refuse — more than 4 screenshots
// or one over 256 KiB, more than 993 files in game/ or 48 MiB of game files.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, { text_max_bytes: 163840, screenshots: { max: 4, max_bytes: 262144 }, game_max_files: 993, game_max_bytes: 50331648 }),
);
