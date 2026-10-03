// 分层测试：依赖只能向下、模块之间只走公开接口、模拟代码里不许读真实时钟和 Math.random。
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { MODULES } from '../src/game';

const ROOT = path.resolve(__dirname, '..');
const LAYERS = ['shared', 'engine', 'game', 'ai', 'protocol', 'server', 'client'] as const;
type Layer = (typeof LAYERS)[number] | 'content';
const ALLOWED: Record<Layer, Layer[]> = {
  shared: [],
  engine: ['shared'],
  content: ['shared'],
  game: ['engine', 'shared', 'content'],
  ai: ['game', 'engine', 'shared', 'content'],
  protocol: ['shared'],
  server: ['ai', 'game', 'engine', 'protocol', 'shared', 'content'],
  client: ['protocol', 'shared'],
};
/** 各层能用的第三方包 */
const PACKAGES: Record<Layer, RegExp> = {
  shared: /^$/,
  engine: /^$/,
  content: /^$/,
  game: /^$/,
  ai: /^$/,
  protocol: /^$/,
  server: /^(ws|node:.*)$/,
  client: /^(pixi\.js)$/,
};
const SIM: Layer[] = ['shared', 'engine', 'game', 'content'];

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.ts$/.test(f) && !f.endsWith('.d.ts')) out.push(p);
  }
  return out;
}
function layerOf(file: string): Layer | null {
  const rel = path.relative(ROOT, file).split(path.sep);
  if (rel[0] === 'content') return 'content';
  if (rel[0] === 'src' && (LAYERS as readonly string[]).includes(rel[1])) return rel[1] as Layer;
  return null;
}
function imports(src: string): string[] {
  const out: string[] = [];
  const re = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (let m; (m = re.exec(src)); ) out.push(m[1] || m[2] || m[3]);
  return out;
}
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const files = [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'content'))];

describe('分层', () => {
  it('找到了源码', () => expect(files.length).toBeGreaterThan(30));

  it('依赖只能向下，第三方包只能在对应的层用', () => {
    const bad: string[] = [];
    for (const f of files) {
      const from = layerOf(f);
      if (!from) continue;
      for (const spec of imports(readFileSync(f, 'utf8'))) {
        const where = path.relative(ROOT, f);
        if (spec.startsWith('.')) {
          const to = layerOf(path.resolve(path.dirname(f), spec));
          if (to && to !== from && !ALLOWED[from].includes(to)) bad.push(`${where}：${from} 不能依赖 ${to}（${spec}）`);
        } else if (!PACKAGES[from].test(spec)) bad.push(`${where}：${from} 层不能用包 ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('模块之间只能通过对方的 index.ts，而且要在 requires 里声明', () => {
    const req = new Map(MODULES.map((m) => [m.id, new Set(m.requires || [])]));
    const bad: string[] = [];
    const modDir = path.join(ROOT, 'src/game/modules');
    for (const f of files) {
      const rel = path.relative(modDir, f).split(path.sep);
      if (rel[0] === '..' || rel.length < 2) continue;
      const me = rel[0];
      for (const spec of imports(readFileSync(f, 'utf8'))) {
        if (!spec.startsWith('.')) continue;
        const target = path.relative(modDir, path.resolve(path.dirname(f), spec)).split(path.sep);
        if (target[0] === '..' || target[0] === me) continue;
        const other = target[0];
        if (target.length > 1 && !(target.length === 2 && target[1] === 'index')) bad.push(`${me} 绕过公开接口引用了 ${target.join('/')}`);
        if (!req.get(me)?.has(other)) bad.push(`${me} 引用了 ${other}，但没在 requires 里声明`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('模拟代码里不读真实时钟、不用 Math.random（保证可重现）', () => {
    const bad: string[] = [];
    for (const f of files) {
      const l = layerOf(f);
      if (!l || !SIM.includes(l)) continue;
      const src = stripComments(readFileSync(f, 'utf8'));
      for (const pat of [/Math\.random\s*\(/, /Date\.now\s*\(/, /performance\.now\s*\(/, /new Date\s*\(/]) {
        if (pat.test(src)) bad.push(`${path.relative(ROOT, f)}：${pat.source}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('每个模块都在模块清单里', () => {
    const dirs = readdirSync(path.join(ROOT, 'src/game/modules'));
    expect(dirs.sort()).toEqual(MODULES.map((m) => m.id).sort());
  });
});
