// 宿主：建模拟 → 读档 → 固定每秒 10 步的主循环（每步按时间倍率跑 0–16 拍，拍与拍之间让 AI 诸侯想事）
// → HTTP + WebSocket 同一个端口；每 5 个游戏日自动存档。
// 环境变量：PORT（8080）、SEED（1）、NPCS（2000）、FRESH=1（不读档）、AI=off（关掉 AI 诸侯）、
//           AI_BASE_URL / AI_API_KEY / AI_MODEL（都给了就用大模型，否则用脚本诸侯）、SAVE（存档路径）
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGame } from '../game';
import { AiHost, OpenAIProvider } from '../ai';
import { createHttp } from './http';
import { Gateway } from './gateway';
import { StatsBuilder } from './stats';
import { loadFrom, saveTo } from './persist';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.PORT || 8080);
const SEED = Number(process.env.SEED || 1);
const NPCS = Number(process.env.NPCS || 2000);
const SAVE = process.env.SAVE || path.join(root, 'saves/auto.json.gz');
const AUTOSAVE_DAYS = 5;

const t0 = performance.now();
const sim = createGame({ seed: SEED, config: { population: { npcs: NPCS } } });
sim.scheduler.profiler = { now: () => performance.now() };
console.log(`世界生成：种子 ${SEED}，${sim.world.count} 个 NPC，用时 ${(performance.now() - t0).toFixed(0)} ms`);

const provider = OpenAIProvider.fromEnv(process.env);
const ai = process.env.AI === 'off' ? null : new AiHost(sim, { provider });
console.log(ai ? `AI 诸侯：${provider ? provider.name : '脚本'}` : 'AI 诸侯：关闭');
if (process.env.FRESH !== '1') {
  try {
    console.log(loadFrom(SAVE, sim, ai));
  } catch (err) {
    console.log(`读档失败，开新局：${(err as Error).message}`);
  }
}

let tickMsSum = 0;
let tickCount = 0;
let lastTickMs = 0;
const health = () => ({ ok: true, tick: sim.clock.tick, label: sim.clock.label(), npcs: sim.world.count, tickMs: lastTickMs, clients: gateway.clientCount });
const server = createHttp(root, health);
const gateway = new Gateway(sim, server, ai);
const stats = new StatsBuilder(sim);

const save = (why: string) => {
  try {
    const n = saveTo(SAVE, sim, ai);
    console.log(`存档（${why}）：${sim.clock.label()}，${(n / 1024).toFixed(0)} KB`);
  } catch (err) {
    console.log(`存档失败：${(err as Error).message}`);
  }
};
let lastSaveDay = sim.clock.day;

let stepNo = 0;
const STEP_MS = 1000 / sim.clock.hz;
let next = performance.now();
function loop() {
  const speed = sim.clock.speed;
  for (let i = 0; i < speed; i++) {
    ai?.step();
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
    gateway.broadcast(stats.build({ tickMs: lastTickMs, systems }));
    tickMsSum = 0;
    tickCount = 0;
  }
  if (sim.clock.day - lastSaveDay >= AUTOSAVE_DAYS) {
    lastSaveDay = sim.clock.day;
    save('自动');
  }
  // 自校正定时：不累积漂移
  next += STEP_MS;
  const now = performance.now();
  if (next < now - 1000) next = now; // 卡太久就别追了
  setTimeout(loop, Math.max(0, next - now));
}

for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, () => {
    save('退出');
    process.exit(0);
  });

// 同时监听 IPv4 和 IPv6（'::' 双栈）：浏览器的 localhost 常常先走 IPv6，
// 只听 IPv4 的话，别的软件占着 IPv6 的同一端口时浏览器会连到它（比如看到 HTTP 400）。
// 端口被占就直接报错退出，不会被悄悄抢走。HOST 可以指定只听某个地址。
const HOST = process.env.HOST;
let started = false;
const listen = (host: string | undefined) => server.listen(PORT, host);
server.on('listening', () => {
  if (started) return;
  started = true;
  console.log(`游戏服务：http://localhost:${PORT}   架构图谱：http://localhost:${PORT}/atlas/`);
  console.log(`（打不开的话试试 http://127.0.0.1:${PORT}）`);
  loop();
});
server.prependListener('error', (err: NodeJS.ErrnoException) => {
  if (!started && !HOST && (err.code === 'EAFNOSUPPORT' || err.code === 'EADDRNOTAVAIL')) {
    listen('0.0.0.0'); // 机器不支持 IPv6：退回只听 IPv4
    return;
  }
  if (err.code === 'EADDRINUSE') {
    console.error(`\n端口 ${PORT} 已经被别的程序占用了。换个端口再启动：`);
    console.error(`  macOS / Linux：PORT=3000 npm start`);
    console.error(`  Windows PowerShell：$env:PORT=3000; npm start`);
    console.error(`查是谁占的：Windows 用 netstat -ano | findstr :${PORT}，macOS / Linux 用 lsof -i :${PORT}\n`);
    process.exit(1);
  }
  throw err;
});
listen(HOST ?? '::');
