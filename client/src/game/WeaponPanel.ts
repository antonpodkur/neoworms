import { WEAPON_ORDER, WEAPONS, type WeaponId } from '../sim/weapons';

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
 * The weapon menu (Shift). ← → move, Space or Enter picks, Shift or Esc closes; clicking a
 * weapon picks it too. Plain DOM so it stays crisp at any camera zoom.
 */
export class WeaponPanel {
  private readonly root = document.getElementById('weapon-panel')!;
  private readonly buttons: HTMLButtonElement[];
  private cursor = 0;

  constructor(private readonly onPick: (weapon: WeaponId) => void) {
    this.buttons = WEAPON_ORDER.map((id, i) => {
      const button = document.createElement('button');
      button.className = 'weapon';
      button.tabIndex = -1;
      button.innerHTML = `<span class="icon">${ICONS[id]}</span><span>${WEAPONS[id].name}</span>`;
      button.addEventListener('mousedown', (e) => e.preventDefault()); // keep keyboard focus on the game
      button.addEventListener('click', () => this.pick(i));
      return button;
    });
    this.root.replaceChildren(...this.buttons);
    this.close();
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(current: WeaponId): void {
    this.cursor = WEAPON_ORDER.indexOf(current);
    this.root.hidden = false;
    this.render();
  }

  close(): void {
    this.root.hidden = true;
  }

  move(step: number): void {
    this.cursor = (this.cursor + step + WEAPON_ORDER.length) % WEAPON_ORDER.length;
    this.render();
  }

  choose(): void {
    this.pick(this.cursor);
  }

  private pick(index: number): void {
    this.close();
    this.onPick(WEAPON_ORDER[index]);
  }

  private render(): void {
    this.buttons.forEach((b, i) => b.classList.toggle('selected', i === this.cursor));
  }
}
