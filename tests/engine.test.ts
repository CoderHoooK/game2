import { describe, it, expect } from 'vitest';
import { parseSelector } from '../src/engine/commands/selector';
import { createSim, sortModules } from '../src/engine/registry';
import type { GameModule } from '../src/engine/module';
import { PointGrid } from '../src/engine/spatial';
import { Rng } from '../src/shared/rng';
import { defineComponent, World } from '../src/engine/ecs';

describe('选择器语法', () => {
  it('能解析所有写法', () => {
    const ok = (s: string) => {
      const p = parseSelector(s);
      if (!p.ok) throw new Error(p.error);
      return p.sel;
    };
    expect(ok('@木')[0]).toMatchObject({ head: { kind: 'tag', value: '木' } });
    expect(ok('@木@青石城')[0]).toMatchObject({ head: { kind: 'tag', value: '木' }, at: '青石城' });
    expect(ok('@木:5')[0].count).toEqual({ n: 5, pct: false });
    expect(ok('@农:30%')[0].count).toEqual({ n: 30, pct: true });
    expect(ok('#一队')[0].head).toEqual({ kind: 'group', value: '一队' });
    expect(ok('阿三')[0].head).toEqual({ kind: 'name', value: '阿三' });
    expect(ok('*@河口镇')[0]).toMatchObject({ head: { kind: 'all' }, at: '河口镇' });
    expect(ok('@兵@青石城:20')[0]).toMatchObject({ at: '青石城', count: { n: 20 } });
    expect(ok('@木,@石').length).toBe(2);
  });
  it('写错的会报错', () => {
    for (const s of ['@', '@木:', '@木:0', '@农:101%', '@木@', '@木,', '#', '*x', '@木:a']) expect(parseSelector(s).ok, s).toBe(false);
  });
});

describe('模块注册', () => {
  const m = (id: string, requires: string[] = [], extra: Partial<GameModule> = {}): GameModule => ({ id, name: id, requires, ...extra });
  it('按 requires 排序', () => {
    expect(sortModules([m('c', ['b']), m('b', ['a']), m('a')]).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });
  it('重复、缺依赖、成环都直接报错', () => {
    expect(() => sortModules([m('a'), m('a')])).toThrow(/重复/);
    expect(() => sortModules([m('a', ['x'])])).toThrow(/没登记/);
    expect(() => sortModules([m('a', ['b']), m('b', ['a'])])).toThrow(/成环/);
  });
  it('配置：默认值、覆盖、范围、未知项', () => {
    const mod = m('a', [], { config: { n: { default: 3, text: 'n', min: 1, max: 9 } } });
    expect(createSim([mod], { seed: 1 }).config.get('a')).toEqual({ n: 3 });
    expect(createSim([mod], { seed: 1, config: { a: { n: 5 } } }).config.get('a')).toEqual({ n: 5 });
    expect(() => createSim([mod], { seed: 1, config: { a: { n: 99 } } })).toThrow(/超出范围/);
    expect(() => createSim([mod], { seed: 1, config: { a: { x: 1 } } })).toThrow(/没有配置项/);
    expect(() => createSim([mod], { seed: 1, config: { b: {} } })).toThrow(/不存在的模块/);
  });
  it('没声明 requires 就用不到别的模块的接口', () => {
    const a = m('a', [], { install: (api) => api.expose({ hi: 1 }) });
    const b = m('b', [], { install: (api) => api.use('a') });
    expect(() => createSim([a, b], { seed: 1 })).toThrow(/没在 requires 里声明/);
    const b2 = m('b', ['a'], { install: (api) => expect(api.use<{ hi: number }>('a').hi).toBe(1) });
    expect(() => createSim([a, b2], { seed: 1 })).not.toThrow();
  });
  it('命令：动词重复、参数类型没登记、没有例子都报错', () => {
    const cmd = (id: string, verb: string, args: [string, string][] = [], examples = ['x']) => ({ id, verb, who: ['god' as const], args, help: '', examples, run: () => ({ ok: true, msg: '' }) });
    expect(() => createSim([m('a', [], { commands: [cmd('x', '走'), cmd('y', '走')] })], { seed: 1 })).toThrow(/动词重复/);
    expect(() => createSim([m('a', [], { commands: [cmd('x', '走', [['东西', 'nope']])] })], { seed: 1 })).toThrow(/类型没登记/);
    expect(() => createSim([m('a', [], { commands: [cmd('x', '走', [], [])] })], { seed: 1 })).toThrow(/没有例子/);
  });
  it('事件要先登记才能发', () => {
    const sim = createSim([m('a', [], { events: [{ id: 'a.x', module: 'a', text: '' }] })], { seed: 1 });
    expect(() => sim.events.emit('a.y', 0, {})).toThrow(/没登记/);
    let got = 0;
    sim.events.on('a.x', () => got++);
    sim.events.emit('a.x', 0, {});
    sim.tick();
    expect(got).toBe(1);
  });
});

describe('命令总线', () => {
  const sim = createSim(
    [
      {
        id: 'a',
        name: 'a',
        commands: [{ id: 'say', verb: '说', who: ['god'], args: [['次数', 'int'], ['话?', 'text']], help: '', examples: ['说 2 你好'], run: (_c, a) => ({ ok: true, msg: `${a['次数']}:${a['话'] ?? ''}` }) }],
      },
    ],
    { seed: 1 },
  );
  const god = { role: 'god' as const, origin: 'test' as const };
  it('解析、可省略参数、余下全部', () => {
    expect(sim.bus.exec('说 2 你好 世界', god)).toEqual({ ok: true, msg: '2:你好 世界' });
    expect(sim.bus.exec('说 3', god)).toEqual({ ok: true, msg: '3:' });
  });
  it('错误带提示', () => {
    expect(sim.bus.parse('说', god)).toMatchObject({ ok: false, error: '缺少参数「次数」', hint: '说 <次数> [话]' });
    expect(sim.bus.parse('说 x', god)).toMatchObject({ ok: false });
    expect(sim.bus.parse('跑', god)).toMatchObject({ ok: false, error: '不认识的命令「跑」' });
    expect(sim.bus.parse('说 1', { role: 'lord', faction: 'x', origin: 'test' })).toMatchObject({ ok: false });
  });
  it('提交的命令在下一拍开头执行，并记进复盘日志', () => {
    let res = '';
    sim.bus.submit('说 5 嗨', god, (r) => (res = r.msg));
    expect(res).toBe('');
    sim.tick();
    expect(res).toBe('5:嗨');
    expect(sim.bus.log.at(-1)).toMatchObject({ line: '说 5 嗨', ok: true });
  });
});

describe('空间索引', () => {
  it('最近点和暴力搜索结果一致', () => {
    const rng = new Rng(3);
    const g = new PointGrid(10000, 200);
    const pts: [number, number][] = [];
    for (let i = 0; i < 3000; i++) {
      const p: [number, number] = [rng.range(0, 10000), rng.range(0, 10000)];
      pts.push(p);
      g.insert(i, p[0], p[1]);
    }
    for (let k = 0; k < 200; k++) {
      const x = rng.range(0, 10000);
      const y = rng.range(0, 10000);
      const accept = (i: number) => i % 3 !== 0;
      let best = -1;
      let bd = 1500 ** 2;
      pts.forEach(([px, py], i) => {
        const d = (px - x) ** 2 + (py - y) ** 2;
        if (accept(i) && d < bd) ((bd = d), (best = i));
      });
      expect(g.nearest(x, y, 1500, accept)).toBe(best);
    }
  });
});

describe('组件存储', () => {
  it('增删实体、重用 ID、读全部组件', () => {
    const w = new World(8);
    const C = defineComponent('C', 'c', { a: 'f32', s: 'obj' });
    w.register(C);
    const e = w.create();
    w.add(e, C, { a: 1.5, s: 'x' });
    expect(w.inspect(e)).toEqual({ C: { a: 1.5, s: 'x' } });
    w.destroy(e);
    expect(w.has(e, C)).toBe(false);
    expect(w.create()).toBe(e);
    expect(() => {
      for (let i = 0; i < 10; i++) w.create();
    }).toThrow(/容量/);
  });
});
