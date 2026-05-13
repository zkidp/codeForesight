# codeForesight 开发进度

> 记录已完成的工作，按里程碑分阶段。**当前到 v0.4 完成**（v0.1 雏形 → v0.2 图表 → v0.3 HTML 报告 → v0.4 项目级 + 合图 + 快照 + embedding + rebrand + i18n + 主题）。

## 项目定位

**Claude Code 原生插件 + PRD 驱动的需求看板 + 三层结合的事前估算引擎 + 设计↔实现对照视图 + 图文并茂的项目进度可视化**。

差异化于 GitHub 上其他 Claude Code 周边工具的三个抓手：
1. **事前估算（Foresight）**：在新需求录入瞬间给出 token + 工时区间，而非事后回看
2. **设计↔实现 diff**：PRD 用 frontmatter 声明预期组件，scanner 检测真实代码缺口
3. **自包含 HTML 报告**：图文结合、可分享、离线可用，覆盖 PR comment / 邮件 / Wiki 场景

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

## v0.3 — 自包含 HTML 报告（已完成）

落地了"图文结合"的核心人类接触面：单需求级 HTML 报告，离线可用、可贴 PR / 邮件 / Wiki。

### 报告模块 [src/report/](../src/report/)

| 文件 | 职责 |
|---|---|
| [templates/req.html](../src/report/templates/req.html) | 单需求 HTML 模板，`{{slot}}` 占位符替换 |
| [templates/styles.css](../src/report/templates/styles.css) | 暗色主题，inline 进 `<style>` 标签 |
| [snippets.js](../src/report/snippets.js) | 给定 file+symbol 抽 5-15 行代码片段 + 简易语法高亮（keyword / string / comment / function name） |
| [mermaid-static.js](../src/report/mermaid-static.js) | 把 ```` ```mermaid ```` 块转 `<div class="mermaid">`；给 audit 架构图节点附加状态映射，浏览器端着色 |
| [narrative.js](../src/report/narrative.js) | 调 Claude Haiku 写 3 段叙事；哈希缓存到 `.codepr/cache/narratives/`；无 API key 时启发式降级 |
| [minimal-md.js](../src/report/minimal-md.js) | 极简 Markdown→HTML（headers / lists / task lists / tables / fenced / inline），零依赖 |
| [generator.js](../src/report/generator.js) | 编排：load req → parse PRD → audit → burnup → narrative → inline assets → 拼模板 → 写盘 |
| [inline-assets.js](../src/report/inline-assets.js) | fetch CDN 脚本缓存到 `.codepr/cache/assets/`，inline 进 HTML 实现真正自包含 |

### 入口

- [bin/codepr.js](../bin/codepr.js) 新增 `report <id>` 子命令（支持 `--force` 跳过缓存、`--no-network` 不调网络）
- [commands/report.md](../commands/report.md) 新 slash command

### 报告内容（7 个 section，从上到下）

1. **头部摘要卡**：reqId + 标题 + status/priority/progress chips + 4 块统计（估算 token / 实际 token / 估算工时 / 完成度），颜色按超 budget / 命中区间动态变化
2. **AI 叙事总结**：3 段（当前状态 / 设计↔实现差距 / 下一步建议），紫色标签强调
3. **PRD 富渲染**：Markdown + 内嵌 Mermaid（浏览器端渲染）+ GFM 任务清单状态
4. **设计↔实现对照**：4 张统计卡 + 架构图节点按状态着色（绿/红/黄）+ 4 张清单表（路由 / handlers / hooks / models）
5. **Token Burnup 图**：Chart.js inline 渲染，数据 inline 在 `window.__CODEPR_DATA__`
6. **关键代码片段**：已实现 handler 各截 5-15 行带高亮
7. **底部元信息**：codepr 版本 + 生成时间 + 数据快照时间

### 自包含验证

```
$ codepr report req-001
✅ generated: .codepr/reports/req-001.html
   narrative source: heuristic
   inlined runtime: 3541 KB (offline-capable)

$ wc -c .codepr/reports/req-001.html
3,756,156

$ grep -oE 'src="https?://[^"]+"' .codepr/reports/req-001.html
(空 — 零外部依赖)
```

- 单文件 3.76 MB（含 Chart.js / Luxon / Adapter / Mermaid runtime 全部 inline）
- 拷到陌生机器 / 断网 / 邮件附件均可正常打开
- 第二次生成 **188ms**（资产缓存 7 天 TTL，AI 叙事按内容 hash）

### 缓存命中机制

| 缓存类型 | 位置 | 命中条件 |
|---|---|---|
| 静态资产 | `.codepr/cache/assets/{chart,luxon,adapter,mermaid}.js` | 文件存在且 mtime < 7 天 |
| AI 叙事 | `.codepr/cache/narratives/<reqId>-<hash>.json` | hash = sha256(reqId + status + progress + tokens + prd长度 + audit计数) 前 12 字符 |

### 实测尺寸明细

| 资产 | 体积 | 占比 |
|---|---|---|
| mermaid.min.js | 3.3 MB | 88% |
| chart.js | 208 KB | 5% |
| luxon.js | 82 KB | 2% |
| chartjs-adapter-luxon | 1.8 KB | <1% |
| 报告自身（HTML + CSS + 数据） | ~165 KB | 4% |

---

## v0.4 — Rebrand + 项目级 + 合图 + 快照 + Embedding + i18n + 主题（已完成）

v0.4 是一次大整合：把 codePR rebrand 为 **codeForesight**，并把项目级形态、跨需求合图、时间维度（快照 diff）、语义校准（embedding）、国际化与主题都做齐。

### 4-A Rebrand 到 codeForesight

| 文件 | 变化 |
|---|---|
| [package.json](../package.json) | `name: codeforesight`，bin 三别名 `codeforesight` / `cf` / `codepr`（兼容旧用法） |
| [.claude-plugin/plugin.json](../.claude-plugin/plugin.json) | name + author + version v0.4 |
| [README.md](../README.md) | 全面重写，凸显 "Foresight" 差异化 |
| 所有面向用户的字符串 | 引用从 `codepr` 改为 `codeforesight` |

### 4-B 项目级 HTML 报告 `codeforesight report --all`

复用 v0.3 自包含管道，扩展到项目维度：

| 新增文件 | 职责 |
|---|---|
| [src/report/templates/project.html](../src/report/templates/project.html) | 项目级模板（头部 + 叙事 + 4 张图 + 架构合图 + 需求卡片） |
| [src/report/templates/project-charts.js](../src/report/templates/project-charts.js) | 独立 IIFE 脚本，从 `window.__CODEPR_DATA__` 渲染 4 张项目图，跟随主题切换重绘 |
| [src/report/generator.js](../src/report/generator.js) 的 `generateProjectReport()` | 项目级编排器，复用 inline-assets / narrative 缓存 |
| [src/report/narrative.js](../src/report/narrative.js) 的 `buildProjectNarrative()` | 项目级 AI 叙事（overview / risks / next_steps），按内容 hash 缓存 |

实测：单文件 3.87 MB，零外部依赖，第二次生成 ~170ms（缓存命中）。

### 4-C Mermaid 合图（项目级架构）

| 新增文件 | 职责 |
|---|---|
| [src/report/mermaid-merger.js](../src/report/mermaid-merger.js) | 解析所有 PRD 的 flowchart 块，合并为单图 |

支持的语法范围：
- `flowchart` / `graph` 类型（带方向 LR/TD 等）
- 节点形状 `id`/`id[Label]`/`id{Label}`/`id(Label)`/`id((Label))`
- 箭头 `-->`/`---`/`-.->`/`==>`/`-- text -->`/`-->|text|`
- subgraph 剥壳保内，sequenceDiagram 等非 flow 类型跳过

合并算法：
- **同名节点合并**：跨需求引用同一组件时自动归集，标签后加 `〔req-001, req-003, …〕` 标注来源
- **边去重**：相同 `(from, to)` 仅保留一条
- **跨需求状态着色**：worst-state 优先（`missing > deviation > matched`），通过 mermaid `classDef mm-*` 实现

实测：codeForesight 自己 7 个 PRD 合成 **36 节点 + 33 边**，自动识别 `PRD` / `Parser` / `Estimator` / `Diff` 等概念在多个 PRD 间的复用。

### 4-D 历史快照 + diff

| 新增文件 | 职责 |
|---|---|
| [src/report/snapshots.js](../src/report/snapshots.js) | 归档当前状态 / 列出快照 / 数据 diff |
| [hooks/stop.js](../hooks/stop.js) 升级 | req 转 done 时自动触发快照 |

快照目录结构：

```
.codepr/snapshots/<ISO>/
  ├── index.html     # 完整项目报告
  └── data.json      # requirements + history 当时状态（diff 用）
```

**数据 diff 独立于 HTML 模板** — 即使报告样式以后改了，旧快照永远能正确 diff。

新 CLI：
- `codeforesight snapshot list` — 列出所有快照
- `codeforesight snapshot now` — 手动归档当前状态
- `codeforesight diff <ts1> <ts2>` — 结构化对比两份快照（reqs 增减 / 状态变化 / token Δ / progress Δ）

支持 timestamp 前缀匹配（`codeforesight diff 2026-05-13T17:20:01 2026-05-13T17:20:17` 即可）。

### 4-E 估算校准强化 — Embedding 替换 Jaccard

| 新增文件 | 职责 |
|---|---|
| [src/estimator/embeddings.js](../src/estimator/embeddings.js) | Voyage AI / OpenAI embedding 调用 + 内容哈希缓存 |
| [src/estimator/history.js](../src/estimator/history.js) 升级 | 异步化，优先用 cosine 相似度，无 API key 时降级回 Jaccard |
| [src/estimator/combine.js](../src/estimator/combine.js) 升级 | `Promise.all([history, ai])` 并行，时延不变 |

Provider 优先级：
1. `VOYAGE_API_KEY` → Voyage AI `voyage-3-lite`（Anthropic 推荐伙伴）
2. `OPENAI_API_KEY` → OpenAI `text-embedding-3-small`
3. 无 key → 自动降级 Jaccard（无错误打断）

Embedding 按 sha256 内容哈希缓存到 `.codepr/cache/embeddings/`，命中后零成本。相似度公式：`0.8 * cosine + 0.2 * tag_jaccard`。

### 4-F 国际化（中英文）

| 新增文件 | 职责 |
|---|---|
| [src/i18n/index.js](../src/i18n/index.js) | `t(key, params)` 函数 + 语言探测 |
| [src/i18n/locales/zh.json](../src/i18n/locales/zh.json) | 中文（约 200 条） |
| [src/i18n/locales/en.json](../src/i18n/locales/en.json) | 英文（约 200 条） |

覆盖范围：CLI 输出、Dashboard UI、5 张图表的所有标题/图例/tooltip、报告 7 个 section、AI 叙事段落标签。

语言探测优先级：`--lang` 参数 → `CODEFORESIGHT_LANG` env → `LANG` 系统 locale → 默认 zh。浏览器端 toggle 即时切换，偏好存 `localStorage`。

### 4-G 主题（跟随 Claude Code）

| 新增文件 | 职责 |
|---|---|
| [src/report/cc-settings.js](../src/report/cc-settings.js) | 读 `~/.claude/settings.json` 的 `theme` 字段（dark/light/system） |
| [src/report/templates/controls.js](../src/report/templates/controls.js) | 报告内的语言/主题 toggle 浏览器脚本 |

CSS 全面变量化：20+ 个 `--bg` / `--text` / `--accent` / `--success` / `--danger` 等变量，dark + light 两套同结构，切换主题只换变量值。

切换路径：
- **报告**：生成时读 CC 默认主题；HTML 内嵌两套 CSS；右上角 🌙/☀️ 即时切换；图表通过 `getComputedStyle()` 读 CSS 变量自动跟随
- **Dashboard**：`/api/settings` 返回 CC 主题；前端用 Proxy 包装颜色对象，每次绘图自动从 CSS 变量重读
- 用户偏好存 `localStorage.codeforesight.theme`，覆盖 CC 默认

### 4-H Dogfood — codeForesight 自身的开发历程

把之前的 demo PRDs（user-login / payment）替换为真实的 codeForesight 开发里程碑：

| PRD | 对应版本 | 状态 |
|---|---|---|
| [001-foundation.md](../docs/prd/001-foundation.md) | v0.1 基础雏形 | done · 82k tokens · 16h |
| [002-charts-suite.md](../docs/prd/002-charts-suite.md) | v0.2 图表套件 | done · 58k · 12h |
| [003-html-reports.md](../docs/prd/003-html-reports.md) | v0.3 自包含 HTML 报告 | done · 71k · 14h |
| [004-project-reports.md](../docs/prd/004-project-reports.md) | v0.4 项目级报告 | done · 38k · 8h |
| [005-mermaid-merger.md](../docs/prd/005-mermaid-merger.md) | v0.4 合图 | done · 28k · 3.5h |
| [006-snapshots.md](../docs/prd/006-snapshots.md) | v0.4 快照 + diff | done · 22k · 2.5h |
| [007-embeddings.md](../docs/prd/007-embeddings.md) | v0.4 embedding 升级 | done · 31k · 2h |

`codeforesight seed-real` 命令可一键还原这套示例数据 — 其他人 clone 后能直接看到一个"用 codeForesight 跟踪 codeForesight 自身开发"的完整 demo。

### 4-I 修复 — 报告"代码暴露"问题

- req-card 摘要剥离逻辑修复：之前 ```` ```mermaid ```` 围栏会作为字面字符串漏到摘要里；现在用 `extractPlainSummary()` 按顺序剥离 fenced code → inline code → headers → 列表标记 → 链接 → 加粗斜体
- 占位符保留：`<ts>` / `<id>` 不再被当 HTML 标签删掉
- 架构图去重：之前同一张 mermaid 在「PRD 设计文档」section 和「设计↔实现对照」section 渲染两次；现在合并为一次渲染并直接在 PRD section 内附加状态着色（`data-mm-states`）

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
├── commands/                      # 7 个 slash commands
│   ├── audit.md
│   ├── estimate.md
│   ├── progress.md
│   ├── report.md                  # ★ v0.3 新增
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
│   ├── scanner/
│   │   ├── db.js
│   │   ├── diff.js
│   │   ├── handlers.js
│   │   ├── hooks.js
│   │   ├── routes.js
│   │   └── walk.js
│   ├── report/                    # ★ v0.3 + v0.4
│   │   ├── cc-settings.js         # v0.4: 读 ~/.claude/settings.json 主题
│   │   ├── generator.js           # v0.3 单需求 + v0.4 项目级
│   │   ├── inline-assets.js
│   │   ├── mermaid-merger.js      # v0.4: 跨 PRD 合图
│   │   ├── mermaid-static.js
│   │   ├── minimal-md.js
│   │   ├── narrative.js           # v0.3 单需求 + v0.4 项目级叙事
│   │   ├── snapshots.js           # v0.4: 历史快照 + diff
│   │   ├── snippets.js
│   │   └── templates/
│   │       ├── controls.js        # v0.4: 浏览器端 lang/theme toggle
│   │       ├── project-charts.js  # v0.4: 项目报告内嵌图表绘制
│   │       ├── project.html       # v0.4: 项目级模板
│   │       ├── req.html
│   │       └── styles.css         # v0.4: CSS 变量化双主题
│   ├── i18n/                      # ★ v0.4 新增
│   │   ├── index.js
│   │   └── locales/
│   │       ├── en.json
│   │       └── zh.json
│   ├── estimator/
│   │   ├── ai.js
│   │   ├── combine.js
│   │   ├── embeddings.js          # v0.4: Voyage/OpenAI embedding + 缓存
│   │   ├── history.js             # v0.4: 异步化 + cosine 相似度
│   │   └── rules.js
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
├── cache/
│   ├── assets/           # Chart.js / Luxon / Mermaid 缓存（7 天 TTL）
│   └── narratives/       # AI 叙事缓存，按内容 hash
└── reports/              # HTML 报告输出
```
