import Phaser from 'phaser';
import { createNoise2D } from 'simplex-noise';
import type { Terrain } from '../sim/terrain';

const KEY = 'terrain';
const SCORCH_WIDTH = 4;

/** Draws the terrain mask into a canvas texture and mirrors every hole the simulation carves. */
export class TerrainView {
  private readonly texture: Phaser.Textures.CanvasTexture;
  private dirty = false;

  constructor(scene: Phaser.Scene, terrain: Terrain, depth: number) {
    if (scene.textures.exists(KEY)) scene.textures.remove(KEY);
    this.texture = scene.textures.createCanvas(KEY, terrain.width, terrain.height)!;
    paint(this.texture.context, terrain);
    this.texture.refresh();
    scene.add.image(0, 0, KEY).setOrigin(0, 0).setDepth(depth);
  }

  /** Scorches the rim of the hole, then erases the hole itself. */
  carve(x: number, y: number, r: number): void {
    const ctx = this.texture.context;
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop'; // only darken existing ground
    ctx.fillStyle = '#3a2416';
    fillCircle(ctx, x, y, r + SCORCH_WIDTH);
    ctx.globalCompositeOperation = 'destination-out';
    fillCircle(ctx, x, y, r);
    ctx.restore();
    this.dirty = true;
  }

  /** Uploads changes to the GPU at most once per frame, however many holes were made. */
  flush(): void {
    if (!this.dirty) return;
    this.texture.refresh();
    this.dirty = false;
  }
}

/**
 * Grass on every upward-facing surface, mottled soil with pebbles below, darker with depth.
 * Material 2 (the second ground colour in imported maps) is drawn as grey-blue stone.
 */
function paint(ctx: CanvasRenderingContext2D, terrain: Terrain): void {
  const { width, height, mask } = terrain;
  const image = ctx.createImageData(width, height);
  const px = image.data;
  const noise = createNoise2D();
  // Ground pixels since the last air pixel, per column. Starts high so ground touching the
  // top of the map (a cavern roof) doesn't get grass.
  const depth = new Uint16Array(width).fill(1000);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i]) {
        depth[x] = 0;
        continue;
      }
      const d = ++depth[x];
      let r: number;
      let g: number;
      let b: number;
      if (mask[i] === 2) {
        const mottle = noise(x / 18 + 700, y / 18) * 0.5 + 0.5;
        [r, g, b] = [118 - mottle * 26, 128 - mottle * 24, 146 - mottle * 20];
      } else if (d <= 2) [r, g, b] = [158, 222, 96];
      else if (d <= 6) [r, g, b] = [104, 176, 68];
      else if (d <= 9) [r, g, b] = [86, 122, 50];
      else {
        const mottle = noise(x / 14, y / 14) * 0.5 + 0.5;
        const deep = y / height; // darker toward the bottom of the map
        r = 134 - mottle * 30 - deep * 44;
        g = 90 - mottle * 22 - deep * 32;
        b = 58 - mottle * 14 - deep * 18;
        if (noise(x / 4 + 300, y / 4) > 0.8) {
          r += 34;
          g += 28;
          b += 22;
        }
      }
      const jitter = (hash(x, y) - 0.5) * 16;
      const o = i * 4;
      px[o] = r + jitter;
      px[o + 1] = g + jitter;
      px[o + 2] = b + jitter;
      px[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

function fillCircle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** Cheap per-pixel pseudo-random value in 0..1 for grain. */
function hash(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
