import { CATEGORIES, isUsable, WEAPONS, type WeaponId, type WeaponStatus } from '../sim/weapons';

/** Placeholder icons until real art (milestone 7). */
const ICONS: Record<WeaponId, string> = {
  rope: '🪝',
  bazooka: '🚀',
  grenade: '💣',
  cluster: '🎆',
  banana: '🍌',
  dynamite: '🧨',
  mine: '◉',
  oldWoman: '👵',
  airstrike: '✈️',
  bat: '🏏',
  prod: '👉',
};

/** Utilities get blue slots, weapons orange, as in Worms Revolution. */
const TOOLS = new Set<WeaponId>(['rope']);

/** Grid height: the longest category, so every column has the same number of slots. */
const ROWS = Math.max(...CATEGORIES.map((c) => c.weapons.length));

interface Cell {
  id: WeaponId;
  button: HTMLButtonElement;
  ammo: HTMLElement;
  wait: HTMLElement;
}

/**
 * The weapon panel, laid out like Worms Revolution's Inventory: a grid of slots, one column per
 * category with its function key on top, empty slots filling the rest. Ammo sits in a slot's
 * corner (none for unlimited); weapons the team can't use yet are greyed with the turns left in
 * brackets. A bar along the bottom names the highlighted weapon. Arrows move, Space or Enter
 * picks, Shift, Esc or a right click closes; the mouse highlights and clicks too. Plain DOM so
 * it stays crisp at any zoom.
 */
export class WeaponPanel {
  private readonly root = document.getElementById('weapon-panel')!;
  private readonly name = document.createElement('span');
  private readonly note = document.createElement('span');
  /** Per category (column), its weapons top to bottom. */
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
    grid.style.gridTemplateColumns = `repeat(${CATEGORIES.length}, auto)`;
    for (const category of CATEGORIES) {
      const key = document.createElement('div');
      key.className = 'key';
      key.textContent = category.key;
      key.title = category.name;
      grid.append(key);
    }
    this.cells = CATEGORIES.map((category, c) =>
      category.weapons.map((id, r) => {
        const button = document.createElement('button');
        button.className = `slot ${TOOLS.has(id) ? 'tool' : 'weapon'}`;
        button.tabIndex = -1;
        button.title = WEAPONS[id].name;
        button.innerHTML = `<span class="ammo"></span><span class="icon">${ICONS[id]}</span><span class="wait"></span>`;
        button.addEventListener('mousedown', (e) => e.preventDefault()); // keep keyboard focus on the game
        button.addEventListener('mouseenter', () => this.moveTo(c, r));
        button.addEventListener('click', () => this.pick(c, r));
        return { id, button, ammo: button.querySelector<HTMLElement>('.ammo')!, wait: button.querySelector<HTMLElement>('.wait')! };
      }),
    );
    // CSS grid fills row by row: the weapons in each category run down their column.
    for (let r = 0; r < ROWS; r++) {
      for (const column of this.cells) {
        const cell = column[r];
        if (cell) grid.append(cell.button);
        else {
          const empty = document.createElement('div');
          empty.className = 'slot empty';
          grid.append(empty);
        }
      }
    }

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
    this.col = Math.max(0, this.cells.findIndex((column) => column.some((c) => c.id === current)));
    this.row = Math.max(0, this.cells[this.col].findIndex((c) => c.id === current));
    this.root.hidden = false;
    this.render();
  }

  close(): void {
    this.root.hidden = true;
  }

  /** Arrow keys: across the categories, or up and down a category's weapons (both wrap). */
  move(dx: number, dy: number): void {
    const cols = this.cells.length;
    const col = (this.col + dx + cols) % cols;
    const length = this.cells[col].length;
    const row = dx ? Math.min(this.row, length - 1) : (this.row + dy + length) % length;
    this.moveTo(col, row);
  }

  choose(): void {
    this.pick(this.col, this.row);
  }

  private moveTo(col: number, row: number): void {
    this.col = col;
    this.row = row;
    this.render();
  }

  /** Weapons that can't be used yet (or any more) stay put, with a little shake. */
  private pick(col: number, row: number): void {
    const cell = this.cells[col][row];
    if (!isUsable(this.status(cell.id))) {
      cell.button.animate(
        [{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }],
        { duration: 180 },
      );
      return;
    }
    this.close();
    this.onPick(cell.id);
  }

  private render(): void {
    this.cells.forEach((column, c) =>
      column.forEach(({ id, button, ammo, wait }, r) => {
        const s = this.status(id);
        button.classList.toggle('selected', c === this.col && r === this.row);
        button.classList.toggle('unavailable', !isUsable(s));
        ammo.textContent = s.ammo === null ? '' : String(s.ammo);
        wait.textContent = s.wait > 0 ? `(${s.wait})` : '';
      }),
    );
    const { id } = this.cells[this.col][this.row];
    const s = this.status(id);
    this.name.textContent = s.ammo === null ? WEAPONS[id].name : `${s.ammo} x ${WEAPONS[id].name}`;
    this.note.textContent =
      s.wait > 0 ? `Ready in ${s.wait} turn${s.wait > 1 ? 's' : ''}` : s.ammo === 0 ? 'None left' : CATEGORIES[this.col].key;
  }
}

/**
 * A function key: picks the first usable weapon of its category, or, if one is already in
 * hand, the next usable one down the column. Null when none in it can be used.
 */
export function weaponForKey(
  category: number,
  current: WeaponId,
  status: (weapon: WeaponId) => WeaponStatus,
): WeaponId | null {
  const weapons = CATEGORIES[category].weapons;
  const start = weapons.indexOf(current) + 1; // 0 when holding something from another category
  for (let i = 0; i < weapons.length; i++) {
    const id = weapons[(start + i) % weapons.length];
    if (isUsable(status(id))) return id;
  }
  return null;
}
