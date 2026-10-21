import Phaser from 'phaser';
import { DT } from '../sim/constants';
import { generateMap, MAP_PRESETS, mapFromImage, type GeneratedMap } from '../sim/mapgen';
import { randomSeed } from '../sim/rng';
import type { Terrain } from '../sim/terrain';
import { createMatch, type SimEvent, type TeamSetup, type World } from '../sim/world';
import { WEAPONS, type WeaponId } from '../sim/weapons';
import { NO_INPUT, type WormInput } from '../sim/worm';
import { DEPTH } from './depth';
import { explosionFlash, floatingText, splash } from './effects';
import { Hud } from './Hud';
import { findMap, imageScale, MAPS, type MapEntry } from './maps';
import { ProjectileView } from './ProjectileView';
import { RopeView } from './RopeView';
import { TerrainView } from './TerrainView';
import { showMapPicker, toggleTuningPanel } from './TuningPanel';
import { WaterView } from './WaterView';
import { WeaponPanel } from './WeaponPanel';
import { teamColor, WormView } from './WormView';

const STEP_MS = DT * 1000;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2.5;
/** How far the camera may look past the map edges and above the map. */
const CAMERA_MARGIN = 300;
const SKY_HEADROOM = 500;
const AIM_DISTANCE = 40;
const POWER_LENGTH = 48;
const POWER_SEGMENTS = 12;
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
  mapId?: string;
  seed?: number;
}

/**
 * Sandbox: one map, a few worms, the ninja rope and weapons, no turns yet.
 * The simulation (World) runs at a fixed tick; this scene only feeds it input and draws it.
 * The map and seed live in the URL (?map=rope-gym&seed=42), so a reload keeps the same map.
 * Image maps load in preload(); generated ones are built in create().
 */
export class GameScene extends Phaser.Scene {
  world!: World;
  private map!: MapEntry;
  private seed = 0;
  private terrainView!: TerrainView;
  private water!: WaterView;
  private wormViews = new Map<number, WormView>();
  private ropeView!: RopeView;
  private projectileView!: ProjectileView;
  private weaponPanel!: WeaponPanel;
  private aimGfx!: Phaser.GameObjects.Graphics;
  private hud!: Hud;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  /** Key presses waiting for the next simulation tick. */
  private pressed = { jump: false, backflip: false, fire: false, toggle: false };
  /** A weapon picked from the menu, waiting for the next simulation tick. */
  private picked: WeaponId | null = null;
  private accumulator = 0;
  private followActive = true;

  constructor() {
    super('game');
  }

  init(data: SceneData): void {
    // On first load the URL picks the map; after that, R, M and the map picker do.
    const url = new URLSearchParams(location.search);
    const urlSeed = Number(url.get('seed'));
    const firstLoad = !data.mapId;
    this.map = findMap(data.mapId ?? url.get('map')) ?? MAPS[0];
    this.seed = data.seed ?? (firstLoad && urlSeed > 0 ? urlSeed : randomSeed());
    this.wormViews = new Map();
    this.pressed = { jump: false, backflip: false, fire: false, toggle: false };
    this.picked = null;
    this.accumulator = 0;
    this.followActive = true;
  }

  preload(): void {
    const key = imageKey(this.map);
    if (this.map.kind === 'image' && !this.textures.exists(key)) this.load.image(key, this.map.url);
  }

  create(): void {
    this.world = createMatch(this.buildMap(), this.seed, SANDBOX_TEAMS);
    const { terrain, waterLevel } = this.world;
    history.replaceState(null, '', `?${new URLSearchParams({ map: this.map.id, seed: String(this.seed) })}`);
    showMapPicker(MAPS, this.map.id, (mapId) => this.scene.restart({ mapId }));
    const enclosed = isEnclosed(this.map, terrain);
    const headroom = enclosed ? 0 : SKY_HEADROOM;
    this.addBackdrop(enclosed ? 'cave' : 'sky', terrain.width, terrain.height, headroom);
    this.terrainView = new TerrainView(this, terrain, DEPTH.terrain);
    for (const worm of this.world.worms) this.wormViews.set(worm.id, new WormView(this, worm));
    this.water = new WaterView(this, waterLevel, DEPTH.water);
    this.ropeView = new RopeView(this, DEPTH.rope);
    this.projectileView = new ProjectileView(this, DEPTH.projectiles);
    this.weaponPanel = new WeaponPanel((weapon) => {
      this.picked = weapon;
      this.followActive = true;
    });
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
    this.ropeView.update(this.world.worms, this.wormViews);
    this.projectileView.update(this.world.projectiles, alpha, time);
    this.water.update(this.cameras.main, time);
    this.drawAim(time);
    this.updateCamera(delta);
    this.updateHud();
  }

  private buildMap(): GeneratedMap {
    if (this.map.kind === 'generated') return generateMap(this.map.preset, this.seed);
    const image = this.textures.get(imageKey(this.map)).getSourceImage() as HTMLImageElement;
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(image, 0, 0);
    const { data } = ctx.getImageData(0, 0, image.width, image.height);
    return mapFromImage(data, image.width, image.height, imageScale(this.map));
  }

  private readInput(): WormInput {
    const c = this.cursors;
    const select = this.picked;
    this.picked = null;
    // While the weapon menu is open the keys drive the menu, not the worm.
    if (this.weaponPanel.isOpen) return { ...NO_INPUT, select };
    const input: WormInput = {
      left: c.left.isDown,
      right: c.right.isDown,
      up: c.up.isDown,
      down: c.down.isDown,
      fireHeld: c.space.isDown,
      ...this.pressed,
      select,
    };
    this.pressed = { jump: false, backflip: false, fire: false, toggle: false };
    if (input.left || input.right || input.up || input.down) this.followActive = true;
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
        case 'sink':
          splash(this, e.x, e.y);
          break;
        case 'dud':
          floatingText(this, e.x, e.y - 10, 'dud', 0xcccccc);
          break;
        case 'mineTriggered':
          break; // the mine's light starts blinking fast
      }
    }
  }

  private setupInput(): void {
    const kb = this.input.keyboard!;
    this.cursors = kb.createCursorKeys();
    kb.addCapture('ENTER,BACKSPACE,TAB,SPACE,SHIFT');
    const onPress = (key: string, action: () => void) =>
      kb.on(`keydown-${key}`, (e: KeyboardEvent) => {
        if (!e.repeat) action();
      });
    const press = (action: keyof typeof this.pressed) => () => {
      this.pressed[action] = true;
      this.followActive = true;
    };
    const panel = this.weaponPanel;
    onPress('ENTER', () => (panel.isOpen ? panel.choose() : press('jump')()));
    onPress('SPACE', () => (panel.isOpen ? panel.choose() : press('fire')()));
    onPress('BACKSPACE', press('backflip'));
    onPress('TAB', press('toggle'));
    onPress('SHIFT', () => {
      const worm = this.world.activeWorm;
      if (panel.isOpen) panel.close();
      else if (worm && worm.charge === null) panel.open(worm.weapon); // not mid-charge: it'd fire
    });
    onPress('ESC', () => panel.close());
    for (const [key, step] of [['LEFT', -1], ['UP', -1], ['RIGHT', 1], ['DOWN', 1]] as const) {
      onPress(key, () => panel.isOpen && panel.move(step));
    }
    onPress('N', () => {
      this.world.selectNextWorm();
      this.followActive = true;
    });
    onPress('R', () => this.scene.restart({ mapId: this.map.id }));
    onPress('M', () => this.scene.restart({ mapId: nextMap(this.map).id }));
    onPress('H', () => this.hud.toggleHelp());
    onPress('T', toggleTuningPanel);

    this.input.mouse?.disableContextMenu();
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const panning = p.rightButtonDown() || p.middleButtonDown() || (p.leftButtonDown() && p.event.altKey);
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

  /** Crosshair, power bar while charging, and a bobbing marker over the active worm. */
  private drawAim(time: number): void {
    const g = this.aimGfx.clear();
    const worm = this.world.activeWorm;
    const view = worm && this.wormViews.get(worm.id);
    if (!worm || !view) return;

    const my = view.y - 40 + Math.sin(time / 150) * 3;
    g.fillStyle(teamColor(worm.team), 1);
    g.lineStyle(2, 0x000000, 1);
    g.fillTriangle(view.x - 6, my - 9, view.x + 6, my - 9, view.x, my);
    g.strokeTriangle(view.x - 6, my - 9, view.x + 6, my - 9, view.x, my);

    // While hanging on the rope, ↑ ↓ climb instead of aiming.
    if (worm.rope?.phase === 'attached') return;
    const cx = view.x + Math.cos(worm.aim) * worm.facing * AIM_DISTANCE;
    const cy = view.y - Math.sin(worm.aim) * AIM_DISTANCE;
    g.lineStyle(2, 0xff3b3b, 1);
    g.strokeCircle(cx, cy, 5);
    g.fillStyle(0xff3b3b, 1);
    g.fillCircle(cx, cy, 1.5);

    if (worm.charge === null) return;
    // Power bar: grows from the worm toward the crosshair, yellow to red.
    const dx = Math.cos(worm.aim) * worm.facing;
    const dy = -Math.sin(worm.aim);
    const segments = Math.ceil(worm.charge * POWER_SEGMENTS);
    for (let i = 0; i < segments; i++) {
      const t = i / POWER_SEGMENTS;
      const color = Phaser.Display.Color.Interpolate.ColorWithColor(
        Phaser.Display.Color.ValueToColor(0xffe14d),
        Phaser.Display.Color.ValueToColor(0xff2b2b),
        POWER_SEGMENTS,
        i,
      );
      const from = 12 + t * POWER_LENGTH;
      const to = 12 + (t + 1 / POWER_SEGMENTS) * POWER_LENGTH;
      g.lineStyle(3 + t * 5, Phaser.Display.Color.GetColor(color.r, color.g, color.b), 1);
      g.lineBetween(view.x + dx * from, view.y + dy * from, view.x + dx * to, view.y + dy * to);
    }
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
    const mapName = this.map.name;
    const teamTotals = SANDBOX_TEAMS.map((team, i) => {
      const hp = this.world.worms.filter((w) => w.team === i && w.alive).reduce((sum, w) => sum + w.hp, 0);
      return `${team.name} ${hp}`;
    });
    const weapon = worm && WEAPONS[worm.weapon];
    this.hud.setInfo([
      `${mapName} · seed ${this.seed}`,
      worm ? `▶ ${worm.name} (${SANDBOX_TEAMS[worm.team].name}) ${worm.hp} HP` : 'No worms left — press R',
      weapon ? `${weapon.name}${weapon.hasFuse ? ` · fuse ${worm.fuse} s (Tab)` : ''} · Shift: weapons` : '',
      teamTotals.join('   '),
    ]);
    this.hud.setWind(this.world.wind);
  }
}

function nextMap(current: MapEntry): MapEntry {
  return MAPS[(MAPS.indexOf(current) + 1) % MAPS.length];
}

function imageKey(map: MapEntry): string {
  return `map:${map.id}`;
}

/** Generated maps say so; image maps count as caves when ground covers most of the top edge. */
function isEnclosed(map: MapEntry, terrain: Terrain): boolean {
  if (map.kind === 'generated') return MAP_PRESETS.find((p) => p.id === map.preset)!.enclosed;
  let solid = 0;
  for (let x = 0; x < terrain.width; x++) if (terrain.isSolid(x, 0)) solid++;
  return solid > terrain.width / 2;
}
