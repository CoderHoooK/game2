// AI 席位：每个活着的诸侯一个座位。脚本诸侯每 3 天醒一次、大模型每 10 天醒一次；出了急事（被宣战、被围、来信）提前醒。
// 新势力出现（起义、叛将自立）自动给它一个座位；势力灭亡座位撤掉。每个座位留最近的决策记录（界面「心里话」看）。
import type { Sim } from '../engine/sim';
import type { GameEvent } from '../engine/events';
import type { PopulationApi } from '../game';
import { Rng } from '../shared/rng';
import { buildBriefing, type BriefingState } from './briefing';
import { extractCommands, runCommands } from './parser';
import { decide, newMemory, personalityFor, scriptRng, type Personality, type ScriptMemory } from './script';
import type { Provider } from './providers/types';

export interface SeatLog {
  tick: number;
  label: string;
  mode: 'script' | 'llm';
  why: string;
  prompt?: string;
  reply: string;
  results: { line: string; ok: boolean; msg: string }[];
}
export interface Seat {
  faction: string;
  mode: 'script' | 'llm';
  personality: Personality;
  nextWake: number;
  why: string;
  brief: BriefingState;
  mem: ScriptMemory;
  rng: Rng;
  log: SeatLog[];
  pending: boolean;
}

export const SYSTEM_PROMPT = (faction: string) =>
  `你是「${faction}」的诸侯，在一片 10 公里的大陆上和其他诸侯共处。你看不到别人的心思，只看得到下面这份情况。\n` +
  `用命令回复，每行一条，最多 12 行；可以用「想 …」写下你的心里话（只有你自己知道）。命令写错会被退回。`;

const URGENT = new Set(['war.declared', 'settlement.besieged', 'settlement.captured', 'message.received', 'treaty.proposed', 'treaty.broken', 'settlement.rebelled']);
const LOG_MAX = 40;

export class AiHost {
  seats = new Map<string, Seat>();
  private pop: PopulationApi;
  private queue: { seat: Seat; reply: string; prompt: string; why: string }[] = [];

  constructor(
    private sim: Sim,
    private opts: { provider?: Provider | null; scriptEvery?: number; llmEvery?: number; enabled?: boolean } = {},
  ) {
    this.pop = sim.service<PopulationApi>('population');
    sim.events.on('*', (ev) => this.onEvent(ev));
  }

  private get scriptEvery() {
    return this.opts.scriptEvery ?? 3 * this.sim.clock.ticksPerDay;
  }
  private get llmEvery() {
    return this.opts.llmEvery ?? 10 * this.sim.clock.ticksPerDay;
  }

  private onEvent(ev: GameEvent): void {
    if (!URGENT.has(ev.type)) return;
    const d = ev.data as Record<string, unknown>;
    const who = new Set<string>();
    if (ev.scope && ev.scope !== 'all') who.add(ev.scope);
    for (const k of ['against', 'from', 'to', 'other']) if (typeof d[k] === 'string') who.add(d[k] as string);
    if (ev.type === 'settlement.besieged' || ev.type === 'settlement.captured') {
      const t = this.pop.townByName(d.town as string);
      if (t) who.add(this.pop.factions[t.faction].name);
    }
    for (const f of who) {
      const s = this.seats.get(f);
      if (s && s.nextWake > this.sim.clock.tick + 20) {
        s.nextWake = this.sim.clock.tick + 20;
        s.why = ev.type;
      }
    }
  }

  /** 运行中改设置（网页 ⚙ 设置）：换接口 / 关掉 / 改醒来间隔。换了模式的座位尽快醒一次 */
  configure(opts: { provider?: Provider | null; scriptEvery?: number; llmEvery?: number; enabled?: boolean }): void {
    this.opts = { ...this.opts, ...opts };
    const mode = this.opts.provider ? 'llm' : 'script';
    for (const s of this.seats.values()) {
      if (s.mode === mode) continue;
      s.mode = mode;
      s.nextWake = Math.min(s.nextWake, this.sim.clock.tick + 20);
      s.why = '换了 AI 设置';
    }
  }
  get enabled(): boolean {
    return this.opts.enabled !== false;
  }
  get providerName(): string {
    return this.opts.enabled === false ? '关闭' : this.opts.provider ? this.opts.provider.name : '脚本';
  }

  /** 同步座位：活着的诸侯都要有，灭亡的撤掉 */
  syncSeats(): void {
    const living = this.pop.livingFactions();
    for (const f of living) {
      if (this.seats.has(f.name)) continue;
      const llm = !!this.opts.provider;
      this.seats.set(f.name, {
        faction: f.name,
        mode: llm ? 'llm' : 'script',
        personality: personalityFor(f.name),
        nextWake: this.sim.clock.tick + 1 + this.seats.size * 7,
        why: '开局',
        brief: { lastEntry: 0, lastMsg: 0 },
        mem: newMemory(),
        rng: scriptRng(this.sim, f.name),
        log: [],
        pending: false,
      });
    }
    for (const name of [...this.seats.keys()]) if (!living.some((f) => f.name === name)) this.seats.delete(name);
  }

  /** 主循环每步调用（在两拍之间） */
  step(): void {
    if (this.opts.enabled === false) return;
    this.syncSeats();
    // 大模型的回复先到先执行
    for (const q of this.queue.splice(0)) this.apply(q.seat, q.reply, q.prompt, q.why, 'llm');
    const now = this.sim.clock.tick;
    for (const s of this.seats.values()) {
      if (s.pending || now < s.nextWake) continue;
      const why = s.why;
      s.why = '例行';
      if (s.mode === 'script') {
        const lines = decide(this.sim, s.faction, s.personality, s.mem, s.rng);
        buildBriefing(this.sim, s.faction, s.brief, { commands: false }); // 推进「已读」位置
        this.apply(s, lines.join('\n'), undefined, why, 'script');
        s.nextWake = now + this.scriptEvery;
      } else {
        const prompt = buildBriefing(this.sim, s.faction, s.brief);
        s.pending = true;
        s.nextWake = now + this.llmEvery;
        this.opts
          .provider!.complete([
            { role: 'system', content: SYSTEM_PROMPT(s.faction) },
            { role: 'user', content: prompt },
          ])
          .then((reply) => this.queue.push({ seat: s, reply, prompt, why }))
          .catch((err) => this.queue.push({ seat: s, reply: `（调用失败：${String(err?.message ?? err)}）`, prompt, why }))
          .finally(() => (s.pending = false));
      }
    }
  }

  private apply(s: Seat, reply: string, prompt: string | undefined, why: string, mode: 'script' | 'llm'): void {
    if (!this.seats.has(s.faction)) return;
    const { lines } = extractCommands(this.sim, reply);
    const res = runCommands(this.sim, s.faction, lines).map(({ line, result }) => ({ line, ok: result.ok, msg: result.msg }));
    s.log.push({ tick: this.sim.clock.tick, label: this.sim.clock.label(), mode, why, prompt, reply, results: res });
    if (s.log.length > LOG_MAX) s.log.splice(0, s.log.length - LOG_MAX);
  }

  logs(faction: string): SeatLog[] {
    return this.seats.get(faction)?.log ?? [];
  }

  /** 等所有进行中的大模型调用回来（测试用） */
  async settle(): Promise<void> {
    for (let i = 0; i < 100 && [...this.seats.values()].some((s) => s.pending); i++) await new Promise((r) => setTimeout(r, 0));
  }

  save(): unknown {
    return [...this.seats.values()].map((s) => ({ faction: s.faction, mode: s.mode, nextWake: s.nextWake, brief: s.brief, mem: s.mem, rng: s.rng.state, log: s.log.slice(-10) }));
  }
  load(data: unknown): void {
    this.syncSeats();
    for (const d of (data as { faction: string; nextWake: number; brief: BriefingState; mem: ScriptMemory; rng: number; log: SeatLog[] }[]) ?? []) {
      const s = this.seats.get(d.faction);
      if (!s) continue;
      Object.assign(s, { nextWake: d.nextWake, brief: d.brief, mem: d.mem, log: d.log ?? [] });
      s.rng.state = d.rng;
    }
  }
}
