// 模块清单：加模块 = 这里加一行。顺序无所谓，注册表按 requires 排。
import type { GameModule } from '../engine/module';
import { createSim } from '../engine/registry';
import type { Sim, SimOptions } from '../engine/sim';
import { world } from './modules/world';
import { economy } from './modules/economy';
import { population } from './modules/population';
import { jobs } from './modules/jobs';
import { military } from './modules/military';
import { god } from './modules/god';

export const MODULES: GameModule[] = [world, economy, population, jobs, military, god];

export function createGame(opts: SimOptions): Sim {
  return createSim(MODULES, opts);
}

export type { WorldApi, Place } from './modules/world';
export type { EconomyApi } from './modules/economy';
export type { PopulationApi, Town, Faction } from './modules/population';
export type { JobsApi, NpcInfo } from './modules/jobs';
export { Identity } from './modules/population';
export { Profession } from './modules/jobs';
export { Carry } from './modules/economy';
