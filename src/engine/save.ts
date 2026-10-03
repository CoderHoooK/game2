// 存档框架：内核的状态（组件、长期命令、时钟、随机数、命令日志长度）+ 每个模块自己的存档段。
// 读档方式：用同一个种子和配置重新建世界（地图由种子生成，不存），再把存档覆盖上去。
// 模块的存档段带版本号；版本变了由模块的 load 自己迁移（旧档能读）。
import type { Sim } from './sim';
import type { WorldSnapshot } from './ecs';
import type { Order } from './brain';

export const SAVE_FORMAT = 1;

export interface SaveFile {
  format: number;
  seed: number;
  config: Record<string, Record<string, number | string | boolean>>;
  tick: number;
  speed: number;
  rng: number;
  world: WorldSnapshot;
  orders: { next: number; list: Order[] };
  modules: Record<string, { version: number; data: unknown }>;
}

export function saveSim(sim: Sim): SaveFile {
  const modules: SaveFile['modules'] = {};
  for (const m of sim.modules) if (m.save) modules[m.id] = { version: m.save.version, data: m.save.save(sim) };
  return {
    format: SAVE_FORMAT,
    seed: sim.seed,
    config: Object.fromEntries(sim.config),
    tick: sim.clock.tick,
    speed: sim.clock.speed,
    rng: sim.rng.state,
    world: sim.world.snapshot(),
    orders: sim.brains.exportOrders(),
    modules,
  };
}

/** 把存档覆盖到一个用同样种子 / 配置新建的世界上 */
export function loadSim(sim: Sim, f: SaveFile): void {
  if (f.format !== SAVE_FORMAT) throw new Error(`存档格式 ${f.format} 不认识（当前 ${SAVE_FORMAT}）`);
  if (f.seed !== sim.seed) throw new Error(`存档种子 ${f.seed} 和世界种子 ${sim.seed} 不一致`);
  sim.world.restore(f.world);
  sim.brains.importOrders(f.orders);
  sim.clock.tick = f.tick;
  sim.clock.speed = f.speed;
  sim.rng.state = f.rng;
  for (const m of sim.modules) {
    const seg = f.modules[m.id];
    if (m.save && seg) m.save.load(sim, seg.data, seg.version);
  }
}
