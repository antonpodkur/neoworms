import Phaser from 'phaser';

/** Animated water drawn across whatever part of the world the camera currently shows. */
export class WaterView {
  private readonly gfx: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, depth: number) {
    this.gfx = scene.add.graphics().setDepth(depth);
  }

  /** `level` can change during a match (sudden death raises it). */
  update(cam: Phaser.Cameras.Scene2D.Camera, time: number, level: number): void {
    const view = cam.worldView;
    const left = view.x - 32;
    const right = view.right + 32;
    const bottom = Math.max(view.bottom, level) + 32;
    const t = time / 1000;
    const surface: Phaser.Math.Vector2[] = [];
    for (let x = left - (left % 16); x <= right + 16; x += 16) {
      const y = level + Math.sin(x * 0.02 + t * 2) * 3 + Math.sin(x * 0.051 - t * 1.3) * 2;
      surface.push(new Phaser.Math.Vector2(x, y));
    }

    const g = this.gfx.clear();
    g.fillStyle(0x1d5fa0, 0.82);
    g.fillPoints(
      [new Phaser.Math.Vector2(left, bottom), ...surface, new Phaser.Math.Vector2(right + 16, bottom)],
      true,
    );
    // Deep water is opaque so the submerged bottom of the map never shows.
    g.fillStyle(0x174a80, 1);
    g.fillRect(left, level + 36, right - left + 16, bottom - level);
    g.lineStyle(2, 0x9ad8ff, 0.9);
    g.strokePoints(surface);
  }
}
