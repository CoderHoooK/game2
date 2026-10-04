// 简报：给 AI 诸侯看的「事实」——只有数字和发生过的事，没有任何指令或建议（怎么做由 AI 自己决定）。
import type { Sim } from '../engine/sim';
import type { EconomyApi, PopulationApi, JobsApi, DiplomacyApi, MilitaryApi, ChronicleApi, BuildingApi, TalentApi, WorldApi, Town } from '../game';
import { CITY } from '../../content/buildings';
import { FOOD_PER_DAY } from '../../content/professions';

export interface BriefingState {
  /** 上次醒来时看到的最后一条史册 / 收件箱编号 */
  lastEntry: number;
  lastMsg: number;
}

const r = (n: number) => Math.round(n);

export function buildBriefing(sim: Sim, faction: string, st: BriefingState, opts: { commands?: boolean } = {}): string {
  const eco = sim.service<EconomyApi>('economy');
  const world = sim.service<WorldApi>('world');
  const pop = sim.service<PopulationApi>('population');
  const jobs = sim.service<JobsApi>('jobs');
  const dip = sim.service<DiplomacyApi>('diplomacy');
  const mil = sim.service<MilitaryApi>('military');
  const chr = sim.service<ChronicleApi>('chronicle');
  const bld = sim.service<BuildingApi>('building');
  const tal = sim.service<TalentApi>('talent');
  const fi = pop.factionIndex(faction);
  const f = pop.factions[fi];
  const out: string[] = [];
  const item = (t: Town, id: string) => eco.stores[t.store].stock[eco.itemIndex(id)];
  out.push(`【${faction}】${sim.clock.label()}（每季 ${sim.clock.daysPerSeason} 天，冬天田里不产粮）。声望 ${r(f.reputation)}。`);

  out.push('', '## 城镇');
  for (const ti of f.towns) {
    const t = pop.towns[ti];
    const eat = pop.residents(t.id).reduce((s, e) => s + pop.upkeepOf(e), 0) || t.pop * FOOD_PER_DAY;
    const b = Object.entries(t.buildings).filter(([, n]) => n > 0).map(([k, n]) => `${bld.def(k)?.name ?? k}${n > 1 ? '×' + n : ''}`).join(' ') || '无';
    const sites = bld.sites.filter((s) => s.town === t.id).map((s) => `${bld.def(s.building)?.name}${r((s.progress / (bld.def(s.building)?.work ?? 1)) * 100)}%`).join(' ');
    out.push(
      `- ${t.name}${t.capital ? '（都城）' : ''}：人口 ${t.pop}/${t.cap}，民心 ${r(t.mood)}，税 ${t.tax}%，城墙 ${t.walls}，` +
        `粮 ${r(item(t, 'food'))}（每天吃 ${r(eat)}，够 ${r(item(t, 'food') / Math.max(1, eat))} 天），木 ${r(item(t, 'wood'))}，石 ${r(item(t, 'stone'))}，铁 ${r(item(t, 'iron'))}，金 ${r(item(t, 'gold'))}，兵器 ${r(item(t, 'weapon'))}；` +
        `建筑：${b}${sites ? `；工地：${sites}` : ''}` +
        `${t.buildings.talent ? `；人才市场招募名额剩 ${tal.quotaLeft(t.id)}` : ''}`,
    );
  }
  out.push('', `## 招募（有人才市场的城才能募；士兵另需兵营；名额每天恢复 ${tal.dailyLimit} 个、最多攒 ${tal.maxBank} 个；自然出生率 0）`);
  out.push(jobs.professions.map((p, i) => `${p.short}：${Object.entries(tal.priceOf(i)).map(([k, v]) => k + v).join(' ')}`).join('；'));
  const empty = pop.towns.filter((t) => !t.founded);
  if (empty.length) {
    out.push('', `## 空城址（没人建城；建城要 ${Object.entries(CITY.cost).map(([k, v]) => eco.items[eco.itemIndex(k)].name + v).join('、')}，工作量 ${CITY.work}，新城的仓库和人口都是空的）`);
    for (const t of empty) {
      const near = pop.nearestTown(fi, t.x, t.y);
      const racing = bld.sites.filter((s) => s.building === CITY.id && s.town === t.id).map((s) => pop.factions[s.faction].name);
      out.push(`- ${t.name}：地区 ${world.map.regions[t.region].name}${near ? `，离 ${near.name} ${r(Math.hypot(near.x - t.x, near.y - t.y))} 米` : ''}${racing.length ? `；已有工地：${racing.join('、')}` : ''}`);
    }
  }
  const counts = jobs.countByProf(fi);
  out.push('', '## 人手', jobs.professions.map((p, i) => `${p.short}${counts[i]}`).join(' ') + `（共 ${counts.reduce((a, b) => a + b, 0)}）`);

  out.push('', '## 天下');
  for (const o of pop.livingFactions()) {
    if (o.index === fi) continue;
    const rel = r(dip.relation(fi, o.index));
    const war = dip.atWar(fi, o.index) ? '【交战中】' : '';
    const tr = dip.treaties.filter((t) => (t.a === fi && t.b === o.index) || (t.b === fi && t.a === o.index)).map((t) => t.type);
    const towns = o.towns.map((i) => pop.towns[i].name).join('、');
    out.push(`- ${o.name}${war}：城 ${towns}；关系 ${rel}；声望 ${r(o.reputation)}${tr.length ? `；条约 ${tr.join('、')}` : ''}`);
  }
  const intel = mil.intel(fi);
  if (intel.length) {
    out.push('', '## 斥候情报');
    for (const x of intel.slice(-12)) out.push(`- ${x.town}（${x.faction}）：兵约 ${x.soldiers}，粮约 ${x.food}，城墙 ${x.walls}（${Math.floor((sim.clock.tick - x.tick) / sim.clock.ticksPerDay)} 天前）`);
  }
  const sieges = mil.sieges().filter((s) => pop.towns[s.town].faction === fi || s.attacker === fi);
  if (sieges.length) out.push('', '## 围城', ...sieges.map((s) => `- ${pop.towns[s.town].name} 被 ${pop.factions[s.attacker].name} 围（${r((s.progress / s.need) * 100)}%）`));
  const props = dip.proposals.filter((p) => p.to === fi);
  if (props.length) out.push('', '## 待答复的提议', ...props.map((p) => `- ${pop.factions[p.from].name}：${p.type}${p.days ? ' ' + p.days + ' 天' : ''}`));

  const msgs = dip.inbox(fi).filter((m) => m.id > st.lastMsg);
  if (msgs.length) out.push('', '## 新来信', ...msgs.slice(-15).map((m) => `- [${m.kind}] ${m.from}：${m.text}`));
  const news = chr.entries(faction, st.lastEntry);
  if (news.length) out.push('', '## 近来发生', ...news.slice(-20).map((e) => `- ${e.text}`));
  st.lastMsg = Math.max(st.lastMsg, ...msgs.map((m) => m.id), 0);
  st.lastEntry = chr.lastId();

  if (opts.commands !== false) {
    out.push('', '## 命令格式（每行一条，最多 12 行；@职业 选人，:N 取人数，:N% 取比例，#队名 指编队）');
    for (const c of sim.bus.list()) if (c.who.includes('lord')) out.push(`${sim.bus.signature(c)} —— ${c.help}（例：${c.examples[0]}）`);
  }
  return out.join('\n');
}
