import GUI, { type Controller } from 'lil-gui';
import { DEFAULT_PHYS, PHYS, resetPhys, type Physics } from '../sim/constants';

const STORAGE_KEY = 'neoworms.physics';

let gui: GUI | null = null;
let mapFolder: GUI | null = null;
let mapController: Controller | null = null;
const mapChoice = { map: '' };
let onPickMap: (id: string) => void = () => {};

/**
 * Live sliders for the physics values. Tweaks are saved in the browser so they survive
 * reloads; "Copy values" puts the changed ones on the clipboard to share or bake into
 * constants.ts. Only changed values are stored, so new defaults still reach everyone else.
 */
export function createTuningPanel(): void {
  loadSaved();
  gui = new GUI({ title: 'Tuning  (T to hide)' });
  mapFolder = gui.addFolder('Map'); // filled in by showMapPicker once the game knows its maps

  const rope = gui.addFolder('Ninja rope');
  rope.add(PHYS, 'ropeSwingAccel', 0, 1500, 10).name('swing push');
  rope.add(PHYS, 'ropeReelSpeed', 20, 600, 10).name('climb speed');
  rope.add(PHYS, 'ropeReelMomentum', 0, 1, 0.05).name('climb speeds up swing');
  rope.add(PHYS, 'ropeMaxLength', 100, 900, 10).name('max length');
  rope.add(PHYS, 'ropeShotSpeed', 300, 5000, 50).name('shot speed');
  rope.add(PHYS, 'ropeMaxSpeed', 200, 2000, 10).name('max swing speed');
  rope.add(PHYS, 'ropeBounce', 0, 1, 0.05).name('wall bounce');
  rope.add(PHYS, 'ropeCanGoSlack').name('can go slack');
  rope.add(PHYS, 'ropeAutoHop', 0, 600, 5).name('hop when hooking in');

  const world = gui.addFolder('World');
  world.add(PHYS, 'gravity', 100, 1500, 10);
  world.add(PHYS, 'maxFallSpeed', 200, 2000, 10).name('max fall speed');

  const worm = gui.addFolder('Worm');
  worm.add(PHYS, 'walkSpeed', 10, 200, 1).name('walk speed');
  worm.add(PHYS, 'jumpVx', 0, 400, 5).name('jump forward');
  worm.add(PHYS, 'jumpVy', -600, 0, 5).name('jump up');
  worm.add(PHYS, 'backflipVx', -300, 0, 5).name('backflip back');
  worm.add(PHYS, 'backflipVy', -800, 0, 5).name('backflip up');
  worm.add(PHYS, 'jumpDelay', 0, 0.6, 0.05).name('crouch before jump (s)');
  worm.add(PHYS, 'jumpAfterTouch', 0, 1, 0.02).name('jump air steering');
  worm.add(PHYS, 'backflipAfterTouch', 0, 1, 0.02).name('flip air steering');
  worm.add(PHYS, 'safeLandingSpeed', 100, 1000, 10).name('safe landing speed');
  worm.add(PHYS, 'maxDamageLandingSpeed', 200, 2000, 10).name('max-damage landing');
  worm.add(PHYS, 'maxFallDamage', 0, 100, 1).name('max fall damage');
  worm.close();

  const blast = gui.addFolder('Explosions');
  blast.add(PHYS, 'blastKnockback', 0, 1500, 10).name('knockback');
  blast.add(PHYS, 'blastLift', 0, 600, 10).name('lift');
  blast.close();

  gui.add({ copy: copyValues }, 'copy').name('Copy values');
  gui.add({ reset: resetValues }, 'reset').name('Reset to defaults');

  gui.onFinishChange(() => {
    save();
    // Hand the arrow keys back to the game instead of the focused slider.
    (document.activeElement as HTMLElement | null)?.blur();
  });
}

export function toggleTuningPanel(): void {
  gui?.show(gui._hidden);
}

/** Shows the map dropdown, set to the current map. Picking another one calls `onPick`. */
export function showMapPicker(maps: { id: string; name: string }[], current: string, onPick: (id: string) => void): void {
  onPickMap = onPick;
  mapChoice.map = current;
  if (!mapFolder) return;
  if (!mapController) {
    const options = Object.fromEntries(maps.map((m) => [m.name, m.id]));
    mapController = mapFolder.add(mapChoice, 'map', options).name('map  (M = next)');
    mapController.onChange((id: string) => onPickMap(id));
  }
  mapController.updateDisplay();
}

function copyValues(): void {
  void navigator.clipboard.writeText(JSON.stringify(changedValues(), null, 2));
}

function changedValues(): Partial<Physics> {
  const keys = Object.keys(PHYS) as (keyof Physics)[];
  return Object.fromEntries(keys.filter((k) => PHYS[k] !== DEFAULT_PHYS[k]).map((k) => [k, PHYS[k]]));
}

function resetValues(): void {
  resetPhys();
  localStorage.removeItem(STORAGE_KEY);
  gui?.controllersRecursive().forEach((c) => c.updateDisplay());
}

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(changedValues()));
  } catch {
    // Storage can be unavailable (private mode); tuning just won't persist.
  }
}

function loadSaved(): void {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Physics>;
    for (const key of Object.keys(PHYS) as (keyof Physics)[]) {
      if (typeof saved[key] === typeof PHYS[key]) Object.assign(PHYS, { [key]: saved[key] });
    }
  } catch {
    // Missing or corrupt saved values: keep the defaults.
  }
}
