// 模块注册：按 requires 排序 → 登记各项 → install → 总检查。任何一项不合规，启动直接报错。
import { Sim, type SimOptions } from './sim';
import type { GameModule, ModuleApi } from './module';
import type { CommandDef } from './commands/types';

export function sortModules(modules: GameModule[]): GameModule[] {
  const byId = new Map<string, GameModule>();
  for (const m of modules) {
    if (byId.has(m.id)) throw new Error(`模块 ID 重复：${m.id}`);
    byId.set(m.id, m);
  }
  for (const m of modules) for (const r of m.requires || []) if (!byId.has(r)) throw new Error(`模块 ${m.id} 依赖的 ${r} 没登记`);
  const out: GameModule[] = [];
  const state = new Map<string, 1 | 2>();
  const visit = (m: GameModule, trail: string[]) => {
    if (state.get(m.id) === 2) return;
    if (state.get(m.id) === 1) throw new Error(`模块依赖成环：${[...trail, m.id].join(' → ')}`);
    state.set(m.id, 1);
    for (const r of m.requires || []) visit(byId.get(r)!, [...trail, m.id]);
    state.set(m.id, 2);
    out.push(m);
  };
  for (const m of modules) visit(m, []);
  return out;
}

export function createSim(modules: GameModule[], opts: SimOptions): Sim {
  const sorted = sortModules(modules);
  const sim = new Sim(opts);
  sim.modules = sorted;
  for (const key of Object.keys(opts.config || {})) {
    if (!sorted.some((m) => m.id === key)) throw new Error(`配置覆盖了不存在的模块：${key}`);
  }
  const lateCommands: [CommandDef, string][] = [];
  const starts: (() => void)[] = [];
  for (const m of sorted) {
    // 配置：默认值 + 覆盖，校验范围
    const cfg: Record<string, number | string | boolean> = {};
    const over = opts.config?.[m.id] || {};
    for (const k of Object.keys(over)) if (!m.config?.[k]) throw new Error(`模块 ${m.id} 没有配置项 ${k}`);
    for (const [k, f] of Object.entries(m.config || {})) {
      const v = over[k] ?? f.default;
      if (typeof v !== typeof f.default) throw new Error(`配置 ${m.id}.${k} 类型不对`);
      if (typeof v === 'number' && ((f.min !== undefined && v < f.min) || (f.max !== undefined && v > f.max))) {
        throw new Error(`配置 ${m.id}.${k} = ${v} 超出范围 [${f.min}, ${f.max}]`);
      }
      cfg[k] = v;
    }
    sim.config.set(m.id, cfg);

    for (const c of m.components || []) sim.world.register(c);
    for (const ev of m.events || []) sim.events.define({ ...ev, module: m.id });
    for (const o of m.orders || []) sim.brains.addOrderType(o, m.id);
    for (const b of m.behaviors || []) sim.brains.addBehavior(b, m.id);
    for (const t of m.argTypes || []) sim.bus.addType(t);
    for (const a of m.actions || []) sim.addAction(a, m.id);
    for (const s of m.systems || []) sim.scheduler.add(s, m.id);
    for (const v of m.views || []) sim.views.push({ ...v, module: m.id });

    const requires = new Set(m.requires || []);
    const api: ModuleApi = {
      sim,
      config: cfg,
      expose(obj) {
        if (sim.services.has(m.id)) throw new Error(`模块 ${m.id} 重复公开接口`);
        sim.services.set(m.id, obj);
      },
      use<T>(id: string): T {
        if (!requires.has(id)) throw new Error(`模块 ${m.id} 要用 ${id}，但没在 requires 里声明`);
        return sim.service<T>(id);
      },
      provideSelectors(r) {
        if (sim.bus.resolver) throw new Error('选择器解释只能由一个模块提供');
        sim.bus.resolver = r;
      },
      addBehavior(def) {
        sim.brains.addBehavior(def, m.id);
      },
      addCommand(def) {
        lateCommands.push([def, m.id]);
      },
      onStart(fn) {
        starts.push(fn);
      },
      provideHooks(h) {
        for (const k of Object.keys(h) as (keyof Sim['hooks'])[]) {
          if (sim.hooks[k]) throw new Error(`钩子 ${k} 已经有模块提供了`);
          (sim.hooks as Record<string, unknown>)[k] = h[k];
        }
      },
    };
    m.install?.(api);
  }
  sim.brains.finalize();
  // 命令最后登记：参数类型可能来自后面的模块
  for (const m of sorted) for (const c of m.commands || []) sim.bus.register(c, m.id);
  for (const [c, id] of lateCommands) sim.bus.register(c, id);

  // 总检查
  for (const c of sim.bus.list()) {
    if (c.order && !sim.brains.orderDefs.has(c.order)) throw new Error(`命令 ${c.id} 生成的长期命令类型没登记：${c.order}`);
    if (c.args.some(([, t]) => t === 'sel') && !sim.bus.resolver) throw new Error(`命令 ${c.id} 用了选择器，但没有模块提供选择器解释`);
    if (!c.examples.length) throw new Error(`命令 ${c.id} 没有例子`);
  }
  for (const b of sim.brains.behaviors) {
    for (const o of b.orders) if (o !== '*' && !sim.brains.orderDefs.has(o)) throw new Error(`行为 ${b.id} 声明的长期命令没登记：${o}`);
    for (const a of b.acts) if (!sim.actions.has(a)) throw new Error(`行为 ${b.id} 用到的动作没登记：${a}`);
  }
  for (const fn of starts) fn();
  return sim;
}
