// 模拟：固定节拍、可重现。一拍 = 收命令 → 各阶段系统 → 派发事件。
import { World } from './ecs';
import { Clock } from './clock';
import { EventBus } from './events';
import { Scheduler } from './scheduler';
import { CommandBus } from './commands/bus';
import { Brains, Brain, Membership, decideSystem, behaveSystem, orderGcSystem } from './brain';
import { Transform, Motion, Lod, motionSystem } from './motion';
import { Rng } from '../shared/rng';
import type { ActionDef, GameModule, ViewDef } from './module';
import type { Result } from '../shared/types';

export interface SimOptions {
  seed: number;
  /** 实体容量上限（数组一次分配好） */
  capacity?: number;
  /** 覆盖模块配置：{ population: { npcs: 500 } } */
  config?: Record<string, Record<string, number | string | boolean>>;
}

export class Sim {
  readonly seed: number;
  readonly world: World;
  readonly rng: Rng;
  readonly clock = new Clock();
  readonly events = new EventBus();
  readonly scheduler = new Scheduler();
  readonly bus: CommandBus;
  readonly brains: Brains;
  /** 引擎不知道地形：由世界模块提供 */
  readonly hooks: { speedAt?: (x: number, y: number) => number; regionAt?: (x: number, y: number) => number } = {};
  readonly actions = new Map<string, ActionDef & { module: string }>();
  readonly views: (ViewDef & { module: string })[] = [];
  modules: GameModule[] = [];
  readonly services = new Map<string, unknown>();
  readonly config = new Map<string, Record<string, number | string | boolean>>();

  constructor(opts: SimOptions) {
    this.seed = opts.seed >>> 0;
    this.rng = new Rng(this.seed ^ 0x5eed);
    this.world = new World(opts.capacity ?? 16384);
    this.bus = new CommandBus(this);
    this.brains = new Brains(this);
    for (const c of [Transform, Motion, Brain, Membership, Lod]) this.world.register(c);
    for (const s of [decideSystem, behaveSystem, motionSystem, orderGcSystem]) this.scheduler.add(s, 'engine');
    this.addAction(
      {
        id: 'moveTo',
        text: '设目标点，移动系统每拍往前走',
        run: (sim: Sim, e: number, x: number, y: number) => {
          const M = sim.world.get(Motion);
          M.tx[e] = x;
          M.ty[e] = y;
          M.moving[e] = 1;
          return { ok: true };
        },
      },
      'engine',
    );
    this.addAction({ id: 'wait', text: '原地读条', run: () => ({ ok: true }) }, 'engine');
    this.addAction({ id: 'stop', text: '停下', run: (sim: Sim, e: number) => ((sim.world.get(Motion).moving[e] = 0), { ok: true }) }, 'engine');
  }

  addAction(def: ActionDef, module: string): void {
    if (this.actions.has(def.id)) throw new Error(`动作重复登记：${def.id}`);
    this.actions.set(def.id, { ...def, module });
  }

  /** 调用动作（改世界的唯一入口） */
  act(id: string, ...args: unknown[]): Result<unknown> {
    const a = this.actions.get(id);
    if (!a) throw new Error(`动作没登记：${id}`);
    return (a.run as (sim: Sim, ...rest: unknown[]) => Result<unknown>)(this, ...args);
  }

  service<T>(id: string): T {
    if (!this.services.has(id)) throw new Error(`模块没有公开接口：${id}`);
    return this.services.get(id) as T;
  }

  tick(): void {
    this.bus.runQueued();
    this.scheduler.run(this, this.clock.tick, this.clock.dt);
    this.events.flush();
    this.clock.tick++;
  }

  run(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.tick();
  }

  /** 整个世界的状态哈希：组件数组 + 各模块贡献 + 随机数状态 + 时钟 */
  hash(): number {
    let h = this.world.hash();
    const mix = (v: number) => {
      h ^= v | 0;
      h = Math.imul(h, 0x01000193);
    };
    mix(this.rng.state);
    mix(this.clock.tick);
    for (const m of this.modules) m.hash?.(this, mix);
    return h >>> 0;
  }
}
