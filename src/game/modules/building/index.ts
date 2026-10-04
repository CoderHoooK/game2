// 建造模块：诸侯下「建」→ 立即从仓库扣材料、立一个工地 → 建筑工去工地出工时 → 建成生效。
// 效果：房屋加人口上限、农田加田、城墙守城、兵营 / 铁匠铺 / 市场 / 仓库加成、伐木场等让本地区资源恢复更快。
import type { GameModule } from '../../../engine/module';
import type { Sim } from '../../../engine/sim';
import { Transform, Motion } from '../../../engine/motion';
import { Brain } from '../../../engine/brain';
import type { CommandDef } from '../../../engine/commands/types';
import type { Selector } from '../../../engine/commands/selector';
import { Rng } from '../../../shared/rng';
import type { Entity } from '../../../shared/types';
import type { BuildingDef } from '../../../shared/content';
import type { EconomyApi } from '../economy';
import { Identity, type PopulationApi, type Town } from '../population';
import { Profession, type JobsApi, type PlaceParam } from '../jobs';
import type { Place, WorldApi } from '../world';
import { BUILDINGS, CITY } from '../../../../content/buildings';

export interface Site {
  id: number;
  building: string;
  faction: number;
  /** 城里的建筑：城镇序号；地区建筑：-1 */
  town: number;
  region: number;
  x: number;
  y: number;
  progress: number;
}
export interface BuildingApi {
  sites: Site[];
  def(id: string): BuildingDef | undefined;
  /** 地区建筑（伐木场等）：地区 → 建筑 ID → 座数 */
  regionBuildings(region: number): Record<string, number>;
  /** 拆掉 / 打掉一座（攻城时城墙被毁用） */
  destroy(town: Town, building: string, why: string): boolean;
}

const REGION_KIND: Record<string, string> = { lumber: 'wood', quarry: 'stone', mine: 'iron' };
/** 建筑工离己方城多远以内的地区能建（米） */
const REGION_RANGE = 2500;

export const building: GameModule = {
  id: 'building',
  name: '建造',
  requires: ['world', 'economy', 'population', 'jobs'],
  orders: [{ id: 'build', name: '施工', params: ['place'], text: '去工地出工（平时：自家城里的工地）' }],
  views: [{ id: 'sites', text: '工地和建筑' }],
  events: [
    { id: 'building.done', module: 'building', text: '建筑完工' },
    { id: 'building.destroyed', module: 'building', text: '建筑被拆或被毁' },
    { id: 'settlement.founded', module: 'building', text: '空城址建成了新城' },
  ],
  argTypes: [
    {
      id: 'building',
      name: '建筑',
      parse(tok) {
        const b = BUILDINGS.find((x) => x.name === tok || x.id === tok);
        return b ? { ok: true, value: b } : { ok: false, error: `没有「${tok}」这种建筑`, hint: BUILDINGS.map((x) => x.name).join(' ') };
      },
      choices: () => BUILDINGS.map((x) => x.name),
    },
  ],
  hash(sim, mix) {
    for (const s of sim.service<BuildingApi>('building').sites) (mix(s.id), mix(Math.round(s.progress)));
  },
  save: {
    version: 1,
    save: (sim) => sim.service<BuildingApi & { _state(): unknown }>('building')._state(),
    load: (sim, d) => sim.service<BuildingApi & { _load(d: unknown): void }>('building')._load(d),
  },
  install(api) {
    const sim: Sim = api.sim;
    const world = api.use<WorldApi>('world');
    const eco = api.use<EconomyApi>('economy');
    const pop = api.use<PopulationApi>('population');
    const jobs = api.use<JobsApi>('jobs');
    const rng = new Rng(sim.seed ^ 0xb11d);
    const W = sim.world;
    const I = W.get(Identity);
    const P = W.get(Transform);
    const M = W.get(Motion);
    const B = W.get(Brain);
    const PR = W.get(Profession);
    const sites: Site[] = [];
    let nextId = 1;
    const regionB = new Map<number, Record<string, number>>();
    const def = (id: string) => (id === CITY.id ? CITY : BUILDINGS.find((b) => b.id === id));
    const count = (t: Town | null, region: number, id: string) =>
      (t ? t.buildings[id] ?? 0 : regionB.get(region)?.[id] ?? 0) + sites.filter((s) => s.building === id && (t ? s.town === t.id : s.region === region)).length;

    const apply = (s: Site, sign: 1 | -1) => {
      const t = s.town >= 0 ? pop.towns[s.town] : null;
      if (t) {
        t.buildings[s.building] = (t.buildings[s.building] ?? 0) + sign;
        if (s.building === 'house') t.cap += 30 * sign;
        if (s.building === 'wall') t.walls = t.buildings.wall;
        if (s.building === 'granary') eco.stores[t.store].spoil = 0.005 * 0.5 ** t.buildings.granary;
        if (s.building === 'farm' && sign > 0)
          for (let k = 0; k < 6; k++) {
            const [x, y] = world.landPointNear(t.x, t.y, t.radius + 40, rng);
            world.addNode('field', x, y);
          }
      } else {
        const r = regionB.get(s.region) ?? {};
        r[s.building] = (r[s.building] ?? 0) + sign;
        regionB.set(s.region, r);
        const kind = REGION_KIND[s.building];
        if (kind) world.setRegenMul(s.region, kind, r[s.building] > 0 ? 3 : 1);
      }
    };

    // ---- 建城：先建成的得城；同一城址上别人的工地作废，材料退回他们最近的城
    const refund = (s: Site) => {
      const back = pop.nearestTown(s.faction, s.x, s.y);
      if (back) eco.give(back.store, Object.entries(CITY.cost));
    };
    const finishCity = (s: Site) => {
      const t = pop.towns[s.town];
      sites.splice(sites.indexOf(s), 1);
      if (t.founded || !pop.factions[s.faction].alive) return refund(s);
      pop.found(t, s.faction);
      for (const o of sites.filter((x) => x.building === CITY.id && x.town === t.id)) {
        sites.splice(sites.indexOf(o), 1);
        refund(o);
      }
      sim.events.emit('settlement.founded', sim.clock.tick, { town: t.name, faction: pop.factions[s.faction].name }, 'all');
    };

    // ---- 施工行为
    const pickSite = (e: Entity, p: PlaceParam | undefined): Site | undefined => {
      const fi = I.faction[e];
      const mine = sites.filter((s) => s.faction === fi);
      if (!mine.length) return undefined;
      const place = p && p !== 'home' ? (p as Place) : null;
      const home = I.home[e];
      const pri = (s: Site) => {
        if (place?.kind === 'town' && s.town === place.id) return 0;
        if (place?.kind === 'region' && s.region === place.id) return 0;
        if (!place && s.town === home) return 1;
        return 2 + Math.hypot(s.x - P.x[e], s.y - P.y[e]) / 1e4;
      };
      // 指定了地点就只去那里；平时先自家城，再去近的
      const list = place ? mine.filter((s) => pri(s) === 0) : mine;
      return list.sort((a, b) => pri(a) - pri(b) || a.id - b.id)[0];
    };
    api.addBehavior({
      id: 'build',
      name: '施工',
      orders: ['build'],
      acts: ['moveTo', 'wait'],
      text: '去工地干活（每次 5 秒，熟练度越高出活越多）；工地建成就生效',
      fits: (_s, e, o) => (o?.type === 'build' && pickSite(e, o.params.place as PlaceParam) ? 45 : 0),
      start(_s, e, o) {
        const s = pickSite(e, o!.params.place as PlaceParam);
        if (!s) return false;
        B.target[e] = s.id;
        const [x, y] = world.landPointNear(s.x, s.y, 12, rng);
        sim.act('moveTo', e, x, y);
        return true;
      },
      tick(_s, e, _o, dt) {
        const s = sites.find((x) => x.id === B.target[e]);
        if (!s) return 'done';
        if (B.step[e] === 0) {
          if (M.moving[e]) return 'running';
          B.step[e] = 1;
          B.timer[e] = 5;
          return 'running';
        }
        B.timer[e] -= dt;
        if (B.timer[e] > 0) return 'running';
        s.progress += 5 * (1 + PR.skill[e] / 200);
        PR.skill[e] = Math.min(100, PR.skill[e] + 1);
        const d = def(s.building)!;
        if (s.progress >= d.work && s.building === CITY.id) {
          finishCity(s);
        } else if (s.progress >= d.work) {
          sites.splice(sites.indexOf(s), 1);
          apply(s, 1);
          const where = s.town >= 0 ? pop.towns[s.town].name : world.map.regions[s.region].name;
          sim.events.emit('building.done', sim.clock.tick, { building: d.name, where, faction: pop.factions[s.faction].name }, pop.factions[s.faction].name);
        }
        return 'done';
      },
    });

    // ---- 命令
    const ownerOk = (fi: number, region: number) => {
      const r = world.map.regions[region];
      return pop.factions[fi].towns.some((ti) => Math.hypot(pop.towns[ti].x - r.cx, pop.towns[ti].y - r.cy) <= REGION_RANGE);
    };
    const commands: CommandDef[] = [
      {
        id: 'build',
        verb: '建',
        aliases: ['build'],
        who: ['lord'],
        order: 'build',
        args: [['建筑', 'building'], ['地点', 'place'], ['人?', 'sel']],
        help: '立工地（马上扣材料），建筑工会去施工；给了人就派他们专门去',
        examples: ['建 兵营 青石城', '建 城墙 青石城 @建:6', '建 伐木场 北林'],
        run({ src }, a) {
          const d = a['建筑'] as BuildingDef;
          const place = a['地点'] as Place;
          const fi = pop.factionIndex(src.faction!);
          let t: Town | null = null;
          let region: number;
          let x: number;
          let y: number;
          if (d.site === 'town') {
            if (place.kind !== 'town') return { ok: false, msg: `${d.name}要建在城里` };
            t = pop.towns[place.id];
            if (t.faction !== fi) return { ok: false, msg: `${t.name} 不是你的城` };
            region = t.region;
            [x, y] = world.landPointNear(t.x, t.y, t.radius - 5, rng);
          } else {
            if (place.kind !== 'region') return { ok: false, msg: `${d.name}要建在地区里（比如有林子、矿的地方）` };
            region = place.id;
            if (!ownerOk(fi, region)) return { ok: false, msg: `${place.name} 离你的城太远（要在 ${REGION_RANGE / 1000} 公里内）` };
            [x, y] = [place.x, place.y];
          }
          if (count(t, region, d.id) >= d.max) return { ok: false, msg: `${place.name} 最多 ${d.max} 座${d.name}` };
          const store = t ? t.store : pop.towns[pop.nearestTown(fi, x, y)!.id].store;
          const cost = Object.entries(d.cost) as [string, number][];
          if (!eco.take(store, cost)) return { ok: false, msg: `材料不够：要 ${cost.map(([k, v]) => eco.items[eco.itemIndex(k)].name + v).join('、')}` };
          const s: Site = { id: nextId++, building: d.id, faction: fi, town: t ? t.id : -1, region, x, y, progress: 0 };
          sites.push(s);
          let msg = `${place.name} 开工建${d.name}（要 ${d.work} 工时）`;
          const warns: string[] = [];
          if (a['人']) {
            const r = jobs.dispatch(src, sim.bus.select(a['人'] as Selector, src), 'build', { place }, `建${d.name} @ ${place.name}`);
            msg += '；' + r.msg;
            warns.push(...(r.warns ?? []));
          }
          return { ok: true, msg, warns };
        },
      },
      {
        id: 'foundCity',
        verb: '建城',
        aliases: ['found'],
        who: ['lord'],
        order: 'build',
        args: [['城址', 'place'], ['人?', 'sel']],
        help: '在空城址上建一座新城（马上扣木头石头，建筑工去施工；别的诸侯也可能抢先建成）。建成后城里没有人，要靠人才市场招',
        examples: ['建城 河口镇'],
        run({ src }, a) {
          const place = a['城址'] as Place;
          if (place.kind !== 'town') return { ok: false, msg: '「建城」要写空城址的名字' };
          const t = pop.towns[place.id];
          const fi = pop.factionIndex(src.faction!);
          if (t.founded) return { ok: false, msg: `${t.name} 已经是${pop.factions[t.faction].name}的城了，不是空城址（想要它得打下来）` };
          if (!pop.factions[fi].towns.length) return { ok: false, msg: '你没有城了，没法出人出料建新城' };
          if (sites.some((s) => s.building === CITY.id && s.town === t.id && s.faction === fi)) return { ok: false, msg: `你已经在 ${t.name} 立了工地` };
          const from = pop.nearestTown(fi, t.x, t.y)!;
          const cost = Object.entries(CITY.cost) as [string, number][];
          if (!eco.take(from.store, cost)) return { ok: false, msg: `材料不够（从 ${from.name} 的仓库出）：要 ${cost.map(([k, v]) => eco.items[eco.itemIndex(k)].name + v).join('、')}` };
          sites.push({ id: nextId++, building: CITY.id, faction: fi, town: t.id, region: t.region, x: t.x, y: t.y, progress: 0 });
          let msg = `${t.name} 开工建城（要 ${CITY.work} 工时）`;
          const warns: string[] = [];
          if (a['人']) {
            const r = jobs.dispatch(src, sim.bus.select(a['人'] as Selector, src), 'build', { place }, `建城 @ ${t.name}`);
            msg += '；' + r.msg;
            warns.push(...(r.warns ?? []));
          }
          return { ok: true, msg, warns };
        },
      },
      {
        id: 'demolish',
        verb: '拆',
        aliases: ['demolish'],
        who: ['lord'],
        args: [['建筑', 'building'], ['地点', 'place']],
        help: '拆掉一座建筑（退一半材料）；没建完的工地退全部材料',
        examples: ['拆 伐木场 北林'],
        run({ src }, a) {
          const d = a['建筑'] as BuildingDef;
          const place = a['地点'] as Place;
          const fi = pop.factionIndex(src.faction!);
          const t = place.kind === 'town' ? pop.towns[place.id] : null;
          if (t && t.faction !== fi) return { ok: false, msg: `${t.name} 不是你的城` };
          const site = sites.find((s) => s.building === d.id && s.faction === fi && (t ? s.town === t.id : s.region === place.id));
          const tn = t ?? pop.nearestTown(fi, place.x, place.y);
          if (!tn) return { ok: false, msg: '你没有城了' };
          if (site) {
            sites.splice(sites.indexOf(site), 1);
            eco.give(tn.store, Object.entries(d.cost));
            return { ok: true, msg: `${place.name} 的${d.name}工地撤了，材料全退` };
          }
          const have = t ? t.buildings[d.id] ?? 0 : regionB.get(place.id)?.[d.id] ?? 0;
          if (!have) return { ok: false, msg: `${place.name} 没有${d.name}` };
          if (!t && !ownerOk(fi, place.id)) return { ok: false, msg: `${place.name} 不在你的地盘` };
          apply({ id: 0, building: d.id, faction: fi, town: t ? t.id : -1, region: place.id, x: 0, y: 0, progress: 0 }, -1);
          eco.give(tn.store, Object.entries(d.cost).map(([k, v]) => [k, Math.floor(v / 2)]));
          sim.events.emit('building.destroyed', sim.clock.tick, { building: d.name, where: place.name, why: '拆除' }, pop.factions[fi].name);
          return { ok: true, msg: `拆了 ${place.name} 的${d.name}，退回一半材料` };
        },
      },
    ];
    for (const c of commands) api.addCommand(c);

    // 城换主：没建完的工地归新主人
    sim.events.on('settlement.captured', (ev) => {
      const t = pop.townByName(ev.data.town as string);
      if (t) for (const s of sites) if (s.town === t.id) s.faction = t.faction;
    });
    sim.events.on('settlement.rebelled', (ev) => {
      const t = pop.townByName(ev.data.town as string);
      if (t) for (const s of sites) if (s.town === t.id) s.faction = t.faction;
    });

    const ba: BuildingApi = {
      sites,
      def,
      regionBuildings: (r) => regionB.get(r) ?? {},
      destroy(t, id, why) {
        if (!(t.buildings[id] > 0)) return false;
        apply({ id: 0, building: id, faction: t.faction, town: t.id, region: t.region, x: 0, y: 0, progress: 0 }, -1);
        sim.events.emit('building.destroyed', sim.clock.tick, { building: def(id)?.name, where: t.name, why }, 'all');
        return true;
      },
    };
    Object.assign(ba, {
      _state: () => ({ rng: rng.state, nextId, sites: sites.map((s) => ({ ...s })), region: [...regionB.entries()] }),
      _load(d: { rng: number; nextId: number; sites: Site[]; region: [number, Record<string, number>][] }) {
        rng.state = d.rng;
        nextId = d.nextId;
        sites.length = 0;
        sites.push(...d.sites);
        regionB.clear();
        for (const [k, v] of d.region) regionB.set(k, v);
      },
    });
    api.expose<BuildingApi>(ba);
  },
};
