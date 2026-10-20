import Phaser from 'phaser';
import { GameScene } from './game/GameScene';
import { createTuningPanel } from './game/TuningPanel';

createTuningPanel();

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#16325c',
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  scene: [GameScene],
});

// Handy for poking at the simulation from the browser console during development.
if (import.meta.env.DEV) Object.assign(window, { game });
