// NPC 通用模板的"大脑"：命令 → 行为 → 动作。
//   长期命令（Order）：一个编组共用一条；改命令只改那一条。
//   行为（Behavior）：NPC 空闲时，从自己的行为表（kit）里挑 fits 分最高的；行为一步步调用动作。
import { defineComponent } from './ecs';
import type { Sim } from './sim';
import type { SystemDef } from './scheduler';
import type { Entity } from '../shared/types';
import { Motion } from './motion';

export const Brain = defineComponent(
  'Brain',
  '大脑',
  { beh: 'u8', step: 'u8', timer: 'f32', target: 'i32', target2: 'i32', order: 'u32', def: 'u32', kit: 'u16' },
  { beh: '当前行为（0 = 空闲）', step: '行为进行到第几步', timer: '读条计时', target: '行为目标', target2: '第二个目标（如搬运的目的地）', order: '所属长期命令', def: '平时的长期命令（放了以后回到它）', kit: '行为表' },
);
export const Membership = defineComponent('Membership', '编组', { group: 'u16', pinned: 'u8' }, { group: '所在队伍（0 = 无）', pinned: '是否锁定（直接派出去的人）' });

export interface Order {
  id: number;
  type: string;
  params: Record<string, unknown>;
  /** 给人看的描述，如"伐木 @ 北林" */
  label: string;
  owner?: string;
}

export interface OrderDef {
  id: string;
  name: string;
  params: string[];
  text: string;
}

export type Status = 'running' | 'done' | 'failed';

export interface BehaviorDef {
  id: string;
  name: string;
  /** 能完成哪些长期命令（'*' = 任何命令下都可能做，如逃跑、闲着） */
  orders: string[];
  /** 辅助行为：自己不完成命令，只给别的行为接力（如"送回"） */
  support?: boolean;
  /** 会调用哪些动作 */
  acts: string[];
  text: string;
  /** 0 = 做不了；越大越优先 */
  fits(sim: Sim, e: Entity, order: Order | undefined): number;
  /** 返回 false 表示现在开始不了（比如找不到资源点） */
  start(sim: Sim, e: Entity, order: Order | undefined): boolean;
  tick(sim: Sim, e: Entity, order: Order | undefined, dt: number): Status;
}

export class Brains {
  readonly behaviors: (BehaviorDef & { module: string })[] = [];
  private index = new Map<string, number>();
  readonly kits: number[][] = [];
  private kitIds: string[][] = [];
  private finalized = false;
  readonly orderDefs = new Map<string, OrderDef & { module: string }>();
  private orders = new Map<number, Order>();
  private nextOrder = 1;

  constructor(private sim: Sim) {}

  addBehavior(def: BehaviorDef, module: string): void {
    if (this.index.has(def.id)) throw new Error(`行为重复登记：${def.id}`);
    if (this.behaviors.length >= 254) throw new Error('行为太多（上限 254）');
    this.index.set(def.id, this.behaviors.length);
    this.behaviors.push({ ...def, module });
  }
  hasBehavior(id: string): boolean {
    return this.index.has(id);
  }
  behavior(id: string): (BehaviorDef & { module: string }) | undefined {
    const i = this.index.get(id);
    return i === undefined ? undefined : this.behaviors[i];
  }
  addOrderType(def: OrderDef, module: string): void {
    if (this.orderDefs.has(def.id)) throw new Error(`长期命令类型重复登记：${def.id}`);
    this.orderDefs.set(def.id, { ...def, module });
  }

  /** 行为表：记下行为 ID，返回表号。所有模块登记完后 finalize() 才换算成下标（行为可能来自后面的模块）；
   *  还没实现的行为 ID 会被跳过。 */
  defineKit(ids: string[]): number {
    const key = ids.join(',');
    let k = this.kitIds.findIndex((x) => x.join(',') === key);
    if (k < 0) {
      this.kitIds.push([...ids]);
      k = this.kitIds.length - 1;
      if (this.finalized) this.kits[k] = this.resolveKit(ids);
    }
    return k;
  }
  private resolveKit(ids: string[]): number[] {
    return ids.filter((id) => this.index.has(id)).map((id) => this.index.get(id)!);
  }
  finalize(): void {
    this.finalized = true;
    this.kits.length = 0;
    for (const ids of this.kitIds) this.kits.push(this.resolveKit(ids));
  }

  createOrder(type: string, params: Record<string, unknown>, label: string, owner?: string): Order {
    if (!this.orderDefs.has(type)) throw new Error(`长期命令类型没登记：${type}`);
    const o: Order = { id: this.nextOrder++, type, params, label, owner };
    this.orders.set(o.id, o);
    return o;
  }
  order(id: number): Order | undefined {
    return this.orders.get(id);
  }

  /** 把一批人交给同一条长期命令；pin = 锁定（自动分配不再动他们） */
  assign(list: Entity[], order: Order, pin: boolean): void {
    const B = this.sim.world.get(Brain);
    const G = this.sim.world.get(Membership);
    for (const e of list) {
      B.order[e] = order.id;
      if (pin) G.pinned[e] = 1;
      this.interrupt(e);
    }
  }
  /** 设平时的命令（不锁定的人跟着它走） */
  setDefault(e: Entity, order: Order): void {
    const B = this.sim.world.get(Brain);
    B.def[e] = order.id;
    if (!this.sim.world.get(Membership).pinned[e]) {
      B.order[e] = order.id;
      this.interrupt(e);
    }
  }
  /** 解除锁定，回到平时的命令 */
  release(e: Entity): void {
    const B = this.sim.world.get(Brain);
    this.sim.world.get(Membership).pinned[e] = 0;
    if (B.order[e] !== B.def[e]) {
      B.order[e] = B.def[e];
      this.interrupt(e);
    }
  }
  /** 打断当前行为（下一拍重新挑；手里拿着东西的会先送回） */
  interrupt(e: Entity): void {
    this.sim.world.get(Brain).beh[e] = 0;
    this.sim.world.get(Motion).moving[e] = 0;
  }

  /** 清掉没人用的长期命令（每天一次） */
  gc(): void {
    const B = this.sim.world.get(Brain);
    const used = new Set<number>();
    for (let e = 0; e < this.sim.world.hw; e++) if (B.has[e]) (used.add(B.order[e]), used.add(B.def[e]));
    for (const id of this.orders.keys()) if (!used.has(id)) this.orders.delete(id);
  }
  orderCount(): number {
    return this.orders.size;
  }
  /** 存档：所有长期命令（参数里的地点等对象原样存，要求能 JSON 化） */
  exportOrders(): { next: number; list: Order[] } {
    return { next: this.nextOrder, list: [...this.orders.values()] };
  }
  importOrders(data: { next: number; list: Order[] }): void {
    this.orders.clear();
    for (const o of data.list) this.orders.set(o.id, o);
    this.nextOrder = data.next;
  }
  /** 改一条长期命令的参数（同一编组的人立刻跟着变） */
  updateOrder(id: number, params: Record<string, unknown>, label?: string): void {
    const o = this.orders.get(id);
    if (!o) return;
    Object.assign(o.params, params);
    if (label) o.label = label;
  }

  /** 某个行为表能接哪些长期命令（推导"职业能接哪些命令"用） */
  kitOrders(kit: number): Set<string> {
    const s = new Set<string>();
    for (const i of this.kits[kit] || []) for (const o of this.behaviors[i].orders) if (o !== '*' && !this.behaviors[i].support) s.add(o);
    return s;
  }
}

export const decideSystem: SystemDef = {
  id: 'brain.decide',
  phase: 'ai_npc',
  run(sim: Sim) {
    const w = sim.world;
    const B = w.get(Brain);
    const br = sim.brains;
    const cand: { i: number; f: number }[] = [];
    for (let e = 0; e < w.hw; e++) {
      if (!B.has[e] || B.beh[e]) continue;
      const order = br.order(B.order[e]);
      cand.length = 0;
      for (const i of br.kits[B.kit[e]]) {
        const f = br.behaviors[i].fits(sim, e, order);
        if (f > 0) cand.push({ i, f });
      }
      cand.sort((a, b) => b.f - a.f || a.i - b.i);
      for (const c of cand) {
        B.step[e] = 0;
        B.timer[e] = 0;
        B.target[e] = -1;
        if (br.behaviors[c.i].start(sim, e, order)) {
          B.beh[e] = c.i + 1;
          break;
        }
      }
    }
  },
};

export const behaveSystem: SystemDef = {
  id: 'brain.tick',
  phase: 'act',
  run(sim: Sim, dt: number) {
    const w = sim.world;
    const B = w.get(Brain);
    const br = sim.brains;
    for (let e = 0; e < w.hw; e++) {
      const b = B.beh[e];
      if (!b || !B.has[e]) continue;
      const st = br.behaviors[b - 1].tick(sim, e, br.order(B.order[e]), dt);
      if (st !== 'running') B.beh[e] = 0;
    }
  },
};

export const orderGcSystem: SystemDef = {
  id: 'orders.gc',
  phase: 'post',
  every: 100,
  run(sim: Sim) {
    sim.brains.gc();
  },
};
