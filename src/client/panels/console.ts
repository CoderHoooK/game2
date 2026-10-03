// 命令框：AI 诸侯、上帝面板、测试用的是同一套命令（同一条命令总线）。
import type { Defs } from '../../protocol/messages';
import { $, esc } from '../util';

export class Console {
  private input = $<HTMLInputElement>('#cmd');
  private who = $<HTMLSelectElement>('#who');
  private log = $('#log');
  private list = $('#cmdList');
  private history: string[] = [];
  private hpos = -1;
  private nextId = 1;
  private lines = new Map<number, HTMLElement>();

  constructor(
    private defs: Defs,
    private send: (id: number, line: string, as: string | null) => void,
  ) {
    this.who.innerHTML = `<option value="">☁ 上帝</option>` + defs.factions.map((f) => `<option value="${esc(f.name)}">${esc(f.name)}（调试：以诸侯身份）</option>`).join('');
    this.who.value = defs.factions[0]?.name || '';
    this.who.addEventListener('change', () => this.renderList());
    $('#cmdForm').addEventListener('submit', (ev) => {
      ev.preventDefault();
      this.submit(this.input.value);
    });
    this.input.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowUp' && this.history.length) {
        this.hpos = Math.min(this.history.length - 1, this.hpos + 1);
        this.input.value = this.history[this.hpos];
        ev.preventDefault();
      } else if (ev.key === 'ArrowDown') {
        this.hpos = Math.max(-1, this.hpos - 1);
        this.input.value = this.hpos >= 0 ? this.history[this.hpos] : '';
        ev.preventDefault();
      } else if (ev.key === 'Tab') {
        ev.preventDefault();
        this.toggleList();
      } else if (ev.key === 'Escape') {
        this.list.hidden = true;
        this.input.blur();
      }
    });
    $('#cmdHelp').addEventListener('click', () => this.toggleList());
    this.list.addEventListener('click', (ev) => {
      const t = (ev.target as HTMLElement).closest<HTMLElement>('[data-line]');
      if (t) (this.fill(t.dataset.line || ''), (this.list.hidden = true));
    });
    this.renderList();
  }

  private role(): 'god' | 'lord' {
    return this.who.value ? 'lord' : 'god';
  }
  private renderList(): void {
    const role = this.role();
    const cmds = this.defs.commands.filter((c) => c.who.includes(role));
    this.list.innerHTML =
      `<div class="dim small">${role === 'god' ? '上帝' : this.who.value} 现在能用的命令（第 0 阶段已实现的；其余见架构图谱）</div>` +
      cmds.map((c) => `<div class="cmd" data-line="${esc(c.examples[0])}"><code>${esc(c.signature)}</code><span>${esc(c.help)}</span><em>${esc(c.examples.join('　'))}</em></div>`).join('');
  }
  private toggleList(): void {
    this.list.hidden = !this.list.hidden;
  }

  fill(line: string): void {
    this.input.value = line;
    this.input.focus();
  }

  /** 以指定身份执行（速度按钮用上帝身份） */
  submit(line: string, as: string | null = this.who.value || null): void {
    line = line.trim();
    if (!line) return;
    const id = this.nextId++;
    this.history.unshift(line);
    this.hpos = -1;
    const row = document.createElement('div');
    row.className = 'row pending';
    row.innerHTML = `<span class="who">${esc(as ?? '上帝')}</span><code>${esc(line)}</code><span class="res">…</span>`;
    this.log.appendChild(row);
    while (this.log.children.length > 7) this.log.firstElementChild!.remove();
    this.lines.set(id, row);
    if (as === (this.who.value || null)) this.input.value = '';
    this.send(id, line, as);
  }

  result(id: number, ok: boolean, msg: string, warns?: string[], hint?: string): void {
    const row = this.lines.get(id);
    if (!row) return;
    row.className = 'row ' + (ok ? 'ok' : 'err');
    row.querySelector('.res')!.innerHTML =
      esc(msg) + (warns?.length ? `<span class="warn">${warns.map(esc).join('；')}</span>` : '') + (hint ? `<span class="hint">${esc(hint)}</span>` : '');
    this.lines.delete(id);
  }
}
