// 设置：默认 < 文件 < 环境变量；范围检查；密钥打码；新世界设置 → createGame 参数；模块配置自动出现在面板里。
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MODULES } from '../src/game';
import { Settings, coerce, mask, settingEntries } from '../src/server/settings';

const tmp = () => path.join(mkdtempSync(path.join(tmpdir(), 'g2set-')), 'settings.json');

describe('设置', () => {
  it('所有模块配置都在「新世界」里，键名 模块.项', () => {
    const keys = new Set(settingEntries().map((e) => e.key));
    for (const m of MODULES) for (const k of Object.keys(m.config || {})) expect(keys.has(`${m.id}.${k}`)).toBe(true);
    for (const k of ['speed', 'autosaveDays', 'aiMode', 'aiApiKey', 'seed', 'port', 'host', 'savePath']) expect(keys.has(k)).toBe(true);
    const npcs = settingEntries().find((e) => e.key === 'population.npcs')!;
    expect(npcs.apply).toBe('world');
    expect(npcs.default).toBe(2000);
  });

  it('优先级：默认 < 文件 < 环境变量；环境变量指定的项锁定', () => {
    const f = tmp();
    writeFileSync(f, JSON.stringify({ seed: 5, 'population.npcs': 900, port: 3000, bogus: 1 }));
    const s = new Settings(f, { NPCS: '1200' });
    expect(s.get('seed')).toBe(5);
    expect(s.get('population.npcs')).toBe(1200);
    expect(s.get('port')).toBe(3000);
    expect(s.get('autosaveDays')).toBe(5);
    expect(s.isLocked('population.npcs')).toBe(true);
    const r = s.set({ 'population.npcs': 50 });
    expect(r.errors[0]).toContain('NPCS');
    expect(s.set({ 'population.npcs': 1200 }).errors).toEqual([]); // 原样发回来不算改
  });

  it('AI 环境变量：AI=off → 关闭；三个 AI_* 都给 → 大模型', () => {
    expect(new Settings(tmp(), { AI: 'off' }).get('aiMode')).toBe('off');
    const s = new Settings(tmp(), { AI_BASE_URL: 'http://x/v1', AI_API_KEY: 'k', AI_MODEL: 'm' });
    expect(s.get('aiMode')).toBe('llm');
    expect(s.get('aiModel')).toBe('m');
    expect(new Settings(tmp(), {}).get('aiMode')).toBe('script');
  });

  it('改设置：范围检查（一项不对整批不存）、写文件、返回改了哪些', () => {
    const f = tmp();
    const s = new Settings(f, {});
    expect(s.set({ speed: 99, seed: 3 }).errors.length).toBe(1);
    expect(s.get('seed')).toBe(1);
    const r = s.set({ speed: 4, seed: 3, 'world.regionGrid': '12', aiMode: 'llm' });
    expect(r.errors).toEqual([]);
    expect(r.changed.sort()).toEqual(['aiMode', 'seed', 'speed', 'world.regionGrid'].sort());
    expect(s.get('world.regionGrid')).toBe(12);
    expect(JSON.parse(readFileSync(f, 'utf8'))).toMatchObject({ speed: 4, seed: 3, 'world.regionGrid': 12 });
    expect(new Settings(f, {}).get('speed')).toBe(4); // 重开还在
    expect(s.set({ aiMode: 'gpt' }).errors[0]).toContain('没有');
    expect(s.set({ nope: 1 }).errors[0]).toContain('nope');
  });

  it('密钥：发给网页时打码；空串 = 不改；null = 清除；试运行不落盘', () => {
    const f = tmp();
    const s = new Settings(f, {});
    s.set({ aiApiKey: 'sk-1234567890abcd' });
    const m = s.toMsg({});
    expect(m.values.aiApiKey).toBe('');
    expect(m.secrets.aiApiKey).toBe('已设置 ••••abcd');
    expect(JSON.stringify(m)).not.toContain('sk-1234567890abcd');
    expect(mask('short')).toBe('已设置');
    s.set({ aiApiKey: '' });
    expect(s.get('aiApiKey')).toBe('sk-1234567890abcd');
    const dry = s.set({ aiApiKey: 'other', aiModel: 'm2' }, { dryRun: true });
    expect(dry.values.aiApiKey).toBe('other');
    expect(s.get('aiModel')).toBe('');
    s.set({ aiApiKey: null });
    expect(s.get('aiApiKey')).toBe('');
  });

  it('新世界设置 → createGame 参数；重启类改了会提示', () => {
    const s = new Settings(tmp(), {});
    s.set({ seed: 9, 'population.npcs': 300, port: 9000 });
    const w = s.worldValues();
    expect(Object.keys(w)).not.toContain('port');
    expect(Settings.worldOptions(w)).toMatchObject({ seed: 9, config: { population: { npcs: 300 }, world: { size: 10000 } } });
    expect(s.toMsg(w).pendingRestart).toEqual(['port']);
  });

  it('类型转换', () => {
    const num = settingEntries().find((e) => e.key === 'aiTemperature')!;
    expect(coerce(num, '0.5')).toEqual({ ok: true, value: 0.5 });
    expect(coerce(num, '').ok).toBe(false);
    expect(coerce(num, 'abc').ok).toBe(false);
    const int = settingEntries().find((e) => e.key === 'autosaveDays')!;
    expect(coerce(int, 3.6)).toEqual({ ok: true, value: 4 });
  });
});
