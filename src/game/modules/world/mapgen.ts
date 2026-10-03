// 地图生成：只依赖种子。
//   全图栅格（每像素 20 米）：地形 + 地区编号，开局算一次。
//   区块（64×64 格，每格 2 米）：用同一套噪声加细节，按需生成，不整体存储。
import { fbm } from '../../../shared/noise';
import { hash2 } from '../../../shared/rng';
import { smoothstep } from '../../../shared/math';

export const T = { deep: 0, shallow: 1, sand: 2, plains: 3, forest: 4, hills: 5, mountain: 6, swamp: 7 } as const;
export const TERRAIN_KEYS = ['deep', 'shallow', 'sand', 'plains', 'forest', 'hills', 'mountain', 'swamp'];
/** 区块格子高 4 位的装饰标记 */
export const DECO = { tree: 1 << 4, rock: 1 << 5, flower: 1 << 6 } as const;

export interface Region {
  id: number;
  name: string;
  terrain: number;
  land: boolean;
  /** 中心（陆地地区保证落在陆地上） */
  cx: number;
  cy: number;
  /** 面积（像素数） */
  area: number;
  neighbors: number[];
}

export interface Thresholds {
  sea: number;
  shallow: number;
  sand: number;
  hills: number;
  mountain: number;
  forest: number;
  swampM: number;
  swampE: number;
}

export interface MapData {
  seed: number;
  size: number;
  res: number;
  /** 每像素多少米 */
  px: number;
  grid: number;
  biome: Uint8Array;
  region: Uint16Array;
  regions: Region[];
  th: Thresholds;
  /** 每个地区的像素下标（放资源点用） */
  pixels: Int32Array[];
}

export class Terrain {
  constructor(
    readonly seed: number,
    readonly size: number,
  ) {}
  elev(x: number, y: number): number {
    const nx = x / this.size;
    const ny = y / this.size;
    const base = fbm(nx * 3.2, ny * 3.2, this.seed, 6);
    const dx = nx - 0.5;
    const dy = ny - 0.5;
    const d = Math.sqrt(dx * dx + dy * dy) * 2;
    return base - smoothstep(0.45, 1.0, d) * 0.45;
  }
  moist(x: number, y: number): number {
    return fbm((x / this.size) * 6 + 17.3, (y / this.size) * 6 + 9.1, this.seed ^ 0xa5a5, 5);
  }
  /** 2 米级别的细节扰动（只在区块里用） */
  detail(x: number, y: number): number {
    return (fbm(x / 60, y / 60, this.seed + 5, 3) - 0.5) * 0.035;
  }
  classify(e: number, m: number, th: Thresholds): number {
    if (e < th.sea) return e > th.shallow ? T.shallow : T.deep;
    if (e < th.sand) return T.sand;
    if (e > th.mountain) return T.mountain;
    if (e > th.hills) return T.hills;
    if (m > th.swampM && e < th.swampE) return T.swamp;
    if (m > th.forest) return T.forest;
    return T.plains;
  }
}

const quantile = (sorted: Float32Array, q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

export class Regions {
  readonly cell: number;
  constructor(
    readonly seed: number,
    readonly size: number,
    readonly grid: number,
  ) {
    this.cell = size / grid;
  }
  siteX(i: number, j: number): number {
    return (i + 0.15 + 0.7 * hash2(i, j, this.seed + 1)) * this.cell;
  }
  siteY(i: number, j: number): number {
    return (j + 0.15 + 0.7 * hash2(i, j, this.seed + 2)) * this.cell;
  }
  /** 扭曲过的 Voronoi：边界不是直线 */
  at(x: number, y: number): number {
    const wx = x + (fbm(x / 900, y / 900, this.seed + 3, 3) - 0.5) * this.cell;
    const wy = y + (fbm(x / 900 + 31.7, y / 900 + 11.3, this.seed + 4, 3) - 0.5) * this.cell;
    const ci = Math.floor(wx / this.cell);
    const cj = Math.floor(wy / this.cell);
    let best = 0;
    let bd = Infinity;
    for (let j = cj - 1; j <= cj + 1; j++) {
      if (j < 0 || j >= this.grid) continue;
      for (let i = ci - 1; i <= ci + 1; i++) {
        if (i < 0 || i >= this.grid) continue;
        const d = (this.siteX(i, j) - wx) ** 2 + (this.siteY(i, j) - wy) ** 2;
        if (d < bd) {
          bd = d;
          best = j * this.grid + i;
        }
      }
    }
    return best;
  }
}

export function generateMap(seed: number, size: number, res: number, grid: number): MapData {
  const px = size / res;
  const terr = new Terrain(seed, size);
  const regs = new Regions(seed, size, grid);
  const n = res * res;
  const E = new Float32Array(n);
  const M = new Float32Array(n);
  for (let j = 0; j < res; j++)
    for (let i = 0; i < res; i++) {
      const x = (i + 0.5) * px;
      const y = (j + 0.5) * px;
      E[j * res + i] = terr.elev(x, y);
      M[j * res + i] = terr.moist(x, y);
    }
  // 阈值按分位数定：不管种子是什么，海、山、林的比例都稳定
  const es = Float32Array.from(E).sort();
  const sea = quantile(es, 0.4);
  const landE = es.filter((v) => v >= sea);
  const waterE = es.filter((v) => v < sea);
  const landM = Float32Array.from(M.filter((_, k) => E[k] >= sea)).sort();
  const th: Thresholds = {
    sea,
    shallow: quantile(waterE, 0.7),
    sand: quantile(landE, 0.035),
    hills: quantile(landE, 0.8),
    mountain: quantile(landE, 0.93),
    forest: quantile(landM, 0.58),
    swampM: quantile(landM, 0.93),
    swampE: quantile(landE, 0.4),
  };
  const biome = new Uint8Array(n);
  const region = new Uint16Array(n);
  for (let k = 0; k < n; k++) biome[k] = terr.classify(E[k], M[k], th);
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) region[j * res + i] = regs.at((i + 0.5) * px, (j + 0.5) * px);

  // 地区汇总：地形取多数、是否陆地、中心、邻接
  const R = grid * grid;
  const counts = Array.from({ length: R }, () => new Uint32Array(8));
  const sx = new Float64Array(R);
  const sy = new Float64Array(R);
  const sl = new Uint32Array(R);
  const lists: number[][] = Array.from({ length: R }, () => []);
  const nb = Array.from({ length: R }, () => new Set<number>());
  for (let j = 0; j < res; j++)
    for (let i = 0; i < res; i++) {
      const k = j * res + i;
      const r = region[k];
      const b = biome[k];
      counts[r][b]++;
      lists[r].push(k);
      if (b > T.shallow) {
        sx[r] += i;
        sy[r] += j;
        sl[r]++;
      }
      if (i + 1 < res && region[k + 1] !== r) (nb[r].add(region[k + 1]), nb[region[k + 1]].add(r));
      if (j + 1 < res && region[k + res] !== r) (nb[r].add(region[k + res]), nb[region[k + res]].add(r));
    }
  const regions: Region[] = [];
  for (let r = 0; r < R; r++) {
    const c = counts[r];
    const area = lists[r].length;
    const water = c[T.deep] + c[T.shallow];
    const land = area > 0 && water / area < 0.5 && sl[r] > 20;
    let terrain: number = T.deep;
    if (land) {
      let best = -1;
      for (let b = 2; b < 8; b++) if (c[b] > best) ((best = c[b]), (terrain = b));
    } else terrain = c[T.shallow] > c[T.deep] ? T.shallow : T.deep;
    let cx = regs.siteX(r % grid, Math.floor(r / grid));
    let cy = regs.siteY(r % grid, Math.floor(r / grid));
    if (land) {
      // 离陆地质心最近的、本地区的陆地像素
      const mx = sx[r] / sl[r];
      const my = sy[r] / sl[r];
      let bd = Infinity;
      for (const k of lists[r]) {
        if (biome[k] <= T.shallow) continue;
        const d = ((k % res) - mx) ** 2 + (Math.floor(k / res) - my) ** 2;
        if (d < bd) {
          bd = d;
          cx = ((k % res) + 0.5) * px;
          cy = (Math.floor(k / res) + 0.5) * px;
        }
      }
    }
    regions.push({ id: r, name: '', terrain, land, cx, cy, area, neighbors: [...nb[r]].sort((a, b) => a - b) });
  }
  return { seed, size, res, px, grid, biome, region, regions, th, pixels: lists.map((l) => Int32Array.from(l)) };
}

/** 区块：64×64 格，每格一个字节（低 4 位地形，高 4 位装饰） */
export function generateChunk(map: MapData, terr: Terrain, cx: number, cy: number, cells = 64, cellSize = 2): Uint8Array {
  const out = new Uint8Array(cells * cells);
  const x0 = cx * cells * cellSize;
  const y0 = cy * cells * cellSize;
  for (let j = 0; j < cells; j++)
    for (let i = 0; i < cells; i++) {
      const x = x0 + (i + 0.5) * cellSize;
      const y = y0 + (j + 0.5) * cellSize;
      const t = terr.classify(terr.elev(x, y) + terr.detail(x, y), terr.moist(x, y), map.th);
      const gx = cx * cells + i;
      const gy = cy * cells + j;
      const h = hash2(gx, gy, map.seed + 99);
      let deco = 0;
      if (t === T.forest && h < 0.3) deco = DECO.tree;
      else if (t === T.plains && h < 0.02) deco = DECO.tree;
      else if (t === T.plains && h > 0.97) deco = DECO.flower;
      else if (t === T.swamp && h < 0.08) deco = DECO.tree;
      else if (t === T.hills && h < 0.07) deco = DECO.rock;
      else if (t === T.mountain && h < 0.2) deco = DECO.rock;
      out[j * cells + i] = t | deco;
    }
  return out;
}
