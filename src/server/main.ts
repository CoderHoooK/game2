// 宿主：读设置 → 建模拟 → 读档 → 固定每秒 10 步的主循环（每步按时间倍率跑 0–16 拍，拍与拍之间让 AI 诸侯想事）
// → HTTP + WebSocket 同一个端口；按设置的间隔自动存档。
// 所有设置都在网页「⚙ 设置」里改（存到 saves/settings.json，见 settings.ts）。
// 环境变量仍然可用、而且优先：PORT、HOST、SEED、NPCS、SAVE、AI=off、AI_BASE_URL / AI_API_KEY / AI_MODEL；
// 另外 FRESH=1（这次启动不读档）、SETTINGS（设置文件路径）。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGame } from '../game';
import type { Sim } from '../engine/sim';
import { AiHost, OpenAIProvider } from '../ai';
import { createHttp } from './http';
import { Gateway, type GatewayHost } from './gateway';
import { StatsBuilder } from './stats';
import { backupSave, loadInto, readSave, saveTo, type SaveBundle } from './persist';
import { Settings } from './settings';
import type { SettingValue } from '../protocol/messages';

type Values = Record<string, SettingValue>;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const settings = new Settings(path.resolve(root, process.env.SETTINGS || 'saves/settings.json'));
const PORT = settings.num('port');
const HOST = settings.str('host') || undefined;
const SAVE = path.resolve(root, settings.str('savePath'));

// ---------------------------------------------------------------- AI 设置
function makeProvider(v: Values): OpenAIProvider | null {
  const baseUrl = String(v.aiBaseUrl ?? '');
  const apiKey = String(v.aiApiKey ?? '');
  const model = String(v.aiModel ?? '');
  if (!baseUrl || !apiKey || !model) return null;
  return new OpenAIProvider({ baseUrl, apiKey, model, timeoutMs: Number(v.aiTimeoutSec) * 1000, temperature: Number(v.aiTemperature) });
}
function aiOptions(tpd: number) {
  const v = settings.all();
  const mode = String(v.aiMode);
  return {
    provider: mode === 'llm' ? makeProvider(v) : null,
    enabled: mode !== 'off',
    scriptEvery: Number(v.scriptEveryDays) * tpd,
    llmEvery: Number(v.llmEveryDays) * tpd,
  };
}
function aiLabel(): string {
  if (settings.str('aiMode') === 'llm' && ai.providerName === '脚本') return '脚本（大模型接口没填全：接口地址 / API Key / 模型名）';
  return ai.providerName;
}

// ---------------------------------------------------------------- 世界
let sim!: Sim;
let ai!: AiHost;
let stats!: StatsBuilder;
/** 当前世界是用哪些「新世界」设置生成的（存进存档） */
let worldInUse: Values = {};
let lastSaveDay = 0;

function build(world: Values): void {
  const t0 = performance.now();
  sim = createGame(Settings.worldOptions(world));
  sim.scheduler.profiler = { now: () => performance.now() };
  sim.clock.speed = settings.num('speed');
  ai = new AiHost(sim, aiOptions(sim.clock.ticksPerDay));
  stats = new StatsBuilder(sim);
  worldInUse = world;
  lastSaveDay = sim.clock.day;
  console.log(`世界生成：种子 ${sim.seed}，${sim.world.count} 个 NPC，用时 ${(performance.now() - t0).toFixed(0)} ms`);
}

/** 存档里记的新世界设置（旧存档没记的项按默认值） */
function worldOf(bundle: SaveBundle): Values {
  const w: Values = {};
  for (const e of settings.entries) if (e.apply === 'world') w[e.key] = bundle.world?.[e.key] ?? (e.key === 'seed' ? bundle.sim.seed : e.default);
  return w;
}

let saved: SaveBundle | null = null;
if (process.env.FRESH !== '1') {
  try {
    saved = readSave(SAVE);
  } catch (err) {
    console.log(`存档读不了，开新局：${(err as Error).message}`);
  }
}
build(saved ? worldOf(saved) : settings.worldValues());
if (saved) {
  const r = loadInto(saved, sim, ai);
  console.log(r.msg);
  lastSaveDay = sim.clock.day;
  sim.clock.speed = settings.num('speed');
}
console.log(`AI 诸侯：${aiLabel()}`);
console.log(`设置文件：${settings.path}`);

let tickMsSum = 0;
let tickCount = 0;
let lastTickMs = 0;
const health = () => ({ ok: true, tick: sim.clock.tick, label: sim.clock.label(), npcs: sim.world.count, tickMs: lastTickMs, clients: gateway.clientCount });
const server = createHttp(root, health);

const save = (why: string) => {
  try {
    const n = saveTo(SAVE, sim, ai, worldInUse);
    console.log(`存档（${why}）：${sim.clock.label()}，${(n / 1024).toFixed(0)} KB`);
  } catch (err) {
    console.log(`存档失败：${(err as Error).message}`);
  }
};

// ---------------------------------------------------------------- 网页设置
const APPLY_NOTE = { live: '已生效', world: '开新局时生效', restart: '重启服务器后生效（终端里 Ctrl+C 再 npm start）' } as const;
function applyLive(changed: string[]): void {
  if (changed.includes('speed')) sim.clock.speed = settings.num('speed');
  if (changed.some((k) => k.startsWith('ai') || k.endsWith('EveryDays'))) {
    ai.configure(aiOptions(sim.clock.ticksPerDay));
    console.log(`AI 诸侯：${aiLabel()}`);
  }
}
function describe(changed: string[]): string {
  if (!changed.length) return '没有改动';
  const groups = new Map<string, string[]>();
  for (const k of changed) {
    const e = settings.entries.find((x) => x.key === k)!;
    const note = APPLY_NOTE[e.apply];
    groups.set(note, [...(groups.get(note) ?? []), e.label]);
  }
  return '已保存。' + [...groups].map(([note, labels]) => `${labels.join('、')}：${note}`).join('；');
}
function newWorld(): void {
  save('换新世界前');
  const bak = backupSave(SAVE);
  build(settings.worldValues());
  gateway.setWorld(sim, ai, '正在换成新世界…');
  save('新局');
  console.log(`开了新局${bak ? `（旧档备份在 ${bak}）` : ''}`);
}
const host: GatewayHost = {
  settings() {
    const m = settings.toMsg(worldInUse);
    m.values.speed = sim.clock.speed; // 顶栏 / 命令改的倍率也算
    return m;
  },
  setSettings(values) {
    const r = settings.set(values);
    if (r.errors.length) return { ok: false, msg: r.errors.join('；') };
    applyLive(r.changed);
    if (r.changed.length) console.log(`设置改了：${r.changed.join(', ')}`);
    return { ok: true, msg: describe(r.changed) };
  },
  newWorld(values) {
    if (values) {
      const r = settings.set(values);
      if (r.errors.length) return { ok: false, msg: r.errors.join('；') };
      applyLive(r.changed);
    }
    setTimeout(newWorld, 100); // 先把回复发出去
    return { ok: true, msg: '正在生成新世界…旧档会备份成 .prev.json.gz' };
  },
  async testAi(values) {
    const r = settings.set(values ?? {}, { dryRun: true });
    if (r.errors.length) return { ok: false, msg: r.errors.join('；') };
    const p = makeProvider(r.values);
    if (!p) return { ok: false, msg: '接口地址、API Key、模型名都要填' };
    const t0 = performance.now();
    try {
      const reply = await p.complete([
        { role: 'system', content: '这是连通性测试。只回复「收到」。' },
        { role: 'user', content: '测试' },
      ]);
      return { ok: true, msg: `连通了（${(performance.now() - t0).toFixed(0)} ms），模型回复：${reply.trim().slice(0, 80) || '（空）'}` };
    } catch (err) {
      return { ok: false, msg: `连不上：${(err as Error).message}` };
    }
  },
};
const gateway = new Gateway(sim, server, ai, host);

let stepNo = 0;
const STEP_MS = 1000 / sim.clock.hz;
let next = performance.now();
function loop() {
  const speed = sim.clock.speed;
  for (let i = 0; i < speed; i++) {
    ai.step();
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
  if (sim.clock.day - lastSaveDay >= settings.num('autosaveDays')) {
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
    if (!settings.isLocked('speed') && settings.num('speed') !== sim.clock.speed) settings.set({ speed: sim.clock.speed }); // 下次按现在的倍率启动
    save('退出');
    process.exit(0);
  });

// 同时监听 IPv4 和 IPv6（'::' 双栈）：浏览器的 localhost 常常先走 IPv6，
// 只听 IPv4 的话，别的软件占着 IPv6 的同一端口时浏览器会连到它（比如看到 HTTP 400）。
// 端口被占就直接报错退出，不会被悄悄抢走。设置里的「监听地址」/ HOST 可以指定只听某个地址。
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
    console.error(`\n端口 ${PORT} 已经被别的程序占用了。换个端口再启动（或改 ${settings.path} 里的 port）：`);
    console.error(`  macOS / Linux：PORT=3000 npm start`);
    console.error(`  Windows PowerShell：$env:PORT=3000; npm start`);
    console.error(`查是谁占的：Windows 用 netstat -ano | findstr :${PORT}，macOS / Linux 用 lsof -i :${PORT}\n`);
    process.exit(1);
  }
  throw err;
});
listen(HOST ?? '::');
