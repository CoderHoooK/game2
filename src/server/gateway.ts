// WebSocket 网关：握手发定义 + 地形 + 资源点；之后按视野推单位、每秒推统计；收命令 / 查人 / 要区块 / 设置。
// 换世界（网页上开新局）：setWorld() → 通知所有页面、断开，页面自己重连刷新。
// 还没开局（停在开始界面）时 sim = null：握手发 lobby 代替 hello，只处理设置和开始界面的消息。
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { Sim } from '../engine/sim';
import type { Source } from '../engine/commands/types';
import type { WorldApi, EconomyApi, PopulationApi, JobsApi, MilitaryApi, ChronicleApi } from '../game';
import type { AiHost } from '../ai';
import { BUILDINGS } from '../../content/buildings';
import { PROTOCOL_VERSION, type ClientMsg, type Defs, type LobbyMode, type ServerMsg, type SettingsMsg, type SettingValue } from '../protocol/messages';
import { encodeChunk, encodeNodes, encodeTerrain, encodeTerritory } from '../protocol/codec';
import { Interest, type View } from './interest';

/** 设置相关的事交给宿主（main.ts）办 */
export interface GatewayHost {
  settings(): SettingsMsg;
  setSettings(values: Record<string, SettingValue | null>): { ok: boolean; msg: string };
  newWorld(values?: Record<string, SettingValue | null>): { ok: boolean; msg: string };
  testAi(values?: Record<string, SettingValue | null>): Promise<{ ok: boolean; msg: string }>;
  /** 开始界面：存档摘要 / 开始（成功后宿主自己调 setWorld 换页面）/ 清空存档 / 游戏中回到开始界面 */
  lobby(): Extract<ServerMsg, { t: 'lobby' }>;
  start(mode: LobbyMode, values?: Record<string, SettingValue | null>): { ok: boolean; msg: string };
  clearSaves(): { ok: boolean; msg: string };
  backToLobby(): { ok: boolean; msg: string };
}

interface Client {
  ws: WebSocket;
  view: View | null;
  sent: number;
}

export function buildDefs(sim: Sim): Defs {
  const world = sim.service<WorldApi>('world');
  const eco = sim.service<EconomyApi>('economy');
  const pop = sim.service<PopulationApi>('population');
  const jobs = sim.service<JobsApi>('jobs');
  return {
    seed: sim.seed,
    size: world.map.size,
    res: world.map.res,
    chunkCells: world.chunkCells,
    cellSize: world.cellSize,
    hz: sim.clock.hz,
    ticksPerDay: sim.clock.ticksPerDay,
    terrains: world.terrains.map(({ id, key, name, color }) => ({ id, key, name, color })),
    kinds: world.kinds.map(({ id, key, name, color, max }) => ({ id, key, name, color, max })),
    items: eco.items.map(({ id, name, color }) => ({ id, name, color })),
    professions: jobs.professions.map(({ id, name, short, color, shape, tags }) => ({ id, name, short, color, shape, tags })),
    factions: pop.factions.map(({ name, color }) => ({ name, color })),
    towns: pop.towns.map(({ id, name, faction, capital, x, y, radius }) => ({ id, name, faction, capital, x, y, radius })),
    regions: world.map.regions.filter((r) => r.land).map((r) => ({ id: r.id, name: r.name, x: r.cx, y: r.cy, terrain: r.terrain })),
    behaviors: sim.brains.behaviors.map(({ id, name }) => ({ id, name })),
    commands: sim.bus.list().map((c) => ({ verb: c.verb, signature: sim.bus.signature(c), help: c.help, examples: c.examples, who: c.who, module: c.module })),
    buildings: BUILDINGS.map(({ id, name, text }) => ({ id, name, text })),
  };
}

export class Gateway {
  private clients = new Set<Client>();
  private interest!: Interest;
  private defs!: Defs;
  private world!: WorldApi;
  private sim: Sim | null = null;
  private ai: AiHost | null = null;
  bytesOut = 0;
  /** 地形栅格；最高位 = 地区边界（陆地上），给前端画地区线 */
  private terrainBuf!: ArrayBuffer;

  /** sim = null：还没开局，停在开始界面 */
  constructor(
    sim: Sim | null,
    server: Server,
    ai: AiHost | null = null,
    private host: GatewayHost | null = null,
  ) {
    if (sim) this.bind(sim, ai);
    const wss = new WebSocketServer({ server, path: '/ws' });
    wss.on('connection', (ws) => this.onConnect(ws));
  }

  /** 换了一个新世界：通知所有页面，断开（页面会自己重连、刷新） */
  setWorld(sim: Sim, ai: AiHost | null, why: string): void {
    for (const c of this.clients) {
      this.send(c, { t: 'reload', why });
      c.ws.close(4001, 'new world');
    }
    this.clients.clear();
    this.bind(sim, ai);
  }

  /** 世界没了（回到开始界面）：通知所有页面、断开，页面重连后会看到开始界面 */
  unbind(why: string): void {
    for (const c of this.clients) {
      this.send(c, { t: 'reload', why });
      c.ws.close(4001, 'lobby');
    }
    this.clients.clear();
    this.sim = null;
    this.ai = null;
  }

  private bind(sim: Sim, ai: AiHost | null): void {
    this.sim = sim;
    this.ai = ai;
    this.terrVersion = -1;
    this.world = sim.service<WorldApi>('world');
    this.defs = buildDefs(sim);
    this.interest = new Interest(sim, this.world.map.size);
    const { res, biome, region } = this.world.map;
    const marked = Uint8Array.from(biome);
    for (let j = 0; j < res; j++)
      for (let i = 0; i < res; i++) {
        const k = j * res + i;
        if (biome[k] <= 1) continue;
        if ((i + 1 < res && region[k + 1] !== region[k]) || (j + 1 < res && region[k + res] !== region[k])) marked[k] |= 0x80;
      }
    this.terrainBuf = encodeTerrain(res, marked);
  }

  private send(c: Client, m: ServerMsg | ArrayBuffer): void {
    if (c.ws.readyState !== WebSocket.OPEN) return;
    if (m instanceof ArrayBuffer) {
      this.bytesOut += m.byteLength;
      c.ws.send(m);
    } else {
      const s = JSON.stringify(m);
      this.bytesOut += s.length;
      c.ws.send(s);
    }
  }

  private nodesBuf(): ArrayBuffer {
    const w = this.world;
    const n = w.nodes;
    const level = new Float32Array(n.count);
    for (let i = 0; i < n.count; i++) level[i] = w.level(i) / w.kinds[n.kind[i]].max;
    return encodeNodes(w.map.size, n.count, n.x, n.y, n.kind, level);
  }

  private terrVersion = -1;
  private territoryBuf(sim: Sim): ArrayBuffer {
    const t = sim.service<MilitaryApi>('military').territory();
    this.terrVersion = t.version;
    return encodeTerritory(t.version, t.size, t.data);
  }

  private onConnect(ws: WebSocket): void {
    const c: Client = { ws, view: null, sent: 0 };
    this.clients.add(c);
    ws.on('close', () => this.clients.delete(c));
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let m: ClientMsg;
      try {
        m = JSON.parse(String(data));
      } catch {
        return;
      }
      this.onMessage(c, m);
    });
    const sim = this.sim;
    if (!sim) {
      if (this.host) this.send(c, this.host.lobby());
      return;
    }
    this.send(c, { t: 'hello', v: PROTOCOL_VERSION, defs: this.defs });
    this.send(c, this.terrainBuf);
    this.send(c, this.nodesBuf());
    this.send(c, this.territoryBuf(sim));
    this.send(c, { t: 'chronicle', entries: sim.service<ChronicleApi>('chronicle').entries('god').slice(-300) });
  }

  private onMessage(c: Client, m: ClientMsg): void {
    if (this.onHostMessage(c, m)) return;
    const sim = this.sim;
    if (!sim) return; // 还没开局：下面都是游戏里的消息
    switch (m.t) {
      case 'view':
        c.view = { x0: +m.x0, y0: +m.y0, x1: +m.x1, y1: +m.y1 };
        this.pushUnits(c);
        break;
      case 'chunks': {
        const max = Math.ceil(this.world.map.size / (this.world.chunkCells * this.world.cellSize));
        for (const [cx, cy] of (m.list || []).slice(0, 64)) {
          if (!(cx >= 0 && cy >= 0 && cx < max && cy < max)) continue;
          this.send(c, encodeChunk(cx, cy, this.world.chunkCells, this.world.chunk(cx, cy)));
        }
        break;
      }
      case 'inspect': {
        const ok = sim.world.alive[m.id] === 1;
        this.send(c, { t: 'inspect', id: m.id, info: ok ? (sim.service<JobsApi>('jobs').describe(m.id) as never) : null });
        break;
      }
      case 'ailog': {
        const f = String(m.faction || '');
        const seat = this.ai?.seats.get(f);
        const thoughts = sim.service<ChronicleApi>('chronicle').thoughts(f).slice(-50).map(({ tick, text }) => ({ tick, text }));
        this.send(c, { t: 'ailog', faction: f, personality: seat?.personality.name ?? '', mode: seat ? seat.mode : this.ai ? '已灭亡' : 'AI 关闭', logs: (seat?.log ?? []).slice(-20), thoughts });
        break;
      }
      case 'cmd': {
        const src: Source = m.as ? { role: 'lord', faction: m.as, origin: 'ui' } : { role: 'god', origin: 'ui' };
        const p = sim.bus.submit(String(m.line || ''), src, (r) => this.send(c, { t: 'result', id: m.id, ...r }));
        if (!p.ok) this.send(c, { t: 'result', id: m.id, ok: false, msg: p.error, hint: p.hint });
        else if (sim.clock.speed === 0) {
          // 暂停时也要让命令生效（比如"时速 1"）：立刻跑掉队列
          sim.bus.runQueued();
        }
        break;
      }
    }
  }

  /** 设置、开始界面的消息（有没有开局都能处理）；处理了返回 true */
  private onHostMessage(c: Client, m: ClientMsg): boolean {
    const host = this.host;
    if (!host) return false;
    switch (m.t) {
      case 'settings':
        this.send(c, host.settings());
        return true;
      case 'settings.set': {
        const r = host.setSettings(m.values || {});
        this.send(c, { t: 'settings.result', ...r });
        if (r.ok) this.send(c, host.settings()); // 失败时不刷新表单，免得用户填的东西没了
        return true;
      }
      case 'settings.newWorld': {
        const r = host.newWorld(m.values);
        this.send(c, { t: 'settings.result', ...r });
        return true;
      }
      case 'settings.testAi':
        void host.testAi(m.values).then((r) => this.send(c, { t: 'settings.result', ...r }));
        return true;
      case 'lobby.start': {
        const r = host.start(m.mode === 'continue' ? 'continue' : 'new', m.values);
        this.send(c, { t: 'settings.result', ...r });
        return true;
      }
      case 'lobby.clear': {
        const r = host.clearSaves();
        this.send(c, { t: 'settings.result', ...r });
        if (r.ok && !this.sim) this.send(c, host.lobby());
        return true;
      }
      case 'lobby.back': {
        const r = host.backToLobby();
        if (!r.ok) this.send(c, { t: 'settings.result', ...r });
        return true;
      }
      default:
        return false;
    }
  }

  private pushUnits(c: Client): void {
    if (!c.view) return;
    const { buf } = this.interest.units(c.view);
    this.send(c, buf);
    c.sent++;
  }

  /** 每个循环步调用：ticked = 这一步有没有跑模拟 */
  step(stepNo: number, ticked: boolean): void {
    const sim = this.sim;
    if (!sim) return;
    for (const c of this.clients) {
      if (!ticked || !c.view) continue;
      // 看全图时单位很多：降到每秒 5 帧
      const wide = c.view.x1 - c.view.x0 > 4000;
      if (wide && stepNo % 2) continue;
      this.pushUnits(c);
    }
    if (stepNo % 50 === 0) {
      const buf = this.nodesBuf();
      for (const c of this.clients) this.send(c, buf);
    }
    if (stepNo % 10 === 5 && sim.service<MilitaryApi>('military').territory().version !== this.terrVersion) {
      const buf = this.territoryBuf(sim);
      for (const c of this.clients) this.send(c, buf);
    }
  }

  broadcast(m: ServerMsg): void {
    for (const c of this.clients) this.send(c, m);
  }

  get clientCount(): number {
    return this.clients.size;
  }
}
