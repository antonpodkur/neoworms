import Phaser from 'phaser';
import { createNoise2D } from 'simplex-noise';
import { mulberry32 } from '../sim/rng';
import type { Terrain } from '../sim/terrain';
import { DEPTH } from './depth';
import { smoothstep } from './procedural';
import type { TerrainView } from './TerrainView';

/**
 * Explosions, inspired by Worms Revolution's: a flash and a fireball, sparks, chunks of the
 * ground that was blown away, a little smoke drifting with the wind, and a crater whose rim
 * glows molten and keeps flickering with small flames for a few seconds. All of it is Phaser
 * particles; the textures are drawn once in code. Purely visual: nothing here touches the sim.
 */

const GLOW = 'fx-glow';
const PUFF = 'fx-puff';
const CHUNK = 'fx-chunk';
const CHUNK_FRAMES = 4;
/** Sizes below are for a blast of this radius and scale with the real one. */
const BASE_RADIUS = 30;
/** The fireball's colour over its life: orange, red, then soot; and its white-hot core. */
const FIRE = [0xffa21f, 0xe8521a, 0xa8240c, 0x3a2620];
const CORE = [0xfff7c0, 0xffd040, 0xff8020];
const SPARKS = [0xffffff, 0xffd060, 0xff7020];
const SMOKE = [0x6b625a, 0x7a716a, 0x8a827a];
const SMOKE_ALPHA = 0.35;
const HEAT = [0xff8a2a, 0xd8380c, 0x5a0d04];
const FLAMES = [0xfff1a0, 0xffa030, 0xff4010];
/** How long the crater's rim glows and flickers, in ms. */
const MOLTEN_MS = 3500;

export class Explosions {
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly terrain: Terrain,
    private readonly terrainView: TerrainView,
  ) {
    makeTextures(scene);
  }

  /**
   * A blast of radius `r` at (x, y). Call it right after the hole was carved but before the
   * terrain's next flush, while the blown-away ground is still drawn (for the debris colours).
   */
  play(x: number, y: number, r: number, wind: number): void {
    const k = r / BASE_RADIUS;
    const debris = this.terrainView.colorsAround(x, y, r, 12);
    this.flash(x, y, r);
    this.burst(GLOW, x, y, Math.round(12 + r / 2), DEPTH.effects, {
      speed: { min: r * 3, max: r * 9 },
      scale: { start: 0.1 * Math.sqrt(k), end: 0 },
      lifespan: { min: 350, max: 850 },
      gravityY: 500,
      color: SPARKS,
      blendMode: Phaser.BlendModes.ADD,
    });
    // Smoke rises a moment later, behind the fireball, and drifts off with the wind.
    this.scene.time.delayedCall(250, () =>
      this.burst(PUFF, x, y - r * 0.4, Math.round(3 + r / 10), DEPTH.effects - 1, {
        speed: { min: 5, max: 25 },
        angle: { min: -150, max: -30 },
        accelerationX: wind * 30,
        accelerationY: -18,
        scale: { start: 0.5 * k, end: 1.6 * k },
        // Fades in, then slowly out.
        alpha: { onUpdate: (_p: Phaser.GameObjects.Particles.Particle, _k: string, t: number) => SMOKE_ALPHA * Math.min(1, t * 5) * (1 - t) },
        lifespan: { min: 1400, max: 2400 },
        rotate: { min: 0, max: 360 },
        tint: SMOKE,
      }),
    );
    // A cartoon fireball: solid puffs that swell, burn through to red and go out as soot...
    this.burst(PUFF, x, y, Math.round(10 + r / 3), DEPTH.effects, {
      speed: { min: r * 0.3, max: r * 1.6 },
      scale: { start: 0.9 * k, end: 1.4 * k },
      alpha: { start: 1, end: 0, ease: 'Quad.easeIn' },
      lifespan: { min: 300, max: 650 },
      rotate: { min: 0, max: 360 },
      color: FIRE,
    });
    // ...around a white-hot core that burns out fast.
    this.burst(GLOW, x, y, 6, DEPTH.effects, {
      speed: { min: 0, max: r * 0.8 },
      scale: { start: 0.9 * k, end: 0.3 * k },
      alpha: { start: 1, end: 0 },
      lifespan: { min: 180, max: 320 },
      color: CORE,
      blendMode: Phaser.BlendModes.ADD,
    });
    if (debris.length) {
      this.burst(CHUNK, x, y, Math.round(8 + r / 2), DEPTH.effects, {
        frame: Array.from({ length: CHUNK_FRAMES }, (_, i) => String(i)),
        // Mostly thrown up and out, as from a hole in the ground.
        angle: { min: -170, max: -10 },
        speed: { min: r * 2, max: r * 7 },
        scale: { min: 0.6 * Math.sqrt(k), max: 1.4 * Math.sqrt(k) },
        alpha: { start: 1, end: 0, ease: 'Expo.easeIn' },
        lifespan: { min: 700, max: 1300 },
        gravityY: 700,
        tint: debris,
        rotate: {
          onEmit: () => Math.random() * 360,
          onUpdate: (particle: Phaser.GameObjects.Particles.Particle, _key: string, _t: number, value: number) =>
            value + particle.velocityX * 0.03,
        },
      });
    }
    this.molten(x, y, r, k);
    this.scene.cameras.main.shake(100 + r * 2, Math.min(0.012, 0.002 + r / 6000));
  }

  /** A white-hot flash that swells and fades, and a dimmer glow lighting up what's around. */
  private flash(x: number, y: number, r: number): void {
    const glows = [
      { from: r * 0.8, to: r * 2, alpha: 0.7, ms: 150, tint: 0xffe9a0 },
      { from: r * 3, to: r * 5, alpha: 0.3, ms: 420, tint: 0xffb060 },
    ];
    for (const g of glows) {
      const img = this.scene.add
        .image(x, y, GLOW)
        .setTint(g.tint)
        .setAlpha(g.alpha)
        .setDisplaySize(g.from, g.from)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(DEPTH.effects);
      this.scene.tweens.add({
        targets: img,
        displayWidth: g.to,
        displayHeight: g.to,
        alpha: 0,
        duration: g.ms,
        ease: 'Cubic.easeOut',
        onComplete: () => img.destroy(),
      });
    }
  }

  /**
   * The crater's rim, where it's real ground: a molten glow that cools, and along the lower
   * rim small flames that keep licking up for a while.
   */
  private molten(x: number, y: number, r: number, k: number): void {
    const rim: Phaser.Types.Math.Vector2Like[] = [];
    const steps = Math.max(24, Math.round(r * 1.5));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      if (this.terrain.isSolid(x + Math.cos(a) * (r + 2), y + Math.sin(a) * (r + 2))) {
        rim.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r });
      }
    }
    if (!rim.length) return;
    const heat = this.scene.add
      .particles(0, 0, GLOW, {
        emitting: false,
        scale: { min: 0.16 * Math.sqrt(k), max: 0.24 * Math.sqrt(k) },
        alpha: { start: 0.7, end: 0, ease: 'Quad.easeIn' },
        lifespan: { min: MOLTEN_MS * 0.6, max: MOLTEN_MS },
        color: HEAT,
        blendMode: Phaser.BlendModes.ADD,
      })
      .setDepth(DEPTH.embers);
    for (const p of rim) heat.emitParticleAt(p.x, p.y);
    this.scene.time.delayedCall(MOLTEN_MS + 100, () => heat.destroy());

    const lower = rim.filter((p) => p.y > y + r * 0.3);
    if (!lower.length) return;
    const flames = this.scene.add
      .particles(0, 0, PUFF, {
        emitZone: { type: 'random', source: { getRandomPoint: (point: Phaser.Types.Math.Vector2Like) => Object.assign(point, pick(lower)) } },
        frequency: Math.max(20, 120 / lower.length),
        duration: MOLTEN_MS * 0.8,
        speedY: { min: -45 * Math.sqrt(k), max: -10 },
        speedX: { min: -6, max: 6 },
        scale: { start: 0.14 * Math.sqrt(k), end: 0 },
        lifespan: { min: 250, max: 550 },
        color: FLAMES,
        blendMode: Phaser.BlendModes.ADD,
      })
      .setDepth(DEPTH.embers);
    this.scene.time.delayedCall(MOLTEN_MS + 700, () => flames.destroy());
  }

  /** `count` particles at once from (x, y); the emitter goes away when they're done. */
  private burst(
    texture: string,
    x: number,
    y: number,
    count: number,
    depth: number,
    config: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig,
  ): void {
    const emitter = this.scene.add.particles(0, 0, texture, { ...config, emitting: false }).setDepth(depth);
    emitter.explode(count, x, y);
    const lifespan = config.lifespan as { max?: number } | undefined;
    this.scene.time.delayedCall((lifespan?.max ?? 1000) + 100, () => emitter.destroy());
  }
}

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

/** The particle textures, drawn once: a soft glow, a soft puff with a ragged edge, rock chunks. */
function makeTextures(scene: Phaser.Scene): void {
  if (scene.textures.exists(GLOW)) return;
  const glow = scene.textures.createCanvas(GLOW, 128, 128)!;
  const fill = glow.context.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [stop, alpha] of [[0, 1], [0.2, 0.85], [0.45, 0.4], [0.7, 0.1], [1, 0]]) {
    fill.addColorStop(stop, `rgba(255,255,255,${alpha})`);
  }
  glow.context.fillStyle = fill;
  glow.context.fillRect(0, 0, 128, 128);
  glow.refresh();

  // A puff: round, with a ragged noisy edge, a little darker toward its lower right.
  const size = 96;
  const puff = scene.textures.createCanvas(PUFF, size, size)!;
  const image = puff.context.createImageData(size, size);
  const noise = createNoise2D(mulberry32(9));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / (size / 2) - 1;
      const dy = (y + 0.5) / (size / 2) - 1;
      const d = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      const edge = 0.72 + 0.16 * noise(Math.cos(a) * 1.5, Math.sin(a) * 1.5);
      const alpha = smoothstep(edge, edge - 0.4, d) * (0.85 + 0.15 * noise(dx * 3, dy * 3));
      const shade = 255 * (0.88 - 0.12 * (dx + dy) * 0.5);
      const o = (y * size + x) * 4;
      image.data[o] = image.data[o + 1] = image.data[o + 2] = shade;
      image.data[o + 3] = Math.max(0, alpha) * 255;
    }
  }
  puff.context.putImageData(image, 0, 0);
  puff.refresh();

  // Rock chunks: little irregular polygons, white (tinted per particle), shaded at the lower right.
  const cell = 14;
  const chunks = scene.textures.createCanvas(CHUNK, cell * CHUNK_FRAMES, cell)!;
  const ctx = chunks.context;
  const rand = mulberry32(4);
  for (let i = 0; i < CHUNK_FRAMES; i++) {
    const cx = i * cell + cell / 2;
    const cy = cell / 2;
    ctx.beginPath();
    const corners = 5 + Math.floor(rand() * 3);
    for (let c = 0; c < corners; c++) {
      const a = (c / corners) * Math.PI * 2 + rand() * 0.6;
      const rr = 3.5 + rand() * 2.5;
      ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    ctx.closePath();
    const shade = ctx.createLinearGradient(cx - 5, cy - 5, cx + 5, cy + 5);
    shade.addColorStop(0, '#ffffff');
    shade.addColorStop(1, '#c4c4c4');
    ctx.fillStyle = shade;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    chunks.add(String(i), 0, i * cell, 0, cell, cell);
  }
  chunks.refresh();
}
