// 人口模块：势力、城镇、NPC 通用模板（出生时挂齐所有基础组件）；
// 每天：吃饭（不够就饿，饿久了掉血、饿死）→ 民心（税、吃饱没有、开仓）→ 收税 → 生孩子 → 迁移（民心太低往别处跑）；
// 名人（忠诚 / 野心）：可以被招揽；忠诚太低、野心太大的将军会自立；民心长期太低的城会起义（第 6 阶段：世界一直演化）。
import type { GameModule } from '../../../engine/module';
import type { Sim } from '../../../engine/sim';
import { defineComponent } from '../../../engine/ecs';
import { Transform, Motion, Lod } from '../../../engine/motion';
import { Brain, Membership } from '../../../engine/brain';
import type { CommandDef } from '../../../engine/commands/types';
import { Rng } from '../../../shared/rng';
import type { Entity } from '../../../shared/types';
import { Carry, type EconomyApi } from '../economy';
import { T, type WorldApi } from '../world';
import { FACTIONS, FIXED_PLACES, SURNAMES, GIVEN, FIXED_PEOPLE, START_DEFAULTS, NOTABLES, BANDITS, REBEL_COLORS } from '../../../../content/factions';
import { FOOD_PER_DAY, PROFESSIONS } from '../../../../content/professions';

export const Identity = defineComponent('Identity', '身份', { name: 'obj', faction: 'u8', home: 'u16' }, { name: '名字', faction: '势力', home: '所属城镇' });
export const Vitals = defineComponent('Vitals', '血量', { hp: 'f32', maxHp: 'f32', hunger: 'f32' }, { hp: '当前', maxHp: '上限', hunger: '饿了几天（吃饱了慢慢恢复；2 天起掉血）' });
export const Notable = defineComponent('Notable', '名人', { traits: 'obj', loyalty: 'f32', ambition: 'f32' }, { traits: '称号和性格，如 将军·勇', loyalty: '忠诚 0–100（低了可能被策反或自立）', ambition: '野心 0–100' });

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
  /** 民心 0–100 */
  mood: number;
  /** 税率 % */
  tax: number;
  /** 人口上限（房屋会加） */
  cap: number;
  /** 城墙层数 */
  walls: number;
  /** 已建成的建筑：建筑 ID → 座数 */
  buildings: Record<string, number>;
  /** 昨天吃饱的比例 0–1 */
  fed: number;
  /** 开仓的余温（每天衰减） */
  relief: number;
  /** 民心连续很低的天数（起义倒计时） */
  unrest: number;
  /** 人口（每天结算时更新） */
  pop: number;
  /** false = 空城址：还没人建城，不属于任何势力、没有人、不参与结算（用「建城」占下才算数） */
  founded: boolean;
}
export type FactionKind = 'lord' | 'rebel' | 'bandit' | 'free';
export interface Faction {
  index: number;
  name: string;
  color: string;
  towns: number[];
  kind: FactionKind;
  alive: boolean;
  /** 声望（守约、仁政加；背约、屠城减） */
  reputation: number;
  /** 从哪个势力分裂出来（起义 / 叛将） */
  from?: string;
}

export interface PopulationApi {
  factions: Faction[];
  towns: Town[];
  factionIndex(name: string): number;
  townByName(name: string): Town | undefined;
  nearestTown(faction: number, x: number, y: number): Town | undefined;
  /** NPC 通用模板：挂齐所有基础组件（职业由 jobs 模块通过 onSpawn 挂） */
  spawn(town: Town, name?: string, faction?: number, at?: [number, number]): Entity;
  npcs(): Entity[];
  residents(town: number): Entity[];
  kill(e: Entity, cause: string, by?: number): void;
  /** 城镇换主（攻占、起义）：城里的人跟着换 */
  setTownFaction(town: Town, faction: number, why: string): void;
  addFaction(name: string, kind: FactionKind, from?: string): Faction;
  /** 一个人换城（迁移、被招揽） */
  rehome(e: Entity, town: Town): void;
  notables(): Entity[];
  notableTitle(e: Entity): string;
  banditFaction(): number;
  freeFaction(): number;
  /** 别的模块挂钩：新人出生、换城时（jobs 用它分职业、改平时命令） */
  onSpawn: ((e: Entity) => void)[];
  onRehome: ((e: Entity) => void)[];
  /** 每人每天吃多少粮（jobs 按职业提供） */
  upkeepOf: (e: Entity) => number;
  livingFactions(kind?: FactionKind): Faction[];
  /** 开局每个营地各职业的人数（职业 ID → 人数）；jobs 开局时照这个分职业 */
  startCounts: Record<string, number>;
  /** 空城址建成城：归 faction，人口上限 = 营地上限，仓库空，没有人（要靠人才市场招） */
  found(town: Town, faction: number): void;
}

const TOWN_RADIUS = 45;
const MAX_FACTIONS = 24;

export const population: GameModule = {
  id: 'population',
  name: '人口与开局',
  requires: ['world', 'economy'],
  components: [Identity, Vitals, Notable],
  config: {
    camps: { default: 1, text: '每个诸侯开局有几座营地（1–2；其余城址空着，要「建城」才算数）', min: 1, max: 2 },
    startGold: { default: START_DEFAULTS.gold, text: '开局资金（金，每个诸侯）', min: 0, max: 1e6 },
    startFood: { default: START_DEFAULTS.food, text: '开局粮食', min: 0, max: 1e6 },
    startWood: { default: START_DEFAULTS.wood, text: '开局木材（建第一座房子、农田要用）', min: 0, max: 1e6 },
    startStone: { default: START_DEFAULTS.stone, text: '开局石料', min: 0, max: 1e6 },
    startIron: { default: START_DEFAULTS.iron, text: '开局铁', min: 0, max: 1e6 },
    startWeapon: { default: START_DEFAULTS.weapon, text: '开局兵器', min: 0, max: 1e6 },
    ...Object.fromEntries(
      PROFESSIONS.map((p) => [`start${p.id[0].toUpperCase()}${p.id.slice(1)}`, { default: START_DEFAULTS.people[p.id] ?? 0, text: `开局${p.name}人数（每座营地）`, min: 0, max: 5000 }]),
    ),
    startFields: { default: 0, text: '开局营地边的田块数（0 = 没有，田要靠「农田」建筑，每座 +6 块）', min: 0, max: 200 },
    campCap: { default: START_DEFAULTS.campCap, text: '营地人口上限（不低于开局人数；每座房屋 +30）', min: 1, max: 100000 },
    lordNotables: { default: 0, text: '开局每个诸侯带将军和谋士（0 = 不带；在野名人不受影响）', min: 0, max: 1 },
    growth: { default: 0, text: '吃饱、民心好时每天的自然出生率（0 = 关闭，人口只能靠人才市场招；原版 0.004）', min: 0, max: 0.1 },
  },
  views: [{ id: 'settlements', text: '城镇（位置、势力、库存、民心）' }],
  events: [
    { id: 'npc.born', module: 'population', text: '有人出生（开局生成的不算）' },
    { id: 'npc.died', module: 'population', text: '有人死了（饿死、战死、病死）' },
    { id: 'npc.migrated', module: 'population', text: '有人迁走（民心低、饿肚子；可能投奔别的势力）' },
    { id: 'settlement.starving', module: 'population', text: '城里断粮' },
    { id: 'settlement.rebelled', module: 'population', text: '城镇起义，自立为新势力' },
    { id: 'notable.defected', module: 'population', text: '名人改换门庭（被招揽、自立）' },
    { id: 'faction.founded', module: 'population', text: '新势力出现（起义、叛将自立）' },
    { id: 'faction.eliminated', module: 'population', text: '势力灭亡（城镇全丢）' },
  ],
  argTypes: [
    {
      id: 'town',
      name: '己方城镇',
      parse(tok, { sim, src }) {
        const pop = sim.service<PopulationApi>('population');
        const t = pop.townByName(tok);
        const mine = src.role === 'god' ? pop.towns : pop.towns.filter((x) => pop.factions[x.faction].name === src.faction);
        if (t && mine.includes(t)) return { ok: true, value: t };
        return { ok: false, error: t ? `「${tok}」不是你的城镇` : `没有叫「${tok}」的城镇`, hint: `你的城镇：${mine.map((x) => x.name).join('、') || '（没有了）'}` };
      },
      choices: ({ sim }) => sim.service<PopulationApi>('population').towns.map((t) => t.name),
    },
    {
      id: 'faction',
      name: '势力',
      parse(tok, { sim }) {
        const pop = sim.service<PopulationApi>('population');
        const i = pop.factionIndex(tok);
        const f = pop.factions[i];
        if (f && f.alive && (f.kind === 'lord' || f.kind === 'rebel')) return { ok: true, value: f };
        return { ok: false, error: f ? `「${tok}」已经灭亡了` : `没有叫「${tok}」的势力`, hint: pop.livingFactions().map((x) => x.name).join('、') };
      },
      choices: ({ sim }) => sim.service<PopulationApi>('population').livingFactions().map((f) => f.name),
    },
    {
      id: 'notable',
      name: '名人',
      parse(tok, { sim }) {
        const pop = sim.service<PopulationApi>('population');
        const I = sim.world.get(Identity);
        const e = pop.notables().find((x) => I.name[x] === tok);
        return e !== undefined ? { ok: true, value: e } : { ok: false, error: `没有叫「${tok}」的名人`, hint: pop.notables().map((x) => I.name[x] as string).join('、') };
      },
      choices: ({ sim }) => {
        const I = sim.world.get(Identity);
        return sim.service<PopulationApi>('population').notables().map((x) => I.name[x] as string);
      },
    },
  ],
  hash(sim, mix) {
    const pop = sim.service<PopulationApi>('population');
    for (const t of pop.towns) (mix(t.faction), mix(Math.round(t.mood * 100)), mix(t.tax), mix(t.cap), mix(t.unrest), mix(t.founded ? 1 : 0));
    for (const f of pop.factions) (mix(f.alive ? 1 : 0), mix(Math.round(f.reputation)));
  },
  save: {
    // 2：城镇有 founded（从零开始版）。旧版（1）的世界是 12 座现成的城 + 2000 人，读不了
    version: 2,
    save: (sim) => sim.service<PopulationApi & { _state(): unknown }>('population')._state(),
    load: (sim, d, version) => {
      if (version < 2) throw new Error('存档是旧版本（开局就有 12 座城、2000 人），现在的「从零开始」读不了，请清空存档');
      sim.service<PopulationApi & { _load(d: unknown): void }>('population')._load(d);
    },
  },
  install(api) {
    const sim: Sim = api.sim;
    const world = api.use<WorldApi>('world');
    const eco = api.use<EconomyApi>('economy');
    const map = world.map;
    const rng = new Rng(sim.seed ^ 0x70e1);
    const growth = api.config.growth as number;
    const d = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);
    const newTown = (id: number, name: string, faction: number, capital: boolean, x: number, y: number, region: number, store: number): Town => ({
      id, name, faction, capital, x, y, region, store, radius: TOWN_RADIUS, mood: 60, tax: 10, cap: 0, walls: 0, buildings: {}, fed: 1, relief: 0, unrest: 0, pop: 0, founded: true,
    });

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

    const factions: Faction[] = FACTIONS.map((f, i) => ({ index: i, name: f.name, color: f.color, towns: [], kind: 'lord' as FactionKind, alive: true, reputation: 50 }));
    // ---- 特殊势力：在野（名人、空城址）、流寇（上帝召唤）
    factions.push({ index: factions.length, name: '在野', color: '#78716c', towns: [], kind: 'free', alive: true, reputation: 0 });
    factions.push({ index: factions.length, name: BANDITS.name, color: BANDITS.color, towns: [], kind: 'bandit', alive: true, reputation: -100 });
    const FREE = factions.length - 2;
    const BANDIT = factions.length - 1;
    const camps = api.config.camps as number;
    const towns: Town[] = [];
    FACTIONS.forEach((f, i) => {
      [capitals[i], seconds[i]].forEach((r, k) => {
        // 前 camps 座是开局的营地；其余是空城址（无主，要「建城」）
        const founded = k < camps;
        const t: Town = newTown(towns.length, f.towns[k], founded ? i : FREE, founded && k === 0, r.cx, r.cy, r.id, 0);
        t.founded = founded;
        t.store = eco.addStore(t.name, t.x, t.y, t.radius);
        towns.push(t);
        if (founded) factions[i].towns.push(t.id);
        world.addPlace({ name: t.name, kind: 'town', id: t.id, x: t.x, y: t.y, region: r.id, faction: founded ? f.name : factions[FREE].name });
      });
    });

    // ---- 营地边的田（默认 0：田要靠「农田」建筑）；附近没树林的给几片小树林（每座城都缺点什么，但不至于没柴烧）
    const fieldsN = api.config.startFields as number;
    for (const t of towns) {
      for (let k = 0; t.founded && k < fieldsN; k++) {
        const a = (k / fieldsN) * Math.PI * 2 + rng.range(-0.15, 0.15);
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

    // ---- 开局物资：每座营地一份（空城址什么都没有）
    const startStock: [string, number][] = [
      ['gold', api.config.startGold as number],
      ['food', api.config.startFood as number],
      ['wood', api.config.startWood as number],
      ['stone', api.config.startStone as number],
      ['iron', api.config.startIron as number],
      ['weapon', api.config.startWeapon as number],
    ];
    for (const t of towns) if (t.founded) eco.give(t.store, startStock.filter(([, n]) => n > 0));

    // ---- NPC
    const W = sim.world;
    const I = W.get(Identity);
    const V = W.get(Vitals);
    const N = W.get(Notable);
    const P = W.get(Transform);
    let list: Entity[] = [];
    let dirty = true;
    const npcs = () => {
      if (dirty) {
        list = [];
        for (let e = 0; e < W.hw; e++) if (I.has[e]) list.push(e);
        dirty = false;
      }
      return list;
    };
    const onSpawn: ((e: Entity) => void)[] = [];
    const onRehome: ((e: Entity) => void)[] = [];
    const spawn = (t: Town, name?: string, faction = t.faction, at?: [number, number]): Entity => {
      const e = W.create();
      const [x, y] = world.landPointNear(at ? at[0] : t.x, at ? at[1] : t.y, at ? 40 : t.radius, rng);
      W.add(e, Identity, { faction, home: t.id });
      I.name[e] = name ?? rng.pick(SURNAMES) + rng.pick(GIVEN) + (rng.chance(0.6) ? rng.pick(GIVEN) : '');
      W.add(e, Transform, { x, y, region: world.regionAt(x, y) });
      W.add(e, Motion, { speed: 8 });
      W.add(e, Vitals, { hp: 100, maxHp: 100 });
      W.add(e, Carry, { cap: 10 });
      W.add(e, Brain, { target: -1 });
      W.add(e, Membership);
      W.add(e, Lod);
      dirty = true;
      return e;
    };
    // 开局每座营地的人：按职业人数生成（职业由 jobs 在开局时按 startCounts 分）
    const startCounts: Record<string, number> = {};
    for (const p of PROFESSIONS) startCounts[p.id] = api.config[`start${p.id[0].toUpperCase()}${p.id.slice(1)}`] as number;
    const perCamp = Object.values(startCounts).reduce((a, b) => a + b, 0);
    const fixed = [...FIXED_PEOPLE];
    for (const t of towns) {
      if (!t.founded) continue;
      for (let k = 0; k < perCamp; k++) spawn(t, t.id === 0 ? fixed.shift() : undefined);
      t.cap = Math.max(api.config.campCap as number, perCamp);
      t.pop = perCamp;
    }
    // 名人：诸侯的将军谋士在都城出生（默认不带）；在野的在地图上某座已建的城附近游荡
    const titles = new Map<Entity, string>();
    const factionIndex = (name: string) => factions.findIndex((f) => f.name === name);
    const foundedTowns = towns.filter((t) => t.founded);
    for (const n of NOTABLES) {
      if (n.faction && !api.config.lordNotables) continue;
      const fi = n.faction ? factionIndex(n.faction) : FREE;
      if (fi < 0) continue;
      const home = n.faction ? towns[factions[fi].towns[0]] : foundedTowns[rng.int(foundedTowns.length)];
      const e = spawn(home, n.name, fi);
      W.add(e, Notable, { loyalty: n.loyalty, ambition: n.ambition });
      N.traits[e] = [n.title, ...n.traits];
      titles.set(e, n.title);
    }

    const residents = (town: number) => npcs().filter((e) => I.home[e] === town && factions[I.faction[e]].kind !== 'free' && factions[I.faction[e]].kind !== 'bandit');
    const kill = (e: Entity, cause: string, by?: number) => {
      if (!W.alive[e]) return;
      const info = { e, name: I.name[e], faction: factions[I.faction[e]]?.name, town: towns[I.home[e]]?.name, cause, by: by === undefined ? undefined : factions[by]?.name, notable: N.has[e] ? titles.get(e) : undefined };
      W.destroy(e);
      titles.delete(e);
      dirty = true;
      sim.events.emit('npc.died', sim.clock.tick, info, info.faction);
    };
    const addFaction = (name: string, kind: FactionKind, from?: string): Faction => {
      const living = factions.filter((f) => f.kind === 'lord' || f.kind === 'rebel');
      if (factions.length >= MAX_FACTIONS) {
        // 名额满了：重用一个已灭亡的
        const dead = factions.find((f) => !f.alive && (f.kind === 'lord' || f.kind === 'rebel'));
        if (dead) {
          Object.assign(dead, { name, kind, alive: true, reputation: 0, from, towns: [] });
          return dead;
        }
      }
      let nm = name;
      for (let k = 2; factions.some((f) => f.name === nm); k++) nm = name + k;
      const f: Faction = { index: factions.length, name: nm, color: REBEL_COLORS[living.length % REBEL_COLORS.length], towns: [], kind, alive: true, reputation: 0, from };
      factions.push(f);
      sim.events.emit('faction.founded', sim.clock.tick, { name: nm, from, kind });
      return f;
    };
    const checkAlive = (f: Faction) => {
      if (!f.alive || f.kind === 'bandit' || f.kind === 'free') return;
      if (f.towns.length > 0) return;
      f.alive = false;
      // 散兵游勇落草为寇
      for (const e of npcs()) if (I.faction[e] === f.index) I.faction[e] = BANDIT;
      sim.events.emit('faction.eliminated', sim.clock.tick, { name: f.name });
    };
    const setTownFaction = (t: Town, fi: number, why: string) => {
      const old = factions[t.faction];
      if (old.index === fi) return;
      old.towns = old.towns.filter((x) => x !== t.id);
      factions[fi].towns.push(t.id);
      factions[fi].towns.sort((a, b) => a - b);
      t.faction = fi;
      t.capital = factions[fi].towns[0] === t.id;
      if (old.towns.length) towns[old.towns[0]].capital = true;
      const pl = world.place(t.name);
      if (pl) pl.faction = factions[fi].name;
      for (const e of residents(t.id)) if (I.faction[e] === old.index) (I.faction[e] = fi), onRehome.forEach((f) => f(e));
      t.mood = Math.max(10, t.mood - 20);
      t.unrest = 0;
      void why;
      checkAlive(old);
    };
    const rehome = (e: Entity, t: Town) => {
      I.home[e] = t.id;
      I.faction[e] = t.faction;
      onRehome.forEach((f) => f(e));
    };

    // ---- 每天结算
    const pa: PopulationApi = {
      factions,
      towns,
      factionIndex,
      townByName: (name) => towns.find((t) => t.name === name),
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
      spawn(t, name, faction, at) {
        const e = spawn(t, name, faction, at);
        onSpawn.forEach((f) => f(e));
        if (faction === undefined || faction === t.faction) sim.events.emit('npc.born', sim.clock.tick, { e, town: t.name }, factions[t.faction].name);
        return e;
      },
      npcs,
      residents,
      kill,
      setTownFaction,
      addFaction,
      rehome,
      notables: () => npcs().filter((e) => N.has[e]),
      notableTitle: (e) => titles.get(e) ?? '',
      banditFaction: () => BANDIT,
      freeFaction: () => FREE,
      onSpawn,
      onRehome,
      upkeepOf: () => FOOD_PER_DAY,
      startCounts,
      found(t, fi) {
        if (t.founded) return;
        const prevCapital = factions[fi].towns.find((id) => towns[id].capital);
        t.founded = true;
        setTownFaction(t, fi, '建城');
        // 都城不因为新城的编号小而换人
        if (prevCapital !== undefined) for (const id of factions[fi].towns) towns[id].capital = id === prevCapital;
        else t.capital = true;
        Object.assign(t, { cap: api.config.campCap as number, mood: 60, unrest: 0, fed: 1, relief: 0, pop: 0, buildings: {}, walls: 0 });
        dirty = true;
      },
      livingFactions: (kind) => factions.filter((f) => f.alive && (kind ? f.kind === kind : f.kind === 'lord' || f.kind === 'rebel')),
    };
    const food = eco.itemIndex('food');
    const gold = eco.itemIndex('gold');
    const births = new Map<number, number>();
    sim.scheduler.add(
      {
        id: 'population.daily',
        phase: 'population',
        every: 100,
        run() {
          const tick = sim.clock.tick;
          if (tick === 0) return;
          const byTown = new Map<number, Entity[]>();
          for (const e of npcs()) {
            const k = factions[I.faction[e]].kind;
            if (k === 'free' || k === 'bandit') continue;
            if (!byTown.has(I.home[e])) byTown.set(I.home[e], []);
            byTown.get(I.home[e])!.push(e);
          }
          for (const t of towns) {
            if (!t.founded) continue; // 空城址
            const res = byTown.get(t.id) || [];
            t.pop = res.length;
            const st = eco.stores[t.store].stock;
            // 吃饭
            let need = 0;
            for (const e of res) need += pa.upkeepOf(e);
            const eat = Math.min(need, st[food]);
            st[food] -= eat;
            t.fed = need > 0 ? eat / need : 1;
            // 库存告急：吃完这顿剩下的粮刚跌破 5 天（无状态判断，存档读档不会重复报）
            if (need > 0 && t.fed >= 0.999 && st[food] < need * 5 && st[food] + eat >= need * 5)
              sim.events.emit('stock.low', tick, { town: t.name, item: '粮食', days: Math.floor(st[food] / need) }, factions[t.faction].name);
            if (t.fed < 0.999 && res.length) sim.events.emit('settlement.starving', tick, { town: t.name, fed: Math.round(t.fed * 100) }, factions[t.faction].name);
            const starving: Entity[] = [];
            for (const e of res) {
              V.hunger[e] = t.fed >= 0.999 ? Math.max(0, V.hunger[e] - 1) : V.hunger[e] + (1 - t.fed);
              if (V.hunger[e] >= 2) {
                V.hp[e] -= 8 * V.hunger[e];
                if (V.hp[e] <= 0) starving.push(e);
              } else if (V.hp[e] < V.maxHp[e]) V.hp[e] = Math.min(V.maxHp[e], V.hp[e] + 5);
            }
            for (const e of starving) kill(e, '饿死');
            // 民心：吃饱 + 低税 + 开仓 + 城墙安全感
            const target = 55 + 10 * (t.fed - 0.5) * 2 - (t.tax - 10) * 1.5 + t.relief + t.walls * 3 - (t.fed < 0.5 ? 25 : 0);
            t.mood += (Math.max(0, Math.min(100, target)) - t.mood) * 0.12;
            t.relief *= 0.9;
            // 收税（市场加成）
            st[gold] += res.length * t.tax * 0.02 * (1 + (t.buildings.market ?? 0) * 0.5);
            // 生孩子
            if (t.fed >= 0.999 && st[food] > res.length * 2 && t.mood > 40 && res.length < t.cap && res.length > 0) {
              const acc = (births.get(t.id) ?? 0) + res.length * growth * (t.mood / 60);
              const n = Math.min(Math.floor(acc), t.cap - res.length);
              births.set(t.id, acc - n);
              for (let k = 0; k < n; k++) pa.spawn(t);
            }
            // 迁移：民心太低就跑（先找自家别的城，没有就投奔别人）
            if (t.mood < 25 && res.length > 5) {
              const n = Math.max(1, Math.floor(res.length * 0.02));
              const mine = factions[t.faction].towns.map((i) => towns[i]).filter((o) => o !== t && o.mood > t.mood + 15);
              const others = towns.filter((o) => o.founded && o.faction !== t.faction && o.mood > 50 && factions[o.faction].alive);
              const dest = (mine.length ? mine : others).sort((a, b) => d(a.x, a.y, t.x, t.y) - d(b.x, b.y, t.x, t.y))[0];
              if (dest) {
                const movers = rng.shuffle(res.filter((e) => !N.has[e])).slice(0, n);
                for (const e of movers) rehome(e, dest);
                sim.events.emit('npc.migrated', tick, { from: t.name, to: dest.name, n: movers.length, defect: dest.faction !== t.faction }, factions[t.faction].name);
              }
            }
            // 起义：民心连续 8 天低于 12（不是唯一一座城）
            t.unrest = t.mood < 12 ? t.unrest + 1 : 0;
            if (t.unrest >= 8 && factions[t.faction].towns.length > 1) {
              const old = factions[t.faction].name;
              const f = addFaction(t.name.slice(0, 2) + '义军', 'rebel', old);
              setTownFaction(t, f.index, '起义');
              t.mood = 50;
              sim.events.emit('settlement.rebelled', tick, { town: t.name, from: old, faction: f.name }, old);
            }
          }
          // 名人：忠诚随所属势力的民心漂移；忠诚很低、野心很大的将军带着驻地自立
          for (const e of pa.notables()) {
            const f = factions[I.faction[e]];
            if (f.kind !== 'lord' && f.kind !== 'rebel') continue;
            const moods = f.towns.map((i) => towns[i].mood);
            const avg = moods.length ? moods.reduce((a, b) => a + b, 0) / moods.length : 0;
            N.loyalty[e] = Math.max(0, Math.min(100, N.loyalty[e] + (avg - 45) * 0.02 - N.ambition[e] * 0.004));
            if (titles.get(e) === '将军' && N.loyalty[e] < 20 && N.ambition[e] > 60 && f.towns.length > 1) {
              const t = towns[I.home[e]];
              const take = t && t.faction === f.index && !t.capital ? t : towns[f.towns[f.towns.length - 1]];
              const nf = addFaction(`${(I.name[e] as string).slice(0, 2)}军`, 'rebel', f.name);
              setTownFaction(take, nf.index, '叛将自立');
              rehome(e, take);
              N.loyalty[e] = 100;
              sim.events.emit('notable.defected', tick, { name: I.name[e], from: f.name, to: nf.name, how: '自立', town: take.name }, f.name);
            }
          }
          void P;
        },
      },
      'population',
    );

    // ---- 命令：税、开仓、招揽名人
    const commands: CommandDef[] = [
      {
        id: 'tax',
        verb: '税',
        aliases: ['tax'],
        who: ['lord'],
        args: [['城镇', 'town'], ['税率', 'int']],
        help: '设税率（%）。税高民心降',
        examples: ['税 青石城 15'],
        run(_c, a) {
          const t = a['城镇'] as Town;
          const r = a['税率'] as number;
          if (r < 0 || r > 50) return { ok: false, msg: '税率要在 0–50 之间' };
          t.tax = r;
          return { ok: true, msg: `${t.name} 税率 ${r}%（民心目标 ${r > 10 ? '下降' : '上升'}）` };
        },
      },
      {
        id: 'granary',
        verb: '开仓',
        aliases: ['granary'],
        who: ['lord'],
        args: [['城镇', 'town'], ['粮', 'int']],
        help: '开仓放粮，提升民心',
        examples: ['开仓 河口镇 200'],
        run(_c, a) {
          const t = a['城镇'] as Town;
          const n = a['粮'] as number;
          if (n <= 0) return { ok: false, msg: '粮要大于 0' };
          if (!eco.take(t.store, [['food', n]])) return { ok: false, msg: `${t.name} 的粮不够 ${n}` };
          const boost = Math.min(30, (n / Math.max(10, t.pop)) * 15);
          t.relief += boost;
          t.mood = Math.min(100, t.mood + boost / 3);
          return { ok: true, msg: `${t.name} 开仓放粮 ${n}，民心 ${Math.round(t.mood)}` };
        },
      },
      {
        id: 'recruit',
        verb: '招',
        aliases: ['recruit'],
        who: ['lord'],
        args: [['名人', 'notable'], ['出价', 'amount']],
        help: '招揽或策反名人',
        examples: ['招 李将军 300金'],
        run({ src }, a) {
          const e = a['名人'] as Entity;
          const goods = a['出价'] as [string, number][];
          const fi = factionIndex(src.faction!);
          const f = factions[fi];
          if (I.faction[e] === fi) return { ok: false, msg: `${I.name[e]} 已经是你的人了` };
          const cap = towns[f.towns[0]];
          if (!cap) return { ok: false, msg: '你没有城了' };
          if (!eco.take(cap.store, goods)) return { ok: false, msg: `${cap.name} 拿不出这么多` };
          const value = goods.reduce((s, [id, n]) => s + n * (id === 'gold' ? 1 : id === 'weapon' ? 3 : id === 'iron' ? 2 : 0.5), 0);
          const from = factions[I.faction[e]];
          const resist = from.kind === 'free' ? 100 + N.loyalty[e] * 2 : N.loyalty[e] * 12;
          const chance = Math.min(0.95, value / Math.max(1, resist));
          if (!rng.chance(chance)) {
            if (from.kind !== 'free') eco.give(towns[from.towns[0]]?.store ?? cap.store, goods);
            return { ok: true, msg: `${I.name[e]} 收下了礼，但没答应（成算约 ${Math.round(chance * 100)}%）${from.kind !== 'free' ? '；' + from.name + '会知道' : ''}` };
          }
          rehome(e, cap);
          N.loyalty[e] = 60;
          sim.events.emit('notable.defected', sim.clock.tick, { name: I.name[e], from: from.name, to: f.name, how: '招揽' }, f.name);
          return { ok: true, msg: `${titles.get(e)} ${I.name[e]} 投奔了你（来自${from.name}）` };
        },
      },
    ];
    for (const c of commands) api.addCommand(c);

    // ---- 存档
    Object.assign(pa, {
      _state: () => ({
        rng: rng.state,
        towns: towns.map(({ id, faction, capital, mood, tax, cap, walls, buildings, fed, relief, unrest, pop, founded }) => ({ id, faction, capital, mood, tax, cap, walls, buildings, fed, relief, unrest, pop, founded })),
        factions: factions.map((f) => ({ ...f })),
        titles: [...titles.entries()],
        births: [...births.entries()],
      }),
      _load(dd: { rng: number; towns: Partial<Town>[]; factions: Faction[]; titles: [number, string][]; births: [number, number][] }) {
        rng.state = dd.rng;
        dd.towns.forEach((x, i) => Object.assign(towns[i], x));
        factions.length = 0;
        for (const f of dd.factions) factions.push({ ...f });
        for (const t of towns) {
          const pl = world.place(t.name);
          if (pl) pl.faction = factions[t.faction].name;
        }
        titles.clear();
        for (const [e, tt] of dd.titles) titles.set(e, tt);
        births.clear();
        for (const [k, v] of dd.births) births.set(k, v);
        dirty = true;
      },
    });
    api.expose<PopulationApi>(pa);
  },
};
