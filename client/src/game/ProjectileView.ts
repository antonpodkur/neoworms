import Phaser from 'phaser';
import { TICK_RATE } from '../sim/constants';
import type { Projectile } from '../sim/projectiles';
import { labelStyle } from './WormView';

/** Draws every kind of projectile, fuse countdowns over the fused ones, and mine lights. */
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
      switch (p.kind) {
        case 'shell':
          drawShell(g, x, y, p, 0x2b2f33);
          break;
        case 'missile':
          drawShell(g, x, y, p, 0x8a1c1c);
          break;
        case 'fragment':
          g.fillStyle(0x2b2f33, 1);
          g.fillCircle(x, y, 2);
          break;
        case 'bomblet':
          drawBanana(g, x, y, 0.7);
          break;
        case 'grenade':
          drawGrenade(g, x, y, 0x1b3d1f, 0x3f8f45);
          break;
        case 'cluster':
          drawGrenade(g, x, y, 0x2b2f33, 0x7d8791);
          break;
        case 'banana':
          drawBanana(g, x, y, 1);
          break;
        case 'dynamite':
          drawDynamite(g, x, y, time);
          break;
        case 'oldWoman':
          drawOldWoman(g, x, y, p);
          break;
        case 'mine':
          drawMine(g, x, y, p, time);
          break;
      }
      if (p.kind !== 'mine' && p.fuseTicks !== null) {
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
    label.setText(String(Math.ceil((p.fuseTicks ?? 0) / TICK_RATE))).setPosition(x, y - 8);
  }
}

function drawShell(g: Phaser.GameObjects.Graphics, x: number, y: number, p: Projectile, body: number): void {
  const speed = Math.hypot(p.vx, p.vy) || 1;
  const dx = p.vx / speed;
  const dy = p.vy / speed;
  g.fillStyle(0xffb347, 0.9);
  g.fillCircle(x - dx * 6, y - dy * 6, 2);
  g.lineStyle(4, body, 1);
  g.lineBetween(x - dx * 4, y - dy * 4, x + dx * 3, y + dy * 3);
}

function drawGrenade(g: Phaser.GameObjects.Graphics, x: number, y: number, rim: number, body: number): void {
  g.fillStyle(rim, 1);
  g.fillCircle(x, y, 4);
  g.fillStyle(body, 1);
  g.fillCircle(x, y, 3);
  g.fillStyle(0x9aa3ad, 1);
  g.fillRect(x - 1, y - 6, 2, 2);
}

function drawBanana(g: Phaser.GameObjects.Graphics, x: number, y: number, scale: number): void {
  g.lineStyle(4 * scale, 0x6b5a12, 1);
  g.beginPath();
  g.arc(x, y - 3 * scale, 5 * scale, 0.3, Math.PI - 0.3);
  g.strokePath();
  g.lineStyle(2.5 * scale, 0xffd93b, 1);
  g.beginPath();
  g.arc(x, y - 3 * scale, 5 * scale, 0.3, Math.PI - 0.3);
  g.strokePath();
}

/** A red stick with a sparking fuse. */
function drawDynamite(g: Phaser.GameObjects.Graphics, x: number, y: number, time: number): void {
  g.fillStyle(0x5c0f0f, 1);
  g.fillRect(x - 3, y - 5, 6, 9);
  g.fillStyle(0xd83a2e, 1);
  g.fillRect(x - 2, y - 4, 4, 7);
  g.lineStyle(1, 0xdddddd, 1);
  g.lineBetween(x, y - 5, x + 2, y - 8);
  if (time % 160 < 100) {
    g.fillStyle(0xffe14d, 1);
    g.fillCircle(x + 2, y - 8, 1.6);
  }
}

/** A little old lady: purple dress, grey hair, facing the way she walks. */
function drawOldWoman(g: Phaser.GameObjects.Graphics, x: number, y: number, p: Projectile): void {
  g.fillStyle(0x3d1d5c, 1);
  g.fillEllipse(x, y + 1, 11, 9);
  g.fillStyle(0x8d4fc4, 1);
  g.fillEllipse(x, y + 1, 9, 7);
  g.fillStyle(0xf1c9a5, 1);
  g.fillCircle(x + p.dir * 2, y - 5, 2.5);
  g.fillStyle(0xd9d9d9, 1);
  g.fillCircle(x - p.dir * 0.5, y - 6.5, 2);
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
