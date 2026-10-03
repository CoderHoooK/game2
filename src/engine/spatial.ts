// 空间索引：网格桶。查附近的东西只看周围几个格子。
export class PointGrid {
  private cells: number[][];
  private xs: number[] = [];
  private ys: number[] = [];
  readonly n: number;

  constructor(
    readonly size: number,
    readonly cell: number,
  ) {
    this.n = Math.ceil(size / cell);
    this.cells = Array.from({ length: this.n * this.n }, () => []);
  }

  private key(x: number, y: number): number {
    const cx = Math.min(this.n - 1, Math.max(0, Math.floor(x / this.cell)));
    const cy = Math.min(this.n - 1, Math.max(0, Math.floor(y / this.cell)));
    return cy * this.n + cx;
  }

  insert(id: number, x: number, y: number): void {
    this.xs[id] = x;
    this.ys[id] = y;
    this.cells[this.key(x, y)].push(id);
  }

  /** 最近的、满足条件的点；找不到返回 -1 */
  nearest(x: number, y: number, maxDist: number, accept: (id: number) => boolean): number {
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    const maxR = Math.ceil(maxDist / this.cell) + 1;
    let best = -1;
    let bestD = maxDist * maxDist;
    for (let r = 0; r <= maxR; r++) {
      // 第 r 圈的格子离查询点至少 (r-1)*cell 远：已经找到更近的就停
      if (best >= 0 && ((r - 1) * this.cell) ** 2 > bestD) break;
      for (let gy = cy - r; gy <= cy + r; gy++) {
        if (gy < 0 || gy >= this.n) continue;
        const edgeRow = gy === cy - r || gy === cy + r;
        for (let gx = cx - r; gx <= cx + r; gx += edgeRow ? 1 : 2 * r || 1) {
          if (gx < 0 || gx >= this.n) continue;
          for (const id of this.cells[gy * this.n + gx]) {
            const d = (this.xs[id] - x) ** 2 + (this.ys[id] - y) ** 2;
            if (d < bestD && accept(id)) {
              bestD = d;
              best = id;
            }
          }
        }
      }
    }
    return best;
  }

  /** 半径内的所有点 */
  within(x: number, y: number, r: number, fn: (id: number) => void): void {
    const x0 = Math.max(0, Math.floor((x - r) / this.cell));
    const x1 = Math.min(this.n - 1, Math.floor((x + r) / this.cell));
    const y0 = Math.max(0, Math.floor((y - r) / this.cell));
    const y1 = Math.min(this.n - 1, Math.floor((y + r) / this.cell));
    for (let gy = y0; gy <= y1; gy++)
      for (let gx = x0; gx <= x1; gx++)
        for (const id of this.cells[gy * this.n + gx]) if ((this.xs[id] - x) ** 2 + (this.ys[id] - y) ** 2 <= r * r) fn(id);
  }
}
