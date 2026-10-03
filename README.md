# game2 · 诸侯争霸（暂名）

AI 诸侯只做战略决策，成百上千的职业 NPC 自己干活。TypeScript：网页画面 + 后端模拟。

**现在进度：第 0 阶段（地基）完成**：10 公里大陆、6 个诸侯 12 座城、2000 个色块小人在种田 / 伐木 / 采石 / 挖矿 / 站岗 / 巡逻；
可以在网页里飞来飞去看，点任何一个小人看他所有属性、行为和能用的命令，在命令框里直接指挥。

## 跑起来

```bash
npm install          # Node ≥ 20.19
npm start            # 打包前端 + 启动服务 → http://localhost:8080
```

- 游戏：http://localhost:8080 ；架构图谱：http://localhost:8080/atlas/
- 操作：拖动平移、滚轮缩放、点小人 / 城镇看详情、`Home` 全图、`F` 跟随、`Enter` 或 `/` 输入命令、`Tab` 看可用命令
- 网址参数：`?x=3690&y=4830&z=3` 直接看某处
- 环境变量：`PORT`（8080）、`SEED`（1）、`NPCS`（2000）
- 开发：`npm run dev:server` + `npm run dev:client`（前端热更新，http://localhost:5173）

命令示例（在命令框里，身份选"青龙"）：

```
派 @木:5 伐木 北林      派 5 个伐木工去北林伐木（锁定）
放 @木@北林             让他们回到平时的安排
编 @兵@青石城:20 一队    编队
守 #一队 河口镇          驻守
巡 @兵:6 北林           巡逻
探 @斥:2 东山           侦察
撤 #一队                撤回
时速 4                  （上帝）时间 4 倍速
```

## 测试

```bash
npm test             # 单元 + 玩法规则 + 命令契约 + 可重现 + 分层 + 图谱对照 + 协议 + 压测 + 图谱校验
npm run check        # 再加类型检查和图谱生成
npm run bench        # 压测：2000 / 5000 / 10000 人每拍耗时
npm run smoke        # 浏览器冒烟（先 npm start；需要 playwright + chromium）
npm run atlas:smoke  # 图谱冒烟
```

实测（2 核沙盒）：2000 人每拍约 0.2–0.4 ms，10000 人约 1 ms（预算 5 ms）。

## 先看这里

- **架构图谱（可交互）**：`docs/atlas.html` 直接用浏览器打开，或游戏服务的 `/atlas/`
  - 分层、模块、NPC 模板、每个职业的属性 / 行为 / 控制命令、命令试验台、路线图、代码进度
- 玩法设计：[docs/design.md](docs/design.md)
- 整体架构：[docs/architecture.md](docs/architecture.md)
- 协作约定：[AGENTS.md](AGENTS.md)

## 图谱一直跟着开发维护（约定）

1. 改了模块 / 组件 / 行为 / 职业 / 命令 → 改 `atlas/data.js`
2. `npm test` 里的 `tests/atlas-sync.test.ts` 会逐项对照代码和图谱，不一致就失败
3. `npm run atlas`：校验 + 生成 `docs/atlas.html`

## 目录

```
src/
  shared/     基础：可重现随机数、噪声、数学、类型
  engine/     通用内核：组件存储、时钟、事件、调度、移动、大脑（行为 / 长期命令）、空间索引、模块注册、命令总线
  game/       玩法模块：world 世界 · economy 经济 · population 人口 · jobs 职业 · military 军事 · god 上帝
  protocol/   前后端通信格式（消息类型 + 二进制帧）
  server/     主循环、WebSocket 网关、视野订阅、静态文件
  client/     浏览器：Pixi 画面图层、镜头、面板（详情 / 命令框 / 小地图 / 图例）
content/      纯数据：地形、物品、职业、诸侯
tests/        vitest 测试
atlas/        图谱源码（data.js 数据、parser.js 命令解析原型、app.js 页面）
docs/         设计文档 + 生成的 atlas.html
tools/        图谱校验 / 打包 / 冒烟、游戏冒烟、压测、deps.sh（沙盒专用）
```
