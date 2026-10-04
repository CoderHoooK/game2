// 每秒推一次的统计：库存、人手、城镇（民心 / 建筑 / 工地 / 围城）、势力、关系、新增史册。
import type { Sim } from '../engine/sim';
import { Identity, Profession, type EconomyApi, type JobsApi, type PopulationApi, type BuildingApi, type DiplomacyApi, type MilitaryApi, type ChronicleApi, type TalentApi } from '../game';
import type { StatsMsg } from '../protocol/messages';

export class StatsBuilder {
  private lastEntry = 0;
  constructor(private sim: Sim) {}

  build(base: { tickMs: number; systems: Record<string, number> }): StatsMsg {
    const sim = this.sim;
    const eco = sim.service<EconomyApi>('economy');
    const pop = sim.service<PopulationApi>('population');
    const jobs = sim.service<JobsApi>('jobs');
    const bld = sim.service<BuildingApi>('building');
    const dip = sim.service<DiplomacyApi>('diplomacy');
    const mil = sim.service<MilitaryApi>('military');
    const chr = sim.service<ChronicleApi>('chronicle');
    const tal = sim.service<TalentApi>('talent');
    const I = sim.world.get(Identity);
    const PR = sim.world.get(Profession);
    const townCounts = pop.towns.map(() => jobs.professions.map(() => 0));
    for (const e of pop.npcs()) if (sim.world.has(e, Profession)) townCounts[I.home[e]][PR.prof[e]]++;
    const sieges = new Map(mil.sieges().map((s) => [s.town, s]));
    const living = pop.factions.filter((f) => f.alive && (f.kind === 'lord' || f.kind === 'rebel'));
    const trades = new Map(dip.trades().map(([a, b, n]) => [`${a}:${b}`, n]));
    const relations: StatsMsg['relations'] = [];
    for (let i = 0; i < living.length; i++)
      for (let j = i + 1; j < living.length; j++) {
        const a = living[i].index;
        const b = living[j].index;
        relations.push({
          a,
          b,
          value: Math.round(dip.relation(a, b)),
          war: dip.atWar(a, b),
          treaties: dip.treaties.filter((t) => (t.a === a && t.b === b) || (t.a === b && t.b === a)).map((t) => t.type),
          trades: trades.get(`${Math.min(a, b)}:${Math.max(a, b)}`) ?? 0,
        });
      }
    const entries = chr.entries('god', this.lastEntry);
    this.lastEntry = chr.lastId();
    return {
      t: 'stats',
      tick: sim.clock.tick,
      label: sim.clock.label(),
      speed: sim.clock.speed,
      tickMs: base.tickMs,
      systems: base.systems,
      npcs: pop.npcs().length,
      stocks: pop.towns.map((t) => Array.from(eco.stores[t.store].stock, (v) => Math.floor(v))),
      counts: jobs.countByProf(),
      townCounts,
      towns: pop.towns.map((t) => {
        const s = sieges.get(t.id);
        return {
          faction: t.faction,
          founded: t.founded,
          recruit: t.buildings.talent ? { left: tal.quotaLeft(t.id), max: tal.maxBank, daily: tal.dailyLimit } : undefined,
          capital: t.capital,
          pop: t.pop,
          cap: t.cap,
          mood: Math.round(t.mood),
          tax: t.tax,
          walls: t.walls,
          buildings: { ...t.buildings },
          sites: bld.sites.filter((x) => x.town === t.id).map((x) => ({ name: bld.def(x.building)?.name ?? x.building, progress: x.progress / (bld.def(x.building)?.work ?? 1) })),
          siege: s ? { by: s.attacker, progress: s.progress / s.need } : undefined,
        };
      }),
      factions: pop.factions.map((f) => ({ name: f.name, color: f.color, kind: f.kind, alive: f.alive, reputation: Math.round(f.reputation), soldiers: f.alive ? mil.strength(f.index) : 0, from: f.from })),
      relations,
      chronicle: entries.slice(-200),
    };
  }
}
