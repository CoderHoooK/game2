// 镜头：中心点（米）+ 缩放（每米几像素）。从全图（10 公里）一直拉到 2 米的格子。
export class Camera {
  cx = 5000;
  cy = 5000;
  zoom = 0.1;
  minZoom = 0.05;
  readonly maxZoom = 24;
  w = 1;
  h = 1;
  private fly: { x: number; y: number; z: number } | null = null;

  constructor(readonly size: number) {}

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.minZoom = (Math.min(w, h) / this.size) * 0.85;
    this.zoom = Math.max(this.zoom, this.minZoom);
  }
  fitAll(): void {
    this.flyTo(this.size / 2, this.size / 2, this.minZoom * 1.08);
  }
  toWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.w / 2) / this.zoom + this.cx, (sy - this.h / 2) / this.zoom + this.cy];
  }
  toScreen(x: number, y: number): [number, number] {
    return [(x - this.cx) * this.zoom + this.w / 2, (y - this.cy) * this.zoom + this.h / 2];
  }
  zoomAt(sx: number, sy: number, factor: number): void {
    this.fly = null;
    const [wx, wy] = this.toWorld(sx, sy);
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.zoom * factor));
    this.cx = wx - (sx - this.w / 2) / this.zoom;
    this.cy = wy - (sy - this.h / 2) / this.zoom;
    this.clamp();
  }
  pan(dx: number, dy: number): void {
    this.fly = null;
    this.cx -= dx / this.zoom;
    this.cy -= dy / this.zoom;
    this.clamp();
  }
  center(x: number, y: number): void {
    this.cx = x;
    this.cy = y;
    this.clamp();
  }
  flyTo(x: number, y: number, z = this.zoom): void {
    this.fly = { x, y, z: Math.min(this.maxZoom, Math.max(this.minZoom, z)) };
  }
  /** 每帧调用；返回镜头是否变了 */
  update(dtMs: number): boolean {
    if (!this.fly) return false;
    const k = 1 - Math.pow(0.001, dtMs / 600);
    this.cx += (this.fly.x - this.cx) * k;
    this.cy += (this.fly.y - this.cy) * k;
    this.zoom *= Math.pow(this.fly.z / this.zoom, k);
    if (Math.abs(this.fly.x - this.cx) * this.zoom < 0.5 && Math.abs(this.fly.y - this.cy) * this.zoom < 0.5 && Math.abs(this.fly.z / this.zoom - 1) < 0.002) {
      this.cx = this.fly.x;
      this.cy = this.fly.y;
      this.zoom = this.fly.z;
      this.fly = null;
    }
    this.clamp();
    return true;
  }
  private clamp(): void {
    const m = this.size * 0.1;
    this.cx = Math.min(this.size + m, Math.max(-m, this.cx));
    this.cy = Math.min(this.size + m, Math.max(-m, this.cy));
  }
  view(): { x0: number; y0: number; x1: number; y1: number } {
    const [x0, y0] = this.toWorld(0, 0);
    const [x1, y1] = this.toWorld(this.w, this.h);
    return { x0, y0, x1, y1 };
  }
}
