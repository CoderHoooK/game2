// 第 1–6 阶段的玩法规则：经济循环、人口、建造、外交、军事、上帝、AI 层、存档。
// 每条都是「做了某事 → 世界该有的变化」，测的是规则，不测具体数值。
import { describe, it, expect } from 'vitest';
import {
  createGame,
  Notable,
  type WorldApi,
  type PopulationApi,
  type JobsApi,
  type EconomyApi,
  type BuildingApi,
  type DiplomacyApi,
  type MilitaryApi,
  type ChronicleApi,
} from '../src/game';
import type { Sim } from '../src/engine/sim';
import type { GameEvent } from '../src/engine/events';
import { saveSim, loadSim } from '../src/engine/save';
import { AiHost, buildBriefing, extractCommands, MAX_LINES, type Provider } from '../src/ai';
import { legacy } from './helpers';

const lord = (faction = '青龙') => ({ role: 'lord' as const, faction, origin: 'test' as const });
const god = { role: 'god' as const, origin: 'test' as const };
const small = (seed = 1, npcs = 600) => createGame({ seed, config: legacy(npcs) });

function api(sim: Sim) {
  return {
    W: sim.service<WorldApi>('world'),
    E: sim.service<EconomyApi>('economy'),
    P: sim.service<PopulationApi>('population'),
    J: sim.service<JobsApi>('jobs'),
    B: sim.service<BuildingApi>('building'),
    D: sim.service<DiplomacyApi>('diplomacy'),
    M: sim.service<MilitaryApi>('military'),
    C: sim.service<ChronicleApi>('chronicle'),
  };
}
function record(sim: Sim, type: string): GameEvent[] {
  const got: GameEvent[] = [];
  sim.events.on(type, (ev) => got.push(ev));
  return got;
}
const ok = (sim: Sim, line: string, src: Parameters<Sim['bus']['exec']>[1] = lord()) => {
  const r = sim.bus.exec(line, src);
  if (!r.ok) throw new Error(`${line} → ${r.msg}`);
  return r;
};
const stock = (sim: Sim, town: string, item: string) => {
  const { P, E } = api(sim);
  return E.stores[P.townByName(town)!.store].stock[E.itemIndex(item)];
};

describe('存档', () => {
  it('存 → 读进新世界：哈希一样，之后各跑一段（带 AI）也一样', async () => {
    const a = small();
    const ha = new AiHost(a);
    for (let i = 0; i < 900; i++) (ha.step(), a.tick());
    const file = JSON.parse(JSON.stringify({ sim: saveSim(a), ai: ha.save() }));
    const b = small();
    const hb = new AiHost(b);
    loadSim(b, file.sim);
    hb.load(file.ai);
    expect(b.hash()).toBe(a.hash());
    expect(b.clock.tick).toBe(a.clock.tick);
    for (let i = 0; i < 1200; i++) (ha.step(), a.tick(), hb.step(), b.tick());
    expect(b.hash()).toBe(a.hash());
    expect(api(b).C.lastId()).toBe(api(a).C.lastId());
  });
});

describe('第 1 阶段 · 经济', () => {
  it('四季：换季有事件，冬天田里不长粮', () => {
    const s = small();
    const { W, P } = api(s);
    const seasons = record(s, 'season.changed');
    s.clock.tick = 8900;
    s.run(200);
    expect(seasons.map((e) => (e.data as { season: string }).season)).toContain('冬');
    expect(W.regenMul(1, P.towns[0].region)).toBe(0);
    expect(W.regenMul(0, P.towns[0].region)).toBeGreaterThan(0);
  });

  it('断粮：城里没粮 → 断粮事件、民心下降', () => {
    const s = small();
    const { P, E } = api(s);
    const t = P.townByName('青石城')!;
    const starving = record(s, 'settlement.starving');
    const mood0 = t.mood;
    for (let i = 0; i < 60; i++) {
      E.stores[t.store].stock[E.itemIndex('food')] = 0;
      s.run(10);
    }
    expect(starving.some((e) => (e.data as { town: string }).town === '青石城')).toBe(true);
    expect(t.mood).toBeLessThan(mood0);
  });

  it('库存告急：粮刚跌破 5 天时报一次', () => {
    const s = small();
    const { P, E } = api(s);
    const t = P.townByName('河口镇')!;
    const low = record(s, 'stock.low');
    s.run(100);
    const need = P.residents(t.id).reduce((n, e) => n + P.upkeepOf(e), 0);
    E.stores[t.store].stock[E.itemIndex('food')] = need * 5.5;
    s.run(2);
    expect(low.map((e) => (e.data as { town: string }).town)).toContain('河口镇');
  });

  it('有粮就生孩子，但不超过人口上限', () => {
    const s = small();
    const { P, E } = api(s);
    for (const t of P.towns) E.stores[t.store].stock[E.itemIndex('food')] = 5000;
    const born = record(s, 'npc.born');
    s.run(2000);
    expect(born.length).toBeGreaterThan(0);
    for (const t of P.towns) expect(t.pop, t.name).toBeLessThanOrEqual(t.cap);
  });

  it('比例：调高兵的比例 → 每天自动转职，兵变多', () => {
    const s = small();
    const { J, P } = api(s);
    const fi = P.factionIndex('青龙');
    const soldiers = () => J.countByProf(fi)[J.profIndex('soldier')];
    const before = soldiers();
    ok(s, '比例 青石城 农20 木10 石5 矿5 建5 铁5 运5 兵35 斥5 商5');
    s.run(1000);
    expect(soldiers()).toBeGreaterThan(before);
  });

  it('运：派搬运工在两座城之间运石头（自动搬运只管粮），目的城的石头比不运多', () => {
    const run = (cmd: boolean) => {
      const s = small();
      if (cmd) ok(s, '运 @运@青石城:6 石头 青石城 河口镇');
      s.run(3500);
      return stock(s, '河口镇', 'stone');
    };
    expect(run(true)).toBeGreaterThan(run(false));
  });

  it('打造：铁匠把铁和木头打成兵器', () => {
    const s = small();
    const { P, E } = api(s);
    for (const t of P.towns) {
      E.stores[t.store].stock[E.itemIndex('iron')] = 200;
      E.stores[t.store].stock[E.itemIndex('wood')] = 400;
    }
    const w0 = stock(s, '青石城', 'weapon');
    s.run(1500);
    expect(stock(s, '青石城', 'weapon')).toBeGreaterThan(w0);
  });
});

describe('第 2 阶段 · 建造', () => {
  it('建：扣材料、开工地、盖好后人口上限变大', () => {
    const s = small();
    const { P, B } = api(s);
    const t = P.townByName('青石城')!;
    const cap0 = t.cap;
    const wood0 = stock(s, '青石城', 'wood');
    const built = record(s, 'building.done');
    ok(s, '建 房屋 青石城');
    expect(stock(s, '青石城', 'wood')).toBeLessThan(wood0);
    expect(B.sites.some((x) => x.town === t.id && x.building === 'house')).toBe(true);
    for (let i = 0; i < 60 && !built.length; i++) s.run(100);
    expect(built.length).toBeGreaterThan(0);
    expect(t.cap).toBeGreaterThan(cap0);
  });

  it('拆：盖好的建筑拆掉就没了；没盖好的工地拆掉也没了', () => {
    const s = small();
    const { P, B } = api(s);
    const t = P.townByName('青石城')!;
    const built = record(s, 'building.done');
    ok(s, '建 房屋 青石城');
    for (let i = 0; i < 60 && !built.length; i++) s.run(100);
    expect(t.buildings.house).toBe(1);
    ok(s, '拆 房屋 青石城');
    expect(t.buildings.house ?? 0).toBe(0);
    ok(s, '建 农田 青石城');
    expect(B.sites.some((x) => x.town === t.id)).toBe(true);
    ok(s, '拆 农田 青石城');
    expect(B.sites.some((x) => x.town === t.id)).toBe(false);
  });
});

describe('第 3 阶段 · 外交', () => {
  it('信只有收信人看得到；史册公开部分不含信的内容', () => {
    const s = small();
    const { D, P, C } = api(s);
    ok(s, '信 白鹿 共讨赤焰暗号甲');
    s.run(1);
    expect(D.inbox(P.factionIndex('白鹿')).some((m) => m.text.includes('暗号甲'))).toBe(true);
    expect(D.inbox(P.factionIndex('赤焰')).some((m) => m.text.includes('暗号甲'))).toBe(false);
    expect(C.entries('赤焰').some((e) => e.text.includes('暗号甲'))).toBe(false);
    expect(C.entries('god').some((e) => e.text.includes('暗号甲'))).toBe(true);
  });

  it('约 + 应 → 条约生效；撕约伤名声', () => {
    const s = small();
    const { D, P } = api(s);
    const a = P.factionIndex('青龙');
    const b = P.factionIndex('赤焰');
    ok(s, '约 赤焰 互不侵犯 30天');
    ok(s, '应 青龙', lord('赤焰'));
    expect(D.hasTreaty(a, b, 'nonaggression')).toBe(true);
    const rel0 = D.relation(a, b);
    ok(s, '撕 赤焰 互不侵犯');
    expect(D.hasTreaty(a, b, 'nonaggression')).toBe(false);
    expect(D.relation(a, b)).toBeLessThan(rel0);
  });

  it('赠：东西从自己的都城到对方的都城', () => {
    const s = small();
    const f0 = stock(s, '鹿鸣城', 'food');
    const g0 = stock(s, '青石城', 'food');
    ok(s, '赠 白鹿 粮100');
    expect(stock(s, '鹿鸣城', 'food')).toBeCloseTo(f0 + 100);
    expect(stock(s, '青石城', 'food')).toBeCloseTo(g0 - 100);
  });

  it('攻打有互不侵犯条约的人 = 背约：条约作废、开战', () => {
    const s = small();
    const { D, P } = api(s);
    const a = P.factionIndex('青龙');
    const b = P.factionIndex('苍狼');
    ok(s, '约 苍狼 互不侵犯');
    ok(s, '应 青龙', lord('苍狼'));
    const broken = record(s, 'treaty.broken');
    ok(s, '攻 @兵:5 苍狼.风口镇');
    s.run(1);
    expect(D.atWar(a, b)).toBe(true);
    expect(D.hasTreaty(a, b, 'nonaggression')).toBe(false);
    expect(broken.length).toBeGreaterThan(0);
  });
});

describe('第 4 阶段 · 军事', () => {
  it('流寇来了：士兵迎战，有人战死', () => {
    const s = small();
    const died = record(s, 'npc.died');
    ok(s, '寇 青石城 30', god);
    s.run(1500);
    expect(died.some((e) => (e.data as { cause: string }).cause === '战死')).toBe(true);
  });

  it('攻城：守军调走后，敌军围城并攻占；领土跟着变', () => {
    const s = small();
    const { P, M } = api(s);
    const t = P.townByName('青石城')!;
    const captured = record(s, 'settlement.captured');
    ok(s, '守 @兵 河口镇');
    ok(s, '攻 @兵 青龙.青石城', lord('苍狼'));
    const cell = (x: number, y: number) => {
      const tr = M.territory();
      const k = 10000 / tr.size;
      return tr.data[Math.floor(y / k) * tr.size + Math.floor(x / k)];
    };
    expect(cell(t.x, t.y)).toBe(P.factionIndex('青龙'));
    for (let d = 0; d < 90 && !captured.length; d++) s.run(100);
    expect(captured.map((e) => (e.data as { town: string }).town)).toContain('青石城');
    expect(t.faction).toBe(P.factionIndex('苍狼'));
    s.run(100);
    expect(cell(t.x, t.y)).toBe(P.factionIndex('苍狼'));
  });
});

describe('第 5 阶段 · 史册 / 起义 / 名人', () => {
  it('民心长期很低 → 起义，冒出新势力，AI 自动给它一个座位', () => {
    const s = small();
    const { P } = api(s);
    const host = new AiHost(s, { enabled: true });
    host.syncSeats();
    const t = P.townByName('河口镇')!;
    const rebelled = record(s, 'settlement.rebelled');
    s.run(99);
    for (let d = 0; d < 12 && !rebelled.length; d++) {
      t.mood = 0;
      t.unrest = Math.max(t.unrest, 7);
      s.run(100);
    }
    expect(rebelled.length).toBe(1);
    const nf = P.factions[t.faction];
    expect(nf.kind).toBe('rebel');
    host.syncSeats();
    expect(host.seats.has(nf.name)).toBe(true);
  });

  it('忠诚很低、野心很大的将军带着驻地自立', () => {
    const s = small();
    const { P } = api(s);
    const N = s.world.get(Notable);
    const gen = P.notables().find((e) => (N.traits[e] as string[])[0] === '将军')!;
    N.loyalty[gen] = 0;
    N.ambition[gen] = 95;
    const defected = record(s, 'notable.defected');
    s.run(101);
    expect(defected.length).toBeGreaterThan(0);
  });

  it('想：心里话只进自己的「想法」，史册里看不到', () => {
    const s = small();
    const { C } = api(s);
    ok(s, '想 赤焰迟早要收拾');
    expect(C.thoughts('青龙').some((t) => t.text.includes('迟早'))).toBe(true);
    expect(C.thoughts('赤焰').some((t) => t.text.includes('迟早'))).toBe(false);
    expect(C.entries('赤焰').some((e) => e.text.includes('迟早'))).toBe(false);
  });
});

describe('第 6 阶段 · 上帝', () => {
  it('灾 旱：地区挂上效果、田不长；到期自动消失', () => {
    const s = small();
    const { W, P } = api(s);
    const r = P.townByName('青石城')!.region;
    ok(s, '灾 旱 青石城 3天', god);
    expect(W.effects(r).length).toBeGreaterThan(0);
    expect(W.regenMul(1, r)).toBeLessThan(1);
    s.run(500);
    expect(W.effects(r).length).toBe(0);
  });

  it('冒名信：收信人看到的署名是被冒充的人，只有上帝知道是假的', () => {
    const s = small();
    const { D, P, C } = api(s);
    ok(s, '冒名 赤焰 白鹿 我军三日后借道', god);
    s.run(1);
    const m = D.inbox(P.factionIndex('白鹿')).find((x) => x.text.includes('借道'))!;
    expect(m.from).toBe('赤焰');
    expect(m.forged).toBe(true);
    expect(C.entries('白鹿').some((e) => e.text.includes('冒'))).toBe(false);
    expect(C.entries('god').some((e) => e.text.includes('借道'))).toBe(true);
  });

  it('赐：东西直接进对方都城', () => {
    const s = small();
    const i0 = stock(s, '鹿鸣城', 'iron');
    ok(s, '赐 白鹿 铁100', god);
    expect(stock(s, '鹿鸣城', 'iron')).toBeCloseTo(i0 + 100);
  });
});

describe('AI 层', () => {
  it('情况简报只给事实和数字，不替 AI 拿主意', () => {
    const s = small();
    s.run(500);
    const text = buildBriefing(s, '青龙', { lastEntry: 0, lastMsg: 0 });
    expect(text.length).toBeGreaterThan(200);
    expect(text).not.toMatch(/应该|必须|立刻|建议|最好|赶紧/);
  });

  it('解析回复：只认命令行，最多 12 行，代码块和闲话都去掉', () => {
    const s = small();
    const reply = ['好的，我的决定如下：', '```', ...Array.from({ length: 20 }, (_, i) => `税 青石城 ${i % 30}`), '```', '这样安排比较稳妥。'].join('\n');
    const { lines, dropped } = extractCommands(s, reply);
    expect(lines.length).toBe(MAX_LINES);
    expect(dropped).toBeGreaterThan(0);
    expect(lines.every((l) => l.startsWith('税 '))).toBe(true);
  });

  it('大模型座位（假的模型）：发简报、执行回复里的命令、记录心里话和结果', async () => {
    const s = small();
    const calls: string[] = [];
    const fake: Provider = {
      name: 'fake',
      async complete(msgs) {
        calls.push(msgs[1].content);
        return '想 先稳住\n税 青石城 6\n乱写一行\n攻 不存在的人 赤焰城';
      },
    };
    const host = new AiHost(s, { provider: fake, llmEvery: 300 });
    for (let i = 0; i < 120; i++) {
      host.step();
      s.tick();
      await host.settle();
    }
    host.step();
    expect(calls.length).toBeGreaterThan(0);
    const log = host.logs('青龙');
    expect(log.length).toBeGreaterThan(0);
    const res = log[0].results;
    expect(res.find((r) => r.line.startsWith('税'))?.ok).toBe(true);
    expect(res.some((r) => !r.ok)).toBe(true);
    expect(api(s).P.townByName('青石城')!.tax).toBe(6);
    expect(api(s).C.thoughts('青龙').some((t) => t.text.includes('稳住'))).toBe(true);
  });

  it('脚本诸侯自己玩 60 天：不崩、会发命令、大多数命令能执行', () => {
    const s = small(3, 1000);
    const host = new AiHost(s);
    for (let i = 0; i < 6000; i++) (host.step(), s.tick());
    let total = 0;
    let good = 0;
    for (const seat of host.seats.values())
      for (const l of seat.log)
        for (const r of l.results) {
          total++;
          if (r.ok) good++;
        }
    expect(total).toBeGreaterThan(50);
    expect(good / total).toBeGreaterThan(0.7);
  });
});
