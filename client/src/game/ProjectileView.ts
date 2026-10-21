import Phaser from 'phaser';
import { TICK_RATE } from '../sim/constants';
import type { Projectile } from '../sim/projectiles';
import { labelStyle } from './WormView';

/** Draws shells, grenades (with their fuse countdown) and mines (with a blinking light). */
export class ProjectileView {
  private readonly gfx: Phaser.GameObjects.Graphics;
  private readonly fuseLabels = new Map<number, Phaser.GameObjects.Text>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly depth: number,
  ) {
    this.gfx = scene.add.graphics().setDepth(depth);
  }

  /** `alpha` is how far we are between the previous and current tick (0..1). */
  update(projectiles: Projectile[], alpha: number, time: number): void {
    const g = this.gfx.clear();
    const live = new Set<number>();
    for (const p of projectiles) {
      const x = p.prevX + (p.x - p.prevX) * alpha;
      const y = p.prevY + (p.y - p.prevY) * alpha;
      if (p.kind === 'shell') drawShell(g, x, y, p);
      else if (p.kind === 'mine') drawMine(g, x, y, p, time);
      else {
        drawGrenade(g, x, y);
        this.showFuse(p, x, y);
        live.add(p.id);
      }
    }
    for (const [id, label] of this.fuseLabels) {
      if (live.has(id)) continue;
      label.destroy();
      this.fuseLabels.delete(id);
    }
  }

  private showFuse(p: Projectile, x: number, y: number): void {
    let label = this.fuseLabels.get(p.id);
    if (!label) {
      label = this.scene.add
        .text(0, 0, '', labelStyle(0xffffff))
        .setOrigin(0.5, 1)
        .setDepth(this.depth)
        .setResolution(2);
      this.fuseLabels.set(p.id, label);
    }
    label.setText(String(Math.ceil((p.fuseTicks ?? 0) / TICK_RATE))).setPosition(x, y - 6);
  }
}

function drawShell(g: Phaser.GameObjects.Graphics, x: number, y: number, p: Projectile): void {
  const speed = Math.hypot(p.vx, p.vy) || 1;
  const dx = p.vx / speed;
  const dy = p.vy / speed;
  g.fillStyle(0xffb347, 0.9);
  g.fillCircle(x - dx * 6, y - dy * 6, 2);
  g.lineStyle(4, 0x2b2f33, 1);
  g.lineBetween(x - dx * 4, y - dy * 4, x + dx * 3, y + dy * 3);
}

function drawGrenade(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
  g.fillStyle(0x1b3d1f, 1);
  g.fillCircle(x, y, 4);
  g.fillStyle(0x3f8f45, 1);
  g.fillCircle(x, y, 3);
  g.fillStyle(0x9aa3ad, 1);
  g.fillRect(x - 1, y - 6, 2, 2);
}

/** Light: off until armed, slow blink while waiting, fast blink once set off, none on a dud. */
function drawMine(g: Phaser.GameObjects.Graphics, x: number, y: number, p: Projectile, time: number): void {
  g.fillStyle(0x15181b, 1);
  g.fillEllipse(x, y + 0.5, 10, 7);
  g.fillStyle(0x4a5058, 1);
  g.fillEllipse(x, y, 8, 5);
  if (p.dud || p.armTicks > 0) return;
  const period = p.fuseTicks !== null ? 150 : 1000;
  if (time % period < period * 0.35) {
    g.fillStyle(0xff2b2b, 1);
    g.fillCircle(x, y - 2, 1.6);
  }
}
