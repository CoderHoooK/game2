// 把 atlas/ 下的页面合成一个独立的 HTML（样式和脚本全部内联），离线也能直接打开。
// 输出：docs/atlas.html
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'atlas');
const read = (f) => readFileSync(path.join(dir, f), 'utf8');
let html = read('index.html');
let n = 0;
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, f) => { n++; return `<style>\n${read(f)}\n</style>`; });
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, f) => { n++; return `<script>\n${read(f).replace(/<\/script/gi, '<\\/script')}\n</script>`; });
if (n !== 4) { console.error(`✗ 内联数量不对：${n}（应为 1 个样式 + 3 个脚本）`); process.exit(1); }
const out = path.join(root, 'docs', 'atlas.html');
writeFileSync(out, html);
console.log(`✓ 已生成 docs/atlas.html（${(html.length / 1024).toFixed(0)} KB）`);
