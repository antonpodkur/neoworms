import Phaser from 'phaser';
import { DT } from '../sim/constants';
import { MAP_PRESETS, type MapPreset } from '../sim/mapgen';
import { randomSeed } from '../sim/rng';
import { createMatch, type SimEvent, type TeamSetup, type World } from '../sim/world';
import type { WormInput } from '../sim/worm';
import { DEPTH } from './depth';
import { explosionFlash, floatingText, splash } from './effects';
import { Hud } from './Hud';
import { TerrainView } from './TerrainView';
import { WaterView } from './WaterView';
import { teamColor, WormView } from './WormView';

const STEP_MS = DT * 1000;
/** Left click drops a debug explosion, roughly bazooka-sized. */
const CLICK_BLAST = { radius: 40, damage: 40 };
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2.5;
/** How far the camera may look past the map edges and above the map. */
const CAMERA_MARGIN = 300;
const SKY_HEADROOM = 500;
const AIM_DISTANCE = 40;
/** Background gradients, top to bottom. Caverns get dark rock instead of sky. */
const BACKDROPS = {
  sky: ['#16325c', '#4f86c0', '#a9cfe6'],
  cave: ['#140e0b', '#2b1e17', '#46332a'],
};

const SANDBOX_TEAMS: TeamSetup[] = [
  { name: 'Red', worms: ['Noodle', 'Pickle', 'Sir Squirm'] },
  { name: 'Blue', worms: ['Wiggles', 'Gus', 'Dirt Dan'] },
];

interface SceneData {
  preset?: MapPreset;
  seed?: number;
}

/**
 * Milestone 1 sandbox: one map, a few worms, click to blow holes.
 * The simulation (World) runs at a fixed tick; this scene only feeds it input and draws it.
 */
export class GameScene extends Phaser.Scene {
  world!: World;
  private preset: MapPreset = 'one-island';
  private seed = 0;
  private terrainView!: TerrainView;
  private water!: WaterView;
  private wormViews = new Map<number, WormView>();
  private aimGfx!: Phaser.GameObjects.Graphics;
  private hud!: Hud;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private pendingJump = false;
  private pendingBackflip = false;
  private accumulator = 0;
  private followActive = true;

  constructor() {
    super('game');
  }

  init(data: SceneData): void {
    this.preset = data.preset ?? 'one-island';
    this.seed = data.seed ?? randomSeed();
    this.wormViews = new Map();
    this.pendingJump = false;
    this.pendingBackflip = false;
    this.accumulator = 0;
    this.followActive = true;
  }

  create(): void {
    this.world = createMatch(this.preset, this.seed, SANDBOX_TEAMS);
    const { terrain, waterLevel } = this.world;
    const enclosed = this.preset === 'cavern';
    const headroom = enclosed ? 0 : SKY_HEADROOM;
    this.addBackdrop(enclosed ? 'cave' : 'sky', terrain.width, terrain.height, headroom);
    this.terrainView = new TerrainView(this, terrain, DEPTH.terrain);
    for (const worm of this.world.worms) this.wormViews.set(worm.id, new WormView(this, worm));
    this.water = new WaterView(this, waterLevel, DEPTH.water);
    this.aimGfx = this.add.graphics().setDepth(DEPTH.labels);
    this.hud = new Hud();
    this.setupCamera(terrain.width, terrain.height, headroom);
    this.setupInput();
  }

  update(time: number, delta: number): void {
    // Cap the catch-up after a stall (e.g. a background tab) instead of fast-forwarding.
    this.accumulator += Math.min(delta, 250);
    while (this.accumulator >= STEP_MS) {
      this.world.step(this.readInput());
      this.accumulator -= STEP_MS;
    }
    this.handleEvents(this.world.drainEvents());

    const alpha = this.accumulator / STEP_MS;
    for (const worm of this.world.worms) {
      if (worm.alive) this.wormViews.get(worm.id)?.update(worm, alpha);
    }
    this.terrainView.flush();
    this.water.update(this.cameras.main, time);
    this.drawAim(time);
    this.updateCamera(delta);
    this.updateHud();
  }

  private readInput(): WormInput {
    const c = this.cursors;
    const input: WormInput = {
      left: c.left.isDown,
      right: c.right.isDown,
      up: c.up.isDown,
      down: c.down.isDown,
      jump: this.pendingJump,
      backflip: this.pendingBackflip,
    };
    this.pendingJump = false;
    this.pendingBackflip = false;
    if (input.left || input.right) this.followActive = true;
    return input;
  }

  private handleEvents(events: SimEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'carve':
          this.terrainView.carve(e.x, e.y, e.r);
          break;
        case 'explosion':
          explosionFlash(this, e.x, e.y, e.r);
          break;
        case 'damage': {
          const worm = this.world.worms[e.wormId];
          floatingText(this, worm.x, worm.y - 36, `-${e.amount}`, teamColor(worm.team));
          break;
        }
        case 'death': {
          const worm = this.world.worms[e.wormId];
          if (e.cause === 'drowned') splash(this, worm.x, this.world.waterLevel);
          this.wormViews.get(e.wormId)?.die(e.cause);
          this.wormViews.delete(e.wormId);
          break;
        }
      }
    }
  }

  private setupInput(): void {
    const kb = this.input.keyboard!;
    this.cursors = kb.createCursorKeys();
    kb.addCapture('ENTER,BACKSPACE,TAB');
    const onPress = (key: string, action: () => void) =>
      kb.on(`keydown-${key}`, (e: KeyboardEvent) => {
        if (!e.repeat) action();
      });
    onPress('ENTER', () => {
      this.pendingJump = true;
      this.followActive = true;
    });
    onPress('BACKSPACE', () => {
      this.pendingBackflip = true;
      this.followActive = true;
    });
    onPress('TAB', () => {
      this.world.selectNextWorm();
      this.followActive = true;
    });
    onPress('R', () => this.scene.restart({ preset: this.preset }));
    onPress('M', () => this.scene.restart({ preset: nextPreset(this.preset) }));
    onPress('H', () => this.hud.toggleHelp());

    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.leftButtonDown() && !p.event.shiftKey) {
        this.world.explode(p.worldX, p.worldY, CLICK_BLAST.radius, CLICK_BLAST.damage);
      }
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const panning = p.rightButtonDown() || p.middleButtonDown() || (p.leftButtonDown() && p.event.shiftKey);
      if (!panning) return;
      const cam = this.cameras.main;
      cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
      cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
      this.followActive = false;
    });
    this.input.on('wheel', (p: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number) => {
      const cam = this.cameras.main;
      const zoom = Phaser.Math.Clamp(cam.zoom * Math.exp(-dy * 0.0015), MIN_ZOOM, MAX_ZOOM);
      if (this.followActive) {
        cam.setZoom(zoom);
        return;
      }
      // Keep the world point under the cursor fixed while zooming.
      const anchor = cam.getWorldPoint(p.x, p.y);
      cam.setZoom(zoom);
      cam.scrollX = anchor.x - cam.width / 2 - (p.x - cam.width / 2) / zoom;
      cam.scrollY = anchor.y - cam.height / 2 - (p.y - cam.height / 2) / zoom;
    });
  }

  private setupCamera(width: number, height: number, headroom: number): void {
    const cam = this.cameras.main;
    cam.setBounds(-CAMERA_MARGIN, -headroom, width + CAMERA_MARGIN * 2, height + headroom);
    const worm = this.world.activeWorm;
    if (worm) cam.centerOn(worm.x, worm.y);
  }

  private updateCamera(delta: number): void {
    const view = this.followActive ? this.wormViews.get(this.world.activeWormId) : undefined;
    if (!view || !this.world.activeWorm) return;
    const cam = this.cameras.main;
    const k = 1 - Math.exp(-delta / 150);
    cam.scrollX += (view.x - cam.width / 2 - cam.scrollX) * k;
    cam.scrollY += (view.y - cam.height / 2 - cam.scrollY) * k;
  }

  /** Crosshair at the aim angle and a bobbing marker over the active worm. */
  private drawAim(time: number): void {
    const g = this.aimGfx.clear();
    const worm = this.world.activeWorm;
    const view = worm && this.wormViews.get(worm.id);
    if (!worm || !view) return;

    const cx = view.x + Math.cos(worm.aim) * worm.facing * AIM_DISTANCE;
    const cy = view.y - Math.sin(worm.aim) * AIM_DISTANCE;
    g.lineStyle(2, 0xff3b3b, 1);
    g.strokeCircle(cx, cy, 5);
    g.fillStyle(0xff3b3b, 1);
    g.fillCircle(cx, cy, 1.5);

    const my = view.y - 40 + Math.sin(time / 150) * 3;
    g.fillStyle(teamColor(worm.team), 1);
    g.lineStyle(2, 0x000000, 1);
    g.fillTriangle(view.x - 6, my - 9, view.x + 6, my - 9, view.x, my);
    g.strokeTriangle(view.x - 6, my - 9, view.x + 6, my - 9, view.x, my);
  }

  private addBackdrop(kind: keyof typeof BACKDROPS, width: number, height: number, headroom: number): void {
    const key = `backdrop-${kind}`;
    const colors = BACKDROPS[kind];
    if (!this.textures.exists(key)) {
      const tex = this.textures.createCanvas(key, 2, 256)!;
      const gradient = tex.context.createLinearGradient(0, 0, 0, 256);
      colors.forEach((color, i) => gradient.addColorStop(i / (colors.length - 1), color));
      tex.context.fillStyle = gradient;
      tex.context.fillRect(0, 0, 2, 256);
      tex.refresh();
    }
    // Extra width so zooming out past the camera bounds never shows an edge.
    const sideways = 4000;
    this.add
      .image(-sideways, -headroom, key)
      .setOrigin(0, 0)
      .setDisplaySize(width + sideways * 2, height + headroom)
      .setDepth(DEPTH.sky);
    this.cameras.main.setBackgroundColor(colors[0]);
  }

  private updateHud(): void {
    const worm = this.world.activeWorm;
    const mapName = MAP_PRESETS.find((p) => p.id === this.preset)!.name;
    const teamTotals = SANDBOX_TEAMS.map((team, i) => {
      const hp = this.world.worms.filter((w) => w.team === i && w.alive).reduce((sum, w) => sum + w.hp, 0);
      return `${team.name} ${hp}`;
    });
    this.hud.setInfo([
      `${mapName} · seed ${this.seed}`,
      worm ? `▶ ${worm.name} (${SANDBOX_TEAMS[worm.team].name}) ${worm.hp} HP` : 'No worms left — press R',
      teamTotals.join('   '),
    ]);
  }
}

function nextPreset(current: MapPreset): MapPreset {
  const i = MAP_PRESETS.findIndex((p) => p.id === current);
  return MAP_PRESETS[(i + 1) % MAP_PRESETS.length].id;
}
