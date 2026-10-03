// 经济模块：物品、仓库（每座城一个）、携带、取货 / 卸货 / 转运；粮食每天损耗；库存告急提醒。
import type { GameModule } from '../../../engine/module';
import type { Sim } from '../../../engine/sim';
import { defineComponent } from '../../../engine/ecs';
import { Transform } from '../../../engine/motion';
import { ITEMS } from '../../../../content/items';
import type { ItemDef } from '../../../shared/content';

const findItem = (w: string) => ITEMS.find((x) => x.id === w || x.name === w || x.aliases.includes(w));

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
  /** 粮食每天损耗比例（建仓库会降低） */
  spoil: number;
}

export interface EconomyApi {
  items: ItemDef[];
  itemIndex(id: string): number;
  itemByName(name: string): ItemDef | undefined;
  stores: Store[];
  addStore(name: string, x: number, y: number, radius: number): number;
  /** 按名字 / 别名取物品数量：{ 粮: 200 } → [['food', 200]] */
  parseGoods(goods: Record<string, number>): [string, number][];
  has(store: number, goods: [string, number][]): boolean;
  /** 扣库存（不够就不扣，返回 false） */
  take(store: number, goods: [string, number][]): boolean;
  give(store: number, goods: [string, number][]): void;
}

export const economy: GameModule = {
  id: 'economy',
  name: '经济',
  requires: ['world'],
  components: [Carry],
  views: [{ id: 'stock', text: '各城库存' }],
  argTypes: [
    {
      id: 'item',
      name: '物品',
      parse(tok) {
        const it = findItem(tok);
        return it ? { ok: true, value: it.id } : { ok: false, error: `不认识的东西「${tok}」`, hint: ITEMS.map((x) => x.aliases[0]).join(' ') };
      },
      choices: () => ITEMS.map((x) => x.aliases[0]),
    },
    {
      id: 'amount',
      name: '东西',
      parse(tok) {
        // 300金 / 金300 / 粮200+铁50
        const out: [string, number][] = [];
        for (const part of tok.split('+')) {
          const m = /^(\d+)(\D+)$/.exec(part) || /^(\D+)(\d+)$/.exec(part);
          if (!m) return { ok: false, error: `「${part}」要写成 粮200 或 300金`, hint: '多样东西用 + 连接：粮200+铁50' };
          const [num, name] = /^\d/.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]];
          const it = findItem(name);
          if (!it) return { ok: false, error: `不认识的东西「${name}」`, hint: ITEMS.map((x) => x.aliases[0]).join(' ') };
          if (+num <= 0) return { ok: false, error: '数量要大于 0' };
          out.push([it.id, +num]);
        }
        return { ok: true, value: out };
      },
    },
  ],
  events: [{ id: 'stock.low', module: 'economy', text: '库存告急（粮食不够吃 5 天）' }],
  systems: [
    {
      id: 'economy.spoil',
      phase: 'economy',
      every: 100,
      run(sim) {
        const eco = sim.service<EconomyApi>('economy');
        const food = eco.itemIndex('food');
        for (const s of eco.stores) s.stock[food] *= 1 - s.spoil;
      },
    },
  ],
  save: {
    version: 1,
    save: (sim) => sim.service<EconomyApi>('economy').stores.map((s) => ({ stock: Array.from(s.stock), spoil: s.spoil })),
    load(sim, data) {
      const list = data as { stock: number[]; spoil: number }[];
      sim.service<EconomyApi>('economy').stores.forEach((s, i) => {
        if (!list[i]) return;
        s.stock.set(list[i].stock);
        s.spoil = list[i].spoil;
      });
    },
  },
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
    {
      id: 'withdraw',
      text: '在仓库旁边取货装进手里（库存不够就取剩下的）',
      run(sim: Sim, e: number, store: number, item: string, qty: number) {
        const eco = sim.service<EconomyApi>('economy');
        const C = sim.world.get(Carry);
        const P = sim.world.get(Transform);
        const s = eco.stores[store];
        if (!s) return { ok: false, reason: '没有这个仓库' };
        if ((P.x[e] - s.x) ** 2 + (P.y[e] - s.y) ** 2 > (s.radius + 20) ** 2) return { ok: false, reason: '离仓库太远' };
        const i = eco.itemIndex(item);
        if (C.item[e] && C.item[e] !== i + 1) return { ok: false, reason: '手里拿着别的东西' };
        const n = Math.min(qty, s.stock[i], C.cap[e] - C.qty[e]);
        if (n <= 0) return { ok: false, reason: '库存没了' };
        s.stock[i] -= n;
        C.item[e] = i + 1;
        C.qty[e] += n;
        return { ok: true, value: n };
      },
    },
    {
      id: 'convert',
      text: '仓库里把原料变成成品（打造兵器：铁 1 + 木 2 → 兵器 1）',
      run(sim: Sim, store: number, inputs: [string, number][], outputs: [string, number][]) {
        const eco = sim.service<EconomyApi>('economy');
        if (!eco.take(store, inputs)) return { ok: false, reason: '原料不够' };
        eco.give(store, outputs);
        return { ok: true };
      },
    },
    {
      id: 'transfer',
      text: '两个仓库之间直接划账（送礼、贡品、上帝赐予用；人搬货走 withdraw / deposit）',
      run(sim: Sim, from: number, to: number, goods: [string, number][]) {
        const eco = sim.service<EconomyApi>('economy');
        if (from >= 0 && !eco.take(from, goods)) return { ok: false, reason: '库存不够' };
        eco.give(to, goods);
        return { ok: true };
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
        stores.push({ id: stores.length, name, x, y, radius, stock: new Float64Array(ITEMS.length), spoil: 0.005 });
        return stores.length - 1;
      },
      parseGoods(goods) {
        return Object.entries(goods).map(([k, v]) => [(byName.get(k) ?? ITEMS.find((x) => x.id === k))!.id, v]);
      },
      has: (store, goods) => goods.every(([id, n]) => stores[store].stock[index.get(id)!] >= n - 1e-9),
      take(store, goods) {
        if (!goods.every(([id, n]) => stores[store].stock[index.get(id)!] >= n - 1e-9)) return false;
        for (const [id, n] of goods) stores[store].stock[index.get(id)!] -= n;
        return true;
      },
      give(store, goods) {
        for (const [id, n] of goods) stores[store].stock[index.get(id)!] += n;
      },
    });
  },
};
