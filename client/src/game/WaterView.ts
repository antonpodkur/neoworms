import Phaser from 'phaser';
import { createNoise4D } from 'simplex-noise';
import { mulberry32 } from '../sim/rng';
import { Cells, smoothstep, wrappingNoise } from './procedural';

/** Colours from the surface down: see-through shallows, the body, the deep. */
const SURFACE = 0x92f2d4;
const BODY = 0x1fcf98;
const DEEP = 0x0c8f6c;
/** The top of the water is see-through, so ground under it shows; this deep it is opaque. */
const SURFACE_ALPHA = 0.5;
const CLEAR_DEPTH = 26;
/** Where the body has turned fully into the deep colour. */
const DEEP_DEPTH = 420;
/** The terrain mirrored in the water: its colour, strength, and how far down it shows. */
const REFLECTION_TINT = 0x52ad90;
const REFLECTION_ALPHA = 0.55;
const REFLECTION_DEPTH = 240;
/** The frame of the terrain texture the reflection shows: the strip just above the water. */
const REFLECTION_FRAME = 'reflection';
/** Two layers of ripple lines drifting across each other, stretched wide like a surface seen low. */
const RIPPLE_KEY = 'water-ripples';
const RIPPLE_TILE = 256;
const RIPPLE_COLOR = 0xa8f7de;
const RIPPLES = [
  { scaleX: 1.8, scaleY: 0.42, speed: 9, alpha: 0.34 },
  { scaleX: 2.7, scaleY: 0.6, speed: -6, alpha: 0.26 },
];
/** The ripple layers reach this far around the map, which covers the widest zoomed-out view. */
const RIPPLE_REACH = 4000;
const FOAM = 0xe4fff4;
/** The water's colour by depth below the surface, in straight lines between these points. */
const COLOURS: [depth: number, colour: number][] = [
  [0, SURFACE],
  [CLEAR_DEPTH, BODY],
  [DEEP_DEPTH, DEEP],
];

/**
 * The sea along the bottom of the map: jade water that is see-through near the surface, a
 * mirror image of the terrain that fades with depth, drifting ripples and a foam line.
 * Everything is drawn across whatever part of the world the camera shows.
 */
export class WaterView {
  private readonly body: Phaser.GameObjects.Graphics;
  private readonly terrain: Phaser.Textures.Texture;
  private readonly reflection: Phaser.GameObjects.Image;
  private readonly ripples: Phaser.GameObjects.TileSprite[];
  /** Water over the reflection and ripples, thicker the deeper it goes, so both fade out. */
  private readonly cover: Phaser.GameObjects.Graphics;
  private readonly foam: Phaser.GameObjects.Graphics;
  private level = NaN;

  /** `terrainKey` is the terrain's texture, which the water mirrors. */
  constructor(
    scene: Phaser.Scene,
    depth: number,
    terrainKey: string,
    private readonly mapWidth: number,
  ) {
    this.body = scene.add.graphics().setDepth(depth);
    this.terrain = scene.textures.get(terrainKey);
    this.terrain.add(REFLECTION_FRAME, 0, 0, 0, mapWidth, 1);
    this.reflection = scene.add
      .image(0, 0, terrainKey, REFLECTION_FRAME)
      .setOrigin(0, 0)
      .setFlipY(true)
      .setTint(REFLECTION_TINT)
      .setAlpha(REFLECTION_ALPHA)
      .setDepth(depth)
      .enableFilters();
    // Soft, as if seen through moving water.
    this.reflection.filters!.internal.addBlur(1, 1.5, 3, 1);
    this.ripples = RIPPLES.map(({ scaleX, scaleY, alpha }) =>
      scene.add
        .tileSprite(-RIPPLE_REACH, 0, mapWidth + RIPPLE_REACH * 2, RIPPLE_REACH, rippleTexture(scene))
        .setOrigin(0, 0)
        .setTileScale(scaleX, scaleY)
        .setTint(RIPPLE_COLOR)
        .setAlpha(alpha)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(depth),
    );
    this.cover = scene.add.graphics().setDepth(depth);
    this.foam = scene.add.graphics().setDepth(depth);
  }

  /** `level` can change during a match (sudden death raises it). */
  update(cam: Phaser.Cameras.Scene2D.Camera, time: number, level: number): void {
    if (level !== this.level) this.moveTo(level);
    const view = cam.worldView;
    const left = view.x - 32;
    const right = view.right + 32;
    const bottom = Math.max(view.bottom, level + DEEP_DEPTH) + 32;
    const t = time / 1000;
    const surface: Phaser.Math.Vector2[] = [];
    for (let x = left - (left % 16) - 16; x <= right + 16; x += 16) {
      const y = level + Math.sin(x * 0.02 + t * 2) * 3 + Math.sin(x * 0.051 - t * 1.3) * 2;
      surface.push(new Phaser.Math.Vector2(x, y));
    }
    const x0 = surface[0].x;
    const width = surface[surface.length - 1].x - x0;

    // The wavy top, then see-through shallows turning opaque, then the body darkening with depth.
    const top = 6;
    const body = this.body.clear();
    body.fillStyle(SURFACE, SURFACE_ALPHA);
    body.fillPoints([new Phaser.Math.Vector2(x0 + width, level + top), new Phaser.Math.Vector2(x0, level + top), ...surface], true);
    fillColumn(body, x0, width, level, top, bottom - level, (d) =>
      Math.min(1, SURFACE_ALPHA + ((1 - SURFACE_ALPHA) * d) / CLEAR_DEPTH),
    );
    fillColumn(this.cover.clear(), x0, width, level, top, bottom - level, (d) => Math.min(1, d / REFLECTION_DEPTH));

    this.ripples.forEach((ripple, i) => {
      ripple.tilePositionX = t * RIPPLES[i].speed;
    });

    const foam = this.foam.clear();
    foam.lineStyle(6, FOAM, 0.25);
    foam.strokePoints(surface);
    foam.lineStyle(2, FOAM, 0.95);
    foam.strokePoints(surface);
  }

  private moveTo(level: number): void {
    this.level = level;
    // Mirrored about the surface: the strip of terrain just above the water, upside down below it.
    const rows = Math.max(1, Math.min(REFLECTION_DEPTH, Math.floor(level)));
    this.terrain.get(REFLECTION_FRAME).setSize(this.mapWidth, rows, 0, Math.floor(level) - rows);
    this.reflection.setFrame(REFLECTION_FRAME).setY(Math.floor(level));
    for (const ripple of this.ripples) ripple.setY(level + 2);
  }
}

/**
 * Fills the water from `from` to `to` (depths below `level`) in its colour at each depth, with
 * opacity `alpha(depth)`. Colours and opacities are straight lines between the depths listed.
 */
function fillColumn(
  g: Phaser.GameObjects.Graphics,
  x: number,
  width: number,
  level: number,
  from: number,
  to: number,
  alpha: (depth: number) => number,
): void {
  const inside = [CLEAR_DEPTH, REFLECTION_DEPTH, DEEP_DEPTH].filter((d) => d > from && d < to);
  const stops = [from, ...inside.sort((a, b) => a - b), to];
  for (let i = 0; i + 1 < stops.length; i++) {
    const [a, b] = [stops[i], stops[i + 1]];
    const [ca, cb] = [colourAt(a), colourAt(b)];
    g.fillGradientStyle(ca, ca, cb, cb, alpha(a), alpha(a), alpha(b), alpha(b));
    g.fillRect(x, level + a, width, b - a);
  }
}

function colourAt(depth: number): number {
  for (let i = 1; i < COLOURS.length; i++) {
    const [d0, c0] = COLOURS[i - 1];
    const [d1, c1] = COLOURS[i];
    if (depth <= d1) return mix(c0, c1, (depth - d0) / (d1 - d0));
  }
  return COLOURS[COLOURS.length - 1][1];
}

function mix(a: number, b: number, t: number): number {
  const channel = (shift: number) => {
    const ca = (a >> shift) & 0xff;
    return Math.round(ca + (((b >> shift) & 0xff) - ca) * t) << shift;
  };
  return channel(16) | channel(8) | channel(0);
}

/**
 * A seamless tile of bright, wobbly ripple lines (the edges between cells) on transparent
 * black, made the first time it's asked for. Returns its texture key.
 */
export function rippleTexture(scene: Phaser.Scene): string {
  if (scene.textures.exists(RIPPLE_KEY)) return RIPPLE_KEY;
  const rand = mulberry32(5);
  const noise = createNoise4D(rand);
  const bendX = wrappingNoise(noise, RIPPLE_TILE, 4, 0);
  const bendY = wrappingNoise(noise, RIPPLE_TILE, 4, 50);
  const strength = wrappingNoise(noise, RIPPLE_TILE, 3, 100);
  const cells = new Cells(6, RIPPLE_TILE, rand);
  const texture = scene.textures.createCanvas(RIPPLE_KEY, RIPPLE_TILE, RIPPLE_TILE)!;
  const image = texture.context.createImageData(RIPPLE_TILE, RIPPLE_TILE);
  for (let y = 0; y < RIPPLE_TILE; y++) {
    for (let x = 0; x < RIPPLE_TILE; x++) {
      cells.nearest(x + bendX(x, y) * 8, y + bendY(x, y) * 8);
      // Broken into separate squiggles where `strength` is low, rather than one connected net.
      const line = (1 - smoothstep(0.6, 3, cells.f2 - cells.f1)) * smoothstep(-0.1, 0.5, strength(x, y));
      const o = (y * RIPPLE_TILE + x) * 4;
      image.data[o] = image.data[o + 1] = image.data[o + 2] = 255;
      image.data[o + 3] = Math.round(line * 255);
    }
  }
  texture.context.putImageData(image, 0, 0);
  texture.refresh();
  return RIPPLE_KEY;
}
