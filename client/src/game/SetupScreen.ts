import { MAX_PLAYERS } from '../../../shared/relay';
import { DEFAULT_SETTINGS, type MatchSettings } from '../sim/match';
import { SCHEMES, type SchemeId } from '../sim/weapons';
import type { OnlineSession } from '../net/OnlineSession';
import type { MapEntry } from './maps';
import { teamColorCss } from './WormView';

const SETTINGS_KEY = 'neoworms.match';
const NAME_KEY = 'neoworms.name';
const DEFAULT_TEAM_NAMES = ['Red', 'Blue', 'Green', 'Yellow'];
const MAX_TEAMS = 4;

/** Match settings from the last game, so friends don't have to re-enter team names. */
export function loadSettings(): MatchSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<MatchSettings>;
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: it just won't be remembered.
  }
}

export interface SetupActions {
  startLocal(settings: MatchSettings, mapId: string): void;
  /** Host: start the online match; teams come from the players in the room. */
  startOnline(settings: MatchSettings, mapId: string): void;
  host(name: string): void;
  join(code: string, name: string): void;
  leave(): void;
  resume(): void;
}

/**
 * The menu: a hot-seat match on this computer, or an online room (host, join with a code,
 * lobby). Also the pause menu during a game (Esc).
 */
export class SetupScreen {
  private readonly root = document.getElementById('setup')!;
  private tab: 'local' | 'online' = 'local';
  private settings: MatchSettings = { ...DEFAULT_SETTINGS };
  private mapId = '';
  private canResume = false;
  private session: OnlineSession | null = null;
  private joinCode = '';

  constructor(
    private readonly maps: MapEntry[],
    private readonly actions: SetupActions,
  ) {}

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /**
   * `canResume`: a match is in progress and can be continued. `session`: the online room
   * this player is in, if any; `joinCode` pre-fills the code from an invite link.
   */
  open(options: {
    settings: MatchSettings;
    mapId: string;
    canResume: boolean;
    session: OnlineSession | null;
    joinCode?: string;
  }): void {
    this.settings = { ...options.settings };
    this.mapId = options.mapId;
    this.canResume = options.canResume;
    this.session = options.session;
    this.joinCode = options.joinCode ?? this.joinCode;
    if (this.session || this.joinCode) this.tab = 'online';
    this.root.hidden = false;
    this.render();
  }

  close(): void {
    this.root.hidden = true;
  }

  /** Redraws after something changed (players joining, errors), if open. */
  refresh(session: OnlineSession | null): void {
    this.session = session;
    if (this.isOpen) this.render();
  }

  private render(): void {
    this.root.innerHTML = `
      <div class="card">
        <h1>NeoWorms</h1>
        <div class="tabs">
          <button class="tab${this.tab === 'local' ? ' active' : ''}" data-tab="local">This computer</button>
          <button class="tab${this.tab === 'online' ? ' active' : ''}" data-tab="online">Online</button>
        </div>
        <div class="body"></div>
      </div>`;
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('.tab')) {
      button.disabled = !!this.session && button.dataset.tab === 'local';
      button.addEventListener('click', () => {
        this.tab = button.dataset.tab as 'local' | 'online';
        this.render();
      });
    }
    const body = this.root.querySelector<HTMLElement>('.body')!;
    if (this.tab === 'local') this.renderLocal(body);
    else if (!this.session) this.renderConnect(body);
    else this.renderLobby(body, this.session);
  }

  private renderLocal(body: HTMLElement): void {
    body.innerHTML = `
      <div class="teams"></div>
      <button class="add-team">+ Add team</button>
      ${this.optionsHtml()}
      <div class="actions">
        ${this.canResume ? '<button class="resume">Resume</button>' : ''}
        <button class="start">Start match</button>
      </div>`;
    this.renderTeams(body);
    this.bindOptions(body);
    body.querySelector('.add-team')!.addEventListener('click', () => {
      this.settings.teams = [...this.settings.teams, DEFAULT_TEAM_NAMES[this.settings.teams.length] ?? 'Team'];
      this.renderTeams(body);
    });
    body.querySelector('.start')!.addEventListener('click', () => {
      const teams = this.settings.teams.map((n, i) => n.trim() || DEFAULT_TEAM_NAMES[i] || `Team ${i + 1}`);
      const settings = { ...this.settings, teams };
      remember(SETTINGS_KEY, JSON.stringify(settings));
      this.close();
      this.actions.startLocal(settings, this.mapId);
    });
    this.bindResume(body);
  }

  /** Not in a room yet: pick a name, then host or join with a code. */
  private renderConnect(body: HTMLElement): void {
    body.innerHTML = `
      <label class="field">Your name<input class="name" maxlength="16" spellcheck="false"></label>
      <div class="actions left"><button class="start host">Host a game</button></div>
      <label class="field">Or join with a room code
        <span class="row"><input class="code" maxlength="4" spellcheck="false" placeholder="ABCD"><button class="join">Join</button></span>
      </label>
      <p class="note">Each player is one team. Worms Revolution maps only work if every player has them.</p>`;
    const name = body.querySelector<HTMLInputElement>('.name')!;
    const code = body.querySelector<HTMLInputElement>('.code')!;
    name.value = localStorage.getItem(NAME_KEY) ?? '';
    code.value = this.joinCode;
    const playerName = () => {
      const value = name.value.trim() || 'Player';
      remember(NAME_KEY, value);
      return value;
    };
    body.querySelector('.host')!.addEventListener('click', () => this.actions.host(playerName()));
    body.querySelector('.join')!.addEventListener('click', () => {
      const room = code.value.trim().toUpperCase();
      if (room.length === 4) this.actions.join(room, playerName());
    });
  }

  /** In a room: players, and for the host the match options and Start. */
  private renderLobby(body: HTMLElement, session: OnlineSession): void {
    const playing = this.canResume;
    const hostName = session.peers.find((p) => p.host)?.name ?? 'the host';
    const players = session.peers
      .map((p) => `<li>${escape(p.name)}${p.host ? ' <small>host</small>' : ''}${p.id === session.myId ? ' <small>you</small>' : ''}</li>`)
      .join('');
    const canStart = session.peers.length >= 2;
    const hostGone = !session.isHost && session.peers.length > 0 && !session.hostId;
    const error = session.error ?? (hostGone ? 'The host left this room.' : null);
    body.innerHTML = `
      ${error ? `<p class="error">${escape(error)}</p>` : ''}
      <div class="room">Room <b>${escape(session.code)}</b> <button class="invite">Copy invite link</button></div>
      <ul class="players">${players || '<li>Connecting…</li>'}</ul>
      ${session.isHost && !playing ? this.optionsHtml() : ''}
      ${!session.isHost && !playing && !error ? `<p class="note">Waiting for ${escape(hostName)} to start the match…</p>` : ''}
      ${session.isHost && !playing ? `<p class="note">${canStart ? `${session.peers.length} of up to ${MAX_PLAYERS} players.` : 'Waiting for a friend to join…'}</p>` : ''}
      <div class="actions">
        <button class="leave">${playing ? 'Leave game' : 'Leave'}</button>
        ${playing ? '<button class="resume">Resume</button>' : ''}
        ${session.isHost && !playing ? `<button class="start"${canStart ? '' : ' disabled'}>Start match</button>` : ''}
      </div>`;
    this.bindOptions(body);
    const invite = body.querySelector<HTMLButtonElement>('.invite')!;
    invite.addEventListener('click', () => {
      void navigator.clipboard.writeText(`${location.origin}${location.pathname}?join=${session.code}`);
      invite.textContent = 'Copied!';
    });
    body.querySelector('.leave')!.addEventListener('click', () => this.actions.leave());
    body.querySelector('.start')?.addEventListener('click', () => {
      this.close();
      this.actions.startOnline({ ...this.settings }, this.mapId);
    });
    this.bindResume(body);
  }

  private optionsHtml(): string {
    const s = this.settings;
    return `<div class="options">
      ${select('wormsPerTeam', 'Worms per team', [1, 2, 3, 4, 5, 6, 7, 8].map((n) => [n, String(n)]), s.wormsPerTeam)}
      ${select('turnTime', 'Turn time', [[30, '30 s'], [45, '45 s'], [60, '60 s'], [90, '90 s'], [0, 'No limit']], s.turnTime)}
      ${select('wormHp', 'Worm health', [[50, '50'], [100, '100'], [150, '150'], [200, '200']], s.wormHp)}
      ${select('suddenDeathAfter', 'Sudden death', [[5, 'after 5 min'], [10, 'after 10 min'], [15, 'after 15 min'], [20, 'after 20 min'], [0, 'Never']], s.suddenDeathAfter)}
      ${select('scheme', 'Weapons', Object.entries(SCHEMES).map(([id, scheme]) => [id, scheme.name]), s.scheme)}
      ${select('map', 'Map', this.maps.map((m) => [m.id, m.name]), this.mapId)}
    </div>`;
  }

  /** Keeps choices in `settings` as they're made, so a redraw doesn't lose them. */
  private bindOptions(body: HTMLElement): void {
    for (const el of body.querySelectorAll<HTMLSelectElement>('.options select')) {
      el.addEventListener('change', () => {
        if (el.name === 'map') this.mapId = el.value;
        else if (el.name === 'scheme') this.settings = { ...this.settings, scheme: el.value as SchemeId };
        else this.settings = { ...this.settings, [el.name]: Number(el.value) };
      });
    }
  }

  private bindResume(body: HTMLElement): void {
    body.querySelector('.resume')?.addEventListener('click', () => {
      this.close();
      this.actions.resume();
    });
  }

  private renderTeams(body: HTMLElement): void {
    const list = body.querySelector('.teams')!;
    const teams = this.settings.teams;
    list.replaceChildren(
      ...teams.map((name, i) => {
        const row = document.createElement('div');
        row.className = 'team';
        row.innerHTML = `<span class="swatch" style="background:${teamColorCss(i)}"></span>
          <input maxlength="16" spellcheck="false">
          <button class="remove" title="Remove team">✕</button>`;
        const input = row.querySelector('input')!;
        input.value = name;
        input.addEventListener('input', () => (teams[i] = input.value));
        const remove = row.querySelector<HTMLButtonElement>('.remove')!;
        remove.disabled = teams.length <= 2;
        remove.addEventListener('click', () => {
          teams.splice(i, 1);
          this.renderTeams(body);
        });
        return row;
      }),
    );
    body.querySelector<HTMLButtonElement>('.add-team')!.hidden = teams.length >= MAX_TEAMS;
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
