// 图谱数据校验：引用完整、ID 不重复、模块依赖无环、命令例子全部能解析。
// 用法：node tools/check-atlas.mjs   （失败时退出码 1）
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await import(path.join(root, 'atlas/data.js'));
await import(path.join(root, 'atlas/parser.js'));
const A = globalThis.ATLAS;
const P = globalThis.AtlasParser;

const errors = [];
const err = (m) => errors.push(m);
let checks = 0;
const check = (cond, m) => { checks++; if (!cond) err(m); };

function uniq(list, key, what) {
  const seen = new Set();
  for (const x of list) { check(!seen.has(x[key]), `${what} 重复：${x[key]}`); seen.add(x[key]); }
  return seen;
}

const layerIds = uniq(A.layers, 'id', '分层');
const moduleIds = uniq(A.modules, 'id', '模块');
const compIds = uniq(A.components, 'id', '组件');
const orderIds = uniq(A.orders, 'id', '长期命令');
const behIds = uniq(A.behaviors, 'id', '行为');
uniq(A.professions, 'id', '职业');
uniq(A.professions, 'short', '职业简称');
uniq(A.professions, 'name', '职业名');
uniq(A.commands, 'id', '命令 ID');
uniq(A.commands, 'verb', '命令动词');
const STATUS = new Set(['draft', 'wip', 'done']);

// 分层：依赖存在、只能向下（按列表顺序：越靠后越底层；side 层不参与排序）
for (const l of A.layers) {
  check(STATUS.has(l.status), `分层 ${l.id} 状态非法`);
  for (const d of l.deps) check(layerIds.has(d), `分层 ${l.id} 依赖了不存在的 ${d}`);
}
const order = A.layers.filter((l) => !l.side).map((l) => l.id);
for (const l of A.layers.filter((x) => !x.side)) {
  for (const d of l.deps) {
    if (order.includes(d)) check(order.indexOf(d) > order.indexOf(l.id), `分层 ${l.id} 向上依赖了 ${d}`);
  }
}

// 模块：依赖存在、无环；登记的组件 / 长期命令存在
const owners = new Set([...moduleIds, 'engine', 'ai']);
for (const m of A.modules) {
  check(STATUS.has(m.status), `模块 ${m.id} 状态非法`);
  for (const r of m.requires) check(moduleIds.has(r), `模块 ${m.id} 依赖了不存在的 ${r}`);
  for (const c of m.components || []) check(compIds.has(c), `模块 ${m.id} 登记了不存在的组件 ${c}`);
  for (const o of m.orders || []) check(orderIds.has(o), `模块 ${m.id} 登记了不存在的长期命令 ${o}`);
}
{
  const state = new Map();
  const visit = (id, trail) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) { err('模块依赖成环：' + [...trail, id].join(' → ')); return; }
    state.set(id, 1);
    const m = A.modules.find((x) => x.id === id);
    for (const r of (m ? m.requires : [])) visit(r, [...trail, id]);
    state.set(id, 2);
  };
  for (const m of A.modules) visit(m.id, []);
  checks++;
}

// 组件 / 长期命令 / 行为 的归属和引用
for (const c of A.components) check(owners.has(c.owner), `组件 ${c.id} 的归属 ${c.owner} 不存在`);
for (const o of A.orders) {
  check(moduleIds.has(o.module), `长期命令 ${o.id} 的模块 ${o.module} 不存在`);
  const m = A.modules.find((x) => x.id === o.module);
  check(m && (m.orders || []).includes(o.id), `长期命令 ${o.id} 没在模块 ${o.module} 的 orders 里登记`);
  check(A.behaviors.some((b) => b.fits.includes(o.id)), `长期命令 ${o.id} 没有任何行为能完成`);
}
for (const b of A.behaviors) {
  check(moduleIds.has(b.module), `行为 ${b.id} 的模块 ${b.module} 不存在`);
  for (const f of b.fits) check(f === '*' || orderIds.has(f), `行为 ${b.id} 适配了不存在的长期命令 ${f}`);
  check(b.fits.length > 0 || b.support, `行为 ${b.id} 不完成任何命令，却没标成辅助行为（support）`);
}

// 行为调用的动作必须有归属：内核动作，或某个模块登记过
const ENGINE_ACTIONS = new Set(['moveTo', 'wait']);
const modActs = new Set(A.modules.flatMap((m) => m.actions || []));
for (const b of A.behaviors) {
  check(Array.isArray(b.acts) && b.acts.length > 0, `行为 ${b.id} 没写调用哪些动作`);
  for (const a of b.acts || []) check(ENGINE_ACTIONS.has(a) || modActs.has(a), `行为 ${b.id} 调用的动作 ${a} 没有模块负责`);
}

// 职业
for (const p of A.professions) {
  check(STATUS.has(p.status), `职业 ${p.id} 状态非法`);
  check(/^#[0-9a-f]{6}$/i.test(p.color), `职业 ${p.id} 颜色格式不对`);
  for (const b of p.behaviors) check(behIds.has(b), `职业 ${p.id} 用了不存在的行为 ${b}`);
  check(p.short.length === 1, `职业 ${p.id} 简称应为一个字`);
  check(P.professionOrders(p, A).length > 0, `职业 ${p.id} 接不了任何长期命令`);
}
// 组件 / 长期命令 / 行为 / 命令的状态是可选的（没写 = 草案），写了就必须合法；对不对得上代码由 tests/atlas-sync.test.ts 查
for (const [kind, list] of [['组件', A.components], ['长期命令', A.orders], ['行为', A.behaviors], ['命令', A.commands]])
  for (const x of list) check(x.status === undefined || STATUS.has(x.status), `${kind} ${x.id} 状态非法：${x.status}`);
for (const r of A.roadmap) check(STATUS.has(r.status), `路线图阶段 ${r.stage} 状态非法`);
for (const d of A.decisions) check(['open', 'decided'].includes(d.status), `待定事项「${d.q}」状态非法`);


// 命令：模块存在、长期命令存在、参数类型合法、每个例子都能解析
const ix = P.index(A);
for (const c of A.commands) {
  check(owners.has(c.module), `命令 ${c.verb} 的模块 ${c.module} 不存在`);
  if (c.order) check(orderIds.has(c.order), `命令 ${c.verb} 的长期命令 ${c.order} 不存在`);
  for (const [, t] of c.args) check(!!P.TYPES[t], `命令 ${c.verb} 的参数类型 ${t} 不存在`);
  check(c.examples.length > 0, `命令 ${c.verb} 没有例子`);
  check(c.help && c.help.length > 0, `命令 ${c.verb} 没有说明`);
  for (const ex of c.examples) {
    const r = P.parseCommand(ex, A, { ix, who: c.who[0] });
    check(r.ok, `命令例子解析失败：${ex} —— ${r.error}`);
  }
}
// 每个职业推导出的命令例子也必须能解析
for (const p of A.professions) {
  for (const pc of P.professionCommands(p, A)) {
    const r = P.parseCommand(pc.example, A, { ix, who: 'lord' });
    check(r.ok, `职业 ${p.name} 的推导例子解析失败：${pc.example} —— ${r.error}`);
  }
}
// 选择器速查表里的写法都能解析
for (const s of A.selectors) {
  for (const syn of s.syntax.split(' / ')) {
    const r = P.parseSelector(syn.trim(), ix);
    check(r.ok, `选择器速查表写法解析失败：${syn} —— ${r.error}`);
  }
}
// 能力事实：职业能接哪些长期命令（防止改数据时悄悄放宽）
const can = (prof, order) => P.professionOrders(A.professions.find((p) => p.id === prof), A).some((o) => o.id === order);
for (const [prof, order, want] of [
  ['soldier', 'attack', true], ['soldier', 'guard', true], ['soldier', 'scout', false], ['soldier', 'work', false],
  ['scout', 'scout', true], ['scout', 'attack', true] /* 行军行为也负责进攻途中的行军，斥候可以跟着攻 */,
  ['builder', 'build', true], ['merchant', 'build', false], ['smith', 'build', false], ['porter', 'haul', true],
  ['woodcutter', 'work', true], ['porter', 'work', false], ['woodcutter', 'attack', false], ['merchant', 'trade', true],
]) check(can(prof, order) === want, `能力事实不符：${prof} ${want ? '应能' : '不应能'}接 ${order}`);

// 解析器的反例：这些必须失败
for (const badLine of ['派 @木 伐木 火星', '攻 #一队 赤焰.鹿鸣城', '比例 青石城 农80 木30', '转 @农:0 兵', '飞 @木', '灾 旱 北林']) {
  const r = P.parseCommand(badLine, A, { ix, who: 'lord' });
  check(!r.ok, `本应失败却通过：${badLine}`);
}

if (errors.length) {
  console.error(`✗ 图谱校验失败（${errors.length} 处 / ${checks} 项）：`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(`✓ 图谱校验通过：${checks} 项（${A.modules.length} 个模块、${A.professions.length} 个职业、${A.behaviors.length} 种行为、${A.commands.length} 条命令）`);
