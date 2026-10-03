// 图谱 ↔ 代码对照：代码里已经实现的东西，图谱里必须一模一样；图谱标了"完成/进行中"的，代码里必须真有。
// 不一致就失败 —— 图谱永远不会和代码脱节。改了代码跑 npm test，按提示改 atlas/data.js。
import { describe, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createGame, MODULES } from '../src/game';
import { PHASES } from '../src/engine/scheduler';
import { PROFESSIONS } from '../content/professions';

const ROOT = path.resolve(__dirname, '..');
type Any = Record<string, any>;
const ctx: Any = {};
ctx.globalThis = ctx;
vm.runInNewContext(readFileSync(path.join(ROOT, 'atlas/data.js'), 'utf8'), ctx);
const A: Any = ctx.ATLAS;
const sim = createGame({ seed: 1, config: { population: { npcs: 50 } } });
const LIVE = new Set(['wip', 'done']);
const byId = (list: Any[]) => new Map(list.map((x) => [x.id, x]));
const same = (a: unknown[], b: unknown[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const ENGINE_COMPONENTS = ['Transform', 'Motion', 'Brain', 'Membership', 'Lod'];

function check(fn: (bad: string[]) => void) {
  const bad: string[] = [];
  fn(bad);
  if (bad.length) throw new Error('图谱和代码不一致，改 atlas/data.js：\n  ' + bad.join('\n  '));
}

describe('图谱 ↔ 代码', () => {
  it('模块：依赖、事件、动作一致，状态是进行中/完成', () =>
    check((bad) => {
      const am = byId(A.modules);
      for (const m of MODULES) {
        const a = am.get(m.id);
        if (!a) {
          bad.push(`模块 ${m.id} 图谱里没有`);
          continue;
        }
        if (a.name !== m.name) bad.push(`模块 ${m.id} 名字：图谱「${a.name}」代码「${m.name}」`);
        if (!LIVE.has(a.status)) bad.push(`模块 ${m.id} 已经有代码，图谱状态应为 wip/done，现在是 ${a.status}`);
        for (const r of m.requires || []) if (!a.requires.includes(r)) bad.push(`模块 ${m.id} 代码依赖 ${r}，图谱没写`);
        // 反过来不查：图谱可以写以后才用到的依赖（比如上帝以后要动军事）
        for (const e of m.events || []) if (!a.events.includes(e.id)) bad.push(`模块 ${m.id} 的事件 ${e.id} 图谱没写`);
        for (const x of m.actions || []) if (!a.actions.includes(x.id)) bad.push(`模块 ${m.id} 的动作 ${x.id} 图谱没写`);
      }
      for (const a of A.modules) if (LIVE.has(a.status) && !MODULES.some((m) => m.id === a.id)) bad.push(`图谱说模块 ${a.id} 是 ${a.status}，代码里没有`);
    }));

  it('组件：主人和字段一致', () =>
    check((bad) => {
      const ac = byId(A.components);
      const owner = new Map<string, string>(ENGINE_COMPONENTS.map((c) => [c, 'engine']));
      for (const m of MODULES) for (const c of m.components || []) owner.set(c.id, m.id);
      for (const [id, mod] of owner) {
        const def = sim.world.components().find((c) => c.id === id)!;
        const a = ac.get(id);
        if (!a) {
          bad.push(`组件 ${id} 图谱里没有`);
          continue;
        }
        if (a.owner !== mod) bad.push(`组件 ${id} 主人：图谱 ${a.owner}，代码 ${mod}`);
        if (a.name !== def.name) bad.push(`组件 ${id} 名字：图谱「${a.name}」代码「${def.name}」`);
        const codeFields = Object.keys(def.fields);
        const atlasFields = a.fields.map((f: string[]) => f[0]);
        if (!same(codeFields, atlasFields)) bad.push(`组件 ${id} 字段：图谱 [${atlasFields}]，代码 [${codeFields}]`);
        if (a.status !== 'done') bad.push(`组件 ${id} 已实现，图谱 status 应为 done`);
      }
      for (const a of A.components) if (a.status === 'done' && !owner.has(a.id)) bad.push(`图谱说组件 ${a.id} 完成了，代码里没有`);
    }));

  it('长期命令类型一致', () =>
    check((bad) => {
      const ao = byId(A.orders);
      for (const o of sim.brains.orderDefs.values()) {
        const a = ao.get(o.id);
        if (!a) bad.push(`长期命令 ${o.id} 图谱里没有`);
        else {
          if (a.name !== o.name) bad.push(`长期命令 ${o.id} 名字：图谱「${a.name}」代码「${o.name}」`);
          if (a.module !== o.module) bad.push(`长期命令 ${o.id} 模块：图谱 ${a.module} 代码 ${o.module}`);
          if (a.status !== 'done') bad.push(`长期命令 ${o.id} 已实现，图谱 status 应为 done`);
        }
      }
      for (const a of A.orders) if (a.status === 'done' && !sim.brains.orderDefs.has(a.id)) bad.push(`图谱说长期命令 ${a.id} 完成了，代码里没有`);
    }));

  it('行为：名字、模块、能完成的命令、用到的动作一致', () =>
    check((bad) => {
      const ab = byId(A.behaviors);
      for (const b of sim.brains.behaviors) {
        const a = ab.get(b.id);
        if (!a) {
          bad.push(`行为 ${b.id} 图谱里没有`);
          continue;
        }
        if (a.name !== b.name) bad.push(`行为 ${b.id} 名字：图谱「${a.name}」代码「${b.name}」`);
        if (a.module !== b.module) bad.push(`行为 ${b.id} 模块：图谱 ${a.module} 代码 ${b.module}`);
        if (!same(a.fits, b.orders)) bad.push(`行为 ${b.id} 能完成的命令：图谱 [${a.fits}] 代码 [${b.orders}]`);
        if (!!a.support !== !!b.support) bad.push(`行为 ${b.id} 辅助行为标记不一致`);
        if (!same(a.acts, b.acts)) bad.push(`行为 ${b.id} 动作：图谱 [${a.acts}] 代码 [${b.acts}]`);
        if (!LIVE.has(a.status)) bad.push(`行为 ${b.id} 已实现，图谱 status 应为 wip/done`);
      }
      for (const a of A.behaviors) if (LIVE.has(a.status) && !sim.brains.behavior(a.id)) bad.push(`图谱说行为 ${a.id} 是 ${a.status}，代码里没有`);
    }));

  it('职业：名字、简称、颜色、标签、属性、行为表一致', () =>
    check((bad) => {
      const ap = byId(A.professions);
      if (!same(PROFESSIONS.map((p) => p.id), A.professions.map((p: Any) => p.id))) bad.push('职业清单不一致');
      for (const p of PROFESSIONS) {
        const a = ap.get(p.id);
        if (!a) continue;
        for (const k of ['name', 'short', 'color'] as const) if (a[k] !== p[k]) bad.push(`职业 ${p.id}.${k}：图谱 ${a[k]} 代码 ${p[k]}`);
        if (!same(a.tags, p.tags)) bad.push(`职业 ${p.id} 标签不一致`);
        if (JSON.stringify(a.stats) !== JSON.stringify(p.stats)) bad.push(`职业 ${p.id} 属性：图谱 ${JSON.stringify(a.stats)} 代码 ${JSON.stringify(p.stats)}`);
        if (JSON.stringify(a.behaviors) !== JSON.stringify(p.behaviors)) bad.push(`职业 ${p.id} 行为表：图谱 [${a.behaviors}] 代码 [${p.behaviors}]`);
        const working = p.behaviors.some((b) => !['idle', 'deliver'].includes(b) && sim.brains.behavior(b));
        if (working && !LIVE.has(a.status)) bad.push(`职业 ${p.id} 已经能干活，图谱 status 应为 wip/done`);
        if (!working && a.status !== 'draft') bad.push(`职业 ${p.id} 还没有能干的活，图谱 status 应为 draft`);
      }
    }));

  it('命令：动词、模块、谁能用、参数、生成的长期命令、例子一致', () =>
    check((bad) => {
      const ac = byId(A.commands);
      for (const c of sim.bus.list()) {
        const a = ac.get(c.id);
        if (!a) {
          bad.push(`命令 ${c.id}（${c.verb}）图谱里没有`);
          continue;
        }
        if (a.verb !== c.verb) bad.push(`命令 ${c.id} 动词：图谱 ${a.verb} 代码 ${c.verb}`);
        if (a.module !== c.module) bad.push(`命令 ${c.id} 模块：图谱 ${a.module} 代码 ${c.module}`);
        if (!same(a.who, c.who)) bad.push(`命令 ${c.id} 谁能用：图谱 [${a.who}] 代码 [${c.who}]`);
        if (JSON.stringify(a.args) !== JSON.stringify(c.args)) bad.push(`命令 ${c.id} 参数：图谱 ${JSON.stringify(a.args)} 代码 ${JSON.stringify(c.args)}`);
        if ((a.order ?? null) !== (c.order ?? null)) bad.push(`命令 ${c.id} 长期命令：图谱 ${a.order} 代码 ${c.order}`);
        if (a.help !== c.help) bad.push(`命令 ${c.id} 说明：图谱「${a.help}」代码「${c.help}」`);
        if (JSON.stringify(a.examples) !== JSON.stringify(c.examples)) bad.push(`命令 ${c.id} 例子：图谱 ${JSON.stringify(a.examples)} 代码 ${JSON.stringify(c.examples)}`);
        if (a.status !== 'done') bad.push(`命令 ${c.id} 已实现，图谱 status 应为 done`);
      }
      for (const a of A.commands) if (a.status === 'done' && !sim.bus.list().some((c) => c.id === a.id)) bad.push(`图谱说命令 ${a.id} 完成了，代码里没有`);
    }));

  it('节拍阶段顺序一致', () =>
    check((bad) => {
      const ids = A.tick.phases.map((p: Any) => p.id).filter((id: string) => (PHASES as readonly string[]).includes(id));
      if (JSON.stringify(ids) !== JSON.stringify(PHASES)) bad.push(`节拍阶段：图谱 [${ids}] 代码 [${PHASES}]`);
    }));

  it('分层：有代码的层是进行中/完成，目录都在', () =>
    check((bad) => {
      for (const l of A.layers) {
        const exists = l.dirs.some((d: string) => existsSync(path.join(ROOT, d)));
        if (exists && !LIVE.has(l.status)) bad.push(`层 ${l.id} 已经有代码，图谱 status 应为 wip/done`);
        if (!exists && LIVE.has(l.status)) bad.push(`层 ${l.id} 标了 ${l.status}，但目录 ${l.dirs} 不存在`);
      }
    }));

  it('示例世界用的是真实的诸侯和城镇', () =>
    check((bad) => {
      const pop = sim.service<{ factions: { name: string; towns: number[] }[]; towns: { name: string }[] }>('population');
      for (const f of pop.factions) {
        const want = f.towns.map((t) => pop.towns[t].name);
        const got = A.sampleWorld.towns[f.name];
        if (got && JSON.stringify(got) !== JSON.stringify(want)) bad.push(`示例世界 ${f.name} 的城镇：图谱 [${got}] 代码 [${want}]`);
      }
    }));
});
