export const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => document.querySelector(sel) as T;
export const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const hex = (c: string): number => parseInt(c.replace('#', ''), 16);
export const rgb = (c: string): [number, number, number] => [hex(c) >> 16, (hex(c) >> 8) & 255, hex(c) & 255];
export function toast(msg: string, kind: 'ok' | 'err' | '' = ''): void {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'show ' + kind;
  clearTimeout((el as unknown as { _t: number })._t);
  (el as unknown as { _t: number })._t = window.setTimeout(() => (el.className = ''), 2600);
}
export const fmt = (n: number): string => (n >= 10000 ? (n / 10000).toFixed(1) + '万' : String(Math.floor(n)));
