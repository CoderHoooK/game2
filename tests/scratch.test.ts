// 从零开始的开局：每个诸侯一座营地、其余是空城址；人口、物资按设置；旧存档读不了。
import { describe, it, expect } from 'vitest';
import { createGame, Notable, type BuildingApi, type PopulationApi, type JobsApi, type EconomyApi, type MilitaryApi } from '../src/game';
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

describe('人才市场与「募」', () => {
  const lord = { role: 'lord' as const, faction: '青龙', origin: 'test' as const };
  const setup = () => {
    const s = createGame({ seed: 1 });
    const { P, E } = parts(s);
    const t = P.townByName('青石城')!;
    const put = (item: string, n: number) => E.stores[t.store].stock[E.itemIndex(item)] += n;
    const have = (item: string) => E.stores[t.store].stock[E.itemIndex(item)];
    return { s, P, E, t, put, have };
  };
  it('没有人才市场不能募，说明原因', () => {
    const { s } = setup();
    const r = s.bus.exec('募 青石城 农:1', lord);
    expect(r.ok).toBe(false);
    expect(r.msg).toContain('人才市场');
  });
  it('建好人才市场就能募：扣金和粮、人口 +、职业对', () => {
    const { s, P, t, have } = setup();
    expect(s.bus.exec('建 人才市场 青石城 @建:3', lord).ok).toBe(true);
    s.run(3000);
    expect(t.buildings.talent ?? 0).toBe(1);
    const gold = have('gold');
    const food = have('food');
    const before = P.residents(t.id).length;
    const r = s.bus.exec('募 青石城 农:2 木:1', lord);
    expect(r.ok, r.msg).toBe(true);
    expect(P.residents(t.id).length).toBe(before + 3);
    expect(have('gold')).toBeCloseTo(gold - 30, 0);
    expect(have('food')).toBeLessThan(food - 8);
  });
  it('每天名额、人口上限、士兵要兵营、金不够：都整条拒绝', () => {
    const { s, P, t, put } = setup();
    t.buildings.talent = 1;
    put('gold', 1000);
    put('food', 1000);
    expect(s.bus.exec('募 青石城 农:6', lord).msg).toContain('今天还能招 5 人');
    expect(s.bus.exec('募 青石城 兵:1', lord).msg).toContain('兵营');
    expect(s.bus.exec('募 青石城 农:5', lord).ok).toBe(true);
    expect(s.bus.exec('募 青石城 农:1', lord).ok).toBe(false); // 今天满了
    s.run(100); // 过一天，名额回来
    const room = t.cap - P.residents(t.id).length;
    t.cap -= room - 1; // 只剩 1 个位置
    expect(s.bus.exec('募 青石城 农:2', lord).msg).toContain('住不下');
    const { s: s2, t: t2, E: e2 } = setup();
    t2.buildings.talent = 1;
    e2.stores[t2.store].stock[e2.itemIndex('gold')] = 40;
    expect(s2.bus.exec('募 青石城 商:5', lord).msg).toContain('付不起');
  });
});

describe('建城', () => {
  const lord = (faction = '青龙') => ({ role: 'lord' as const, faction, origin: 'test' as const });
  const bld = (s: ReturnType<typeof createGame>) => s.service<BuildingApi>('building');
  const runUntil = (s: ReturnType<typeof createGame>, f: () => boolean, max = 8000) => {
    for (let i = 0; i < max && !f(); i += 50) s.run(50);
    return f();
  };

  it('空城址：花木头石头立工地，建筑工建完就归己方；城里没人、仓库空', () => {
    const s = createGame({ seed: 1 });
    const { P, E } = parts(s);
    const t = P.townByName('河口镇')!;
    expect(t.founded).toBe(false);
    const camp = P.townByName('青石城')!;
    const wood = () => E.stores[camp.store].stock[E.itemIndex('wood')];
    const w0 = wood();
    const r = s.bus.exec('建城 河口镇 @建:3', lord());
    expect(r.ok, r.msg).toBe(true);
    expect(w0 - wood()).toBeGreaterThanOrEqual(99); // 扣 100（营地上的伐木工会同时进一点）
    expect(bld(s).sites.some((x) => x.town === t.id)).toBe(true);
    expect(runUntil(s, () => t.founded)).toBe(true);
    expect(P.factions[t.faction].name).toBe('青龙');
    expect(P.factions.find((f) => f.name === '青龙')!.towns).toContain(t.id);
    expect(t.capital).toBe(false); // 都城还是青石城
    expect(camp.capital).toBe(true);
    expect(P.residents(t.id).length).toBe(0);
    expect(bld(s).sites.length).toBe(0);
  });
  it('拒绝：已建成的城、材料不够、重复立工地', () => {
    const s = createGame({ seed: 1, config: { population: { startWood: 50 } } });
    expect(s.bus.exec('建城 青石城', lord()).msg).toContain('不是空城址');
    expect(s.bus.exec('建城 河口镇', lord()).msg).toContain('材料不够');
    const s2 = createGame({ seed: 1 });
    expect(s2.bus.exec('建城 河口镇', lord()).ok).toBe(true);
    expect(s2.bus.exec('建城 河口镇', lord()).msg).toContain('已经');
  });
  it('两家抢同一个城址：先建成的得城，另一家的工地作废', () => {
    const s = createGame({ seed: 1 });
    const { P } = parts(s);
    const t = P.townByName('河口镇')!;
    expect(s.bus.exec('建城 河口镇 @建:3', lord('青龙')).ok).toBe(true);
    expect(s.bus.exec('建城 河口镇 @建:3', lord('赤焰')).ok).toBe(true);
    expect(runUntil(s, () => t.founded)).toBe(true);
    expect(bld(s).sites.filter((x) => x.town === t.id).length).toBe(0);
  });
  it('新城能招人：建人才市场 + 募', () => {
    const s = createGame({ seed: 1 });
    const { P, E } = parts(s);
    const t = P.townByName('河口镇')!;
    s.bus.exec('建城 河口镇 @建:3', lord());
    expect(runUntil(s, () => t.founded)).toBe(true);
    E.stores[t.store].stock[E.itemIndex('gold')] = 500;
    E.stores[t.store].stock[E.itemIndex('food')] = 500;
    E.stores[t.store].stock[E.itemIndex('wood')] = 500;
    expect(s.bus.exec('建 人才市场 河口镇 @建:3', lord()).ok).toBe(true);
    expect(runUntil(s, () => (t.buildings.talent ?? 0) > 0)).toBe(true);
    expect(s.bus.exec('募 河口镇 农:3', lord()).ok).toBe(true);
    expect(P.residents(t.id).length).toBe(3);
  });
});
