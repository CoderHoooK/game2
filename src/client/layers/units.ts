// 单位：每个 NPC 一个色块（形状 = 职业，颜色 = 职业），两帧之间插值；手里拿东西时头上有个小方块。
import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { Defs } from '../../protocol/messages';
import type { UnitsFrame } from '../../protocol/codec';
import type { Camera } from '../camera';
import { SHAPE_PX, shapeTexture } from '../shapes';
import { hex } from '../util';

interface U {
  sp: Sprite;
  carry: Sprite;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  prof: number;
  faction: number;
  beh: number;
  seen: number;
}

export class UnitsLayer {
  readonly root = new Container();
  readonly ring = new Graphics();
  private units = new Map<number, U>();
  private pool: U[] = [];
  private frameNo = 0;
  private lastAt = 0;
  private interval = 100;
  private profColor: number[];
  private itemColor: number[];
  selected = -1;
  highlight = -1;

  constructor(private defs: Defs) {
    this.profColor = defs.professions.map((p) => hex(p.color));
    this.itemColor = defs.items.map((i) => hex(i.color));
    this.root.addChild(this.ring);
  }

  apply(f: UnitsFrame): void {
    const now = performance.now();
    if (this.lastAt) this.interval = this.interval * 0.8 + Math.min(500, now - this.lastAt) * 0.2;
    // 先把每个单位的"起点"定在当前插值位置
    const t = this.progress(now);
    this.lastAt = now;
    this.frameNo++;
    for (const u of this.units.values()) {
      u.ax = u.ax + (u.bx - u.ax) * t;
      u.ay = u.ay + (u.by - u.ay) * t;
    }
    for (let i = 0; i < f.count; i++) {
      const id = f.id[i];
      let u = this.units.get(id);
      if (!u || u.prof !== f.prof[i]) {
        if (u) this.release(id, u);
        u = this.take(f.prof[i]);
        u.ax = f.x[i];
        u.ay = f.y[i];
        this.units.set(id, u);
      }
      if (Math.abs(f.x[i] - u.ax) + Math.abs(f.y[i] - u.ay) > 80) ((u.ax = f.x[i]), (u.ay = f.y[i]));
      u.bx = f.x[i];
      u.by = f.y[i];
      u.faction = f.faction[i];
      u.beh = f.beh[i];
      u.seen = this.frameNo;
      const c = f.carry[i];
      u.carry.visible = c > 0;
      if (c > 0) u.carry.tint = this.itemColor[c - 1] ?? 0xffffff;
    }
    for (const [id, u] of this.units) if (u.seen !== this.frameNo && id !== this.selected) this.release(id, u);
  }

  private take(prof: number): U {
    const p = this.defs.professions[prof];
    let u = this.pool.pop();
    if (!u) {
      const sp = new Sprite(shapeTexture(p.shape));
      sp.anchor.set(0.5);
      const carry = new Sprite(Texture.WHITE);
      carry.anchor.set(0.5);
      carry.width = carry.height = SHAPE_PX * 0.45;
      carry.position.set(0, -SHAPE_PX * 0.62);
      sp.addChild(carry);
      u = { sp, carry, ax: 0, ay: 0, bx: 0, by: 0, prof, faction: 0, beh: 0, seen: 0 };
    }
    u.sp.texture = shapeTexture(p.shape);
    u.sp.tint = this.profColor[prof];
    u.prof = prof;
    u.sp.visible = true;
    this.root.addChild(u.sp);
    return u;
  }
  private release(id: number, u: U): void {
    this.units.delete(id);
    u.sp.visible = false;
    this.root.removeChild(u.sp);
    this.pool.push(u);
  }

  private progress(now: number): number {
    return Math.min(1, Math.max(0, (now - this.lastAt) / this.interval));
  }

  /** 每帧：插值位置、按缩放调大小 */
  render(cam: Camera): void {
    const t = this.progress(performance.now());
    const sizeM = Math.max(1.8, 7 / cam.zoom);
    const s = sizeM / SHAPE_PX;
    for (const [id, u] of this.units) {
      u.sp.position.set(u.ax + (u.bx - u.ax) * t, u.ay + (u.by - u.ay) * t);
      u.sp.scale.set(s);
      u.sp.alpha = this.highlight < 0 || u.prof === this.highlight || id === this.selected ? 1 : 0.12;
    }
    this.ring.clear();
    const sel = this.units.get(this.selected);
    if (sel) {
      this.ring.circle(sel.sp.x, sel.sp.y, sizeM * 0.95).stroke({ width: 2 / cam.zoom, color: 0xffffff });
      this.ring.circle(sel.sp.x, sel.sp.y, sizeM * 1.35).stroke({ width: 1 / cam.zoom, color: 0xffffff, alpha: 0.5 });
      this.root.addChild(this.ring);
    }
  }

  pos(id: number): [number, number] | null {
    const u = this.units.get(id);
    return u ? [u.sp.x, u.sp.y] : null;
  }

  /** 屏幕坐标附近最近的单位 */
  pick(cam: Camera, sx: number, sy: number, maxPx = 12): number {
    let best = -1;
    let bd = maxPx * maxPx;
    for (const [id, u] of this.units) {
      if (!u.sp.visible || u.sp.alpha < 0.5) continue;
      const [x, y] = cam.toScreen(u.sp.x, u.sp.y);
      const d = (x - sx) ** 2 + (y - sy) ** 2;
      if (d < bd) ((bd = d), (best = id));
    }
    return best;
  }

  get count(): number {
    return this.units.size;
  }
}
