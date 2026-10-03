// 视野订阅：每个网页只收到自己镜头范围内的单位。
import type { Sim } from '../engine/sim';
import { Transform } from '../engine/motion';
import { Brain } from '../engine/brain';
import { Identity, Profession, Carry } from '../game';
import { allocUnits, encodeUnits, type UnitsFrame } from '../protocol/codec';

export interface View {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export class Interest {
  private frame: UnitsFrame;
  constructor(
    private sim: Sim,
    private size: number,
  ) {
    this.frame = allocUnits(sim.world.capacity);
  }

  /** 视野（外扩 10%）里的单位 → 二进制帧 */
  units(v: View): { buf: ArrayBuffer; count: number } {
    const w = this.sim.world;
    const T = w.get(Transform);
    const I = w.get(Identity);
    const PR = w.get(Profession);
    const B = w.get(Brain);
    const C = w.get(Carry);
    const mx = (v.x1 - v.x0) * 0.1 + 20;
    const my = (v.y1 - v.y0) * 0.1 + 20;
    const x0 = v.x0 - mx;
    const x1 = v.x1 + mx;
    const y0 = v.y0 - my;
    const y1 = v.y1 + my;
    const f = this.frame;
    let n = 0;
    for (let e = 0; e < w.hw; e++) {
      if (!w.alive[e] || !PR.has[e]) continue;
      const x = T.x[e];
      const y = T.y[e];
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      f.id[n] = e;
      f.x[n] = x;
      f.y[n] = y;
      f.prof[n] = PR.prof[e];
      f.faction[n] = I.faction[e];
      f.beh[n] = B.beh[e];
      f.carry[n] = C.item[e];
      n++;
    }
    f.count = n;
    f.tick = this.sim.clock.tick;
    return { buf: encodeUnits(f, this.size), count: n };
  }
}
