import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import { mulberry32 } from './rng';
import { Terrain, type Vec2 } from './terrain';

export type MapPreset = 'one-island' | 'two-islands' | 'archipelago' | 'cavern';

export const MAP_PRESETS: { id: MapPreset; name: string }[] = [
  { id: 'one-island', name: 'One Island' },
  { id: 'two-islands', name: 'Two Islands' },
  { id: 'archipelago', name: 'Archipelago' },
  { id: 'cavern', name: 'Cavern' },
];

export interface GeneratedMap {
  terrain: Terrain;
  waterLevel: number;
}

const WIDTH = 2400;
const HEIGHT = 1100;
const WATER_DEPTH = 90;
/** How far above the water the tallest island's surface sits. */
const MAX_ISLAND_HEIGHT = 430;
/** Chunks of ground smaller than this (in pixels) are removed as noise. */
const MIN_CHUNK = 400;

interface Island {
  center: number;
  halfWidth: number;
  /** 0..1 share of MAX_ISLAND_HEIGHT. */
  height: number;
}

/**
 * Builds a map from a preset and seed. The same inputs always produce the same terrain,
 * so a seed can be shared to replay a map you liked.
 */
export function generateMap(preset: MapPreset, seed: number): GeneratedMap {
  const rng = mulberry32(seed);
  const noise = createNoise2D(rng);
  const width = WIDTH;
  const height = HEIGHT;
  const waterLevel = height - WATER_DEPTH;
  const islands = layoutIslands(preset, width, rng);
  const mask = new Uint8Array(width * height);

  // Ground surface per column. Between islands it drops well below the water.
  const surface = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    const e = envelope(x, islands);
    const hills = fbm(noise, x / 380, 7.3, 3);
    surface[x] = waterLevel + 120 - e * (MAX_ISLAND_HEIGHT + 120) + hills * 90 * e;
  }

  // 2D noise around the surface makes overhangs, arches and floating bits: good rope anchors.
  const band = 110; // pixels over which the surface noise fades in
  const roughness = 0.85; // max noise contribution, in units of `band`
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const depth = y - surface[x];
      let solid: boolean;
      if (depth > band * roughness) solid = true;
      else if (depth < -band * roughness) solid = false;
      else solid = depth / band + fbm(noise, x / 230, y / 230, 4) * roughness > 0;

      // A few hollow caves inside the islands.
      if (solid && depth > 60 && y < waterLevel && noise(x / 160 + 1000, y / 160 + 1000) > 0.66) {
        solid = false;
      }
      mask[y * width + x] = solid ? 1 : 0;
    }
  }

  if (preset === 'cavern') addCavernShell(mask, width, height, noise);
  removeSmallChunks(mask, width, height, MIN_CHUNK);

  return { terrain: new Terrain(width, height, mask), waterLevel };
}

function layoutIslands(preset: MapPreset, width: number, rng: () => number): Island[] {
  switch (preset) {
    case 'one-island':
      return [{ center: width * 0.5, halfWidth: width * 0.42, height: 0.9 + rng() * 0.1 }];
    case 'two-islands':
      return [
        { center: width * 0.25, halfWidth: width * 0.2, height: 0.75 + rng() * 0.25 },
        { center: width * 0.75, halfWidth: width * 0.2, height: 0.75 + rng() * 0.25 },
      ];
    case 'archipelago': {
      const count = 5;
      const slot = width / count;
      return Array.from({ length: count }, (_, i) => ({
        center: slot * (i + 0.5) + (rng() - 0.5) * slot * 0.3,
        halfWidth: slot * (0.32 + rng() * 0.12),
        height: 0.35 + rng() * 0.55,
      }));
    }
    case 'cavern':
      return [{ center: width * 0.5, halfWidth: width * 0.6, height: 0.55 }];
  }
}

/** 0..1 island coverage at column x: slopes up from the edges, roughly flat in the middle. */
function envelope(x: number, islands: Island[]): number {
  let e = 0;
  for (const island of islands) {
    const t = 1 - Math.abs(x - island.center) / island.halfWidth;
    if (t > 0) e = Math.max(e, island.height * smoothstep(0, 0.7, t));
  }
  return e;
}

/** Encloses the map: a rocky roof with stalactites plus rock walls down both sides. */
function addCavernShell(mask: Uint8Array, width: number, height: number, noise: NoiseFunction2D): void {
  const band = 90;
  const roughness = 0.8;
  const ceiling = Float32Array.from({ length: width }, (_, x) => 230 + fbm(noise, x / 300 + 500, 3.1, 3) * 80);
  const wall = Float32Array.from({ length: height }, (_, y) => 70 + fbm(noise, 7.7, y / 200 + 500, 3) * 40);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const edge = Math.min(x, width - 1 - x);
      const base = Math.max((ceiling[x] - y) / band, (wall[y] - edge) / band);
      if (base < -roughness) continue;
      if (base > roughness || base + fbm(noise, x / 200 + 500, y / 200, 4) * roughness > 0) {
        mask[y * width + x] = 1;
      }
    }
  }
}

/** Clears every connected chunk of ground smaller than minSize pixels. */
function removeSmallChunks(mask: Uint8Array, width: number, height: number, minSize: number): void {
  const { labels, sizes } = labelRegions(mask, width, height, 1);
  for (let i = 0; i < mask.length; i++) {
    if (labels[i] && sizes[labels[i]] < minSize) mask[i] = 0;
  }
}

/**
 * Splits the pixels equal to `value` into 4-connected regions.
 * labels[i] is the region id of pixel i (0 = not `value`); sizes[id] is its pixel count.
 */
function labelRegions(
  mask: Uint8Array,
  width: number,
  height: number,
  value: 0 | 1,
): { labels: Int32Array; sizes: number[] } {
  const labels = new Int32Array(mask.length);
  const sizes = [0];
  const queue = new Int32Array(mask.length);
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] !== value || labels[start]) continue;
    const id = sizes.length;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = id;
    while (head < tail) {
      const i = queue[head++];
      const x = i % width;
      const y = (i / width) | 0;
      if (x > 0) tail = visit(i - 1, tail, id);
      if (x < width - 1) tail = visit(i + 1, tail, id);
      if (y > 0) tail = visit(i - width, tail, id);
      if (y < height - 1) tail = visit(i + width, tail, id);
    }
    sizes.push(tail);
  }
  return { labels, sizes };

  function visit(i: number, tail: number, id: number): number {
    if (mask[i] === value && !labels[i]) {
      labels[i] = id;
      queue[tail++] = i;
    }
    return tail;
  }
}

/**
 * Random standing spots on top of ground (island tops and cave floors), above the water
 * and spread apart from each other. Only spots in the main open space count, so no worm
 * starts sealed inside a cave pocket.
 */
export function findSpawnPoints(
  terrain: Terrain,
  waterLevel: number,
  count: number,
  radius: number,
  rng: () => number,
  minSpacing = 90,
): Vec2[] {
  const { width, height, mask } = terrain;
  const air = labelRegions(mask, width, height, 0);
  const mainAir = air.sizes.indexOf(Math.max(...air.sizes.slice(1)));

  const points: Vec2[] = [];
  for (let attempt = 0; attempt < 3000 && points.length < count; attempt++) {
    const x = Math.floor(40 + rng() * (width - 80));
    const floors: number[] = [];
    for (let y = radius * 2; y < waterLevel - 20; y++) {
      const i = y * width + x;
      if (air.labels[i] === mainAir && mask[i + width]) floors.push(y);
    }
    if (floors.length === 0) continue;
    const spot = { x: x + 0.5, y: floors[Math.floor(rng() * floors.length)] - radius + 0.5 };
    if (!terrain.discFree(spot.x, spot.y, radius)) continue;
    if (points.some((p) => Math.hypot(p.x - spot.x, p.y - spot.y) < minSpacing)) continue;
    points.push(spot);
  }
  return points;
}

/** Fractal noise in -1..1 built from `octaves` layers of simplex noise. */
function fbm(noise: NoiseFunction2D, x: number, y: number, octaves: number): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
