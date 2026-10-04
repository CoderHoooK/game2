// 玩法规则：世界生成、开局、命令契约（每条命令的例子都要真能跑通）、干活出产、可重现。
import { describe, it, expect, beforeAll } from 'vitest';
import { createGame, MODULES, Notable, type WorldApi, type PopulationApi, type JobsApi, type EconomyApi } from '../src/game';
import type { Sim } from '../src/engine/sim';
import { FACTIONS, FIXED_PLACES, FIXED_PEOPLE } from '../content/factions';
import { PROFESSIONS, START_RATIO } from '../content/professions';
import { legacy } from './helpers';

const lord = (faction = '青龙') => ({ role: 'lord' as const, faction, origin: 'test' as const });
const god = { role: 'god' as const, origin: 'test' as const };
const SETUP = ['编 @兵@青石城:20 一队', '编 @兵@河口镇:10 二队', '编 @兵:5 三队', '编 @商:2 商队'];

let sim: Sim;
let W: WorldApi;
let P: PopulationApi;
let J: JobsApi;
beforeAll(() => {
  sim = createGame({ seed: 1, config: legacy() });
  W = sim.service<WorldApi>('world');
  P = sim.service<PopulationApi>('population');
  J = sim.service<JobsApi>('jobs');
});

describe('世界生成', () => {
  it('10 公里、约 400 个地区，陆地占一半上下', () => {
    expect(W.map.size).toBe(10000);
    expect(W.map.regions.length).toBe(400);
    const land = W.map.regions.filter((r) => r.land).length;
    expect(land).toBeGreaterThan(150);
    expect(land).toBeLessThan(320);
  });
  it('陆地地区名不重复，固定地名都在（海不起名）', () => {
    const names = W.map.regions.filter((r) => r.land).map((r) => r.name);
    expect(names.every((n) => n.length > 0)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
    for (const [n] of FIXED_PLACES) expect(W.place(n), n).toBeTruthy();
  });
  it('每个诸侯两座城镇，都在陆地上、各占一个地区、离得够远', () => {
    expect(P.livingFactions().map((f) => f.name)).toEqual(FACTIONS.map((f) => f.name));
    expect(P.towns.length).toBe(FACTIONS.length * 2);
    for (const f of P.livingFactions()) expect(f.towns.length).toBe(2);
    const regions = new Set<number>();
    for (const t of P.towns) {
      expect(W.isLand(t.x, t.y), t.name).toBe(true);
      expect(regions.has(t.region), t.name).toBe(false);
      regions.add(t.region);
      for (const o of P.towns) if (o !== t) expect(Math.hypot(o.x - t.x, o.y - t.y), `${t.name}-${o.name}`).toBeGreaterThan(600);
      expect(W.place(t.name)?.kind).toBe('town');
    }
  });
  it('资源点：数量够；默认没有田（田要靠农田建筑），设了开局田块数才有', () => {
    expect(W.nodes.count).toBeGreaterThan(1000);
    const fields = (w: WorldApi) => {
      const k = w.kinds.findIndex((x) => x.key === 'field');
      let n = 0;
      for (let i = 0; i < w.nodes.count; i++) if (w.nodes.kind[i] === k) n++;
      return n;
    };
    expect(fields(W)).toBeGreaterThan(18 * 12 * 0.8); // 测试用的开局：每座营地边 18 块
    const scratch = createGame({ seed: 1 });
    expect(fields(scratch.service<WorldApi>('world'))).toBe(0);
    const ps = scratch.service<PopulationApi>('population');
    for (const t of ps.towns) expect(scratch.service<WorldApi>('world').nearestNode('field', t.x, t.y, 400), t.name).toBe(-1);
  });
  it('区块确定、和全图地形大致一致', () => {
    const other = createGame({ seed: 1, config: legacy(0) }).service<WorldApi>('world');
    const t = P.towns[0];
    const cs = W.chunkCells * W.cellSize;
    const cx = Math.floor(t.x / cs);
    const cy = Math.floor(t.y / cs);
    const a = W.chunk(cx, cy);
    expect(Array.from(other.chunk(cx, cy))).toEqual(Array.from(a));
    let same = 0;
    for (let j = 0; j < W.chunkCells; j++)
      for (let i = 0; i < W.chunkCells; i++) {
        const x = cx * cs + (i + 0.5) * W.cellSize;
        const y = cy * cs + (j + 0.5) * W.cellSize;
        if (!W.terrains[a[j * W.chunkCells + i] & 0x0f].water === W.isLand(x, y)) same++; // 低 4 位地形，高 4 位装饰
      }
    expect(same / a.length).toBeGreaterThan(0.85);
  });
  it('换种子换世界', () => {
    const b = createGame({ seed: 2, config: legacy(0) }).service<WorldApi>('world');
    expect(Array.from(b.map.biome.slice(0, 5000))).not.toEqual(Array.from(W.map.biome.slice(0, 5000)));
  });
});

describe('开局', () => {
  it('旧版等价开局：12 座营地各 167 人，每人都挂齐通用模板的组件', () => {
    const npcs = P.npcs().filter((e) => !sim.world.has(e, Notable));
    expect(npcs.length).toBe(167 * 12);
    expect(P.notables().length).toBeGreaterThan(10);
    const comps = Object.keys(J.describe(npcs[0]).components).sort();
    expect(comps).toEqual(['Brain', 'Carry', 'Combat', 'Equipment', 'Identity', 'Lod', 'Membership', 'Motion', 'Profession', 'Transform', 'Vitals']);
  });
  it('职业比例按配置，固定人物都在青龙', () => {
    const counts = J.countByProf();
    const total = counts.reduce((a, b) => a + b, 0);
    const sumRatio = Object.values(START_RATIO).reduce((a, b) => a + b, 0);
    PROFESSIONS.forEach((p, i) => {
      const want = (START_RATIO[p.id] / sumRatio) * total;
      expect(Math.abs(counts[i] - want), p.name).toBeLessThan(total * 0.03);
    });
    for (const name of FIXED_PEOPLE) {
      const e = P.npcs().find((x) => J.describe(x).name === name);
      expect(e, name).toBeDefined();
      expect(J.describe(e!).faction).toBe('青龙');
    }
  });
  it('每人都有长期命令和正在做的事', () => {
    const s = createGame({ seed: 3, config: legacy(300) });
    s.run(20);
    const j = s.service<JobsApi>('jobs');
    for (const e of s.service<PopulationApi>('population').npcs()) {
      const d = j.describe(e);
      expect(d.order, d.name).not.toBeNull();
      expect(d.behavior, d.name).not.toBeNull();
    }
  });
});

describe('命令契约', () => {
  it('每条命令的每个例子都能跑通', () => {
    const s = createGame({ seed: 1, config: legacy() });
    for (const l of SETUP) expect(s.bus.exec(l, lord()).ok, l).toBe(true);
    s.service<PopulationApi>('population').townByName('青石城')!.buildings.talent = 1; // 例子「募 青石城 …」要用
    expect(s.bus.exec('约 青龙 互不侵犯 30天', lord('赤焰')).ok).toBe(true);
    const fails: string[] = [];
    const scratch = createGame({ seed: 1 }); // 「建城」的例子要在有空城址的从零开局里跑
    for (const c of s.bus.list()) {
      for (const ex of c.examples) {
        const src = c.who.includes('lord') ? lord() : god;
        const r = (c.id === 'foundCity' ? scratch : s).bus.exec(ex, src);
        if (!r.ok) fails.push(`${ex} → ${r.msg}`);
      }
    }
    if (fails.length) throw new Error(fails.join('\n'));
  });
  it('每条命令都声明了模块、动词、帮助和例子', () => {
    for (const c of sim.bus.list()) {
      expect(c.module, c.id).toBeTruthy();
      expect(c.help, c.id).toBeTruthy();
      expect(c.examples.length, c.id).toBeGreaterThan(0);
      for (const ex of c.examples) expect(ex.split(' ')[0], ex).toBe(c.verb);
    }
  });
  it('派 = 锁定，放 = 还给比例分配；接不了的跳过并说原因', () => {
    const s = createGame({ seed: 1, config: legacy() });
    const j = s.service<JobsApi>('jobs');
    const npcs = s.service<PopulationApi>('population').npcs();
    const r = s.bus.exec('派 @木:5 伐木 北林', lord());
    expect(r.ok).toBe(true);
    const pinned = () => npcs.filter((e) => j.describe(e).order?.pinned);
    expect(pinned().length).toBe(5);
    expect(pinned().every((e) => j.describe(e).order!.label.includes('北林'))).toBe(true);
    expect(s.bus.exec('放 @木@北林', lord()).ok).toBe(true);
    expect(pinned().length).toBe(0);
    const bad = s.bus.exec('派 @木 种田', lord());
    expect(bad.ok).toBe(false);
    expect(bad.warns?.join('')).toMatch(/伐木工.*农夫/);
  });
  it('诸侯只能指挥自己的人', () => {
    const s = createGame({ seed: 1, config: legacy(600) });
    const r = s.bus.exec('派 @木@赤焰城:3 伐木 北林', lord('青龙'));
    expect(r.ok).toBe(false);
  });
  it('写错了给提示', () => {
    expect(sim.bus.exec('飞 #一队 赤焰城', lord()).msg).toMatch(/不认识的命令/);
    expect(sim.bus.exec('派 @木:5 伐木 火星', lord()).msg).toMatch(/火星/);
    expect(sim.bus.exec('编 @兵:3 三队', god).ok).toBe(false);
  });
  it('时速 0–16', () => {
    expect(sim.bus.exec('时速 4', god).ok).toBe(true);
    expect(sim.clock.speed).toBe(4);
    expect(sim.bus.exec('时速 99', god).ok).toBe(false);
    sim.bus.exec('时速 1', god);
  });
});

describe('干活', () => {
  it('跑十五天后各诸侯主城的粮涨了，木头 + 金也涨了（多余的木头会被商人卖掉换金）', () => {
    const s = createGame({ seed: 1, config: legacy() });
    const eco = s.service<EconomyApi>('economy');
    const pop = s.service<PopulationApi>('population');
    const caps = pop.towns.filter((t) => t.capital);
    const sum = (t: (typeof caps)[number], item: string) => eco.stores[t.store].stock[eco.itemIndex(item)];
    const before = caps.map((t) => [sum(t, 'food'), sum(t, 'wood') + sum(t, 'gold')]);
    s.run(1500);
    caps.forEach((t, i) => {
      expect(sum(t, 'food'), `${t.name} 粮`).toBeGreaterThan(before[i][0]);
      expect(sum(t, 'wood') + sum(t, 'gold'), `${t.name} 木+金`).toBeGreaterThan(before[i][1]);
      expect(sum(t, 'wood'), `${t.name} 木`).toBeGreaterThan(150);
    });
    expect(s.brains.orderCount()).toBeLessThan(200);
  });
});

describe('可重现', () => {
  const play = (seed: number) => {
    const s = createGame({ seed, config: legacy(800) });
    s.run(50);
    for (const l of [...SETUP, '派 @木:5 伐木 北林', '巡 @兵:6 北林', '探 @斥:2 东山']) s.bus.submit(l, lord());
    s.run(400);
    return s.hash();
  };
  it('同一个种子 + 同样的命令 = 同样的结果', () => expect(play(5)).toBe(play(5)));
  it('换种子结果不同', () => expect(play(5)).not.toBe(play(6)));
});

describe('模块清单', () => {
  it('每个模块都有中文名，依赖都在清单里', () => {
    const ids = new Set(MODULES.map((m) => m.id));
    for (const m of MODULES) {
      expect(m.name, m.id).toMatch(/[\u4e00-\u9fa5]/);
      for (const r of m.requires || []) expect(ids.has(r), `${m.id} → ${r}`).toBe(true);
    }
  });
});
