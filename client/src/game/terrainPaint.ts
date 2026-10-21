/**
 * The terrain's look, computed on the CPU into an RGBA buffer (no Phaser here, so it runs in
 * tests too). Ground is a tiling material, lit as if it were a thick slab with rounded edges:
 * the slab's height comes from blurring the mask. Behind it sits a dark copy of the map as it
 * was built, so craters read as holes dug into the slab rather than windows to the sky.
 */
import { createNoise2D, createNoise4D, type NoiseFunction4D } from 'simplex-noise';
import { mulberry32 } from '../sim/rng';
import type { Terrain } from '../sim/terrain';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Blur radius of the height field. It's blurred twice, so edges round off over ~2× this. */
const BEVEL = 6;
/** How steep the rounded edges look. */
const BEVEL_STRENGTH = 7;
/** Direction toward the light: up-left and out of the screen (x right, y down, z to you). */
const LIGHT = normalize(-0.6, -0.75, 0.55);
/** How much a slope facing toward (or away from) the light brightens (or darkens) it. */
const LIGHT_GAIN = 1.1;
/** Darkening right at the edge, fading out a few pixels in. */
const EDGE_DARK = 0.45;
const EDGE_SOFT = 0.25;
/** The burnt ring around a crater: how wide it gets, in pixels, and its colour. */
const SCORCH_WIDTH = 5;
const SCORCH = [40, 24, 18];
/** Soil and stone touching: how dark the seam between them is. */
const SEAM_DARK = 0.35;
/** The back wall: how dark it is, and the shadow the ground in front casts on it. */
const BACK_SHADE = [0.36, 0.33, 0.38];
const SHADOW_X = 3;
const SHADOW_Y = 4;
const SHADOW_DARK = 0.55;
/** Large-scale brightness drift across the map, so the tiles don't look repeated. */
const DRIFT_CELL = 32;
const DRIFT = 0.08;

/** Wobbles the scorch ring's width around a crater. */
const scorchNoise = createNoise2D(mulberry32(3));

const KERNEL = 2 * BEVEL + 1;
/** The blurred mask is kept as an integer sum (exact, so any window gives the same result). */
const FULL = KERNEL ** 4;
/** Height profile by blurred-sum value: 0 at the edge, rising fast, flat on top. */
const PROFILE = Float32Array.from({ length: FULL + 1 }, (_, s) => {
  const t = Math.min(1, Math.max(0, (2 * s) / FULL - 1));
  return t * (2 - t);
});
/** Share of an edge pixel to draw, by how many of its 3 × 3 neighbourhood are set. */
const COVERAGE = Float32Array.from({ length: 10 }, (_, n) => smoothstep(2, 8, n));
/** How far a changed mask pixel can change the colours around it. */
const REACH = Math.max(2 * BEVEL + 1, SCORCH_WIDTH);

export class TerrainPainter {
  /** One RGBA pixel per terrain pixel, laid out like ImageData. */
  readonly pixels: Uint8ClampedArray<ArrayBuffer>;
  /** The map as it was built: the back wall, which explosions never touch. */
  private readonly original: Uint8Array;
  /** How burnt each pixel is, 0..255. */
  private readonly scorch: Uint8Array;
  private readonly drift: Float32Array;
  private readonly driftWidth: number;

  constructor(private readonly terrain: Terrain) {
    const { width, height, mask } = terrain;
    this.pixels = new Uint8ClampedArray(width * height * 4);
    this.original = mask.slice();
    this.scorch = new Uint8Array(width * height);
    [this.drift, this.driftWidth] = driftGrid(width, height);
    this.paint({ x: 0, y: 0, w: width, h: height });
  }

  /**
   * Burns the ground around a hole the simulation just carved (its pixels are already air in
   * the mask) and returns the area whose colours changed, for `paint`. Null if off the map.
   */
  carve(cx: number, cy: number, r: number): Rect | null {
    const { width, height } = this.terrain;
    const outer = r + SCORCH_WIDTH;
    const x0 = Math.max(0, Math.floor(cx - outer));
    const x1 = Math.min(width - 1, Math.ceil(cx + outer));
    const y0 = Math.max(0, Math.floor(cy - outer));
    const y1 = Math.min(height - 1, Math.ceil(cy + outer));
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy;
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - cx, dy);
        if (d <= r || d > outer) continue;
        // Ragged, not a perfect ring: its width wobbles around the hole.
        const reach = SCORCH_WIDTH * (0.65 + 0.35 * scorchNoise(x / 5, y / 5));
        const burn = 1 - (d - r) / reach;
        const i = y * width + x;
        if (burn > 0) this.scorch[i] = Math.max(this.scorch[i], Math.round(burn * 255));
      }
    }
    // Shadows on the back wall fall down-right of the ground casting them.
    const left = Math.floor(cx - r) - REACH;
    const top = Math.floor(cy - r) - REACH;
    const right = Math.ceil(cx + r) + REACH + SHADOW_X;
    const bottom = Math.ceil(cy + r) + REACH + SHADOW_Y;
    return clip({ x: left, y: top, w: right - left + 1, h: bottom - top + 1 }, width, height);
  }

  /** Recomputes the colours inside `rect` from the current mask. */
  paint(rect: Rect): void {
    const { width, height, mask } = this.terrain;
    const { sponge, stone } = materials();
    const px = this.pixels;
    // Heights are needed a pixel around the rect (for slopes) and up-left of it as far as the
    // shadows on the back wall reach.
    const fx = rect.x - 1 - SHADOW_X;
    const fy = rect.y - 1 - SHADOW_Y;
    const field = heightField(this.terrain, fx, fy, rect.w + 2 + SHADOW_X, rect.h + 2 + SHADOW_Y);
    const stride = field.stride;
    const sum = field.sums;

    for (let y = rect.y; y < rect.y + rect.h; y++) {
      let f = field.offset + (y - fy) * stride + (rect.x - fx);
      for (let x = rect.x; x < rect.x + rect.w; x++, f++) {
        const i = y * width + x;
        const o = i * 4;
        const solid = mask[i];
        const built = this.original[i];
        if (!solid && !built) {
          px[o + 3] = 0;
          continue;
        }
        // How much of the pixel the ground and the back wall behind it cover: all of it, except
        // along edges, where the 3 × 3 neighbourhood smooths out the pixel steps.
        let front = solid ? 1 : 0;
        let back = built ? 1 : 0;
        if (!solid || sum[f] < FULL) {
          if (solid) front = COVERAGE[neighbours(mask, width, height, x, y)];
          if (built) back = COVERAGE[neighbours(this.original, width, height, x, y)];
        }
        const t = ((y & TILE_MASK) * TILE + (x & TILE_MASK)) * 3;
        const drift = 1 + DRIFT * this.sampleDrift(x, y);
        let r = 0;
        let g = 0;
        let b = 0;
        if (front > 0) {
          const tile = solid === 2 ? stone : sponge;
          const gx = (PROFILE[sum[f + 1]] - PROFILE[sum[f - 1]]) * BEVEL_STRENGTH;
          const gy = (PROFILE[sum[f + stride]] - PROFILE[sum[f - stride]]) * BEVEL_STRENGTH;
          const lit = (LIGHT[2] - gx * LIGHT[0] - gy * LIGHT[1]) / Math.sqrt(1 + gx * gx + gy * gy);
          const edge = 1 - EDGE_DARK * (1 - smoothstep(0, EDGE_SOFT, PROFILE[sum[f]]));
          const seam = touchesOther(mask, i, x, width, solid) ? 1 - SEAM_DARK : 1;
          const shade = (1 + LIGHT_GAIN * (lit - LIGHT[2])) * edge * seam * drift;
          const burn = this.scorch[i] / 255;
          const k = shade * (1 - burn) * front;
          r = tile[t] * k + SCORCH[0] * burn * front;
          g = tile[t + 1] * k + SCORCH[1] * burn * front;
          b = tile[t + 2] * k + SCORCH[2] * burn * front;
        }
        // The back wall shows where the ground in front doesn't cover it.
        const behind = back - front;
        if (behind > 0) {
          const tile = built === 2 ? stone : sponge;
          const caster = sum[f - SHADOW_Y * stride - SHADOW_X] / FULL;
          const shade = drift * (1 - SHADOW_DARK * smoothstep(0.25, 0.75, caster)) * behind;
          r += tile[t] * BACK_SHADE[0] * shade;
          g += tile[t + 1] * BACK_SHADE[1] * shade;
          b += tile[t + 2] * BACK_SHADE[2] * shade;
        }
        const alpha = Math.max(front, back);
        px[o] = r / alpha;
        px[o + 1] = g / alpha;
        px[o + 2] = b / alpha;
        px[o + 3] = alpha * 255;
      }
    }
  }

  /** Smooth large-scale noise in -1..1, bilinear between grid points. */
  private sampleDrift(x: number, y: number): number {
    const gx = x / DRIFT_CELL;
    const gy = y / DRIFT_CELL;
    const ix = gx | 0;
    const iy = gy | 0;
    const fx = gx - ix;
    const fy = gy - iy;
    const i = iy * this.driftWidth + ix;
    const d = this.drift;
    const top = d[i] + (d[i + 1] - d[i]) * fx;
    const bottom = d[i + this.driftWidth] + (d[i + this.driftWidth + 1] - d[i + this.driftWidth]) * fx;
    return top + (bottom - top) * fy;
  }
}

/** How many of the 3 × 3 pixels around (x, y) are set; beyond the map's edges it carries on. */
function neighbours(mask: Uint8Array, width: number, height: number, x: number, y: number): number {
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) {
    const row = Math.min(height - 1, Math.max(0, y + dy)) * width;
    for (let dx = -1; dx <= 1; dx++) if (mask[row + Math.min(width - 1, Math.max(0, x + dx))]) n++;
  }
  return n;
}

/** Whether a ground pixel has a neighbour (left, right, up, down) of another material. */
function touchesOther(mask: Uint8Array, i: number, x: number, width: number, material: number): boolean {
  const other = (m: number | undefined) => !!m && m !== material;
  return (
    (x > 0 && other(mask[i - 1])) || (x < width - 1 && other(mask[i + 1])) || other(mask[i - width]) || other(mask[i + width])
  );
}

/** Grows `a` to cover `b` too. */
export function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function clip(rect: Rect, width: number, height: number): Rect | null {
  const x = Math.max(0, rect.x);
  const y = Math.max(0, rect.y);
  const w = Math.min(width, rect.x + rect.w) - x;
  const h = Math.min(height, rect.y + rect.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

/**
 * The mask blurred twice with a box of radius BEVEL (close to a Gaussian), over the window
 * (x, y, w, h), as unnormalized integer sums (0..FULL). Beyond the map's edges the ground
 * carries on, so the map border itself gets no rounded edge. The window sits inside a larger
 * array with a margin, read as `sums[offset + row * stride + column]`.
 */
function heightField(terrain: Terrain, x: number, y: number, w: number, h: number) {
  const { width, height, mask } = terrain;
  const margin = 2 * BEVEL;
  const ew = w + 2 * margin;
  const eh = h + 2 * margin;
  let a = new Int32Array(ew * eh);
  let b = new Int32Array(ew * eh);
  for (let row = 0; row < eh; row++) {
    const my = Math.min(height - 1, Math.max(0, y - margin + row)) * width;
    for (let col = 0; col < ew; col++) {
      const mx = Math.min(width - 1, Math.max(0, x - margin + col));
      a[row * ew + col] = mask[my + mx] ? 1 : 0;
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    boxSum(a, b, eh, ew, ew, 1);
    [a, b] = [b, a];
  }
  for (let pass = 0; pass < 2; pass++) {
    boxSum(a, b, ew, eh, 1, ew);
    [a, b] = [b, a];
  }
  return { sums: a, stride: ew, offset: margin * ew + margin };
}

/**
 * Sliding-window sum of radius BEVEL along `lines` lines of `length` cells each, `step` apart
 * within a line and `lineStep` apart between lines. Reads past a line's ends repeat its end cells.
 */
function boxSum(src: Int32Array, dst: Int32Array, lines: number, length: number, lineStep: number, step: number): void {
  const last = length - 1;
  for (let line = 0; line < lines; line++) {
    const base = line * lineStep;
    let sum = 0;
    for (let k = -BEVEL; k <= BEVEL; k++) sum += src[base + Math.min(last, Math.max(0, k)) * step];
    for (let i = 0; i < length; i++) {
      dst[base + i * step] = sum;
      sum += src[base + Math.min(last, i + BEVEL + 1) * step] - src[base + Math.max(0, i - BEVEL) * step];
    }
  }
}

function driftGrid(width: number, height: number): [Float32Array, number] {
  const noise = createNoise2D(mulberry32(7));
  const gw = Math.ceil(width / DRIFT_CELL) + 2;
  const gh = Math.ceil(height / DRIFT_CELL) + 2;
  const grid = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) grid[y * gw + x] = noise(x / 9, y / 9) * 0.7 + noise(x / 3.5, y / 3.5) * 0.3;
  }
  return [grid, gw];
}

// ---- Materials ---------------------------------------------------------------------------

/** Side of a material tile. A power of two, so a pixel's spot in it is just `x & TILE_MASK`. */
const TILE = 256;
const TILE_MASK = TILE - 1;
const TAU = Math.PI * 2;

let cachedMaterials: { sponge: Uint8Array; stone: Uint8Array } | null = null;

/** The two ground materials as seamless RGB tiles, made once and reused by every map. */
function materials(): { sponge: Uint8Array; stone: Uint8Array } {
  cachedMaterials ??= { sponge: spongeTile(), stone: cobblestoneTile() };
  return cachedMaterials;
}

/** Material 1: warm sandy sponge with light dots and dark crack lines. */
function spongeTile(): Uint8Array {
  const rand = mulberry32(1);
  const noise = createNoise4D(rand);
  const mottle = wrappingNoise(noise, 3, 0);
  const fine = wrappingNoise(noise, 11, 40);
  const crackLine = wrappingNoise(noise, 4, 80);
  const crackBend = wrappingNoise(noise, 7, 120);
  const crackFade = wrappingNoise(noise, 3, 160);
  const dots = new Cells(9, rand);
  // Cracks run where a bent noise field crosses zero.
  const field = new Float32Array(TILE * TILE);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) field[y * TILE + x] = crackLine(x + crackBend(x, y) * 10, y + crackBend(y, x) * 10);
  }
  const at = (x: number, y: number) => field[(y & TILE_MASK) * TILE + (x & TILE_MASK)];
  const tile = new Uint8Array(TILE * TILE * 3);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const m = mottle(x, y) * 0.6 + fine(x, y) * 0.4;
      let r = 214 + m * 18;
      let g = 156 + m * 16;
      let b = 86 + m * 12;

      // Dots: a lighter round bump in some cells, lit from the upper left.
      dots.nearest(x, y);
      const size = dots.value(dots.id);
      const radius = 2.5 + size * 4;
      if (size > 0.3 && dots.f1 < radius + 1) {
        const cover = smoothstep(radius + 1, radius - 1, dots.f1);
        const nx = dots.dx / radius;
        const ny = dots.dy / radius;
        const light = 1 + 0.35 * (-nx * 0.7 - ny * 0.7) * smoothstep(0.3, 1, Math.hypot(nx, ny));
        r += (246 * light - r) * cover;
        g += (210 * light - g) * cover;
        b += (148 * light - b) * cover;
      }

      // Distance to the zero crossing in pixels (value over slope) keeps the lines evenly
      // thin; they fade out in places so they break up.
      const slope = Math.hypot(at(x + 1, y) - at(x - 1, y), at(x, y + 1) - at(x, y - 1)) / 2;
      const distance = Math.abs(at(x, y)) / Math.max(slope, 1e-4);
      const crack = (1 - smoothstep(0.4, 1.6, distance)) * smoothstep(0, 0.4, crackFade(x, y));
      r *= 1 - 0.5 * crack;
      g *= 1 - 0.55 * crack;
      b *= 1 - 0.6 * crack;

      const grain = 1 + (hash(x, y) - 0.5) * 0.07;
      const o = (y * TILE + x) * 3;
      tile[o] = clamp255(r * grain);
      tile[o + 1] = clamp255(g * grain);
      tile[o + 2] = clamp255(b * grain);
    }
  }
  return tile;
}

/** Material 2: blue-grey cobblestones, each one rounded and lit, with dark gaps between. */
function cobblestoneTile(): Uint8Array {
  const rand = mulberry32(2);
  const noise = createNoise4D(rand);
  const mottle = wrappingNoise(noise, 9, 0);
  const stones = new Cells(7, rand);
  const height = new Float32Array(TILE * TILE);
  const ids = new Int32Array(TILE * TILE);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      stones.nearest(x, y);
      // f2 - f1 is about twice the distance to the gap between two stones.
      height[y * TILE + x] = Math.sqrt(smoothstep(1.5, 18, stones.f2 - stones.f1));
      ids[y * TILE + x] = stones.id;
    }
  }
  const at = (x: number, y: number) => height[(y & TILE_MASK) * TILE + (x & TILE_MASK)];
  const tile = new Uint8Array(TILE * TILE * 3);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const i = y * TILE + x;
      const h = height[i];
      const gx = (at(x + 1, y) - at(x - 1, y)) * 4;
      const gy = (at(x, y + 1) - at(x, y - 1)) * 4;
      const lit = (LIGHT[2] - gx * LIGHT[0] - gy * LIGHT[1]) / Math.sqrt(1 + gx * gx + gy * gy);
      const shade = 1 + 0.9 * (lit - LIGHT[2]);
      const tone = stones.value(ids[i]);
      const m = mottle(x, y) * 0.06 + (hash(x, y) - 0.5) * 0.08;
      const stoneR = (112 + tone * 34) * (1 + m);
      const stoneG = (126 + tone * 32) * (1 + m);
      const stoneB = (148 + tone * 30) * (1 + m);
      const gap = 1 - smoothstep(0, 0.35, h);
      const o = i * 3;
      tile[o] = clamp255((stoneR + (50 - stoneR) * gap) * shade);
      tile[o + 1] = clamp255((stoneG + (56 - stoneG) * gap) * shade);
      tile[o + 2] = clamp255((stoneB + (72 - stoneB) * gap) * shade);
    }
  }
  return tile;
}

/**
 * Simplex noise that repeats every TILE pixels: each tile axis is wrapped into a circle in 4D.
 * `features` is roughly how many blobs fit across the tile; `offset` decorrelates fields.
 */
function wrappingNoise(noise: NoiseFunction4D, features: number, offset: number) {
  const radius = features / TAU;
  return (x: number, y: number): number => {
    const a = (x / TILE) * TAU;
    const b = (y / TILE) * TAU;
    return noise(Math.cos(a) * radius + offset, Math.sin(a) * radius, Math.cos(b) * radius, Math.sin(b) * radius);
  };
}

/**
 * Cell (Worley) noise that wraps around the tile: one random point per cell of an n × n grid.
 * `nearest` finds the closest point and stores its distance, offset and id, plus the
 * distance to the second closest.
 */
class Cells {
  f1 = 0;
  f2 = 0;
  dx = 0;
  dy = 0;
  id = 0;
  private readonly size: number;
  private readonly points: Float32Array;
  private readonly values: Float32Array;

  constructor(private readonly n: number, rand: () => number) {
    this.size = TILE / n;
    this.points = Float32Array.from({ length: n * n * 2 }, () => 0.1 + rand() * 0.8);
    this.values = Float32Array.from({ length: n * n }, rand);
  }

  /** A random 0..1 value that belongs to a cell. */
  value(id: number): number {
    return this.values[id];
  }

  nearest(x: number, y: number): void {
    const { n, size, points } = this;
    const cx = Math.floor(x / size);
    const cy = Math.floor(y / size);
    this.f1 = Infinity;
    this.f2 = Infinity;
    for (let j = cy - 1; j <= cy + 1; j++) {
      for (let i = cx - 1; i <= cx + 1; i++) {
        const id = (((j % n) + n) % n) * n + (((i % n) + n) % n);
        const dx = x + 0.5 - (i + points[id * 2]) * size;
        const dy = y + 0.5 - (j + points[id * 2 + 1]) * size;
        const d = Math.hypot(dx, dy);
        if (d < this.f1) {
          this.f2 = this.f1;
          this.f1 = d;
          this.dx = dx;
          this.dy = dy;
          this.id = id;
        } else if (d < this.f2) this.f2 = d;
      }
    }
  }
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function normalize(x: number, y: number, z: number): [number, number, number] {
  const len = Math.hypot(x, y, z);
  return [x / len, y / len, z / len];
}

function clamp255(v: number): number {
  return Math.min(255, Math.max(0, Math.round(v)));
}

/** Cheap per-pixel pseudo-random value in 0..1 for grain. */
function hash(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
