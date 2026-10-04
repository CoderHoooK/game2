// 职业模块：职业数据 → NPC 的属性和行为表；干活的行为（采集、耕种、送回、闲着）；
// 选择器解释（@木、#一队、阿三……）；派活 / 放 / 编队命令。
// 比例（每天自动转职 + 新生儿分职业）、转职、搬运（指定 / 自动调粮）、打造（铁 + 木 → 兵器）、逃跑（附近有敌兵）。
import type { GameModule } from '../../../engine/module';
import type { Sim } from '../../../engine/sim';
import { defineComponent } from '../../../engine/ecs';
import { Transform, Motion } from '../../../engine/motion';
import { Brain, Membership, type BehaviorDef, type Order } from '../../../engine/brain';
import type { CommandDef, CommandResult, Source } from '../../../engine/commands/types';
import type { SelPart, Selector } from '../../../engine/commands/selector';
import type { Entity } from '../../../shared/types';
import { Rng } from '../../../shared/rng';
import type { ProfessionDef, WorkDef } from '../../../shared/content';
import { Carry, type EconomyApi } from '../economy';
import { Identity, Vitals, Notable, type PopulationApi, type Town } from '../population';
import type { Place, WorldApi } from '../world';
import { PROFESSIONS, START_RATIO, PLANNED_BEHAVIORS, FOOD_PER_DAY } from '../../../../content/professions';
import { NOTABLES } from '../../../../content/factions';
import { WORKS } from '../../../../content/items';

export const Profession = defineComponent('Profession', '职业', { prof: 'u8', skill: 'u8', locked: 'u8' }, { prof: '职业序号', skill: '熟练度 0–100（干得越久越快，最多快 50%）', locked: '1 = 用「转」手动定的职业，比例不会动他' });

/** 打造配方：一件成品要多少原料、几秒 */
export const RECIPES: Record<string, { inputs: [string, number][]; secs: number }> = {
  weapon: { inputs: [['iron', 1], ['wood', 2]], secs: 8 },
  tool: { inputs: [['iron', 1], ['wood', 1]], secs: 6 },
};

/** 长期命令里的地点：具体地点，或"各回各家" */
export type PlaceParam = Place | 'home';

export interface NpcInfo {
  id: number;
  name: string;
  faction: string;
  factionColor: string;
  home: string;
  profession: ProfessionDef;
  hp: number;
  maxHp: number;
  x: number;
  y: number;
  region: string;
  carry: { item: string; qty: number; cap: number } | null;
  behavior: { id: string; name: string; step: number; text: string } | null;
  order: { type: string; name: string; label: string; pinned: boolean; isDefault: boolean } | null;
  group: string | null;
  kit: { id: string; name: string; ready: boolean }[];
  commands: { verb: string; signature: string; help: string; example: string }[];
  components: Record<string, Record<string, unknown>>;
}

export interface JobsApi {
  professions: ProfessionDef[];
  profIndex(id: string): number;
  /** 简称 / 全称 / ID → 序号；不是职业返回 -1 */
  profByWord(word: string): number;
  setProfession(e: Entity, prof: number): void;
  placePos(e: Entity, p: PlaceParam | undefined): [number, number];
  /** 把选中的人交给一条新的长期命令（接不了的跳过并说明） */
  dispatch(src: Source, ents: Entity[], type: string, params: Record<string, unknown>, label: string, opts?: { pin?: boolean; filter?: (e: Entity) => boolean; why?: string }): CommandResult;
  groupName(id: number): string | null;
  describe(e: Entity): NpcInfo;
  /** 某职业能用的诸侯命令（从命令定义和行为表推导，不手写） */
  commandsFor(prof: number): CommandDef[];
  countByProf(faction?: number): number[];
  /** 城镇的职业比例（% ，没设返回开局比例） */
  quota(town: number): Record<string, number>;
  setQuota(town: number, q: Record<string, number>): void;
  /** 改职业（付培训费）；locked = 手动定的 */
  retrain(e: Entity, prof: number, locked: boolean): string | null;
  /** 附近有没有威胁（military 挂进来：返回敌人的位置，没有返回 null） */
  threat: (e: Entity) => [number, number] | null;
  /** 改某座城某职业的平时命令（军事模块给流寇用） */
  defaultOrder(t: Town, prof: number): Order;
}

const NODE_OF: Record<string, string> = { wood: 'wood', stone: 'stone', iron: 'iron', food: 'field' };

export const jobs: GameModule = {
  id: 'jobs',
  name: '职业',
  requires: ['world', 'economy', 'population'],
  components: [Profession],
  config: {
    baseSpeed: { default: 8, text: '基础走路速度（米/秒，再乘职业速度）', min: 1, max: 50 },
    gatherRate: { default: 2, text: '采集速度（每秒几个）', min: 0.1, max: 50 },
  },
  views: [{ id: 'units', text: '视野内的 NPC（位置、职业、状态）' }],
  events: [{ id: 'npc.retrained', module: 'jobs', text: '有人转职（按比例自动转，或「转」命令）' }],
  orders: [
    { id: 'work', name: '干活', params: ['resource', 'place?'], text: '采集或生产某种资源' },
    { id: 'haul', name: '搬运', params: ['item?', 'from?', 'to?'], text: '在两座城之间运东西；不给参数 = 自动把粮从富余的城运到缺粮的城' },
    { id: 'idle', name: '待命', params: ['place?'], text: '原地待命' },
  ],
  argTypes: [
    {
      id: 'work',
      name: '活',
      parse: (tok) => {
        const w = WORKS.find((x) => x.verb === tok);
        return w ? { ok: true, value: w } : { ok: false, error: `不认识的活「${tok}」`, hint: `可用：${WORKS.map((x) => x.verb).join(' ')}` };
      },
      choices: () => WORKS.map((x) => x.verb),
    },
    {
      id: 'prof',
      name: '职业',
      parse: (tok) => {
        const i = PROFESSIONS.findIndex((p) => p.short === tok || p.name === tok || p.id === tok);
        return i >= 0 ? { ok: true, value: i } : { ok: false, error: `没有「${tok}」这个职业`, hint: PROFESSIONS.map((p) => p.short).join(' ') };
      },
      choices: () => PROFESSIONS.map((p) => p.short),
    },
    {
      id: 'quota',
      name: '比例',
      rest: true,
      parse: (tok) => {
        const q: Record<string, number> = {};
        for (const part of tok.split(/\s+/).filter(Boolean)) {
          const m = /^(\D+?)(\d+)%?$/.exec(part);
          const i = m ? PROFESSIONS.findIndex((p) => p.short === m[1] || p.name === m[1] || p.id === m[1]) : -1;
          if (!m || i < 0) return { ok: false, error: `「${part}」要写成 职业简称+百分比，如 农50`, hint: PROFESSIONS.map((p) => p.short).join(' ') };
          q[PROFESSIONS[i].id] = +m[2];
        }
        const sum = Object.values(q).reduce((a, b) => a + b, 0);
        if (!sum) return { ok: false, error: '至少写一个职业' };
        return { ok: true, value: q };
      },
    },
    {
      id: 'group',
      name: '队名',
      parse: (tok) => (/^[^\s@#:,*%]{1,12}$/.test(tok) ? { ok: true, value: tok } : { ok: false, error: `队名「${tok}」不能带 @ # : , * % 符号` }),
    },
  ],
  save: {
    version: 1,
    save: (sim) => sim.service<JobsApi & { _state(): unknown }>('jobs')._state(),
    load: (sim, d) => sim.service<JobsApi & { _load(d: unknown): void }>('jobs')._load(d),
  },
  install(api) {
    const sim: Sim = api.sim;
    const world = api.use<WorldApi>('world');
    const eco = api.use<EconomyApi>('economy');
    const pop = api.use<PopulationApi>('population');
    const rng = new Rng(sim.seed ^ 0x10b5);
    const W = sim.world;
    const I = W.get(Identity);
    const P = W.get(Transform);
    const M = W.get(Motion);
    const B = W.get(Brain);
    const G = W.get(Membership);
    const C = W.get(Carry);
    const V = W.get(Vitals);
    const PR = W.get(Profession);
    const baseSpeed = api.config.baseSpeed as number;
    const gatherRate = api.config.gatherRate as number;

    const profIndex = (id: string) => PROFESSIONS.findIndex((p) => p.id === id);
    const profByWord = (w: string) => PROFESSIONS.findIndex((p) => p.short === w || p.name === w || p.id === w);
    const townPlace = (t: Town): Place => world.place(t.name)!;
    const placePos = (e: Entity, p: PlaceParam | undefined): [number, number] => {
      if (!p || p === 'home') {
        const t = pop.towns[I.home[e]];
        return [t.x, t.y];
      }
      return [p.x, p.y];
    };
    const goNear = (e: Entity, x: number, y: number, r: number) => {
      const [tx, ty] = world.landPointNear(x, y, r, rng);
      sim.act('moveTo', e, tx, ty);
    };

    // ---------------------------------------------------------------- 行为
    const skillMul = (e: Entity) => 1 + PR.skill[e] / 200;
    // 后装的模块（军事）会替换 threat；先用占位
    const api2 = { threat: (_e: Entity): [number, number] | null => null };
    const gather = (id: string, name: string, items: string[], text: string): BehaviorDef => ({
      id,
      name,
      orders: ['work'],
      acts: ['moveTo', 'harvestTile', 'load'],
      text,
      fits(_s, e, o) {
        if (!o || o.type !== 'work') return 0;
        const res = o.params.resource as string;
        if (!items.includes(res) || PROFESSIONS[PR.prof[e]].gathers !== res) return 0;
        if (C.qty[e] >= C.cap[e] - 1e-3) return 0;
        if (C.item[e] && C.item[e] !== eco.itemIndex(res) + 1) return 0;
        return 50;
      },
      start(_s, e, o) {
        const res = o!.params.resource as string;
        const place = o!.params.place as Place | undefined;
        let qx = P.x[e] + rng.range(-120, 120);
        let qy = P.y[e] + rng.range(-120, 120);
        let maxD = 3500;
        let region: number | undefined;
        if (place) {
          qx = place.x;
          qy = place.y;
          maxD = place.kind === 'region' ? 2000 : 3000;
          if (place.kind === 'region') region = place.id;
        }
        const n = world.nearestNode(NODE_OF[res], qx, qy, maxD, region, 2);
        if (n < 0) return false;
        B.target[e] = n;
        sim.act('moveTo', e, world.nodes.x[n] + rng.range(-4, 4), world.nodes.y[n] + rng.range(-4, 4));
        return true;
      },
      tick(_s, e, o, dt) {
        if (B.step[e] === 0) {
          if (M.moving[e]) return 'running';
          B.step[e] = 1;
          B.timer[e] = (C.cap[e] - C.qty[e]) / gatherRate / skillMul(e);
          return 'running';
        }
        B.timer[e] -= dt;
        if (B.timer[e] > 0) return 'running';
        if (!o) return 'failed';
        const r = sim.act('harvestTile', B.target[e], C.cap[e] - C.qty[e]);
        if (r.ok) sim.act('load', e, o.params.resource as string, r.value as number);
        if (r.ok && rng.chance(0.2)) PR.skill[e] = Math.min(100, PR.skill[e] + 1);
        return 'done';
      },
    });

    const behaviors: BehaviorDef[] = [
      gather('gather', '采集', ['wood', 'stone', 'iron'], '采木头、石头、铁矿：走到资源点 → 读条 → 拿满'),
      gather('farm', '耕种', ['food'], '在城边的田里干活收粮（第 1 阶段加季节：春种秋收，冬天歇）'),
      {
        id: 'deliver',
        name: '送回',
        orders: [],
        support: true,
        acts: ['moveTo', 'deposit'],
        text: '辅助行为：拿满了送回最近的己方仓库',
        fits(_s, e, o) {
          if (C.qty[e] <= 0) return 0;
          if (C.qty[e] >= C.cap[e] - 1e-3) return 100;
          const same = o?.type === 'work' && C.item[e] === eco.itemIndex(o.params.resource as string) + 1;
          return same ? 5 : 90;
        },
        start(_s, e) {
          const t = pop.nearestTown(I.faction[e], P.x[e], P.y[e]);
          if (!t) return false;
          B.target[e] = t.id;
          goNear(e, t.x, t.y, 18);
          return true;
        },
        tick(_s, e) {
          if (M.moving[e]) return 'running';
          return sim.act('deposit', e, pop.towns[B.target[e]].store).ok ? 'done' : 'failed';
        },
      },
      {
        id: 'flee',
        name: '逃跑',
        orders: [],
        support: true,
        acts: ['moveTo'],
        text: '附近有敌兵时丢下手里的活往最近的己方城跑（由军事模块的威胁检测触发）',
        fits(_s, e) {
          return api2.threat(e) ? 300 : 0;
        },
        start(_s, e) {
          const t = pop.nearestTown(I.faction[e], P.x[e], P.y[e]);
          const th = api2.threat(e);
          if (!th) return false;
          if (t) goNear(e, t.x, t.y, 25);
          else {
            const dx = P.x[e] - th[0];
            const dy = P.y[e] - th[1];
            const k = 150 / Math.max(1, Math.hypot(dx, dy));
            goNear(e, P.x[e] + dx * k, P.y[e] + dy * k, 20);
          }
          return true;
        },
        tick: (_s, e) => (M.moving[e] ? 'running' : 'done'),
      },
      {
        id: 'haul',
        name: '搬运',
        orders: ['haul'],
        acts: ['moveTo', 'withdraw', 'deposit'],
        text: '去出发城的仓库取货 → 走到目的城 → 卸货。自动模式：把粮食从人均最多的己方城运到人均最少的',
        fits(_s, e, o) {
          return o?.type === 'haul' && C.qty[e] === 0 ? 40 : 0;
        },
        start(_s, e, o) {
          let item = o!.params.item as string | undefined;
          let from = o!.params.from as Town | undefined;
          let to = o!.params.to as Town | undefined;
          if (!item || !from || !to) {
            const mine = pop.factions[I.faction[e]].towns.map((i) => pop.towns[i]);
            if (mine.length < 2) return false;
            const food = eco.itemIndex('food');
            const per = (t: Town) => eco.stores[t.store].stock[food] / Math.max(10, t.pop);
            const sorted = [...mine].sort((a, b) => per(b) - per(a) || a.id - b.id);
            from = sorted[0];
            to = sorted[sorted.length - 1];
            if (per(from) - per(to) < 2 || eco.stores[from.store].stock[food] < 60) return false;
            item = 'food';
          }
          if (from === to || eco.stores[from.store].stock[eco.itemIndex(item)] < 1) return false;
          B.target[e] = from.id;
          B.target2[e] = to.id;
          B.timer[e] = eco.itemIndex(item);
          goNear(e, from.x, from.y, 15);
          return true;
        },
        tick(_s, e) {
          if (M.moving[e]) return 'running';
          const from = pop.towns[B.target[e]];
          const to = pop.towns[B.target2[e]];
          if (B.step[e] === 0) {
            const r = sim.act('withdraw', e, from.store, eco.items[B.timer[e]].id, C.cap[e]);
            if (!r.ok) return 'failed';
            B.step[e] = 1;
            goNear(e, to.x, to.y, 15);
            return 'running';
          }
          if (to.faction !== I.faction[e]) {
            // 目的城换主了：送回家
            const home = pop.nearestTown(I.faction[e], P.x[e], P.y[e]);
            if (!home) return 'failed';
            B.target2[e] = home.id;
            goNear(e, home.x, home.y, 15);
            return 'running';
          }
          return sim.act('deposit', e, to.store).ok ? 'done' : 'failed';
        },
      },
      {
        id: 'craft',
        name: '打造',
        orders: ['work'],
        acts: ['moveTo', 'wait', 'convert'],
        text: '在城里的铁匠铺把仓库里的铁和木头打成兵器（铁 1 + 木 2，8 秒一件；铁匠铺让速度翻倍）',
        fits(_s, e, o) {
          if (!o || o.type !== 'work' || !RECIPES[o.params.resource as string]) return 0;
          const t = pop.towns[I.home[e]];
          if (!t || t.faction !== I.faction[e]) return 0;
          return eco.has(t.store, RECIPES[o.params.resource as string].inputs) ? 50 : 0;
        },
        start(_s, e) {
          const t = pop.towns[I.home[e]];
          goNear(e, t.x, t.y, 12);
          return true;
        },
        tick(_s, e, o, dt) {
          if (B.step[e] === 0) {
            if (M.moving[e]) return 'running';
            const t = pop.towns[I.home[e]];
            B.step[e] = 1;
            B.timer[e] = RECIPES[o!.params.resource as string].secs / (1 + (t.buildings.forge ?? 0)) / skillMul(e);
            return 'running';
          }
          B.timer[e] -= dt;
          if (B.timer[e] > 0) return 'running';
          if (!o) return 'failed';
          const res = o.params.resource as string;
          const r = sim.act('convert', pop.towns[I.home[e]].store, RECIPES[res].inputs, [[res, 1]]);
          if (r.ok) PR.skill[e] = Math.min(100, PR.skill[e] + 1);
          return r.ok ? 'done' : 'failed';
        },
      },
      {
        id: 'idle',
        name: '闲着',
        orders: ['idle', '*'],
        acts: ['moveTo', 'wait'],
        text: '没活可干时的兜底：在城里或待命地点附近溜达',
        fits: () => 1,
        start(_s, e, o) {
          const [x, y] = placePos(e, o?.type === 'idle' ? (o.params.place as PlaceParam) : 'home');
          goNear(e, x, y, 38);
          return true;
        },
        tick(_s, e, _o, dt) {
          if (B.step[e] === 0) {
            if (M.moving[e]) return 'running';
            B.step[e] = 1;
            B.timer[e] = rng.range(2, 6);
            return 'running';
          }
          B.timer[e] -= dt;
          return B.timer[e] > 0 ? 'running' : 'done';
        },
      },
    ];
    for (const b of behaviors) api.addBehavior(b);

    // ---------------------------------------------------------------- 职业
    const kits = PROFESSIONS.map((p) => sim.brains.defineKit(p.behaviors));
    const defaults = new Map<string, Order>();
    const defaultOrder = (t: Town, prof: number): Order => {
      const key = `${t.id}:${t.faction}:${prof}`;
      let o = defaults.get(key);
      // 没人用的命令每天会被回收：缓存里的要还在注册表里才算数
      if (!o || sim.brains.order(o.id) !== o) {
        const d = PROFESSIONS[prof].defaultOrder;
        const params: Record<string, unknown> = {};
        if (d.resource) params.resource = d.resource;
        if (d.place === 'home') params.place = townPlace(t);
        const work = WORKS.find((w) => w.resource === d.resource);
        const label =
          d.type === 'work' ? `${work?.verb ?? d.resource}（平时）` : `${sim.brains.orderDefs.get(d.type)?.name ?? d.type} ${d.place === 'home' ? t.name : ''}（平时）`;
        o = sim.brains.createOrder(d.type, params, label, pop.factions[t.faction].name);
        defaults.set(key, o);
      }
      return o;
    };
    const setProfession = (e: Entity, prof: number) => {
      const p = PROFESSIONS[prof];
      if (!W.has(e, Profession)) W.add(e, Profession);
      PR.prof[e] = prof;
      M.speed[e] = baseSpeed * p.stats.speed;
      C.cap[e] = p.stats.carry;
      V.maxHp[e] = p.stats.hp;
      V.hp[e] = p.stats.hp;
      B.kit[e] = kits[prof];
      sim.brains.setDefault(e, defaultOrder(pop.towns[I.home[e]], prof));
    };

    // ---------------------------------------------------------------- 比例 / 转职
    const quotas = new Map<number, Record<string, number>>();
    const quota = (town: number) => quotas.get(town) ?? START_RATIO;
    /** 按比例的目标人数（最大余数法，保证总数对得上） */
    const targetCounts = (q: Record<string, number>, n: number) => {
      const ids = Object.keys(q);
      const total = ids.reduce((a, k) => a + q[k], 0) || 1;
      const raw = ids.map((k) => (n * q[k]) / total);
      const out = raw.map(Math.floor);
      const order = raw.map((v, i) => [v - out[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
      for (let k = 0; out.reduce((a, b) => a + b, 0) < n; k++) out[order[k % ids.length][1]]++;
      const m = new Map<number, number>();
      ids.forEach((id, i) => m.set(profIndex(id), out[i]));
      return m;
    };
    const notableProf = (e: Entity) => {
      const n = NOTABLES.find((x) => x.name === I.name[e]);
      return profIndex(n?.profession ?? 'scout');
    };
    const isFree = (e: Entity) => pop.factions[I.faction[e]].kind === 'free' || pop.factions[I.faction[e]].kind === 'bandit';
    /** 把人分到最缺的职业 */
    const neediest = (town: Town) => {
      const res = pop.residents(town.id).filter((x) => W.has(x, Profession));
      const want = targetCounts(quota(town.id), res.length + 1);
      const have = new Map<number, number>();
      for (const x of res) have.set(PR.prof[x], (have.get(PR.prof[x]) ?? 0) + 1);
      let best = profIndex('farmer');
      let gap = -Infinity;
      for (const [p, w] of want) {
        const g = w - (have.get(p) ?? 0);
        if (g > gap) ((gap = g), (best = p));
      }
      return best;
    };
    const retrain = (e: Entity, prof: number, locked: boolean): string | null => {
      if (PR.prof[e] === prof) {
        PR.locked[e] = locked ? 1 : PR.locked[e];
        return null;
      }
      const t = pop.towns[I.home[e]];
      const cost = eco.parseGoods(PROFESSIONS[prof].train.cost);
      if (!eco.take(t.store, cost)) return `${t.name} 付不起培训费（${Object.entries(PROFESSIONS[prof].train.cost).map(([k, v]) => k + v).join('、')}）`;
      const from = PROFESSIONS[PR.prof[e]].name;
      sim.brains.release(e);
      setProfession(e, prof);
      PR.locked[e] = locked ? 1 : 0;
      sim.events.emit('npc.retrained', sim.clock.tick, { e, from, to: PROFESSIONS[prof].name, town: t.name }, pop.factions[I.faction[e]].name);
      return null;
    };
    pop.upkeepOf = (e) => FOOD_PER_DAY * (W.has(e, Profession) ? PROFESSIONS[PR.prof[e]].upkeep['粮'] ?? 1 : 1);
    pop.onSpawn.push((e) => {
      const t = pop.towns[I.home[e]];
      setProfession(e, neediest(t));
    });
    pop.onRehome.push((e) => {
      if (!W.has(e, Profession)) return;
      sim.brains.release(e);
      sim.brains.setDefault(e, defaultOrder(pop.towns[I.home[e]], PR.prof[e]));
    });

    // 开局：每座城按比例分配职业；名人按身份（将军 → 士兵，谋士 → 斥候）
    api.onStart(() => {
      const byTown = new Map<number, Entity[]>();
      for (const e of pop.npcs()) {
        if (W.has(e, Notable)) {
          setProfession(e, notableProf(e));
          continue;
        }
        if (!byTown.has(I.home[e])) byTown.set(I.home[e], []);
        byTown.get(I.home[e])!.push(e);
      }
      for (const [, list] of [...byTown.entries()].sort((a, b) => a[0] - b[0])) {
        // 开局每座营地各职业几个人，由「新世界」设置给出（population.startCounts）；总数对不上时多的归最缺的职业
        const want = new Map<number, number>();
        for (const [id, n] of Object.entries(pop.startCounts)) if (n > 0) want.set(profIndex(id), n);
        // 前几个人（如"阿三"）留在原位，其余打乱
        const queue = [...list.slice(0, 3), ...rng.shuffle(list.slice(3))];
        for (const [p, n] of [...want].sort((a, b) => a[0] - b[0])) for (let k = 0; k < n && queue.length; k++) setProfession(queue.shift()!, p);
        while (queue.length) setProfession(queue.shift()!, profIndex('farmer'));
      }
      for (const e of pop.notables()) if (isFree(e)) sim.brains.setDefault(e, sim.brains.createOrder('idle', { place: townPlace(pop.towns[I.home[e]]) }, '隐居（在野）'));
    });

    // 每天：按比例调整（每座城每天最多转 5% 的人；手动定的、锁定的、名人不动）
    sim.scheduler.add(
      {
        id: 'jobs.rebalance',
        phase: 'post',
        every: 100,
        run() {
          for (const [tid, q] of [...quotas.entries()].sort((a, b) => a[0] - b[0])) {
            const t = pop.towns[tid];
            const res = pop.residents(tid).filter((x) => W.has(x, Profession));
            const want = targetCounts(q, res.length);
            const have = new Map<number, Entity[]>();
            for (const x of res) {
              if (!have.has(PR.prof[x])) have.set(PR.prof[x], []);
              have.get(PR.prof[x])!.push(x);
            }
            let budget = Math.max(1, Math.floor(res.length * 0.05));
            const over: Entity[] = [];
            for (const [p, list] of have) {
              const extra = list.length - (want.get(p) ?? 0);
              if (extra > 0) over.push(...list.filter((x) => !PR.locked[x] && !G.pinned[x] && !W.has(x, Notable)).slice(0, extra));
            }
            const under: number[] = [];
            for (const [p, w] of want) for (let k = (have.get(p)?.length ?? 0); k < w; k++) under.push(p);
            for (let i = 0; i < Math.min(over.length, under.length) && budget > 0; i++, budget--) {
              if (retrain(over[i], under[i], false)) break; // 付不起培训费：今天到此为止
            }
            void t;
          }
        },
      },
      'jobs',
    );

    // ---------------------------------------------------------------- 编组
    const groups: { name: string; faction: number }[] = [{ name: '', faction: -1 }];
    const findGroup = (name: string, src: Source) => {
      const fi = src.role === 'lord' ? pop.factionIndex(src.faction!) : -1;
      return groups.findIndex((g, i) => i > 0 && g.name === name && (fi < 0 || g.faction === fi));
    };

    // ---------------------------------------------------------------- 选择器
    const tagProfs = (v: string) => {
      const i = profByWord(v);
      if (i >= 0) return new Set([i]);
      const s = new Set<number>();
      PROFESSIONS.forEach((p, k) => p.tags.includes(v) && s.add(k));
      return s;
    };
    const factionOf = (src: Source) => (src.role === 'lord' ? pop.factionIndex(src.faction!) : -1);
    api.provideSelectors({
      check(part: SelPart, src: Source) {
        const fi = factionOf(src);
        if (part.head.kind === 'tag' && tagProfs(part.head.value).size === 0) {
          return { error: `没有「${part.head.value}」这个职业或标签`, hint: `职业：${PROFESSIONS.map((p) => p.short).join(' ')}；标签：worker military` };
        }
        if (part.head.kind === 'group' && findGroup(part.head.value, src) < 0) {
          const mine = groups.filter((g, i) => i > 0 && (fi < 0 || g.faction === fi)).map((g) => '#' + g.name);
          return { error: `没有队伍「#${part.head.value}」`, hint: mine.length ? `现有：${mine.join(' ')}` : '先用「编」命令编队' };
        }
        if (part.head.kind === 'name') {
          const found = pop.npcs().some((e) => I.name[e] === part.head.value && (fi < 0 || I.faction[e] === fi));
          if (!found) return { error: `没有叫「${part.head.value}」的人` };
        }
        if (part.at && !world.place(part.at)) return { error: `没有叫「${part.at}」的地方` };
        return null;
      },
      candidates(part: SelPart, src: Source) {
        const fi = factionOf(src);
        const profs = part.head.kind === 'tag' ? tagProfs(part.head.value) : null;
        const gid = part.head.kind === 'group' ? findGroup(part.head.value, src) : -1;
        const at = part.at ? world.place(part.at) : undefined;
        const out: Entity[] = [];
        for (const e of pop.npcs()) {
          if (fi >= 0 && I.faction[e] !== fi) continue;
          if (profs && !profs.has(PR.prof[e])) continue;
          if (part.head.kind === 'group' && G.group[e] !== gid) continue;
          if (part.head.kind === 'name' && I.name[e] !== part.head.value) continue;
          if (at) {
            if (at.kind === 'town' && I.home[e] !== at.id) continue;
            if (at.kind === 'region') {
              const op = sim.brains.order(B.order[e])?.params.place as Place | undefined;
              if (P.region[e] !== at.id && op?.name !== at.name) continue;
            }
          }
          out.push(e);
        }
        const ax = at?.x;
        const ay = at?.y;
        const key = (e: Entity) => (ax === undefined ? 0 : (P.x[e] - ax) ** 2 + (P.y[e] - ay!) ** 2);
        return out.sort((a, b) => G.pinned[a] - G.pinned[b] || key(a) - key(b) || a - b);
      },
    });

    // ---------------------------------------------------------------- 派活（所有"让一批人去做某事"的命令共用）
    const dispatch: JobsApi['dispatch'] = (src, ents, type, params, label, opts = {}) => {
      const pin = opts.pin ?? true;
      const okList: Entity[] = [];
      const skipped = new Map<number, number>();
      for (const e of ents) {
        const can = sim.brains.kitOrders(B.kit[e]).has(type) && (!opts.filter || opts.filter(e));
        if (can) okList.push(e);
        else skipped.set(PR.prof[e], (skipped.get(PR.prof[e]) ?? 0) + 1);
      }
      const warns = [...skipped.entries()].map(([p, n]) => `跳过 ${n} 名${PROFESSIONS[p].name}（${opts.why ?? `接不了「${sim.brains.orderDefs.get(type)?.name ?? type}」`}）`);
      if (!okList.length) return { ok: false, msg: ents.length ? '选中的人都做不了这件事' : '没选中任何人', warns };
      const o = sim.brains.createOrder(type, params, label, src.faction);
      sim.brains.assign(okList, o, pin);
      const byProf = new Map<number, number>();
      for (const e of okList) byProf.set(PR.prof[e], (byProf.get(PR.prof[e]) ?? 0) + 1);
      const who = [...byProf.entries()].map(([p, n]) => `${n} 名${PROFESSIONS[p].name}`).join('、');
      return { ok: true, msg: `${who}：${label}${pin ? '（锁定）' : ''}`, warns };
    };

    const sel = (args: Record<string, unknown>, src: Source) => sim.bus.select(args['人'] as Selector, src);
    const commands: CommandDef[] = [
      {
        id: 'assign',
        verb: '派',
        aliases: ['assign'],
        who: ['lord', 'god'],
        order: 'work',
        args: [['人', 'sel'], ['活', 'work'], ['地点?', 'place']],
        help: '把一批人派去干某种活；派出去的人会锁定，直到"放"',
        examples: ['派 @木:5 伐木 北林', '派 @农@河口镇 种田'],
        run({ src }, a) {
          const w = a['活'] as WorkDef;
          const place = a['地点'] as Place | undefined;
          const p = PROFESSIONS[profIndex(w.profession)];
          return dispatch(src, sel(a, src), 'work', { resource: w.resource, place }, `${w.verb}${place ? ' @ ' + place.name : ''}`, {
            filter: (e) => PR.prof[e] === profIndex(w.profession),
            why: `不会${w.verb}，要${p.name}`,
          });
        },
      },
      {
        id: 'release',
        verb: '放',
        aliases: ['release'],
        who: ['lord'],
        args: [['人', 'sel']],
        help: '解除锁定，还给职业比例自动分配',
        examples: ['放 @木@北林'],
        run({ src }, a) {
          const list = sel(a, src);
          if (!list.length) return { ok: false, msg: '没选中任何人' };
          for (const e of list) sim.brains.release(e);
          return { ok: true, msg: `${list.length} 人回到平时的安排` };
        },
      },
      {
        id: 'group',
        verb: '编',
        aliases: ['group'],
        who: ['lord'],
        args: [['人', 'sel'], ['队名', 'group']],
        help: '把一批人编成队伍，之后用 #队名 指挥',
        examples: ['编 @兵@青石城:20 一队'],
        run({ src }, a) {
          const list = sel(a, src);
          if (!list.length) return { ok: false, msg: '没选中任何人' };
          const name = a['队名'] as string;
          let gid = findGroup(name, src);
          if (gid < 0) {
            if (groups.length >= 65535) return { ok: false, msg: '队伍太多了' };
            groups.push({ name, faction: factionOf(src) });
            gid = groups.length - 1;
          }
          for (const e of list) G.group[e] = gid;
          return { ok: true, msg: `#${name} 现在有 ${list.length} 人（之前在别的队的会转过来）` };
        },
      },
    ];
    commands.push(
      {
        id: 'haul',
        verb: '运',
        aliases: ['haul'],
        who: ['lord'],
        order: 'haul',
        args: [['人', 'sel'], ['物品', 'item'], ['从', 'place'], ['到', 'place']],
        help: '派人在两座己方城之间运东西（来回跑，直到放）',
        examples: ['运 @运:4 粮食 青石城 河口镇'],
        run({ src }, a) {
          const from = a['从'] as Place;
          const to = a['到'] as Place;
          if (from.kind !== 'town' || to.kind !== 'town') return { ok: false, msg: '从哪到哪都要是城镇' };
          const fi = pop.factionIndex(src.faction!);
          const tf = pop.towns[from.id];
          const tt = pop.towns[to.id];
          if (tf.faction !== fi || tt.faction !== fi) return { ok: false, msg: '只能在自己的城之间运' };
          if (tf === tt) return { ok: false, msg: '起点和终点是同一座城' };
          const item = a['物品'] as string;
          return dispatch(src, sel(a, src), 'haul', { item, from: tf, to: tt }, `运${eco.items[eco.itemIndex(item)].name} ${tf.name}→${tt.name}`);
        },
      },
      {
        id: 'quota',
        verb: '比例',
        aliases: ['quota'],
        who: ['lord'],
        args: [['城镇', 'town'], ['比例', 'quota']],
        help: '设城镇的职业比例（%），每天自动转职靠拢；新生儿也按它分',
        examples: ['比例 青石城 农50 木20 石10 兵20'],
        run(_c, a) {
          const t = a['城镇'] as Town;
          const q = a['比例'] as Record<string, number>;
          quotas.set(t.id, q);
          const sum = Object.values(q).reduce((x, y) => x + y, 0);
          const desc = Object.entries(q).map(([k, v]) => `${PROFESSIONS[profIndex(k)].short}${Math.round((v * 100) / sum)}`).join(' ');
          return { ok: true, msg: `${t.name} 职业比例：${desc}（每天最多转 5% 的人，要付培训费）`, warns: sum !== 100 ? [`加起来是 ${sum}，已按比例折算`] : [] };
        },
      },
      {
        id: 'retrain',
        verb: '转',
        aliases: ['retrain'],
        who: ['lord'],
        args: [['人', 'sel'], ['职业', 'prof']],
        help: '让一批人改行（付培训费），之后比例不会再动他们',
        examples: ['转 @农:10 兵'],
        run({ src }, a) {
          const list = sel(a, src);
          if (!list.length) return { ok: false, msg: '没选中任何人' };
          const prof = a['职业'] as number;
          let ok = 0;
          const warns: string[] = [];
          for (const e of list) {
            const err = retrain(e, prof, true);
            if (err) {
              warns.push(`${list.length - ok} 人没转成：${err}`);
              break;
            }
            ok++;
          }
          return ok ? { ok: true, msg: `${ok} 人改行做${PROFESSIONS[prof].name}`, warns } : { ok: false, msg: warns[0] ?? '没转成' };
        },
      },
    );
    for (const c of commands) api.addCommand(c);

    // ---------------------------------------------------------------- 公开接口
    const svc0 = () => sim.service<JobsApi>('jobs');
    const commandsFor = (prof: number) => {
      const can = sim.brains.kitOrders(kits[prof]);
      return sim.bus.list().filter((c) => c.who.includes('lord') && c.args.some(([, t]) => t === 'sel') && (!c.order || can.has(c.order)));
    };
    api.expose<JobsApi>({
      quota,
      setQuota: (t, q) => quotas.set(t, q),
      retrain,
      get threat() {
        return api2.threat;
      },
      set threat(f) {
        api2.threat = f;
      },
      defaultOrder,
      professions: PROFESSIONS,
      profIndex,
      profByWord,
      setProfession,
      placePos,
      dispatch,
      groupName: (id) => (id > 0 ? groups[id]?.name ?? null : null),
      commandsFor,
      countByProf(faction) {
        const out = PROFESSIONS.map(() => 0);
        for (const e of pop.npcs()) if (faction === undefined || I.faction[e] === faction) out[PR.prof[e]]++;
        return out;
      },
      describe(e) {
        const prof = PROFESSIONS[PR.prof[e]];
        const f = pop.factions[I.faction[e]];
        const b = B.beh[e] ? sim.brains.behaviors[B.beh[e] - 1] : null;
        const o = sim.brains.order(B.order[e]);
        const item = C.item[e] ? eco.items[C.item[e] - 1] : null;
        return {
          id: e,
          name: I.name[e] as string,
          faction: f.name,
          factionColor: f.color,
          home: pop.towns[I.home[e]]?.name ?? '',
          profession: prof,
          hp: V.hp[e],
          maxHp: V.maxHp[e],
          x: P.x[e],
          y: P.y[e],
          region: world.map.regions[P.region[e]]?.name || '海上',
          carry: item ? { item: item.name, qty: C.qty[e], cap: C.cap[e] } : null,
          behavior: b ? { id: b.id, name: b.name, step: B.step[e], text: b.text } : null,
          order: o ? { type: o.type, name: sim.brains.orderDefs.get(o.type)?.name ?? o.type, label: o.label, pinned: G.pinned[e] === 1, isDefault: B.order[e] === B.def[e] } : null,
          group: G.group[e] ? groups[G.group[e]].name : null,
          kit: prof.behaviors.map((id) => ({ id, name: sim.brains.behavior(id)?.name ?? PLANNED_BEHAVIORS[id] ?? id, ready: sim.brains.hasBehavior(id) })),
          commands: [] as NpcInfo['commands'], // 命令最后才登记，查询时再算（见下）
          components: W.inspect(e),
        };
      },
    });
    Object.assign(svc0(), {
      _state: () => ({ rng: rng.state, quotas: [...quotas.entries()], groups, defaults: [...defaults].map(([k, o]) => [k, o.id]) }),
      _load(d: { rng: number; quotas: [number, Record<string, number>][]; groups: { name: string; faction: number }[]; defaults: [string, number][] }) {
        rng.state = d.rng;
        // 平时命令换成读进来的那份对象（已被回收的丢掉，用到时重建，和没读档时一样）
        defaults.clear();
        for (const [k, id] of d.defaults) {
          const o = sim.brains.order(id);
          if (o) defaults.set(k, o);
        }
        quotas.clear();
        for (const [k, v] of d.quotas) quotas.set(k, v);
        groups.length = 0;
        groups.push(...d.groups);
      },
    });
    // 命令表在所有模块登记完之后才完整：describe 时补上
    const svc = sim.service<JobsApi>('jobs');
    const rawDescribe = svc.describe;
    svc.describe = (e) => {
      const info = rawDescribe(e);
      info.commands = commandsFor(PR.prof[e]).map((c) => ({ verb: c.verb, signature: sim.bus.signature(c), help: c.help, example: c.examples[0] }));
      return info;
    };
  },
};
