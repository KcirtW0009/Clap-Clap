# Clap-Clap 五行拍手对战

童年"拍手游戏"升级版：**金·木·水·火·土**五行元素回合制对战（玩家 vs 加权随机 AI）。纯 HTML/CSS/JS，无构建步骤。

## 快速开始

- **游玩**：浏览器直接打开 `index.html`
- **测试**：`npm test`（84 项通过 / 11 项跳过）

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
engine.js      游戏引擎 GameEngine（纯数据进出，零 DOM，支持 2–9 人）
ai.js          AI 决策（七种行为模式加权随机）
main.js        DOM 表现层（菜单、动画、渲染）
index.html     页面骨架
style.css      样式与特效
engine.test.js 单元测试（自带迷你框架）
```

架构约定：引擎纯函数式——输入动作数组、输出 `report`；新规则先加测试用例再改 `engine.js`，UI 经 `isActionFeasible` / `getAvailableRoutes` 自动跟随。
