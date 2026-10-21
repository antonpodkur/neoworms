import Phaser from 'phaser';
import type { Terrain } from '../sim/terrain';
import { overlaps, TerrainPainter, union, type Rect } from './terrainPaint';

const KEY = 'terrain';

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

  constructor(
    private readonly scene: Phaser.Scene,
    terrain: Terrain,
    depth: number,
  ) {
    if (scene.textures.exists(KEY)) scene.textures.remove(KEY);
    this.texture = scene.textures.createCanvas(KEY, terrain.width, terrain.height)!;
    this.painter = new TerrainPainter(terrain);
    this.image = new ImageData(this.painter.pixels, terrain.width, terrain.height);
    this.texture.context.putImageData(this.image, 0, 0);
    this.texture.refresh();
    scene.add.image(0, 0, KEY).setOrigin(0, 0).setDepth(depth);
  }

  /** Scorches the rim of a hole the simulation just carved; the hole shows from the next flush. */
  carve(x: number, y: number, r: number): void {
    const changed = this.painter.carve(x, y, r);
    if (!changed) return;
    // An air strike or cluster lands several holes in one frame; repaint each spot once.
    let rect = changed;
    let i: number;
    while ((i = this.dirty.findIndex((d) => overlaps(d, rect))) >= 0) rect = union(rect, this.dirty.splice(i, 1)[0]);
    this.dirty.push(rect);
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
