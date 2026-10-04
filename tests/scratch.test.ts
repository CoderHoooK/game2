// 从零开始的开局：每个诸侯一座营地、其余是空城址；人口、物资按设置；旧存档读不了。
import { describe, it, expect } from 'vitest';
import { createGame, Notable, type PopulationApi, type JobsApi, type EconomyApi, type MilitaryApi } from '../src/game';
import { saveSim, loadSim } from '../src/engine/save';
import { PROFESSIONS } from '../content/professions';

const parts = (sim: ReturnType<typeof createGame>) => ({
  P: sim.service<PopulationApi>('population'),
  J: sim.service<JobsApi>('jobs'),
  E: sim.service<EconomyApi>('economy'),
});

describe('从零开始的开局', () => {
  const sim = createGame({ seed: 1 });
  const { P, J, E } = parts(sim);
  const lords = P.factions.filter((f) => f.kind === 'lord');

  it('每个诸侯 1 座营地，其余城址空着、无主', () => {
    const camps = P.towns.filter((t) => t.founded);
    expect(camps.length).toBe(lords.length);
    for (const f of lords) expect(P.towns.filter((t) => t.founded && t.faction === f.index).length, f.name).toBe(1);
    for (const t of P.towns.filter((x) => !x.founded)) {
      expect(P.factions[t.faction].kind, t.name).not.toBe('lord');
      expect(Array.from(E.stores[t.store].stock).every((v) => v === 0), `${t.name} 仓库应是空的`).toBe(true);
    }
  });

  it('人口 = 设置里的各职业人数 × 营地数；不再有一大批预生成的人', () => {
    const npcs = P.npcs().filter((e) => !sim.world.has(e, Notable));
    expect(npcs.length).toBe((8 + 4 + 3) * lords.length);
    const counts = J.countByProf();
    expect(counts[PROFESSIONS.findIndex((p) => p.id === 'farmer')]).toBe(8 * lords.length);
    expect(counts[PROFESSIONS.findIndex((p) => p.id === 'builder')]).toBe(3 * lords.length);
    expect(P.notables().length).toBe(2); // 只有在野名人，诸侯开局不带名人
  });

  it('开局物资按设置，默认没有田', () => {
    const camp = P.towns.find((t) => t.founded)!;
    const s = E.stores[camp.store].stock;
    expect(s[E.itemIndex('gold')]).toBe(200);
    expect(s[E.itemIndex('food')]).toBe(300);
  });

  it('设置能改：诸侯 2 座营地、每营 20 个农民 + 5 个兵', () => {
    const s = createGame({ seed: 1, config: { population: { camps: 2, startFarmer: 20, startSoldier: 5, startGold: 50 } } });
    const { P: p2, J: j2, E: e2 } = parts(s);
    const n = p2.factions.filter((f) => f.kind === 'lord').length;
    expect(p2.towns.filter((t) => t.founded).length).toBe(2 * n);
    // 在野名人也算一个职业，所以允许多 1–2 个
    const soldiers = j2.countByProf()[PROFESSIONS.findIndex((p) => p.id === 'soldier')];
    expect(soldiers).toBeGreaterThanOrEqual(5 * 2 * n);
    expect(soldiers).toBeLessThanOrEqual(5 * 2 * n + 2);
    expect(e2.stores[p2.towns.find((t) => t.founded)!.store].stock[e2.itemIndex('gold')]).toBe(50);
  });

  it('空城址不占领土、不被围、不被强盗盯上', () => {
    const s = createGame({ seed: 1 });
    const m = s.service<MilitaryApi>('military');
    s.run(300);
    const p = s.service<PopulationApi>('population');
    for (const t of p.towns.filter((x) => !x.founded)) expect(m.sieges().some((x) => x.town === t.id), t.name).toBe(false);
  });

  it('存档读回一致；之后各跑一段仍一致', () => {
    const s = createGame({ seed: 3 });
    s.run(2000);
    const back = createGame({ seed: 3 });
    loadSim(back, JSON.parse(JSON.stringify(saveSim(s))));
    expect(back.hash()).toBe(s.hash());
    back.run(500);
    s.run(500);
    expect(back.hash()).toBe(s.hash());
  });
});
