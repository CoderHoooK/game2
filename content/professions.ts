// 职业 = 数据。加一个职业：在这里加一项，再同步 atlas/data.js（npm test 里的图谱同步检查会提醒你）。
// behaviors 里还没实现的行为（craft、haul、flee……）会被跳过，等对应阶段实现后自动生效。
import { defineProfession } from '../src/shared/content';

export const PROFESSIONS = [
  defineProfession({
    id: 'farmer', name: '农夫', short: '农', color: '#84cc16', shape: 'circle', tags: ['worker'],
    stats: { speed: 1.0, carry: 10, hp: 100, attack: 2 }, behaviors: ['farm', 'deliver', 'flee', 'idle'],
    defaultOrder: { type: 'work', resource: 'food' }, gathers: 'food',
    tools: { 锄头: 1.4 }, upkeep: { 粮: 1 }, train: { cost: { 粮: 3 }, days: 1 },
    text: '在城镇附近的田里春种秋收，是全国的饭碗。冬天田里不产粮。',
  }),
  defineProfession({
    id: 'woodcutter', name: '伐木工', short: '木', color: '#d97706', shape: 'triangle', tags: ['worker'],
    stats: { speed: 1.0, carry: 10, hp: 100, attack: 3 }, behaviors: ['gather', 'deliver', 'flee', 'idle'],
    defaultOrder: { type: 'work', resource: 'wood' }, gathers: 'wood',
    tools: { 斧头: 1.5 }, upkeep: { 粮: 1 }, train: { cost: { 粮: 3 }, days: 1 },
    text: '去林区砍树，背满了送回仓库。木头是建造和兵器的基础。',
  }),
  defineProfession({
    id: 'mason', name: '石匠', short: '石', color: '#94a3b8', shape: 'square', tags: ['worker'],
    stats: { speed: 0.9, carry: 8, hp: 110, attack: 3 }, behaviors: ['gather', 'deliver', 'flee', 'idle'],
    defaultOrder: { type: 'work', resource: 'stone' }, gathers: 'stone',
    tools: { 镐: 1.4 }, upkeep: { 粮: 1 }, train: { cost: { 粮: 3 }, days: 1 },
    text: '采石，供城墙和大建筑用。',
  }),
  defineProfession({
    id: 'miner', name: '矿工', short: '矿', color: '#64748b', shape: 'square', tags: ['worker'],
    stats: { speed: 0.9, carry: 8, hp: 110, attack: 3 }, behaviors: ['gather', 'deliver', 'flee', 'idle'],
    defaultOrder: { type: 'work', resource: 'iron' }, gathers: 'iron',
    tools: { 镐: 1.3 }, upkeep: { 粮: 1.5 }, train: { cost: { 粮: 4 }, days: 2 },
    text: '挖铁矿。没有铁就没有兵器，铁矿点是兵家必争之地。',
  }),
  defineProfession({
    id: 'builder', name: '建筑工', short: '建', color: '#f59e0b', shape: 'diamond', tags: ['worker'],
    stats: { speed: 1.0, carry: 10, hp: 100, attack: 2 }, behaviors: ['build', 'haul', 'flee', 'idle'],
    defaultOrder: { type: 'build', place: 'home' },
    tools: { 锤子: 1.5 }, upkeep: { 粮: 1 }, train: { cost: { 粮: 3 }, days: 1 },
    text: '按诸侯的建造单从仓库取料去工地施工。',
  }),
  defineProfession({
    id: 'smith', name: '铁匠', short: '铁', color: '#ef4444', shape: 'diamond', tags: ['worker'],
    stats: { speed: 0.9, carry: 6, hp: 100, attack: 4 }, behaviors: ['craft', 'haul', 'idle'],
    defaultOrder: { type: 'work', resource: 'weapon' },
    tools: {}, upkeep: { 粮: 1 }, train: { cost: { 粮: 5 }, days: 3 },
    text: '在铁匠铺把铁和木头打成兵器和工具。',
  }),
  defineProfession({
    id: 'porter', name: '搬运工', short: '运', color: '#14b8a6', shape: 'circle', tags: ['worker'],
    stats: { speed: 1.1, carry: 20, hp: 100, attack: 2 }, behaviors: ['haul', 'deliver', 'flee', 'idle'],
    defaultOrder: { type: 'haul' },
    tools: {}, upkeep: { 粮: 1 }, train: { cost: { 粮: 2 }, days: 1 },
    text: '在城镇之间运货；平时自动把粮从富余的城运到缺粮的城。路上可能被劫。',
  }),
  defineProfession({
    id: 'soldier', name: '士兵', short: '兵', color: '#3b82f6', shape: 'square', tags: ['military'],
    stats: { speed: 1.1, carry: 5, hp: 150, attack: 12 }, behaviors: ['fight', 'guard', 'patrol', 'march', 'escort', 'idle'],
    defaultOrder: { type: 'guard', place: 'home' },
    tools: { 兵器: 1.6 }, upkeep: { 粮: 1.5 }, train: { cost: { 粮: 5, 铁: 1 }, days: 2 },
    text: '驻守、巡逻、行军、攻城。吃得多，还要铁做兵器。',
  }),
  defineProfession({
    id: 'scout', name: '斥候', short: '斥', color: '#a855f7', shape: 'triangle', tags: ['military'],
    stats: { speed: 1.6, carry: 3, hp: 80, attack: 4 }, behaviors: ['scout', 'march', 'flee', 'idle'],
    defaultOrder: { type: 'scout', place: 'home' },
    tools: {}, upkeep: { 粮: 1 }, train: { cost: { 粮: 4 }, days: 2 },
    text: '跑得快。去别人地盘看兵力和粮草，写进己方情报库。',
  }),
  defineProfession({
    id: 'merchant', name: '商人', short: '商', color: '#eab308', shape: 'diamond', tags: ['worker'],
    stats: { speed: 1.0, carry: 30, hp: 90, attack: 2 }, behaviors: ['trade', 'haul', 'flee', 'idle'],
    defaultOrder: { type: 'trade', place: 'home' },
    tools: {}, upkeep: { 粮: 1 }, train: { cost: { 粮: 4, 金: 20 }, days: 2 },
    text: '带货去别的势力换东西。商路也是情报和冲突的来源。',
  }),
];

// 开局每座城的职业比例（%）。第 1 阶段起由诸侯用"比例"命令调整。
export const START_RATIO: Record<string, number> = {
  farmer: 28, woodcutter: 14, mason: 8, miner: 6, builder: 6, smith: 3, porter: 5, soldier: 20, scout: 4, merchant: 6,
};

// 还没实现的行为的中文名（实现后以模块里登记的为准；现在全部实现了，留着给以后的新职业用）
export const PLANNED_BEHAVIORS: Record<string, string> = {};

/** 每人每天吃多少粮（职业数据里的 upkeep.粮 乘这个） */
export const FOOD_PER_DAY = 0.25;
