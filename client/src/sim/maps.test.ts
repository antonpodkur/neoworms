/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { PHYS } from './constants';
import { isMirrored, mapFromImage, type GeneratedMap } from './mapgen';
import { createWorld, type TeamSetup } from './world';

const R = PHYS.wormRadius;

/** Our cave maps: a rock roof, so no air strikes. */
const CAVES = ['small/grotto.png', 'large/deep-caverns.png'];

/** The maps we ship, and the most teams each one is made for. */
const MAPS = (['small', 'large'] as const).flatMap((folder) =>
  readdirSync(new URL(`../../maps/${folder}`, import.meta.url))
    .filter((f) => f.endsWith('.png'))
    .map((f) => ({ file: `${folder}/${f}`, teams: folder === 'small' ? 4 : 8 })),
);

function load(file: string): GeneratedMap {
  const png = PNG.sync.read(readFileSync(new URL(`../../maps/${file}`, import.meta.url)));
  return mapFromImage(png.data, png.width, png.height);
}

function teams(count: number, worms: number): TeamSetup[] {
  return Array.from({ length: count }, (_, t) => ({
    name: `Team ${t}`,
    worms: Array.from({ length: worms }, (_, i) => `Worm ${t}.${i}`),
  }));
}

it('ships maps for both team sizes', () => {
  expect(MAPS.filter((m) => m.teams === 4).length).toBeGreaterThanOrEqual(3);
  expect(MAPS.filter((m) => m.teams === 8).length).toBeGreaterThanOrEqual(3);
});

describe.each(MAPS)('$file', ({ file, teams: maxTeams }) => {
  const map = load(file);

  it('is the same on both sides', () => {
    expect(isMirrored(map.terrain)).toBe(true);
  });

  it(`is ${CAVES.includes(file) ? '' : 'not '}a cave`, () => {
    expect(map.enclosed).toBe(CAVES.includes(file));
  });

  it(`fits ${maxTeams} teams of 4 worms, spread out on dry land`, () => {
    for (const seed of [1, 2, 3]) {
      const { worms, terrain } = createWorld(map, seed, teams(maxTeams, 4));
      for (const w of worms) {
        expect(w.y).toBeLessThan(map.waterLevel);
        expect(terrain.discFree(w.x, w.y, R)).toBe(true);
        expect(terrain.discFree(w.x, w.y + 1, R)).toBe(false); // standing on ground
        for (const other of worms) {
          if (other !== w) expect(Math.hypot(other.x - w.x, other.y - w.y)).toBeGreaterThanOrEqual(90);
        }
      }
    }
  });

  it('starts every worm across from an enemy worm in the same spot', () => {
    const { worms, terrain } = createWorld(map, 7, teams(2, 4));
    for (const w of worms.filter((w) => w.team === 0)) {
      const twin = worms.find((o) => o.team === 1 && o.x === terrain.width - w.x && o.y === w.y);
      expect(twin).toBeDefined();
    }
    // Both teams get worms on both sides of the map.
    expect(new Set(worms.filter((w) => w.team === 0).map((w) => w.x < terrain.width / 2)).size).toBe(2);
  });
});
