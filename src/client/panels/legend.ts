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
      <div class="flist">${d.factions.map((f, i) => `<div><span class="fdot" style="background:${f.color}"></span><b>${esc(f.name)}</b>${d.towns.filter((t) => t.faction === i).map((t) => `<a data-town="${t.id}">${esc(t.name)}</a>`).join('')}</div>`).join('')}</div>`;
  }
  counts(s: StatsMsg): void {
    this.el.querySelectorAll<HTMLElement>('[data-prof]').forEach((x) => {
      const b = x.querySelector('b');
      if (b) b.textContent = String(s.counts[Number(x.dataset.prof)] ?? '');
    });
  }
}
