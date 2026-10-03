// 事件：本拍产生的事件先排队，所有系统跑完后统一派发给订阅者。
// 每个事件类型必须由某个模块登记（EventDef），发未登记的事件直接报错。
export interface EventDef {
  id: string;
  module: string;
  text: string;
}
export interface GameEvent {
  type: string;
  tick: number;
  data: Record<string, unknown>;
  /** 谁看得到：'all' 公开；势力名 = 只有该势力；不写 = 只有上帝 */
  scope?: string;
}
type Handler = (ev: GameEvent) => void;

export class EventBus {
  private defs = new Map<string, EventDef>();
  private queue: GameEvent[] = [];
  private subs = new Map<string, Handler[]>();
  private any: Handler[] = [];

  define(def: EventDef): void {
    if (this.defs.has(def.id)) throw new Error(`事件重复登记：${def.id}`);
    this.defs.set(def.id, def);
  }
  list(): EventDef[] {
    return [...this.defs.values()];
  }
  emit(type: string, tick: number, data: Record<string, unknown>, scope?: string): void {
    if (!this.defs.has(type)) throw new Error(`事件没登记：${type}`);
    this.queue.push({ type, tick, data, scope });
  }
  on(type: string | '*', fn: Handler): void {
    if (type === '*') this.any.push(fn);
    else {
      if (!this.subs.has(type)) this.subs.set(type, []);
      this.subs.get(type)!.push(fn);
    }
  }
  flush(): void {
    // 派发过程中新产生的事件留到下一拍
    const q = this.queue;
    this.queue = [];
    for (const ev of q) {
      for (const fn of this.subs.get(ev.type) || []) fn(ev);
      for (const fn of this.any) fn(ev);
    }
  }
}
