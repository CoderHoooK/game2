// 脚本诸侯：没有大模型时用的确定性 AI。只看简报里同样能看到的东西（自家数字、斥候情报、公开信息），
// 按性格（好战 / 外交 / 建设）做决定，输出和大模型一样的命令行。用来让世界在没联网时也能「勾心斗角」。
import type { Sim } from '../engine/sim';
import { Rng } from '../shared/rng';
import { Identity, type EconomyApi, type PopulationApi, type JobsApi, type DiplomacyApi, type MilitaryApi, type BuildingApi, type Town } from '../game';

export interface Personality {
  name: string;
  aggression: number;
  diplomacy: number;
  build: number;
}
export const PERSONALITIES: Personality[] = [
  { name: '稳健', aggression: 0.3, diplomacy: 0.6, build: 0.9 },
  { name: '霸道', aggression: 0.85, diplomacy: 0.2, build: 0.5 },
  { name: '纵横', aggression: 0.5, diplomacy: 0.9, build: 0.6 },
];
const DEFAULT_PERS: Record<string, string> = { 青龙: '稳健', 赤焰: '霸道', 白鹿: '纵横', 玄武: '稳健', 金乌: '纵横', 苍狼: '霸道' };
export const personalityFor = (faction: string): Personality => PERSONALITIES.find((p) => p.name === (DEFAULT_PERS[faction] ?? '霸道'))!;

export interface ScriptMemory {
  wakes: number;
  quota: Record<number, string>;
  target?: string;
  proposed: Record<string, number>;
}
export const newMemory = (): ScriptMemory => ({ wakes: 0, quota: {}, proposed: {} });

export function decide(sim: Sim, faction: string, pers: Personality, mem: ScriptMemory, rng: Rng): string[] {
  const eco = sim.service<EconomyApi>('economy');
  const pop = sim.service<PopulationApi>('population');
  const jobs = sim.service<JobsApi>('jobs');
  const dip = sim.service<DiplomacyApi>('diplomacy');
  const mil = sim.service<MilitaryApi>('military');
  const bld = sim.service<BuildingApi>('building');
  const fi = pop.factionIndex(faction);
  const me = pop.factions[fi];
  if (!me?.alive || !me.towns.length) return [];
  mem.wakes++;
  const out: string[] = [];
  const thoughts: string[] = [];
  const towns = me.towns.map((i) => pop.towns[i]);
  const stock = (t: Town, id: string) => eco.stores[t.store].stock[eco.itemIndex(id)];
  const eat = (t: Town) => Math.max(1, pop.residents(t.id).reduce((s, e) => s + pop.upkeepOf(e), 0));
  const foodDays = (t: Town) => stock(t, 'food') / eat(t);
  const winter = sim.clock.season === '冬';
  const soldierIdx = jobs.profIndex('soldier');
  const mySoldiers = jobs.countByProf(fi)[soldierIdx];
  const others = pop.livingFactions().filter((f) => f.index !== fi);
  const enemies = others.filter((f) => dip.atWar(fi, f.index));
  /** 估计对方兵力：有情报用情报，没有按每城 30 估 */
  const estimate = (f: (typeof others)[number]) => {
    const seen = mil.intel(fi).filter((x) => x.faction === f.name);
    return seen.length ? seen.reduce((s, x) => s + x.soldiers, 0) + (f.towns.length - seen.length) * 30 : f.towns.length * 30;
  };
  const dist = (f: (typeof others)[number]) => Math.min(...f.towns.map((i) => Math.min(...towns.map((t) => Math.hypot(pop.towns[i].x - t.x, pop.towns[i].y - t.y)))));

  // ---- 内政：税、开仓、比例
  for (const t of towns) {
    if (t.mood < 30 && t.tax > 0) out.push(`税 ${t.name} ${Math.max(0, t.tax - 5)}`);
    else if (t.mood > 70 && t.tax < 20 && stock(t, 'gold') < 400) out.push(`税 ${t.name} ${t.tax + 5}`);
    if (t.mood < 25 && foodDays(t) > 30) out.push(`开仓 ${t.name} ${Math.ceil(t.pop * 1.5)}`);
    const fd = foodDays(t);
    const farm = fd < 25 ? 40 : fd > 120 ? 22 : 30;
    const sold = Math.round(12 + pers.aggression * 18 + (enemies.length ? 8 : 0));
    const q = `农${farm} 木14 石8 矿6 建7 铁3 运5 兵${sold} 斥4 商${Math.max(3, 9 - Math.round(pers.aggression * 5))}`;
    if (mem.quota[t.id] !== q) {
      out.push(`比例 ${t.name} ${q}`);
      mem.quota[t.id] = q;
    }
  }
  const capital = towns[0];
  const lowFood = towns.filter((t) => foodDays(t) < 15);
  if (lowFood.length) thoughts.push(`${lowFood.map((t) => t.name).join('、')} 粮只够 ${Math.round(Math.min(...lowFood.map(foodDays)))} 天`);

  // ---- 建设：每次最多立一个工地
  if (rng.chance(0.4 + pers.build * 0.6)) {
    for (const t of towns) {
      if (bld.sites.some((s) => s.town === t.id)) continue;
      const w = stock(t, 'wood');
      const s = stock(t, 'stone');
      const b = (id: string) => t.buildings[id] ?? 0;
      let pick = '';
      if (t.pop >= t.cap - 15 && w >= 40) pick = '房屋';
      else if (!b('granary') && w >= 60 && s >= 20) pick = '仓库';
      else if (foodDays(t) < 40 && b('farm') < 4 && w >= 20) pick = '农田';
      else if (pers.aggression > 0.6 && !b('barracks') && w >= 80 && s >= 40) pick = '兵营';
      else if (enemies.length && t.walls < 2 && s >= 120 && w >= 30) pick = '城墙';
      else if (stock(t, 'iron') >= 15 && !b('forge') && w >= 60 && s >= 60) pick = '铁匠铺';
      else if (!b('market') && w >= 80 && stock(t, 'gold') < 500) pick = '市场';
      if (pick) {
        out.push(`建 ${pick} ${t.name}`);
        break;
      }
    }
  }

  // ---- 外交
  for (const p of dip.proposals.filter((x) => x.to === fi)) {
    const from = pop.factions[p.from];
    const rel = dip.relation(fi, p.from);
    const losing = dip.atWar(fi, p.from) && mySoldiers < estimate(from) * 0.9;
    const ok =
      (p.type === 'nonaggression' && (pers.aggression < 0.7 || losing)) ||
      (p.type === 'trade' && rel > -30) ||
      (p.type === 'passage' && rel > 10) ||
      (p.type === 'alliance' && rel > 0 && pers.diplomacy > 0.4) ||
      (p.type === 'tribute' && p.from === fi);
    if (ok) out.push(`应 ${from.name}`);
  }
  const canPropose = (k: string) => (mem.proposed[k] ?? -99) + 5 <= mem.wakes;
  if (rng.chance(pers.diplomacy)) {
    const peaceful = others.filter((f) => !dip.atWar(fi, f.index)).sort((a, b) => dist(a) - dist(b));
    const partner = peaceful.find((f) => !dip.hasTreaty(fi, f.index, 'trade') && dip.relation(fi, f.index) >= -10);
    if (partner && canPropose('trade:' + partner.name)) {
      out.push(`约 ${partner.name} 通商`);
      mem.proposed['trade:' + partner.name] = mem.wakes;
    }
    const strong = [...peaceful].sort((a, b) => estimate(b) - estimate(a))[0];
    if (strong && !dip.hasTreaty(fi, strong.index, 'nonaggression') && estimate(strong) > mySoldiers && canPropose('nap:' + strong.name)) {
      out.push(`约 ${strong.name} 互不侵犯 60天`);
      mem.proposed['nap:' + strong.name] = mem.wakes;
    }
    if (pers.diplomacy > 0.8 && enemies.length && peaceful.length && rng.chance(0.5)) {
      const e = enemies[0];
      const ally = peaceful.find((f) => dip.relation(f.index, e.index) < 0) ?? peaceful[0];
      out.push(`信 ${ally.name} ${e.name} 兵锋日盛，今日犯我，明日必及贵国。愿共图之。`);
    }
  }
  for (const e of enemies) {
    if (mySoldiers < estimate(e) * 0.7 && canPropose('peace:' + e.name)) {
      out.push(`约 ${e.name} 互不侵犯 30天`);
      mem.proposed['peace:' + e.name] = mem.wakes;
      thoughts.push(`打不过 ${e.name}，先求和`);
    }
  }
  const trade = others.find((f) => dip.hasTreaty(fi, f.index, 'trade') && !dip.atWar(fi, f.index));
  if (trade && mem.wakes % 4 === 1) out.push(`商 @商:50% ${trade.name}`);

  // ---- 军事
  const besieged = mil.sieges().filter((s) => pop.towns[s.town].faction === fi);
  for (const s of besieged) {
    out.push(`守 @兵:40% ${pop.towns[s.town].name}`);
    thoughts.push(`${pop.towns[s.town].name} 被 ${pop.factions[s.attacker].name} 围了`);
  }
  if (mem.wakes % 3 === 0 && others.length) {
    const near = [...others].sort((a, b) => dist(a) - dist(b))[0];
    const t = pop.towns[near.towns[0]];
    if (t) out.push(`探 @斥:2 ${t.name}`);
  }
  if (mem.target) {
    const t = pop.townByName(mem.target);
    if (!t || t.faction === fi || !enemies.some((e) => e.index === t.faction)) mem.target = undefined;
  }
  if (!winter && !besieged.length && mySoldiers >= 30) {
    const victims = others
      .filter((f) => !dip.hasTreaty(fi, f.index, 'alliance'))
      .map((f) => ({ f, ratio: mySoldiers / Math.max(1, estimate(f)), d: dist(f) }))
      .filter((x) => x.ratio > 1.3 && x.d < 5000 && (enemies.includes(x.f) || !dip.hasTreaty(fi, x.f.index, 'nonaggression') || pers.aggression > 0.8))
      .sort((a, b) => b.ratio / b.d - a.ratio / a.d);
    const v = victims[0];
    if (v && !mem.target && (enemies.includes(v.f) || rng.chance(pers.aggression * 0.5))) {
      const t = v.f.towns.map((i) => pop.towns[i]).sort((a, b) => Math.hypot(a.x - capital.x, a.y - capital.y) - Math.hypot(b.x - capital.x, b.y - capital.y))[0];
      mem.target = t.name;
      out.push(`编 @兵:60% 征军`, `攻 #征军 ${v.f.name}.${t.name}`);
      thoughts.push(`${v.f.name} 兵少（我 ${mySoldiers}，估他 ${estimate(v.f)}），取 ${t.name}`);
    } else if (mem.target && mem.wakes % 2 === 0) {
      out.push(`编 @兵:60% 征军`, `攻 #征军 ${mem.target}`);
    }
  }
  // 招揽在野名人
  const gold = stock(capital, 'gold');
  if (gold > 700) {
    const free = pop.notables().filter((e) => pop.factions[sim.world.get(Identity).faction[e]].kind === 'free');
    if (free.length) out.push(`招 ${sim.world.get(Identity).name[free[0]]} 300金`);
  }
  if (thoughts.length) out.push(`想 ${thoughts.join('；')}`);
  return out.slice(0, 12);
}

export const scriptRng = (sim: Sim, faction: string) => {
  let h = sim.seed ^ 0xa1;
  for (const ch of faction) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return new Rng(h);
};
