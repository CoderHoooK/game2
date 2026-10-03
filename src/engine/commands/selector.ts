// 选择器语法（不知道"伐木工"是什么，只管写法；名字由游戏层的 SelectorResolver 解释）
//   @木 / @伐木工 / @worker   按职业或标签
//   @木@青石城                 加地点（城镇 = 所属；地区 = 正在那里或被派到那里）
//   @木:5  @农:30%             数量 / 比例
//   #一队                      队伍
//   阿三                       某个人
//   *@河口镇                   某地所有人
//   @木,@石                    多选
import type { Entity } from '../../shared/types';
import type { Source } from './types';

export interface SelPart {
  head: { kind: 'tag' | 'all' | 'group' | 'name'; value: string };
  at?: string;
  count?: { n: number; pct: boolean };
  raw: string;
}
export type Selector = SelPart[];

export type SelParse = { ok: true; sel: Selector } | { ok: false; error: string };

const BAD = /[@#:,*%\s]/;

export function parseSelector(text: string): SelParse {
  const parts: SelPart[] = [];
  for (const raw of text.split(',')) {
    if (!raw) return { ok: false, error: `选择器「${text}」里有空的一项` };
    let rest = raw;
    let count: SelPart['count'];
    const m = /:(\d+)(%?)$/.exec(rest);
    if (m) {
      const n = Number(m[1]);
      const pct = m[2] === '%';
      if (n < 1 || (pct && n > 100)) return { ok: false, error: `「${raw}」的数量不对` };
      count = { n, pct };
      rest = rest.slice(0, m.index);
    } else if (rest.includes(':')) return { ok: false, error: `「${raw}」冒号后面要写数量，如 :5 或 :30%` };
    let head: SelPart['head'];
    if (rest.startsWith('*')) {
      head = { kind: 'all', value: '*' };
      rest = rest.slice(1);
    } else {
      const kind = rest.startsWith('@') ? 'tag' : rest.startsWith('#') ? 'group' : 'name';
      if (kind !== 'name') rest = rest.slice(1);
      const at = rest.indexOf('@');
      const value = at < 0 ? rest : rest.slice(0, at);
      if (!value || BAD.test(value)) return { ok: false, error: `「${raw}」写法不对` };
      head = { kind, value };
      rest = at < 0 ? '' : rest.slice(at);
    }
    let at: string | undefined;
    if (rest) {
      if (!rest.startsWith('@')) return { ok: false, error: `「${raw}」写法不对` };
      at = rest.slice(1);
      if (!at || BAD.test(at)) return { ok: false, error: `「${raw}」的地点写法不对` };
    }
    parts.push({ head, at, count, raw });
  }
  return { ok: true, sel: parts };
}

/** 游戏层提供：把名字解释成人 */
export interface SelectorResolver {
  /** 解析时检查名字存不存在；没问题返回 null */
  check(part: SelPart, src: Source): { error: string; hint?: string } | null;
  /** 候选人（已按权限过滤），按优先顺序：没锁定的、离得近的在前 */
  candidates(part: SelPart, src: Source): Entity[];
}

/** 按数量截取、多选去重 */
export function applySelector(sel: Selector, src: Source, r: SelectorResolver): Entity[] {
  const out: Entity[] = [];
  const seen = new Set<Entity>();
  for (const part of sel) {
    let list = r.candidates(part, src);
    if (part.count) {
      const n = part.count.pct ? Math.ceil((list.length * part.count.n) / 100) : part.count.n;
      list = list.slice(0, n);
    }
    for (const e of list) if (!seen.has(e)) (seen.add(e), out.push(e));
  }
  return out;
}
