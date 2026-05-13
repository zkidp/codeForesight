# codeForesight Roadmap

> 后续迭代的方向和优先级。已完成的工作见 [PROGRESS.md](PROGRESS.md)。

## 已完成的里程碑

| 版本 | 主要交付 |
|---|---|
| v0.1 | 插件骨架 / 数据层 / 三层估算 / Scanner / Hooks / 6 个 slash commands / Statusline / Dashboard 基础 |
| v0.2 | 5 张图表（项目 burnup / 单需求 burnup / 校准散点 / CFD / Gantt-lite）+ Overview 布局 |
| v0.3 | 自包含 HTML 报告（report 模块 / inline-assets / minimal-md / AI 叙事 + 缓存） |
| **v0.4** | **Rebrand 到 codeForesight + 项目级报告 + Mermaid 合图 + 历史快照 + diff + Embedding 校准 + 中英文 i18n + 跟随 CC 的双主题** |

详见 [PROGRESS.md](PROGRESS.md)。

---

## v0.4 实测能力一览（基线）

到 v0.4 完成后，codeForesight 的能力组合：

| 类别 | 能力 |
|---|---|
| **需求管理** | PRD 注册、状态切换、active 跟踪、scaffold 占位 |
| **估算** | 三层引擎（规则 + 历史 cosine/Jaccard + AI）、置信度、命中率校准 |
| **设计↔实现 diff** | 路由 / handler / hook / model — 7 框架扫描、状态着色架构图 |
| **图表** | 5 张（项目 burnup / 单需求 burnup / 校准散点 / CFD / Gantt-lite）|
| **HTML 报告** | 单需求 + 项目级、自包含离线可用、AI 叙事 + 缓存 |
| **项目级合图** | 跨 PRD mermaid merge + 状态着色 + 来源标注 |
| **历史快照 + diff** | Stop hook 自动归档、CLI 结构化对比 |
| **i18n** | 中英文全套（CLI + 仪表盘 + 报告），浏览器端 toggle |
| **主题** | 明/暗双主题，跟随 CC settings，浏览器端 toggle |
| **CLI 别名** | `codeforesight` / `cf` / `codepr`（兼容） |

---

## 当前阶段：v0.5 — 验证 + 生态

v0.1–0.4 一直在快速堆功能，v0.5 重心转向 **真实场景验证 + 上架生态**。

### 5-A 真实项目验证（dogfood 外）

到目前为止 codeForesight 只在自己身上跑过。需要在 3 个不同形态的外部项目上跑通：

- [ ] 一个 Node.js Express 后端（典型 CRUD + 中间件）
- [ ] 一个 Python Flask / Django 后端
- [ ] 一个 React + Next.js 前端

每个项目跑一个完整 PRD → estimate → audit → 实际开发 → report 流程，记录：
- 三层估算的命中率（actual 落在区间内的比例）
- Scanner 对真实代码的检测准确率（false negative / false positive 统计）
- AI 叙事的可用性（无需手改 vs 需要润色）

### 5-B 发布到 Claude Code Plugin Marketplace

- [ ] 加 `.claude-plugin/marketplace.json`
- [ ] 录 demo gif（30 秒：register PRD → 看报告 → 实际开发 → diff snapshot）
- [ ] README 双语 + 配置示例
- [ ] 写测试套件（重点覆盖 estimator / scanner / mermaid-merger 三大块）
- [ ] 提交收录

### 5-C 体积优化

v0.4 自包含报告 3.87 MB，mermaid runtime 占 88%。优化方向：

- [ ] PRD 无 mermaid 时跳过 mermaid runtime inline → 单需求报告降到 ~500 KB
- [ ] Chart.js 按需 tree-shake（自包含报告只需 line + bar + scatter，无需全量）
- [ ] 评估服务端 mermaid 预渲染（puppeteer-core + 系统 Chrome）替代浏览器端渲染

### 5-D Dashboard 体验补漏

- [ ] WebSocket 推送替代 5 秒轮询（极速反馈，hook 写完即刷新）
- [ ] 单需求 burnup 图的实时主题切换（目前 dashboard charts.js 用 Proxy 已经支持，需 verify）
- [ ] 快照浏览器：`/snapshots` tab，可视化 diff

---

## v0.6+ — 长期方向

### Multi-CLI 支持

按用户当初的设想扩展到 Codex CLI / Cursor / Gemini CLI。**仅当 v0.5 在 CC 上证明价值后再做**，避免过早扩散。

- 抽象 `src/cli-adapters/` 层
- 统一 token 用量数据模型
- 各 CLI 的 JSONL 格式差异收敛

### GitHub Issues / Linear 集成

把 PRD 文件改为可选项之一，从 GitHub Issues / Linear 拉需求。
- `codeforesight sync --source github` 命令
- 用 issue label 映射 PRD frontmatter 的 `expects.*`
- 把 audit 结果反馈到 issue（comment / status check）

### 团队协作

- 多人 dashboard：把 `.codepr/` 推到远端 redis / sqlite
- 个人估算系数 vs 团队平均的对比
- 团队级 calibration（合并所有人的 history）

### 自定义估算策略

- 用户可在 `config.json` 自定义复杂度系数表
- 自定义历史相似度权重
- 支持 plug-in 自定义估算层（继承 `estimateByX(prd, repo)` 接口）

### 更多语言/框架

Scanner 扩展：
- Rust（axum / actix-web 路由）
- Go（gin / echo / chi）
- Kotlin（Spring Boot 升级）
- Vue 3 + Pinia
- iOS Swift（SwiftUI views as "routes"）

---

## 不会做

- ❌ 集成进 VS Code（CC 插件已够用，IDE 扩展投入产出比低）
- ❌ 上数据库（JSON/JSONL 足够个人/小团队）
- ❌ 移动端 / SaaS 化（这是工具不是产品）
- ❌ 替代现有 ccusage 类工具（让它们做事后回看，我们专注事前 + 校准）
- ❌ 通用项目管理 SaaS（不与 Linear/Jira/Plane 正面竞争，专注 AI 开发场景）

---

## v0.5 当前 todo

按优先级（顶部最重要）：

1. [ ] **外部项目实战 1**：找一个公开 Node.js / Express 项目，跑完整流程
2. [ ] **外部项目实战 2**：Python Flask / Django
3. [ ] **外部项目实战 3**：React / Next.js
4. [ ] 记录三个项目的命中率 / 准确率 / AI 叙事可用度数据
5. [ ] 写测试套件（vitest）
6. [ ] 录 demo gif
7. [ ] 加 `marketplace.json`
8. [ ] Mermaid 按需 inline + Chart.js tree-shake → 体积降到 < 1MB
9. [ ] WebSocket dashboard 推送
10. [ ] 提交收录到 Plugin Marketplace
