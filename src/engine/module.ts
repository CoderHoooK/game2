// 核心契约：以后加任何功能，都是写一个模块并登记它。没有的字段不用填。
import type { ComponentDef } from './ecs';
import type { SystemDef } from './scheduler';
import type { EventDef } from './events';
import type { BehaviorDef, OrderDef } from './brain';
import type { ArgTypeDef, CommandDef } from './commands/types';
import type { SelectorResolver } from './commands/selector';
import type { Sim } from './sim';
import type { Result } from '../shared/types';

/** 动作：改世界的唯一入口。NPC 行为、命令、上帝、测试都调它，规则只写一份。 */
export interface ActionDef {
  id: string;
  text: string;
  run(sim: Sim, ...args: never[]): Result<unknown>;
}

export interface ConfigField {
  default: number | string | boolean;
  text: string;
  min?: number;
  max?: number;
}

/** 往前端推的数据通道（前端有同名图层） */
export interface ViewDef {
  id: string;
  text: string;
}

/** 存档段 + 版本迁移（第 6 阶段接存读档；现在先把接口留好） */
export interface SaveHandler {
  version: number;
  save(sim: Sim): unknown;
  load(sim: Sim, data: unknown, version: number): void;
}

/** 状态哈希：模块里不在组件数组中的状态（如库存、资源点）要贡献进来，可重现测试才有意义 */
export type HashFn = (sim: Sim, mix: (v: number) => void) => void;

export interface GameModule {
  id: string;
  name: string;
  requires?: string[];
  components?: ComponentDef[];
  systems?: SystemDef[];
  actions?: ActionDef[];
  orders?: OrderDef[];
  behaviors?: BehaviorDef[];
  argTypes?: ArgTypeDef[];
  commands?: CommandDef[];
  events?: EventDef[];
  views?: ViewDef[];
  config?: Record<string, ConfigField>;
  save?: SaveHandler;
  hash?: HashFn;
  /** 预留：AI 简报段落、唤醒规则（第 3 阶段） */
  briefing?: unknown[];
  wake?: unknown[];
  install?(api: ModuleApi): void;
}

export interface ModuleApi {
  sim: Sim;
  /** 本模块的配置（默认值 + 覆盖） */
  config: Record<string, number | string | boolean>;
  /** 公开接口：别的模块 requires 了我才能 use 到 */
  expose<T extends object>(api: T): void;
  use<T>(moduleId: string): T;
  provideSelectors(r: SelectorResolver): void;
  /** 需要用到别的模块接口的行为 / 命令，在 install 里用这两个登记（效果同静态字段） */
  addBehavior(def: BehaviorDef): void;
  addCommand(def: CommandDef): void;
  /** 开局：所有模块都登记完以后按顺序执行（生成开局世界的状态放这里，比如给 NPC 分职业） */
  onStart(fn: () => void): void;
  provideHooks(h: Partial<Sim['hooks']>): void;
}
