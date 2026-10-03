// 资源点：树林、农田、石料、铁矿。透明度 = 剩余多少（采空的会变淡，过一阵自己长回来）。
import { Graphics } from 'pixi.js';
import type { Defs } from '../../protocol/messages';

export class NodesLayer {
  readonly g = new Graphics();
  constructor(private defs: Defs) {}
  draw(n: { n: number; x: Float32Array; y: Float32Array; kind: Uint8Array; level: Float32Array }): void {
    const g = this.g;
    g.clear();
    const key = this.defs.kinds.map((k) => k.key);
    for (let i = 0; i < n.n; i++) {
      const x = n.x[i];
      const y = n.y[i];
      const a = 0.25 + 0.75 * n.level[i];
      switch (key[n.kind[i]]) {
        case 'wood':
          g.circle(x - 3, y + 1.5, 3.4).circle(x + 3, y + 1.5, 3.4).circle(x, y - 2.5, 3.8).fill({ color: 0x2f6e30, alpha: a });
          g.circle(x - 0.6, y - 3.4, 1.6).fill({ color: 0x5aa04f, alpha: a * 0.8 });
          break;
        case 'field':
          g.rect(x - 8, y - 5.5, 16, 11).fill({ color: 0xc9a94a, alpha: a }).stroke({ width: 0.6, color: 0x7a5f22, alpha: 0.8 });
          g.moveTo(x - 8, y - 1.8).lineTo(x + 8, y - 1.8).moveTo(x - 8, y + 1.8).lineTo(x + 8, y + 1.8).stroke({ width: 0.4, color: 0x7a5f22, alpha: 0.6 });
          break;
        case 'stone':
          g.poly([x - 4.5, y + 3, x - 3, y - 3, x + 1, y - 4.5, x + 4.5, y - 1, x + 3.5, y + 3.5]).fill({ color: 0xb4b0a8, alpha: a }).stroke({ width: 0.6, color: 0x5f5b55 });
          break;
        case 'iron':
          g.circle(x, y, 4.6).fill({ color: 0x4a4541, alpha: a }).stroke({ width: 0.6, color: 0x1f1c1a });
          g.circle(x + 1, y - 0.8, 1.9).fill({ color: 0xea580c, alpha: a });
          break;
      }
    }
  }
}
