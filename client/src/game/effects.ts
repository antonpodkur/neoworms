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
