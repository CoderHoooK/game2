// 军事模块：走位（驻守、巡逻、行军、侦察）+ 战斗（每半秒用网格找附近的敌人，兵上去打，平民逃）+ 进攻 / 护送 + 围城攻占
// + 领土（离城 1800 米内归最近的城）+ 斥候情报 + 流寇。
import type { GameModule } from '../../../engine/module';
import type { Sim } from '../../../engine/sim';
import { defineComponent } from '../../../engine/ecs';
import { Transform, Motion } from '../../../engine/motion';
import { Brain, type BehaviorDef, type Order } from '../../../engine/brain';
import type { CommandDef, Source } from '../../../engine/commands/types';
import type { Selector } from '../../../engine/commands/selector';
import { Rng } from '../../../shared/rng';
import type { Entity } from '../../../shared/types';
import type { EconomyApi } from '../economy';
import type { WorldApi, Place } from '../world';
import { Identity, Vitals, Notable, type PopulationApi, type Town } from '../population';
import { Profession, type JobsApi, type PlaceParam } from '../jobs';
import type { DiplomacyApi } from '../diplomacy';
import type { BuildingApi } from '../building';
import { PROFESSIONS } from '../../../../content/professions';

export const Combat = defineComponent('Combat', '战斗', { attack: 'f32', defense: 'f32', range: 'f32', cd: 'f32' }, { attack: '攻击（职业 × 兵器 × 兵营 × 将军）', defense: '减伤比例 0–1', range: '攻击距离（米）', cd: '下一次出手还要几秒' });
export const Equipment = defineComponent('Equipment', '装备', { weapon: 'u8', armor: 'u8' }, { weapon: '有没有兵器（士兵每天从仓库领；攻击 ×1.6）', armor: '护甲（预留）' });

export interface Intel {
  tick: number;
  town: string;
  faction: string;
  soldiers: number;
  food: number;
  walls: number;
}
export interface Siege {
  town: number;
  attacker: number;
  progress: number;
  need: number;
}
export type Target = { kind: 'town'; town: Town; place: Place } | { kind: 'region'; place: Place };
export interface MilitaryApi {
  /** 250×250 领土栅格，每格 = 势力序号，255 = 无主 */
  territory(): { version: number; size: number; data: Uint8Array };
  regionOwner(region: number): number;
  intel(faction: number): Intel[];
  sieges(): Siege[];
  spawnBandits(place: Place, n: number): number;
  /** 某势力的兵力（士兵数） */
  strength(faction: number): number;
  battles(): { region: string; a: string; b: string; dead: number[]; start: number; last: number }[];
}

const AGGRO = 70;
const WORKER_ALERT = 50;
const CELL = 80;
const TERR = 250;
const TERR_RANGE = 1800;

export const military: GameModule = {
  id: 'military',
  name: '军事',
  requires: ['world', 'economy', 'population', 'jobs', 'diplomacy', 'building'],
  components: [Combat, Equipment],
  actions: [
    {
      id: 'attack',
      text: '打一下（伤害 = 攻击 × (1 − 对方减伤) × 城墙减伤 × 随机 0.8–1.2）',
      run: (sim: Sim, e: Entity, t: Entity) => sim.service<MilitaryApi & { _attack(e: Entity, t: Entity): { ok: boolean } }>('military')._attack(e, t),
    },
  ],
  orders: [
    { id: 'guard', name: '驻守', params: ['place'], text: '守住某地（敌人靠近就打）' },
    { id: 'patrol', name: '巡逻', params: ['place'], text: '在区域里来回巡视' },
    { id: 'move', name: '行军', params: ['place'], text: '移动到某地并留在那里' },
    { id: 'scout', name: '侦察', params: ['place'], text: '去某地四处看（看到的城写进情报库）' },
    { id: 'attack', name: '进攻', params: ['target'], text: '开到目标处，见敌就打；守军打光就围城，围够时间就攻占' },
    { id: 'escort', name: '护送', params: ['targets'], text: '跟着被护送的人走，有敌人就打' },
  ],
  views: [
    { id: 'armies', text: '部队、战斗、围城' },
    { id: 'territory', text: '领土栅格（250×250）' },
    { id: 'intel', text: '情报库（每个势力只看得到自己的）' },
  ],
  events: [
    { id: 'battle.started', module: 'military', text: '交战开始（某地区两个势力第一次交手）' },
    { id: 'battle.ended', module: 'military', text: '交战结束（一天没再交手；带双方死亡数）' },
    { id: 'settlement.besieged', module: 'military', text: '城被围（守军打光了）' },
    { id: 'settlement.captured', module: 'military', text: '城被攻占' },
    { id: 'settlement.looted', module: 'military', text: '城被流寇劫掠' },
  ],
  argTypes: [
    {
      id: 'target',
      name: '目标',
      parse(tok, { sim }) {
        const pop = sim.service<PopulationApi>('population');
        const world = sim.service<WorldApi>('world');
        let name = tok;
        if (tok.includes('.')) {
          const [f, t] = tok.split('.');
          const town = pop.townByName(t);
          if (!town) return { ok: false, error: `没有叫「${t}」的城镇` };
          if (pop.factions[town.faction].name !== f) return { ok: false, error: `${t} 现在不归 ${f}，归 ${pop.factions[town.faction].name}` };
          name = t;
        }
        const town = pop.townByName(name);
        if (town) return { ok: true, value: { kind: 'town', town, place: world.place(name)! } as Target };
        const fi = pop.factionIndex(name);
        if (fi >= 0 && pop.factions[fi].towns.length) {
          const t = pop.towns[pop.factions[fi].towns[0]];
          return { ok: true, value: { kind: 'town', town: t, place: world.place(t.name)! } as Target };
        }
        const p = world.place(name);
        if (p && p.kind === 'region') return { ok: true, value: { kind: 'region', place: p } as Target };
        return { ok: false, error: `「${tok}」不是城镇、势力或地区`, hint: '如 赤焰.落霞镇、落霞镇、东山' };
      },
    },
  ],
  hash(sim, mix) {
    for (const s of sim.service<MilitaryApi>('military').sieges()) (mix(s.town), mix(s.attacker), mix(s.progress));
  },
  save: {
    version: 1,
    save: (sim) => sim.service<MilitaryApi & { _state(): unknown }>('military')._state(),
    load: (sim, d) => sim.service<MilitaryApi & { _load(d: unknown): void }>('military')._load(d),
  },
  install(api) {
    const sim: Sim = api.sim;
    const world = api.use<WorldApi>('world');
    const eco = api.use<EconomyApi>('economy');
    const pop = api.use<PopulationApi>('population');
    const jobs = api.use<JobsApi>('jobs');
    const dip = api.use<DiplomacyApi>('diplomacy');
    const bld = api.use<BuildingApi>('building');
    const rng = new Rng(sim.seed ^ 0x3a11);
    const W = sim.world;
    const B = W.get(Brain);
    const M = W.get(Motion);
    const P = W.get(Transform);
    const I = W.get(Identity);
    const V = W.get(Vitals);
    const N = W.get(Notable);
    const PR = W.get(Profession);
    const A = W.get(Combat);
    const EQ = W.get(Equipment);
    const F = pop.factions;
    const SOLDIER = jobs.profIndex('soldier');
    const SCOUT = jobs.profIndex('scout');
    const canFight = PROFESSIONS.map((p) => p.behaviors.includes('fight'));
    const isMil = PROFESSIONS.map((p) => p.tags.includes('military'));

    // ---------------------------------------------------------------- 战斗属性
    const refresh = (e: Entity) => {
      if (!W.has(e, Profession)) return;
      if (!W.has(e, Combat)) W.add(e, Combat);
      if (!W.has(e, Equipment)) W.add(e, Equipment);
      const p = PROFESSIONS[PR.prof[e]];
      const t = pop.towns[I.home[e]];
      const barracks = PR.prof[e] === SOLDIER && t && t.faction === I.faction[e] && (t.buildings.barracks ?? 0) > 0 ? 1.25 : 1;
      const general = N.has[e] && pop.notableTitle(e) === '将军' ? 1.5 : 1;
      A.attack[e] = p.stats.attack * (EQ.weapon[e] ? 1.6 : 1) * barracks * general;
      A.defense[e] = PR.prof[e] === SOLDIER ? 0.2 : 0;
      A.range[e] = PR.prof[e] === SOLDIER ? 10 : 5;
    };
    pop.onSpawn.push(refresh);
    pop.onRehome.push(refresh);
    sim.events.on('npc.retrained', (ev) => refresh(ev.data.e as Entity));
    api.onStart(() => {
      for (const e of pop.npcs()) {
        refresh(e);
        if (PR.prof[e] === SOLDIER) EQ.weapon[e] = 1;
        refresh(e);
      }
      rebuildTerritory();
    });

    // ---------------------------------------------------------------- 敌我网格
    const size = world.map.size;
    const GW = Math.ceil(size / CELL);
    const head = new Int32Array(GW * GW);
    let next = new Int32Array(W.capacity);
    const enemy = new Int32Array(W.capacity).fill(-1);
    const threatAt = new Int32Array(W.capacity).fill(-1);
    const hostileF = new Uint8Array(32 * 32);
    const factionHostile = new Uint8Array(32);
    const refreshHostility = () => {
      hostileF.fill(0);
      factionHostile.fill(0);
      for (let a = 0; a < F.length; a++)
        for (let b = 0; b < F.length; b++)
          if (F[a].alive && F[b].alive && dip.hostile(a, b)) {
            hostileF[a * 32 + b] = 1;
            factionHostile[a] = 1;
          }
    };
    const cellOf = (x: number, y: number) => Math.min(GW - 1, Math.max(0, Math.floor(y / CELL))) * GW + Math.min(GW - 1, Math.max(0, Math.floor(x / CELL)));
    const buildGrid = () => {
      head.fill(-1);
      if (next.length < W.capacity) next = new Int32Array(W.capacity);
      for (const e of pop.npcs()) {
        const c = cellOf(P.x[e], P.y[e]);
        next[e] = head[c];
        head[c] = e;
      }
    };
    /** 在 (x,y) 附近 r 米内找：满足 pred 的最近的人 */
    const nearest = (x: number, y: number, r: number, pred: (o: Entity) => boolean): Entity => {
      const cx = Math.floor(x / CELL);
      const cy = Math.floor(y / CELL);
      const k = Math.ceil(r / CELL);
      let best = -1;
      let bd = r * r;
      for (let gy = Math.max(0, cy - k); gy <= Math.min(GW - 1, cy + k); gy++)
        for (let gx = Math.max(0, cx - k); gx <= Math.min(GW - 1, cx + k); gx++)
          for (let o = head[gy * GW + gx]; o >= 0; o = next[o]) {
            const d = (P.x[o] - x) ** 2 + (P.y[o] - y) ** 2;
            if (d < bd && pred(o)) ((bd = d), (best = o));
          }
      return best;
    };
    const FIGHT = () => sim.brains.behaviors.findIndex((b) => b.id === 'fight') + 1;
    const FLEE = () => sim.brains.behaviors.findIndex((b) => b.id === 'flee') + 1;
    sim.scheduler.add(
      {
        id: 'military.scan',
        phase: 'resolve',
        every: 5,
        run() {
          refreshHostility();
          let any = false;
          for (let f = 0; f < F.length; f++) any ||= factionHostile[f] === 1;
          if (!any) {
            enemy.fill(-1);
            return;
          }
          buildGrid();
          const fight = FIGHT();
          const flee = FLEE();
          for (const e of pop.npcs()) {
            const fe = I.faction[e];
            if (!factionHostile[fe]) {
              enemy[e] = -1;
              continue;
            }
            if (canFight[PR.prof[e]]) {
              const cur = enemy[e];
              if (cur >= 0 && W.alive[cur] && I.has[cur] && hostileF[fe * 32 + I.faction[cur]] && (P.x[cur] - P.x[e]) ** 2 + (P.y[cur] - P.y[e]) ** 2 < (AGGRO * 1.8) ** 2) continue;
              let t = nearest(P.x[e], P.y[e], AGGRO, (o) => hostileF[fe * 32 + I.faction[o]] === 1 && isMil[PR.prof[o]]);
              if (t < 0) t = nearest(P.x[e], P.y[e], AGGRO, (o) => hostileF[fe * 32 + I.faction[o]] === 1);
              enemy[e] = t;
              if (t >= 0 && B.beh[e] !== fight) sim.brains.interrupt(e);
            } else {
              const t = nearest(P.x[e], P.y[e], WORKER_ALERT, (o) => hostileF[fe * 32 + I.faction[o]] === 1 && canFight[PR.prof[o]]);
              threatAt[e] = t >= 0 ? sim.clock.tick : -1;
              if (t >= 0) {
                enemy[e] = t;
                if (B.beh[e] !== flee) sim.brains.interrupt(e);
              }
            }
          }
        },
      },
      'military',
    );
    jobs.threat = (e) => (threatAt[e] >= 0 && sim.clock.tick - threatAt[e] <= 10 && enemy[e] >= 0 && W.alive[enemy[e]] ? [P.x[enemy[e]], P.y[enemy[e]]] : null);

    // ---------------------------------------------------------------- 交战记录
    type Battle = { region: number; a: number; b: number; dead: [number, number]; start: number; last: number };
    let battles = new Map<string, Battle>();
    const kills = new Map<number, number>();
    const noteHit = (att: Entity, def: Entity, died: boolean) => {
      const fa = I.faction[att];
      const fb = I.faction[def];
      const region = P.region[def];
      const k = `${region}:${Math.min(fa, fb)}:${Math.max(fa, fb)}`;
      let b = battles.get(k);
      if (!b) {
        b = { region, a: Math.min(fa, fb), b: Math.max(fa, fb), dead: [0, 0], start: sim.clock.tick, last: sim.clock.tick };
        battles.set(k, b);
        sim.events.emit('battle.started', sim.clock.tick, { region: world.map.regions[region]?.name || '野外', a: F[fa].name, b: F[fb].name }, 'all');
      }
      b.last = sim.clock.tick;
      if (died) {
        b.dead[fb === b.a ? 0 : 1]++;
        kills.set(fa, (kills.get(fa) ?? 0) + 1);
      }
    };

    const attack = (e: Entity, t: Entity) => {
      {
        if (!W.alive[t] || !I.has[t]) return { ok: false, reason: '目标没了' };
        if ((P.x[t] - P.x[e]) ** 2 + (P.y[t] - P.y[e]) ** 2 > (A.range[e] + 2) ** 2) return { ok: false, reason: '够不着' };
        const home = pop.towns[I.home[t]];
        const inWalls = home && home.faction === I.faction[t] && (P.x[t] - home.x) ** 2 + (P.y[t] - home.y) ** 2 < (home.radius + 20) ** 2 ? 1 - 0.2 * home.walls : 1;
        const dmg = A.attack[e] * (1 - (A.defense[t] ?? 0)) * inWalls * rng.range(0.8, 1.2);
        V.hp[t] -= dmg;
        A.cd[e] = 1;
        const died = V.hp[t] <= 0;
        noteHit(e, t, died);
        if (died) pop.kill(t, '战死', I.faction[e]);
        return { ok: true, value: dmg };
      }
    };

    // ---------------------------------------------------------------- 行为
    const wander = (id: string, name: string, orders: string[], text: string, radius: (p: PlaceParam | undefined) => number, wait: [number, number]): BehaviorDef => ({
      id,
      name,
      orders,
      acts: ['moveTo', 'wait'],
      text,
      fits: (_s, _e, o) => (o && orders.includes(o.type) ? 50 : 0),
      start(_s, e, o) {
        const p = o!.params.place as PlaceParam | undefined;
        const [cx, cy] = jobs.placePos(e, p);
        const [x, y] = world.landPointNear(cx, cy, radius(p), rng);
        sim.act('moveTo', e, x, y);
        return true;
      },
      tick(_s, e, _o, dt) {
        if (B.step[e] === 0) {
          if (M.moving[e]) return 'running';
          B.step[e] = 1;
          B.timer[e] = rng.range(wait[0], wait[1]);
          return 'running';
        }
        B.timer[e] -= dt;
        return B.timer[e] > 0 ? 'running' : 'done';
      },
    });
    const isTown = (p: PlaceParam | undefined) => p === 'home' || (p as Place | undefined)?.kind === 'town';
    const behaviors: BehaviorDef[] = [
      wander('guard', '站岗', ['guard'], '守在指定地点附近（城镇：城墙一圈）', (p) => (isTown(p) ? 70 : 60), [4, 10]),
      wander('patrol', '巡逻', ['patrol'], '在区域里来回走', () => 300, [1, 3]),
      wander('march', '行军', ['move', 'attack'], '走到目的地留在那里；进攻时开进目标城', (p) => (isTown(p) ? 35 : 60), [3, 6]),
      wander('scout', '探查', ['scout'], '在区域里四处看（平时在自家周边 1.5 公里转）', (p) => (p === 'home' || (p as Place)?.kind === 'town' ? 1500 : 500), [1, 3]),
      {
        id: 'fight',
        name: '交战',
        orders: [],
        support: true,
        acts: ['moveTo', 'attack'],
        text: '附近 70 米有敌人就冲上去打（优先打兵）；对方死了或跑远了就回去执行原来的命令',
        fits: (_s, e) => (enemy[e] >= 0 && W.alive[enemy[e]] ? 200 : 0),
        start(_s, e) {
          B.target[e] = enemy[e];
          sim.act('moveTo', e, P.x[enemy[e]], P.y[enemy[e]]);
          return true;
        },
        tick(_s, e, _o, dt) {
          const t = B.target[e];
          if (t < 0 || !W.alive[t] || !I.has[t] || !dip.hostile(I.faction[e], I.faction[t])) return 'done';
          const d2 = (P.x[t] - P.x[e]) ** 2 + (P.y[t] - P.y[e]) ** 2;
          if (d2 > (AGGRO * 2) ** 2) return 'done';
          A.cd[e] -= dt;
          if (d2 <= A.range[e] ** 2) {
            if (M.moving[e]) sim.act('stop', e);
            if (A.cd[e] <= 0) sim.act('attack', e, t);
            return 'running';
          }
          B.timer[e] -= dt;
          if (B.timer[e] <= 0 || !M.moving[e]) {
            sim.act('moveTo', e, P.x[t], P.y[t]);
            B.timer[e] = 1;
          }
          return 'running';
        },
      },
      {
        id: 'escort',
        name: '护送',
        orders: ['escort'],
        acts: ['moveTo', 'wait'],
        text: '跟在被护送的人身边（15 米内）；被护送的人都没了就回去',
        fits(_s, _e, o) {
          if (o?.type !== 'escort') return 0;
          return (o.params.targets as Entity[]).some((x) => W.alive[x] && I.has[x]) ? 50 : 0;
        },
        start(_s, e, o) {
          const alive = (o!.params.targets as Entity[]).filter((x) => W.alive[x] && I.has[x]);
          const cx = alive.reduce((s, x) => s + P.x[x], 0) / alive.length;
          const cy = alive.reduce((s, x) => s + P.y[x], 0) / alive.length;
          const [x, y] = world.landPointNear(cx, cy, 15, rng);
          sim.act('moveTo', e, x, y);
          B.timer[e] = 1.5;
          return true;
        },
        tick(_s, e, _o, dt) {
          B.timer[e] -= dt;
          return B.timer[e] > 0 ? 'running' : 'done';
        },
      },
    ];
    for (const b of behaviors) api.addBehavior(b);

    // ---------------------------------------------------------------- 领土
    const terr = new Uint8Array(TERR * TERR).fill(255);
    let terrVersion = 0;
    let terrKey = '';
    const rebuildTerritory = () => {
      const k = pop.towns.map((t) => t.faction).join(',');
      if (k === terrKey) return;
      terrKey = k;
      const cs = size / TERR;
      for (let y = 0; y < TERR; y++)
        for (let x = 0; x < TERR; x++) {
          const px = (x + 0.5) * cs;
          const py = (y + 0.5) * cs;
          let best = 255;
          let bd = TERR_RANGE * TERR_RANGE;
          for (const t of pop.towns) {
            const d = (t.x - px) ** 2 + (t.y - py) ** 2;
            if (d < bd) ((bd = d), (best = t.faction));
          }
          terr[y * TERR + x] = best;
        }
      terrVersion++;
    };
    const regionOwner = (region: number) => {
      const r = world.map.regions[region];
      if (!r) return 255;
      const cs = size / TERR;
      return terr[Math.min(TERR - 1, Math.floor(r.cy / cs)) * TERR + Math.min(TERR - 1, Math.floor(r.cx / cs))];
    };

    // ---------------------------------------------------------------- 围城
    let sieges = new Map<number, Siege>();
    const looted = new Map<number, number>();
    sim.scheduler.add(
      {
        id: 'military.siege',
        phase: 'resolve',
        every: 10,
        run() {
          if (!factionHostile.some((x) => x)) {
            if (sieges.size) sieges.clear();
            return;
          }
          for (const t of pop.towns) {
            const r = t.radius + 60;
            const count = new Map<number, number>();
            let defenders = 0;
            const cx = Math.floor(t.x / CELL);
            const cy = Math.floor(t.y / CELL);
            const k = Math.ceil(r / CELL);
            for (let gy = Math.max(0, cy - k); gy <= Math.min(GW - 1, cy + k); gy++)
              for (let gx = Math.max(0, cx - k); gx <= Math.min(GW - 1, cx + k); gx++)
                for (let o = head[gy * GW + gx]; o >= 0; o = next[o]) {
                  if (!canFight[PR.prof[o]] || (P.x[o] - t.x) ** 2 + (P.y[o] - t.y) ** 2 > r * r) continue;
                  const f = I.faction[o];
                  if (f === t.faction) defenders++;
                  else if (hostileF[f * 32 + t.faction]) count.set(f, (count.get(f) ?? 0) + 1);
                }
            const att = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
            let s = sieges.get(t.id);
            if (!att) {
              if (s) sieges.delete(t.id);
              continue;
            }
            if (!s || s.attacker !== att[0]) {
              s = { town: t.id, attacker: att[0], progress: 0, need: 50 + t.walls * 100 };
              sieges.set(t.id, s);
              sim.events.emit('settlement.besieged', sim.clock.tick, { town: t.name, by: F[att[0]].name, defenders, attackers: att[1] }, 'all');
            }
            if (defenders > 0) continue;
            s.progress += 10;
            if (s.progress < s.need) continue;
            sieges.delete(t.id);
            if (F[att[0]].kind === 'bandit') {
              const st = eco.stores[t.store].stock;
              const food = st[eco.itemIndex('food')] * 0.4;
              const gold = st[eco.itemIndex('gold')] * 0.4;
              sim.act('convert', t.store, [['food', food], ['gold', gold]], []);
              t.mood = Math.max(0, t.mood - 20);
              looted.set(t.id, sim.clock.tick);
              sim.events.emit('settlement.looted', sim.clock.tick, { town: t.name, food: Math.round(food), gold: Math.round(gold) }, 'all');
              retargetBandits();
              continue;
            }
            const from = F[t.faction].name;
            if (t.walls > 0) bld.destroy(t, 'wall', '攻城时被毁');
            pop.setTownFaction(t, att[0], '攻占');
            rebuildTerritory();
            sim.events.emit('settlement.captured', sim.clock.tick, { town: t.name, from, to: F[att[0]].name }, 'all');
          }
        },
      },
      'military',
    );
    sim.events.on('settlement.rebelled', () => rebuildTerritory());

    // ---------------------------------------------------------------- 每天：领兵器、刷新属性、情报、交战结束、流寇
    const intel = new Map<number, Map<number, Intel>>();
    const BANDIT = pop.banditFaction();
    const banditOrders = new Map<number, Order>();
    const retargetBandits = () => {
      const now = sim.clock.tick;
      for (const e of pop.npcs()) {
        if (I.faction[e] !== BANDIT) continue;
        let best: Town | undefined;
        let bd = Infinity;
        for (const t of pop.towns) {
          if (now - (looted.get(t.id) ?? -1e9) < 500) continue;
          const d = (t.x - P.x[e]) ** 2 + (t.y - P.y[e]) ** 2;
          if (d < bd) ((bd = d), (best = t));
        }
        if (!best) continue;
        let o = banditOrders.get(best.id);
        if (!o || sim.brains.order(o.id) !== o) {
          o = sim.brains.createOrder('attack', { place: world.place(best.name)! }, `劫掠 ${best.name}`, F[BANDIT].name);
          banditOrders.set(best.id, o);
        }
        if (B.order[e] !== o.id) {
          sim.brains.setDefault(e, o);
          sim.brains.release(e);
        }
      }
    };
    sim.scheduler.add(
      {
        id: 'military.daily',
        phase: 'post',
        every: 100,
        run() {
          const now = sim.clock.tick;
          const weapon = eco.itemIndex('weapon');
          for (const e of pop.npcs()) {
            if (PR.prof[e] === SOLDIER && !EQ.weapon[e] && I.faction[e] !== BANDIT) {
              const t = pop.towns[I.home[e]];
              if (t && t.faction === I.faction[e] && eco.stores[t.store].stock[weapon] >= 1 && sim.act('convert', t.store, [['weapon', 1]], []).ok) EQ.weapon[e] = 1;
            }
            if (I.faction[e] === BANDIT) {
              V.hp[e] -= 3;
              if (V.hp[e] <= 0) {
                pop.kill(e, '散伙');
                continue;
              }
            }
            refresh(e);
          }
          for (const [k, b] of battles) {
            if (now - b.last < 100) continue;
            battles.delete(k);
            sim.events.emit('battle.ended', now, { region: world.map.regions[b.region]?.name || '野外', a: F[b.a].name, b: F[b.b].name, dead: { [F[b.a].name]: b.dead[0], [F[b.b].name]: b.dead[1] } }, 'all');
          }
          retargetBandits();
          rebuildTerritory();
        },
      },
      'military',
    );
    sim.scheduler.add(
      {
        id: 'military.intel',
        phase: 'post',
        every: 50,
        run() {
          for (const e of pop.npcs()) {
            if (PR.prof[e] !== SCOUT) continue;
            const fe = I.faction[e];
            for (const t of pop.towns) {
              if (t.faction === fe || (t.x - P.x[e]) ** 2 + (t.y - P.y[e]) ** 2 > 400 * 400) continue;
              const soldiers = pop.residents(t.id).filter((x) => canFight[PR.prof[x]]).length;
              if (!intel.has(fe)) intel.set(fe, new Map());
              intel.get(fe)!.set(t.id, { tick: sim.clock.tick, town: t.name, faction: F[t.faction].name, soldiers, food: Math.round(eco.stores[t.store].stock[eco.itemIndex('food')]), walls: t.walls });
            }
          }
        },
      },
      'military',
    );

    // ---------------------------------------------------------------- 命令
    const sel = (a: Record<string, unknown>, src: Source) => sim.bus.select(a['人'] as Selector, src);
    const cmd = (id: string, verb: string, order: string, placeArg: string, help: string, examples: string[], label: (p: PlaceParam) => string, optional = false): CommandDef => ({
      id,
      verb,
      aliases: [id],
      who: ['lord'],
      order,
      args: [['人', 'sel'], [placeArg + (optional ? '?' : ''), 'place']],
      help,
      examples,
      run({ src }, a) {
        const p = (a[placeArg] as Place | undefined) ?? 'home';
        return jobs.dispatch(src, sel(a, src), order, { place: p }, label(p));
      },
    });
    const nameOf = (p: PlaceParam) => (p === 'home' ? '所属城镇' : p.name);
    const commands: CommandDef[] = [
      cmd('guard', '守', 'guard', '地点', '驻守某地', ['守 #二队 青石城'], (p) => `驻守 ${nameOf(p)}`),
      cmd('patrol', '巡', 'patrol', '区域', '在区域里巡逻', ['巡 @兵:6 北林'], (p) => `巡逻 ${nameOf(p)}`),
      cmd('retreat', '撤', 'move', '地点', '撤回（不写地点就回所属城镇）', ['撤 #一队'], (p) => `撤回 ${nameOf(p)}`, true),
      cmd('scout', '探', 'scout', '区域', '侦察某地，看到的城写进情报库', ['探 @斥:2 东山'], (p) => `侦察 ${nameOf(p)}`),
      {
        id: 'attack',
        verb: '攻',
        aliases: ['attack'],
        who: ['lord'],
        order: 'attack',
        args: [['人', 'sel'], ['目标', 'target']],
        help: '进攻城镇或地区；对方没在交战就自动宣战（有条约会撕毁，掉声望）',
        examples: ['攻 #一队 赤焰.落霞镇', '攻 @兵:30 赤焰城'],
        run({ src }, a) {
          const t = a['目标'] as Target;
          const me = pop.factionIndex(src.faction!);
          const owner = t.kind === 'town' ? t.town.faction : regionOwner(t.place.id);
          if (owner === me) return { ok: false, msg: `${t.place.name} 是你自己的地盘` };
          const warns: string[] = [];
          if (owner !== 255 && F[owner] && (F[owner].kind === 'lord' || F[owner].kind === 'rebel') && !dip.atWar(me, owner)) {
            const broken = dip.declareWar(me, owner, `进攻 ${t.place.name}`);
            warns.push(`已向 ${F[owner].name} 宣战${broken.length ? `，撕毁了${broken.join('、')}（声望下降）` : ''}`);
          }
          const r = jobs.dispatch(src, sel(a, src), 'attack', { place: t.place }, `进攻 ${t.place.name}`, { filter: (e) => canFight[PR.prof[e]], why: '不是兵' });
          return { ...r, warns: [...warns, ...(r.warns ?? [])] };
        },
      },
      {
        id: 'escort',
        verb: '护',
        aliases: ['escort'],
        who: ['lord'],
        order: 'escort',
        args: [['人', 'sel'], ['对象', 'sel']],
        help: '派兵护送一批人（商队、运粮队）',
        examples: ['护 #三队 #商队'],
        run({ src }, a) {
          const targets = sim.bus.select(a['对象'] as Selector, src);
          if (!targets.length) return { ok: false, msg: '没选中要护送的人' };
          const guards = sel(a, src).filter((e) => !targets.includes(e));
          return jobs.dispatch(src, guards, 'escort', { targets }, `护送 ${targets.length} 人`, { filter: (e) => canFight[PR.prof[e]], why: '不是兵' });
        },
      },
    ];
    for (const c of commands) api.addCommand(c);

    // ---------------------------------------------------------------- 公开接口
    const ma: MilitaryApi = {
      territory: () => ({ version: terrVersion, size: TERR, data: terr }),
      regionOwner,
      intel: (f) => [...(intel.get(f)?.values() ?? [])],
      sieges: () => [...sieges.values()],
      spawnBandits(place, n) {
        let home = pop.towns[0];
        let bd = Infinity;
        for (const t of pop.towns) {
          const d = (t.x - place.x) ** 2 + (t.y - place.y) ** 2;
          if (d < bd) ((bd = d), (home = t));
        }
        for (let i = 0; i < n; i++) {
          const e = pop.spawn(home, undefined, BANDIT, [place.x, place.y]);
          jobs.setProfession(e, SOLDIER);
          EQ.weapon[e] = 1;
          refresh(e);
        }
        retargetBandits();
        return n;
      },
      strength: (f) => pop.npcs().filter((e) => I.faction[e] === f && canFight[PR.prof[e]]).length,
      battles: () => [...battles.values()].map((b) => ({ region: world.map.regions[b.region]?.name || '野外', a: F[b.a].name, b: F[b.b].name, dead: [...b.dead], start: b.start, last: b.last })),
    };
    Object.assign(ma, {
      _attack: attack,
      _state: () => ({
        rng: rng.state,
        sieges: [...sieges.values()],
        looted: [...looted],
        battles: [...battles],
        kills: [...kills],
        banditOrders: [...banditOrders].map(([k, o]) => [k, o.id]),
        intel: [...intel].map(([f, m]) => [f, [...m]]),
      }),
      _load(d: { rng: number; sieges: Siege[]; looted: [number, number][]; battles: [string, Battle][]; kills: [number, number][]; intel: [number, [number, Intel][]][] }) {
        rng.state = d.rng;
        banditOrders.clear();
        for (const [k, id] of (d as unknown as { banditOrders: [number, number][] }).banditOrders ?? []) {
          const o = sim.brains.order(id);
          if (o) banditOrders.set(k, o);
        }
        sieges = new Map(d.sieges.map((s) => [s.town, s]));
        looted.clear();
        for (const [k, v] of d.looted) looted.set(k, v);
        battles = new Map(d.battles);
        kills.clear();
        for (const [k, v] of d.kills) kills.set(k, v);
        intel.clear();
        for (const [f, m] of d.intel) intel.set(f, new Map(m));
        terrKey = '';
        rebuildTerritory();
        enemy.fill(-1);
        threatAt.fill(-1);
      },
    });
    api.expose<MilitaryApi>(ma);
  },
};
