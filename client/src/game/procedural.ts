/** Building blocks for textures made in code: noise and cell patterns that tile seamlessly. */
import type { NoiseFunction4D } from 'simplex-noise';

const TAU = Math.PI * 2;

/**
 * Simplex noise that repeats every `size` pixels: each tile axis is wrapped into a circle in 4D.
 * `features` is roughly how many blobs fit across the tile; `offset` decorrelates fields.
 */
export function wrappingNoise(noise: NoiseFunction4D, size: number, features: number, offset: number) {
  const radius = features / TAU;
  return (x: number, y: number): number => {
    const a = (x / size) * TAU;
    const b = (y / size) * TAU;
    return noise(Math.cos(a) * radius + offset, Math.sin(a) * radius, Math.cos(b) * radius, Math.sin(b) * radius);
  };
}

/**
 * Cell (Worley) noise that wraps around a tile: one random point per cell of an n × n grid.
 * `nearest` finds the closest point and stores its distance, offset and id, plus the
 * distance to the second closest.
 */
export class Cells {
  f1 = 0;
  f2 = 0;
  dx = 0;
  dy = 0;
  id = 0;
  private readonly size: number;
  private readonly points: Float32Array;
  private readonly values: Float32Array;

  constructor(
    private readonly n: number,
    tileSize: number,
    rand: () => number,
  ) {
    this.size = tileSize / n;
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

/** Box blur of a square tile's values (`size` a power of two) that wraps around its edges. */
export function blurTile(values: Float32Array, size: number, radius: number): Float32Array {
  const mask = size - 1;
  const across = new Float32Array(values.length);
  const out = new Float32Array(values.length);
  const n = 2 * radius + 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += values[y * size + ((x + k) & mask)];
      across[y * size + x] = sum / n;
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += across[((y + k) & mask) * size + x];
      out[y * size + x] = sum / n;
    }
  }
  return out;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function clamp255(v: number): number {
  return Math.min(255, Math.max(0, Math.round(v)));
}

/** Cheap per-pixel pseudo-random value in 0..1 for grain. */
export function hash(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
