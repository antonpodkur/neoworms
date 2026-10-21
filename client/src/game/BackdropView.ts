import Phaser from 'phaser';
import { rippleTexture } from './WaterView';

export type BackdropKind = 'sky' | 'cave';

/**
 * A parallax layer behind the terrain, drawn once into a canvas texture that repeats sideways.
 * The farther a layer, the slower it scrolls (`parallax`), the paler and softer it is.
 */
interface Layer {
  key: string;
  height: number;
  parallax: number;
  /** Blur in pixels, for distance. */
  blur: number;
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
}

/**
 * A layer rendered in Blender (art/backdrop/<theme>.blend, `npm run backdrops`), placed by a
 * line in the world (`anchor`): its strip's lower edge sits `offset` px above the sea's horizon
 * or the water, or its upper edge `offset` px below the top of the map. It slides sideways
 * `drift` px/s on its own.
 */
interface RenderedLayer {
  name: string;
  anchor: 'horizon' | 'water' | 'top';
  offset: number;
  height: number;
  parallax: number;
  blur: number;
  drift: number;
}

/** Which rendered backdrop each kind of map gets. */
const THEMES: Record<BackdropKind, string> = { sky: 'seaside', cave: 'cave' };
const LAYER_LISTS = import.meta.glob<RenderedLayer[]>('/backdrops/*/layers.json', { eager: true, import: 'default' });
const LAYER_IMAGES = import.meta.glob<string>('/backdrops/*/*.png', { eager: true, query: '?url', import: 'default' });
const layersOf = (theme: string) => LAYER_LISTS[`/backdrops/${theme}/layers.json`];
const imageKey = (theme: string, name: string) => `backdrop-${theme}-${name}`;

/** Width of every layer's texture; it repeats across the world. */
const LAYER_WIDTH = 2048;
/** The layers reach this far around the map, which covers the widest zoomed-out view. */
const REACH = 4000;
/** How far above the water the horizon sits. */
const HORIZON = 320;
const SKY = ['#2b86d4', '#63bdeb', '#cdf1f6'];
const FAR_SEA = ['#a9eadc', '#5ad9b6', '#33cc9f'];
const CAVE = ['#120d0b', '#271b15', '#3d2c23'];

/**
 * Sky, clouds, distant islands and the sea out to the horizon; or dark rock for cave maps.
 * The gradients are made here; the layers in front of them are rendered in Blender.
 */
export class BackdropView {
  private readonly drifting: { sprite: Phaser.GameObjects.TileSprite; speed: number }[] = [];

  /** Queues the rendered layer images; call from the scene's `preload`. */
  static preload(load: Phaser.Loader.LoaderPlugin): void {
    for (const theme of Object.values(THEMES)) {
      for (const layer of layersOf(theme)) {
        const key = imageKey(theme, layer.name);
        if (!load.textureManager.exists(key)) load.image(key, LAYER_IMAGES[`/backdrops/${theme}/${layer.name}.png`]);
      }
    }
  }

  /** `top` and `bottom` are the world's y range to cover; the water is at `waterLevel`. */
  constructor(scene: Phaser.Scene, kind: BackdropKind, width: number, depth: number, top: number, bottom: number, waterLevel: number) {
    const left = -REACH;
    const span = width + REACH * 2;
    const horizon = waterLevel - HORIZON;
    if (kind === 'sky') {
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
    } else {
      gradient(scene, 'backdrop-cave', CAVE, left, top, span, bottom - top, depth);
    }
    scene.cameras.main.setBackgroundColor((kind === 'sky' ? SKY : CAVE)[0]);

    const theme = THEMES[kind];
    for (const rendered of layersOf(theme)) {
      const source = scene.textures.get(imageKey(theme, rendered.name)).getSourceImage() as HTMLImageElement;
      const layer: Layer = {
        key: `${imageKey(theme, rendered.name)}-soft`,
        height: rendered.height,
        parallax: rendered.parallax,
        blur: rendered.blur,
        draw: (ctx) => ctx.drawImage(source, 0, 0),
      };
      const line = rendered.anchor === 'horizon' ? horizon : waterLevel;
      const y = rendered.anchor === 'top' ? top + rendered.offset : line - rendered.offset - rendered.height;
      const sprite = this.layer(scene, layer, left, y, span, depth);
      if (rendered.drift) this.drifting.push({ sprite, speed: rendered.drift });
    }
  }

  update(time: number): void {
    for (const { sprite, speed } of this.drifting) sprite.tilePositionX = (time / 1000) * speed;
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
