import type { ItemDef, WorkDef } from '../src/shared/content';

export const ITEMS: ItemDef[] = [
  { id: 'food', name: '粮食', aliases: ['粮', '粮食'], color: '#e2c25a' },
  { id: 'wood', name: '木头', aliases: ['木', '木头'], color: '#a16207' },
  { id: 'stone', name: '石头', aliases: ['石', '石头'], color: '#a3a3a3' },
  { id: 'iron', name: '铁', aliases: ['铁', '铁矿'], color: '#c2410c' },
  { id: 'gold', name: '金', aliases: ['金', '金币'], color: '#facc15' },
  { id: 'weapon', name: '兵器', aliases: ['兵器'], color: '#e5e7eb' },
  { id: 'tool', name: '工具', aliases: ['工具'], color: '#9ca3af' },
];

// 命令里的"活"：派 @木:5 伐木 北林
export const WORKS: WorkDef[] = [
  { verb: '伐木', resource: 'wood', profession: 'woodcutter' },
  { verb: '采石', resource: 'stone', profession: 'mason' },
  { verb: '挖矿', resource: 'iron', profession: 'miner' },
  { verb: '种田', resource: 'food', profession: 'farmer' },
  { verb: '打铁', resource: 'weapon', profession: 'smith' },
];
