/**
 * Renders the worm's animations in Blender and packs them into the sprite sheet the game loads:
 * sprites/worm.png and sprites/worm.json (the atlas, plus each animation's frame count, speed and
 * looping under "anims"). Run `npm run sprites` after changing art/worm/worm.blend.
 *
 * Needs Blender 5.1 or newer; set BLENDER to its executable if it isn't in /Applications.
 * The built files are committed, so playing or working on the game doesn't need Blender.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import pack from 'free-tex-packer-core';

const ROOT = join(import.meta.dirname, '../..');
const BLENDER = process.env.BLENDER ?? '/Applications/Blender.app/Contents/MacOS/Blender';
const SOURCE = join(ROOT, 'art/worm/worm.blend');
const OUT = join(import.meta.dirname, '../sprites');

const frames = mkdtempSync(join(tmpdir(), 'neoworms-sprites-'));
try {
  const blender = spawnSync(
    BLENDER,
    ['--background', SOURCE, '--python-exit-code', '1', '--python', join(ROOT, 'art/scripts/render_sprites.py'), '--', frames],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (blender.error) throw new Error(`Couldn't run Blender at ${BLENDER} (set BLENDER): ${blender.error.message}`);
  // Blender prints a few lines per rendered frame; keep just our progress and any errors.
  for (const line of blender.stdout.split('\n')) if (/^sprites:|Error|Traceback/.test(line)) console.log(line);
  if (blender.status !== 0) throw new Error(`Blender failed:\n${blender.stderr}`);

  const anims: Record<string, { frames: number; fps: number; loop: boolean }> = JSON.parse(
    readFileSync(join(frames, 'anims.json'), 'utf8'),
  );
  const images = Object.keys(anims).flatMap((anim) =>
    readdirSync(join(frames, anim))
      .sort()
      .map((file) => ({ path: `${anim}/${file}`, contents: readFileSync(join(frames, anim, file)) })),
  );
  const packed = await pack.packAsync(images, {
    textureName: 'worm',
    removeFileExtension: true,
    allowRotation: false,
    padding: 2,
    extrude: 1,
  });
  for (const file of packed) {
    if (file.name.endsWith('.json')) {
      const atlas = JSON.parse(file.buffer.toString('utf8'));
      writeFileSync(join(OUT, file.name), `${JSON.stringify({ ...atlas, anims }, null, 1)}\n`);
    } else writeFileSync(join(OUT, file.name), file.buffer);
    console.log(`→ ${relative(ROOT, join(OUT, file.name))}`);
  }
} finally {
  rmSync(frames, { recursive: true, force: true });
}
