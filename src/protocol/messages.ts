// 前后端消息格式（共用同一份类型：改了一边，另一边编译就报错）。
// 小而频繁的数据（单位位置、地形、资源点）走二进制，见 codec.ts；其余走 JSON。
export const PROTOCOL_VERSION = 1;

export interface Defs {
  seed: number;
  size: number;
  res: number;
  chunkCells: number;
  cellSize: number;
  hz: number;
  ticksPerDay: number;
  terrains: { id: number; key: string; name: string; color: string }[];
  kinds: { id: number; key: string; name: string; color: string; max: number }[];
  items: { id: string; name: string; color: string }[];
  professions: { id: string; name: string; short: string; color: string; shape: string; tags: string[] }[];
  factions: { name: string; color: string }[];
  towns: { id: number; name: string; faction: number; capital: boolean; x: number; y: number; radius: number }[];
  regions: { id: number; name: string; x: number; y: number; terrain: number }[];
  /** 行为表：单位状态字节 = 下标 + 1（0 = 空闲） */
  behaviors: { id: string; name: string }[];
  commands: { verb: string; signature: string; help: string; examples: string[]; who: string[]; module: string }[];
}

export interface StatsMsg {
  t: 'stats';
  tick: number;
  label: string;
  speed: number;
  /** 最近一秒平均每拍耗时（毫秒） */
  tickMs: number;
  /** 各系统耗时（毫秒） */
  systems: Record<string, number>;
  npcs: number;
  /** 每座城的库存（按 defs.items 顺序） */
  stocks: number[][];
  /** 各职业人数（按 defs.professions 顺序） */
  counts: number[];
  /** 每座城各职业人数 */
  townCounts: number[][];
}

export interface InspectInfo {
  id: number;
  name: string;
  faction: string;
  factionColor: string;
  home: string;
  profession: { id: string; name: string; short: string; color: string; stats: Record<string, number>; tags: string[]; text: string };
  hp: number;
  maxHp: number;
  x: number;
  y: number;
  region: string;
  carry: { item: string; qty: number; cap: number } | null;
  behavior: { id: string; name: string; step: number; text: string } | null;
  order: { type: string; name: string; label: string; pinned: boolean; isDefault: boolean } | null;
  group: string | null;
  kit: { id: string; name: string; ready: boolean }[];
  commands: { verb: string; signature: string; help: string; example: string }[];
  components: Record<string, Record<string, unknown>>;
}

export type ServerMsg =
  | { t: 'hello'; v: number; defs: Defs }
  | StatsMsg
  | { t: 'result'; id: number; ok: boolean; msg: string; warns?: string[]; hint?: string; queued?: boolean }
  | { t: 'inspect'; id: number; info: InspectInfo | null };

export type ClientMsg =
  | { t: 'view'; x0: number; y0: number; x1: number; y1: number }
  | { t: 'chunks'; list: [number, number][] }
  | { t: 'inspect'; id: number }
  /** as = 势力名（以诸侯身份，调试用）；null = 上帝 */
  | { t: 'cmd'; id: number; line: string; as: string | null };
