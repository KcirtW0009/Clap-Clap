# Clap-Clap 项目现状全景（供外部 AI 沟通用）

> 最后更新：2026-08-24 · 对应规则版本 **V3.1**（见 [GAME_SPEC.md](GAME_SPEC.md)）· 联机系统 **V5.0 房间制**（server/game-room.js）
>
> 用途：给外部 AI（或新协作者）一次性建立完整认知。阅读顺序建议：本文 §1–§3 → GAME_SPEC.md → 本文 §5–§7。
> 所有行号以当前代码为准，大改动后请重新核对。

---

## 1. 项目一句话

童年"拍手游戏"（蓄-攻-防）的全面升级版：**五行元素回合制对战**。支持单机 vs 加权随机 AI，以及 **2–9 人房间制联机对战（含观战、断线重连）**；每回合三选一（接取元素 / 使用元素技能 / 防御），动作全员提交后同步结算。

## 2. 技术栈与运行方式

- 纯 HTML + CSS + 原生 JavaScript 前端，**无构建步骤、无框架**。
- 联机：Node + Express（静态托管）+ Colyseus 0.15（WebSocket 房间），依赖见 package.json。
- 单机玩法：直接用浏览器打开 `index.html`。
- 联机玩法：`npm start` 后打开 `http://localhost:2567/online.html`。
- 引擎测试：`npm test`（即 `node engine.test.js`），当前 **94 项通过 / 11 项跳过**（跳过项为已废弃旧"气"系统的占位用例）。测试文件自带迷你测试框架（describe/it/assert + vm 沙箱加载 engine.js/ai.js），不依赖任何测试库。
- 联机集成测试：`npm run server:test`（编排脚本自动以不同环境变量拉起服务器，依次跑 smoke / room / timeout / reconnect 四组场景）。

## 3. 目录结构与文件地图

```
Clap-Clap/
├── index.html            单机页面骨架：双方面板、按钮、弹层菜单、战报区、结算弹窗
├── style.css             全部样式与动画特效（~1300 行，单机/联机共用设计系统）
├── main.js               单机 DOM 表现层：菜单交互、动画调度、状态渲染（636 行）
├── engine.js             游戏引擎 GameEngine：纯数据进出，零 DOM 依赖（782 行）
├── ai.js                 AI 决策：7 种行为模式加权随机（232 行）
├── engine.test.js        单元测试（987 行，含迷你框架）
├── vendor/colyseus.js    浏览器端 Colyseus 客户端（复制自 node_modules，全局名 Colyseus）
├── online.html           联机页面骨架：大厅 / 等待室 / 对战三屏
├── online.css            联机专属样式（多人 arena 格子布局、等待室、观战席等）
├── online.js             联机表现层：镜像引擎校验、目标选择、按座位泛化的特效、重连
├── server.js             联机服务器入口：express 静态托管 + Colyseus 挂载（define 'clash'）
├── server/game-room.js   'clash' 房间逻辑 V5.0（2–9 人、观战席、断线保座、超时判负）
├── server/smoke-test.js        集成测试：完整对局流程
├── server/room-test.js         集成测试：房间制/观战/加特林链路/对局中转观战
├── server/timeout-test.js      集成测试：操作超时判负
├── server/reconnect-test.js    集成测试：断线保座重连
├── server/run-all-tests.js     测试编排（npm run server:test）
├── package.json          scripts 与依赖
└── docs/
    ├── GAME_SPEC.md      ★ 现行规则规范 V3.1（唯一权威规则文档）
    ├── STATUS.md         ★ 本文档
    └── archive/          历史版 Spec（V1.0/V2.0/V3.0），仅沿革参考
```

### 关键代码定位

| 文件:行号 | 内容 |
|:---|:---|
| `engine.js:46` | `ROUTES` 五系全部路线定义（名称+成本类型） |
| `engine.js:84` | `makePlayer()` 玩家对象模板（hp/maxHp/elements/weapons/status） |
| `engine.js:105` | `normalizeAction()` 动作归一化 |
| `engine.js:221` | `_resolveTargets()` 目标解析与多人分流校验（双枪/火球雨特例） |
| `engine.js:252` | `isActionFeasible()` 动作可行性总闸（**束缚不可叠加检查在此**） |
| `engine.js:294` | `getAvailableRoutes()` 供 UI 菜单过滤 |
| `engine.js:331` | `resolveActions()` **整个回合结算管线**（见 §4） |
| `engine.js:601` | `_resolveUse()` 全部 23 条路线的执行分支 |
| `ai.js:19` | `canUse()` AI 侧资源校验（与引擎同步束缚目标免疫） |
| `ai.js:66` | `boundAction()` 束缚中的三选一决策 |
| `ai.js:83` | `behaviorConfig()` 七种行为模式的权重表 |
| `ai.js:165` | `chooseAIAction()` 主入口 |
| `main.js:121` | `openUsePanel()` 使用面板（**含被束缚时的金之斩/复读过滤**） |
| `main.js:199` | `commitAction()` 提交玩家动作并触发 AI |
| `main.js:618` | `renderControls()` 按钮可用性总控 |
| `server/game-room.js` | 联机房间核心：onJoin 座位分配/观战、startGame/backToLobby、submit 结算、超时判负（eliminateAndResolve）、断线 allowReconnection(600s)、roomInfo/metadata 广播 |
| `online.js` | 联机前端：bindRoom 消息接线、镜像 GameEngine 做可行性/目标校验、commit() 提交、playRoundFx 按座位泛化特效、client.reconnect 重连 |

## 3.1 联机消息协议速查

- 客户端 → 服务端：`submit {action}`（归一化动作）；`start`（仅房主，大厅≥2人）；`rematch`（仅房主，ended 后）。
- 服务端 → 客户端：`welcome {role,seat,isHost}`；`roomInfo {players,spectators,maxPlayers,phase,round,hostSessionId}`；`started/sync`（全量快照）；`report {...引擎report, round, names}`；`intermission {seconds}`；`turnDeadline {seconds}`；`ended {text, canRematch}`；`system {text}`。
- 加入方式：`create({maxPlayers})` / `joinById(roomId)` 入座 / `joinById(roomId,{spectate:true})` 观战；对局中入座请求自动转观战。

## 4. 引擎结算管线（resolveActions 内部顺序）

这是全项目最核心的一段代码，改动任何技能都必须对照此顺序：

```
① 回合开始   岩脉共鸣自动凝聚岩壳
② 合法性校验 束缚三选一检查 → 可行性检查 → 违规者强制改防御(forcedChanges)
③ 使用结算   _resolveUse 扣资源、生成伤害/状态事件；金之斩在此即时解绑束缚
④ 接取结算   +1 元素（不会被伤害打断）
⑤ 伤害管线   逐事件：AP击碎木墙(伤+1) → 荆棘岩免疫 → 防御归零 → 木墙归零+反弹登记
             → 岩壳逐层吸收 → 结算 hpDelta；事件附带灼烧/种子附加、冲刷销毁
⑥ 木墙反弹   每攻击者每回合 1 次
⑦ 荆棘岩反击 每攻击者 2 伤（有岩壳 3 伤耗 1 层），无视防御
⑧ 共鸣反震   防御且被攻击过 → 每攻击者 1 伤，无视防御
⑨ 防御驱散   灼烧/种子/水渍
⑩ 灼烧 tick  未防御 -1（无视防御）
⑪ 水渍爆发   未防御 -1（穿透）
⑫ 种子偷取   未防御 → 随机 1 元素转移给施术者
⑬ 受击解绑   本回合开始时已束缚 && 真实掉血>0 → 藤蔓断裂
⑭ 束缚递减   bindTurns > 0 者 -1
⑮ 记录 lastAction（被迫防御也会覆写为防御）
⑯ HP 钳制 [0, maxHp]，输出 report
```

> "真实掉血"（lossTaken）：⑤⑦⑧⑩⑪ 中实际扣到的血都计入，是受击解绑的判定依据；被防御归零的伤害不算。

## 5. 已实现 / 未实现清单

### ✅ 已完整实现

| 模块 | 说明 |
|:---|:---|
| 五系全部 23 条路线 | 金 7 / 木 4 / 火 4 / 水 4 / 土 4，效果与 GAME_SPEC V3.1 完全一致 |
| 状态系统 | 束缚（V3.1 三选一+不可叠加）、灼烧、种子寄生、水渍 |
| 防御体系 | 防御完全免疫非穿防；荆棘之墙/岩壳/荆棘岩/岩脉共鸣四层防护与三种反弹 |
| 半点 HP | 初始 3，生命之泉可成长 maxHp 至 5.0，UI 半心渲染 |
| 多人引擎层 | GameEngine(N) 2–9 人、targets 分流校验、最后存活者胜（仅引擎+测试覆盖） |
| 联机房间制 V5.0 | 2–9 人同局 + 10 人观战席；房主开局/再战；对局中加入自动转观战；断线保座重连（600s）、主动退出判负、超时未出招判负；房间列表元数据 |
| 联机 UI | online.html/js/css：大厅（创建/房间号/列表/观战勾选/一键重连）、等待室席位、对战屏复用单机设计系统（面板由 JS 按 N 生成，双人保留 stage 对峙布局）、目标选择三模式（单体/双枪/火球雨）、加特林数量面板、战报+战斗日志、倒计时 chip、按座位泛化的全套特效 |
| AI 七模式 | 金匠/木控/火爆/水谋/磐石/均衡/防守，斩杀优先、束缚中决策、合法性与引擎同步 |
| UI/动效 | 每招式独立特效、心形血量、元素块、武器/状态芯片、分类着色战报、胜负弹窗 |
| 束缚 UI | 使用面板只列金之斩+上回合路线；接取面板仅开放上回合同元素；加特林复读自动按原量提交 |

### ❌ 未实现（按旧 Spec 或设计备忘遗留）

| 项目 | 来源 | 备注 |
|:---|:---|:---|
| 单机版多人（vs 多 AI 同屏） | SPEC_000 §7 | 已由联机房间制替代落地；index.html/main.js 仍是 1v1+AI |
| 多人 AI 视角 | SPEC_000 §11 | ai.js 默认目标=第一个存活其他玩家，无威胁评估 |
| jsdom UI 冒烟测试 | SPEC_000 §12 | 文档提到但仓库从未包含该测试与依赖 |
| 天地灵气上限（公共库存） | SPEC_001 §11 | 设计种子，明确"暂不实现" |
| 存档、音效、移动端适配 | — | 从未排期 |

## 6. 平衡性决策记录（讨论基线，勿凭空推翻）

按时间序，均为实测反馈后的定稿：

1. **防御 = 完全免疫非穿防伤害**（V3.0，设计者拍板）：取代旧的"-1 减伤"。烈焰爆发 3 伤 vs 防 = 0 是唯一被削的既有结算。
2. **HP 半点制**：伤害恒整数，仅泉水满血升级产生 +0.5。
3. **束缚·受击解绑（严格版）**：真实掉血才解绑；防为 0 不算。
4. **束缚·金之斩双职**：1 金可挣脱并反打 1 伤；无金则无法主动解。
5. **束缚·不可叠加（V3.1，本日修订）**：起因——木控 AI 以 1 木/回合成木链锁，`bindTurns = 2` 的赋值语义使重复施放不断重置时长，形成伪永久控制且 0 金目标彻底无解。修订后单次束缚最多锁 2 整回合 + 至少 1 回合真空期；对已束缚目标施放判为不可行、不耗木。持续时长保持 2 回合（设计者确认）。
6. **穿甲射击 = 1 伤穿防**（实现口径）：命中荆棘之墙时击碎并升为 2 伤。注意 archive/GAME_SPEC_001 里写的"2 伤/+2 枚"是未采用的早期数值，勿引用。

## 7. 已知问题与技术债

| # | 问题 | 影响 | 候选修法 |
|:---|:---|:---|:---|
| 1 | 战报分类着色靠关键词匹配（`reportLineClass`，main.js:499） | 新文案措辞变化会导致颜色错类 | 让 report 输出结构化 line 类型字段 |
| 2 | AI 无记忆、无对手建模 | 木控等模式行为呆板、可被针对 | 加简单状态机或 1 层前瞻 |
| 3 | `sameTargets` 复读判定要求 targets 完全一致 | 多人局复读约束过严；联机束缚复读按原目标提交，目标可能已出局（引擎会强制改防御兜底） | 复读时可重选存活目标 |
| 4 | 测试输出中文在 Windows 控制台乱码 | 仅观感问题 | node 输出前设 UTF-8 |
| 5 | main.js 全局可变状态（selections/resolving/aiTimer） | 加多人/UI 重构时会纠缠 | 迁移到单一 state 对象 |
| 6 | index.html 双份玩家面板靠复制粘贴 | 改布局要改两处 | JS 生成面板 |

## 8. 给外部 AI 的"下一步"议题菜单

以下任一条都可以直接作为下一步开发议题（A 已于联机 V5.0 落地，保留作背景）：

- ~~**A. 多人对战 UI**~~ → 已完成：单机保持 1v1+AI；多人走联机房间制（online.html/js + server/game-room.js）。
- **B. AI 强化**：行为模式已有权重框架，可加：对手状态感知（对方有墙时不打、对方残血优先斩杀已部分实现）、束缚连招规划、针对玩家行为的反制权重。
- **C. 平衡数据驱动**：加一个 headless 模拟器脚本（复用 engine.js + ai.js 跑 N 千局自动对战），统计各行为模式胜率/各路线出场率，产出平衡报告再调权重。
- **D. 新内容**：新元素路线（如金"反击架势"、火"自燃献祭"）、第六元素、或启用天地灵气库存设计（archive/GAME_SPEC_001 §11）。
- **E. 工程化**：引入 ESLint、拆分 CSS、把测试迁移到 node:test、补 jsdom 冒烟测试。
- **F. 表现打磨**：战报结构化（解决技术债 #1）、音效、移动端布局。
- **G. 联机增强**：私密房间密码、观战聊天、断线 AI 代打、战绩统计、房间列表按状态筛选。

## 9. 与外部 AI 沟通的注意事项

1. 规则以 `docs/GAME_SPEC.md` 为唯一现行版本；archive/ 里与现行的差异点已在 STATUS §6 第 6 条标明（尤其穿甲弹数值）。
2. 讨论强度问题时先看 §4 管线顺序——很多"感觉不对"的结算其实是顺序理解偏差（例如接取不被打断、反弹在双方行动后统一处理、束缚递减发生在回合末）。
3. 引擎是纯函数式的数据进出（输入动作数组 → 输出 report），任何新规则先在 engine.test.js 加用例再改实现，UI 自动跟随 `isActionFeasible`/`getAvailableRoutes`。
