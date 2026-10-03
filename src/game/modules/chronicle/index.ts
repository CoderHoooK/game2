// 史册模块：把事件写成人话。公开条目所有人都看得到（史册）；上帝专属条目（密信、冒名、天灾的真相）只有上帝看；
// 每个诸侯的「心里话」（想）也只有上帝看——用来看 AI 怎么勾心斗角。
import type { GameModule } from '../../../engine/module';
import type { Sim } from '../../../engine/sim';
import type { GameEvent } from '../../../engine/events';
import type { PopulationApi } from '../population';

export interface Entry {
  id: number;
  tick: number;
  /** 'all' = 公开；'god' = 只有上帝；势力名 = 该势力和上帝 */
  scope: string;
  type: string;
  text: string;
  /** 涉及的势力（界面上色用） */
  factions: string[];
}
export interface Thought {
  tick: number;
  faction: string;
  text: string;
}
export interface ChronicleApi {
  entries(viewer: 'god' | string, sinceId?: number): Entry[];
  add(type: string, text: string, scope: string, factions?: string[]): Entry;
  thoughts(faction?: string, sinceTick?: number): Thought[];
  lastId(): number;
}

const MAX = 3000;
const MAX_THOUGHTS = 300;

/** 事件 → 史册里的一句话；返回 null = 不记 */
type Fmt = (d: Record<string, any>, ev: GameEvent) => { text: string; scope?: string; factions?: string[] } | null;
const FMT: Record<string, Fmt> = {
  'season.changed': (d) => (d.season === '春' ? { text: `第 ${d.year + 1} 年开春。` } : { text: `入${d.season}。` }),
  'war.declared': (d) => ({ text: `${d.by} 向 ${d.against} 宣战（${d.why}）${d.broke?.length ? `，撕毁${d.broke.join('、')}` : ''}。`, factions: [d.by, d.against] }),
  'war.ended': (d) => ({ text: `${d.a} 与 ${d.b} 罢兵。`, factions: [d.a, d.b] }),
  'treaty.signed': (d) => ({ text: `${d.a} 与 ${d.b} 签订${d.treaty}${d.days ? ` ${d.days} 天` : ''}。`, factions: [d.a, d.b] }),
  'treaty.broken': (d) => ({ text: `${d.by} 背弃与 ${d.other} 的${d.treaty}，天下哗然（声望 ${d.reputation}）。`, factions: [d.by, d.other] }),
  'treaty.expired': (d) => ({ text: `${d.a} 与 ${d.b} 的${d.treaty}到期。`, factions: [d.a, d.b] }),
  'settlement.besieged': (d) => ({ text: `${d.by} 兵临 ${d.town} 城下（${d.attackers} 对 ${d.defenders}）。`, factions: [d.by] }),
  'settlement.captured': (d) => ({ text: `${d.to} 攻占 ${d.town}（原属 ${d.from}）。`, factions: [d.to, d.from] }),
  'settlement.looted': (d) => ({ text: `流寇洗劫 ${d.town}，抢走粮 ${d.food}、金 ${d.gold}。` }),
  'settlement.rebelled': (d) => ({ text: `${d.town} 民不聊生，揭竿而起，脱离 ${d.from} 自立为「${d.faction}」。`, factions: [d.faction, d.from] }),
  'stock.low': (d, ev) => ({ text: `${d.town} 的${d.item}只够吃 ${d.days} 天了。`, scope: ev.scope }),
  'settlement.starving': (d, ev) => ({ text: `${d.town} 断粮（只够 ${d.fed}% 的人吃饱）。`, scope: ev.scope }),
  'faction.founded': (d) => ({ text: `新势力「${d.name}」崛起${d.from ? `（出自 ${d.from}）` : ''}。`, factions: [d.name] }),
  'faction.eliminated': (d) => ({ text: `${d.name} 失去最后一座城，就此覆灭。`, factions: [d.name] }),
  'battle.ended': (d) => {
    const dead = Object.entries(d.dead as Record<string, number>);
    if (dead.reduce((s, [, n]) => s + n, 0) < 3) return null;
    return { text: `${d.region}之战：${dead.map(([f, n]) => `${f}折损 ${n} 人`).join('，')}。`, factions: [d.a, d.b] };
  },
  'notable.defected': (d) => ({ text: d.how === '自立' ? `${d.from} 大将 ${d.name} 拥兵自立，据 ${d.town}，号「${d.to}」。` : `${d.name} 离开 ${d.from}，投奔 ${d.to}。`, factions: [d.from, d.to] }),
  'npc.died': (d) => (d.notable ? { text: `${d.faction}${d.notable} ${d.name} ${d.cause}${d.by ? `（${d.by}）` : ''}。`, factions: [d.faction] } : null),
  'npc.migrated': (d, ev) => (d.defect ? { text: `${d.n} 名百姓从 ${d.from} 逃往 ${d.to}。`, scope: 'all' } : { text: `${d.n} 人从 ${d.from} 迁往 ${d.to}。`, scope: ev.scope }),
  'building.done': (d, ev) => ({ text: `${d.where} 的${d.building}落成。`, scope: ev.scope, factions: [d.faction] }),
  'building.destroyed': (d, ev) => ({ text: `${d.where} 的${d.building}${d.why === '拆除' ? '被拆除' : d.why}。`, scope: ev.scope }),
  'message.received': (d) =>
    d.kind === 'public'
      ? { text: `${d.from} 昭告天下：「${d.text}」`, factions: [d.from] }
      : d.kind === 'letter' || d.kind === 'proposal' || d.kind === 'gift'
        ? { text: `（${d.kind === 'letter' ? '密信' : d.kind === 'gift' ? '赠礼' : '提议'}）${d.from} → ${d.to}：${d.text}`, scope: 'god', factions: [d.from, d.to] }
        : null,
  'treaty.proposed': (d) => ({ text: `（提议）${d.from} 向 ${d.to} 提议${d.treaty}。`, scope: 'god', factions: [d.from, d.to] }),
  'god.intervened': (d) => (d.text ? { text: `（天意）${d.text}`, scope: 'god' } : null),
  'disaster.struck': (d) => ({ text: `${d.region}遭${d.name}，${d.days} 天。` }),
};

export const chronicle: GameModule = {
  id: 'chronicle',
  name: '史册',
  requires: ['population'],
  views: [
    { id: 'chronicle', text: '史册（公开 + 上帝专属）' },
    { id: 'thoughts', text: '诸侯心里话（只有上帝看）' },
  ],
  save: {
    version: 1,
    save: (sim) => sim.service<ChronicleApi & { _state(): unknown }>('chronicle')._state(),
    load: (sim, d) => sim.service<ChronicleApi & { _load(d: unknown): void }>('chronicle')._load(d),
  },
  install(api) {
    const sim: Sim = api.sim;
    const pop = api.use<PopulationApi>('population');
    let entries: Entry[] = [];
    let thoughts: Thought[] = [];
    let nextId = 1;
    const add = (type: string, text: string, scope: string, factions: string[] = []): Entry => {
      const e: Entry = { id: nextId++, tick: sim.clock.tick, scope, type, text, factions: factions.filter(Boolean) };
      entries.push(e);
      if (entries.length > MAX) entries = entries.slice(-MAX);
      return e;
    };
    sim.events.on('*', (ev) => {
      const f = FMT[ev.type];
      if (!f) return;
      const r = f(ev.data as Record<string, any>, ev);
      // 格式表里没写范围的都是天下皆知的大事；私密的条目在格式表里自己声明范围
      if (r) add(ev.type, r.text, r.scope ?? 'all', r.factions);
    });
    api.addCommand({
      id: 'think',
      verb: '想',
      aliases: ['think'],
      who: ['lord'],
      args: [['内容', 'text']],
      help: '写下心里话（只有上帝看得到，不影响世界）',
      examples: ['想 青龙兵强，先稳住，联白鹿夹击赤焰'],
      run({ src }, a) {
        thoughts.push({ tick: sim.clock.tick, faction: src.faction!, text: a['内容'] as string });
        if (thoughts.length > MAX_THOUGHTS * 8) thoughts = thoughts.slice(-MAX_THOUGHTS * 8);
        return { ok: true, msg: '记下了' };
      },
    });
    const ca: ChronicleApi = {
      entries(viewer, sinceId = 0) {
        return entries.filter((e) => e.id > sinceId && (viewer === 'god' || e.scope === 'all' || e.scope === viewer));
      },
      add,
      thoughts: (faction, since = -1) => thoughts.filter((t) => (!faction || t.faction === faction) && t.tick > since),
      lastId: () => nextId - 1,
    };
    void pop;
    Object.assign(ca, {
      _state: () => ({ nextId, entries, thoughts }),
      _load(d: { nextId: number; entries: Entry[]; thoughts: Thought[] }) {
        nextId = d.nextId;
        entries = d.entries;
        thoughts = d.thoughts;
      },
    });
    api.expose<ChronicleApi>(ca);
  },
};
