// 世界模块：两层地图（地区图 + 按需区块）、资源点与懒刷新、地名。
import type { GameModule } from '../../../engine/module';
import type { Sim } from '../../../engine/sim';
import { PointGrid } from '../../../engine/spatial';
import { Rng } from '../../../shared/rng';
import { generateMap, generateChunk, Terrain, T, type MapData } from './mapgen';
import { TERRAINS, RESOURCE_KINDS, NODES_PER_REGION, NAME_HEADS, NAME_TAILS } from '../../../../content/terrain';
import type { ResourceKindDef, TerrainDef } from '../../../shared/content';

export { T, DECO, TERRAIN_KEYS } from './mapgen';
export type { Region, MapData } from './mapgen';

export interface Place {
  name: string;
  kind: 'region' | 'town';
  /** 地区 ID 或城镇 ID */
  id: number;
  x: number;
  y: number;
  region: number;
  faction?: string;
}

/** 资源点：数量 + 上次结算时间（懒恢复：被查询时按过去多久补上，不给每个点挂计时器） */
export class Nodes {
  kind: number[] = [];
  x: number[] = [];
  y: number[] = [];
  region: number[] = [];
  amount: number[] = [];
  last: number[] = [];
  get count(): number {
    return this.kind.length;
  }
}

export interface WorldApi {
  map: MapData;
  terrain: Terrain;
  terrains: TerrainDef[];
  kinds: ResourceKindDef[];
  nodes: Nodes;
  chunkCells: number;
  cellSize: number;
  regionAt(x: number, y: number): number;
  biomeAt(x: number, y: number): number;
  isLand(x: number, y: number): boolean;
  chunk(cx: number, cy: number): Uint8Array;
  addNode(kindKey: string, x: number, y: number, full?: boolean): number;
  /** 当前数量（顺便结算懒恢复） */
  level(n: number): number;
  nearestNode(kindKey: string, x: number, y: number, maxDist: number, region?: number, min?: number): number;
  addPlace(p: Place): void;
  place(name: string): Place | undefined;
  places(): Place[];
  renameRegion(id: number, name: string): void;
  /** 附近一个陆地上的随机点（试几次，找不到就返回原点） */
  landPointNear(x: number, y: number, r: number, rng: Rng): [number, number];
}

export const world: GameModule = {
  id: 'world',
  name: '世界',
  config: {
    size: { default: 10000, text: '地图边长（米）', min: 2000, max: 20000 },
    res: { default: 500, text: '全图栅格边长（像素）', min: 100, max: 2000 },
    regionGrid: { default: 20, text: '地区网格（20×20 ≈ 400 个地区）', min: 4, max: 40 },
  },
  views: [
    { id: 'terrain', text: '全图栅格 + 按需区块' },
    { id: 'resources', text: '资源点' },
    { id: 'regions', text: '地区名与中心' },
  ],
  events: [{ id: 'resource.depleted', module: 'world', text: '资源点被采空' }],
  argTypes: [
    {
      id: 'place',
      name: '地点',
      parse(tok, { sim }) {
        const w = sim.service<WorldApi>('world');
        const p = w.place(tok);
        if (p) return { ok: true, value: p };
        const near = w.places().filter((q) => q.name.includes(tok[0]) || q.name.includes(tok[tok.length - 1])).slice(0, 6).map((q) => q.name);
        return { ok: false, error: `没有叫「${tok}」的地方`, hint: near.length ? `相近的：${near.join('、')}` : undefined };
      },
      choices: ({ sim }) => sim.service<WorldApi>('world').places().map((p) => p.name),
    },
  ],
  actions: [
    {
      id: 'harvestTile',
      text: '从资源点取走一些资源，返回实际取到的数量',
      run(sim: Sim, n: number, want: number) {
        const w = sim.service<WorldApi>('world');
        const have = w.level(n);
        const take = Math.min(have, want);
        w.nodes.amount[n] = have - take;
        if (have - take < 1) sim.events.emit('resource.depleted', sim.clock.tick, { node: n });
        return { ok: take > 0, value: take, reason: take > 0 ? undefined : '采空了' };
      },
    },
  ],
  hash(sim, mix) {
    const n = sim.service<WorldApi>('world').nodes;
    for (let i = 0; i < n.count; i++) (mix(Math.round(n.amount[i] * 100)), mix(n.last[i]));
  },
  install(api) {
    const sim = api.sim;
    const size = api.config.size as number;
    const res = api.config.res as number;
    const map = generateMap(sim.seed, size, res, api.config.regionGrid as number);
    const terrain = new Terrain(sim.seed, size);
    const nodes = new Nodes();
    const grids = RESOURCE_KINDS.map(() => new PointGrid(size, 200));
    const kindIndex = new Map(RESOURCE_KINDS.map((k) => [k.key, k.id]));
    const places = new Map<string, Place>();
    const chunkCache = new Map<number, Uint8Array>();
    const chunkCells = 64;
    const cellSize = 2;
    const px = map.px;

    const pix = (x: number, y: number) => {
      const i = Math.min(res - 1, Math.max(0, Math.floor(x / px)));
      const j = Math.min(res - 1, Math.max(0, Math.floor(y / px)));
      return j * res + i;
    };
    const api2: WorldApi = {
      map,
      terrain,
      terrains: TERRAINS,
      kinds: RESOURCE_KINDS,
      nodes,
      chunkCells,
      cellSize,
      regionAt: (x, y) => map.region[pix(x, y)],
      biomeAt: (x, y) => map.biome[pix(x, y)],
      isLand: (x, y) => map.biome[pix(x, y)] > T.shallow,
      chunk(cx, cy) {
        const key = cy * 4096 + cx;
        let c = chunkCache.get(key);
        if (c) {
          chunkCache.delete(key);
          chunkCache.set(key, c);
          return c;
        }
        c = generateChunk(map, terrain, cx, cy, chunkCells, cellSize);
        chunkCache.set(key, c);
        if (chunkCache.size > 1024) chunkCache.delete(chunkCache.keys().next().value!);
        return c;
      },
      addNode(kindKey, x, y, full = true) {
        const k = kindIndex.get(kindKey);
        if (k === undefined) throw new Error(`没有这种资源点：${kindKey}`);
        const id = nodes.count;
        nodes.kind.push(k);
        nodes.x.push(x);
        nodes.y.push(y);
        nodes.region.push(api2.regionAt(x, y));
        nodes.amount.push(full ? RESOURCE_KINDS[k].max : 0);
        nodes.last.push(sim.clock.tick);
        grids[k].insert(id, x, y);
        return id;
      },
      level(n) {
        const k = RESOURCE_KINDS[nodes.kind[n]];
        const now = sim.clock.tick;
        const dt = (now - nodes.last[n]) / sim.clock.hz;
        if (dt > 0) {
          nodes.amount[n] = Math.min(k.max, nodes.amount[n] + k.regen * dt);
          nodes.last[n] = now;
        }
        return nodes.amount[n];
      },
      nearestNode(kindKey, x, y, maxDist, region, min = 1) {
        const k = kindIndex.get(kindKey);
        if (k === undefined) return -1;
        return grids[k].nearest(x, y, maxDist, (n) => (region === undefined || nodes.region[n] === region) && api2.level(n) >= min);
      },
      addPlace(p) {
        if (places.has(p.name)) throw new Error(`地名重复：${p.name}`);
        places.set(p.name, p);
      },
      place: (name) => places.get(name),
      places: () => [...places.values()],
      renameRegion(id, name) {
        const r = map.regions[id];
        const other = places.get(name);
        if (other && other.kind !== 'region') throw new Error(`地名已被城镇占用：${name}`);
        places.delete(r.name);
        if (other) {
          // 名字被别的地区占着：两边互换
          places.delete(name);
          const o = map.regions[other.id];
          o.name = r.name;
          places.set(o.name, { ...other, name: o.name });
        }
        r.name = name;
        places.set(name, { name, kind: 'region', id, x: r.cx, y: r.cy, region: id });
      },
      landPointNear(x, y, r, rng) {
        for (let i = 0; i < 8; i++) {
          const a = rng.next() * Math.PI * 2;
          const d = Math.sqrt(rng.next()) * r;
          const px2 = Math.min(size - 1, Math.max(1, x + Math.cos(a) * d));
          const py2 = Math.min(size - 1, Math.max(1, y + Math.sin(a) * d));
          if (api2.isLand(px2, py2)) return [px2, py2];
        }
        return [x, y];
      },
    };

    // 地名：按地形取字尾，保证不重名
    const rng = new Rng(sim.seed ^ 0x77aa);
    const used = new Set<string>();
    for (const r of map.regions) {
      if (!r.land) continue;
      const tails = NAME_TAILS[TERRAINS[r.terrain].key] || ['地'];
      let name = '';
      for (let tries = 0; !name || used.has(name); tries++) {
        const head = tries < 6 ? rng.pick(NAME_HEADS) : rng.pick(NAME_HEADS) + rng.pick(NAME_HEADS);
        name = head + rng.pick(tails);
      }
      used.add(name);
      r.name = name;
      places.set(name, { name, kind: 'region', id: r.id, x: r.cx, y: r.cy, region: r.id });
    }

    // 资源点：按地区地形撒在对应地形的像素上
    const wantBiome: Record<string, number[]> = {
      wood: [T.forest, T.plains, T.swamp],
      stone: [T.hills, T.mountain],
      iron: [T.mountain, T.hills],
      field: [T.plains],
    };
    for (const r of map.regions) {
      if (!r.land) continue;
      const spec = NODES_PER_REGION[TERRAINS[r.terrain].key] || [];
      const pixels = map.pixels[r.id];
      for (const [kindKey, count, p] of spec) {
        if (!rng.chance(p)) continue;
        const ok = wantBiome[kindKey];
        for (let c = 0; c < count; c++) {
          for (let tries = 0; tries < 12; tries++) {
            const k = pixels[rng.int(pixels.length)];
            if (!ok.includes(map.biome[k])) continue;
            api2.addNode(kindKey, ((k % res) + rng.next()) * px, (Math.floor(k / res) + rng.next()) * px);
            break;
          }
        }
      }
    }
    api.provideHooks({
      speedAt: (x, y) => TERRAINS[map.biome[pix(x, y)]].speed,
      regionAt: api2.regionAt,
    });
    api.expose(api2);
  },
};

export function regionName(map: MapData, id: number): string {
  return map.regions[id]?.name || '海上';
}
