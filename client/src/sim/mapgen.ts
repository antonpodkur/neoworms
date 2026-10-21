import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import { mulberry32 } from './rng';
import { Terrain, type Vec2 } from './terrain';

export type MapPreset = 'one-island' | 'two-islands' | 'archipelago' | 'cavern' | 'rope-gym';

/** `enclosed` maps have a rock roof and walls instead of open sky. */
export const MAP_PRESETS: { id: MapPreset; name: string; enclosed: boolean }[] = [
  { id: 'one-island', name: 'One Island', enclosed: false },
  { id: 'two-islands', name: 'Two Islands', enclosed: false },
  { id: 'archipelago', name: 'Archipelago', enclosed: false },
  { id: 'cavern', name: 'Cavern', enclosed: true },
  { id: 'rope-gym', name: 'Rope Gym', enclosed: true },
];

export function isMapPreset(value: unknown): value is MapPreset {
  return MAP_PRESETS.some((p) => p.id === value);
}

export interface GeneratedMap {
  terrain: Terrain;
  waterLevel: number;
  /** A rock roof over the map (a cave): no sky, so nothing can be called in from above. */
  enclosed: boolean;
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

  const enclosed = MAP_PRESETS.find((p) => p.id === preset)!.enclosed;
  if (enclosed) addCavernShell(mask, width, height, noise);
  if (preset === 'rope-gym') addFloatingRocks(mask, width, noise);
  removeSmallChunks(mask, width, height, MIN_CHUNK);

  return { terrain: new Terrain(width, height, mask), waterLevel, enclosed };
}

/** Brightness above which an image pixel counts as ground. */
const IMAGE_GROUND_THRESHOLD = 40;
/** Strip of water left along the bottom of image maps. */
const IMAGE_WATER_DEPTH = 20;

/**
 * Builds terrain from an RGBA image (e.g. a level outline): dark pixels are air, anything
 * else is ground. Greenish/cyan ground becomes material 2 so it can be drawn differently.
 * `scale` resizes the image (nearest neighbour) so its worms-per-pixel match ours.
 * It counts as a cave when ground covers most of its top edge.
 */
export function mapFromImage(rgba: ArrayLike<number>, width: number, height: number, scale = 1): GeneratedMap {
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(height - 1, Math.floor(y / scale));
    for (let x = 0; x < w; x++) {
      const o = (sy * width + Math.min(width - 1, Math.floor(x / scale))) * 4;
      const r = rgba[o];
      const g = rgba[o + 1];
      if (Math.max(r, g, rgba[o + 2]) <= IMAGE_GROUND_THRESHOLD) continue;
      mask[y * w + x] = g > r ? 2 : 1;
    }
  }
  let roof = 0;
  for (let x = 0; x < w; x++) if (mask[x]) roof++;
  return { terrain: new Terrain(w, h, mask), waterLevel: h - IMAGE_WATER_DEPTH, enclosed: roof > w / 2 };
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
    case 'rope-gym':
      return [{ center: width * 0.5, halfWidth: width * 0.6, height: 0.35 }];
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

/** Scatters floating rocks through the middle of the map: rope anchors everywhere. */
function addFloatingRocks(mask: Uint8Array, width: number, noise: NoiseFunction2D): void {
  const top = 330;
  const bottom = 780;
  for (let y = top; y < bottom; y++) {
    const fade = Math.min(1, (y - top) / 80, (bottom - y) / 80); // thin out toward the band edges
    for (let x = 150; x < width - 150; x++) {
      if (fbm(noise, x / 120 + 2000, y / 120 + 2000, 3) * fade > 0.42) mask[y * width + x] = 1;
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
 * starts sealed inside a cave pocket. If the map runs out of room, the spacing shrinks
 * until everyone fits.
 *
 * `mirrored` is for maps whose right half mirrors the left: spots then come in pairs, a spot
 * and its mirror image, left and right alternating which comes first. Worms take spots in
 * team order, so with an even number of teams every worm has an opponent starting from the
 * same place on the other side, and every team has worms on both sides.
 */
export function findSpawnPoints(
  terrain: Terrain,
  waterLevel: number,
  count: number,
  radius: number,
  rng: () => number,
  minSpacing = 90,
  mirrored = false,
): Vec2[] {
  const { width, height, mask } = terrain;
  const air = labelRegions(mask, width, height, 0);
  const mainAir = air.sizes.indexOf(Math.max(...air.sizes.slice(1)));
  /** A worm can stand at column x with its feet on row y + 1. */
  const isFloor = (x: number, y: number) => air.labels[y * width + x] === mainAir && mask[(y + 1) * width + x] !== 0;
  const spotAt = (x: number, y: number): Vec2 => ({ x: x + 0.5, y: y - radius + 0.5 });

  const points: Vec2[] = [];
  const roomFor = (p: Vec2, spacing: number) =>
    terrain.discFree(p.x, p.y, radius) && points.every((q) => Math.hypot(q.x - p.x, q.y - p.y) >= spacing);
  // Mirrored maps pick from the left half; the twin lands on the right.
  const span = mirrored ? width / 2 - 40 : width - 80;
  let leftFirst = mirrored && rng() < 0.5;

  for (let spacing = minSpacing; points.length < count && spacing >= radius * 2.5; spacing *= 0.7) {
    for (let attempt = 0; attempt < 3000 && points.length < count; attempt++) {
      const x = Math.floor(40 + rng() * span);
      const floors: number[] = [];
      for (let y = radius * 2; y < waterLevel - 20; y++) if (isFloor(x, y)) floors.push(y);
      if (floors.length === 0) continue;
      const y = floors[Math.floor(rng() * floors.length)];
      const spot = spotAt(x, y);
      if (!roomFor(spot, spacing)) continue;
      if (!mirrored || points.length === count - 1) {
        points.push(spot);
        continue;
      }
      const twinX = width - 1 - x;
      const twin = spotAt(twinX, y);
      if (twin.x - spot.x < spacing || !isFloor(twinX, y) || !roomFor(twin, spacing)) continue;
      points.push(...(leftFirst ? [spot, twin] : [twin, spot]));
      leftFirst = !leftFirst;
    }
  }
  return points;
}

/** True if the map's right half is a mirror image of its left (give or take a few pixels). */
export function isMirrored(terrain: Terrain): boolean {
  const { width, height, mask } = terrain;
  let differing = 0;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width >> 1; x++) {
      if ((mask[row + x] === 0) !== (mask[row + width - 1 - x] === 0)) differing++;
    }
  }
  return differing < width * height * 0.0005;
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
