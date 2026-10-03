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
    private on: { close(): void; fill(line: string, as?: string | null): void; follow(on: boolean): void },
  ) {
    this.el.addEventListener('click', (ev) => {
      const t = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!t) return;
      const act = t.dataset.act;
      if (act === 'close') this.on.close();
      if (act === 'fill') this.on.fill(t.dataset.line || '', t.dataset.as === undefined ? undefined : t.dataset.as || null);
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
    const ts = stats?.towns[id];
    const fi = ts?.faction ?? t.faction;
    const f = stats?.factions[fi] ?? this.defs.factions[fi];
    const capital = ts?.capital ?? t.capital;
    const stock = stats?.stocks[id] || [];
    const counts = stats?.townCounts?.[id] || [];
    const total = counts.reduce((a, b) => a + b, 0);
    const mood = ts?.mood ?? 60;
    const moodColor = mood >= 60 ? '#4ade80' : mood >= 35 ? '#fbbf24' : '#f87171';
    const bname = (k: string) => this.defs.buildings.find((b) => b.id === k)?.name ?? k;
    const built = ts ? Object.entries(ts.buildings).filter(([, n]) => n > 0) : [];
    const siege = ts?.siege ? `<div class="alert">⚔ 被 <b style="color:${stats!.factions[ts.siege.by].color}">${esc(stats!.factions[ts.siege.by].name)}</b> 围城中 · ${Math.round(ts.siege.progress * 100)}%</div>` : '';
    this.el.innerHTML = `
      <div class="ins-head">
        <div class="avatar" style="--c:${f.color}"><b style="color:${f.color}">${capital ? '都' : '镇'}</b></div>
        <div><div class="ins-name">${esc(t.name)}</div><div class="dim"><span class="fdot" style="background:${f.color}"></span>${esc(f.name)} · ${capital ? '都城' : '城镇'} · ${total} 人${ts ? ` / 上限 ${ts.cap}` : ''}</div></div>
        <span class="spacer"></span><button class="x" data-act="close">×</button>
      </div>
      ${siege}
      <div class="bar" title="民心 0–100：吃饱、低税、开仓会升；断粮、高税会降。太低会有人逃走，长期很低会起义"><i style="width:${mood}%;background:${moodColor}"></i><span>民心 ${mood}</span></div>
      <div class="dim small">税 ${ts?.tax ?? 10}% · 城墙 ${ts?.walls ?? 0} 层</div>
      <div class="sec">仓库</div>
      <div class="stats">${this.defs.items.slice(0, 6).map((it, k) => `<div><b style="color:${it.color}">${fmt(stock[k] || 0)}</b><span>${esc(it.name)}</span></div>`).join('')}</div>
      <div class="sec">建筑</div>
      <div>${built.length ? built.map(([k, n]) => `<span class="chip">${esc(bname(k))}${n > 1 ? ' ×' + n : ''}</span>`).join('') : '<span class="dim small">还没有</span>'}</div>
      ${ts?.sites.length ? `<div class="sec">工地</div>${ts.sites.map((s) => `<div class="bar thin"><i style="width:${Math.round(s.progress * 100)}%"></i><span>${esc(s.name)} ${Math.round(s.progress * 100)}%</span></div>`).join('')}` : ''}
      <div class="sec">人口</div>
      <div class="plist">${this.defs.professions.map((p, k) => `<div>${shapeSvg(p.shape, p.color, 12)}<span>${esc(p.name)}</span><b>${counts[k] || 0}</b></div>`).join('')}</div>
      <div class="sec">试试（以 ${esc(f.name)} 的身份）</div>
      <div class="cmds">
        <div class="cmd" data-act="fill" data-as="${esc(f.name)}" data-line="建 房屋 ${esc(t.name)}"><code>建 房屋 ${esc(t.name)}</code><span>盖房子（木 40），人口上限 +30</span></div>
        <div class="cmd" data-act="fill" data-as="${esc(f.name)}" data-line="税 ${esc(t.name)} 5"><code>税 ${esc(t.name)} 5</code><span>减税，民心慢慢回升</span></div>
        <div class="cmd" data-act="fill" data-as="${esc(f.name)}" data-line="开仓 ${esc(t.name)} 200"><code>开仓 ${esc(t.name)} 200</code><span>开仓放粮，民心马上回升</span></div>
        <div class="cmd" data-act="fill" data-as="${esc(f.name)}" data-line="比例 ${esc(t.name)} 农40 木15 石8 矿5 建8 铁3 运5 兵10 斥3 商3"><code>比例 ${esc(t.name)} 农40 …</code><span>调职业比例，每天自动转职</span></div>
      </div>
      <div class="cmds" style="margin-top:6px">
        <div class="cmd" data-act="fill" data-as="" data-line="灾 疫 ${esc(t.name)} 5天"><code>灾 疫 ${esc(t.name)} 5天</code><span>（上帝）降瘟疫</span></div>
      </div>`;
    this.el.hidden = false;
  }
}
