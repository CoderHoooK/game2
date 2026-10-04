// 把代码里「能推出来的」东西同步进 atlas/data.js：模块的依赖/事件/动作、组件字段、长期命令、行为、职业状态、命令的参数/说明/例子。
// 手写的简介、图标、阶段、步骤等不动；没变的条目一个字都不改。新条目追加到对应列表末尾。
// 用法：npm run atlas:sync（然后 npm run atlas 校验 + 生成 docs/atlas.html）
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createGame, MODULES } from '../src/game';
import { legacy } from '../tests/helpers';
import { PROFESSIONS } from '../content/professions';

type Any = Record<string, any>;
const FILE = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../atlas/data.js');
let text = readFileSync(FILE, 'utf8');
const sim = createGame({ seed: 1, config: legacy(50) });
const LIVE = new Set(['wip', 'done']);
const union = (a: string[] = [], b: string[] = []) => [...a, ...b.filter((x) => !a.includes(x))];
const changes: string[] = [];

// ---- 小型 JS 字面量扫描 / 输出
function skipString(s: string, i: number): number {
  const q = s[i];
  for (i++; i < s.length; i++) {
    if (s[i] === '\\') i++;
    else if (s[i] === q) return i;
  }
  throw new Error('字符串没闭合');
}
function matchClose(s: string, i: number): number {
  let depth = 0;
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === "'" || c === '"' || c === '`') i = skipString(s, i);
    else if (c === '/' && s[i + 1] === '/') i = s.indexOf('\n', i);
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') if (--depth === 0) return i;
  }
  throw new Error('括号没闭合');
}
const IDENT = /^[A-Za-z_$][\w$]*$/;
function lit(v: unknown): string {
  if (typeof v === 'string') return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return `[${v.map(lit).join(', ')}]`;
  const ents = Object.entries(v as Any).filter(([, x]) => x !== undefined);
  if (!ents.length) return '{}';
  return `{ ${ents.map(([k, x]) => `${IDENT.test(k) ? k : lit(k)}: ${lit(x)}`).join(', ')} }`;
}

/** 处理一个顶层列表：每个条目交给 fn 修改；fn 返回 false = 不动 */
function syncList(name: string, wanted: string[], make: (id: string) => Any, fn: (a: Any, id: string) => void): void {
  const head = `\n  ${name}: [`;
  const at = text.indexOf(head);
  if (at < 0) throw new Error(`data.js 里没有 ${name}`);
  const open = at + head.length - 1;
  const close = matchClose(text, open);
  let body = text.slice(open + 1, close);
  // 找出所有条目
  const items: { id: string; start: number; end: number; obj: Any }[] = [];
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "'" || c === '"') i = skipString(body, i);
    else if (c === '/' && body[i + 1] === '/') i = body.indexOf('\n', i);
    else if (c === '{') {
      const end = matchClose(body, i);
      const obj = vm.runInNewContext(`(${body.slice(i, end + 1)})`) as Any;
      items.push({ id: obj.id, start: i, end: end + 1, obj });
      i = end;
    }
  }
  // 从后往前改，下标不乱
  for (const it of [...items].reverse()) {
    if (!wanted.includes(it.id)) continue;
    const before = JSON.stringify(it.obj);
    fn(it.obj, it.id);
    if (JSON.stringify(it.obj) === before) continue;
    body = body.slice(0, it.start) + lit(it.obj) + body.slice(it.end);
    changes.push(`${name}.${it.id}`);
  }
  const add = wanted.filter((id) => !items.some((x) => x.id === id));
  if (add.length) {
    const tail = body.replace(/\s*$/, '');
    const extra = add
      .map((id) => {
        const o = make(id);
        fn(o, id);
        changes.push(`${name}.${id}（新）`);
        return `\n    ${lit(o)},`;
      })
      .join('');
    body = tail + (tail.endsWith(',') || tail.endsWith('[') || !tail.trim() ? '' : ',') + extra + '\n  ';
  }
  text = text.slice(0, open + 1) + body + text.slice(close);
}

// ---- 模块
syncList('modules', MODULES.map((m) => m.id), (id) => ({ id, name: '', icon: '🧩', requires: [], stage: 1, status: 'wip', summary: '' }), (a, id) => {
  const m = MODULES.find((x) => x.id === id)!;
  a.name = m.name;
  if (!LIVE.has(a.status)) a.status = 'wip';
  a.requires = union(a.requires, m.requires);
  if (m.components?.length) a.components = union(a.components, m.components.map((c) => c.id));
  if (m.orders?.length) a.orders = union(a.orders, m.orders.map((o) => o.id));
  a.actions = union(a.actions, (m.actions || []).map((x) => x.id));
  a.events = union(a.events, (m.events || []).map((e) => e.id));
  if (m.views?.length) a.views = union(a.views, m.views.map((v) => v.id));
  if (!a.summary) a.summary = m.name;
});

// ---- 组件
const ENGINE_COMPONENTS = ['Transform', 'Motion', 'Brain', 'Membership', 'Lod'];
const owner = new Map<string, string>(ENGINE_COMPONENTS.map((c) => [c, 'engine']));
for (const m of MODULES) for (const c of m.components || []) owner.set(c.id, m.id);
syncList('components', [...owner.keys()], (id) => ({ id, name: '', owner: '', base: false, status: 'done', fields: [] }), (a, id) => {
  const def = sim.world.components().find((c) => c.id === id)!;
  a.name = def.name;
  a.owner = owner.get(id);
  a.status = 'done';
  const old = new Map<string, string[]>((a.fields || []).map((f: string[]) => [f[0], f]));
  const docs = (def.docs || {}) as Record<string, string>;
  a.fields = Object.entries(def.fields).map(([k, kind]) => {
    const prev = old.get(k);
    return [k, String(kind), prev?.[2] ?? docs[k] ?? k];
  });
});

// ---- 长期命令
const orders = [...sim.brains.orderDefs.values()] as Any[];
syncList('orders', orders.map((o) => o.id), (id) => ({ id }), (a, id) => {
  const o = orders.find((x) => x.id === id)!;
  a.name = o.name;
  a.module = o.module;
  a.params = o.params;
  a.text = o.text;
  a.status = 'done';
});

// ---- 行为
const behaviors = sim.brains.behaviors as Any[];
syncList('behaviors', behaviors.map((b) => b.id), (id) => ({ id, status: 'wip' }), (a, id) => {
  const b = behaviors.find((x) => x.id === id)!;
  if (!LIVE.has(a.status)) a.status = 'wip';
  a.acts = b.acts;
  a.name = b.name;
  a.module = b.module;
  a.fits = b.orders;
  if (b.support) a.support = true;
  else delete a.support;
  if (a.coarse === undefined) a.coarse = true;
  if (!a.loop) a.loop = [];
  a.text = b.text;
});

// ---- 职业
syncList('professions', PROFESSIONS.map((p) => p.id), (id) => ({ id }), (a, id) => {
  const p = PROFESSIONS.find((x) => x.id === id)!;
  a.name = p.name;
  a.short = p.short;
  a.color = p.color;
  a.tags = p.tags;
  a.stats = p.stats;
  a.behaviors = p.behaviors;
  const working = p.behaviors.some((b) => !['idle', 'deliver'].includes(b) && sim.brains.behavior(b));
  if (working && !LIVE.has(a.status)) a.status = 'wip';
  if (!working) a.status = 'draft';
});

// ---- 命令
const commands = sim.bus.list() as Any[];
syncList('commands', commands.map((c) => c.id), (id) => ({ id }), (a, id) => {
  const c = commands.find((x) => x.id === id)!;
  a.verb = c.verb;
  a.module = c.module;
  a.who = c.who;
  if (c.order) a.order = c.order;
  else delete a.order;
  a.args = c.args;
  a.help = c.help;
  a.examples = c.examples;
  a.status = 'done';
});

const check = process.argv.includes('--check');
const orig = readFileSync(FILE, 'utf8');
if (text === orig) console.log('图谱已经和代码一致');
else if (check) {
  console.log('图谱和代码不一致：\n  ' + changes.join('\n  '));
  process.exit(1);
} else {
  writeFileSync(FILE, text);
  console.log(`改了 ${changes.length} 处：\n  ` + changes.join('\n  '));
}
