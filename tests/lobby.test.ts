// 开始界面：没开局时网关只发 lobby、不发世界；存档摘要 / 清空存档；开始 / 清空 / 回到开始界面的消息走宿主。
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createGame } from '../src/game';
import { Gateway, type GatewayHost } from '../src/server/gateway';
import { backupSave, clearSaves, describeSave, prevPath, saveTo } from '../src/server/persist';
import type { ClientMsg, ServerMsg } from '../src/protocol/messages';

const dir = () => mkdtempSync(path.join(tmpdir(), 'g2lobby-'));

describe('存档摘要 / 清空存档', () => {
  it('没有存档 → null；有存档 → 游戏内时间、种子、人数；清空后什么都不剩（含备份和临时文件）', () => {
    const file = path.join(dir(), 'auto.json.gz');
    expect(describeSave(file)).toBeNull();
    const sim = createGame({ seed: 7, config: { population: { npcs: 50 } } });
    sim.clock.tick = 100 * 31; // 第 1 年 夏 第 2 天
    saveTo(file, sim, null, { seed: 7, 'population.npcs': 50 });
    const info = describeSave(file)!;
    expect(info.error).toBeUndefined();
    expect(info.label).toBe(sim.clock.label());
    expect(info.seed).toBe(7);
    expect(info.npcs).toBe(50);
    expect(info.kb).toBeGreaterThan(0);
    expect(info.hasPrev).toBe(false);

    backupSave(file);
    writeFileSync(file + '.tmp', 'x');
    expect(describeSave(file)!.hasPrev).toBe(true);
    const gone = clearSaves(file);
    expect(gone.length).toBe(3);
    for (const f of [file, file + '.tmp', prevPath(file)]) expect(existsSync(f)).toBe(false);
    expect(describeSave(file)).toBeNull();
    expect(clearSaves(file)).toEqual([]); // 再清一次不报错
  });

  it('存档坏了：给 error 而不是抛错；仍然能清空', () => {
    const file = path.join(dir(), 'auto.json.gz');
    writeFileSync(file, 'not gzip');
    const info = describeSave(file)!;
    expect(info.error).toBeTruthy();
    expect(clearSaves(file)).toEqual([file]);
    expect(describeSave(file)).toBeNull();
  });

  it('清空存档不动设置文件', () => {
    const d = dir();
    const file = path.join(d, 'auto.json.gz');
    const settingsFile = path.join(d, 'settings.json');
    writeFileSync(file, 'x');
    writeFileSync(settingsFile, '{}');
    clearSaves(file);
    expect(existsSync(settingsFile)).toBe(true);
  });
});

describe('网关：还没开局', () => {
  let server: Server | null = null;
  afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

  async function setup() {
    const calls: string[] = [];
    const host: GatewayHost = {
      settings: () => ({ t: 'settings', defs: [], values: {}, secrets: {}, locked: {}, world: {}, pendingRestart: [], file: 'x' }),
      setSettings: () => ({ ok: true, msg: '' }),
      newWorld: () => ({ ok: false, msg: '' }),
      testAi: async () => ({ ok: true, msg: '' }),
      lobby: () => ({ t: 'lobby', save: { label: '第 1 年 春 第 1 天', savedAt: '', kb: 1, hasPrev: false } }),
      start: (mode, values) => (calls.push(`start:${mode}:${JSON.stringify(values ?? null)}`), { ok: true, msg: '开了' }),
      clearSaves: () => (calls.push('clear'), { ok: true, msg: '清了' }),
      backToLobby: () => (calls.push('back'), { ok: false, msg: '已经在开始界面了' }),
    };
    server = createServer();
    const gw = new Gateway(null, server, null, host);
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const got: (ServerMsg | 'bin')[] = [];
    const waiters: (() => void)[] = [];
    ws.on('message', (d, isBin) => {
      got.push(isBin ? 'bin' : (JSON.parse(String(d)) as ServerMsg));
      waiters.splice(0).forEach((w) => w());
    });
    await new Promise<void>((r) => ws.on('open', () => r()));
    const until = async (pred: () => boolean) => {
      for (let i = 0; i < 50 && !pred(); i++) await new Promise<void>((r) => (waiters.push(r), setTimeout(r, 40)));
      expect(pred()).toBe(true);
    };
    const send = (m: ClientMsg) => ws.send(JSON.stringify(m));
    return { gw, ws, got, calls, until, send };
  }

  it('连上先收到 lobby（带存档摘要），不发 hello / 地形', async () => {
    const t = await setup();
    await t.until(() => t.got.length >= 1);
    expect(t.got[0]).toMatchObject({ t: 'lobby', save: { label: '第 1 年 春 第 1 天' } });
    await new Promise((r) => setTimeout(r, 150));
    expect(t.got.length).toBe(1);
    t.ws.close();
  });

  it('开始 / 清空走宿主；清空成功后再发一份最新的 lobby；游戏里的消息被忽略', async () => {
    const t = await setup();
    await t.until(() => t.got.length >= 1);
    t.send({ t: 'lobby.start', mode: 'continue', values: { seed: 3 } });
    await t.until(() => t.got.some((m) => m !== 'bin' && m.t === 'settings.result'));
    expect(t.calls).toContain('start:continue:{"seed":3}');
    t.send({ t: 'lobby.clear' });
    await t.until(() => t.got.filter((m) => m !== 'bin' && m.t === 'lobby').length === 2);
    expect(t.calls).toContain('clear');
    const n = t.got.length;
    t.send({ t: 'cmd', id: 1, line: '时速 4', as: null });
    t.send({ t: 'view', x0: 0, y0: 0, x1: 100, y1: 100 });
    t.send({ t: 'inspect', id: 0 });
    await new Promise((r) => setTimeout(r, 150));
    expect(t.got.length).toBe(n); // 没开局：没有回复、也没崩
    t.gw.step(0, true); // 没开局时每步什么都不做
    t.ws.close();
  });
});
