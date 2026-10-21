import Phaser from 'phaser';
import { PHYS } from '../sim/constants';
import type { Worm } from '../sim/worm';
import { DEPTH } from './depth';

/** Red, blue, green, yellow, purple, orange, teal, pink: one per team, up to eight. */
const TEAM_COLORS = [0xff5a5a, 0x5aa9ff, 0x7ddc5a, 0xffd23f, 0xb98cff, 0xff9a3c, 0x3fe0d0, 0xff7fd1];

export function teamColor(team: number): number {
  return TEAM_COLORS[team % TEAM_COLORS.length];
}

export function teamColorCss(team: number): string {
  return `#${teamColor(team).toString(16).padStart(6, '0')}`;
}

export const labelStyle = (color: number): Phaser.Types.GameObjects.Text.TextStyle => ({
  fontFamily: '"Arial Black", Arial, sans-serif',
  fontSize: '11px',
  color: `#${color.toString(16).padStart(6, '0')}`,
  stroke: '#000000',
  strokeThickness: 3,
});

/** A worm's body plus its name and health labels, drawn at the interpolated position. */
export class WormView {
  /** Where the worm was last drawn; the camera follows this. */
  x: number;
  y: number;
  private readonly body: Phaser.GameObjects.Graphics;
  private readonly name: Phaser.GameObjects.Text;
  private readonly hp: Phaser.GameObjects.Text;
  private shownHp: number;
  /** The body is drawn for a radius-7 worm and scaled to the actual size. */
  private readonly scale = PHYS.wormRadius / 7;

  constructor(
    private readonly scene: Phaser.Scene,
    worm: Worm,
  ) {
    this.x = worm.x;
    this.y = worm.y;
    this.shownHp = worm.hp;
    const style = labelStyle(teamColor(worm.team));
    this.body = drawWorm(scene.add.graphics().setDepth(DEPTH.worms), teamColor(worm.team));
    this.name = scene.add.text(0, 0, worm.name, style).setOrigin(0.5, 1).setDepth(DEPTH.labels).setResolution(2);
    this.hp = scene.add.text(0, 0, String(worm.hp), style).setOrigin(0.5, 1).setDepth(DEPTH.labels).setResolution(2);
    this.update(worm, 1);
  }

  /** `alpha` is how far we are between the previous and current tick (0..1). */
  update(worm: Worm, alpha: number): void {
    this.x = worm.prevX + (worm.x - worm.prevX) * alpha;
    this.y = worm.prevY + (worm.y - worm.prevY) * alpha;
    this.body.setPosition(this.x, this.y).setScale(worm.facing * this.scale, this.scale);
    this.hp.setPosition(this.x, this.y - 11 * this.scale);
    this.name.setPosition(this.x, this.y - 24 * this.scale);
    if (worm.hp !== this.shownHp) {
      this.shownHp = worm.hp;
      this.hp.setText(String(worm.hp));
    }
  }

  die(cause: 'drowned' | 'killed'): void {
    const parts = [this.body, this.name, this.hp];
    this.scene.tweens.add({
      targets: parts,
      alpha: 0,
      y: cause === 'drowned' ? '+=30' : '-=10',
      duration: 700,
      onComplete: () => parts.forEach((p) => p.destroy()),
    });
  }
}

/** Draws a worm facing right around (0, 0); flipping scaleX turns it around. */
function drawWorm(g: Phaser.GameObjects.Graphics, color: number): Phaser.GameObjects.Graphics {
  const outline = 0x8a3c4e;
  const skin = 0xf4a3b4;
  g.fillStyle(outline);
  g.fillEllipse(-1, 3, 15, 11);
  g.fillCircle(2, -3, 6);
  g.fillStyle(skin);
  g.fillEllipse(-1, 3, 12.5, 8.5);
  g.fillCircle(2, -3, 4.8);
  g.fillStyle(color);
  g.fillRect(-2.5, -7.5, 8, 2);
  g.fillStyle(0xffffff);
  g.fillCircle(3.5, -3.5, 2);
  g.fillCircle(6.5, -3.5, 2);
  g.fillStyle(0x000000);
  g.fillCircle(4.3, -3.5, 1);
  g.fillCircle(7.3, -3.5, 1);
  return g;
}
