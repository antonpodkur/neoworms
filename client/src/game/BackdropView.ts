import Phaser from 'phaser';
import { createNoise4D, type NoiseFunction4D } from 'simplex-noise';
import { mulberry32 } from '../sim/rng';
import { wrappingNoise } from './procedural';
import { rippleTexture } from './WaterView';

export type BackdropKind = 'sky' | 'cave';

/**
 * Parallax layers behind the terrain, each drawn once into a canvas texture that repeats
 * sideways. The farther a layer, the slower it scrolls (`parallax`), the paler and softer it is.
 */
interface Layer {
  key: string;
  height: number;
  parallax: number;
  /** Blur in pixels, for distance. */
  blur: number;
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
}

/** Width of every layer's texture; it repeats across the world. */
const LAYER_WIDTH = 2048;
/** The layers reach this far around the map, which covers the widest zoomed-out view. */
const REACH = 4000;
/** How far above the water the horizon sits. */
const HORIZON = 320;
const SKY = ['#2b86d4', '#63bdeb', '#cdf1f6'];
const FAR_SEA = ['#a9eadc', '#5ad9b6', '#33cc9f'];
const CAVE = ['#120d0b', '#271b15', '#3d2c23'];
const CLOUD_DRIFT = 4; // px per second

/** Sky, clouds, distant islands and the sea out to the horizon; or dark rock for cave maps. */
export class BackdropView {
  private readonly drifting: Phaser.GameObjects.TileSprite[] = [];

  constructor(scene: Phaser.Scene, kind: BackdropKind, width: number, depth: number, top: number, bottom: number, waterLevel: number) {
    const left = -REACH;
    const span = width + REACH * 2;
    const noise = createNoise4D(mulberry32(11));
    if (kind === 'sky') {
      const horizon = waterLevel - HORIZON;
      gradient(scene, 'backdrop-sky', SKY, left, top, span, horizon - top, depth);
      gradient(scene, 'backdrop-far-sea', FAR_SEA, left, horizon, span, bottom - horizon, depth);
      // Sun glints on the far sea: the water's ripple lines, squashed flat by distance.
      scene.add
        .tileSprite(left, horizon, span, bottom - horizon, rippleTexture(scene))
        .setOrigin(0, 0)
        .setTileScale(2.5, 0.22)
        .setAlpha(0.16)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setScrollFactor(0.4, 1)
        .setDepth(depth);
      this.drifting.push(this.layer(scene, layers.clouds(noise), left, horizon - 820, span, depth));
      // Their (clear) bottom row sits just below the horizon, so the islands stand on it.
      this.layer(scene, layers.islands(noise, 'far'), left, horizon - 210 + 2, span, depth);
      this.layer(scene, layers.islands(noise, 'near'), left, horizon - 160 + 2, span, depth);
      scene.cameras.main.setBackgroundColor(SKY[0]);
    } else {
      gradient(scene, 'backdrop-cave', CAVE, left, top, span, bottom - top, depth);
      this.layer(scene, layers.caveRoof(noise, 'far'), left, top, span, depth);
      this.layer(scene, layers.caveRoof(noise, 'near'), left, top, span, depth);
      this.layer(scene, layers.caveFloor(noise, 'far'), left, waterLevel - 360, span, depth);
      this.layer(scene, layers.caveFloor(noise, 'near'), left, waterLevel - 300, span, depth);
      scene.cameras.main.setBackgroundColor(CAVE[0]);
    }
  }

  update(time: number): void {
    for (const sprite of this.drifting) sprite.tilePositionX = (time / 1000) * CLOUD_DRIFT;
  }

  private layer(scene: Phaser.Scene, layer: Layer, x: number, y: number, span: number, depth: number) {
    if (!scene.textures.exists(layer.key)) drawLayer(scene, layer);
    return scene.add
      .tileSprite(x, y, span, layer.height, layer.key)
      .setOrigin(0, 0)
      .setScrollFactor(layer.parallax, 1)
      .setDepth(depth);
  }
}

/** A vertical gradient stretched over (x, y, w, h), from a tiny texture. */
function gradient(scene: Phaser.Scene, key: string, colors: string[], x: number, y: number, w: number, h: number, depth: number) {
  if (!scene.textures.exists(key)) {
    const tex = scene.textures.createCanvas(key, 2, 256)!;
    const fill = tex.context.createLinearGradient(0, 0, 0, 256);
    colors.forEach((color, i) => fill.addColorStop(i / (colors.length - 1), color));
    tex.context.fillStyle = fill;
    tex.context.fillRect(0, 0, 2, 256);
    tex.refresh();
  }
  scene.add.image(x, y, key).setOrigin(0, 0).setDisplaySize(w, h).setDepth(depth);
}

/**
 * Draws a layer three tiles wide and keeps the middle one, so shapes and blur that cross the
 * tile's edges carry on seamlessly into the next repeat.
 */
function drawLayer(scene: Phaser.Scene, layer: Layer): void {
  const wide = document.createElement('canvas');
  wide.width = LAYER_WIDTH * 3;
  wide.height = layer.height;
  const ctx = wide.getContext('2d')!;
  ctx.translate(LAYER_WIDTH, 0);
  for (const shift of [-LAYER_WIDTH, 0, LAYER_WIDTH]) {
    ctx.save();
    ctx.translate(shift, 0);
    layer.draw(ctx, LAYER_WIDTH, layer.height);
    ctx.restore();
  }
  const tex = scene.textures.createCanvas(layer.key, LAYER_WIDTH, layer.height)!;
  tex.context.filter = layer.blur > 0 ? `blur(${layer.blur}px)` : 'none';
  tex.context.drawImage(wide, -LAYER_WIDTH, 0);
  // The layer repeats vertically too; clear rows keep its top and bottom edges from bleeding into each other.
  tex.context.clearRect(0, 0, LAYER_WIDTH, 1);
  tex.context.clearRect(0, layer.height - 1, LAYER_WIDTH, 1);
  tex.refresh();
}

/** A ridge across the tile that repeats every LAYER_WIDTH: heights in 0..1 for each x. */
function ridge(noise: NoiseFunction4D, features: number, offset: number): (x: number) => number {
  const coarse = wrappingNoise(noise, LAYER_WIDTH, features, offset);
  const fine = wrappingNoise(noise, LAYER_WIDTH, features * 4, offset + 30);
  return (x) => coarse(x, 0) * 0.8 + fine(x, 0) * 0.2;
}

const layers = {
  /** Big soft cumulus clouds, white on top and blue-grey underneath. */
  clouds(noise: NoiseFunction4D): Layer {
    return {
      key: 'backdrop-clouds',
      height: 520,
      parallax: 0.1,
      blur: 1.5,
      draw(ctx, width) {
        // A few separate heaps of different sizes at different heights, with sky between.
        const rand = mulberry32(21);
        const count = 4;
        for (let i = 0; i < count; i++) {
          const cx = ((i + 0.25 + rand() * 0.5) / count) * width;
          const size = 55 + rand() * 75;
          const base = 230 + rand() * 260;
          cloud(ctx, cx, base, size, rand, noise);
        }
      },
    };
  },

  /** Hazy island silhouettes on the horizon; the far row is paler. The near row has a lighthouse. */
  islands(noise: NoiseFunction4D, row: 'far' | 'near'): Layer {
    const far = row === 'far';
    return {
      key: `backdrop-islands-${row}`,
      height: far ? 210 : 160,
      parallax: far ? 0.18 : 0.3,
      blur: far ? 1.5 : 0.8,
      draw(ctx, width, height) {
        const land = ridge(noise, far ? 5 : 7, far ? 300 : 400);
        const peaks = ridge(noise, far ? 9 : 12, far ? 500 : 600);
        ctx.fillStyle = far ? '#9fd6ec' : '#76bde3';
        ctx.beginPath();
        ctx.moveTo(0, height);
        let tallest = { x: 0, y: height };
        for (let x = 0; x <= width; x += 4) {
          // Islands rise where `land` is high and leave open sea between them.
          const rise = Math.max(0, land(x) - 0.05) / 0.95;
          const y = height - Math.min(1, rise * 2.2) * (height * 0.55 + peaks(x) * height * 0.35);
          if (y < tallest.y) tallest = { x, y };
          ctx.lineTo(x, y);
        }
        ctx.lineTo(width, height);
        ctx.fill();
        if (!far) lighthouse(ctx, tallest.x, tallest.y + 6);
      },
    };
  },

  /** Stalactites hanging from a dark roof, fading into the cave's haze. */
  caveRoof(noise: NoiseFunction4D, row: 'far' | 'near'): Layer {
    const far = row === 'far';
    return {
      key: `backdrop-roof-${row}`,
      height: far ? 420 : 320,
      parallax: far ? 0.3 : 0.5,
      blur: far ? 2 : 1,
      draw(ctx, width, height) {
        const shape = ridge(noise, far ? 10 : 14, far ? 700 : 800);
        ctx.fillStyle = far ? '#33251e' : '#221812';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        for (let x = 0; x <= width; x += 3) {
          // Sharpened so the low points become long spikes.
          const v = Math.max(0, shape(x) + 0.3) / 1.3;
          ctx.lineTo(x, height * (0.15 + 0.85 * v ** 3));
        }
        ctx.lineTo(width, 0);
        ctx.fill();
      },
    };
  },

  /** Rock mounds and pillars rising from the cave floor. */
  caveFloor(noise: NoiseFunction4D, row: 'far' | 'near'): Layer {
    const far = row === 'far';
    return {
      key: `backdrop-floor-${row}`,
      height: far ? 380 : 320,
      parallax: far ? 0.3 : 0.5,
      blur: far ? 2 : 1,
      draw(ctx, width, height) {
        const shape = ridge(noise, far ? 6 : 9, far ? 900 : 1000);
        ctx.fillStyle = far ? '#3a2a21' : '#281c16';
        ctx.beginPath();
        ctx.moveTo(0, height);
        for (let x = 0; x <= width; x += 3) {
          const v = Math.max(0, shape(x) + 0.35) / 1.35;
          ctx.lineTo(x, height * (1 - 0.9 * v ** 2));
        }
        ctx.lineTo(width, height);
        ctx.fill();
      },
    };
  },
};

/** One cumulus cloud: a flat-bottomed heap of round puffs, shaded blue-grey toward the base. */
function cloud(ctx: CanvasRenderingContext2D, cx: number, base: number, size: number, rand: () => number, noise: NoiseFunction4D) {
  const puffs: { x: number; y: number; r: number }[] = [];
  const count = 7 + Math.floor(rand() * 5);
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1) - 0.5;
    // Bigger puffs in the middle, so the heap rises to a crown.
    const r = size * (0.45 + 0.55 * (1 - Math.abs(t) * 1.6)) * (0.8 + rand() * 0.4);
    puffs.push({ x: cx + t * size * 4.2, y: base - r * (0.55 + rand() * 0.35), r });
  }
  puffs.push({ x: cx + (noise(cx, base, 0, 0) - 0.5) * size, y: base - size * 1.25, r: size * 0.9 });
  ctx.save();
  // A flat base, as if the cloud sat on a layer of air.
  ctx.beginPath();
  ctx.rect(cx - size * 4, 0, size * 8, base);
  ctx.clip();
  ctx.fillStyle = '#b4d3ec';
  for (const p of puffs) circle(ctx, p.x, p.y, p.r);
  // Lit from above: each puff's top is white, fading toward the shaded base.
  const light = ctx.createLinearGradient(0, base - size * 2.2, 0, base);
  light.addColorStop(0, '#ffffff');
  light.addColorStop(0.65, '#f2f8fc');
  light.addColorStop(1, '#d3e6f4');
  ctx.fillStyle = light;
  for (const p of puffs) circle(ctx, p.x - p.r * 0.08, p.y - p.r * 0.12, p.r * 0.9);
  ctx.restore();
}

/** A small lighthouse silhouette standing at (x, y). */
function lighthouse(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = '#5ea9d5';
  ctx.beginPath();
  ctx.moveTo(x - 7, y);
  ctx.lineTo(x - 4, y - 46);
  ctx.lineTo(x + 4, y - 46);
  ctx.lineTo(x + 7, y);
  ctx.fill();
  ctx.fillRect(x - 6, y - 50, 12, 4);
  ctx.fillRect(x - 3.5, y - 58, 7, 8);
  ctx.beginPath();
  ctx.moveTo(x - 5, y - 58);
  ctx.lineTo(x, y - 64);
  ctx.lineTo(x + 5, y - 58);
  ctx.fill();
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}
