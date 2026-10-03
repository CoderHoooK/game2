import type { ResourceKindDef, TerrainDef } from '../src/shared/content';

// 地形：编号写进地图栅格和区块（低 4 位），前端按 color 上色
export const TERRAINS: TerrainDef[] = [
  { id: 0, key: 'deep', name: '深水', color: '#1b3550', speed: 0.3, water: true },
  { id: 1, key: 'shallow', name: '浅水', color: '#2c5878', speed: 0.4, water: true },
  { id: 2, key: 'sand', name: '沙滩', color: '#cdbf8e', speed: 0.9 },
  { id: 3, key: 'plains', name: '平原', color: '#7c9d55', speed: 1.0 },
  { id: 4, key: 'forest', name: '森林', color: '#3d6635', speed: 0.8 },
  { id: 5, key: 'hills', name: '丘陵', color: '#8e8a5a', speed: 0.75 },
  { id: 6, key: 'mountain', name: '山地', color: '#77706a', speed: 0.5 },
  { id: 7, key: 'swamp', name: '沼泽', color: '#4d6650', speed: 0.5 },
];

// 资源点种类：数量有上限，按时间懒恢复（被查询时才补算）
export const RESOURCE_KINDS: ResourceKindDef[] = [
  { id: 0, key: 'wood', name: '林木', item: 'wood', max: 200, regen: 0.15, color: '#2e7d32' },
  { id: 1, key: 'field', name: '农田', item: 'food', max: 120, regen: 0.4, color: '#e2c25a' },
  { id: 2, key: 'stone', name: '石料', item: 'stone', max: 400, regen: 0.05, color: '#b0b0b0' },
  { id: 3, key: 'iron', name: '铁矿', item: 'iron', max: 300, regen: 0.03, color: '#c2410c' },
];

// 每种地形的地区里放多少资源点（[资源, 个数, 概率]）
export const NODES_PER_REGION: Record<string, [string, number, number][]> = {
  forest: [['wood', 12, 1]],
  plains: [['wood', 2, 0.6]],
  hills: [['stone', 6, 1], ['iron', 1, 0.35], ['wood', 2, 0.5]],
  mountain: [['stone', 5, 1], ['iron', 3, 1]],
  swamp: [['wood', 3, 0.7]],
  sand: [],
};

// 地区命名：字头 + 按地形的字尾
export const NAME_HEADS = '青白黑赤金银铁石松柳桃梅竹云雾风雪霜月星龙虎鹿鹤雁鹰狼熊马羊清长高古新双三九落卧飞望回苍碧丹紫玉翠寒暖明幽'.split('');
export const NAME_TAILS: Record<string, string[]> = {
  plains: ['原', '坪', '野', '川', '甸'],
  forest: ['林', '木', '森', '杉'],
  hills: ['岭', '丘', '坡', '冈'],
  mountain: ['山', '峰', '岩', '崖'],
  swamp: ['泽', '沼', '洼'],
  sand: ['滩', '湾', '渚', '洲'],
  shallow: ['湖', '池'],
  deep: ['海'],
};
