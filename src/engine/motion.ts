// 位置与移动（所有 NPC 的基础组件）。第 0 阶段直线走；寻路（地区图 + 区块格子 + 流场）在第 1 阶段接进来。
import { defineComponent } from './ecs';
import type { Sim } from './sim';
import type { SystemDef } from './scheduler';

export const Transform = defineComponent('Transform', '位置', { x: 'f32', y: 'f32', region: 'u16' }, { x: '米', y: '米', region: '所在地区' });
export const Motion = defineComponent('Motion', '移动', { tx: 'f32', ty: 'f32', speed: 'f32', moving: 'u8' }, {
  tx: '目标点 x',
  ty: '目标点 y',
  speed: '米/秒',
  moving: '是否在走',
});
export const Lod = defineComponent('Lod', '远近', { mode: 'u8' }, { mode: '0 细算 / 1 粗算（第 0 阶段全部细算）' });

export const motionSystem: SystemDef = {
  id: 'motion',
  phase: 'move',
  run(sim: Sim, dt: number) {
    const w = sim.world;
    const T = w.get(Transform);
    const M = w.get(Motion);
    const speedAt = sim.hooks.speedAt;
    const regionAt = sim.hooks.regionAt;
    for (let e = 0; e < w.hw; e++) {
      if (!M.moving[e]) continue;
      const x = T.x[e];
      const y = T.y[e];
      const dx = M.tx[e] - x;
      const dy = M.ty[e] - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const step = M.speed[e] * dt * (speedAt ? speedAt(x, y) : 1);
      if (step >= d) {
        T.x[e] = M.tx[e];
        T.y[e] = M.ty[e];
        M.moving[e] = 0;
      } else {
        T.x[e] = x + (dx / d) * step;
        T.y[e] = y + (dy / d) * step;
      }
      if (regionAt) T.region[e] = regionAt(T.x[e], T.y[e]);
    }
  },
};
