// 地形图层：远看用全图栅格（每像素 20 米，带地区边界）；拉近后按需向后端要 2 米格子的区块。
import { Container, Sprite, Texture } from 'pixi.js';
import type { Defs } from '../../protocol/messages';
import { rgb } from '../util';
import type { Camera } from '../camera';

export const CHUNK_ZOOM = 1.6;

export class TerrainLayer {
  readonly root = new Container();
  private chunks = new Container();
  private sprites = new Map<number, Sprite>();
  private pending = new Set<number>();
  private colors: [number, number, number][];
  readonly overview: HTMLCanvasElement;
  private chunkM: number;
  private nChunks: number;

  constructor(
    defs: Defs,
    res: number,
    biome: Uint8Array,
  ) {
    this.colors = defs.terrains.map((t) => rgb(t.color));
    this.chunkM = defs.chunkCells * defs.cellSize;
    this.nChunks = Math.ceil(defs.size / this.chunkM);
    const c = document.createElement('canvas');
    c.width = c.height = res;
    const g = c.getContext('2d')!;
    const img = g.createImageData(res, res);
    for (let k = 0; k < res * res; k++) {
      const b = biome[k] & 0x0f;
      const border = biome[k] & 0x80;
      const [r, gg, bb] = this.colors[b] || [0, 0, 0];
      const f = border ? 0.78 : 1;
      img.data[k * 4] = r * f;
      img.data[k * 4 + 1] = gg * f;
      img.data[k * 4 + 2] = bb * f;
      img.data[k * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    this.overview = c;
    const sp = new Sprite(Texture.from(c));
    sp.width = sp.height = defs.size;
    this.root.addChild(sp, this.chunks);
  }

  /** 镜头够近时，返回还没有的可见区块 */
  wanted(cam: Camera): [number, number][] {
    const show = cam.zoom >= CHUNK_ZOOM;
    this.chunks.visible = show;
    if (!show) return [];
    const v = cam.view();
    const i0 = Math.max(0, Math.floor(v.x0 / this.chunkM));
    const i1 = Math.min(this.nChunks - 1, Math.floor(v.x1 / this.chunkM));
    const j0 = Math.max(0, Math.floor(v.y0 / this.chunkM));
    const j1 = Math.min(this.nChunks - 1, Math.floor(v.y1 / this.chunkM));
    const out: [number, number][] = [];
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const key = j * 4096 + i;
        if (!this.sprites.has(key) && !this.pending.has(key)) {
          this.pending.add(key);
          out.push([i, j]);
        }
      }
    if (this.sprites.size > 700) this.evict(cam);
    return out;
  }

  addChunk(cx: number, cy: number, n: number, cells: Uint8Array): void {
    const key = cy * 4096 + cx;
    this.pending.delete(key);
    if (this.sprites.has(key)) return;
    const c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d')!;
    const img = g.createImageData(n, n);
    for (let k = 0; k < n * n; k++) {
      const v = cells[k];
      const t = v & 0x0f;
      let [r, gg, b] = this.colors[t] || [0, 0, 0];
      // 每格一点明暗变化，看起来像地面而不是色块
      const h = ((((cx * n + (k % n)) * 73856093) ^ ((cy * n + Math.floor(k / n)) * 19349663)) >>> 0) % 1000;
      let f = 0.94 + (h / 1000) * 0.12;
      if (v & 0x10) ((r = 34), (gg = 74), (b = 36), (f = 0.85 + (h / 1000) * 0.3));
      else if (v & 0x20) ((r = 168), (gg = 162), (b = 158));
      else if (v & 0x40) ((r = 226), (gg = 196), (b = 90));
      img.data[k * 4] = Math.min(255, r * f);
      img.data[k * 4 + 1] = Math.min(255, gg * f);
      img.data[k * 4 + 2] = Math.min(255, b * f);
      img.data[k * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const tex = Texture.from(c);
    tex.source.scaleMode = 'nearest';
    const sp = new Sprite(tex);
    sp.position.set(cx * this.chunkM, cy * this.chunkM);
    sp.width = sp.height = this.chunkM;
    this.chunks.addChild(sp);
    this.sprites.set(key, sp);
  }

  private evict(cam: Camera): void {
    const list = [...this.sprites.entries()].map(([k, sp]) => ({ k, sp, d: (sp.x - cam.cx) ** 2 + (sp.y - cam.cy) ** 2 }));
    list.sort((a, b) => b.d - a.d);
    for (const { k, sp } of list.slice(0, list.length - 500)) {
      sp.destroy({ texture: true, textureSource: true });
      this.sprites.delete(k);
    }
  }

  get chunkCount(): number {
    return this.sprites.size;
  }
}
