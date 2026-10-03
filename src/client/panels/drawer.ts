// 侧边抽屉：史册（公开 / 密辛）、诸侯（关系图 + 势力表）、心里话（AI 的决策记录和「想」）、上帝（点一下填命令）。
import type { AiLogEntry, ChronicleEntry, Defs, FactionStat, StatsMsg } from '../../protocol/messages';
import { $, esc } from '../util';

type Tab = 'chronicle' | 'lords' | 'minds' | 'god';
const TREATY: Record<string, { name: string; color: string }> = {
  alliance: { name: '结盟', color: '#4ade80' },
  nonaggression: { name: '互不侵犯', color: '#60a5fa' },
  trade: { name: '通商', color: '#facc15' },
  tribute: { name: '朝贡', color: '#c084fc' },
  passage: { name: '借道', color: '#94a3b8' },
};

export class Drawer {
  private el = $('#drawer');
  private tab: Tab = 'chronicle';
  private entries: ChronicleEntry[] = [];
  private filter: 'all' | 'public' | 'secret' = 'all';
  private stats: StatsMsg | null = null;
  private mind = '';
  private mindData: { faction: string; personality: string; mode: string; logs: AiLogEntry[]; thoughts: { tick: number; text: string }[] } | null = null;
  open = false;

  constructor(
    private defs: Defs,
    private on: { fill(line: string, asGod: boolean): void; ailog(faction: string): void; town(name: string): void },
  ) {
    this.el.addEventListener('click', (ev) => {
      const t = ev.target as HTMLElement;
      const tab = t.closest<HTMLElement>('[data-tab]');
      if (tab) return this.show(tab.dataset.tab as Tab);
      const f = t.closest<HTMLElement>('[data-filter]');
      if (f) {
        this.filter = f.dataset.filter as typeof this.filter;
        return this.render();
      }
      const fill = t.closest<HTMLElement>('[data-fill]');
      if (fill) return this.on.fill(fill.dataset.fill!, fill.dataset.god === '1');
      const mind = t.closest<HTMLElement>('[data-mind]');
      if (mind) {
        this.mind = mind.dataset.mind!;
        this.mindData = null;
        this.on.ailog(this.mind);
        return this.render();
      }
      const town = t.closest<HTMLElement>('[data-town]');
      if (town) this.on.town(town.dataset.town!);
      if (t.closest('[data-act=close]')) this.toggle(false);
    });
  }

  toggle(on = !this.open): void {
    this.open = on;
    this.el.hidden = !on;
    document.body.classList.toggle('drawer-open', on);
    if (on) this.render();
  }
  show(tab: Tab): void {
    this.tab = tab;
    if (!this.open) this.toggle(true);
    if (tab === 'minds' && !this.mind) {
      const f = this.living()[0];
      if (f) ((this.mind = f.name), this.on.ailog(f.name));
    }
    this.render();
  }

  addEntries(list: ChronicleEntry[]): void {
    if (!list.length) return;
    const seen = new Set(this.entries.map((e) => e.id));
    for (const e of list) if (!seen.has(e.id)) this.entries.push(e);
    if (this.entries.length > 800) this.entries = this.entries.slice(-800);
    if (this.open && this.tab === 'chronicle') this.render();
  }
  latest(n: number): ChronicleEntry[] {
    return this.entries.filter((e) => e.scope === 'all').slice(-n);
  }
  update(s: StatsMsg): void {
    this.stats = s;
    if (this.open && this.tab === 'lords') this.render();
  }
  setMind(d: NonNullable<Drawer['mindData']>): void {
    if (d.faction !== this.mind) return;
    this.mindData = d;
    if (this.open && this.tab === 'minds') this.render();
  }
  /** 心里话页开着时每隔几秒刷新一次 */
  wantsMind(): string | null {
    return this.open && this.tab === 'minds' && this.mind ? this.mind : null;
  }

  private factions(): FactionStat[] {
    return this.stats?.factions ?? this.defs.factions.map((f) => ({ ...f, kind: 'lord', alive: true, reputation: 50, soldiers: 0 }));
  }
  private living(): FactionStat[] {
    return this.factions().filter((f) => f.alive && (f.kind === 'lord' || f.kind === 'rebel'));
  }
  private color(name: string): string {
    return this.factions().find((f) => f.name === name)?.color ?? '#cbd5e1';
  }
  /** 把文字里的势力名上色 */
  private paint(text: string): string {
    let s = esc(text);
    for (const f of this.factions()) if (f.name.length >= 2) s = s.split(esc(f.name)).join(`<b style="color:${f.color}">${esc(f.name)}</b>`);
    return s;
  }

  private render(): void {
    if (!this.open) return;
    const tabs: [Tab, string][] = [
      ['chronicle', '📜 史册'],
      ['lords', '⚔ 诸侯'],
      ['minds', '💭 心里话'],
      ['god', '☁ 上帝'],
    ];
    const body = this.tab === 'chronicle' ? this.renderChronicle() : this.tab === 'lords' ? this.renderLords() : this.tab === 'minds' ? this.renderMinds() : this.renderGod();
    this.el.innerHTML = `<div class="dr-head">${tabs.map(([k, n]) => `<button class="tab ${k === this.tab ? 'on' : ''}" data-tab="${k}">${n}</button>`).join('')}<span class="spacer"></span><button class="x" data-act="close">×</button></div><div class="dr-body">${body}</div>`;
  }

  private renderChronicle(): string {
    const list = this.entries.filter((e) => (this.filter === 'all' ? true : this.filter === 'public' ? e.scope === 'all' : e.scope !== 'all')).slice(-300).reverse();
    const tpd = this.defs.ticksPerDay;
    const day = (t: number) => `${Math.floor(t / tpd / 120) + 1}年${Math.floor(t / tpd) % 120 + 1}日`;
    const f = (k: string, n: string) => `<button class="chip ${this.filter === k ? 'cur' : ''}" data-filter="${k}">${n}</button>`;
    return `<div class="dr-tools">${f('all', '全部')}${f('public', '天下皆知')}${f('secret', '密辛（只有上帝知道）')}</div>
      <div class="chron">${list.length ? list.map((e) => `<div class="ent ${e.scope === 'all' ? '' : 'secret'}"><span class="when">${day(e.tick)}</span><span>${this.paint(e.text)}${e.scope !== 'all' && e.scope !== 'god' ? ` <em class="dim">（${esc(e.scope)}）</em>` : ''}</span></div>`).join('') : '<div class="dim">还没有大事发生。把时速调快一点看看。</div>'}</div>`;
  }

  private renderLords(): string {
    const s = this.stats;
    const live = this.living();
    if (!s || !live.length) return '<div class="dim">等数据…</div>';
    const W = 360;
    const R = 125;
    const pos = new Map<number, [number, number]>();
    const all = this.factions();
    live.forEach((f, i) => {
      const a = (i / live.length) * Math.PI * 2 - Math.PI / 2;
      pos.set(all.indexOf(f), [W / 2 + Math.cos(a) * R, W / 2 + Math.sin(a) * R]);
    });
    const lines: string[] = [];
    for (const r of s.relations) {
      const A = pos.get(r.a);
      const B = pos.get(r.b);
      if (!A || !B) continue;
      const tip = `${all[r.a].name} — ${all[r.b].name}：关系 ${r.value}${r.war ? '，交战中' : ''}${r.treaties.length ? '，' + r.treaties.map((t) => TREATY[t]?.name ?? t).join('、') : ''}${r.trades ? `，成交 ${r.trades} 次` : ''}`;
      if (r.war) lines.push(`<line x1="${A[0]}" y1="${A[1]}" x2="${B[0]}" y2="${B[1]}" stroke="#ef4444" stroke-width="3.5" stroke-dasharray="7 4"><title>${esc(tip)}</title></line>`);
      r.treaties.forEach((t, k) => {
        const off = (k - (r.treaties.length - 1) / 2) * 4;
        const dx = B[1] - A[1];
        const dy = A[0] - B[0];
        const L = Math.hypot(dx, dy) || 1;
        lines.push(`<line x1="${A[0] + (dx / L) * off}" y1="${A[1] + (dy / L) * off}" x2="${B[0] + (dx / L) * off}" y2="${B[1] + (dy / L) * off}" stroke="${TREATY[t]?.color ?? '#94a3b8'}" stroke-width="2" opacity="0.85"><title>${esc(tip)}</title></line>`);
      });
      if (!r.war && !r.treaties.length && Math.abs(r.value) >= 15)
        lines.push(`<line x1="${A[0]}" y1="${A[1]}" x2="${B[0]}" y2="${B[1]}" stroke="${r.value > 0 ? '#86efac' : '#fca5a5'}" stroke-width="1" opacity="0.35"><title>${esc(tip)}</title></line>`);
    }
    const maxS = Math.max(1, ...live.map((f) => f.soldiers));
    const nodes = live
      .map((f) => {
        const [x, y] = pos.get(all.indexOf(f))!;
        const r = 12 + (f.soldiers / maxS) * 14;
        const towns = s.towns.filter((t) => t.faction === all.indexOf(f)).length;
        return `<g data-mind="${esc(f.name)}" style="cursor:pointer"><circle cx="${x}" cy="${y}" r="${r}" fill="${f.color}" fill-opacity="0.25" stroke="${f.color}" stroke-width="2"/><text x="${x}" y="${y + 4}" text-anchor="middle" fill="${f.color}" font-size="13" font-weight="700">${esc(f.name)}</text><text x="${x}" y="${y + r + 13}" text-anchor="middle" fill="#94a3b8" font-size="10.5">兵 ${f.soldiers} · 城 ${towns}</text><title>${esc(f.name)}：点一下看心里话</title></g>`;
      })
      .join('');
    const legend = `<div class="rel-legend"><span><i style="background:#ef4444"></i>交战</span>${Object.values(TREATY).map((t) => `<span><i style="background:${t.color}"></i>${t.name}</span>`).join('')}</div>`;
    const rows = all
      .map((f, i) => ({ f, i }))
      .filter(({ f }) => f.kind === 'lord' || f.kind === 'rebel')
      .map(({ f, i }) => {
        const towns = s.towns.map((t, k) => ({ t, k })).filter(({ t }) => t.faction === i);
        return `<tr class="${f.alive ? '' : 'dead'}"><td><span class="fdot" style="background:${f.color}"></span><b>${esc(f.name)}</b>${f.from ? `<div class="dim small">出自 ${esc(f.from)}</div>` : ''}</td><td>${f.alive ? towns.map(({ k }) => `<a data-town="${esc(this.defs.towns[k].name)}">${esc(this.defs.towns[k].name)}</a>`).join(' ') : '<span class="dim">已覆灭</span>'}</td><td>${f.soldiers}</td><td>${f.reputation}</td></tr>`;
      })
      .join('');
    return `<svg class="relgraph" viewBox="0 0 ${W} ${W}" width="100%">${lines.join('')}${nodes}</svg>${legend}
      <table class="ftable"><tr><th>势力</th><th>城镇</th><th>兵</th><th>声望</th></tr>${rows}</table>`;
  }

  private renderMinds(): string {
    const live = this.living();
    const pick = `<div class="dr-tools">${live.map((f) => `<button class="chip ${f.name === this.mind ? 'cur' : ''}" style="--c:${f.color}" data-mind="${esc(f.name)}">${esc(f.name)}</button>`).join('')}</div>`;
    const d = this.mindData;
    if (!this.mind) return pick + '<div class="dim">选一个诸侯。</div>';
    if (!d) return pick + '<div class="dim">读取中…</div>';
    const tpd = this.defs.ticksPerDay;
    const thoughts = d.thoughts.slice().reverse().map((t) => `<div class="thought"><span class="when">第 ${Math.floor(t.tick / tpd) + 1} 天</span>${this.paint(t.text)}</div>`).join('');
    const logs = d.logs
      .slice()
      .reverse()
      .map(
        (l) => `<div class="mlog"><div class="dim small">${esc(l.label)} · ${l.mode === 'llm' ? '大模型' : '脚本'} · 醒来原因：${esc(l.why)}</div>
          ${l.results.map((r) => `<div class="${r.ok ? 'ok' : 'err'}"><code>${esc(r.line)}</code> <span>${esc(r.msg)}</span></div>`).join('') || '<div class="dim small">（这次什么也没做）</div>'}
          ${l.prompt ? `<details><summary>看它收到的简报</summary><pre>${esc(l.prompt)}</pre></details><details><summary>原始回复</summary><pre>${esc(l.reply)}</pre></details>` : ''}</div>`,
      )
      .join('');
    return `${pick}<div class="dim small" style="margin:4px 0 8px">性格：<b style="color:${this.color(d.faction)}">${esc(d.personality || '—')}</b> · ${esc(d.mode === 'llm' ? '大模型' : d.mode === 'script' ? '脚本诸侯' : d.mode)} · 心里话只有上帝看得到</div>
      <div class="sec">心里话</div>${thoughts || '<div class="dim small">还没想过什么。</div>'}
      <div class="sec">最近的决定</div>${logs || '<div class="dim small">还没醒过。</div>'}`;
  }

  private renderGod(): string {
    const cmds = this.defs.commands.filter((c) => c.who.includes('god') && c.verb !== '派');
    const lord = this.living()[0]?.name ?? '青龙';
    const town = this.defs.towns[0]?.name ?? '';
    const region = this.defs.regions[0]?.name ?? '';
    const quick = [
      [`灾 旱 ${region} 10天`, '大旱：田和树不长'],
      [`灾 疫 ${town} 5天`, '瘟疫：城里的人掉血'],
      [`寇 ${region} 60`, '召唤 60 名流寇'],
      [`赐 ${lord} 金500`, '天降 500 金'],
      [`托梦 ${lord} 西方有变`, '托梦'],
      [`冒名 ${this.living()[1]?.name ?? lord} ${lord} 我军三日后借道贵境`, '冒名写信，挑拨离间'],
    ];
    return `<div class="dim small" style="margin-bottom:8px">点一下把命令填进命令框（以上帝身份），改好地点和人数再回车。上帝出手的真相只记在密辛里。</div>
      <div class="cmds">${quick.map(([l, h]) => `<div class="cmd" data-fill="${esc(l)}" data-god="1"><code>${esc(l)}</code><span>${esc(h)}</span></div>`).join('')}</div>
      <div class="sec">全部上帝命令</div>
      <div class="cmds">${cmds.map((c) => `<div class="cmd" data-fill="${esc(c.examples[0])}" data-god="1"><code>${esc(c.signature)}</code><span>${esc(c.help)}</span><em>例：${esc(c.examples.join('　'))}</em></div>`).join('')}</div>`;
  }
}
