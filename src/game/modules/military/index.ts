// 军事模块（第 0 阶段只有"走位"：驻守、巡逻、行军、侦察）。
// 第 2 阶段加：战斗、进攻、护送、围城、补给；Combat / Equipment 组件。
import type { GameModule } from '../../../engine/module';
import type { Sim } from '../../../engine/sim';
import { Motion } from '../../../engine/motion';
import { Brain, type BehaviorDef } from '../../../engine/brain';
import type { CommandDef, Source } from '../../../engine/commands/types';
import type { Selector } from '../../../engine/commands/selector';
import { Rng } from '../../../shared/rng';
import type { WorldApi, Place } from '../world';
import type { JobsApi, PlaceParam } from '../jobs';

export const military: GameModule = {
  id: 'military',
  name: '军事',
  requires: ['world', 'population', 'jobs'],
  orders: [
    { id: 'guard', name: '驻守', params: ['place'], text: '守住某地（第 2 阶段起：敌人进入就打）' },
    { id: 'patrol', name: '巡逻', params: ['place'], text: '在区域里来回巡视' },
    { id: 'move', name: '行军', params: ['place'], text: '移动到某地并留在那里' },
    { id: 'scout', name: '侦察', params: ['place'], text: '去某地四处看（第 4 阶段起写进情报库）' },
  ],
  views: [{ id: 'armies', text: '部队（第 2 阶段）' }],
  install(api) {
    const sim: Sim = api.sim;
    const world = api.use<WorldApi>('world');
    const jobs = api.use<JobsApi>('jobs');
    const rng = new Rng(sim.seed ^ 0x3a11);
    const B = sim.world.get(Brain);
    const M = sim.world.get(Motion);

    /** 走到地点附近的随机陆地点，到了以后停一会儿 */
    const wander = (id: string, name: string, order: string, text: string, radius: (p: PlaceParam | undefined) => number, wait: [number, number]): BehaviorDef => ({
      id,
      name,
      orders: [order],
      acts: ['moveTo', 'wait'],
      text,
      fits: (_s, _e, o) => (o?.type === order ? 50 : 0),
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
    for (const b of [
      wander('guard', '站岗', 'guard', '守在指定地点附近（城镇：城墙一圈）', (p) => (isTown(p) ? 70 : 60), [4, 10]),
      wander('patrol', '巡逻', 'patrol', '在区域里来回走', () => 300, [1, 3]),
      wander('march', '行军', 'move', '走到目的地，留在那里', () => 25, [5, 8]),
      wander('scout', '探查', 'scout', '在区域里四处看（平时在自家周边 1.5 公里转）', (p) => (p === 'home' || (p as Place)?.kind === 'town' ? 1500 : 500), [1, 3]),
    ])
      api.addBehavior(b);

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
    for (const c of [
      cmd('guard', '守', 'guard', '地点', '驻守某地', ['守 #二队 青石城'], (p) => `驻守 ${nameOf(p)}`),
      cmd('patrol', '巡', 'patrol', '区域', '在区域里巡逻', ['巡 @兵:6 北林'], (p) => `巡逻 ${nameOf(p)}`),
      cmd('retreat', '撤', 'move', '地点', '撤回（不写地点就回所属城镇）', ['撤 #一队'], (p) => `撤回 ${nameOf(p)}`, true),
      cmd('scout', '探', 'scout', '区域', '侦察某地，结果写进情报库（第 4 阶段）', ['探 @斥:2 东山'], (p) => `侦察 ${nameOf(p)}`),
    ])
      api.addCommand(c);
  },
};
