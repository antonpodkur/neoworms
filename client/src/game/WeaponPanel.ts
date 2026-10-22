import { isUsable, PANEL, QUICK_SELECT, WEAPONS, type PanelSlot, type WeaponId, type WeaponStatus } from '../sim/weapons';

/** Placeholder icons until real art (milestone 7). */
const ICONS: Record<WeaponId, string> = {
  rope: '🪝',
  bazooka: '🚀',
  grenade: '💣',
  cluster: '🎆',
  petrol: '🍾',
  homing: '🎯',
  banana: '🍌',
  firePunch: '👊',
  dragonBall: '🔥',
  kamikaze: '🎌',
  shotgun: '🔫',
  uzi: '💥',
  holy: '✝️',
  dynamite: '🧨',
  mine: '◉',
  oldWoman: '👵',
  sheep: '🐑',
  superSheep: '🦸',
  airstrike: '✈️',
  bat: '🏏',
  prod: '👉',
  parachute: '🪂',
  jetpack: '🎒',
  teleport: '🌀',
  girder: '🧱',
  skipGo: '⏭️',
  surrender: '🏳️',
  wormSelect: '🔄',
};

interface Cell {
  slot: PanelSlot;
  el: HTMLElement;
  ammo?: HTMLElement;
  wait?: HTMLElement;
}

const COLS = PANEL.weapons[0].length + PANEL.utilities[0].length;
const ROWS = PANEL.weapons.length;

/**
 * The weapon panel, laid out like Worms Revolution's Inventory: five rows of seven weapons
 * (orange slots) and four utilities (blue), with WR's Quick Select key at the start of each
 * row. Weapons we haven't made yet keep their WR slot but show empty. Ammo sits in a slot's
 * corner (none for unlimited); weapons the team can't use yet are greyed with the turns left
 * in brackets. A bar along the bottom names the highlighted weapon. Arrows move, Space or
 * Enter picks, Shift, Esc or a right click closes; the mouse highlights and clicks too. Plain
 * DOM so it stays crisp at any zoom.
 */
export class WeaponPanel {
  private readonly root = document.getElementById('weapon-panel')!;
  private readonly name = document.createElement('span');
  private readonly note = document.createElement('span');
  /** Rows of the whole grid, weapons then utilities, left to right. */
  private readonly cells: Cell[][];
  private col = 0;
  private row = 0;

  constructor(
    /** What the team whose turn it is has of a weapon. */
    private readonly status: (weapon: WeaponId) => WeaponStatus,
    private readonly onPick: (weapon: WeaponId) => void,
  ) {
    const header = document.createElement('div');
    header.className = 'header';
    header.textContent = 'Inventory';

    const grid = document.createElement('div');
    grid.className = 'grid';
    grid.style.gridTemplateColumns =
      `auto repeat(${PANEL.weapons[0].length}, auto) auto repeat(${PANEL.utilities[0].length}, auto)`;
    this.cells = PANEL.weapons.map((weapons, r) => {
      const row = [...weapons, ...PANEL.utilities[r]];
      grid.append(keyLabel(QUICK_SELECT[r].key));
      return row.map((slot, c) => {
        if (c === weapons.length) grid.append(keyLabel(QUICK_SELECT[r + ROWS].key));
        const cell = this.makeCell(slot, c >= weapons.length);
        cell.el.addEventListener('mouseenter', () => this.moveTo(c, r));
        cell.el.addEventListener('click', () => this.pick(c, r));
        grid.append(cell.el);
        return cell;
      });
    });

    const footer = document.createElement('div');
    footer.className = 'footer';
    this.note.className = 'note';
    footer.append(this.name, this.note);

    this.root.replaceChildren(header, grid, footer);
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    this.close();
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(current: WeaponId): void {
    this.row = Math.max(0, this.cells.findIndex((row) => row.some((c) => c.slot === current)));
    this.col = Math.max(0, this.cells[this.row].findIndex((c) => c.slot === current));
    this.root.hidden = false;
    this.render();
  }

  close(): void {
    this.root.hidden = true;
  }

  /** Arrow keys: across the grid, wrapping at the edges, empty slots included (as in WR). */
  move(dx: number, dy: number): void {
    this.moveTo((this.col + dx + COLS) % COLS, (this.row + dy + ROWS) % ROWS);
  }

  choose(): void {
    this.pick(this.col, this.row);
  }

  private makeCell(slot: PanelSlot, utility: boolean): Cell {
    if (slot === null || typeof slot === 'object') {
      const el = document.createElement('div');
      el.className = 'slot empty';
      if (slot) el.title = `${slot.soon} (not in the game yet)`;
      return { slot, el };
    }
    const button = document.createElement('button');
    button.className = `slot ${utility ? 'tool' : 'weapon'}`;
    button.tabIndex = -1;
    button.title = WEAPONS[slot].name;
    button.innerHTML = `<span class="ammo"></span><span class="icon">${ICONS[slot]}</span><span class="wait"></span>`;
    button.addEventListener('mousedown', (e) => e.preventDefault()); // keep keyboard focus on the game
    return { slot, el: button, ammo: button.querySelector<HTMLElement>('.ammo')!, wait: button.querySelector<HTMLElement>('.wait')! };
  }

  private moveTo(col: number, row: number): void {
    this.col = col;
    this.row = row;
    this.render();
  }

  /** Weapons that can't be used yet (or any more), and empty slots, stay put with a little shake. */
  private pick(col: number, row: number): void {
    const cell = this.cells[row][col];
    if (typeof cell.slot !== 'string' || !isUsable(this.status(cell.slot))) {
      cell.el.animate(
        [{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }],
        { duration: 180 },
      );
      return;
    }
    this.close();
    this.onPick(cell.slot);
  }

  private render(): void {
    this.cells.forEach((row, r) =>
      row.forEach(({ slot, el, ammo, wait }, c) => {
        el.classList.toggle('selected', c === this.col && r === this.row);
        if (typeof slot !== 'string') return;
        const s = this.status(slot);
        el.classList.toggle('unavailable', !isUsable(s));
        ammo!.textContent = s.ammo === null ? '' : String(s.ammo);
        wait!.textContent = s.blocked ? '✕' : s.wait > 0 ? `(${s.wait})` : '';
      }),
    );
    const { slot } = this.cells[this.row][this.col];
    if (typeof slot !== 'string') {
      this.name.textContent = slot ? slot.soon : '';
      this.note.textContent = slot ? 'Not in the game yet' : '';
      return;
    }
    const s = this.status(slot);
    this.name.textContent = `${s.ammo === null ? '∞' : s.ammo} x ${WEAPONS[slot].name}`;
    this.note.textContent = s.blocked
      ? 'No open sky on this map'
      : s.wait > 0
        ? `Ready in ${s.wait} turn${s.wait > 1 ? 's' : ''}`
        : s.ammo === 0
          ? 'None left'
          : quickKey(slot);
  }
}

function keyLabel(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'key';
  el.textContent = text;
  return el;
}

/** The Quick Select key whose row holds this weapon. */
function quickKey(weapon: WeaponId): string {
  return QUICK_SELECT.find((q) => q.row.includes(weapon))?.key ?? '';
}

/**
 * A Quick Select key (index into QUICK_SELECT): the first usable weapon of its row, or, if one
 * is already in hand, the next usable one along the row. Null when none in it can be used.
 */
export function weaponForQuickSelect(
  index: number,
  current: WeaponId,
  status: (weapon: WeaponId) => WeaponStatus,
): WeaponId | null {
  const weapons = QUICK_SELECT[index].row.filter((s): s is WeaponId => typeof s === 'string');
  const start = weapons.indexOf(current) + 1; // 0 when holding something from another row
  for (let i = 0; i < weapons.length; i++) {
    const id = weapons[(start + i) % weapons.length];
    if (isUsable(status(id))) return id;
  }
  return null;
}
