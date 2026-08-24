# Clap-Clap 五行拍手对战

童年"拍手游戏"升级版：**金·木·水·火·土**五行元素回合制对战（玩家 vs 加权随机 AI）。纯 HTML/CSS/JS，无构建步骤。

## 快速开始

- **单机游玩**：浏览器直接打开 `index.html`
- **联机对战**：`npm start` 启动服务器（端口 2567），浏览器打开 `http://localhost:2567/online.html`
- **引擎测试**：`npm test`（94 项通过 / 11 项跳过）
- **联机集成测试**：`npm run server:test`（自动拉起服务器，跑完 4 组冒烟场景：完整对局 / 房间制·观战·加特林链路 / 操作超时判负 / 断线保座重连）

## 联机玩法速览

房间制支持 **2–9 人同局 + 观战**：

- 大厅创建房间（可选最大人数）或凭房间号加入；也可从房间列表一键加入/观战
- 房主手动开局；对局中加入者自动转为观战席
- 观战者实时看到战报、血量与特效，可随时进出
- 对局中断线保留座位（10 分钟内重连自动恢复）；主动退出判负出局
- 全员提交动作后统一结算；超时未出招判负
- 结束后房主可发起"再来一局"，全员返回等待室

## 玩法速览

每回合三选一：**接取**元素（+1）／**使用**元素技能（消耗元素发动 23 种路线之一）／**防御**（免疫全部非穿防伤害并驱散状态）。动作同步结算，HP 归零即败。五系定位：金=锻造爆发、木=控制干扰、火=高风险输出、水=渗透续航、土=反击消耗。

完整规则见 **[docs/GAME_SPEC.md](docs/GAME_SPEC.md)**。

## 文档导航（索引入口）

| 文档 | 用途 |
|:---|:---|
| [docs/GAME_SPEC.md](docs/GAME_SPEC.md) | ★ 现行规则规范 V3.1 —— 唯一权威规则文档 |
| [docs/STATUS.md](docs/STATUS.md) | ★ 项目现状全景 —— 代码地图、结算管线、已实现清单、平衡决策记录、下一步议题菜单（供与外部 AI 沟通） |
| [docs/archive/](docs/archive/) | 历史版 Spec（V1.0 MVP → V2.0 金木火 → V3.0 水土），仅沿革参考，规则以现行版为准 |

## 代码结构

```
engine.js        游戏引擎 GameEngine（纯数据进出，零 DOM，支持 2–9 人）
ai.js            AI 决策（七种行为模式加权随机）
main.js          单机 DOM 表现层（菜单、动画、渲染）
index.html       单机页面骨架
style.css        样式与特效（单机/联机共用设计系统）
engine.test.js   单元测试（自带迷你框架）

server.js        联机服务器入口（express 静态托管 + Colyseus 房间）
server/game-room.js   'clash' 房间逻辑 V5.0（2–9 人、观战、断线重连、超时判负）
online.html      联机页面骨架（大厅 / 等待室 / 对战三屏）
online.js        联机表现层（镜像引擎校验、目标选择、特效、重连）
online.css       联机专属样式
server/*-test.js 联机集成测试（smoke / room / timeout / reconnect）
server/run-all-tests.js  测试编排（npm run server:test）
```

架构约定：引擎纯函数式——输入动作数组、输出 `report`；新规则先加测试用例再改 `engine.js`，UI 经 `isActionFeasible` / `getAvailableRoutes` 自动跟随。
