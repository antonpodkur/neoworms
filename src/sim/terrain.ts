export interface Vec2 {
  x: number;
  y: number;
}

/**
 * Destructible terrain stored as a pixel mask (1 = ground, 0 = air), like the original Worms.
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
    return this.mask[iy * this.width + ix] === 1;
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
