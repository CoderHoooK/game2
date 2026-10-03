// 宿主：建模拟 → 固定每秒 10 步的主循环（每步按时间倍率跑 0–16 拍）→ HTTP + WebSocket 同一个端口。
// 环境变量：PORT（默认 8080）、SEED（默认 1）、NPCS（默认 2000）
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGame, Identity, Profession } from '../game';
import type { EconomyApi, JobsApi, PopulationApi } from '../game';
import { createHttp } from './http';
import { Gateway } from './gateway';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.PORT || 8080);
const SEED = Number(process.env.SEED || 1);
const NPCS = Number(process.env.NPCS || 2000);

const t0 = performance.now();
const sim = createGame({ seed: SEED, config: { population: { npcs: NPCS } } });
sim.scheduler.profiler = { now: () => performance.now() };
console.log(`世界生成：种子 ${SEED}，${sim.world.count} 个 NPC，用时 ${(performance.now() - t0).toFixed(0)} ms`);

const eco = sim.service<EconomyApi>('economy');
const pop = sim.service<PopulationApi>('population');
const jobs = sim.service<JobsApi>('jobs');

const I = sim.world.get(Identity);
const PR = sim.world.get(Profession);
function townCounts(): number[][] {
  const out = pop.towns.map(() => jobs.professions.map(() => 0));
  for (const e of pop.npcs()) out[I.home[e]][PR.prof[e]]++;
  return out;
}

let tickMsSum = 0;
let tickCount = 0;
let lastTickMs = 0;
const health = () => ({ ok: true, tick: sim.clock.tick, label: sim.clock.label(), npcs: sim.world.count, tickMs: lastTickMs, clients: gateway.clientCount });
const server = createHttp(root, health);
const gateway = new Gateway(sim, server);

let stepNo = 0;
const STEP_MS = 1000 / sim.clock.hz;
let next = performance.now();
function loop() {
  const speed = sim.clock.speed;
  for (let i = 0; i < speed; i++) {
    const a = performance.now();
    sim.tick();
    tickMsSum += performance.now() - a;
    tickCount++;
  }
  gateway.step(stepNo, speed > 0);
  stepNo++;
  if (stepNo % sim.clock.hz === 0) {
    lastTickMs = tickCount ? tickMsSum / tickCount : 0;
    const systems: Record<string, number> = {};
    for (const [k, v] of sim.scheduler.timings) systems[k] = Math.round(v * 1000) / 1000;
    gateway.broadcast({
      t: 'stats',
      tick: sim.clock.tick,
      label: sim.clock.label(),
      speed: sim.clock.speed,
      tickMs: lastTickMs,
      systems,
      npcs: sim.world.count,
      stocks: pop.towns.map((t) => Array.from(eco.stores[t.store].stock, (v) => Math.floor(v))),
      counts: jobs.countByProf(),
      townCounts: townCounts(),
    });
    tickMsSum = 0;
    tickCount = 0;
  }
  // 自校正定时：不累积漂移
  next += STEP_MS;
  const now = performance.now();
  if (next < now - 1000) next = now; // 卡太久就别追了
  setTimeout(loop, Math.max(0, next - now));
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`游戏服务：http://localhost:${PORT}   架构图谱：http://localhost:${PORT}/atlas/`);
  loop();
});
