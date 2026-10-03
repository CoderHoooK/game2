// 上帝模块（第 0 阶段只有时间倍率）。第 5 阶段加：天灾、天降、冒名信、托梦、流寇。
import type { GameModule } from '../../../engine/module';

export const god: GameModule = {
  id: 'god',
  name: '上帝',
  events: [{ id: 'god.intervened', module: 'god', text: '上帝出手（只有上帝自己看得到）' }],
  views: [{ id: 'god', text: '上帝面板' }],
  commands: [
    {
      id: 'speed',
      verb: '时速',
      aliases: ['speed'],
      who: ['god'],
      args: [['倍率', 'int']],
      help: '时间倍率（0 = 暂停）',
      examples: ['时速 4'],
      run({ sim, tick }, a) {
        const n = a['倍率'] as number;
        if (n < 0 || n > 16) return { ok: false, msg: '倍率要在 0–16 之间' };
        sim.clock.speed = n;
        sim.events.emit('god.intervened', tick, { kind: 'speed', n });
        return { ok: true, msg: n === 0 ? '时间暂停' : `时间 ×${n}` };
      },
    },
  ],
};
