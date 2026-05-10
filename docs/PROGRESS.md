# codePR 开发进度

> 记录已完成的工作，按里程碑分阶段。当前到 v0.2 完成。

## 项目定位

**Claude Code 原生插件 + PRD 驱动的需求看板 + 三层结合的事前估算引擎 + 设计↔实现对照视图 + 图文并茂的项目进度可视化**。

差异化于 GitHub 上其他 Claude Code 周边工具的两个抓手：
1. **事前估算**：在新需求录入瞬间给出 token + 工时区间，而非事后回看
2. **设计↔实现 diff**：PRD 用 frontmatter 声明预期组件，scanner 检测真实代码缺口

---

## v0.1 — 基础雏形（已完成）

### 插件骨架

| 文件 | 作用 |
|---|---|
| [.claude-plugin/plugin.json](../.claude-plugin/plugin.json) | Claude Code 插件清单（commands/hooks/statusline 入口） |
| [package.json](../package.json) | npm 配置，纯 Node 内置依赖（无 node_modules） |
| [.gitignore](../.gitignore) | 排除 node_modules / .codepr / 日志 |

### 数据层（JSON/JSONL）

| 文件 | 职责 |
|---|---|
| [src/paths.js](../src/paths.js) | 仓库根定位、`.codepr/` 路径解析 |
| [src/store.js](../src/store.js) | requirements.json / events.jsonl / history.jsonl / config.json 读写 |
| [src/prd-parser.js](../src/prd-parser.js) | Markdown + YAML frontmatter + Mermaid 块 + GFM 任务清单提取 |
| [src/jsonl-parser.js](../src/jsonl-parser.js) | 解析 `~/.claude/projects/<repo>/*.jsonl`，抽取 token 用量 |

数据全部本地 JSON/JSONL 存储，无数据库依赖。

### 三层估算引擎（核心差异点）

| 层 | 文件 | 算法 |
|---|---|---|
| ① 规则基线 | [src/estimator/rules.js](../src/estimator/rules.js) | 文件信号 × 复杂度系数（auth/migration/refactor 关键词加权） |
| ② 历史校准 | [src/estimator/history.js](../src/estimator/history.js) | tag Jaccard + 文本 Jaccard 加权 KNN（K=5），冷启动跳过 |
| ③ AI 区间 | [src/estimator/ai.js](../src/estimator/ai.js) | 调用 Claude（Haiku 4.5），无 API key 时启发式降级 |
| 合并 | [src/estimator/combine.js](../src/estimator/combine.js) | 加权 0.2/0.4/0.4，min/max 区间融合保守上下界 |

### Scanner — 设计↔实现 diff

支持的框架：

| 类别 | 文件 | 覆盖 |
|---|---|---|
| 路由 | [src/scanner/routes.js](../src/scanner/routes.js) | express / nest / spring / flask / django / rails / fastify |
| 函数/类导出 | [src/scanner/handlers.js](../src/scanner/handlers.js) | js/ts/py/go 通用导出模式 |
| Hook / 中间件 | [src/scanner/hooks.js](../src/scanner/hooks.js) | React `use*` / express middleware / CC lifecycle hooks |
| ORM 模型 | [src/scanner/db.js](../src/scanner/db.js) | prisma / typeorm / sequelize / sqlalchemy / django ORM / mongoose |
| Diff 引擎 | [src/scanner/diff.js](../src/scanner/diff.js) | 声明 ∩ 实际 → matched / 声明−实际 → missing / 偏离 → deviation |

### Claude Code Hooks（自动归因）

| Hook | 行为 |
|---|---|
| SessionStart | 加载 active req 并写事件 |
| UserPromptSubmit | 检测 `#req-XX` 自动切换 active req |
| PostToolUse | 把 tool token 用量累加到 active req |
| Stop | 检查 PRD 验收清单完成情况 → 自动归档到 history.jsonl |

所有 hook 都用 [hooks/_lib.js](../hooks/_lib.js) 的 `safe()` 包装：异常写日志、不阻塞会话。

### Slash Commands

| 命令 | 功能 |
|---|---|
| `/req add\|list\|show\|done\|active\|rm` | 需求 CRUD + 当前活跃需求切换 |
| `/estimate <id>` | 重新跑三层估算 |
| `/audit <id>` | 设计↔实现 diff 输出 |
| `/scaffold <id>` | 给缺失项生成空骨架（同文件多 handler 用 append） |
| `/sync` | 扫描 PRD 目录新文件 |
| `/progress` | 启动 dashboard |

### CLI 入口 + Statusline

- [bin/codepr.js](../bin/codepr.js) — 所有 slash command 背后的统一入口
- [statusline.js](../statusline.js) — 输出 `📋 req-12 用户登录 [████░░░░] 48% · 8.2k/17k tok`

### Web Dashboard 基础版

| 文件 | 作用 |
|---|---|
| [src/dashboard/server.js](../src/dashboard/server.js) | Node 内置 http server，serve 静态文件 + `/api/*` |
| [src/dashboard/public/index.html](../src/dashboard/public/index.html) | 单页 UI，CDN 加载 markdown-it / mermaid / Chart.js |
| [src/dashboard/public/style.css](../src/dashboard/public/style.css) | 暗色主题 |
| [src/dashboard/public/app.js](../src/dashboard/public/app.js) | ESM 应用层（无 React/Vue） |

四个主要 tab：
- **Design Doc**：PRD 富渲染（Markdown + Mermaid + 内嵌 HTML + GFM 任务清单）
- **Design ↔ Reality**：架构图节点状态着色 + 路由/handler/hook/model 四张清单表
- **Estimate**：三层估算明细
- **History**：历史完成需求列表

### 端到端验证

```
✅ /req add docs/prd/001-user-login.md → 三层估算（13.2k–91.2k tok / 2.2–13.9 h）
✅ /audit req-001 → 检测到 7 项缺失（routes 2 / handlers 2 / hooks 1 / models 2）
✅ /scaffold req-001 → 生成占位文件（含同文件多 handler 的 append 逻辑）
✅ /audit req-001 → completion 0% → 57.1%（手动加路由后）
✅ /req active req-001 → statusline 输出
✅ Dashboard /api/* 全部 200 OK
```

---

## v0.2 — 图表套件（已完成）

针对"AI 驱动开发更适合敏捷"的特点，做了 5 张图表（区分于竞品的纯 token 折线）。所有图表都在 dashboard 的 **📊 Overview** tab 集中呈现。

### 时间序列聚合层

[src/charts/timeseries.js](../src/charts/timeseries.js) 5 个聚合函数：

| 函数 | 数据源 | 用途 |
|---|---|---|
| `projectBurnup(repo)` | requirements + events | 项目级 scope/actual/done 双线 + 估算包络带 |
| `reqBurnup(repo, id)` | events filter by req | 单需求实际累计 + 估算上下界 |
| `calibration(repo)` | history.jsonl | 估算 vs 实际散点 |
| `cfd(repo)` | requirements 状态切换 | Backlog/In Progress/Done 三层堆叠 |
| `gantt(repo)` | requirements `actual.{started_at,completed_at}` | 横条工期 + 估算上界半透明背景 |

### 图表 API

| Endpoint | 返回 |
|---|---|
| `GET /api/charts/project-burnup` | 项目 burnup 时间序列 + summary |
| `GET /api/charts/req-burnup?id=...` | 单需求 burnup |
| `GET /api/charts/calibration` | 散点 + 命中率 + 平均偏差 + bias 标签 |
| `GET /api/charts/cfd` | 状态计数时间序列 + WIP warning |
| `GET /api/charts/gantt` | 每个需求 row（start/end/estEnd）|

### 前端图表

[src/dashboard/public/charts.js](../src/dashboard/public/charts.js) 5 个绘图函数：

| 函数 | 图表类型 | 关键设计 |
|---|---|---|
| `drawProjectBurnup` | line | scope 阶梯线 + 实际平滑线 + 估算阴影带 |
| `drawReqBurnup` | line | 实际线超出估算上界时变红 + 三层估算虚线（默认隐藏，可点图例展开） |
| `drawCalibration` | scatter | y=x 完美校准对角线 + ±50% 容差带 + 命中绿点/超出红点 |
| `drawCFD` | stacked line + stepped | Done/In Progress/Backlog 从底向上堆叠 |
| `drawGantt` | horizontal bar (floating) | 实际条 + 估算上界半透明背景条，颜色按状态 |

### Dashboard UI 增强

- 顶部双 nav：**📊 Overview** / **📋 Requirements**
- 5 张自适应汇总卡片：reqs done / **WIP（≥4 时橙色警告）** / actual tokens / estimated range / accuracy
- Overview 4 张图布局：

```
[ 5 stat cards (auto-fit)                    ]
[ project burnup (full width)                ]
[ CFD               ][ calibration scatter   ]
[ Gantt-lite (高度按 req 数量动态调整)         ]
```

- 单需求 Estimate tab 内嵌单需求 burnup 图

### 演示数据生成

`codepr seed-demo` 命令一次性生成：
- 8 条历史条目（不同标签/规模，让校准散点立刻有内容）
- 现有需求的模拟 tool_use 事件链
- 前一半需求标记为 `done` 状态（让 CFD 的 Done 区域和 Gantt 的 done 颜色可见）

### 实测数据示例

```
项目 burnup:
  req-001 加入 t=0      scopeUpper=47.3k actualTotal=0
  req-002 加入 t=11h    scopeUpper=138.5k ⬆️（scope 长出来了，burnup 让其可见）
  现在     t=24h        actualTotal=79.7k

CFD: backlog=0 in_progress=1 done=1 maxWIP=1

校准: n=8 命中率=100% 平均ratio=1.03 bias=underestimate

Gantt:
  req-001 [done]        实际 11h  估算上界 14h  ✅ 在预算内
  req-002 [in_progress] 实际 24h  估算上界 7.2h ⚠️ 超预算（视觉上"实际条比估算条长"）
```

---

## 关键设计决策

### 与红海工具的差异化

| 类别 | 现有工具 | codePR 的不同 |
|---|---|---|
| Token 用量 | ccusage / tokscale / TokenTracker (10+ 个) — 全部事后回看 | **事前**估算 + 三层校准 |
| Task 看板 | claude-task-viewer / @gonzui/claude-task-manager — 跟踪 todo | PRD 驱动 + 设计↔实现 diff |
| Context 监控 | Claude HUD | 业务需求级完成度 |
| 估算准确率 | (无) | **校准散点图（独有）** |

### 关键技术选择

- **JSON/JSONL 数据层**：无数据库，无迁移负担
- **Chart.js + Mermaid + markdown-it (CDN)**：无构建工具，纯静态页
- **ESM JavaScript**：无 TypeScript 编译步骤
- **Node 内置 http server**：无 express 等 web 框架
- **Burnup 而非 Burndown**：AI dev scope 自然增长，burndown 会骗人（[DX 团队的反思](https://getdx.com/blog/burndown-chart/)）
- **Hooks 全 fail-safe**：任何异常写日志不阻塞会话

### PRD 富文档

PRD 是 Markdown，但鼓励嵌入 Mermaid 图、原生 HTML 片段、GFM 任务清单、YAML frontmatter（声明 expects.routes/handlers/hooks/db_models）。

### 不做的事

- ❌ 多 CLI 支持（Codex/Cursor）— 先把 CC 做深
- ❌ GitHub Issues / Linear 集成 — 仅本地 Markdown
- ❌ 团队协作 — 个人本地工具
- ❌ 与 ccusage 兼容 — 自己解析 JSONL
- ❌ Sprint cadence / story points — AI dev 不适合两周 sprint
- ❌ 依赖型 Gantt — 个人项目用不上

---

## 文件结构总览

```
codePR/
├── .claude-plugin/
│   └── plugin.json
├── bin/
│   └── codepr.js                  # 统一 CLI 入口
├── commands/                      # 6 个 slash commands
│   ├── audit.md
│   ├── estimate.md
│   ├── progress.md
│   ├── req.md
│   ├── scaffold.md
│   └── sync.md
├── docs/
│   ├── PROGRESS.md                # ← 本文件
│   ├── ROADMAP.md                 # 下一步计划
│   └── prd/                       # 用户写的 PRD（demo 用）
│       ├── 001-user-login.md
│       └── 002-payment.md
├── hooks/                         # 4 个 CC lifecycle hooks
│   ├── _lib.js
│   ├── hooks.json
│   ├── post-tool-use.js
│   ├── session-start.js
│   ├── stop.js
│   └── user-prompt-submit.js
├── src/
│   ├── charts/
│   │   └── timeseries.js          # 5 个聚合函数
│   ├── dashboard/
│   │   ├── server.js
│   │   └── public/
│   │       ├── app.js
│   │       ├── charts.js          # 5 个绘图函数
│   │       ├── index.html
│   │       └── style.css
│   ├── estimator/
│   │   ├── ai.js
│   │   ├── combine.js
│   │   ├── history.js
│   │   └── rules.js
│   ├── scanner/
│   │   ├── db.js
│   │   ├── diff.js
│   │   ├── handlers.js
│   │   ├── hooks.js
│   │   ├── routes.js
│   │   └── walk.js
│   ├── jsonl-parser.js
│   ├── paths.js
│   ├── prd-parser.js
│   └── store.js
├── statusline.js
├── package.json
├── README.md
└── .gitignore
```

数据运行时（被插件化项目的根目录下）：

```
.codepr/
├── requirements.json     # 需求树 + 估算 + 实际累计
├── events.jsonl          # 插件自身事件流
├── history.jsonl         # 已完成需求的校准库
├── config.json           # 估算系数、PRD 目录等
├── active-req            # 当前活跃需求 id（单行文本）
└── reports/              # （v0.3 起）HTML 报告输出
```
