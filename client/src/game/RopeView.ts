import Phaser from 'phaser';
import type { Worm } from '../sim/worm';
import type { WormView } from './WormView';

/** Draws every rope: from the hook, through each corner it bends around, to the worm. */
export class RopeView {
  private readonly gfx: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, depth: number) {
    this.gfx = scene.add.graphics().setDepth(depth);
  }

  update(worms: Worm[], views: Map<number, WormView>): void {
    const g = this.gfx.clear();
    for (const worm of worms) {
      const view = views.get(worm.id);
      const rope = worm.rope;
      if (!worm.alive || !view || !rope) continue;

      const points = rope.phase === 'shooting' ? [{ x: rope.x, y: rope.y }] : rope.pivots;
      const hook = points[0];
      // Dark outline under a light core, so the rope reads against both sky and cave rock.
      for (const [width, color] of [
        [4, 0x1a120c],
        [2, 0xe8d6a8],
      ]) {
        g.lineStyle(width, color, 1);
        g.beginPath();
        g.moveTo(hook.x, hook.y);
        for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y);
        g.lineTo(view.x, view.y);
        g.strokePath();
      }
      g.fillStyle(0x1a120c, 1);
      g.fillCircle(hook.x, hook.y, 4);
      g.fillStyle(0xc7ced6, 1);
      g.fillCircle(hook.x, hook.y, 2.5);
    }
  }
}
