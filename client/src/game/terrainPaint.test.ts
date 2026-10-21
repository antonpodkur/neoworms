import { describe, expect, test } from 'vitest';
import { generateMap } from '../sim/mapgen';
import type { Terrain } from '../sim/terrain';
import { TerrainPainter } from './terrainPaint';

/** The first ground pixel going down column x. */
function surface(terrain: Terrain, x: number): number {
  let y = 0;
  while (y < terrain.height && !terrain.isSolid(x, y)) y++;
  return y;
}

function blast(terrain: Terrain, painter: TerrainPainter, x: number, y: number, r: number): void {
  terrain.carve(x, y, r);
  const rect = painter.carve(x, y, r);
  if (rect) painter.paint(rect);
}

describe('TerrainPainter', () => {
  test('repainting around new holes matches repainting the whole map', () => {
    const { terrain } = generateMap('two-islands', 5);
    const painter = new TerrainPainter(terrain);
    const x = 600;
    const y = surface(terrain, x);
    blast(terrain, painter, x, y, 21);
    blast(terrain, painter, x + 25, y + 15, 40); // overlapping the first
    // An old crater down-right of a new one catches the new one's changed shadows.
    const deep = surface(terrain, x + 300) + 80;
    blast(terrain, painter, x + 330, deep + 30, 30);
    blast(terrain, painter, x + 300, deep - 21, 12.5);
    blast(terrain, painter, 3, terrain.height - 2, 30); // clipped by the map's corner
    const local = painter.pixels.slice();
    painter.paint({ x: 0, y: 0, w: terrain.width, h: terrain.height });
    expect(local.length).toBe(painter.pixels.length);
    expect(local.findIndex((v, i) => v !== painter.pixels[i])).toBe(-1);
  });

  test('a hole shows a darker back wall where there was ground, and stays clear where there was none', () => {
    const { terrain } = generateMap('one-island', 9);
    const painter = new TerrainPainter(terrain);
    const x = Math.round(terrain.width / 2);
    const top = surface(terrain, x);
    const y = top + 10;
    const brightness = (px: number, py: number) => {
      const o = (py * terrain.width + px) * 4;
      return painter.pixels[o] + painter.pixels[o + 1] + painter.pixels[o + 2];
    };
    const before = brightness(x, y);
    blast(terrain, painter, x, y, 25);
    const o = (y * terrain.width + x) * 4;
    expect(terrain.isSolid(x, y)).toBe(false);
    expect(painter.pixels[o + 3]).toBe(255);
    expect(brightness(x, y)).toBeLessThan(before * 0.6);
    // The crater breaks through the surface: above it there was only sky.
    expect(painter.pixels[((top - 5) * terrain.width + x) * 4 + 3]).toBe(0);
  });
});
