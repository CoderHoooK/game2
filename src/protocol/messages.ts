// 前后端消息格式（共用同一份类型：改了一边，另一边编译就报错）。
// 小而频繁的数据（单位位置、地形、资源点）走二进制，见 codec.ts；其余走 JSON。
export const PROTOCOL_VERSION = 4;

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
  buildings: { id: string; name: string; text: string }[];
}

export interface TownStat {
  faction: number;
  capital: boolean;
  pop: number;
  cap: number;
  mood: number;
  tax: number;
  walls: number;
  /** 已建成：建筑 ID → 座数 */
  buildings: Record<string, number>;
  /** 工地：建筑名 + 进度 0–1 */
  sites: { name: string; progress: number }[];
  /** 被围的进度 0–1（没被围 = 不写） */
  siege?: { by: number; progress: number };
}
export interface FactionStat {
  name: string;
  color: string;
  kind: string;
  alive: boolean;
  reputation: number;
  soldiers: number;
  from?: string;
}
export interface RelationStat {
  a: number;
  b: number;
  value: number;
  war: boolean;
  treaties: string[];
  trades: number;
}
export interface ChronicleEntry {
  id: number;
  tick: number;
  scope: string;
  type: string;
  text: string;
  factions: string[];
}
export interface AiLogEntry {
  tick: number;
  label: string;
  mode: string;
  why: string;
  prompt?: string;
  reply: string;
  results: { line: string; ok: boolean; msg: string }[];
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
  towns: TownStat[];
  /** 全部势力（含新冒出来的起义军、已灭亡的），下标 = 单位帧里的势力字节 */
  factions: FactionStat[];
  relations: RelationStat[];
  /** 上次推送以后新增的史册条目（上帝视角，含密信等私密条目） */
  chronicle: ChronicleEntry[];
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

// ---------------------------------------------------------------- 设置（网页 ⚙ 设置面板）
export type SettingValue = number | string | boolean;
/** 什么时候生效：live 立即；world 开新局时；restart 重启服务器后 */
export type SettingApply = 'live' | 'world' | 'restart';
export interface SettingDef {
  key: string;
  group: string;
  label: string;
  help?: string;
  type: 'number' | 'text' | 'bool' | 'select' | 'secret';
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  apply: SettingApply;
  default: SettingValue;
}
export interface SettingsMsg {
  t: 'settings';
  defs: SettingDef[];
  /** 当前值（密钥类一律给空串，看 secrets） */
  values: Record<string, SettingValue>;
  /** 密钥类：已设置时给打码后的样子（如 ••••abcd），没设置给空串 */
  secrets: Record<string, string>;
  /** 被环境变量锁定的项：key → 变量名（网页里改不了） */
  locked: Record<string, string>;
  /** 正在跑的世界是用哪些「新世界」设置生成的 */
  world: Record<string, SettingValue>;
  /** 改了但要重启服务器才生效的项 */
  pendingRestart: string[];
  /** 设置文件路径（给人看） */
  file: string;
}

// ---------------------------------------------------------------- 开始界面（服务器启动后先停在这里，网页里设置好才开局）
/** 磁盘上的存档摘要（读得出来才有 label 等；读不出来给 error） */
export interface SaveInfo {
  /** 游戏内时间，如「第 2 年 夏 第 3 天」 */
  label: string;
  /** 存档时间（ISO） */
  savedAt: string;
  kb: number;
  /** 生成这个世界用的种子 / NPC 数（旧档可能没有） */
  seed?: number;
  npcs?: number;
  /** 有没有「开新局时备份的旧档」（清空存档时一起删） */
  hasPrev: boolean;
  /** 存档损坏 / 读不了：不能继续，但可以清空 */
  error?: string;
}
export type LobbyMode = 'new' | 'continue';

export type ServerMsg =
  | { t: 'hello'; v: number; defs: Defs }
  | StatsMsg
  | { t: 'result'; id: number; ok: boolean; msg: string; warns?: string[]; hint?: string; queued?: boolean }
  | { t: 'inspect'; id: number; info: InspectInfo | null }
  /** 握手后补发最近的史册 */
  | { t: 'chronicle'; entries: ChronicleEntry[] }
  | { t: 'ailog'; faction: string; personality: string; mode: string; logs: AiLogEntry[]; thoughts: { tick: number; text: string }[] }
  | SettingsMsg
  /** 服务器还没开局（停在开始界面）：握手时代替 hello；save = null 表示没有存档 */
  | { t: 'lobby'; save: SaveInfo | null }
  | { t: 'settings.result'; ok: boolean; msg: string }
  /** 服务器要换世界了：页面会断开、重连、刷新 */
  | { t: 'reload'; why: string };

export type ClientMsg =
  | { t: 'view'; x0: number; y0: number; x1: number; y1: number }
  | { t: 'chunks'; list: [number, number][] }
  | { t: 'inspect'; id: number }
  /** as = 势力名（以诸侯身份，调试用）；null = 上帝 */
  | { t: 'cmd'; id: number; line: string; as: string | null }
  /** 要某个诸侯席位的 AI 决策记录和心里话 */
  | { t: 'ailog'; faction: string }
  /** 设置：取 / 改（只发改了的项；密钥类空串 = 不改，null = 清除）/ 用这些设置开新局 / 测试 AI 连接（可带没保存的值） */
  | { t: 'settings' }
  | { t: 'settings.set'; values: Record<string, SettingValue | null> }
  | { t: 'settings.newWorld'; values?: Record<string, SettingValue | null> }
  | { t: 'settings.testAi'; values?: Record<string, SettingValue | null> }
  /** 开始界面：开始（new = 用设置开新局，continue = 读存档继续；values = 表单里还没保存的改动）/ 清空存档 */
  | { t: 'lobby.start'; mode: LobbyMode; values?: Record<string, SettingValue | null> }
  | { t: 'lobby.clear' }
  /** 游戏中：存档后回到开始界面 */
  | { t: 'lobby.back' };
