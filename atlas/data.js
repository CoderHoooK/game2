// 架构图谱的数据源。
//
// 手工维护，但已实现的部分由 tests/atlas-sync.test.ts 和代码逐项对照（npm test 里跑）：
//   - 代码里有的模块 / 组件 / 长期命令 / 行为 / 职业 / 命令，这里必须一模一样，状态是 wip / done；
//   - 这里标了 wip / done 的，代码里必须真有。
// 还没实现的条目继续留在这里（status = 'draft' 或不写），作为设计草案。
// 每次改完：`npm run atlas` = 校验（引用完整、命令例子都能解析）+ 生成 docs/atlas.html。
//
// status: 'draft' 草案 | 'wip' 开发中 | 'done' 已实现
globalThis.ATLAS = {
  meta: {
    title: '诸侯争霸 · 架构图谱',
    subtitle: 'AI 诸侯只做战略决策，成百上千的职业 NPC 自己干活',
    version: '0.3',
    updated: '2026-10-04',
    source: '代码（已实现部分，和代码自动对照）+ 设计草案（docs/architecture.md、docs/design.md）',
  },

  // ------------------------------------------------------------------ 原则
  principles: [
    { icon: '🧩', title: '一个功能 = 一个模块', text: '模块向核心登记自己的命令、简报、存档、配置、画面图层；加功能不改核心文件。' },
    { icon: '📜', title: '命令只定义一次', text: '解析器、AI 命令表、上帝面板按钮、文档、测试，全部从同一份定义生成。' },
    { icon: '🎯', title: 'AI 只做战略', text: 'NPC 按行为自己干活；AI 给群体下长期命令，一个季节决策几次。' },
    { icon: '⚖️', title: '规则只有一个入口', text: '所有对世界的改动都走"动作"：NPC、AI、上帝、测试用同一套规则。' },
    { icon: '🌫️', title: '迷雾第一天就有', text: '每个势力一份情报库；AI 简报只读情报，不读真实数据，撒谎才有意义。' },
    { icon: '⚡', title: '按大规模来写', text: '数据按紧凑数组存、固定节拍、远处粗算；压测超预算就算测试失败。' },
  ],

  // ------------------------------------------------------------------ 分层
  layers: [
    { id: 'client', name: '前端', en: 'client', color: '#f472b6', deps: ['protocol', 'shared'],
      role: '浏览器：画面图层、界面面板、镜头、输入 → 命令。只依赖通信格式，绝不碰模拟代码。',
      dirs: ['src/client/'], items: ['index.html', 'main.ts', 'net.ts', 'camera.ts', 'shapes.ts', 'layers/（地形 / 资源点 / 城镇 / 小人）', 'panels/（详情 / 命令框 / 小地图 / 图例 / 抽屉 / ⚙ 设置）'], status: 'wip' },
    { id: 'protocol', name: '通信格式', en: 'protocol', color: '#e879f9', deps: ['shared'], side: true,
      role: 'WebSocket 消息格式，前后端共用同一份类型：改了一边，另一边编译就报错。',
      dirs: ['src/protocol/'], items: ['messages.ts', 'codec.ts（二进制帧）'], status: 'wip' },
    { id: 'server', name: '宿主', en: 'server', color: '#fb923c', deps: ['ai', 'game', 'engine', 'protocol', 'shared'],
      role: '主循环、WebSocket 网关、视野订阅、存档文件、网页设置（时间 / AI 诸侯 / 新世界 / 服务器，网页上改，环境变量优先）。启动后先停在开始界面（还没生成世界），网页里设置好才开局；可继续存档、清空存档。',
      dirs: ['src/server/'], items: ['main.ts（主循环；开始界面 / 游戏中两个阶段）', 'gateway.ts（没开局时只发 lobby、只处理设置和开始界面的消息）', 'interest.ts', 'http.ts', 'stats.ts（每秒统计：城镇、势力、关系、史册）', 'persist.ts（自动存档，gzip，记着生成世界用的设置；存档摘要、清空存档）', 'settings.ts（所有设置声明一次 → 网页表单；saves/settings.json）'], status: 'wip' },
    { id: 'ai', name: 'AI 席位', en: 'ai', color: '#facc15', deps: ['game', 'engine', 'shared'],
      role: '唤醒 → 拼装简报 → 调用模型（异步，不卡模拟）→ 逐行解析 → 命令总线；全程写日志。',
      dirs: ['src/ai/'], items: ['seat.ts（席位：唤醒、急事提前醒、日志）', 'briefing.ts（简报：只给事实和数字）', 'parser.ts（逐行解析，最多 12 行）', 'script.ts（脚本诸侯：稳健 / 霸道 / 纵横）', 'providers/openai.ts（OpenAI 兼容接口）'], status: 'wip' },
    { id: 'game', name: '玩法模块', en: 'game', color: '#4ade80', deps: ['engine', 'shared', 'content'],
      role: '每个玩法一个文件夹（world / economy / jobs / military …），通过模块契约向内核登记。',
      dirs: ['src/game/modules/', 'src/game/index.ts'], items: ['index.ts（模块清单：加模块 = 加一行）', 'modules/world', 'modules/economy', 'modules/population', 'modules/jobs', 'modules/military', 'modules/god'], status: 'wip' },
    { id: 'engine', name: '通用内核', en: 'engine', color: '#38bdf8', deps: ['shared'],
      role: '实体与组件、调度、事件、命令总线、模块注册、空间索引、寻路、存档框架、远近模拟、情报库。不知道"木头"是什么。',
      dirs: ['src/engine/'], items: ['ecs.ts', 'clock.ts', 'events.ts', 'scheduler.ts', 'motion.ts', 'brain.ts', 'spatial.ts', 'module.ts', 'registry.ts', 'sim.ts', 'commands/', 'path/（待做）', 'save.ts（待做）', 'intel.ts（待做）'], status: 'wip' },
    { id: 'shared', name: '基础', en: 'shared', color: '#a78bfa', deps: [],
      role: '类型、可重现随机数、数学、ID。谁都能用，它不依赖任何人。',
      dirs: ['src/shared/'], items: ['types.ts', 'rng.ts', 'noise.ts', 'math.ts', 'content.ts'], status: 'wip' },
    { id: 'content', name: '内容数据', en: 'content', color: '#94a3b8', deps: ['shared'], side: true,
      role: '纯数据，没有逻辑：职业、物品、建筑、地形。加一个职业通常只加一份数据。',
      dirs: ['content/'], items: ['terrain.ts', 'items.ts', 'professions.ts', 'factions.ts', 'buildings.ts', 'diplomacy.ts（条约、天灾）'], status: 'wip' },
  ],

  // ------------------------------------------------------------------ 模块契约
  contract: [
    { field: 'id', type: 'string', desc: '模块 ID，如 jobs' },
    { field: 'requires', type: 'string[]', desc: '依赖的模块；注册表据此排序，缺了直接报错' },
    { field: 'components', type: 'ComponentDef[]', desc: '新的数据列（组件）' },
    { field: 'systems', type: 'SystemDef[]', desc: '每节拍要跑的逻辑，声明阶段和频率' },
    { field: 'actions', type: 'ActionDef[]', desc: '改世界的规则（唯一入口），返回 { ok, reason }' },
    { field: 'orders', type: 'OrderDef[]', desc: '群体可接受的长期命令类型' },
    { field: 'behaviors', type: 'BehaviorDef[]', desc: 'NPC 能做的行为（fits / start / tick / coarse）' },
    { field: 'commands', type: 'CommandDef[]', desc: 'AI / 上帝 / 界面可用的命令（带参数格式和例子）' },
    { field: 'events', type: 'EventDef[]', desc: '会发出的事件（带可见范围）' },
    { field: 'briefing', type: 'BriefingSection[]', desc: '往 AI 简报里贡献的段落（优先级 + 长度预算）' },
    { field: 'wake', type: 'WakeRule[]', desc: '哪些事件会叫醒 AI' },
    { field: 'views', type: 'ViewChannel[]', desc: '往前端推的数据通道；前端有同名图层' },
    { field: 'content', type: 'ContentSchema[]', desc: '本模块认识的数据类型（如"职业"）' },
    { field: 'config', type: 'ConfigSchema', desc: '可调参数（默认值 + 校验）' },
    { field: 'save', type: 'SaveHandler', desc: '存档段 + 版本迁移' },
    { field: 'install', type: '(api) => void', desc: '兜底：订阅事件、查别的模块公开接口' },
  ],

  // ------------------------------------------------------------------ 节拍
  tick: {
    hz: 10,
    phases: [
      { id: 'commands', name: '收命令', text: '本拍之前到达的命令按顺序校验、执行（AI、上帝、界面、测试都一样）' },
      { id: 'input', name: 'input', text: '外部输入、上帝干预落地' },
      { id: 'ai_npc', name: 'ai_npc', text: 'NPC 空闲时按长期命令和职业挑行为' },
      { id: 'act', name: 'act', text: '行为调用动作：采集、投料、攻击……' },
      { id: 'move', name: 'move', text: '移动、寻路（每拍有计算预算）' },
      { id: 'resolve', name: 'resolve', text: '战斗结算、产出到账' },
      { id: 'economy', name: 'economy', text: '仓库、国库、物流' },
      { id: 'population', name: 'population', text: '吃饭、民心、增长、迁移（多为每游戏日一次）' },
      { id: 'post', name: 'post', text: '统计、史册' },
      { id: 'events', name: '派发事件', text: '本拍事件发给订阅者：史册、AI 唤醒、前端通知、其他模块' },
      { id: 'push', name: '推送', text: '按每个网页的视野推送变化' },
    ],
  },

  // ------------------------------------------------------------------ 模块
  modules: [
    { id: 'world', name: '世界', icon: '🗺️', requires: [], stage: 0, status: 'wip',
      summary: '两层地图：地区图（战略）+ 按需生成的 2 米格子区块；资源点、懒刷新、季节。',
      systems: ['区块加载/卸载', '资源懒刷新', '季节推进'], actions: ['harvestTile', 'till', 'sow', 'reap', 'alterTile'],
      events: ['season.changed', 'resource.depleted', 'region.discovered'],
      briefing: ['地区与资源'], views: ['terrain', 'resources', 'regions'],
      config: ['地图种子', '地图边长 10km', '刷新速率'], save: '种子 + 改动过的格子' },
    { id: 'economy', name: '经济', icon: '💰', requires: ['world'], stage: 1, status: 'wip', summary: '物品、仓库、国库、搬运。', components: ['Carry'], systems: ['库存账本'], actions: ['load', 'deposit', 'withdraw', 'transfer', 'convert'], events: ['stock.low'], briefing: ['国库'], views: ['stock'], content: ['items'], config: ['物品定义'], save: '各仓库库存' },
    { id: 'population', name: '人口与开局', icon: '👥', requires: ['world', 'economy'], stage: 1, status: 'wip', summary: '开局（从零开始：每个诸侯一座营地 + 按设置的物资和各职业人数；其余城址是空城址）、吃饭（城镇层面结算）、民心、增长（默认关）、迁移、名人。', components: ['Identity', 'Vitals', 'Notable'], systems: ['每日口粮', '民心', '人口增长', '迁移'], events: ['npc.born', 'npc.died', 'npc.migrated', 'settlement.starving', 'notable.defected', 'settlement.rebelled', 'faction.founded', 'faction.eliminated'], wake: ['settlement.starving', 'notable.defected'], briefing: ['城镇人口与民心'], views: ['settlements'], config: ['口粮', '迁移阈值', '开局物资（金 / 粮 / 木 / 石 / 铁 / 兵器）', '开局营地边的田块数', '开局各职业人数', '营地数量与人口上限', '开局名人', '自然出生率'], save: '城镇（含是否已建城）、名人', actions: [] },
    { id: 'jobs', name: '职业', icon: '🛠️', requires: ['world', 'economy', 'population'], stage: 1, status: 'wip',
      summary: '职业数据、工作行为、职业比例自动分配、锁定与转职、编组。',
      components: ['Profession'], orders: ['work', 'haul', 'idle'], actions: ['craft'],
      systems: ['比例分配', '转职'], events: ['npc.retrained'], briefing: ['劳力分配'], views: ['units'],
      content: ['professions'], config: ['转职耗时'], save: '比例设置、编组' },
    { id: 'building', name: '建造', icon: '🏗️', requires: ['world', 'economy', 'jobs', 'population'], stage: 1, status: 'wip', summary: '建筑与施工：诸侯只说造什么，建筑工自己搬料施工。', orders: ['build'], actions: ['placeSite', 'contribute', 'demolish'], events: ['building.done', 'building.destroyed'], briefing: ['工程'], views: ['buildings', 'sites'], content: ['buildings'], save: '建筑与工地' },
    { id: 'military', name: '军事', icon: '⚔️', requires: ['world', 'population', 'jobs', 'economy', 'diplomacy', 'building'], stage: 2, status: 'wip', summary: '编队、行军、围城、战斗（远处公式结算，观看时逐个模拟）。', components: ['Combat', 'Equipment'], orders: ['guard', 'patrol', 'move', 'attack', 'escort', 'scout'], systems: ['战斗结算', '围城', '补给'], actions: ['attack', 'capture', 'observe'], events: ['battle.started', 'battle.ended', 'settlement.besieged', 'settlement.captured', 'settlement.looted'], wake: ['settlement.besieged', 'battle.ended', 'settlement.captured'], briefing: ['军队', '敌情'], views: ['armies', 'battles', 'territory', 'intel'], save: '部队' },
    { id: 'diplomacy', name: '外交', icon: '🤝', requires: ['population', 'world', 'economy', 'jobs'], stage: 4, status: 'wip', summary: '私信、公开宣告、条约（不强制执行）、声望、送礼、贸易。', orders: ['trade'], actions: ['exchange'], events: ['message.received', 'treaty.proposed', 'treaty.signed', 'treaty.broken', 'treaty.expired', 'war.declared', 'war.ended'], wake: ['message.received', 'treaty.proposed', 'treaty.broken'], briefing: ['来信', '条约与声望'], save: '条约、声望、信件', views: ['relations', 'inbox'] },
    { id: 'chronicle', name: '史册', icon: '📜', requires: ['population'], stage: 4, status: 'wip', summary: '订阅所有事件，自动编年；按情报可见范围给各方看。', systems: ['记录事件'], briefing: ['近事'], views: ['chronicle', 'thoughts'], save: '史册', actions: [], events: [] },
    { id: 'god', name: '上帝', icon: '☁️', requires: ['world', 'economy', 'population', 'diplomacy', 'military', 'jobs'], stage: 5, status: 'wip', summary: '天灾、天降、冒名信、托梦、召唤流寇、时间倍率。诸侯只看得到后果。', events: ['god.intervened', 'disaster.struck'], views: ['god'], save: '干预记录', actions: [] },
  ],

  // ------------------------------------------------------------------ NPC 组件
  components: [
    { id: 'Identity', name: '身份', owner: 'population', base: true, status: 'done', fields: [['name', 'obj', '名字'], ['faction', 'u8', '势力'], ['home', 'u16', '所属城镇']] },
    { id: 'Transform', name: '位置', owner: 'engine', base: true, status: 'done', fields: [['x', 'f32', '米'], ['y', 'f32', '米'], ['region', 'u16', '所在地区']] },
    { id: 'Motion', name: '移动', owner: 'engine', base: true, status: 'done', fields: [['tx', 'f32', '目标点 x'], ['ty', 'f32', '目标点 y'], ['speed', 'f32', '米/秒'], ['moving', 'u8', '是否在走']] },
    { id: 'Vitals', name: '血量', owner: 'population', base: true, status: 'done', fields: [['hp', 'f32', '当前'], ['maxHp', 'f32', '上限'], ['hunger', 'f32', '饿了几天（吃饱了慢慢恢复；2 天起掉血）']] },
    { id: 'Carry', name: '携带', owner: 'economy', base: true, status: 'done', fields: [['item', 'u8', '物品（0 = 空手，否则 = 物品序号 + 1；只拿一种）'], ['qty', 'f32', '数量'], ['cap', 'f32', '上限']] },
    { id: 'Profession', name: '职业', owner: 'jobs', base: true, status: 'done', fields: [['prof', 'u8', '职业序号'], ['skill', 'u8', '熟练度（第 1 阶段起生效）'], ['locked', 'u8', '1 = 用「转」手动定的职业，比例不会动他']] },
    { id: 'Brain', name: '大脑', owner: 'engine', base: true, status: 'done', fields: [['beh', 'u8', '当前行为（0 = 空闲）'], ['step', 'u8', '行为进行到第几步'], ['timer', 'f32', '读条计时'], ['target', 'i32', '行为目标'], ['target2', 'i32', '第二个目标（如搬运的目的地）'], ['order', 'u32', '所属长期命令'], ['def', 'u32', '平时的长期命令（放了以后回到它）'], ['kit', 'u16', '行为表']] },
    { id: 'Membership', name: '编组', owner: 'engine', base: true, status: 'done', fields: [['group', 'u16', '所在队伍（0 = 无）'], ['pinned', 'u8', '是否锁定（直接派出去的人）']] },
    { id: 'Lod', name: '远近', owner: 'engine', base: true, status: 'done', fields: [['mode', 'u8', '0 细算 / 1 粗算（第 0 阶段全部细算）']] },
    { id: 'Combat', name: '战斗', owner: 'military', base: false, fields: [['attack', 'f32', '攻击'], ['defense', 'f32', '防御'], ['range', 'f32', '射程'], ['cd', 'f32', '下一次出手还要几秒']], status: 'done' },
    { id: 'Equipment', name: '装备', owner: 'military', base: false, fields: [['weapon', 'u8', '兵器等级'], ['armor', 'u8', '护甲等级']], status: 'done' },
    { id: 'Notable', name: '名人', owner: 'population', base: false, fields: [['traits', 'obj', '性格'], ['loyalty', 'f32', '忠诚'], ['ambition', 'f32', '野心']], status: 'done' },
  ],

  // ------------------------------------------------------------------ 长期命令
  orders: [
    { id: 'work', name: '干活', module: 'jobs', params: ['resource', 'place?'], text: '采集或生产某种资源', status: 'done' },
    { id: 'haul', name: '搬运', module: 'jobs', params: ['item?', 'from?', 'to?'], text: '在两座城之间运东西；不给参数 = 自动把粮从富余的城运到缺粮的城', status: 'done' },
    { id: 'build', name: '施工', module: 'building', params: ['place'], text: '去工地出工（平时：自家城里的工地）', status: 'done' },
    { id: 'guard', name: '驻守', module: 'military', params: ['place'], text: '守住某地（敌人靠近就打）', status: 'done' },
    { id: 'patrol', name: '巡逻', module: 'military', params: ['place'], text: '在区域里来回巡视', status: 'done' },
    { id: 'move', name: '行军', module: 'military', params: ['place'], text: '移动到某地并留在那里', status: 'done' },
    { id: 'attack', name: '进攻', module: 'military', params: ['target'], text: '开到目标处，见敌就打；守军打光就围城，围够时间就攻占', status: 'done' },
    { id: 'escort', name: '护送', module: 'military', params: ['targets'], text: '跟着被护送的人走，有敌人就打', status: 'done' },
    { id: 'scout', name: '侦察', module: 'military', params: ['place'], text: '去某地四处看（看到的城写进情报库）', status: 'done' },
    { id: 'trade', name: '贸易', module: 'diplomacy', params: ['faction?'], text: '带货去别的势力换金（不给对象 = 找最近的、没在打仗的）', status: 'done' },
    { id: 'idle', name: '待命', module: 'jobs', params: ['place?'], text: '原地待命', status: 'done' },
  ],

  // ------------------------------------------------------------------ 行为
  behaviors: [
    { id: 'gather', status: 'wip', acts: ['moveTo', 'harvestTile', 'load'], name: '采集', module: 'jobs', fits: ['work'], coarse: true, loop: ['走到资源点', '读条采集', '拿满'], text: '采木头、石头、铁矿：走到资源点 → 读条 → 拿满' },
    { id: 'farm', status: 'wip', acts: ['moveTo', 'harvestTile', 'load'], name: '耕种', module: 'jobs', fits: ['work'], coarse: true, loop: ['开垦', '播种', '收割'], text: '在城边的田里干活收粮（第 1 阶段加季节：春种秋收，冬天歇）' },
    { id: 'deliver', status: 'wip', acts: ['moveTo', 'deposit'], name: '送回', module: 'jobs', fits: [], support: true, coarse: true, loop: ['走回仓库', '卸货'], text: '辅助行为：拿满了送回最近的己方仓库' },
    { id: 'craft', status: 'wip', acts: ['moveTo', 'wait', 'convert'], name: '打造', module: 'jobs', fits: ['work'], coarse: true, loop: ['取料', '打造', '入库'], text: '在城里的铁匠铺把仓库里的铁和木头打成兵器（铁 1 + 木 2，8 秒一件；铁匠铺让速度翻倍）' },
    { id: 'haul', status: 'wip', acts: ['moveTo', 'withdraw', 'deposit'], name: '搬运', module: 'jobs', fits: ['haul'], coarse: true, loop: ['去取货', '运送', '卸货'], text: '去出发城的仓库取货 → 走到目的城 → 卸货。自动模式：把粮食从人均最多的己方城运到人均最少的' },
    { id: 'build', status: 'wip', acts: ['moveTo', 'wait'], name: '施工', module: 'building', fits: ['build'], coarse: true, loop: ['取木石', '走到工地', '投料施工'], text: '去工地干活（每次 5 秒，熟练度越高出活越多）；工地建成就生效' },
    { id: 'fight', status: 'wip', acts: ['moveTo', 'attack'], name: '交战', module: 'military', fits: [], coarse: true, loop: ['锁定敌人', '接近', '攻击'], text: '附近 70 米有敌人就冲上去打（优先打兵）；对方死了或跑远了就回去执行原来的命令', support: true },
    { id: 'guard', status: 'wip', acts: ['moveTo', 'wait'], name: '站岗', module: 'military', fits: ['guard'], coarse: true, loop: ['站位', '警戒'], text: '守在指定地点附近（城镇：城墙一圈）' },
    { id: 'patrol', status: 'wip', acts: ['moveTo', 'wait'], name: '巡逻', module: 'military', fits: ['patrol'], coarse: true, loop: ['走向巡逻点', '换下一个点'], text: '在区域里来回走' },
    { id: 'march', status: 'wip', acts: ['moveTo', 'wait'], name: '行军', module: 'military', fits: ['move', 'attack'], coarse: true, loop: ['沿地区图走', '到达'], text: '走到目的地留在那里；进攻时开进目标城' },
    { id: 'escort', status: 'wip', acts: ['moveTo', 'wait'], name: '护送', module: 'military', fits: ['escort'], coarse: true, loop: ['跟随目标', '护卫'], text: '跟在被护送的人身边（15 米内）；被护送的人都没了就回去' },
    { id: 'scout', status: 'wip', acts: ['moveTo', 'wait'], name: '探查', module: 'military', fits: ['scout'], coarse: true, loop: ['抵近观察', '回报情报'], text: '在区域里四处看（平时在自家周边 1.5 公里转）' },
    { id: 'trade', status: 'wip', acts: ['moveTo', 'withdraw', 'deposit', 'transfer'], name: '贸易', module: 'diplomacy', fits: ['trade'], coarse: true, loop: ['装货', '赶路', '交易', '回程'], text: '从自家仓库拿超出储备最多的货 → 走到对方城卸货 → 对方付金（通商 ×1.2，自家有市场 ×1.5）→ 回家' },
    { id: 'flee', status: 'wip', acts: ['moveTo'], name: '逃跑', module: 'jobs', fits: [], coarse: true, loop: ['察觉危险', '跑回城'], text: '附近有敌兵时丢下手里的活往最近的己方城跑（由军事模块的威胁检测触发）', support: true },
    { id: 'idle', status: 'wip', acts: ['moveTo', 'wait'], name: '闲着', module: 'jobs', fits: ['idle', '*'], coarse: true, loop: ['原地等待'], text: '没活可干时的兜底：在城里或待命地点附近溜达' },
  ],

  // ------------------------------------------------------------------ 职业
  professions: [
    { id: 'farmer', name: '农夫', short: '农', color: '#84cc16', tags: ['worker'], status: 'wip',
      stats: { speed: 1.0, carry: 10, hp: 100, attack: 2 }, behaviors: ['farm', 'deliver', 'flee', 'idle'],
      defaultOrder: 'work: 粮食', tools: { 锄头: 1.4 }, upkeep: { 粮: 1 }, train: { cost: { 粮: 3 }, days: 1 },
      text: '在城镇附近的田里春种秋收，是全国的饭碗。冬天田里不产粮。' },
    { id: 'woodcutter', name: '伐木工', short: '木', color: '#d97706', tags: ['worker'], status: 'wip',
      stats: { speed: 1.0, carry: 10, hp: 100, attack: 3 }, behaviors: ['gather', 'deliver', 'flee', 'idle'],
      defaultOrder: 'work: 木头', tools: { 斧头: 1.5 }, upkeep: { 粮: 1 }, train: { cost: { 粮: 3 }, days: 1 },
      text: '去林区砍树，背满了送回仓库。木头是建造和兵器的基础。' },
    { id: 'mason', name: '石匠', short: '石', color: '#94a3b8', tags: ['worker'], status: 'wip',
      stats: { speed: 0.9, carry: 8, hp: 110, attack: 3 }, behaviors: ['gather', 'deliver', 'flee', 'idle'],
      defaultOrder: 'work: 石头', tools: { 镐: 1.4 }, upkeep: { 粮: 1 }, train: { cost: { 粮: 3 }, days: 1 },
      text: '采石，供城墙和大建筑用。' },
    { id: 'miner', name: '矿工', short: '矿', color: '#64748b', tags: ['worker'], status: 'wip',
      stats: { speed: 0.9, carry: 8, hp: 110, attack: 3 }, behaviors: ['gather', 'deliver', 'flee', 'idle'],
      defaultOrder: 'work: 铁', tools: { 镐: 1.3 }, upkeep: { 粮: 1.5 }, train: { cost: { 粮: 4 }, days: 2 },
      text: '挖铁矿。没有铁就没有兵器，铁矿点是兵家必争之地。' },
    { id: 'builder', name: '建筑工', short: '建', color: '#f59e0b', tags: ['worker'], status: 'wip', stats: { speed: 1, carry: 10, hp: 100, attack: 2 }, behaviors: ['build', 'haul', 'flee', 'idle'], defaultOrder: 'build: 队列里下一个工地', tools: { '锤子': 1.5 }, upkeep: { '粮': 1 }, train: { cost: { '粮': 3 }, days: 1 }, text: '按诸侯的建造单从仓库取料去工地施工。' },
    { id: 'smith', name: '铁匠', short: '铁', color: '#ef4444', tags: ['worker'], status: 'wip', stats: { speed: 0.9, carry: 6, hp: 100, attack: 4 }, behaviors: ['craft', 'haul', 'idle'], defaultOrder: 'work: 兵器', tools: {}, upkeep: { '粮': 1 }, train: { cost: { '粮': 5 }, days: 3 }, text: '在铁匠铺把铁和木头打成兵器和工具。' },
    { id: 'porter', name: '搬运工', short: '运', color: '#14b8a6', tags: ['worker'], status: 'wip', stats: { speed: 1.1, carry: 20, hp: 100, attack: 2 }, behaviors: ['haul', 'deliver', 'flee', 'idle'], defaultOrder: 'idle', tools: {}, upkeep: { '粮': 1 }, train: { cost: { '粮': 2 }, days: 1 }, text: '在前哨和城镇之间运货。路上可能被劫。' },
    { id: 'soldier', name: '士兵', short: '兵', color: '#3b82f6', tags: ['military'], status: 'wip',
      stats: { speed: 1.1, carry: 5, hp: 150, attack: 12 }, behaviors: ['fight', 'guard', 'patrol', 'march', 'escort', 'idle'],
      defaultOrder: 'guard: 所属城镇', tools: { 兵器: 1.6 }, upkeep: { 粮: 1.5 }, train: { cost: { 粮: 5, 铁: 1 }, days: 2 },
      text: '驻守、巡逻、行军、攻城。吃得多，还要铁做兵器。' },
    { id: 'scout', name: '斥候', short: '斥', color: '#a855f7', tags: ['military'], status: 'wip',
      stats: { speed: 1.6, carry: 3, hp: 80, attack: 4 }, behaviors: ['scout', 'march', 'flee', 'idle'],
      defaultOrder: 'scout: 所属城镇周边', tools: {}, upkeep: { 粮: 1 }, train: { cost: { 粮: 4 }, days: 2 },
      text: '跑得快。去别人地盘看兵力和粮草，写进己方情报库。' },
    { id: 'merchant', name: '商人', short: '商', color: '#eab308', tags: ['worker'], status: 'wip', stats: { speed: 1, carry: 30, hp: 90, attack: 2 }, behaviors: ['trade', 'haul', 'flee', 'idle'], defaultOrder: 'idle', tools: {}, upkeep: { '粮': 1 }, train: { cost: { '粮': 4, '金': 20 }, days: 2 }, text: '带货去别的势力换东西。商路也是情报和冲突的来源。' },
  ],

  // ------------------------------------------------------------------ 选择器
  selectors: [
    { syntax: '@木 / @伐木工', meaning: '我所有的伐木工（职业简称或全称）' },
    { syntax: '@木@青石城', meaning: '青石城的伐木工' },
    { syntax: '@木:5', meaning: '5 个伐木工（优先空闲的、离得近的）' },
    { syntax: '@农:30%', meaning: '三成农夫' },
    { syntax: '@worker', meaning: '按标签选：所有干活的（worker / military）' },
    { syntax: '#一队', meaning: '已编好的队伍' },
    { syntax: '阿三', meaning: '指定某个人' },
    { syntax: '@木,@石', meaning: '多选：伐木工和石匠' },
    { syntax: '*@河口镇', meaning: '河口镇所有人' },
  ],

  // ------------------------------------------------------------------ 命令
  // args 类型：sel 选择器 · town 己方城镇 · place 地点 · target 势力.城镇/地区 · work 活 ·
  //           prof 职业 · item 物品 · building 建筑 · group 队名 · faction 势力 · notable 名人 ·
  //           int 整数 · amount 数量（粮200/300金） · duration 时长（30天） · treaty 条约 ·
  //           disaster 天灾 · quota 职业比例（余下全部） · text 文字（余下全部）
  // 参数名后面带 ? 表示可省略
  commands: [
    { id: 'quota', verb: '比例', module: 'jobs', who: ['lord'], args: [['城镇', 'town'], ['比例', 'quota']], help: '设城镇的职业比例（%），每天自动转职靠拢；新生儿也按它分', examples: ['比例 青石城 农50 木20 石10 兵20'], status: 'done' },
    { id: 'assign', verb: '派', module: 'jobs', who: ['lord', 'god'], order: 'work', args: [['人', 'sel'], ['活', 'work'], ['地点?', 'place']],
      help: '把一批人派去干某种活；派出去的人会锁定，直到"放"', examples: ['派 @木:5 伐木 北林', '派 @农@河口镇 种田'], status: 'done' },
    { id: 'haul', verb: '运', module: 'jobs', who: ['lord'], order: 'haul', args: [['人', 'sel'], ['物品', 'item'], ['从', 'place'], ['到', 'place']], help: '派人在两座己方城之间运东西（来回跑，直到放）', examples: ['运 @运:4 粮食 青石城 河口镇'], status: 'done' },
    { id: 'release', verb: '放', module: 'jobs', who: ['lord'], args: [['人', 'sel']],
      help: '解除锁定，还给职业比例自动分配', examples: ['放 @木@北林'], status: 'done' },
    { id: 'retrain', verb: '转', module: 'jobs', who: ['lord'], args: [['人', 'sel'], ['职业', 'prof']], help: '让一批人改行（付培训费），之后比例不会再动他们', examples: ['转 @农:10 兵'], status: 'done' },
    { id: 'group', verb: '编', module: 'jobs', who: ['lord'], args: [['人', 'sel'], ['队名', 'group']],
      help: '把一批人编成队伍，之后用 #队名 指挥', examples: ['编 @兵@青石城:20 一队'], status: 'done' },
    { id: 'build', verb: '建', module: 'building', who: ['lord'], order: 'build', args: [['建筑', 'building'], ['地点', 'place'], ['人?', 'sel']], help: '立工地（马上扣材料），建筑工会去施工；给了人就派他们专门去', examples: ['建 兵营 青石城', '建 城墙 青石城 @建:6', '建 伐木场 北林'], status: 'done' },
    { id: 'demolish', verb: '拆', module: 'building', who: ['lord'], args: [['建筑', 'building'], ['地点', 'place']], help: '拆掉一座建筑（退一半材料）；没建完的工地退全部材料', examples: ['拆 伐木场 北林'], status: 'done' },
    { id: 'attack', verb: '攻', module: 'military', who: ['lord'], order: 'attack', args: [['人', 'sel'], ['目标', 'target']], help: '进攻城镇或地区；对方没在交战就自动宣战（有条约会撕毁，掉声望）', examples: ['攻 #一队 赤焰.落霞镇', '攻 @兵:30 赤焰城'], status: 'done' },
    { id: 'guard', verb: '守', module: 'military', who: ['lord'], order: 'guard', args: [['人', 'sel'], ['地点', 'place']],
      help: '驻守某地', examples: ['守 #二队 青石城'], status: 'done' },
    { id: 'patrol', verb: '巡', module: 'military', who: ['lord'], order: 'patrol', args: [['人', 'sel'], ['区域', 'place']],
      help: '在区域里巡逻', examples: ['巡 @兵:6 北林'], status: 'done' },
    { id: 'retreat', verb: '撤', module: 'military', who: ['lord'], order: 'move', args: [['人', 'sel'], ['地点?', 'place']],
      help: '撤回（不写地点就回所属城镇）', examples: ['撤 #一队'], status: 'done' },
    { id: 'scout', verb: '探', module: 'military', who: ['lord'], order: 'scout', args: [['人', 'sel'], ['区域', 'place']], help: '侦察某地，看到的城写进情报库', examples: ['探 @斥:2 东山'], status: 'done' },
    { id: 'escort', verb: '护', module: 'military', who: ['lord'], order: 'escort', args: [['人', 'sel'], ['对象', 'sel']], help: '派兵护送一批人（商队、运粮队）', examples: ['护 #三队 #商队'], status: 'done' },
    { id: 'trade', verb: '商', module: 'diplomacy', who: ['lord'], order: 'trade', args: [['人', 'sel'], ['对方', 'faction']], help: '派商人去某个势力做买卖（打起来就自动回家）', examples: ['商 @商:3 白鹿', '商 #商队 白鹿'], status: 'done' },
    { id: 'tax', verb: '税', module: 'population', who: ['lord'], args: [['城镇', 'town'], ['税率', 'int']], help: '设税率（%）。税高民心降', examples: ['税 青石城 15'], status: 'done' },
    { id: 'granary', verb: '开仓', module: 'population', who: ['lord'], args: [['城镇', 'town'], ['粮', 'int']], help: '开仓放粮，提升民心', examples: ['开仓 河口镇 200'], status: 'done' },
    { id: 'recruit', verb: '招', module: 'population', who: ['lord'], args: [['名人', 'notable'], ['出价', 'amount']], help: '招揽或策反名人', examples: ['招 李将军 300金'], status: 'done' },
    { id: 'letter', verb: '信', module: 'diplomacy', who: ['lord'], args: [['对方', 'faction'], ['内容', 'text']], help: '写私信（只有对方看得到）', examples: ['信 白鹿 愿与贵国共讨赤焰'], status: 'done' },
    { id: 'propose', verb: '约', module: 'diplomacy', who: ['lord'], args: [['对方', 'faction'], ['条约', 'treaty'], ['时长?', 'duration']], help: '提议签约，对方用「应」答应才生效；和交战的对手签互不侵犯 = 停战', examples: ['约 赤焰 互不侵犯 30天', '约 白鹿 通商'], status: 'done' },
    { id: 'accept', verb: '应', module: 'diplomacy', who: ['lord'], args: [['对方', 'faction']], help: '答应对方最近的一份提议', examples: ['应 赤焰'], status: 'done' },
    { id: 'break', verb: '撕', module: 'diplomacy', who: ['lord'], args: [['对方', 'faction'], ['条约', 'treaty']], help: '撕毁条约（声望下降，天下皆知）', examples: ['撕 赤焰 互不侵犯'], status: 'done' },
    { id: 'gift', verb: '赠', module: 'diplomacy', who: ['lord'], args: [['对方', 'faction'], ['东西', 'amount']], help: '从都城送东西给对方都城（关系变好）', examples: ['赠 白鹿 粮200'], status: 'done' },
    { id: 'think', verb: '想', module: 'chronicle', who: ['lord'], args: [['内容', 'text']], help: '写下心里话（只有上帝看得到，不影响世界）', examples: ['想 青龙兵强，先稳住，联白鹿夹击赤焰'], status: 'done' },
    { id: 'disaster', verb: '灾', module: 'god', who: ['god'], args: [['天灾', 'disaster'], ['地点', 'place'], ['时长?', 'duration']], help: '降天灾：旱（田和树不长）、涝（田毁一半）、疫（人掉血）、蝗（粮仓少三成）', examples: ['灾 旱 北林 10天', '灾 疫 河口镇 5天'], status: 'done' },
    { id: 'bless', verb: '赐', module: 'god', who: ['god'], args: [['对方', 'anyFaction'], ['东西', 'amount']], help: '天降物资到某势力都城', examples: ['赐 白鹿 铁100'], status: 'done' },
    { id: 'forge', verb: '冒名', module: 'god', who: ['god'], args: [['冒充谁', 'anyFaction'], ['发给谁', 'anyFaction'], ['内容', 'text']], help: '冒充一个势力给另一个写信（收信人以为是真的）', examples: ['冒名 赤焰 白鹿 我军三日后借道'], status: 'done' },
    { id: 'dream', verb: '托梦', module: 'god', who: ['god'], args: [['对方', 'anyFaction'], ['内容', 'text']], help: '给某个诸侯托梦', examples: ['托梦 白鹿 东方有变'], status: 'done' },
    { id: 'bandits', verb: '寇', module: 'god', who: ['god'], args: [['地点', 'place'], ['人数', 'int']], help: '在某地召唤一股流寇（会去劫掠最近的城）', examples: ['寇 东山 50'], status: 'done' },
    { id: 'speed', verb: '时速', module: 'god', who: ['god'], args: [['倍率', 'int']],
      help: '时间倍率（0 = 暂停）', examples: ['时速 4'], status: 'done' },
    { id: 'announce', verb: '告', module: 'diplomacy', who: ['lord'], args: [['内容', 'text']], help: '昭告天下（所有势力都收到，记进史册）', examples: ['告 赤焰无道，天下共讨之'], status: 'done' },
  ],

  // 命令试验台用的示例世界（只用来校验名字，不是真实存档）
  sampleWorld: {
    me: '青龙',
    factions: ['青龙', '赤焰', '白鹿', '玄武', '金乌', '苍狼'],
    towns: { 青龙: ['青石城', '河口镇'], 赤焰: ['赤焰城', '落霞镇'], 白鹿: ['鹿鸣城', '松溪镇'], 玄武: ['北冥城', '寒水镇'], 金乌: ['金乌城', '沙洲镇'], 苍狼: ['狼牙城', '风口镇'] },
    myTowns: ['青石城', '河口镇'],
    places: ['青石城', '河口镇', '北林', '东山', '南湖', '西岭', '赤焰城', '落霞镇', '鹿鸣城', '松溪镇', '北冥城', '寒水镇', '金乌城', '沙洲镇', '狼牙城', '风口镇'],
    groups: ['一队', '二队', '三队', '商队'],
    people: ['阿三', '阿四', '老王'],
    notables: ['李将军', '张谋士'],
    items: ['粮', '粮食', '木头', '石头', '铁', '金', '兵器', '工具'],
    works: { 伐木: 'woodcutter', 采石: 'mason', 挖矿: 'miner', 种田: 'farmer', 打铁: 'smith' },
    buildings: ['房屋', '农田', '伐木场', '采石场', '矿场', '仓库', '兵营', '铁匠铺', '市场', '城墙', '道路'],
    treaties: ['结盟', '互不侵犯', '朝贡', '通商', '借道'],
    disasters: ['旱', '涝', '疫', '蝗'],
  },

  // ------------------------------------------------------------------ 扩展指南
  recipes: [
    { id: 'profession', title: '加一个职业', steps: ['在 content/professions/ 加一份数据（属性、行为、默认命令、口粮、转职）', '跑 npm run atlas，图谱里自动出现'], note: '只有全新种类的活才需要写新行为。' },
    { id: 'item', title: '加一种建筑 / 物品', steps: ['在 content/buildings/ 或 content/items/ 加数据', '有特殊效果的话，在相关模块加一个系统'] },
    { id: 'command', title: '加一条命令', steps: ['在相关模块的 commands 里加一个 CommandDef（动词、参数、说明、例子）', '解析器、AI 命令表、上帝面板按钮、文档、契约测试自动跟上'] },
    { id: 'behavior', title: '加一种活 / 行为', steps: ['在相关模块加一个 BehaviorDef（fits / start / tick / coarse）', '在职业数据的 behaviors 里写上它的 ID'] },
    { id: 'briefing', title: 'AI 简报里多看一样东西', steps: ['在模块里加一个 BriefingSection（优先级 + 长度预算）'] },
    { id: 'module', title: '加一个全新玩法（比如"宗教"）', steps: ['npm run new:module religion 生成模板', '组件 → 系统 → 动作 → 命令 → 事件 → 简报 → 存档 → 配置', '前端加同名图层（如有画面）', '写测试', '在 src/game/index.ts 加一行'], note: '核心文件一个都不用改。' },
  ],

  // ------------------------------------------------------------------ 测试与守门
  gates: [
    { name: '模块单元测试', text: '选择器、模块注册、命令总线、事件、空间索引（已接入：tests/engine.test.ts）' },
    { name: '命令契约测试', text: '每条命令的每个例子都能真正执行成功（已接入：tests/game.test.ts）' },
    { name: '可重现测试', text: '同种子 + 同命令，状态哈希一致（已接入：tests/game.test.ts）' },
    { name: '分层测试', text: '不许向上依赖、不许绕过模块公开接口、模拟代码不读真实时钟（已接入：tests/arch.test.ts）' },
    { name: '图谱对照', text: '代码实现了的，图谱必须一致；图谱标了已实现的，代码必须有（已接入：tests/atlas-sync.test.ts）' },
    { name: '协议测试', text: '消息编码再解码一致（已接入：tests/protocol.test.ts）' },
    { name: '设置测试', text: '默认 < 文件 < 环境变量、范围检查、密钥打码、模块配置自动进面板（已接入：tests/settings.test.ts）' },
    { name: '开始界面测试', text: '没开局时网关只发 lobby、存档摘要、清空存档删得干净且不动设置（已接入：tests/lobby.test.ts）' },
    { name: '压测预算', text: '10km 地图 + 2000 NPC，每节拍 < 5ms，超了就失败（已接入：tests/perf.test.ts）' },
    { name: '浏览器冒烟', text: '真浏览器打开游戏和图谱，点一遍（已接入：npm run smoke / atlas:smoke）' },
    { name: '存档测试', text: '存了再读进新世界，哈希一致，之后各跑一段（带 AI）仍一致（已接入：tests/phases.test.ts）' },
    { name: '脚本 AI 长跑', text: '脚本诸侯无人值守跑 60 天不崩、七成以上命令能执行（已接入：tests/phases.test.ts）' },
    { name: '玩法规则测试', text: '断粮、生育上限、比例转职、运输、打造、建造、条约、背约、攻城、起义、叛将、天灾、冒名信、简报不带指令词（已接入：tests/phases.test.ts）' },
    { name: '图谱校验', text: '本页面的数据引用完整、命令例子都能解析（已接入：npm run atlas）' },
  ],

  // ------------------------------------------------------------------ 路线图
  roadmap: [
    { stage: 0, name: '地基', status: 'done', text: '骨架、测试运行器、固定节拍、地图生成、镜头缩放、色块渲染、压测（实测 2000 人每拍约 0.3 ms）', goal: '10km 大陆上 2000 个色块小人干活不卡' },
    { stage: 1, name: '经济', status: 'done', text: '城镇、职业与工作循环、建筑、资源刷新、季节、吃饭与迁移、远处粗算', goal: '几座城自己运转，冬天会饿' },
    { stage: 2, name: '军事领土', status: 'done', text: '征兵、部队、行军、围城、战斗结算、领地', goal: '脚本诸侯会打仗、换城' },
    { stage: 3, name: 'AI 诸侯', status: 'done', text: '简报、命令、唤醒、模型接入、脚本 AI、日志', goal: '大模型诸侯自己经营和开战（关键验收点）' },
    { stage: 4, name: '外交信息', status: 'done', text: '私信、宣告、条约、史册、声望、迷雾、名人、贸易', goal: '结盟、背叛、撒谎' },
    { stage: 5, name: '上帝模式', status: 'done', text: '干预工具、心里话面板、关系图、时间控制', goal: '你能看戏和搅局' },
    { stage: 6, name: '无尽演化', status: 'wip', text: '起义、叛将自立、席位交接、存读档、长跑平衡', goal: '世界一直跑下去' },
  ],

  // ------------------------------------------------------------------ 待定
  decisions: [
    { q: '命令用中文动词还是英文？', proposal: '中文（内部 ID 英文）', status: 'decided' },
    { q: '选择器符号 @职业 #队伍 :数量 :30% 可以吗？', proposal: '如上', status: 'decided' },
    { q: '"比例 + 直接派会锁定"双模式可以吗？', proposal: '可以', status: 'decided' },
    { q: 'AI 席位数', proposal: '6 位诸侯（第 0 阶段已按 6 个生成）', status: 'decided' },
    { q: '战斗观赏度', proposal: '第一版公式结算 + 简单动画', status: 'decided' },
    { q: '时间节奏：1 天 ≈ 10 秒？', proposal: '是，可调', status: 'decided' },
    { q: '游戏名', proposal: '暂名"诸侯争霸"', status: 'decided' },
    { q: '新仓库 AGENTS.md 协作约定', proposal: '沿用旧仓库规矩并改写（AGENTS.md）', status: 'decided' },
    { q: '技术栈', proposal: 'TypeScript：网页画面 + 后端模拟', status: 'decided' },
    { q: '模型接入', proposal: '后端直接调用 OpenAI 兼容接口 + 脚本 AI', status: 'decided' },
    { q: '要不要给 AI 诸侯私下的动机（秘密目标）？', proposal: '先不给；简报只给事实和数字，性格只在脚本诸侯里用', status: 'open' },
    { q: '行军速度：基础 8 米/秒（每天约 80 米，跨城要 20 天左右）', proposal: '先这样，嫌慢用「时速」加速', status: 'open' },
  ],
};
