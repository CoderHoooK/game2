// 图例：职业（点一下高亮这一类人）+ 势力和城镇（点一下飞过去）
import type { Defs, StatsMsg } from '../../protocol/messages';
import { shapeSvg } from '../shapes';
import { $, esc } from '../util';

export class Legend {
  private el = $('#legend');
  highlight = -1;
  constructor(
    private defs: Defs,
    private on: { highlight(prof: number): void; town(id: number): void },
  ) {
    this.render(null);
    this.el.addEventListener('click', (ev) => {
      const t = (ev.target as HTMLElement).closest<HTMLElement>('[data-prof],[data-town]');
      if (!t) return;
      if (t.dataset.prof !== undefined) {
        const p = Number(t.dataset.prof);
        this.highlight = this.highlight === p ? -1 : p;
        this.on.highlight(this.highlight);
        this.el.querySelectorAll('[data-prof]').forEach((x) => x.classList.toggle('on', Number((x as HTMLElement).dataset.prof) === this.highlight));
      } else this.on.town(Number(t.dataset.town));
    });
  }
  render(s: StatsMsg | null): void {
    const d = this.defs;
    this.el.innerHTML = `
      <div class="sec">职业 <span class="dim">（点一下高亮）</span></div>
      <div class="plist">${d.professions.map((p, k) => `<div data-prof="${k}" class="${this.highlight === k ? 'on' : ''}">${shapeSvg(p.shape, p.color, 13)}<span>${esc(p.name)}</span><b>${s?.counts[k] ?? ''}</b></div>`).join('')}</div>
      <div class="sec">诸侯</div>
      <div class="flist">${this.factionList(s)}</div>`;
  }
  private fkey = '';
  private factionList(s: StatsMsg | null): string {
    const d = this.defs;
    const fs = s?.factions ?? d.factions.map((f) => ({ ...f, kind: 'lord', alive: true }));
    const tf = s?.towns.map((t) => t.faction) ?? d.towns.map((t) => t.faction);
    this.fkey = fs.map((f) => f.name + f.alive).join(',') + tf.join(',');
    return fs
      .map((f, i) => ({ f, i }))
      .filter(({ f }) => f.kind === 'lord' || f.kind === 'rebel')
      .map(({ f, i }) => {
        const towns = d.towns.filter((t) => tf[t.id] === i);
        return `<div class="${f.alive ? '' : 'dead'}"><span class="fdot" style="background:${f.color}"></span><b>${esc(f.name)}</b>${f.alive ? towns.map((t) => `<a data-town="${t.id}">${esc(t.name)}</a>`).join('') : '<span class="dim small">已覆灭</span>'}</div>`;
      })
      .join('');
  }
  counts(s: StatsMsg): void {
    const key = s.factions.map((f) => f.name + f.alive).join(',') + s.towns.map((t) => t.faction).join(',');
    if (key !== this.fkey) this.el.querySelector('.flist')!.innerHTML = this.factionList(s);
    this.el.querySelectorAll<HTMLElement>('[data-prof]').forEach((x) => {
      const b = x.querySelector('b');
      if (b) b.textContent = String(s.counts[Number(x.dataset.prof)] ?? '');
    });
  }
}
