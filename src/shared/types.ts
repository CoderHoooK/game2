/** 实体 ID：组件数组的下标 */
export type Entity = number;
export interface Vec2 {
  x: number;
  y: number;
}
/** 所有"改世界"的操作统一返回这个 */
export interface Result<T = undefined> {
  ok: boolean;
  reason?: string;
  value?: T;
}
export const ok = <T>(value?: T): Result<T> => ({ ok: true, value });
export const fail = (reason: string): Result<never> => ({ ok: false, reason });
