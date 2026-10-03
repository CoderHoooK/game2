# game2 · 诸侯争霸（暂名）

AI 诸侯只做战略决策，成百上千的职业 NPC 自己干活。TypeScript：网页画面 + 后端模拟。

## 先看这里

- **架构图谱（可交互）**：`docs/atlas.html`，浏览器直接打开；或 `npm run atlas:serve` 后访问 http://localhost:8080
  - 分层、模块、NPC 模板、每个职业的属性 / 行为 / 控制命令、命令试验台、路线图、待定事项
- 玩法设计：[docs/design.md](docs/design.md)
- 整体架构：[docs/architecture.md](docs/architecture.md)

## 图谱一直跟着开发维护（约定）

图谱是这个项目的活文档，**每次加 / 改模块、职业、行为、命令，都要同步更新图谱**：

1. 改 `atlas/data.js`（以后已实现的部分由 `npm run atlas:export` 从代码的模块注册表自动导出）
2. `npm run atlas`：校验（引用完整、命令例子都能解析、能力事实）+ 生成 `docs/atlas.html`
3. `npm run atlas:smoke`：真浏览器冒烟测试（需要 playwright；没装时退出码 2 = 没跑，不算通过）

## 目录（现在）

```
atlas/        图谱源码：data.js 数据、parser.js 命令解析（规格原型）、app.js 页面、atlas.css
docs/         设计文档 + 生成的 atlas.html
tools/        check-atlas（校验）、build-atlas（打包单文件）、serve-atlas（预览）、atlas-smoke（冒烟）
```
