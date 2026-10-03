// 内容数据（content/）的类型。内容是纯数据，只依赖这里。
export type Shape = 'circle' | 'square' | 'triangle' | 'diamond';

export interface ProfessionDef {
  id: string;
  name: string;
  short: string;
  color: string;
  shape: Shape;
  tags: string[];
  stats: { speed: number; carry: number; hp: number; attack: number };
  /** 能做的行为，按优先级（行为 ID；还没实现的行为会被跳过） */
  behaviors: string[];
  /** 平时（没被直接派活时）跟随的长期命令 */
  defaultOrder: { type: string; resource?: string; place?: 'home' };
  /** 干活时采集的资源（物品 ID） */
  gathers?: string;
  tools: Record<string, number>;
  upkeep: Record<string, number>;
  train: { cost: Record<string, number>; days: number };
  text: string;
}
export const defineProfession = (p: ProfessionDef): ProfessionDef => p;

export interface ItemDef {
  id: string;
  name: string;
  aliases: string[];
  color: string;
}

export interface WorkDef {
  /** 命令里写的活：伐木 / 采石 / 挖矿 / 种田 / 打铁 */
  verb: string;
  resource: string;
  profession: string;
}

export interface TerrainDef {
  id: number;
  key: string;
  name: string;
  color: string;
  /** 走路速度倍率 */
  speed: number;
  water?: boolean;
}

export interface FactionDef {
  name: string;
  color: string;
  towns: string[];
}

export interface ResourceKindDef {
  id: number;
  key: string;
  name: string;
  item: string;
  max: number;
  /** 每秒恢复（懒计算） */
  regen: number;
  color: string;
}
