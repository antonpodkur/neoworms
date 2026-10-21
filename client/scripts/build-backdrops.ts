/**
 * Renders each backdrop's layers in Blender into the strips the game loads: for every
 * art/backdrop/<theme>.blend, backdrops/<theme>/<layer>.png and backdrops/<theme>/layers.json
 * (where each layer sits and how it scrolls). Run `npm run backdrops` after changing a backdrop.
 *
 * Needs Blender 5.1 or newer; set BLENDER to its executable if it isn't in /Applications.
 * The built files are committed, so playing or working on the game doesn't need Blender.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '../..');
const BLENDER = process.env.BLENDER ?? '/Applications/Blender.app/Contents/MacOS/Blender';
const SOURCES = join(ROOT, 'art/backdrop');
const OUT = join(import.meta.dirname, '../backdrops');

for (const file of readdirSync(SOURCES).filter((f) => f.endsWith('.blend'))) {
  const out = join(OUT, file.replace(/\.blend$/, ''));
  // Start clean, so a layer removed from the .blend doesn't linger.
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const blender = spawnSync(
    BLENDER,
    ['--background', join(SOURCES, file), '--python-exit-code', '1', '--python', join(ROOT, 'art/scripts/render_backdrop.py'), '--', out],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (blender.error) throw new Error(`Couldn't run Blender at ${BLENDER} (set BLENDER): ${blender.error.message}`);
  // Blender prints a few lines per render; keep just our progress and any errors.
  for (const line of blender.stdout.split('\n')) if (/^backdrop:|Error|Traceback/.test(line)) console.log(line);
  if (blender.status !== 0) throw new Error(`Blender failed on ${file}:\n${blender.stderr}`);
  for (const layer of readdirSync(out).sort()) console.log(`→ ${relative(ROOT, join(out, layer))}`);
}
