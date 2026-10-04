import type { BuildingDef } from '../src/shared/content';

// 建筑 = 数据。效果在建造模块里按 id 实现。
export const BUILDINGS: BuildingDef[] = [
  { id: 'house', name: '房屋', site: 'town', cost: { wood: 40 }, work: 120, max: 20, text: '人口上限 +30' },
  { id: 'farm', name: '农田', site: 'town', cost: { wood: 20 }, work: 80, max: 10, text: '城边多 6 块田' },
  { id: 'wall', name: '城墙', site: 'town', cost: { stone: 120, wood: 30 }, work: 400, max: 3, text: '守城：每层城墙让守军伤害减免 20%，围城要多守 1 天' },
  { id: 'barracks', name: '兵营', site: 'town', cost: { wood: 80, stone: 40 }, work: 240, max: 1, text: '本城士兵攻击 +25%、转兵免一半粮' },
  { id: 'forge', name: '铁匠铺', site: 'town', cost: { wood: 60, stone: 60 }, work: 240, max: 1, text: '本城铁匠打造速度 ×2' },
  { id: 'market', name: '市场', site: 'town', cost: { wood: 80 }, work: 200, max: 1, text: '每天按人口收金，商人交易多赚一半' },
  { id: 'granary', name: '仓库', site: 'town', cost: { wood: 60, stone: 20 }, work: 160, max: 2, text: '粮食每天少坏 50%（不建仓库每天坏 0.5%）' },
  { id: 'talent', name: '人才市场', site: 'town', cost: { wood: 80, gold: 50 }, work: 200, max: 1, text: '本城可以用「募」花金和粮招人（每天有名额）；招士兵还要兵营' },
  { id: 'lumber', name: '伐木场', site: 'region', cost: { wood: 30 }, work: 100, max: 1, text: '本地区的林木恢复 ×3' },
  { id: 'quarry', name: '采石场', site: 'region', cost: { wood: 40 }, work: 140, max: 1, text: '本地区的石料恢复 ×3' },
  { id: 'mine', name: '矿场', site: 'region', cost: { wood: 50, stone: 20 }, work: 160, max: 1, text: '本地区的铁矿恢复 ×3' },
];
