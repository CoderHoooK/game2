// 城镇：近看画城墙和主楼；所有缩放下都有名字（屏幕空间文字，不随缩放变糊）
import { Container, Graphics, Text } from 'pixi.js';
import type { Defs } from '../../protocol/messages';
import type { Camera } from '../camera';
import { hex } from '../util';

const FONT = '"PingFang SC","Microsoft YaHei","Noto Sans CJK SC","Noto Sans SC",sans-serif';

export class TownsLayer {
  readonly world = new Graphics();
  readonly screen = new Container();
  private labels: { t: Text; x: number; y: number; dot: Graphics }[] = [];
  private regionLabels: { t: Text; x: number; y: number }[] = [];
  private regionBox = new Container();

  private colorKey = '';
  constructor(private defs: Defs) {
    this.drawTowns(defs.towns.map((t) => defs.factions[t.faction].color));
    this.initLabels();
  }

  /** 城换主 / 新势力：按每座城现在的颜色重画 */
  recolor(colors: string[]): void {
    if (colors.join(',') === this.colorKey) return;
    this.drawTowns(colors);
    this.labels.forEach((l, i) => {
      l.t.style.fill = hex(colors[i]);
      const s = this.defs.towns[i].capital ? 7 : 5;
      l.dot.clear().poly([0, -s, s, 0, 0, s, -s, 0]).fill({ color: hex(colors[i]) }).stroke({ width: 1.5, color: 0x000000, alpha: 0.7 });
    });
  }

  private drawTowns(colors: string[]): void {
    this.colorKey = colors.join(',');
    this.world.clear();
    for (const t of this.defs.towns) {
      const c = hex(colors[t.id]);
      const r = t.radius;
      this.world.rect(t.x - r, t.y - r, r * 2, r * 2).fill({ color: c, alpha: 0.16 }).stroke({ width: 2.2, color: c, alpha: 0.9 });
      if (t.capital) this.world.rect(t.x - r - 4, t.y - r - 4, r * 2 + 8, r * 2 + 8).stroke({ width: 1.2, color: c, alpha: 0.7 });
      this.world.rect(t.x - 7, t.y - 7, 14, 14).fill({ color: c, alpha: 0.85 }).stroke({ width: 1, color: 0x000000, alpha: 0.6 });
      for (const [dx, dy] of [[-r, -r], [r, -r], [-r, r], [r, r]]) this.world.rect(t.x + dx - 3.5, t.y + dy - 3.5, 7, 7).fill({ color: c });
    }
  }

  private initLabels(): void {
    const defs = this.defs;
    for (const r of defs.regions) {
      const t = new Text({ text: r.name, style: { fontFamily: FONT, fontSize: 11, fill: 0xffffff, stroke: { color: 0x000000, width: 3 } } });
      t.alpha = 0.55;
      t.anchor.set(0.5);
      this.regionBox.addChild(t);
      this.regionLabels.push({ t, x: r.x, y: r.y });
    }
    this.screen.addChild(this.regionBox);
    for (const town of defs.towns) {
      const color = defs.factions[town.faction].color;
      const dot = new Graphics();
      const s = town.capital ? 7 : 5;
      dot.poly([0, -s, s, 0, 0, s, -s, 0]).fill({ color: hex(color) }).stroke({ width: 1.5, color: 0x000000, alpha: 0.7 });
      const t = new Text({
        text: town.name,
        style: { fontFamily: FONT, fontSize: town.capital ? 15 : 13, fontWeight: '700', fill: hex(color), stroke: { color: 0x05080f, width: 4 } },
      });
      t.anchor.set(0.5, 1.25);
      this.screen.addChild(dot, t);
      this.labels.push({ t, x: town.x, y: town.y, dot });
    }
  }

  update(cam: Camera): void {
    this.world.visible = cam.zoom > 0.25;
    for (const l of this.labels) {
      const [sx, sy] = cam.toScreen(l.x, l.y);
      const r = cam.zoom * 45;
      l.t.position.set(sx, sy - Math.max(0, r - 8));
      l.dot.position.set(sx, sy);
      l.dot.visible = r < 10;
    }
    const showRegions = cam.zoom > 0.17 && cam.zoom < 4;
    this.regionBox.visible = showRegions;
    if (showRegions) {
      for (const l of this.regionLabels) {
        const [sx, sy] = cam.toScreen(l.x, l.y);
        const vis = sx > -60 && sy > -20 && sx < cam.w + 60 && sy < cam.h + 20;
        l.t.visible = vis;
        if (vis) l.t.position.set(sx, sy);
      }
    }
  }

  /** 屏幕坐标附近的城镇 */
  pick(cam: Camera, sx: number, sy: number): number {
    for (const t of this.defs.towns) {
      const [x, y] = cam.toScreen(t.x, t.y);
      if (Math.abs(x - sx) < Math.max(12, t.radius * cam.zoom) && Math.abs(y - sy) < Math.max(12, t.radius * cam.zoom)) return t.id;
    }
    return -1;
  }
}
