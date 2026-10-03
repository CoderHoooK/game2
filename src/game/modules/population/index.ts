// 人口模块：势力、城镇、NPC 通用模板（出生时挂齐所有基础组件）。
// 第 1 阶段加：吃饭、民心、增长、迁移；名人（Notable）在第 4 阶段。
import type { GameModule } from '../../../engine/module';
import type { Sim } from '../../../engine/sim';
import { defineComponent } from '../../../engine/ecs';
import { Transform, Motion, Lod } from '../../../engine/motion';
import { Brain, Membership } from '../../../engine/brain';
import { Rng } from '../../../shared/rng';
import type { Entity } from '../../../shared/types';
import { Carry, type EconomyApi } from '../economy';
import { T, type WorldApi } from '../world';
import { FACTIONS, FIXED_PLACES, SURNAMES, GIVEN, FIXED_PEOPLE } from '../../../../content/factions';

export const Identity = defineComponent('Identity', '身份', { name: 'obj', faction: 'u8', home: 'u16' }, { name: '名字', faction: '势力', home: '所属城镇' });
export const Vitals = defineComponent('Vitals', '血量', { hp: 'f32', maxHp: 'f32' }, { hp: '当前', maxHp: '上限' });

export interface Town {
  id: number;
  name: string;
  faction: number;
  capital: boolean;
  x: number;
  y: number;
  region: number;
  store: number;
  /** 城的半径（米） */
  radius: number;
}
export interface Faction {
  index: number;
  name: string;
  color: string;
  towns: number[];
}

export interface PopulationApi {
  factions: Faction[];
  towns: Town[];
  factionIndex(name: string): number;
  townByName(name: string): Town | undefined;
  nearestTown(faction: number, x: number, y: number): Town | undefined;
  /** NPC 通用模板：挂齐所有基础组件（职业由 jobs 模块挂） */
  spawn(town: Town, name?: string): Entity;
  npcs(): Entity[];
}

const TOWN_RADIUS = 45;

export const population: GameModule = {
  id: 'population',
  name: '人口',
  requires: ['world', 'economy'],
  components: [Identity, Vitals],
  config: {
    npcs: { default: 2000, text: '开局 NPC 总数', min: 0, max: 60000 },
  },
  views: [{ id: 'settlements', text: '城镇（位置、势力、库存）' }],
  events: [{ id: 'npc.born', module: 'population', text: '有人出生（开局生成的不算）' }],
  argTypes: [
    {
      id: 'town',
      name: '己方城镇',
      parse(tok, { sim, src }) {
        const pop = sim.service<PopulationApi>('population');
        const t = pop.townByName(tok);
        const mine = src.role === 'god' ? pop.towns : pop.towns.filter((x) => pop.factions[x.faction].name === src.faction);
        if (t && mine.includes(t)) return { ok: true, value: t };
        return { ok: false, error: t ? `「${tok}」不是你的城镇` : `没有叫「${tok}」的城镇`, hint: `你的城镇：${mine.map((x) => x.name).join('、')}` };
      },
      choices: ({ sim }) => sim.service<PopulationApi>('population').towns.map((t) => t.name),
    },
    {
      id: 'faction',
      name: '势力',
      parse(tok, { sim }) {
        const pop = sim.service<PopulationApi>('population');
        const i = pop.factionIndex(tok);
        return i >= 0 ? { ok: true, value: pop.factions[i] } : { ok: false, error: `没有叫「${tok}」的势力`, hint: pop.factions.map((f) => f.name).join('、') };
      },
      choices: ({ sim }) => sim.service<PopulationApi>('population').factions.map((f) => f.name),
    },
  ],
  install(api) {
    const sim: Sim = api.sim;
    const world = api.use<WorldApi>('world');
    const eco = api.use<EconomyApi>('economy');
    const map = world.map;
    const rng = new Rng(sim.seed ^ 0x70e1);
    const d = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

    // ---- 选城址：都城尽量互相远离，副城在都城 1.3–2.8 公里外
    const land = map.regions.filter((r) => r.land);
    const inland = (r: (typeof land)[number]) => r.neighbors.filter((n) => map.regions[n].land).length >= 4 && r.area > 300;
    let cands = land.filter((r) => r.terrain === T.plains && inland(r));
    if (cands.length < FACTIONS.length * 2) cands = land.filter(inland);
    if (cands.length < FACTIONS.length * 2) cands = land;
    const chosen: (typeof land)[number][] = [];
    const sx = rng.range(0.3, 0.7) * map.size;
    const sy = rng.range(0.3, 0.7) * map.size;
    chosen.push(cands.reduce((a, b) => (d(a.cx, a.cy, sx, sy) <= d(b.cx, b.cy, sx, sy) ? a : b)));
    while (chosen.length < FACTIONS.length) {
      let best = cands[0];
      let bd = -1;
      for (const c of cands) {
        if (chosen.includes(c)) continue;
        const md = Math.min(...chosen.map((o) => d(o.cx, o.cy, c.cx, c.cy)));
        if (md > bd) ((bd = md), (best = c));
      }
      chosen.push(best);
    }
    const capitals = [...chosen];
    const seconds: typeof chosen = [];
    for (const cap of capitals) {
      const pick = (minD: number, maxD: number, sep: number) =>
        land
          .filter((r) => !chosen.includes(r) && r.terrain !== T.mountain && r.terrain !== T.swamp)
          .map((r) => ({ r, dd: d(r.cx, r.cy, cap.cx, cap.cy) }))
          .filter(({ r, dd }) => dd >= minD && dd <= maxD && chosen.every((o) => d(o.cx, o.cy, r.cx, r.cy) >= sep))
          .sort((a, b) => Math.abs(a.dd - 1800) - Math.abs(b.dd - 1800) || a.r.id - b.r.id)[0]?.r;
      const r = pick(1300, 2800, 1500) ?? pick(900, 3600, 1100) ?? pick(500, 5000, 600);
      if (!r) throw new Error('地图上放不下副城');
      seconds.push(r);
      chosen.push(r);
    }

    const factions: Faction[] = FACTIONS.map((f, i) => ({ index: i, name: f.name, color: f.color, towns: [] }));
    const towns: Town[] = [];
    FACTIONS.forEach((f, i) => {
      [capitals[i], seconds[i]].forEach((r, k) => {
        const t: Town = { id: towns.length, name: f.towns[k], faction: i, capital: k === 0, x: r.cx, y: r.cy, region: r.id, store: 0, radius: TOWN_RADIUS };
        t.store = eco.addStore(t.name, t.x, t.y, t.radius);
        towns.push(t);
        factions[i].towns.push(t.id);
        world.addPlace({ name: t.name, kind: 'town', id: t.id, x: t.x, y: t.y, region: r.id, faction: f.name });
      });
    });

    // ---- 城边的田；附近没树林的给几片小树林（每座城都缺点什么，但不至于没柴烧）
    for (const t of towns) {
      for (let k = 0; k < 18; k++) {
        const a = (k / 18) * Math.PI * 2 + rng.range(-0.15, 0.15);
        const r = rng.range(70, 200);
        const x = t.x + Math.cos(a) * r;
        const y = t.y + Math.sin(a) * r;
        if (world.isLand(x, y)) world.addNode('field', x, y);
      }
      if (world.nearestNode('wood', t.x, t.y, 1200) < 0) {
        for (let k = 0; k < 5; k++) {
          const [x, y] = world.landPointNear(t.x, t.y, 650, rng);
          if (Math.hypot(x - t.x, y - t.y) > 250) world.addNode('wood', x, y);
        }
      }
    }

    // ---- 青石城周边的固定地名（命令例子里用）
    {
      const home = towns[0];
      const taken = new Set(towns.map((t) => t.region));
      for (const [name, want, angle] of FIXED_PLACES) {
        let best = -1;
        let bs = Infinity;
        for (const r of land) {
          if (taken.has(r.id)) continue;
          const dd = d(r.cx, r.cy, home.x, home.y);
          if (dd < 450 || dd > 3000) continue;
          const a = (Math.atan2(r.cy - home.y, r.cx - home.x) * 180) / Math.PI;
          const da = Math.abs((((a - angle) % 360) + 540) % 360 - 180);
          const key = world.terrains[r.terrain].key;
          const s = da * 3 + (want.includes(key) ? 0 : 150) + dd / 40;
          if (s < bs) ((bs = s), (best = r.id));
        }
        if (best >= 0) {
          taken.add(best);
          world.renameRegion(best, name);
        }
      }
    }

    // ---- NPC
    const I = sim.world.get(Identity);
    const V = sim.world.get(Vitals);
    const all: Entity[] = [];
    const spawn = (t: Town, name?: string): Entity => {
      const e = sim.world.create();
      const [x, y] = world.landPointNear(t.x, t.y, t.radius, rng);
      sim.world.add(e, Identity, { faction: t.faction, home: t.id });
      I.name[e] = name ?? rng.pick(SURNAMES) + rng.pick(GIVEN) + (rng.chance(0.6) ? rng.pick(GIVEN) : '');
      sim.world.add(e, Transform, { x, y, region: world.regionAt(x, y) });
      sim.world.add(e, Motion, { speed: 8 });
      sim.world.add(e, Vitals, { hp: 100, maxHp: 100 });
      sim.world.add(e, Carry, { cap: 10 });
      sim.world.add(e, Brain, { target: -1 });
      sim.world.add(e, Membership);
      sim.world.add(e, Lod);
      V.hp[e] = 100;
      all.push(e);
      return e;
    };
    const total = api.config.npcs as number;
    const weights = towns.map((t) => (t.capital ? 3 : 2));
    const wsum = weights.reduce((a, b) => a + b, 0);
    const counts = weights.map((w) => Math.floor((total * w) / wsum));
    for (let i = 0; counts.reduce((a, b) => a + b, 0) < total; i++) counts[i % towns.length]++;
    const fixed = [...FIXED_PEOPLE];
    towns.forEach((t, i) => {
      for (let k = 0; k < counts[i]; k++) spawn(t, t.id === 0 ? fixed.shift() : undefined);
    });

    const townNames = new Map(towns.map((t) => [t.name, t]));
    api.expose<PopulationApi>({
      factions,
      towns,
      factionIndex: (name) => factions.findIndex((f) => f.name === name),
      townByName: (name) => townNames.get(name),
      nearestTown(faction, x, y) {
        let best: Town | undefined;
        let bd = Infinity;
        for (const id of factions[faction]?.towns || []) {
          const t = towns[id];
          const dd = (t.x - x) ** 2 + (t.y - y) ** 2;
          if (dd < bd) ((bd = dd), (best = t));
        }
        return best;
      },
      spawn(t, name) {
        const e = spawn(t, name);
        sim.events.emit('npc.born', sim.clock.tick, { e, town: t.name }, factions[t.faction].name);
        return e;
      },
      npcs: () => all.filter((e) => sim.world.alive[e]),
    });
  },
};
