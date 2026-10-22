import Phaser from 'phaser';
import { DEPTH } from './depth';
import { labelStyle } from './WormView';

export function splash(scene: Phaser.Scene, x: number, y: number): void {
  const g = scene.add.graphics().setDepth(DEPTH.water).setPosition(x, y);
  g.lineStyle(3, 0xd8f1ff, 1);
  g.strokeEllipse(0, 0, 30, 8);
  scene.tweens.add({
    targets: g,
    scaleX: 2.2,
    scaleY: 1.6,
    alpha: 0,
    duration: 600,
    onComplete: () => g.destroy(),
  });
}

/** A ring that shrinks into (or bursts out of) a point: a worm teleporting out or in. */
export function teleportFlash(scene: Phaser.Scene, x: number, y: number, arriving: boolean): void {
  const g = scene.add.graphics().setDepth(DEPTH.effects).setPosition(x, y);
  g.lineStyle(3, 0x9fe8ff, 1);
  g.strokeCircle(0, 0, 14);
  g.setScale(arriving ? 0.2 : 1.4);
  scene.tweens.add({
    targets: g,
    scale: arriving ? 1.6 : 0.1,
    alpha: 0,
    duration: 450,
    ease: 'Cubic.easeOut',
    onComplete: () => g.destroy(),
  });
}

/** A bullet's streak from the gun to where it hit, fading fast. */
export function tracer(scene: Phaser.Scene, x0: number, y0: number, x1: number, y1: number): void {
  const g = scene.add.graphics().setDepth(DEPTH.effects);
  g.lineStyle(1.5, 0xfff1a8, 0.9);
  g.lineBetween(x0, y0, x1, y1);
  scene.tweens.add({ targets: g, alpha: 0, duration: 160, onComplete: () => g.destroy() });
}

/** Text that drifts up and fades out, e.g. damage numbers. */
export function floatingText(scene: Phaser.Scene, x: number, y: number, text: string, color: number): void {
  const t = scene.add
    .text(x, y, text, { ...labelStyle(color), fontSize: '14px' })
    .setOrigin(0.5)
    .setDepth(DEPTH.labels)
    .setResolution(2);
  scene.tweens.add({
    targets: t,
    y: y - 40,
    alpha: 0,
    duration: 1400,
    ease: 'Cubic.easeOut',
    onComplete: () => t.destroy(),
  });
}
