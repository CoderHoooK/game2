// 小地图：全图 + 城镇 + 当前镜头框；点击或拖动跳过去
import type { Defs } from '../../protocol/messages';
import type { Camera } from '../camera';
import { $ } from '../util';

export class Minimap {
  private c = $<HTMLCanvasElement>('#minimap');
  private g = this.c.getContext('2d')!;
  private base: HTMLCanvasElement;
  constructor(
    private defs: Defs,
    overview: HTMLCanvasElement,
    private cam: Camera,
  ) {
    const S = this.c.width;
    this.base = document.createElement('canvas');
    this.base.width = this.base.height = S;
    const b = this.base.getContext('2d')!;
    b.imageSmoothingEnabled = true;
    b.drawImage(overview, 0, 0, S, S);
    for (const t of defs.towns) {
      b.fillStyle = defs.factions[t.faction].color;
      b.strokeStyle = '#000';
      const s = t.capital ? 6 : 4;
      const x = (t.x / defs.size) * S;
      const y = (t.y / defs.size) * S;
      b.fillRect(x - s / 2, y - s / 2, s, s);
      b.strokeRect(x - s / 2, y - s / 2, s, s);
    }
    let drag = false;
    const go = (ev: PointerEvent) => {
      const r = this.c.getBoundingClientRect();
      this.cam.flyTo(((ev.clientX - r.left) / r.width) * defs.size, ((ev.clientY - r.top) / r.height) * defs.size);
    };
    this.c.addEventListener('pointerdown', (ev) => ((drag = true), this.c.setPointerCapture(ev.pointerId), go(ev)));
    this.c.addEventListener('pointermove', (ev) => drag && go(ev));
    this.c.addEventListener('pointerup', () => (drag = false));
  }
  draw(): void {
    const S = this.c.width;
    const g = this.g;
    g.drawImage(this.base, 0, 0);
    const v = this.cam.view();
    const k = S / this.defs.size;
    g.strokeStyle = '#fff';
    g.lineWidth = 1.5;
    const w = Math.max(3, (v.x1 - v.x0) * k);
    const h = Math.max(3, (v.y1 - v.y0) * k);
    g.strokeRect(v.x0 * k, v.y0 * k, w, h);
  }
}
