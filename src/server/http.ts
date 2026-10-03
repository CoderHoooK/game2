// 静态文件：/ → 打包好的前端（dist/client），/atlas/ → 架构图谱源码目录
import { createServer, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export function createHttp(root: string, health: () => unknown): Server {
  const client = path.join(root, 'dist/client');
  const atlas = path.join(root, 'atlas');
  return createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://x');
    let p = decodeURIComponent(url.pathname);
    if (p === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(health()));
      return;
    }
    if (p === '/atlas') {
      res.writeHead(302, { location: '/atlas/' });
      res.end();
      return;
    }
    let base = client;
    if (p.startsWith('/atlas/')) {
      base = atlas;
      p = p.slice('/atlas'.length);
    }
    if (p.endsWith('/')) p += 'index.html';
    const file = path.normalize(path.join(base, p));
    if (!file.startsWith(base)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const s = await stat(file);
      if (!s.isFile()) throw new Error('not file');
      const body = await readFile(file);
      res.writeHead(200, {
        'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
        'cache-control': p.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-store',
      });
      res.end(body);
    } catch {
      if (base === client && p === '/index.html') {
        res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('前端还没打包：先运行 npm run build（或直接 npm start）');
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('404');
    }
  });
}
