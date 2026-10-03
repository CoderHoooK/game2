// 外交模块：势力之间的关系分、战争、条约（结盟 / 互不侵犯 / 朝贡 / 通商 / 借道）、书信收件箱、提议与答复、声望；
// 商人跨势力贸易。私信只进收信人的收件箱；公告进所有人的收件箱和史册。
import type { GameModule } from '../../../engine/module';
import type { Sim } from '../../../engine/sim';
import { Transform, Motion } from '../../../engine/motion';
import { Brain } from '../../../engine/brain';
import type { CommandDef, Source } from '../../../engine/commands/types';
import type { Selector } from '../../../engine/commands/selector';
import { Rng } from '../../../shared/rng';
import type { Entity } from '../../../shared/types';
import type { TreatyDef } from '../../../shared/content';
import { Carry, type EconomyApi } from '../economy';
import { Identity, type Faction, type PopulationApi, type Town } from '../population';
import type { JobsApi } from '../jobs';
import type { WorldApi } from '../world';
import { TREATIES } from '../../../../content/diplomacy';

export type MsgKind = 'letter' | 'public' | 'proposal' | 'notice' | 'dream' | 'gift';
export interface Message {
  id: number;
  tick: number;
  /** 署名（冒名信写的是被冒充的人） */
  from: string;
  to: string;
  kind: MsgKind;
  text: string;
  /** 上帝冒名写的（只有上帝看得到这个字段） */
  forged?: boolean;
}
export interface Treaty {
  id: number;
  type: string;
  /** 提议方 */
  a: number;
  b: number;
  since: number;
  /** 到期的拍数（-1 = 长期） */
  until: number;
}
export interface Proposal {
  id: number;
  from: number;
  to: number;
  type: string;
  days: number;
  tick: number;
}
export interface DiplomacyApi {
  relation(a: number, b: number): number;
  adjust(a: number, b: number, delta: number): void;
  atWar(a: number, b: number): boolean;
  /** 会不会打起来：交战，或者有一方是流寇 */
  hostile(a: number, b: number): boolean;
  wars(): [number, number][];
  declareWar(a: number, b: number, why: string): string[];
  treaties: Treaty[];
  hasTreaty(a: number, b: number, type: string): boolean;
  proposals: Proposal[];
  inbox(faction: number): Message[];
  send(to: number, msg: Omit<Message, 'id' | 'tick' | 'to'>): Message;
  /** 两个势力之间的成交次数（界面画商路用） */
  trades(): [number, number, number][];
}

const PRICE: Record<string, number> = { food: 1, wood: 1, stone: 1.5, iron: 3, weapon: 6, tool: 4 };
const BREAK_COST: Record<string, number> = { alliance: 25, nonaggression: 20, tribute: 10, trade: 8, passage: 8 };
const INBOX_MAX = 200;
const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

export const diplomacy: GameModule = {
  id: 'diplomacy',
  name: '外交',
  requires: ['world', 'economy', 'population', 'jobs'],
  orders: [{ id: 'trade', name: '贸易', params: ['faction?'], text: '带货去别的势力换金（不给对象 = 找最近的、没在打仗的）' }],
  views: [
    { id: 'relations', text: '势力关系、战争、条约' },
    { id: 'inbox', text: '收件箱（每个势力只看得到自己的）' },
  ],
  events: [
    { id: 'message.received', module: 'diplomacy', text: '收到书信 / 公告 / 托梦' },
    { id: 'treaty.proposed', module: 'diplomacy', text: '有人提议签约' },
    { id: 'treaty.signed', module: 'diplomacy', text: '条约签订' },
    { id: 'treaty.broken', module: 'diplomacy', text: '条约被撕毁（声望下降）' },
    { id: 'treaty.expired', module: 'diplomacy', text: '条约到期' },
    { id: 'war.declared', module: 'diplomacy', text: '宣战' },
    { id: 'war.ended', module: 'diplomacy', text: '停战（签了互不侵犯）' },
  ],
  argTypes: [
    {
      id: 'treaty',
      name: '条约',
      parse(tok) {
        const t = TREATIES.find((x) => x.name === tok || x.id === tok);
        return t ? { ok: true, value: t } : { ok: false, error: `没有「${tok}」这种条约`, hint: TREATIES.map((x) => x.name).join(' ') };
      },
      choices: () => TREATIES.map((x) => x.name),
    },
  ],
  hash(sim, mix) {
    const d = sim.service<DiplomacyApi>('diplomacy');
    for (const [a, b] of d.wars()) (mix(a), mix(b));
    for (const t of d.treaties) (mix(t.id), mix(t.a), mix(t.b));
  },
  save: {
    version: 1,
    save: (sim) => sim.service<DiplomacyApi & { _state(): unknown }>('diplomacy')._state(),
    load: (sim, d) => sim.service<DiplomacyApi & { _load(d: unknown): void }>('diplomacy')._load(d),
  },
  install(api) {
    const sim: Sim = api.sim;
    const world = api.use<WorldApi>('world');
    const eco = api.use<EconomyApi>('economy');
    const pop = api.use<PopulationApi>('population');
    const jobs = api.use<JobsApi>('jobs');
    const rng = new Rng(sim.seed ^ 0xd1b0);
    const W = sim.world;
    const I = W.get(Identity);
    const P = W.get(Transform);
    const M = W.get(Motion);
    const B = W.get(Brain);
    const C = W.get(Carry);
    const F = pop.factions;

    let rel = new Map<string, number>();
    let wars = new Set<string>();
    const treaties: Treaty[] = [];
    const proposals: Proposal[] = [];
    let inboxes = new Map<number, Message[]>();
    let tradeCount = new Map<string, number>();
    let nextId = 1;
    const tick = () => sim.clock.tick;
    const name = (i: number) => F[i]?.name ?? '?';
    const tname = (id: string) => TREATIES.find((t) => t.id === id)?.name ?? id;

    const send: DiplomacyApi['send'] = (to, m) => {
      const msg: Message = { ...m, id: nextId++, tick: tick(), to: name(to) };
      const box = inboxes.get(to) ?? [];
      box.push(msg);
      if (box.length > INBOX_MAX) box.splice(0, box.length - INBOX_MAX);
      inboxes.set(to, box);
      sim.events.emit('message.received', tick(), { id: msg.id, from: msg.from, to: msg.to, kind: msg.kind, text: msg.text }, msg.to);
      return msg;
    };
    const adjust = (a: number, b: number, d: number) => rel.set(key(a, b), Math.max(-100, Math.min(100, (rel.get(key(a, b)) ?? 0) + d)));
    const hasTreaty = (a: number, b: number, type: string) => treaties.some((t) => t.type === type && ((t.a === a && t.b === b) || (t.a === b && t.b === a)));
    const breakTreaty = (t: Treaty, by: number, why: string) => {
      treaties.splice(treaties.indexOf(t), 1);
      const cost = BREAK_COST[t.type] ?? 10;
      F[by].reputation -= cost;
      const other = t.a === by ? t.b : t.a;
      adjust(by, other, -30);
      sim.events.emit('treaty.broken', tick(), { treaty: tname(t.type), by: name(by), other: name(other), why, reputation: -cost }, 'all');
    };
    const declareWar = (a: number, b: number, why: string) => {
      if (a === b || wars.has(key(a, b))) return [];
      const broken: string[] = [];
      for (const t of treaties.filter((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a))) {
        broken.push(tname(t.type));
        breakTreaty(t, a, why);
      }
      wars.add(key(a, b));
      adjust(a, b, -40);
      sim.events.emit('war.declared', tick(), { by: name(a), against: name(b), why, broke: broken }, 'all');
      // 盟友收到消息（出不出兵由他们自己决定）
      for (const t of treaties) {
        if (t.type !== 'alliance') continue;
        const ally = t.a === b ? t.b : t.b === b ? t.a : -1;
        if (ally >= 0 && ally !== a) send(ally, { from: name(b), kind: 'notice', text: `${name(a)} 向我们宣战了（${why}）。盟约在此，望出兵相助。` });
      }
      return broken;
    };
    const endWar = (a: number, b: number) => {
      if (wars.delete(key(a, b))) sim.events.emit('war.ended', tick(), { a: name(a), b: name(b) }, 'all');
    };
    const sign = (p: Proposal) => {
      if (p.type === 'nonaggression') endWar(p.from, p.to);
      const t: Treaty = { id: nextId++, type: p.type, a: p.from, b: p.to, since: tick(), until: p.days > 0 ? tick() + p.days * 100 : -1 };
      treaties.push(t);
      adjust(p.from, p.to, 20);
      F[p.from].reputation += 2;
      F[p.to].reputation += 2;
      sim.events.emit('treaty.signed', tick(), { treaty: tname(p.type), a: name(p.from), b: name(p.to), days: p.days }, 'all');
    };
    const me = (src: Source) => pop.factionIndex(src.faction!);
    const capital = (fi: number): Town | undefined => pop.towns[F[fi]?.towns[0]];

    // ---- 每天：关系回落、朝贡、到期
    sim.scheduler.add(
      {
        id: 'diplomacy.daily',
        phase: 'post',
        every: 100,
        run() {
          for (const [k, v] of rel) rel.set(k, v * 0.99);
          const gold = eco.itemIndex('gold');
          for (const t of [...treaties]) {
            if (!F[t.a].alive || !F[t.b].alive) {
              treaties.splice(treaties.indexOf(t), 1);
              continue;
            }
            if (t.until >= 0 && tick() >= t.until) {
              treaties.splice(treaties.indexOf(t), 1);
              sim.events.emit('treaty.expired', tick(), { treaty: tname(t.type), a: name(t.a), b: name(t.b) }, 'all');
              continue;
            }
            if (t.type === 'tribute') {
              const ca = capital(t.a);
              const cb = capital(t.b);
              if (ca && cb) {
                const n = Math.floor(eco.stores[ca.store].stock[gold] * 0.01);
                if (n > 0) sim.act('transfer', ca.store, cb.store, [['gold', n]]);
              }
            }
          }
          for (const p of [...proposals]) if (tick() - p.tick > 1000 || !F[p.from].alive || !F[p.to].alive) proposals.splice(proposals.indexOf(p), 1);
          for (const k of [...wars]) {
            const [a, b] = k.split(':').map(Number);
            if (!F[a].alive || !F[b].alive) wars.delete(k);
          }
        },
      },
      'diplomacy',
    );

    // ---- 贸易行为
    const tradeTarget = (e: Entity, f: Faction | undefined): Town | undefined => {
      const mine = I.faction[e];
      let best: Town | undefined;
      let bd = Infinity;
      for (const t of pop.towns) {
        if (t.faction === mine || !F[t.faction].alive) continue;
        if (f ? t.faction !== f.index : F[t.faction].kind !== 'lord' && F[t.faction].kind !== 'rebel') continue;
        if (wars.has(key(mine, t.faction))) continue;
        const d = Math.hypot(t.x - P.x[e], t.y - P.y[e]) * (hasTreaty(mine, t.faction, 'trade') ? 0.6 : 1);
        if (d < bd) ((bd = d), (best = t));
      }
      return best;
    };
    /** 平时只卖超出储备的部分；明确派出去的商队储备减半 */
    const reserve = (t: Town, id: string, sent: boolean) => ({ food: t.pop * 8, wood: 250, stone: 200, iron: 1e9, weapon: 1e9, tool: 50 } as Record<string, number>)[id] * (sent ? 0.5 : 1);
    const goNear = (e: Entity, x: number, y: number, r: number) => {
      const [tx, ty] = world.landPointNear(x, y, r, rng);
      sim.act('moveTo', e, tx, ty);
    };
    api.addBehavior({
      id: 'trade',
      name: '贸易',
      orders: ['trade'],
      acts: ['moveTo', 'withdraw', 'deposit', 'transfer'],
      text: '从自家仓库拿超出储备最多的货 → 走到对方城卸货 → 对方付金（通商 ×1.2，自家有市场 ×1.5）→ 回家',
      fits: (_s, e, o) => (o?.type === 'trade' && C.qty[e] === 0 && pop.towns[I.home[e]]?.faction === I.faction[e] ? 40 : 0),
      start(_s, e, o) {
        const target = tradeTarget(e, o!.params.faction as Faction | undefined);
        if (!target) return false;
        const home = pop.towns[I.home[e]];
        const st = eco.stores[home.store].stock;
        let item = '';
        let most = 20;
        for (const id of Object.keys(PRICE)) {
          const v = st[eco.itemIndex(id)] - reserve(home, id, !!o!.params.faction);
          if (v > most) ((most = v), (item = id));
        }
        void st;
        if (!item) return false;
        B.target[e] = target.id;
        B.timer[e] = eco.itemIndex(item);
        goNear(e, home.x, home.y, 12);
        return true;
      },
      tick(_s, e, _o) {
        if (M.moving[e]) return 'running';
        const home = pop.towns[I.home[e]];
        const there = pop.towns[B.target[e]];
        if (B.step[e] === 0) {
          // 到了仓库再算一次富余（别的商人可能刚拿走）
          const id = eco.items[B.timer[e]].id;
          const spare = eco.stores[home.store].stock[B.timer[e]] - reserve(home, id, !!_o?.params.faction);
          if (spare < 10 || !sim.act('withdraw', e, home.store, id, Math.min(C.cap[e], spare)).ok) return 'failed';
          B.step[e] = 1;
          goNear(e, there.x, there.y, 15);
          return 'running';
        }
        if (B.step[e] === 1) {
          if (wars.has(key(I.faction[e], there.faction)) || there.faction === I.faction[e]) {
            B.step[e] = 3; // 打起来了：原路回家，货带回去（送回行为会卸）
            return 'done';
          }
          const item = eco.items[C.item[e] - 1]?.id;
          const qty = C.qty[e];
          if (!item || !sim.act('deposit', e, there.store).ok) return 'failed';
          const value = qty * (PRICE[item] ?? 1);
          const bonus = (hasTreaty(I.faction[e], there.faction, 'trade') ? 1.2 : 1) * (1 + 0.5 * (home.buildings.market ?? 0));
          const theirGold = eco.stores[there.store].stock[eco.itemIndex('gold')];
          const paid = Math.min(theirGold, value * 0.8);
          if (paid > 0) sim.act('transfer', there.store, home.store, [['gold', paid]]);
          sim.act('transfer', -1, home.store, [['gold', value * bonus - paid]]);
          adjust(I.faction[e], there.faction, 0.5);
          const k = key(I.faction[e], there.faction);
          tradeCount.set(k, (tradeCount.get(k) ?? 0) + 1);
          B.step[e] = 2;
          goNear(e, home.x, home.y, 15);
          return 'running';
        }
        return 'done';
      },
    });

    // ---- 命令
    const commands: CommandDef[] = [
      {
        id: 'letter',
        verb: '信',
        aliases: ['letter'],
        who: ['lord'],
        args: [['对方', 'faction'], ['内容', 'text']],
        help: '写私信（只有对方看得到）',
        examples: ['信 白鹿 愿与贵国共讨赤焰'],
        run({ src }, a) {
          const f = a['对方'] as Faction;
          if (f.index === me(src)) return { ok: false, msg: '不能给自己写信' };
          send(f.index, { from: src.faction!, kind: 'letter', text: a['内容'] as string });
          return { ok: true, msg: `信已送到 ${f.name}` };
        },
      },
      {
        id: 'announce',
        verb: '告',
        aliases: ['announce'],
        who: ['lord'],
        args: [['内容', 'text']],
        help: '昭告天下（所有势力都收到，记进史册）',
        examples: ['告 赤焰无道，天下共讨之'],
        run({ src }, a) {
          for (const f of pop.livingFactions()) if (f.name !== src.faction) send(f.index, { from: src.faction!, kind: 'public', text: a['内容'] as string });
          return { ok: true, msg: '已昭告天下' };
        },
      },
      {
        id: 'propose',
        verb: '约',
        aliases: ['propose'],
        who: ['lord'],
        args: [['对方', 'faction'], ['条约', 'treaty'], ['时长?', 'duration']],
        help: '提议签约，对方用「应」答应才生效；和交战的对手签互不侵犯 = 停战',
        examples: ['约 赤焰 互不侵犯 30天', '约 白鹿 通商'],
        run({ src }, a) {
          const f = a['对方'] as Faction;
          const t = a['条约'] as TreatyDef;
          const days = (a['时长'] as number | undefined) ?? 0;
          const fi = me(src);
          if (f.index === fi) return { ok: false, msg: '不能和自己签约' };
          if (hasTreaty(fi, f.index, t.id)) return { ok: false, msg: `已经和 ${f.name} 签了${t.name}` };
          if (wars.has(key(fi, f.index)) && t.id !== 'nonaggression') return { ok: false, msg: `正和 ${f.name} 交战，先签互不侵犯停战` };
          const p: Proposal = { id: nextId++, from: fi, to: f.index, type: t.id, days, tick: tick() };
          proposals.push(p);
          send(f.index, { from: src.faction!, kind: 'proposal', text: `提议${t.name}${days ? ' ' + days + ' 天' : '（长期）'}。答应请回「应 ${src.faction}」` });
          sim.events.emit('treaty.proposed', tick(), { from: src.faction, to: f.name, treaty: t.name, days }, f.name);
          return { ok: true, msg: `已向 ${f.name} 提议${t.name}，等对方答复（10 天内有效）` };
        },
      },
      {
        id: 'accept',
        verb: '应',
        aliases: ['accept'],
        who: ['lord'],
        args: [['对方', 'faction']],
        help: '答应对方最近的一份提议',
        examples: ['应 赤焰'],
        run({ src }, a) {
          const f = a['对方'] as Faction;
          const fi = me(src);
          const p = [...proposals].reverse().find((x) => x.from === f.index && x.to === fi);
          if (!p) return { ok: false, msg: `${f.name} 没有向你提议什么` };
          proposals.splice(proposals.indexOf(p), 1);
          sign(p);
          return { ok: true, msg: `和 ${f.name} 签了${tname(p.type)}` };
        },
      },
      {
        id: 'break',
        verb: '撕',
        aliases: ['break'],
        who: ['lord'],
        args: [['对方', 'faction'], ['条约', 'treaty']],
        help: '撕毁条约（声望下降，天下皆知）',
        examples: ['撕 赤焰 互不侵犯'],
        run({ src }, a) {
          const f = a['对方'] as Faction;
          const td = a['条约'] as TreatyDef;
          const fi = me(src);
          const t = treaties.find((x) => x.type === td.id && ((x.a === fi && x.b === f.index) || (x.b === fi && x.a === f.index)));
          if (!t) return { ok: false, msg: `和 ${f.name} 没有${td.name}` };
          breakTreaty(t, fi, '主动撕约');
          return { ok: true, msg: `撕毁了和 ${f.name} 的${td.name}（声望 -${BREAK_COST[td.id] ?? 10}）` };
        },
      },
      {
        id: 'gift',
        verb: '赠',
        aliases: ['gift'],
        who: ['lord'],
        args: [['对方', 'faction'], ['东西', 'amount']],
        help: '从都城送东西给对方都城（关系变好）',
        examples: ['赠 白鹿 粮200'],
        run({ src }, a) {
          const f = a['对方'] as Faction;
          const goods = a['东西'] as [string, number][];
          const fi = me(src);
          const from = capital(fi);
          const to = capital(f.index);
          if (!from || !to) return { ok: false, msg: '双方都要有城' };
          const r = sim.act('transfer', from.store, to.store, goods);
          if (!r.ok) return { ok: false, msg: `${from.name} 拿不出这么多` };
          const value = goods.reduce((s, [id, n]) => s + n * (id === 'gold' ? 1 : PRICE[id] ?? 1), 0);
          adjust(fi, f.index, Math.min(30, value / 20));
          const desc = goods.map(([id, n]) => eco.items[eco.itemIndex(id)].name + n).join('、');
          send(f.index, { from: src.faction!, kind: 'gift', text: `送来 ${desc}` });
          return { ok: true, msg: `给 ${f.name} 送去 ${desc}` };
        },
      },
      {
        id: 'trade',
        verb: '商',
        aliases: ['trade'],
        who: ['lord'],
        order: 'trade',
        args: [['人', 'sel'], ['对方', 'faction']],
        help: '派商人去某个势力做买卖（打起来就自动回家）',
        examples: ['商 @商:3 白鹿', '商 #商队 白鹿'],
        run({ src }, a) {
          const f = a['对方'] as Faction;
          if (f.index === me(src)) return { ok: false, msg: '不能和自己做买卖' };
          if (wars.has(key(me(src), f.index))) return { ok: false, msg: `正和 ${f.name} 交战` };
          return jobs.dispatch(src, sim.bus.select(a['人'] as Selector, src), 'trade', { faction: f }, `去 ${f.name} 做买卖`);
        },
      },
    ];
    for (const c of commands) api.addCommand(c);

    const da: DiplomacyApi = {
      relation: (a, b) => rel.get(key(a, b)) ?? 0,
      adjust,
      atWar: (a, b) => wars.has(key(a, b)),
      hostile: (a, b) => a !== b && (wars.has(key(a, b)) || F[a]?.kind === 'bandit' || F[b]?.kind === 'bandit') && F[a]?.kind !== 'free' && F[b]?.kind !== 'free',
      wars: () => [...wars].map((k) => k.split(':').map(Number) as [number, number]),
      declareWar,
      treaties,
      hasTreaty,
      proposals,
      inbox: (f) => inboxes.get(f) ?? [],
      send,
      trades: () => [...tradeCount].map(([k, n]) => [...(k.split(':').map(Number) as [number, number]), n]),
    };
    Object.assign(da, {
      _state: () => ({ rng: rng.state, nextId, rel: [...rel], wars: [...wars], treaties, proposals, inbox: [...inboxes], trades: [...tradeCount] }),
      _load(d: { rng: number; nextId: number; rel: [string, number][]; wars: string[]; treaties: Treaty[]; proposals: Proposal[]; inbox: [number, Message[]][]; trades: [string, number][] }) {
        rng.state = d.rng;
        nextId = d.nextId;
        rel = new Map(d.rel);
        wars = new Set(d.wars);
        treaties.length = 0;
        treaties.push(...d.treaties);
        proposals.length = 0;
        proposals.push(...d.proposals);
        inboxes = new Map(d.inbox);
        tradeCount = new Map(d.trades);
      },
    });
    api.expose<DiplomacyApi>(da);
  },
};
