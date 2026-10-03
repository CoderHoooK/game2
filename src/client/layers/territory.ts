// 领土：250×250 栅格放大铺满全图，半透明势力色 + 边界加深。按 T 开关。
import { Sprite, Texture } from 'pixi.js';
import type { Defs } from '../../protocol/messages';

export class TerritoryLayer {
  readonly sprite: Sprite;
  readonly canvas = document.createElement('canvas');
  private tex: Texture;
  private data: Uint8Array | null = null;
  private size = 0;
  private key = '';
  visible = true;
  /** 栅格每换一次 +1（小地图据此决定要不要重画） */
  version = 0;

  constructor(private defs: Defs) {
    this.canvas.width = this.canvas.height = 250;
    this.tex = Texture.from(this.canvas);
    this.sprite = new Sprite(this.tex);
    this.sprite.width = this.sprite.height = defs.size;
    this.sprite.alpha = 1;
    this.sprite.eventMode = 'none';
  }

  apply(size: number, data: Uint8Array): void {
    this.size = size;
    this.data = Uint8Array.from(data);
    this.key = '';
    this.version++;
  }

  /** 势力颜色可能变（新势力）：颜色或栅格变了才重画 */
  draw(factions: { color: string }[]): void {
    if (!this.data) return;
    const key = factions.map((f) => f.color).join(',') + ':' + this.data.length + ':' + this.data[0] + this.data[this.data.length >> 1];
    if (key === this.key && this.canvas.width === this.size) return;
    this.key = key;
    const n = this.size;
    if (this.canvas.width !== n) this.canvas.width = this.canvas.height = n;
    const g = this.canvas.getContext('2d')!;
    const img = g.createImageData(n, n);
    const rgb = factions.map((f) => {
      const v = parseInt(f.color.slice(1), 16);
      return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    });
    const d = this.data;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const k = y * n + x;
        const o = d[k];
        if (o === 255 || !rgb[o]) continue;
        const edge = (x > 0 && d[k - 1] !== o) || (x < n - 1 && d[k + 1] !== o) || (y > 0 && d[k - n] !== o) || (y < n - 1 && d[k + n] !== o);
        const [r, gg, b] = rgb[o];
        img.data.set([r, gg, b, edge ? 150 : 38], k * 4);
      }
    g.putImageData(img, 0, 0);
    this.tex.source.update();
    this.sprite.width = this.sprite.height = this.defs.size;
  }

  ownerAt(x: number, y: number): number {
    if (!this.data) return 255;
    const n = this.size;
    return this.data[Math.min(n - 1, Math.floor((y / this.defs.size) * n)) * n + Math.min(n - 1, Math.floor((x / this.defs.size) * n))];
  }
}
