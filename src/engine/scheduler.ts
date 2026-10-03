// 调度：每个系统声明自己的阶段和频率，每拍按阶段顺序执行。
import type { Sim } from './sim';

export const PHASES = ['input', 'ai_npc', 'act', 'move', 'resolve', 'economy', 'population', 'post'] as const;
export type Phase = (typeof PHASES)[number];

export interface SystemDef {
  id: string;
  phase: Phase;
  /** 每几拍跑一次（默认 1） */
  every?: number;
  run(sim: Sim, dt: number): void;
}

/** 宿主注入的计时器（模拟代码里不许直接读时钟，见分层测试） */
export type Profiler = { now(): number };

export class Scheduler {
  private systems: (SystemDef & { module: string; order: number })[] = [];
  /** 每个系统最近一次耗时（毫秒），有 profiler 时才记 */
  readonly timings = new Map<string, number>();
  profiler?: Profiler;

  add(def: SystemDef, module: string): void {
    if (!PHASES.includes(def.phase)) throw new Error(`系统 ${def.id} 的阶段不存在：${def.phase}`);
    if (this.systems.some((s) => s.id === def.id)) throw new Error(`系统重复登记：${def.id}`);
    this.systems.push({ ...def, module, order: this.systems.length });
    this.systems.sort((a, b) => PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase) || a.order - b.order);
  }

  list(): { id: string; phase: Phase; every: number; module: string }[] {
    return this.systems.map((s) => ({ id: s.id, phase: s.phase, every: s.every ?? 1, module: s.module }));
  }

  run(sim: Sim, tick: number, dt: number): void {
    const p = this.profiler;
    for (const s of this.systems) {
      const every = s.every ?? 1;
      if (tick % every !== 0) continue;
      if (p) {
        const t0 = p.now();
        s.run(sim, dt * every);
        this.timings.set(s.id, p.now() - t0);
      } else s.run(sim, dt * every);
    }
  }
}
