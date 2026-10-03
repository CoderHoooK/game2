// 命令总线：来源（AI / 上帝 / 界面 / 测试 / 脚本）→ 解析 → 校验 → 下一拍开头执行 → 结果。
// 所有来源走同一条路；执行过的命令按顺序记进 log，就是复盘文件。
import type { Sim } from '../sim';
import type { ArgTypeDef, CommandDef, CommandResult, ParseCtx, Source } from './types';
import { applySelector, parseSelector, type Selector, type SelectorResolver } from './selector';

export type ParseResult =
  | { ok: true; cmd: CommandDef; args: Record<string, unknown> }
  | { ok: false; error: string; hint?: string };

interface Pending {
  src: Source;
  line: string;
  cmd: CommandDef;
  args: Record<string, unknown>;
  cb?: (r: CommandResult) => void;
}

export interface LogEntry {
  tick: number;
  src: Source;
  line: string;
  ok: boolean;
  msg: string;
}

export class CommandBus {
  private byId = new Map<string, CommandDef & { module: string }>();
  private byVerb = new Map<string, CommandDef & { module: string }>();
  private types = new Map<string, ArgTypeDef>();
  private queue: Pending[] = [];
  resolver?: SelectorResolver;
  readonly log: LogEntry[] = [];

  constructor(private sim: Sim) {
    this.addType({
      id: 'sel',
      name: '选择器',
      parse: (tok, ctx) => {
        const p = parseSelector(tok);
        if (!p.ok) return { ok: false, error: p.error, hint: '如 @木:5、@兵@青石城、#一队、阿三' };
        if (!this.resolver) return { ok: false, error: '没有模块提供选择器解释' };
        for (const part of p.sel) {
          const bad = this.resolver.check(part, ctx.src);
          if (bad) return { ok: false, ...bad };
        }
        return { ok: true, value: p.sel };
      },
    });
    this.addType({
      id: 'int',
      name: '整数',
      parse: (tok) => (/^-?\d+$/.test(tok) ? { ok: true, value: Number(tok) } : { ok: false, error: `「${tok}」不是整数` }),
    });
    this.addType({ id: 'text', name: '文字', rest: true, parse: (tok) => ({ ok: true, value: tok }) });
  }

  addType(def: ArgTypeDef): void {
    if (this.types.has(def.id)) throw new Error(`参数类型重复登记：${def.id}`);
    this.types.set(def.id, def);
  }
  hasType(id: string): boolean {
    return this.types.has(id);
  }
  type(id: string): ArgTypeDef | undefined {
    return this.types.get(id);
  }

  register(def: CommandDef, module: string): void {
    if (this.byId.has(def.id)) throw new Error(`命令 ID 重复：${def.id}`);
    for (const v of [def.verb, ...(def.aliases || [])]) {
      if (this.byVerb.has(v)) throw new Error(`命令动词重复：${v}（${def.id} 和 ${this.byVerb.get(v)!.id}）`);
    }
    let seenOptional = false;
    for (const [name, type] of def.args) {
      if (!this.types.has(type)) throw new Error(`命令 ${def.id} 的参数「${name}」类型没登记：${type}`);
      const optional = name.endsWith('?');
      if (seenOptional && !optional) throw new Error(`命令 ${def.id}：可省略的参数只能放在最后`);
      seenOptional ||= optional;
    }
    const full = { ...def, module };
    this.byId.set(def.id, full);
    for (const v of [def.verb, ...(def.aliases || [])]) this.byVerb.set(v, full);
  }

  list(): (CommandDef & { module: string })[] {
    return [...this.byId.values()];
  }
  get(id: string): (CommandDef & { module: string }) | undefined {
    return this.byId.get(id);
  }

  signature(def: CommandDef): string {
    return [def.verb, ...def.args.map(([n]) => (n.endsWith('?') ? `[${n.slice(0, -1)}]` : `<${n}>`))].join(' ');
  }

  parse(line: string, src: Source): ParseResult {
    const tokens = line.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return { ok: false, error: '空命令' };
    const cmd = this.byVerb.get(tokens[0]);
    if (!cmd) {
      const verbs = this.list().filter((c) => c.who.includes(src.role)).map((c) => c.verb);
      return { ok: false, error: `不认识的命令「${tokens[0]}」`, hint: `可用：${verbs.join(' ')}` };
    }
    if (!cmd.who.includes(src.role)) return { ok: false, error: `「${cmd.verb}」只有${cmd.who.map((w) => (w === 'god' ? '上帝' : '诸侯')).join('、')}能用` };
    if (src.role === 'lord' && !src.faction) return { ok: false, error: '诸侯命令要带势力' };
    const ctx: ParseCtx = { sim: this.sim, src };
    const args: Record<string, unknown> = {};
    let i = 1;
    for (const [rawName, typeId] of cmd.args) {
      const optional = rawName.endsWith('?');
      const name = optional ? rawName.slice(0, -1) : rawName;
      const type = this.types.get(typeId)!;
      let tok: string | undefined;
      if (type.rest) {
        tok = tokens.slice(i).join(' ') || undefined;
        i = tokens.length;
      } else tok = tokens[i++];
      if (tok === undefined) {
        if (optional) continue;
        return { ok: false, error: `缺少参数「${name}」`, hint: this.signature(cmd) };
      }
      const r = type.parse(tok, ctx);
      if (!r.ok) return { ok: false, error: `参数「${name}」：${r.error}`, hint: r.hint ?? this.signature(cmd) };
      args[name] = r.value;
    }
    if (i < tokens.length) return { ok: false, error: `多了参数：${tokens.slice(i).join(' ')}`, hint: this.signature(cmd) };
    return { ok: true, cmd, args };
  }

  /** 提交：立刻返回解析结果；解析成功的排队，下一拍开头执行，执行结果走回调 */
  submit(line: string, src: Source, cb?: (r: CommandResult) => void): ParseResult {
    const p = this.parse(line, src);
    if (p.ok) this.queue.push({ src, line: line.trim(), cmd: p.cmd, args: p.args, cb });
    return p;
  }

  /** 每拍开头由模拟调用 */
  runQueued(): void {
    const q = this.queue;
    this.queue = [];
    for (const p of q) {
      const r = this.run(p.cmd, p.args, p.src);
      this.log.push({ tick: this.sim.clock.tick, src: p.src, line: p.line, ok: r.ok, msg: r.msg });
      p.cb?.(r);
    }
  }

  /** 解析并立刻执行（测试、工具用；正常游戏走 submit） */
  exec(line: string, src: Source): CommandResult {
    const p = this.parse(line, src);
    if (!p.ok) return { ok: false, msg: p.error + (p.hint ? `（${p.hint}）` : '') };
    const r = this.run(p.cmd, p.args, src);
    this.log.push({ tick: this.sim.clock.tick, src, line: line.trim(), ok: r.ok, msg: r.msg });
    return r;
  }

  private run(cmd: CommandDef, args: Record<string, unknown>, src: Source): CommandResult {
    try {
      return cmd.run({ sim: this.sim, src, tick: this.sim.clock.tick }, args);
    } catch (e) {
      return { ok: false, msg: `执行出错：${(e as Error).message}` };
    }
  }

  /** 选择器 → 人（按数量截取、去重） */
  select(sel: Selector, src: Source): number[] {
    if (!this.resolver) throw new Error('没有模块提供选择器解释');
    return applySelector(sel, src, this.resolver);
  }
}
