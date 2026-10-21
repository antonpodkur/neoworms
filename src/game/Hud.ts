/** On-screen text overlay (plain DOM, so it stays crisp at any camera zoom). */
export class Hud {
  private readonly info = document.getElementById('hud-info')!;
  private readonly help = document.getElementById('hud-help')!;
  private readonly windBar = document.querySelector<HTMLElement>('#wind .bar')!;
  private shown = '';
  private shownWind = NaN;

  setInfo(lines: string[]): void {
    const text = lines.join('\n');
    if (text === this.shown) return;
    this.info.textContent = text;
    this.shown = text;
  }

  /** Wind -1..1 as a bar growing left or right from the centre. */
  setWind(wind: number): void {
    if (wind === this.shownWind) return;
    this.shownWind = wind;
    const width = `${Math.abs(wind) * 50}%`;
    this.windBar.style.width = width;
    this.windBar.style.left = wind < 0 ? `calc(50% - ${width})` : '50%';
  }

  toggleHelp(): void {
    this.help.hidden = !this.help.hidden;
  }
}
