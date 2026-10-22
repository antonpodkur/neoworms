import Phaser from 'phaser';
import type { Bounds, Terrain } from '../sim/terrain';
import { overlaps, TerrainPainter, union, type Rect } from './terrainPaint';

/** The terrain's texture; the water mirrors it. */
export const TERRAIN_TEXTURE = 'terrain';

/**
 * Shows the terrain as one canvas texture (terrainPaint.ts decides the look) and mirrors every
 * hole the simulation carves. Only the area around a new hole is repainted and sent to the GPU.
 */
export class TerrainView {
  private readonly texture: Phaser.Textures.CanvasTexture;
  private readonly painter: TerrainPainter;
  private readonly image: ImageData;
  /** Areas to repaint at the next flush, merged where they overlap. */
  private dirty: Rect[] = [];

  /** `waterLevel` is where the sea starts; ground just above it picks up the water's green. */
  constructor(
    private readonly scene: Phaser.Scene,
    terrain: Terrain,
    depth: number,
    waterLevel?: number,
  ) {
    if (scene.textures.exists(TERRAIN_TEXTURE)) scene.textures.remove(TERRAIN_TEXTURE);
    this.texture = scene.textures.createCanvas(TERRAIN_TEXTURE, terrain.width, terrain.height)!;
    this.painter = new TerrainPainter(terrain, waterLevel);
    this.image = new ImageData(this.painter.pixels, terrain.width, terrain.height);
    this.texture.context.putImageData(this.image, 0, 0);
    this.texture.refresh();
    scene.add.image(0, 0, TERRAIN_TEXTURE).setOrigin(0, 0).setDepth(depth);
  }

  /** Scorches the rim of a hole the simulation just carved; the hole shows from the next flush. */
  carve(x: number, y: number, r: number): void {
    this.markDirty(this.painter.carve(x, y, r));
  }

  /** New ground (a girder) the simulation just put in this box; it shows from the next flush. */
  fill(bounds: Bounds | null): void {
    if (bounds) this.markDirty(this.painter.fill(bounds.x0, bounds.y0, bounds.x1, bounds.y1));
  }

  private markDirty(changed: Rect | null): void {
    if (!changed) return;
    // An air strike or cluster lands several holes in one frame; repaint each spot once.
    let rect = changed;
    let i: number;
    while ((i = this.dirty.findIndex((d) => overlaps(d, rect))) >= 0) rect = union(rect, this.dirty.splice(i, 1)[0]);
    this.dirty.push(rect);
  }

  /**
   * Colours (0xRRGGBB) of up to `count` random ground pixels within `r` of (x, y), as drawn
   * now. Called before the next flush, that's the ground a hole just blew away.
   */
  colorsAround(x: number, y: number, r: number, count: number): number[] {
    const { pixels } = this.painter;
    const { width, height } = this.texture;
    const colors: number[] = [];
    for (let tries = 0; tries < count * 4 && colors.length < count; tries++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * r;
      const px = Math.round(x + Math.cos(a) * d);
      const py = Math.round(y + Math.sin(a) * d);
      if (px < 0 || py < 0 || px >= width || py >= height) continue;
      const o = (py * width + px) * 4;
      if (pixels[o + 3] === 255) colors.push((pixels[o] << 16) | (pixels[o + 1] << 8) | pixels[o + 2]);
    }
    return colors;
  }

  /** Repaints and uploads what changed, at most once per frame however many holes were made. */
  flush(): void {
    for (const rect of this.dirty) {
      this.painter.paint(rect);
      // The canvas stays in step for the Canvas renderer and for WebGL context restores.
      this.texture.context.putImageData(this.image, 0, 0, rect.x, rect.y, rect.w, rect.h);
      this.upload(rect);
    }
    this.dirty = [];
  }

  /** Sends one rectangle to the GPU. `texture.refresh()` would send the whole map (17 MB on a big one). */
  private upload({ x, y, w, h }: Rect): void {
    const renderer = this.scene.sys.renderer;
    const glTexture = this.texture.source[0].glTexture;
    if (!(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer) || !glTexture) return;
    const rows = new Uint8Array(w * h * 4);
    const { pixels } = this.painter;
    for (let row = 0; row < h; row++) {
      const start = ((y + row) * this.texture.width + x) * 4;
      rows.set(pixels.subarray(start, start + w * 4), row * w * 4);
    }
    // Bind and set the unpack flags through Phaser, which tracks GL state, as its own uploads do.
    renderer.glTextureUnits.bind(glTexture, 0);
    renderer.glWrapper.updateTexturing({ texturing: { flipY: glTexture.flipY, premultiplyAlpha: glTexture.pma } });
    // Flipped textures store the bottom row first.
    const top = glTexture.flipY ? this.texture.height - y - h : y;
    const gl = renderer.gl;
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, top, w, h, gl.RGBA, gl.UNSIGNED_BYTE, rows);
  }
}
