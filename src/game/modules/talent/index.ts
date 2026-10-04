// 人才市场模块：自然出生默认关了，要添人口就在有「人才市场」的城里用「募」花金和粮招。
// 每座人才市场每天有名额；招士兵还要本城有兵营；招完不能超过人口上限。
import type { GameModule } from '../../../engine/module';
import type { Sim } from '../../../engine/sim';
import type { CommandDef } from '../../../engine/commands/types';
import type { EconomyApi } from '../economy';
import type { PopulationApi } from '../population';
import type { JobsApi } from '../jobs';
import type { Place } from '../world';
import { PROFESSIONS } from '../../../../content/professions';

export interface TalentApi {
  /** 每座人才市场每天恢复几个名额 */
  dailyLimit: number;
  /** 名额最多攒几个（没用完的名额会攒着，因为诸侯不是每天都在想事情） */
  maxBank: number;
  /** 这座城的人才市场现在还剩几个名额 */
  quotaLeft(town: number): number;
  /** 招一个人要付多少（职业序号 → 物品名 → 数量） */
  priceOf(prof: number): Record<string, number>;
}

/** 招人价 = 培训费里除金以外的部分 + 职业的 hire（金） */
export const hirePrice = (prof: number): Record<string, number> => {
  const d = PROFESSIONS[prof];
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(d.train.cost)) if (k !== '金') out[k] = v;
  out['金'] = d.train.hire;
  return out;
};

export const talent: GameModule = {
  id: 'talent',
  name: '人才市场',
  requires: ['world', 'economy', 'population', 'jobs'],
  config: {
    dailyLimit: { default: 5, text: '每座人才市场每天恢复几个招募名额', min: 1, max: 1000 },
    bankDays: { default: 10, text: '招募名额最多攒几天的（诸侯不是每天都在想事情，没用完的名额会攒着）', min: 1, max: 100 },
  },
  events: [{ id: 'talent.hired', module: 'talent', text: '在人才市场招了人' }],
  hash(sim, mix) {
    const t = sim.service<TalentApi & { _state(): { used: [number, number][] } }>('talent');
    for (const [k, v] of t._state().used) (mix(k), mix(v));
  },
  save: {
    version: 1,
    save: (sim) => sim.service<TalentApi & { _state(): unknown }>('talent')._state(),
    load: (sim, d) => sim.service<TalentApi & { _load(d: unknown): void }>('talent')._load(d),
  },
  install(api) {
    const sim: Sim = api.sim;
    const eco = api.use<EconomyApi>('economy');
    const pop = api.use<PopulationApi>('population');
    const jobs = api.use<JobsApi>('jobs');
    const limit = api.config.dailyLimit as number;
    const maxBank = limit * (api.config.bankDays as number);
    /** 城镇 → 已经用掉的名额（从上限往下数，每天回 limit 个） */
    const used = new Map<number, number>();
    const left = (t: number) => Math.max(0, maxBank - (used.get(t) ?? 0));

    // 每天恢复一天的名额
    sim.scheduler.add(
      {
        id: 'talent.daily',
        phase: 'population',
        every: 100,
        run() {
          for (const [k, v] of [...used]) v - limit > 0 ? used.set(k, v - limit) : used.delete(k);
        },
      },
      'talent',
    );

    const commands: CommandDef[] = [
      {
        id: 'hire',
        verb: '募',
        aliases: ['hire'],
        who: ['lord'],
        args: [['城镇', 'place'], ['名单', 'text']],
        help: '在有人才市场的城里招人：职业:人数，可以写好几个。花金和粮，每天有名额，招士兵还要兵营',
        examples: ['募 青石城 农:3 木:2'],
        run({ src }, a) {
          const place = a['城镇'] as Place;
          if (place.kind !== 'town') return { ok: false, msg: '「募」要写城镇名' };
          const t = pop.towns[place.id];
          const fi = pop.factionIndex(src.faction!);
          if (!t.founded || t.faction !== fi) return { ok: false, msg: `${t.name} 不是你的城` };
          if (!(t.buildings.talent > 0)) return { ok: false, msg: `${t.name} 没有人才市场（先「建 人才市场 ${t.name}」）` };
          // 解析 "农:3 木:2"
          const want: [number, number][] = [];
          for (const tok of String(a['名单']).split(/\s+/).filter(Boolean)) {
            const m = /^(.+?)[:：](\d+)$/.exec(tok);
            if (!m) return { ok: false, msg: `「${tok}」格式不对，要写 职业:人数，如 农:3` };
            const prof = jobs.profByWord(m[1]);
            if (prof < 0) return { ok: false, msg: `没有「${m[1]}」这种职业（${PROFESSIONS.map((p) => p.short).join(' ')}）` };
            const n = Number(m[2]);
            if (n < 1) return { ok: false, msg: `${m[1]} 的人数要 ≥ 1` };
            want.push([prof, n]);
          }
          if (!want.length) return { ok: false, msg: '没写招谁。例：募 ' + t.name + ' 农:3 木:2' };
          const total = want.reduce((s, [, n]) => s + n, 0);
          const quota = left(t.id);
          if (total > quota) return { ok: false, msg: `${t.name} 人才市场现在只剩 ${quota} 个名额（每天恢复 ${limit} 个，最多攒 ${maxBank} 个），你要 ${total} 人` };
          const room = t.cap - pop.residents(t.id).length;
          if (total > room) return { ok: false, msg: `${t.name} 住不下：人口上限 ${t.cap}，还能住 ${Math.max(0, room)} 人（建房屋可以加上限）` };
          if (want.some(([p]) => PROFESSIONS[p].id === 'soldier') && !(t.buildings.barracks > 0)) return { ok: false, msg: `招士兵要先在 ${t.name} 建兵营` };
          const price: Record<string, number> = {};
          for (const [p, n] of want) for (const [k, v] of Object.entries(hirePrice(p))) price[k] = (price[k] ?? 0) + v * n;
          if (!eco.take(t.store, eco.parseGoods(price))) return { ok: false, msg: `付不起：要 ${Object.entries(price).map(([k, v]) => k + v).join('、')}` };
          for (const [p, n] of want) {
            for (let k = 0; k < n; k++) {
              const e = pop.spawn(t);
              jobs.setProfession(e, p);
            }
          }
          used.set(t.id, (used.get(t.id) ?? 0) + total);
          t.pop += total;
          const list = want.map(([p, n]) => `${PROFESSIONS[p].name}${n}`).join('、');
          sim.events.emit('talent.hired', sim.clock.tick, { town: t.name, list, total, cost: price }, pop.factions[fi].name);
          return { ok: true, msg: `${t.name} 招了 ${list}，花 ${Object.entries(price).map(([k, v]) => k + v).join('、')}；还剩 ${quota - total} 个名额` };
        },
      },
    ];
    for (const c of commands) api.addCommand(c);

    const ta: TalentApi = { dailyLimit: limit, maxBank, quotaLeft: left, priceOf: hirePrice };
    Object.assign(ta, {
      _state: () => ({ used: [...used.entries()] }),
      _load(d: { used: [number, number][] }) {
        used.clear();
        for (const [k, v] of d.used) used.set(k, v);
      },
    });
    api.expose<TalentApi>(ta);
  },
};
