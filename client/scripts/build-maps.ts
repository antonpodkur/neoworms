/**
 * Turns the map sources (maps/small/*.svg, maps/large/*.svg) into the PNGs the game loads.
 * Run `npm run maps` after editing a map's SVG.
 *
 * The PNG is what ships: every browser decodes it to the same pixels, which online play relies
 * on (all players' terrain must match). SVG rendered in the browser can differ by a few edge
 * pixels from one browser to another.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { PNG } from 'pngjs';

const MAPS_DIR = join(import.meta.dirname, '../maps');
const FOLDERS = ['small', 'large'];
const AIR = [0, 0, 0];
const SOIL = [181, 121, 74];
const STONE = [127, 151, 173];

for (const folder of FOLDERS) {
  const dir = join(MAPS_DIR, folder);
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.svg'))) {
    const svgPath = join(dir, file);
    const pngPath = svgPath.replace(/\.svg$/, '.png');
    const svg = readFileSync(svgPath, 'utf8');
    const { width, height, pixels } = new Resvg(svg, { background: '#000000' }).render();
    // <svg data-mirror="true">: the right half is the left half flipped. The renderer doesn't
    // flip the rock texture exactly, so copy the left half over to make both sides identical.
    const mirror = /<svg[^>]*\sdata-mirror="true"/.test(svg);
    const png = new PNG({ width, height, colorType: 2 });
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const sx = mirror && x >= width / 2 ? width - 1 - x : x;
        const o = (y * width + sx) * 4;
        png.data.set([...material(pixels[o], pixels[o + 1], pixels[o + 2]), 255], (y * width + x) * 4);
      }
    }
    writeFileSync(pngPath, PNG.sync.write(png, { colorType: 2 }));
    console.log(`${relative(MAPS_DIR, svgPath)} → ${relative(MAPS_DIR, pngPath)} (${width}×${height})`);
  }
}

/** Snaps a colour to air, soil or stone the way mapFromImage reads it: dark is air, greenish or bluish is stone. */
function material(r: number, g: number, b: number): number[] {
  if (Math.max(r, g, b) <= 40) return AIR;
  return g > r ? STONE : SOIL;
}
