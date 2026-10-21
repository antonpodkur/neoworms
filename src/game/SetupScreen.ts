import { DEFAULT_SETTINGS, type MatchSettings } from '../sim/match';
import type { MapEntry } from './maps';
import { teamColorCss } from './WormView';

const STORAGE_KEY = 'neoworms.match';
const DEFAULT_TEAM_NAMES = ['Red', 'Blue', 'Green', 'Yellow'];
const MAX_TEAMS = 4;

/** Match settings from the last game, so friends don't have to re-enter team names. */
export function loadSettings(): MatchSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<MatchSettings>;
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings: MatchSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable: settings just won't be remembered.
  }
}

/** The new-match screen: teams, worms, turn time, health, sudden death and the map. */
export class SetupScreen {
  private readonly root = document.getElementById('setup')!;
  private teams: string[] = [];

  constructor(
    private readonly maps: MapEntry[],
    private readonly onStart: (settings: MatchSettings, mapId: string) => void,
    private readonly onResume: () => void,
  ) {}

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** `canResume`: a match is in progress and can be continued instead. */
  open(settings: MatchSettings, mapId: string, canResume: boolean): void {
    this.teams = [...settings.teams];
    this.root.innerHTML = `
      <div class="card">
        <h1>NeoWorms</h1>
        <div class="teams"></div>
        <button class="add-team">+ Add team</button>
        <div class="options">
          ${select('worms', 'Worms per team', [1, 2, 3, 4, 5, 6, 7, 8].map((n) => [n, String(n)]), settings.wormsPerTeam)}
          ${select('turn', 'Turn time', [[30, '30 s'], [45, '45 s'], [60, '60 s'], [90, '90 s'], [0, 'No limit']], settings.turnTime)}
          ${select('hp', 'Worm health', [[50, '50'], [100, '100'], [150, '150'], [200, '200']], settings.wormHp)}
          ${select('sudden', 'Sudden death', [[5, 'after 5 min'], [10, 'after 10 min'], [15, 'after 15 min'], [20, 'after 20 min'], [0, 'Never']], settings.suddenDeathAfter)}
          ${select('map', 'Map', this.maps.map((m) => [m.id, m.name]), mapId)}
        </div>
        <div class="actions">
          ${canResume ? '<button class="resume">Resume</button>' : ''}
          <button class="start">Start match</button>
        </div>
      </div>`;
    this.renderTeams();
    this.root.querySelector('.add-team')!.addEventListener('click', () => {
      this.teams.push(DEFAULT_TEAM_NAMES[this.teams.length] ?? `Team ${this.teams.length + 1}`);
      this.renderTeams();
    });
    this.root.querySelector('.start')!.addEventListener('click', () => this.start(settings));
    this.root.querySelector('.resume')?.addEventListener('click', () => {
      this.close();
      this.onResume();
    });
    this.root.hidden = false;
  }

  close(): void {
    this.root.hidden = true;
  }

  private renderTeams(): void {
    const list = this.root.querySelector('.teams')!;
    list.replaceChildren(
      ...this.teams.map((name, i) => {
        const row = document.createElement('div');
        row.className = 'team';
        row.innerHTML = `<span class="swatch" style="background:${teamColorCss(i)}"></span>
          <input maxlength="16" spellcheck="false">
          <button class="remove" title="Remove team">✕</button>`;
        const input = row.querySelector('input')!;
        input.value = name;
        input.addEventListener('input', () => (this.teams[i] = input.value));
        const remove = row.querySelector<HTMLButtonElement>('.remove')!;
        remove.disabled = this.teams.length <= 2;
        remove.addEventListener('click', () => {
          this.teams.splice(i, 1);
          this.renderTeams();
        });
        return row;
      }),
    );
    this.root.querySelector<HTMLButtonElement>('.add-team')!.hidden = this.teams.length >= MAX_TEAMS;
  }

  private start(previous: MatchSettings): void {
    const value = (name: string) => this.root.querySelector<HTMLSelectElement>(`select[name="${name}"]`)!.value;
    const settings: MatchSettings = {
      ...previous,
      teams: this.teams.map((name, i) => name.trim() || DEFAULT_TEAM_NAMES[i] || `Team ${i + 1}`),
      wormsPerTeam: Number(value('worms')),
      turnTime: Number(value('turn')),
      wormHp: Number(value('hp')),
      suddenDeathAfter: Number(value('sudden')),
    };
    saveSettings(settings);
    this.close();
    this.onStart(settings, value('map'));
  }
}

function select(name: string, label: string, options: (string | number)[][], current: string | number): string {
  const items = options
    .map(([v, text]) => `<option value="${escape(v)}"${String(v) === String(current) ? ' selected' : ''}>${escape(text)}</option>`)
    .join('');
  return `<label>${label}<select name="${name}">${items}</select></label>`;
}

function escape(value: string | number): string {
  return String(value).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}
