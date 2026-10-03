import type { DisasterDef, TreatyDef } from '../src/shared/content';

export const TREATIES: TreatyDef[] = [
  { id: 'alliance', name: '结盟', text: '共同防御：一方被攻，另一方的史册里会记下是否出兵' },
  { id: 'nonaggression', name: '互不侵犯', text: '双方不能进攻对方；进攻会自动撕约并记进史册' },
  { id: 'tribute', name: '朝贡', text: '提议方每天给对方 1% 库存的金（臣服）' },
  { id: 'trade', name: '通商', text: '商人可以去对方城镇交易，双方都多赚' },
  { id: 'passage', name: '借道', text: '提议方的部队可以穿过对方领地而不算入侵' },
];

export const DISASTERS: DisasterDef[] = [
  { id: 'drought', name: '旱', text: '地区里的田和树不长' },
  { id: 'flood', name: '涝', text: '地区里的田被冲毁一半，期间不长' },
  { id: 'plague', name: '疫', text: '地区里的人每天掉血，城里的人更多' },
  { id: 'locust', name: '蝗', text: '附近城镇的粮仓被吃掉三成，田不长' },
];
