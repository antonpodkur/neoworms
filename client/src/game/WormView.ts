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

/** The worm sprite sheet, built from art/worm/worm.blend by `npm run sprites`. */
export const WORM_SHEET = 'worm';
/** Sprite frames are rendered at 24 pixels per worm radius (see art/scripts/placeholder_worm.py). */
const SPRITE_PX_PER_RADIUS = 24;
/** Keep the walk cycle going this long after the last step, so it doesn't flicker between steps. */
const WALK_HOLD_MS = 120;
/** A thrown worm tumbles this many radians per pixel it travels sideways. */
const TUMBLE = 1 / 60;

interface SheetAnim {
  frames: number;
  fps: number;
  loop: boolean;
}

/** Creates the Phaser animations listed in the sheet's JSON (build-sprites.ts puts them there). */
export function createWormAnims(scene: Phaser.Scene): void {
  const { anims } = scene.textures.get(WORM_SHEET).customData as { anims: Record<string, SheetAnim> };
  for (const [key, { frames, fps, loop }] of Object.entries(anims)) {
    if (scene.anims.exists(key)) continue;
    scene.anims.create({
      key,
      frames: scene.anims.generateFrameNames(WORM_SHEET, { prefix: `${key}/`, end: frames - 1, zeroPad: 4 }),
      frameRate: fps,
      repeat: loop ? -1 : 0,
    });
  }
}

/** A worm's body plus its name and health labels, drawn at the interpolated position. */
export class WormView {
  /** Where the worm was last drawn; the camera follows this. */
  x: number;
  y: number;
  private readonly body: Phaser.GameObjects.Sprite;
  private readonly name: Phaser.GameObjects.Text;
  private readonly hp: Phaser.GameObjects.Text;
  private shownHp: number;
  /** The animation playing, or 'aim' while a frame is picked by the aim angle. */
  private anim = '';
  /** scene.time.now when the worm last took a step. */
  private movedAt = -Infinity;

  constructor(
    private readonly scene: Phaser.Scene,
    worm: Worm,
  ) {
    this.x = worm.x;
    this.y = worm.y;
    this.shownHp = worm.hp;
    const style = labelStyle(teamColor(worm.team));
    this.body = scene.add
      .sprite(worm.x, worm.y, WORM_SHEET)
      .setScale(PHYS.wormRadius / SPRITE_PX_PER_RADIUS)
      .setDepth(DEPTH.worms);
    this.name = scene.add.text(0, 0, worm.name, style).setOrigin(0.5, 1).setDepth(DEPTH.labels).setResolution(2);
    this.hp = scene.add.text(0, 0, String(worm.hp), style).setOrigin(0.5, 1).setDepth(DEPTH.labels).setResolution(2);
    this.update(worm, 1, false);
  }

  /**
   * `alpha` is how far we are between the previous and current tick (0..1); `aiming` is true for
   * the worm whose turn it is, while it can still use its weapon.
   */
  update(worm: Worm, alpha: number, aiming: boolean): void {
    this.x = worm.prevX + (worm.x - worm.prevX) * alpha;
    this.y = worm.prevY + (worm.y - worm.prevY) * alpha;
    this.body.setPosition(this.x, this.y).setFlipX(worm.facing < 0);
    this.animate(worm, aiming);
    const r = PHYS.wormRadius;
    this.hp.setPosition(this.x, this.y - r * 2.3);
    this.name.setPosition(this.x, this.y - r * 3.9);
    if (worm.hp !== this.shownHp) {
      this.shownHp = worm.hp;
      this.hp.setText(String(worm.hp));
    }
  }

  /** Picks the animation (or the aiming frame) and the body's rotation from the worm's state. */
  private animate(worm: Worm, aiming: boolean): void {
    const now = this.scene.time.now;
    if (worm.grounded && (worm.x !== worm.prevX || worm.walkProgress > 0)) this.movedAt = now;
    const aimAnim = this.scene.anims.get(`aim_${worm.weapon}`);
    let rotation = 0;
    if (worm.rope?.phase === 'attached') {
      // Hang with the head toward the rope's last pivot.
      const pivot = worm.rope.pivots[worm.rope.pivots.length - 1];
      rotation = Math.atan2(pivot.x - this.x, this.y - pivot.y);
      this.play('fly_up');
    } else if (!worm.grounded) {
      if (worm.knocked) rotation = this.body.rotation + worm.vx * TUMBLE * (this.scene.game.loop.delta / 1000);
      this.play(worm.vy < 0 && !worm.knocked ? 'fly_up' : 'fly_down');
    } else if (worm.pendingJump || worm.slide !== 0) this.play('jump');
    else if (now - this.movedAt < WALK_HOLD_MS) this.play('walk');
    else if (aiming && aimAnim) {
      // One frame per aim angle: the first aims straight down, the last straight up.
      const frames = aimAnim.frames;
      const i = Math.round(((worm.aim + Math.PI / 2) / Math.PI) * (frames.length - 1));
      this.anim = 'aim';
      this.body.anims.stop();
      this.body.setFrame(frames[i].textureFrame);
    } else this.play('idle');
    this.body.setRotation(rotation);
  }

  private play(anim: string): void {
    if (this.anim === anim) return;
    this.anim = anim;
    this.body.play(anim);
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
