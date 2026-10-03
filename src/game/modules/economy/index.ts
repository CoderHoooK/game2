// 经济模块：物品、仓库（每座城一个）、携带。第 1 阶段加国库、搬运、库存告急。
import type { GameModule } from '../../../engine/module';
import type { Sim } from '../../../engine/sim';
import { defineComponent } from '../../../engine/ecs';
import { Transform } from '../../../engine/motion';
import { ITEMS } from '../../../../content/items';
import type { ItemDef } from '../../../shared/content';

export const Carry = defineComponent('Carry', '携带', { item: 'u8', qty: 'f32', cap: 'f32' }, {
  item: '物品（0 = 空手，否则 = 物品序号 + 1；只拿一种）',
  qty: '数量',
  cap: '上限',
});

export interface Store {
  id: number;
  name: string;
  x: number;
  y: number;
  /** 走到这个半径以内就能卸货 */
  radius: number;
  stock: Float64Array;
}

export interface EconomyApi {
  items: ItemDef[];
  itemIndex(id: string): number;
  itemByName(name: string): ItemDef | undefined;
  stores: Store[];
  addStore(name: string, x: number, y: number, radius: number): number;
}

export const economy: GameModule = {
  id: 'economy',
  name: '经济',
  requires: ['world'],
  components: [Carry],
  views: [{ id: 'stock', text: '各城库存' }],
  actions: [
    {
      id: 'load',
      text: '把东西装进手里（手里有别的东西就装不了）',
      run(sim: Sim, e: number, item: string, qty: number) {
        const eco = sim.service<EconomyApi>('economy');
        const C = sim.world.get(Carry);
        const idx = eco.itemIndex(item) + 1;
        if (C.item[e] && C.item[e] !== idx) return { ok: false, reason: '手里拿着别的东西' };
        const add = Math.min(qty, C.cap[e] - C.qty[e]);
        if (add <= 0) return { ok: false, reason: '拿满了' };
        C.item[e] = idx;
        C.qty[e] += add;
        return { ok: true, value: add };
      },
    },
    {
      id: 'deposit',
      text: '在仓库旁边把手里的东西全部卸下',
      run(sim: Sim, e: number, store: number) {
        const eco = sim.service<EconomyApi>('economy');
        const C = sim.world.get(Carry);
        const P = sim.world.get(Transform);
        const s = eco.stores[store];
        if (!s) return { ok: false, reason: '没有这个仓库' };
        if (!C.item[e] || C.qty[e] <= 0) return { ok: false, reason: '手里是空的' };
        if ((P.x[e] - s.x) ** 2 + (P.y[e] - s.y) ** 2 > (s.radius + 20) ** 2) return { ok: false, reason: '离仓库太远' };
        const qty = C.qty[e];
        s.stock[C.item[e] - 1] += qty;
        C.item[e] = 0;
        C.qty[e] = 0;
        return { ok: true, value: qty };
      },
    },
  ],
  hash(sim, mix) {
    for (const s of sim.service<EconomyApi>('economy').stores) for (const v of s.stock) mix(Math.round(v * 100));
  },
  install(api) {
    const stores: Store[] = [];
    const index = new Map(ITEMS.map((it, i) => [it.id, i]));
    const byName = new Map<string, ItemDef>();
    for (const it of ITEMS) for (const a of [it.name, ...it.aliases]) byName.set(a, it);
    api.expose<EconomyApi>({
      items: ITEMS,
      itemIndex(id) {
        const i = index.get(id);
        if (i === undefined) throw new Error(`没有这种物品：${id}`);
        return i;
      },
      itemByName: (n) => byName.get(n),
      stores,
      addStore(name, x, y, radius) {
        stores.push({ id: stores.length, name, x, y, radius, stock: new Float64Array(ITEMS.length) });
        return stores.length - 1;
      },
    });
  },
};
