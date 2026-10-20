/** On-screen text overlay (plain DOM, so it stays crisp at any camera zoom). */
export class Hud {
  private readonly info = document.getElementById('hud-info')!;
  private readonly help = document.getElementById('hud-help')!;
  private shown = '';

  setInfo(lines: string[]): void {
    const text = lines.join('\n');
    if (text === this.shown) return;
    this.info.textContent = text;
    this.shown = text;
  }

  toggleHelp(): void {
    this.help.hidden = !this.help.hidden;
  }
}
