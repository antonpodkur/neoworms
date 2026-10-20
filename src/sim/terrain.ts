export interface Vec2 {
  x: number;
  y: number;
}

/**
 * Destructible terrain stored as a pixel mask, like the original Worms: 0 = air, anything
 * else = ground (the value is the ground's material, which only changes how it's drawn).
 * Everything outside the map counts as air.
 */
export class Terrain {
  readonly mask: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    mask?: Uint8Array,
  ) {
    this.mask = mask ?? new Uint8Array(width * height);
  }

  isSolid(x: number, y: number): boolean {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= this.width || iy >= this.height) return false;
    return this.mask[iy * this.width + ix] !== 0;
  }

  /** Sets ground on/off for every pixel whose center lies inside the circle. */
  fillCircle(cx: number, cy: number, r: number, solid: boolean): void {
    const value = solid ? 1 : 0;
    const r2 = r * r;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(this.width - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(this.height - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        if (dx * dx + dy * dy <= r2) this.mask[y * this.width + x] = value;
      }
    }
  }

  carve(cx: number, cy: number, r: number): void {
    this.fillCircle(cx, cy, r, false);
  }

  /** True if a disc of radius r at (cx, cy) touches no ground. */
  discFree(cx: number, cy: number, r: number): boolean {
    const offsets = discOffsets(r);
    for (let i = 0; i < offsets.length; i += 2) {
      if (this.isSolid(cx + offsets[i], cy + offsets[i + 1])) return false;
    }
    return true;
  }

  /**
   * Walks from (x0, y0) toward (x1, y1) in half-pixel steps, ignoring the first `skip`
   * pixels. Returns the first ground point hit and the last open point just before it,
   * or null if the whole path is open.
   */
  raycast(x0: number, y0: number, x1: number, y1: number, skip = 0): { hit: Vec2; before: Vec2 } | null {
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len === 0) return null;
    const ux = (x1 - x0) / len;
    const uy = (y1 - y0) / len;
    let px = x0;
    let py = y0;
    for (let t = skip; t <= len; t += 0.5) {
      const x = x0 + ux * t;
      const y = y0 + uy * t;
      if (this.isSolid(x, y)) return { hit: { x, y }, before: { x: px, y: py } };
      px = x;
      py = y;
    }
    return null;
  }

  /**
   * Surface normal near (cx, cy), pointing from the nearby ground toward open air.
   * Null when there is no ground within r (or it surrounds the point evenly).
   */
  normalAt(cx: number, cy: number, r: number): Vec2 | null {
    const offsets = discOffsets(r);
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < offsets.length; i += 2) {
      if (this.isSolid(cx + offsets[i], cy + offsets[i + 1])) {
        sx -= offsets[i];
        sy -= offsets[i + 1];
      }
    }
    const len = Math.hypot(sx, sy);
    return len === 0 ? null : { x: sx / len, y: sy / len };
  }
}

const discCache = new Map<number, Int16Array>();

/** Flat [dx0, dy0, dx1, dy1, ...] integer offsets covering a disc of radius r. */
function discOffsets(r: number): Int16Array {
  const radius = Math.round(r);
  let offsets = discCache.get(radius);
  if (!offsets) {
    const list: number[] = [];
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= radius * radius) list.push(dx, dy);
      }
    }
    offsets = Int16Array.from(list);
    discCache.set(radius, offsets);
  }
  return offsets;
}
