// 检查面板：点一个 NPC → 全部属性、当前行为、长期命令、行为表、能用的命令、原始组件数据。
// 点一座城 → 库存和人口。
import type { Defs, InspectInfo, StatsMsg } from '../../protocol/messages';
import { shapeSvg } from '../shapes';
import { $, esc, fmt } from '../util';

export class Inspector {
  private el = $('#inspector');
  follow = false;
  townId = -1;
  constructor(
    private defs: Defs,
    private on: { close(): void; fill(line: string): void; follow(on: boolean): void },
  ) {
    this.el.addEventListener('click', (ev) => {
      const t = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!t) return;
      const act = t.dataset.act;
      if (act === 'close') this.on.close();
      if (act === 'fill') this.on.fill(t.dataset.line || '');
      if (act === 'follow') {
        this.follow = !this.follow;
        this.on.follow(this.follow);
        t.classList.toggle('on', this.follow);
      }
    });
  }

  hide(): void {
    this.el.hidden = true;
    this.townId = -1;
  }

  showNpc(i: InspectInfo | null): void {
    this.townId = -1;
    if (!i) {
      this.el.innerHTML = `<div class="ins-head"><b>这个人已经不在了</b><span class="spacer"></span><button class="x" data-act="close">×</button></div>`;
      this.el.hidden = false;
      return;
    }
    const p = i.profession;
    const shape = this.defs.professions.find((x) => x.id === p.id)?.shape || 'square';
    const step = i.behavior ? ` <span class="dim">第 ${i.behavior.step + 1} 步</span>` : '';
    const stats: [string, string][] = [
      ['速度', String(p.stats.speed)],
      ['负重', String(p.stats.carry)],
      ['血量', String(p.stats.hp)],
      ['攻击', String(p.stats.attack)],
    ];
    const comp = Object.entries(i.components)
      .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${Object.entries(v).map(([f, x]) => `<span class="kv">${esc(f)}=<b>${esc(typeof x === 'number' ? Math.round(x * 100) / 100 : x)}</b></span>`).join(' ')}</td></tr>`)
      .join('');
    this.el.innerHTML = `
      <div class="ins-head">
        <div class="avatar" style="--c:${p.color}">${shapeSvg(shape, p.color, 22)}</div>
        <div><div class="ins-name">${esc(i.name)} <span class="chip" style="--c:${p.color}">${esc(p.name)} @${esc(p.short)}</span></div>
        <div class="dim"><span class="fdot" style="background:${i.factionColor}"></span>${esc(i.faction)} · ${esc(i.home)} · #${i.id}</div></div>
        <span class="spacer"></span><button class="x" data-act="close" title="关闭 (Esc)">×</button>
      </div>
      <div class="bar"><i style="width:${(i.hp / i.maxHp) * 100}%"></i><span>血量 ${Math.round(i.hp)} / ${i.maxHp}</span></div>
      <dl class="facts">
        <dt>正在</dt><dd>${i.behavior ? `<b>${esc(i.behavior.name)}</b>${step}<div class="dim small">${esc(i.behavior.text)}</div>` : '<span class="dim">想下一步做什么</span>'}</dd>
        <dt>长期命令</dt><dd>${i.order ? `<b>${esc(i.order.label)}</b> <span class="dim">${esc(i.order.type)}</span> ${i.order.pinned ? '<span class="badge warn">锁定</span>' : '<span class="badge">跟随平时安排</span>'}` : '—'}</dd>
        <dt>手里</dt><dd>${i.carry ? `${esc(i.carry.item)} <b>${Math.floor(i.carry.qty)}</b> / ${i.carry.cap}` : '<span class="dim">空手</span>'}</dd>
        <dt>所在</dt><dd>${esc(i.region)} <span class="dim mono">(${Math.round(i.x)}, ${Math.round(i.y)})</span></dd>
        <dt>队伍</dt><dd>${i.group ? '#' + esc(i.group) : '<span class="dim">—</span>'}</dd>
      </dl>
      <div class="sec">属性</div>
      <div class="stats">${stats.map(([k, v]) => `<div><b>${esc(v)}</b><span>${k}</span></div>`).join('')}</div>
      <div class="sec">行为表 <span class="dim">（按优先级；灰色 = 后续阶段实现）</span></div>
      <div class="chips">${i.kit.map((b) => `<span class="chip ${b.ready ? '' : 'off'} ${i.behavior?.id === b.id ? 'cur' : ''}">${esc(b.name)}</span>`).join('')}</div>
      <div class="sec">能用的命令 <span class="dim">（点一下填进命令框）</span></div>
      <div class="cmds">${i.commands.map((c) => `<div class="cmd" data-act="fill" data-line="${esc(c.example)}"><code>${esc(c.signature)}</code><span>${esc(c.help)}</span><em>${esc(c.example)}</em></div>`).join('')}</div>
      <details><summary>组件原始数据</summary><table class="comp">${comp}</table></details>
      <div class="ins-foot">
        <button class="btn ${this.follow ? 'on' : ''}" data-act="follow">跟随 (F)</button>
        <a class="btn ghost" href="./atlas/#/professions/${esc(p.id)}" target="_blank" rel="noopener">在架构图谱里看「${esc(p.name)}」↗</a>
      </div>`;
    this.el.hidden = false;
  }

  showTown(id: number, stats: StatsMsg | null): void {
    this.townId = id;
    const t = this.defs.towns[id];
    const f = this.defs.factions[t.faction];
    const stock = stats?.stocks[id] || [];
    const counts = stats?.townCounts?.[id] || [];
    const total = counts.reduce((a, b) => a + b, 0);
    this.el.innerHTML = `
      <div class="ins-head">
        <div class="avatar" style="--c:${f.color}"><b style="color:${f.color}">${t.capital ? '都' : '镇'}</b></div>
        <div><div class="ins-name">${esc(t.name)}</div><div class="dim"><span class="fdot" style="background:${f.color}"></span>${esc(f.name)} · ${t.capital ? '都城' : '城镇'} · ${total} 人</div></div>
        <span class="spacer"></span><button class="x" data-act="close">×</button>
      </div>
      <div class="sec">仓库</div>
      <div class="stats">${this.defs.items.slice(0, 5).map((it, k) => `<div><b style="color:${it.color}">${fmt(stock[k] || 0)}</b><span>${esc(it.name)}</span></div>`).join('')}</div>
      <div class="sec">人口</div>
      <div class="plist">${this.defs.professions.map((p, k) => `<div>${shapeSvg(p.shape, p.color, 12)}<span>${esc(p.name)}</span><b>${counts[k] || 0}</b></div>`).join('')}</div>
      <div class="sec">试试</div>
      <div class="cmds">
        <div class="cmd" data-act="fill" data-line="派 @木@${esc(t.name)}:5 伐木"><code>派 @木@${esc(t.name)}:5 伐木</code><span>派 5 个本城伐木工去伐木（锁定）</span></div>
        <div class="cmd" data-act="fill" data-line="编 @兵@${esc(t.name)}:10 卫队"><code>编 @兵@${esc(t.name)}:10 卫队</code><span>编一支 10 人的卫队</span></div>
      </div>
      <div class="dim small" style="margin-top:8px">以 <b>${esc(f.name)}</b> 的身份下命令：命令框左边选「${esc(f.name)}」。</div>`;
    this.el.hidden = false;
  }
}
