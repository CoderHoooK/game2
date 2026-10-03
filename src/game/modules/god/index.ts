// 上帝模块：时间倍率、天灾、天降（赐）、冒名信、托梦、召唤流寇。上帝出手的真相只写进上帝专属史册。
import type { GameModule } from '../../../engine/module';
import type { Sim } from '../../../engine/sim';
import type { CommandDef } from '../../../engine/commands/types';
import { Rng } from '../../../shared/rng';
import type { DisasterDef } from '../../../shared/content';
import type { EconomyApi } from '../economy';
import type { WorldApi, Place } from '../world';
import { Identity, Vitals, type Faction, type PopulationApi } from '../population';
import type { DiplomacyApi } from '../diplomacy';
import type { MilitaryApi } from '../military';
import { Transform } from '../../../engine/motion';
import { DISASTERS } from '../../../../content/diplomacy';

export const god: GameModule = {
  id: 'god',
  name: '上帝',
  requires: ['world', 'economy', 'population', 'jobs', 'diplomacy', 'military'],
  events: [
    { id: 'god.intervened', module: 'god', text: '上帝出手（只有上帝自己看得到）' },
    { id: 'disaster.struck', module: 'god', text: '天灾降临（公开：大家只知道遭了灾）' },
  ],
  views: [{ id: 'god', text: '上帝面板' }],
  argTypes: [
    {
      id: 'disaster',
      name: '天灾',
      parse(tok) {
        const d = DISASTERS.find((x) => x.name === tok || x.id === tok);
        return d ? { ok: true, value: d } : { ok: false, error: `没有「${tok}」这种天灾`, hint: DISASTERS.map((x) => x.name).join(' ') };
      },
      choices: () => DISASTERS.map((x) => x.name),
    },
    {
      id: 'anyFaction',
      name: '势力',
      parse(tok, { sim }) {
        const pop = sim.service<PopulationApi>('population');
        const f = pop.factions[pop.factionIndex(tok)];
        return f && f.alive && (f.kind === 'lord' || f.kind === 'rebel') ? { ok: true, value: f } : { ok: false, error: `没有活着的势力「${tok}」`, hint: pop.livingFactions().map((x) => x.name).join('、') };
      },
    },
  ],
  install(api) {
    const sim: Sim = api.sim;
    const world = api.use<WorldApi>('world');
    const eco = api.use<EconomyApi>('economy');
    const pop = api.use<PopulationApi>('population');
    const dip = api.use<DiplomacyApi>('diplomacy');
    const mil = api.use<MilitaryApi>('military');
    const rng = new Rng(sim.seed ^ 0x60d);
    const W = sim.world;
    const P = W.get(Transform);
    const V = W.get(Vitals);
    const I = W.get(Identity);
    const say = (text: string, kind: string) => sim.events.emit('god.intervened', sim.clock.tick, { kind, text });
    const regionOf = (p: Place) => (p.kind === 'region' ? p.id : pop.towns[p.id].region);

    // 瘟疫：每天在疫区的人掉血
    sim.scheduler.add(
      {
        id: 'god.plague',
        phase: 'population',
        every: 100,
        run() {
          const dead: number[] = [];
          for (const e of pop.npcs()) {
            if (!world.effects(P.region[e]).includes('plague')) continue;
            V.hp[e] -= rng.range(5, 25);
            if (V.hp[e] <= 0) dead.push(e);
          }
          for (const e of dead) pop.kill(e, '病死');
        },
      },
      'god',
    );

    const commands: CommandDef[] = [
      {
        id: 'speed',
        verb: '时速',
        aliases: ['speed'],
        who: ['god'],
        args: [['倍率', 'int']],
        help: '时间倍率（0 = 暂停）',
        examples: ['时速 4'],
        run({ tick }, a) {
          const n = a['倍率'] as number;
          if (n < 0 || n > 16) return { ok: false, msg: '倍率要在 0–16 之间' };
          sim.clock.speed = n;
          sim.events.emit('god.intervened', tick, { kind: 'speed', n });
          return { ok: true, msg: n === 0 ? '时间暂停' : `时间 ×${n}` };
        },
      },
      {
        id: 'disaster',
        verb: '灾',
        aliases: ['disaster'],
        who: ['god'],
        args: [['天灾', 'disaster'], ['地点', 'place'], ['时长?', 'duration']],
        help: '降天灾：旱（田和树不长）、涝（田毁一半）、疫（人掉血）、蝗（粮仓少三成）',
        examples: ['灾 旱 北林 10天', '灾 疫 河口镇 5天'],
        run(_c, a) {
          const d = a['天灾'] as DisasterDef;
          const p = a['地点'] as Place;
          const days = (a['时长'] as number | undefined) ?? 10;
          const region = regionOf(p);
          world.addEffect(region, d.id, sim.clock.tick + days * 100);
          const extra: string[] = [];
          if (d.id === 'flood') for (const n of world.nodesIn(region, 'field')) world.nodes.amount[n] *= 0.5;
          if (d.id === 'locust') {
            const r = world.map.regions[region];
            for (const t of pop.towns) {
              if (Math.hypot(t.x - r.cx, t.y - r.cy) > 1500) continue;
              const food = eco.stores[t.store].stock[eco.itemIndex('food')] * 0.3;
              sim.act('convert', t.store, [['food', food]], []);
              extra.push(`${t.name} 粮 -${Math.round(food)}`);
            }
          }
          const rn = world.map.regions[region].name;
          sim.events.emit('disaster.struck', sim.clock.tick, { kind: d.id, name: d.name, region: rn, days }, 'all');
          say(`降${d.name}于 ${rn} ${days} 天${extra.length ? '：' + extra.join('、') : ''}`, 'disaster');
          return { ok: true, msg: `${rn} 遭${d.name} ${days} 天${extra.length ? '（' + extra.join('、') + '）' : ''}` };
        },
      },
      {
        id: 'bless',
        verb: '赐',
        aliases: ['bless'],
        who: ['god'],
        args: [['对方', 'anyFaction'], ['东西', 'amount']],
        help: '天降物资到某势力都城',
        examples: ['赐 白鹿 铁100'],
        run(_c, a) {
          const f = a['对方'] as Faction;
          const goods = a['东西'] as [string, number][];
          const cap = pop.towns[f.towns[0]];
          sim.act('transfer', -1, cap.store, goods);
          const desc = goods.map(([id, n]) => eco.items[eco.itemIndex(id)].name + n).join('、');
          dip.send(f.index, { from: '天', kind: 'notice', text: `${cap.name} 的仓库里凭空多了 ${desc}` });
          say(`赐 ${f.name} ${desc}`, 'bless');
          return { ok: true, msg: `${cap.name} 多了 ${desc}` };
        },
      },
      {
        id: 'forge',
        verb: '冒名',
        aliases: ['forge'],
        who: ['god'],
        args: [['冒充谁', 'anyFaction'], ['发给谁', 'anyFaction'], ['内容', 'text']],
        help: '冒充一个势力给另一个写信（收信人以为是真的）',
        examples: ['冒名 赤焰 白鹿 我军三日后借道'],
        run(_c, a) {
          const fake = a['冒充谁'] as Faction;
          const to = a['发给谁'] as Faction;
          if (fake === to) return { ok: false, msg: '不能冒充收信人自己' };
          dip.send(to.index, { from: fake.name, kind: 'letter', text: a['内容'] as string, forged: true });
          say(`冒 ${fake.name} 之名致信 ${to.name}：${a['内容']}`, 'forge');
          return { ok: true, msg: `${to.name} 收到一封「${fake.name}」的信` };
        },
      },
      {
        id: 'dream',
        verb: '托梦',
        aliases: ['dream'],
        who: ['god'],
        args: [['对方', 'anyFaction'], ['内容', 'text']],
        help: '给某个诸侯托梦',
        examples: ['托梦 白鹿 东方有变'],
        run(_c, a) {
          const f = a['对方'] as Faction;
          dip.send(f.index, { from: '梦', kind: 'dream', text: a['内容'] as string });
          say(`托梦 ${f.name}：${a['内容']}`, 'dream');
          return { ok: true, msg: `${f.name} 做了个梦` };
        },
      },
      {
        id: 'bandits',
        verb: '寇',
        aliases: ['bandits'],
        who: ['god'],
        args: [['地点', 'place'], ['人数', 'int']],
        help: '在某地召唤一股流寇（会去劫掠最近的城）',
        examples: ['寇 东山 50'],
        run(_c, a) {
          const p = a['地点'] as Place;
          const n = a['人数'] as number;
          if (n < 1 || n > 500) return { ok: false, msg: '人数要在 1–500 之间' };
          if (pop.npcs().length + n > W.capacity - 100) return { ok: false, msg: '世界太挤了' };
          mil.spawnBandits(p, n);
          say(`${p.name} 冒出 ${n} 名流寇`, 'bandits');
          return { ok: true, msg: `${p.name} 冒出 ${n} 名流寇` };
        },
      },
    ];
    for (const c of commands) api.addCommand(c);
    void I;
  },
};
