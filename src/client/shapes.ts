// 色块小人的形状贴图：白色形状 + 深色描边，用 tint 上职业色
import { Texture } from 'pixi.js';

export const SHAPE_PX = 32;
const cache = new Map<string, Texture>();

export function shapeTexture(shape: string): Texture {
  let t = cache.get(shape);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = c.height = SHAPE_PX;
  const g = c.getContext('2d')!;
  const s = SHAPE_PX;
  const m = 4;
  g.beginPath();
  if (shape === 'circle') g.arc(s / 2, s / 2, s / 2 - m, 0, Math.PI * 2);
  else if (shape === 'triangle') (g.moveTo(s / 2, m - 1), g.lineTo(s - m + 1, s - m), g.lineTo(m - 1, s - m), g.closePath());
  else if (shape === 'diamond') (g.moveTo(s / 2, m - 2), g.lineTo(s - m + 2, s / 2), g.lineTo(s / 2, s - m + 2), g.lineTo(m - 2, s / 2), g.closePath());
  else g.rect(m + 1, m + 1, s - 2 * m - 2, s - 2 * m - 2);
  g.fillStyle = '#ffffff';
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(0,0,0,0.75)';
  g.stroke();
  t = Texture.from(c);
  cache.set(shape, t);
  return t;
}

export function shapeSvg(shape: string, color: string, size = 14): string {
  const s = size;
  const m = 1.5;
  let d = '';
  if (shape === 'circle') return `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}"><circle cx="${s / 2}" cy="${s / 2}" r="${s / 2 - m}" fill="${color}" stroke="#0008"/></svg>`;
  if (shape === 'triangle') d = `M${s / 2} ${m} L${s - m} ${s - m} L${m} ${s - m}Z`;
  else if (shape === 'diamond') d = `M${s / 2} ${m} L${s - m} ${s / 2} L${s / 2} ${s - m} L${m} ${s / 2}Z`;
  else d = `M${m + 1} ${m + 1} H${s - m - 1} V${s - m - 1} H${m + 1}Z`;
  return `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}"><path d="${d}" fill="${color}" stroke="#0008"/></svg>`;
}
