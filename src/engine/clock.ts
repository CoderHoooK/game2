// 游戏时钟：固定每秒 10 拍；1 天 = 100 拍（约 10 秒现实时间），1 季 = 30 天。
export const SEASONS = ['春', '夏', '秋', '冬'] as const;

export class Clock {
  readonly hz: number;
  readonly ticksPerDay: number;
  readonly daysPerSeason: number;
  tick = 0;
  /** 时间倍率：宿主每 1/hz 秒跑几拍（0 = 暂停）。只影响快慢，不影响结果。 */
  speed = 1;

  constructor(hz = 10, ticksPerDay = 100, daysPerSeason = 30) {
    this.hz = hz;
    this.ticksPerDay = ticksPerDay;
    this.daysPerSeason = daysPerSeason;
  }
  get dt(): number {
    return 1 / this.hz;
  }
  /** 第几天（从 0 开始） */
  get day(): number {
    return Math.floor(this.tick / this.ticksPerDay);
  }
  get seasonIndex(): number {
    return Math.floor(this.day / this.daysPerSeason) % 4;
  }
  get season(): string {
    return SEASONS[this.seasonIndex];
  }
  get year(): number {
    return Math.floor(this.day / (this.daysPerSeason * 4)) + 1;
  }
  /** 秒（游戏模拟时间） */
  get seconds(): number {
    return this.tick / this.hz;
  }
  label(): string {
    return `第 ${this.year} 年 ${this.season} 第 ${(this.day % this.daysPerSeason) + 1} 天`;
  }
}
