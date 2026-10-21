import Phaser from 'phaser';
import { DT, TICK_RATE } from '../sim/constants';
import { generateMap, MAP_PRESETS, mapFromImage, type GeneratedMap } from '../sim/mapgen';
import { createMatch, type Match, type MatchEvent, type MatchSettings } from '../sim/match';
import { randomSeed } from '../sim/rng';
import type { Terrain } from '../sim/terrain';
import { CATEGORIES, WEAPONS, type WeaponId, type WeaponStatus } from '../sim/weapons';
import type { World } from '../sim/world';
import { NO_INPUT, type Worm, type WormInput } from '../sim/worm';
import {
  closeSession,
  currentSession,
  newRoomCode,
  openSession,
  type Frame,
  type OnlineSession,
  type OnlineStart,
} from '../net/OnlineSession';
import { DEPTH } from './depth';
import { explosionFlash, floatingText, splash } from './effects';
import { Hud } from './Hud';
import { findMap, imageScale, MAPS, type MapEntry } from './maps';
import { ProjectileView } from './ProjectileView';
import { RopeView } from './RopeView';
import { loadSettings, SetupScreen } from './SetupScreen';
import { TerrainView } from './TerrainView';
import { physicsChanges, showMapPicker, toggleTuningPanel, useHostPhysics, useOwnPhysics } from './TuningPanel';
import { WaterView } from './WaterView';
import { WeaponPanel, weaponForKey } from './WeaponPanel';
import { teamColor, teamColorCss, WormView } from './WormView';

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
/** Online: the player running the game sends its state this often (ticks): 20 times a second. */
const FRAME_TICKS = 3;
/** Online: watchers play frames back this many ticks behind the newest, to smooth out jitter... */
const PLAYBACK_DELAY = 6;
/** ...and jump ahead if they fall further behind than this. */
const MAX_PLAYBACK_LAG = 30;

interface SceneData {
  mapId?: string;
  seed?: number;
  settings?: MatchSettings;
  /** Start playing right away instead of showing the menu. */
  autostart?: boolean;
  /** An online match: everyone builds it from the same start. */
  online?: OnlineStart;
}

/**
 * A match, hot-seat on this computer or online. The Match (rules) and World (physics) run at
 * a fixed tick; this scene feeds them the keyboard and draws them.
 *
 * Online, one browser runs the game at a time: the one whose player has the turn (or the
 * host, covering for a player who left). It sends frames of state and events; everyone else
 * plays those back. When the turn passes to another player, so does running the game.
 */
export class GameScene extends Phaser.Scene {
  match!: Match;
  private world!: World;
  private map!: MapEntry;
  private seed = 0;
  private settings!: MatchSettings;
  private autostart = false;
  private online: OnlineStart | null = null;
  private session: OnlineSession | null = null;
  private joinCode = '';
  private terrainView!: TerrainView;
  private water!: WaterView;
  private wormViews = new Map<number, WormView>();
  private ropeView!: RopeView;
  private projectileView!: ProjectileView;
  private weaponPanel!: WeaponPanel;
  private setup!: SetupScreen;
  private aimGfx!: Phaser.GameObjects.Graphics;
  private hud!: Hud;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  /** Key presses waiting for the next simulation tick. */
  private pressed = { jump: false, backflip: false, fire: false, toggle: false };
  /** A weapon picked from the menu, waiting for the next simulation tick. */
  private picked: WeaponId | null = null;
  /** Where the map was clicked for an air strike, waiting for the next simulation tick. */
  private pickedTarget: number | null = null;
  private accumulator = 0;
  private followActive = true;
  /** Online: events since the last frame we sent. */
  private unsentEvents: MatchEvent[] = [];
  /** Online: frames waiting to be played back, and where playback is. */
  private frames: Frame[] = [];
  private playbackTick = -1;
  private lastFrameTick = 0;
  private watching = false;
  private watchAlpha = 1;
  private peerNames = new Map<string, string>();

  constructor() {
    super('game');
  }

  init(data: SceneData): void {
    // On first load the URL picks the map (or a room to join); after that the menu does.
    const url = new URLSearchParams(location.search);
    const urlSeed = Number(url.get('seed'));
    const firstLoad = !data.mapId && !data.online;
    this.online = data.online ?? null;
    this.session = currentSession();
    this.joinCode = firstLoad ? (url.get('join') ?? '').toUpperCase() : '';
    this.map = findMap(data.online?.mapId ?? data.mapId ?? url.get('map')) ?? MAPS[0];
    this.seed = data.online?.seed ?? data.seed ?? (firstLoad && urlSeed > 0 ? urlSeed : randomSeed());
    this.settings = data.online?.settings ?? data.settings ?? loadSettings();
    this.autostart = !!data.online || (data.autostart ?? false);
    this.wormViews = new Map();
    this.pressed = { jump: false, backflip: false, fire: false, toggle: false };
    this.picked = null;
    this.pickedTarget = null;
    this.accumulator = 0;
    this.followActive = true;
    this.unsentEvents = [];
    this.frames = [];
    this.playbackTick = -1;
    this.lastFrameTick = 0;
    this.watching = false;
  }

  preload(): void {
    const key = imageKey(this.map);
    if (this.map.kind === 'image' && !this.textures.exists(key)) this.load.image(key, this.map.url);
  }

  create(): void {
    if (this.online && !this.session?.isHost) useHostPhysics(this.online.physics);
    this.match = createMatch(this.buildMap(), this.seed, this.settings);
    this.world = this.match.world;
    const { terrain } = this.world;
    const query: Record<string, string> = this.session
      ? { join: this.session.code }
      : { map: this.map.id, seed: String(this.seed) };
    history.replaceState(null, '', `?${new URLSearchParams(query)}`);
    showMapPicker(MAPS, this.map.id, (mapId) => {
      if (!this.session) this.newMatch(this.settings, mapId);
      else if (this.session.isHost) this.startOnline(this.settings, mapId);
    });

    const enclosed = isEnclosed(this.map, terrain);
    const headroom = enclosed ? 0 : SKY_HEADROOM;
    this.addBackdrop(enclosed ? 'cave' : 'sky', terrain.width, terrain.height, headroom);
    this.terrainView = new TerrainView(this, terrain, DEPTH.terrain);
    for (const worm of this.world.worms) this.wormViews.set(worm.id, new WormView(this, worm));
    this.water = new WaterView(this, DEPTH.water);
    this.ropeView = new RopeView(this, DEPTH.rope);
    this.projectileView = new ProjectileView(this, DEPTH.projectiles);
    this.weaponPanel = new WeaponPanel(this.weaponStatus, (weapon) => {
      this.picked = weapon;
      this.followActive = true;
    });
    this.aimGfx = this.add.graphics().setDepth(DEPTH.labels);
    this.hud = new Hud();
    this.hud.hideGameOver();
    this.setup = new SetupScreen(MAPS, {
      startLocal: (settings, mapId) => this.newMatch(settings, mapId),
      startOnline: (settings, mapId) => this.startOnline(settings, mapId),
      host: (name) => this.enterRoom(newRoomCode(), name, true),
      join: (code, name) => this.enterRoom(code, name, false),
      leave: () => this.leaveOnline(),
      resume: () => this.setKeyboard(true),
    });
    this.setupCamera(terrain.width, terrain.height, headroom);
    this.setupInput();
    this.listenToSession();

    if (this.online && this.session) {
      const terrainHash = terrain.hash();
      if (this.session.isHost) this.session.sendStart({ ...this.online, terrainHash });
      else if (terrainHash !== this.online.terrainHash) {
        this.showLeaveScreen("Your map doesn't match the host's", 'Make sure you both have the same version of the game.');
      }
    }
    if (this.autostart) {
      // The menu may still be up, e.g. a guest's lobby when the host started the match.
      this.setup.close();
      this.match.start();
      this.handleEvents(this.match.drainEvents());
    } else this.openSetup();
  }

  update(time: number, delta: number): void {
    if (!this.online) this.playLocal(delta);
    else if (this.isRunningGame()) this.runOnline(delta);
    else this.watchOnline(delta);

    const alpha = this.online && this.watching ? this.watchAlpha : this.accumulator / STEP_MS;
    for (const worm of this.world.worms) {
      if (worm.alive) this.wormViews.get(worm.id)?.update(worm, alpha);
    }
    this.terrainView.flush();
    this.ropeView.update(this.world.worms, this.wormViews);
    this.projectileView.update(this.world.projectiles, alpha, time);
    this.water.update(this.cameras.main, time, this.world.waterLevel);
    this.drawAim(time);
    this.updateCamera(delta);
    this.updateHud();
  }

  /** Hot-seat: step the match with the keyboard; the menu pauses it. */
  private playLocal(delta: number): void {
    // Cap the catch-up after a stall (e.g. a background tab) instead of fast-forwarding.
    this.accumulator += Math.min(delta, 250);
    while (this.accumulator >= STEP_MS) {
      if (!this.setup.isOpen) this.match.step(this.readInput());
      this.accumulator -= STEP_MS;
    }
    this.handleEvents(this.match.drainEvents());
  }

  /** Online, running the game: step it and send frames until the turn passes to someone else. */
  private runOnline(delta: number): void {
    if (this.watching) {
      // Just took over: first catch up with everything the previous player sent.
      this.watching = false;
      this.accumulator = 0;
      for (const frame of [...this.frames, ...this.session!.takeFrames()]) this.applyFrame(frame);
      this.frames = [];
    }
    this.accumulator += Math.min(delta, 250);
    while (this.accumulator >= STEP_MS) {
      this.accumulator -= STEP_MS;
      // A player who left can't take their turn; skip it.
      if (!this.session!.isPresent(this.online!.owners[this.match.turnTeam])) this.match.forceEndTurn();
      // The game keeps running while the menu is open: the others are waiting.
      this.match.step(this.setup.isOpen ? NO_INPUT : this.readInput());
      const events = this.match.drainEvents();
      this.handleEvents(events);
      this.unsentEvents.push(...events);
      const handedOver = !this.isRunningGame();
      const urgent = events.some((e) => e.type === 'turnStart' || e.type === 'gameOver');
      if (handedOver || urgent || this.world.tick % FRAME_TICKS === 0) this.sendFrame();
      if (handedOver) break;
    }
  }

  /** Online, watching: play back received frames a little behind, for smooth movement. */
  private watchOnline(delta: number): void {
    this.watching = true;
    this.frames.push(...this.session!.takeFrames());
    if (this.frames.length === 0) return;
    const newest = this.frames[this.frames.length - 1].tick;
    if (this.playbackTick < 0 || newest - this.playbackTick > MAX_PLAYBACK_LAG) {
      this.playbackTick = newest - PLAYBACK_DELAY;
    }
    this.playbackTick = Math.min(this.playbackTick + delta / STEP_MS, newest);
    while (this.frames.length > 0 && this.frames[0].tick <= this.playbackTick) this.applyFrame(this.frames.shift()!);
    this.watchAlpha = Phaser.Math.Clamp((this.playbackTick - this.lastFrameTick) / FRAME_TICKS, 0, 1);
  }

  private sendFrame(): void {
    this.session!.sendFrame({ tick: this.world.tick, state: this.match.snapshot(), events: this.unsentEvents });
    this.unsentEvents = [];
  }

  /** Shows a frame: its events (craters, damage...), then its state. */
  private applyFrame(frame: Frame): void {
    for (const e of frame.events) if (e.type === 'carve') this.world.terrain.carve(e.x, e.y, e.r);
    this.handleEvents(frame.events);
    const worms = new Map(this.world.worms.map((w) => [w.id, w]));
    const projectiles = new Map(this.world.projectiles.map((p) => [p.id, p]));
    this.match.restore(frame.state);
    // Draw everything moving from where it was in the previous frame.
    for (const w of this.world.worms) {
      w.prevX = worms.get(w.id)?.x ?? w.x;
      w.prevY = worms.get(w.id)?.y ?? w.y;
    }
    for (const p of this.world.projectiles) {
      p.prevX = projectiles.get(p.id)?.x ?? p.x;
      p.prevY = projectiles.get(p.id)?.y ?? p.y;
    }
    this.lastFrameTick = frame.tick;
  }

  /** Online: whose browser runs the game now. The turn's player, or the host if they left. */
  private isRunningGame(): boolean {
    const session = this.session!;
    const owner = this.online!.owners[Math.max(0, this.match.turnTeam)];
    return (session.isPresent(owner) ? owner : session.hostId) === session.myId;
  }

  /** Starts a fresh hot-seat match (new seed) with these settings on this map. */
  private newMatch(settings: MatchSettings, mapId: string): void {
    this.scene.restart({ mapId, settings, autostart: true } satisfies SceneData);
  }

  /** Host: everyone in the room gets a team, host first; the scene sends the start on build. */
  private startOnline(settings: MatchSettings, mapId: string): void {
    const session = this.session!;
    const players = [...session.peers].sort((a, b) => Number(b.host) - Number(a.host));
    const start: OnlineStart = {
      settings: { ...settings, teams: players.map((p) => p.name) },
      mapId,
      seed: randomSeed(),
      owners: players.map((p) => p.id),
      physics: physicsChanges(),
      terrainHash: 0,
    };
    this.scene.restart({ online: start } satisfies SceneData);
  }

  private enterRoom(code: string, name: string, host: boolean): void {
    this.session = openSession(code, name, host);
    this.listenToSession();
    this.setup.refresh(this.session);
    history.replaceState(null, '', `?${new URLSearchParams({ join: code })}`);
  }

  private leaveOnline(): void {
    closeSession();
    this.session = null;
    useOwnPhysics();
    this.scene.restart({ mapId: this.map.id } satisfies SceneData);
  }

  private listenToSession(): void {
    const session = this.session;
    if (!session) return;
    this.peerNames = new Map(session.peers.map((p) => [p.id, p.name]));
    session.onChange = () => {
      this.setup.refresh(session);
      this.onPeersChanged(session);
    };
    session.onStart = (start) => {
      if (!findMap(start.mapId)) {
        session.error = `You don't have the map "${start.mapId}". Worms Revolution maps need your own copy in client/maps/wr.`;
        this.setup.refresh(session);
        return;
      }
      this.scene.restart({ online: start } satisfies SceneData);
    };
  }

  private onPeersChanged(session: OnlineSession): void {
    const now = new Map(session.peers.map((p) => [p.id, p.name]));
    if (this.online) {
      for (const [id, name] of this.peerNames) if (!now.has(id)) this.hud.showBanner(`${name} left the game`);
      if (!session.isHost && !session.hostId && this.match.phase !== 'over') {
        this.showLeaveScreen('The host left the game');
      }
    }
    this.peerNames = now;
  }

  private showLeaveScreen(title: string, note = ''): void {
    this.weaponPanel.close();
    this.hud.showGameOver(title, '#ffffff', [{ label: 'Back to menu', primary: true, onClick: () => this.leaveOnline() }], note);
  }

  private openSetup(): void {
    this.weaponPanel.close();
    this.setKeyboard(false);
    const inProgress = this.match.phase !== 'waiting' && this.match.phase !== 'over';
    this.setup.open({
      settings: this.settings,
      mapId: this.map.id,
      canResume: inProgress,
      session: this.session,
      joinCode: this.joinCode,
    });
  }

  /** The game ignores the keyboard while the menu is up, so names can be typed. */
  private setKeyboard(enabled: boolean): void {
    const kb = this.input.keyboard!;
    kb.enabled = enabled;
    if (enabled) kb.enableGlobalCapture();
    else {
      kb.disableGlobalCapture();
      kb.resetKeys();
    }
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
    const target = this.pickedTarget;
    this.picked = null;
    this.pickedTarget = null;
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
      target,
    };
    this.pressed = { jump: false, backflip: false, fire: false, toggle: false };
    if (input.left || input.right || input.up || input.down) this.followActive = true;
    return input;
  }

  private handleEvents(events: MatchEvent[]): void {
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
          this.wormViews.get(e.wormId)?.update(worm, 1); // show its final health while it fades
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
        case 'hit':
          floatingText(this, e.x, e.y - 20, e.landed ? 'WHACK!' : 'whoosh', e.landed ? 0xffe14d : 0xcccccc);
          if (e.landed) this.cameras.main.shake(120, 0.004);
          break;
        case 'turnStart': {
          this.weaponPanel.close();
          this.pressed = { jump: false, backflip: false, fire: false, toggle: false };
          this.followActive = true;
          const turn = `${this.settings.teams[e.team]}'s turn`;
          // Sudden death starts in the same tick as the next turn; announce both together.
          if (events.some((x) => x.type === 'suddenDeath')) {
            this.hud.showBanner(`Sudden death! The water is rising\n${turn}`, '#ff6b6b', 3000);
          } else {
            this.hud.showBanner(turn, teamColorCss(e.team));
          }
          break;
        }
        case 'gameOver':
          this.showGameOver(e.winner);
          break;
        case 'suddenDeath': // announced with the turn that follows
        case 'mineTriggered':
        case 'weaponUsed':
          break;
      }
    }
  }

  private showGameOver(winner: number | null): void {
    this.weaponPanel.close();
    const title = winner === null ? 'Draw!' : `${this.settings.teams[winner]} wins!`;
    const color = winner === null ? '#ffffff' : teamColorCss(winner);
    const backToMenu = () => {
      this.hud.hideGameOver();
      this.openSetup();
    };
    if (!this.session) {
      this.hud.showGameOver(title, color, [
        { label: 'Rematch', primary: true, onClick: () => this.newMatch(this.settings, this.map.id) },
        { label: 'New match', onClick: backToMenu },
      ]);
    } else if (this.session.isHost) {
      this.hud.showGameOver(title, color, [
        { label: 'Rematch', primary: true, onClick: () => this.startOnline(this.settings, this.map.id) },
        { label: 'Back to lobby', onClick: backToMenu },
      ]);
    } else {
      this.hud.showGameOver(title, color, [{ label: 'Leave', onClick: () => this.leaveOnline() }], 'Waiting for the host to start another match…');
    }
  }

  private setupInput(): void {
    const kb = this.input.keyboard!;
    this.cursors = kb.createCursorKeys();
    kb.addCapture('ENTER,BACKSPACE,TAB,SPACE,SHIFT,F1,F2,F3,F4,F5,F6');
    this.setKeyboard(true);
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
    onPress('SHIFT', () => this.toggleWeaponPanel());
    onPress('ESC', () => (panel.isOpen ? panel.close() : this.openSetup()));
    const arrows = [['LEFT', -1, 0], ['RIGHT', 1, 0], ['UP', 0, -1], ['DOWN', 0, 1]] as const;
    for (const [key, dx, dy] of arrows) onPress(key, () => panel.isOpen && panel.move(dx, dy));
    // F1–F6 pick from a row of the panel without opening it; pressing again goes along the row.
    CATEGORIES.forEach((category, i) =>
      onPress(category.key, () => {
        const worm = this.controlledWorm();
        const weapon = worm && weaponForKey(i, worm.weapon, this.weaponStatus);
        if (!weapon) return;
        panel.close();
        this.picked = weapon;
        this.followActive = true;
      }),
    );
    onPress('H', () => this.hud.toggleHelp());
    onPress('T', toggleTuningPanel);

    this.input.mouse?.disableContextMenu();
    // Air strike: a left click on the map calls it in there.
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (!p.leftButtonDown() || p.event.altKey || this.weaponPanel.isOpen) return;
      const worm = this.match.activeWorm;
      const mine = !this.online || this.isRunningGame();
      if (!worm || !mine || WEAPONS[worm.weapon].use !== 'strike') return;
      this.pickedTarget = Math.round(this.cameras.main.getWorldPoint(p.x, p.y).x);
      this.followActive = true;
    });
    // A right click (not a drag, that pans) opens and closes the weapon panel, as in Worms.
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (p.rightButtonReleased() && p.getDistance() < 6) this.toggleWeaponPanel();
    });
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

  /** What the team whose turn it is has of a weapon. */
  private readonly weaponStatus = (weapon: WeaponId): WeaponStatus =>
    this.match.weaponStatus(this.match.turnTeam, weapon);

  /** The worm this player may act with now: their turn, and not mid-charge (it'd fire). */
  private controlledWorm(): Worm | undefined {
    const worm = this.match.activeWorm;
    const mine = !this.online || this.isRunningGame();
    return worm && mine && worm.charge === null ? worm : undefined;
  }

  private toggleWeaponPanel(): void {
    const worm = this.controlledWorm();
    if (this.weaponPanel.isOpen) this.weaponPanel.close();
    else if (worm) this.weaponPanel.open(worm.weapon);
  }

  private setupCamera(width: number, height: number, headroom: number): void {
    const cam = this.cameras.main;
    cam.setBounds(-CAMERA_MARGIN, -headroom, width + CAMERA_MARGIN * 2, height + headroom);
    const first = this.world.worms[0];
    if (first) cam.centerOn(first.x, first.y);
  }

  /** Like Worms: watch whatever is flying, otherwise the worm whose turn it is (or was). */
  private updateCamera(delta: number): void {
    if (!this.followActive) return;
    const flying = this.world.projectiles.findLast((p) => p.kind !== 'mine' && !p.resting);
    const target = flying ?? this.wormViews.get(this.world.activeWormId);
    if (!target) return;
    const cam = this.cameras.main;
    const k = 1 - Math.exp(-delta / 150);
    cam.scrollX += (target.x - cam.width / 2 - cam.scrollX) * k;
    cam.scrollY += (target.y - cam.height / 2 - cam.scrollY) * k;
  }

  /** Crosshair, power bar while charging, and a bobbing marker over the active worm. */
  private drawAim(time: number): void {
    const g = this.aimGfx.clear();
    const worm = this.match.activeWorm;
    const view = worm && this.wormViews.get(worm.id);
    if (!worm || !view) return;

    const my = view.y - 40 + Math.sin(time / 150) * 3;
    g.fillStyle(teamColor(worm.team), 1);
    g.lineStyle(2, 0x000000, 1);
    g.fillTriangle(view.x - 6, my - 9, view.x + 6, my - 9, view.x, my);
    g.strokeTriangle(view.x - 6, my - 9, view.x + 6, my - 9, view.x, my);

    // While hanging on the rope, ↑ ↓ climb instead of aiming.
    if (worm.rope?.phase === 'attached') return;
    if (WEAPONS[worm.weapon].use === 'strike') return this.drawStrikeTarget(g, worm);
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

  /** Air strike: a target where the pointer's column meets the ground, arrows the way it comes in. */
  private drawStrikeTarget(g: Phaser.GameObjects.Graphics, worm: Worm): void {
    const pointer = this.input.activePointer;
    const x = this.cameras.main.getWorldPoint(pointer.x, pointer.y).x;
    const y = this.world.surfaceY(Math.round(x));
    g.lineStyle(2, 0xff3b3b, 1);
    g.strokeCircle(x, y, 10);
    g.lineBetween(x - 15, y, x - 5, y);
    g.lineBetween(x + 5, y, x + 15, y);
    g.lineBetween(x, y - 15, x, y - 5);
    for (let i = 1; i <= 3; i++) {
      const ax = x - worm.facing * (20 + i * 14);
      const ay = y - 40 - i * 34;
      g.lineBetween(ax, ay, ax + worm.facing * 8, ay + 18);
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
    const { phase, turnTeam, ticksLeft, settings } = this.match;
    const where = this.session ? `Online · room ${this.session.code}` : `${this.map.name} · seed ${this.seed}`;
    this.hud.setInfo([where, 'H: help · Esc: menu']);
    const worm = this.world.worms[this.world.activeWormId];
    const showTurn = phase === 'playing' || phase === 'retreat' || phase === 'settling';
    this.hud.setTurn(
      showTurn && worm
        ? {
            team: turnTeam,
            teamName: settings.teams[turnTeam],
            wormName: worm.name,
            weapon: weaponLabel(worm, this.match.weaponStatus(turnTeam, worm.weapon)),
            seconds: ticksLeft / TICK_RATE,
            phase,
          }
        : null,
    );
    this.hud.setTeams(
      settings.teams.map((name, team) => ({
        name,
        hp: this.world.worms.filter((w) => w.team === team && w.alive).reduce((sum, w) => sum + w.hp, 0),
        maxHp: settings.wormsPerTeam * settings.wormHp,
      })),
    );
    this.hud.setWind(this.world.wind);
  }
}

function weaponLabel(worm: Worm, status: WeaponStatus): string {
  const weapon = WEAPONS[worm.weapon];
  const ammo = status.ammo === null ? '' : ` ×${status.ammo}`;
  if (weapon.hasFuse) return `${weapon.name}${ammo} (${worm.fuse} s)`;
  return weapon.use === 'strike' ? `${weapon.name}${ammo} (click the map)` : `${weapon.name}${ammo}`;
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
