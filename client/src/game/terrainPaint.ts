/**
 * The terrain's look, computed on the CPU into an RGBA buffer (no Phaser here, so it runs in
 * tests too). Ground is a tiling material, lit as if it were a thick slab with rounded edges:
 * the slab's height comes from blurring the mask. Behind it sits a dark copy of the map as it
 * was built, so craters read as holes dug into the slab rather than windows to the sky.
 */
import { createNoise2D, createNoise4D } from 'simplex-noise';
import { mulberry32 } from '../sim/rng';
import type { Terrain } from '../sim/terrain';
import { blurTile, Cells, clamp255, hash, smoothstep, wrappingNoise } from './procedural';

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
/** How much a slope facing toward the light brightens it, and one facing away darkens it. */
const LIGHT_GAIN = 1.1;
const SHADOW_GAIN = 0.7;
/**
 * Colour of the light by which way a slope faces: warm sun on the tops, cool green bounced up
 * from the water on the undersides (multipliers, reached when facing straight up or down).
 */
const SUN_TINT = [1.06, 1.02, 0.9];
const BOUNCE_TINT = [0.7, 0.98, 0.9];
/** Ground this close above the water picks up its green. */
const WATER_GLOW = 90;
const WATER_TINT = [0.84, 1.0, 1.08];
/** Darkening right at the edge, fading out a few pixels in. */
const EDGE_DARK = 0.3;
const EDGE_SOFT = 0.25;
/** The burnt ring around a crater: how wide it gets, in pixels, and its colour. */
const SCORCH_WIDTH = 5;
const SCORCH = [40, 24, 18];
/** Soil and stone touching: how dark the seam between them is. */
const SEAM_DARK = 0.35;
/** The back wall: dark rock (textured with the stone tile), and the shadow the ground in front casts on it. */
const BACK = [46, 44, 52];
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

  /** `waterLevel` is the y of the water's surface; ground just above it is tinted green. */
  constructor(
    private readonly terrain: Terrain,
    private readonly waterLevel = Infinity,
  ) {
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
    const { sand, stone } = materials();
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
        const wet = smoothstep(WATER_GLOW, 0, this.waterLevel - y);
        let r = 0;
        let g = 0;
        let b = 0;
        if (front > 0) {
          const tile = solid === 2 ? stone : sand;
          const gx = (PROFILE[sum[f + 1]] - PROFILE[sum[f - 1]]) * BEVEL_STRENGTH;
          const gy = (PROFILE[sum[f + stride]] - PROFILE[sum[f - stride]]) * BEVEL_STRENGTH;
          const len = Math.sqrt(1 + gx * gx + gy * gy);
          const lit = (LIGHT[2] - gx * LIGHT[0] - gy * LIGHT[1]) / len;
          // +1 facing straight up, -1 straight down.
          const up = gy / len;
          const tint = up > 0 ? SUN_TINT : BOUNCE_TINT;
          const facing = Math.abs(up);
          const edge = 1 - EDGE_DARK * (1 - smoothstep(0, EDGE_SOFT, PROFILE[sum[f]]));
          const seam = touchesOther(mask, i, x, width, solid) ? 1 - SEAM_DARK : 1;
          const shade = (1 + (lit > LIGHT[2] ? LIGHT_GAIN : SHADOW_GAIN) * (lit - LIGHT[2])) * edge * seam * drift;
          const burn = this.scorch[i] / 255;
          const k = shade * (1 - burn) * front;
          r = tile[t] * k * (1 + (tint[0] - 1) * facing) * (1 + (WATER_TINT[0] - 1) * wet) + SCORCH[0] * burn * front;
          g = tile[t + 1] * k * (1 + (tint[1] - 1) * facing) * (1 + (WATER_TINT[1] - 1) * wet) + SCORCH[1] * burn * front;
          b = tile[t + 2] * k * (1 + (tint[2] - 1) * facing) * (1 + (WATER_TINT[2] - 1) * wet) + SCORCH[2] * burn * front;
        }
        // The back wall shows where the ground in front doesn't cover it.
        const behind = back - front;
        if (behind > 0) {
          const caster = sum[f - SHADOW_Y * stride - SHADOW_X] / FULL;
          // Rock textured with the stone tile at twice the size, so it never lines up with stones in front.
          const rt = ((((y >> 1) + 97) & TILE_MASK) * TILE + (((x >> 1) + 211) & TILE_MASK)) * 3;
          const rock = 0.6 + (0.8 * (stone[rt] + stone[rt + 1] + stone[rt + 2])) / 765;
          const shade = rock * drift * (1 - SHADOW_DARK * smoothstep(0.25, 0.75, caster)) * behind;
          r += BACK[0] * shade;
          g += BACK[1] * shade;
          b += BACK[2] * shade;
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
const TILE = 512;
const TILE_MASK = TILE - 1;

let cachedMaterials: { sand: Uint8Array; stone: Uint8Array } | null = null;

/** The two ground materials as seamless RGB tiles, made once and reused by every map. */
function materials(): { sand: Uint8Array; stone: Uint8Array } {
  cachedMaterials ??= { sand: sandTile(), stone: cobblestoneTile() };
  return cachedMaterials;
}

/** Material 1: warm sand in big puffy plates with dark grooves, a few light dots and small pits. */
function sandTile(): Uint8Array {
  const rand = mulberry32(1);
  const noise = createNoise4D(rand);
  const mottle = wrappingNoise(noise, TILE, 6, 0);
  const warpX = wrappingNoise(noise, TILE, 5, 200);
  const warpY = wrappingNoise(noise, TILE, 5, 240);
  const plates = new Cells(6, TILE, rand);
  const spots = new Cells(24, TILE, rand);
  const height = new Float32Array(TILE * TILE);
  const ids = new Int32Array(TILE * TILE);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      // Bending the lookup turns the cells' straight edges into lumpy, rounded plates.
      plates.nearest(x + warpX(x, y) * 14, y + warpY(x, y) * 14);
      // f2 - f1 is about twice the distance to the groove between two plates.
      height[y * TILE + x] = Math.sqrt(smoothstep(0.5, 22, plates.f2 - plates.f1));
      ids[y * TILE + x] = plates.id;
    }
  }
  // Softened, so the plates are smooth pillows without creases.
  const soft = blurTile(height, TILE, 2);
  const at = (x: number, y: number) => soft[(y & TILE_MASK) * TILE + (x & TILE_MASK)];
  const tile = new Uint8Array(TILE * TILE * 3);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const i = y * TILE + x;
      const h = height[i];
      const shade = slopeShade(at(x + 1, y) - at(x - 1, y), at(x, y + 1) - at(x, y - 1), 6, 0.8);
      // Some plates are paler and yellower, some more orange.
      const tone = plates.value(ids[i]);
      const m = 1 + mottle(x, y) * 0.05 + (hash(x, y) - 0.5) * 0.05;
      let r = (238 - tone * 16) * m;
      let g = (200 - tone * 28) * m;
      let b = (118 - tone * 32) * m;
      const groove = 1 - smoothstep(0, 0.4, h);
      r += (130 - r) * groove;
      g += (82 - g) * groove;
      b += (42 - b) * groove;

      // On the plates' tops: light dots, and now and then a small round pit.
      spots.nearest(x, y);
      const kind = spots.value(spots.id);
      const top = smoothstep(0.6, 0.85, h);
      if (kind > 0.7 && top > 0) {
        const pit = kind > 0.95;
        const radius = pit ? 2.5 + (kind - 0.95) * 30 : 2.2 + (kind - 0.7) * 8;
        const cover = smoothstep(radius + 0.8, radius - 0.8, spots.f1) * top;
        if (cover > 0) {
          // A pit's lower-right inside wall faces the light; a dot is flat.
          const wall = pit ? 1 + (0.45 * (spots.dx + spots.dy)) / radius : 1;
          const [pr, pg, pb] = pit ? [190, 116, 52] : [252, 240, 182];
          r += (pr * wall - r) * cover;
          g += (pg * wall - g) * cover;
          b += (pb * wall - b) * cover;
        }
      }
      const o = i * 3;
      tile[o] = clamp255(r * shade);
      tile[o + 1] = clamp255(g * shade);
      tile[o + 2] = clamp255(b * shade);
    }
  }
  return tile;
}

/** Material 2: slate-blue cobblestones, each one rounded and lit, with dark gaps between. */
function cobblestoneTile(): Uint8Array {
  const rand = mulberry32(2);
  const noise = createNoise4D(rand);
  const mottle = wrappingNoise(noise, TILE, 18, 0);
  const stones = new Cells(14, TILE, rand);
  const height = new Float32Array(TILE * TILE);
  const ids = new Int32Array(TILE * TILE);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      stones.nearest(x, y);
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
      const shade = slopeShade(at(x + 1, y) - at(x - 1, y), at(x, y + 1) - at(x, y - 1), 4, 0.9);
      const tone = stones.value(ids[i]);
      const m = 1 + mottle(x, y) * 0.06 + (hash(x, y) - 0.5) * 0.08;
      const stoneR = (96 + tone * 30) * m;
      const stoneG = (106 + tone * 28) * m;
      const stoneB = (122 + tone * 26) * m;
      const gap = 1 - smoothstep(0, 0.35, h);
      const o = i * 3;
      tile[o] = clamp255((stoneR + (40 - stoneR) * gap) * shade);
      tile[o + 1] = clamp255((stoneG + (44 - stoneG) * gap) * shade);
      tile[o + 2] = clamp255((stoneB + (56 - stoneB) * gap) * shade);
    }
  }
  return tile;
}

/** Brightness of a bump in a tile lit from the upper left, from its height differences across x and y. */
function slopeShade(dx: number, dy: number, steepness: number, gain: number): number {
  const gx = dx * steepness;
  const gy = dy * steepness;
  const lit = (LIGHT[2] - gx * LIGHT[0] - gy * LIGHT[1]) / Math.sqrt(1 + gx * gx + gy * gy);
  return 1 + gain * (lit - LIGHT[2]);
}

function normalize(x: number, y: number, z: number): [number, number, number] {
  const len = Math.hypot(x, y, z);
  return [x / len, y / len, z / len];
}
