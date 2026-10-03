// 实体与组件：每种组件的每个字段是一个紧凑数组（下标 = 实体 ID）。
// 容量在创建世界时定死，数组永远不换，系统可以放心缓存列引用。
import type { Entity } from '../shared/types';

export type FieldKind = 'f32' | 'f64' | 'i32' | 'u32' | 'u16' | 'i16' | 'u8' | 'obj';
type ArrOf<K extends FieldKind> = K extends 'f32'
  ? Float32Array
  : K extends 'f64'
    ? Float64Array
    : K extends 'i32'
      ? Int32Array
      : K extends 'u32'
        ? Uint32Array
        : K extends 'u16'
          ? Uint16Array
          : K extends 'i16'
            ? Int16Array
            : K extends 'u8'
              ? Uint8Array
              : unknown[];
export type Fields = Record<string, FieldKind>;
export type Columns<F extends Fields> = { [K in keyof F]: ArrOf<F[K]> } & { has: Uint8Array };

export interface ComponentDef<F extends Fields = Fields> {
  id: string;
  name: string;
  fields: F;
  /** 字段说明（给检查面板 / 图谱看） */
  docs?: Partial<Record<keyof F & string, string>>;
}

export function defineComponent<F extends Fields>(id: string, name: string, fields: F, docs?: ComponentDef<F>['docs']): ComponentDef<F> {
  return { id, name, fields, docs };
}

function alloc(kind: FieldKind, n: number): Float32Array | Float64Array | Int32Array | Uint32Array | Uint16Array | Int16Array | Uint8Array | unknown[] {
  switch (kind) {
    case 'f32': return new Float32Array(n);
    case 'f64': return new Float64Array(n);
    case 'i32': return new Int32Array(n);
    case 'u32': return new Uint32Array(n);
    case 'u16': return new Uint16Array(n);
    case 'i16': return new Int16Array(n);
    case 'u8': return new Uint8Array(n);
    case 'obj': return new Array<unknown>(n).fill(null);
  }
}

interface Store {
  def: ComponentDef;
  cols: Record<string, ArrayLike<unknown> & { [i: number]: unknown }> & { has: Uint8Array };
}

export class World {
  readonly capacity: number;
  readonly alive: Uint8Array;
  /** 用过的最大实体 ID + 1：遍历到这里为止 */
  hw = 0;
  count = 0;
  private free: Entity[] = [];
  private stores = new Map<string, Store>();

  constructor(capacity: number) {
    this.capacity = capacity;
    this.alive = new Uint8Array(capacity);
  }

  register(def: ComponentDef): void {
    if (this.stores.has(def.id)) throw new Error(`组件重复登记：${def.id}`);
    const cols: Store['cols'] = { has: new Uint8Array(this.capacity) } as Store['cols'];
    for (const [k, kind] of Object.entries(def.fields)) {
      if (k === 'has') throw new Error(`组件 ${def.id} 的字段不能叫 has`);
      (cols as Record<string, unknown>)[k] = alloc(kind, this.capacity);
    }
    this.stores.set(def.id, { def, cols });
  }

  get<F extends Fields>(def: ComponentDef<F>): Columns<F> {
    const s = this.stores.get(def.id);
    if (!s) throw new Error(`组件没登记：${def.id}`);
    return s.cols as unknown as Columns<F>;
  }

  components(): ComponentDef[] {
    return [...this.stores.values()].map((s) => s.def);
  }

  create(): Entity {
    let e: Entity;
    if (this.free.length) e = this.free.pop()!;
    else {
      if (this.hw >= this.capacity) throw new Error(`实体数超过容量 ${this.capacity}`);
      e = this.hw++;
    }
    this.alive[e] = 1;
    this.count++;
    return e;
  }

  destroy(e: Entity): void {
    if (!this.alive[e]) return;
    this.alive[e] = 0;
    this.count--;
    for (const s of this.stores.values()) {
      s.cols.has[e] = 0;
      for (const k of Object.keys(s.def.fields)) {
        const col = s.cols[k];
        if (Array.isArray(col)) col[e] = null;
        else col[e] = 0;
      }
    }
    this.free.push(e);
  }

  add<F extends Fields>(e: Entity, def: ComponentDef<F>, values?: Partial<Record<keyof F, number | unknown>>): void {
    const c = this.get(def) as unknown as Store['cols'];
    c.has[e] = 1;
    if (values) for (const [k, v] of Object.entries(values)) c[k][e] = v;
  }

  has(e: Entity, def: ComponentDef): boolean {
    return this.get(def).has[e] === 1;
  }

  /** 读出某个实体的全部组件（检查面板用，不在热路径上） */
  inspect(e: Entity): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {};
    for (const s of this.stores.values()) {
      if (!s.cols.has[e]) continue;
      const o: Record<string, unknown> = {};
      for (const k of Object.keys(s.def.fields)) o[k] = s.cols[k][e];
      out[s.def.id] = o;
    }
    return out;
  }

  /** 状态哈希（可重现测试用）：所有活实体的所有数值字段 */
  hash(h = 0x811c9dc5): number {
    const mix = (v: number) => {
      h ^= v;
      h = Math.imul(h, 0x01000193);
    };
    const f = new Float32Array(1);
    const u = new Uint32Array(f.buffer);
    for (const s of this.stores.values()) {
      for (const [k, kind] of Object.entries(s.def.fields)) {
        if (kind === 'obj') continue;
        const col = s.cols[k] as unknown as ArrayLike<number>;
        for (let e = 0; e < this.hw; e++) {
          if (!s.cols.has[e]) continue;
          f[0] = col[e];
          mix(u[0]);
        }
      }
    }
    return h >>> 0;
  }
}
