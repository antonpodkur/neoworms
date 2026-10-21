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

/**
 * The weapon panel, laid out like Worms: one row per category with its function key, ammo
 * under each weapon (∞ for unlimited), and weapons the team can't use greyed out with the
 * turns left until they're ready. Arrows move, Space or Enter picks, Shift, Esc or a right
 * click closes; the mouse highlights and clicks too. Plain DOM so it stays crisp at any zoom.
 */
export class WeaponPanel {
  private readonly root = document.getElementById('weapon-panel')!;
  private readonly title = document.createElement('div');
  private readonly cells: { id: WeaponId; button: HTMLButtonElement; badge: HTMLElement }[][];
  private row = 0;
  private col = 0;

  constructor(
    /** What the team whose turn it is has of a weapon. */
    private readonly status: (weapon: WeaponId) => WeaponStatus,
    private readonly onPick: (weapon: WeaponId) => void,
  ) {
    this.title.className = 'title';
    const rows = CATEGORIES.map((category, r) => {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `<span class="key" title="${category.name}">${category.key}</span>`;
      const cells = category.weapons.map((id, c) => {
        const button = document.createElement('button');
        button.className = 'weapon';
        button.tabIndex = -1;
        button.title = WEAPONS[id].name;
        button.innerHTML = `<span class="icon">${ICONS[id]}</span><span class="badge"></span>`;
        button.addEventListener('mousedown', (e) => e.preventDefault()); // keep keyboard focus on the game
        button.addEventListener('mouseenter', () => this.moveTo(r, c));
        button.addEventListener('click', () => this.pick(r, c));
        row.append(button);
        return { id, button, badge: button.querySelector<HTMLElement>('.badge')! };
      });
      return { row, cells };
    });
    this.cells = rows.map((r) => r.cells);
    this.root.replaceChildren(this.title, ...rows.map((r) => r.row));
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    this.close();
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(current: WeaponId): void {
    this.row = Math.max(0, this.cells.findIndex((cells) => cells.some((c) => c.id === current)));
    this.col = Math.max(0, this.cells[this.row].findIndex((c) => c.id === current));
    this.root.hidden = false;
    this.render();
  }

  close(): void {
    this.root.hidden = true;
  }

  /** Arrow keys: along a row (wrapping), or to the row above or below. */
  move(dx: number, dy: number): void {
    const rows = this.cells.length;
    const row = (this.row + dy + rows) % rows;
    const length = this.cells[row].length;
    const col = dy ? Math.min(this.col, length - 1) : (this.col + dx + length) % length;
    this.moveTo(row, col);
  }

  choose(): void {
    this.pick(this.row, this.col);
  }

  private moveTo(row: number, col: number): void {
    this.row = row;
    this.col = col;
    this.render();
  }

  /** Weapons that can't be used yet (or any more) stay put, with a little shake. */
  private pick(row: number, col: number): void {
    const cell = this.cells[row][col];
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
    this.cells.forEach((cells, r) =>
      cells.forEach(({ id, button, badge }, c) => {
        const s = this.status(id);
        button.classList.toggle('selected', r === this.row && c === this.col);
        button.classList.toggle('unavailable', !isUsable(s));
        badge.textContent = s.wait > 0 ? `⏳${s.wait}` : s.ammo === null ? '∞' : String(s.ammo);
      }),
    );
    const { id } = this.cells[this.row][this.col];
    const s = this.status(id);
    const note = s.wait > 0 ? ` · ready in ${s.wait} turn${s.wait > 1 ? 's' : ''}` : s.ammo === 0 ? ' · none left' : '';
    this.title.textContent = `${WEAPONS[id].name}${note}`;
  }
}

/**
 * A function key: picks the first usable weapon of its category, or, if one is already in
 * hand, the next usable one along the row. Null when none in it can be used.
 */
export function weaponForKey(
  category: number,
  current: WeaponId,
  status: (weapon: WeaponId) => WeaponStatus,
): WeaponId | null {
  const weapons = CATEGORIES[category].weapons;
  const start = weapons.indexOf(current) + 1; // 0 when holding something from another row
  for (let i = 0; i < weapons.length; i++) {
    const id = weapons[(start + i) % weapons.length];
    if (isUsable(status(id))) return id;
  }
  return null;
}
