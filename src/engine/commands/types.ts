import type { Sim } from '../sim';

/** 命令从哪来：角色决定权限，来源只用于日志 */
export interface Source {
  role: 'lord' | 'god';
  /** 诸侯的势力名（role = lord 时必填） */
  faction?: string;
  origin: 'ai' | 'ui' | 'test' | 'script' | 'replay';
}

export interface ParseCtx {
  sim: Sim;
  src: Source;
}
export type ArgParse = { ok: true; value: unknown } | { ok: false; error: string; hint?: string };

/** 参数类型。引擎自带 sel / int / text，其余由模块登记（place、town、work……） */
export interface ArgTypeDef {
  id: string;
  name: string;
  /** 吃掉剩下所有内容（text、quota） */
  rest?: boolean;
  parse(token: string, ctx: ParseCtx): ArgParse;
  /** 可选值（给提示、界面下拉框用） */
  choices?(ctx: ParseCtx): string[];
}

export interface CommandResult {
  ok: boolean;
  msg: string;
  warns?: string[];
}

export interface CommandDef {
  id: string;
  verb: string;
  aliases?: string[];
  who: ('lord' | 'god')[];
  /** 这条命令会生成哪种长期命令（用于推导"某职业能接哪些命令"） */
  order?: string;
  /** [参数名, 参数类型]；参数名以 ? 结尾表示可省略（只能放在最后） */
  args: [string, string][];
  help: string;
  examples: string[];
  run(ctx: ParseCtx & { tick: number }, args: Record<string, unknown>): CommandResult;
}
