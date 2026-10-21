import { teamColorCss } from './WormView';

export interface TurnInfo {
  team: number;
  teamName: string;
  wormName: string;
  weapon: string;
  /** Seconds left; Infinity for no limit. */
  seconds: number;
  phase: 'playing' | 'retreat' | 'settling';
}

export interface TeamInfo {
  name: string;
  hp: number;
  maxHp: number;
}

/**
 * On-screen overlay in plain DOM (crisp at any camera zoom): map info, whose turn it is with
 * its timer, team health bars, wind, banners and the game-over panel.
 */
export class Hud {
  private readonly info = document.getElementById('hud-info')!;
  private readonly help = document.getElementById('hud-help')!;
  private readonly windBar = document.querySelector<HTMLElement>('#wind .bar')!;
  private readonly turn = document.getElementById('turn')!;
  private readonly teams = document.getElementById('teams')!;
  private readonly banner = document.getElementById('banner')!;
  private readonly gameOver = document.getElementById('gameover')!;
  private shown = new Map<string, string>();
  private shownWind = NaN;
  private bannerTimer = 0;

  setInfo(lines: string[]): void {
    this.setText(this.info, 'info', lines.join('\n'));
  }

  /** Wind -1..1 as a bar growing left or right from the centre. */
  setWind(wind: number): void {
    if (wind === this.shownWind) return;
    this.shownWind = wind;
    const width = `${Math.abs(wind) * 50}%`;
    this.windBar.style.width = width;
    this.windBar.style.left = wind < 0 ? `calc(50% - ${width})` : '50%';
  }

  setTurn(turn: TurnInfo | null): void {
    this.turn.hidden = !turn;
    if (!turn) return;
    const timer =
      turn.phase === 'settling' ? '…' : Number.isFinite(turn.seconds) ? String(Math.ceil(turn.seconds)) : '∞';
    const html = `<span class="dot" style="background:${teamColorCss(turn.team)}"></span>
      <span class="who"><b>${escape(turn.wormName)}</b><small>${escape(turn.teamName)} · ${escape(turn.weapon)}</small></span>
      <span class="timer ${turn.phase}">${timer}</span>`;
    this.setHtml(this.turn, 'turn', html);
  }

  /** One bar per team, sized by its worms' total health. */
  setTeams(teams: TeamInfo[]): void {
    const html = teams
      .map(
        (t, i) => `<div class="team${t.hp === 0 ? ' out' : ''}">
          <span class="name">${escape(t.name)}</span>
          <span class="bar"><span style="width:${(100 * t.hp) / t.maxHp}%;background:${teamColorCss(i)}"></span></span>
          <span class="hp">${t.hp}</span></div>`,
      )
      .join('');
    this.setHtml(this.teams, 'teams', html);
  }

  /** Big text in the middle of the screen that fades out after a moment. */
  showBanner(text: string, color = '#ffffff', ms = 1800): void {
    this.banner.textContent = text;
    this.banner.style.color = color;
    this.banner.classList.add('visible');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.banner.classList.remove('visible'), ms);
  }

  showGameOver(text: string, color: string, onRematch: () => void, onNewMatch: () => void): void {
    this.gameOver.innerHTML = `<h2></h2><div class="actions">
      <button class="rematch">Rematch</button><button class="new">New match</button></div>`;
    const title = this.gameOver.querySelector('h2')!;
    title.textContent = text;
    title.style.color = color;
    this.gameOver.querySelector('.rematch')!.addEventListener('click', onRematch);
    this.gameOver.querySelector('.new')!.addEventListener('click', onNewMatch);
    this.gameOver.hidden = false;
  }

  hideGameOver(): void {
    this.gameOver.hidden = true;
  }

  toggleHelp(): void {
    this.help.hidden = !this.help.hidden;
  }

  private setText(el: HTMLElement, key: string, text: string): void {
    if (this.shown.get(key) === text) return;
    this.shown.set(key, text);
    el.textContent = text;
  }

  private setHtml(el: HTMLElement, key: string, html: string): void {
    if (this.shown.get(key) === html) return;
    this.shown.set(key, html);
    el.innerHTML = html;
  }
}

function escape(text: string): string {
  return text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}
