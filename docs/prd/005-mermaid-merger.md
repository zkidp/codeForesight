---
id: req-005
title: v0.4 Mermaid 合图 — 项目级架构图
priority: P2
tags: [mermaid, visualization, v0.4]
expects:
  handlers:
    - src/report/mermaid-merger.js:mergePrdMermaid
    - src/report/mermaid-merger.js:colorByCrossReqState
---

# v0.4 — 项目级 Mermaid 合图

## 背景

每个 PRD 都画了自己的架构子图。读者切换需求看图很碎片化。如果能把所有 PRD 的 mermaid 块自动 merge 成一张项目大图，节点按"全部需求合并状态"着色，PM 一眼看清全局架构 + 实现进度。

## 难点

- 节点名重复处理（同名合并 vs 加 req-id 前缀）
- 边去重
- 跨需求引用同一组件时怎么连
- 自动布局：用 mermaid 的 `flowchart LR` 横向延伸避免拥挤

## 验收标准

- [ ] `mermaid-merger.js` 解析多个 mermaid 块并 merge 成单图
- [ ] 节点合并：同名合并（若来自不同 req 用集合存 req-id 列表）
- [ ] 边去重 + 保留方向
- [ ] 输出后兼容 v0.3 的 audit 着色逻辑
- [ ] 项目报告 index.html 顶部插入这张大图
- [ ] 鼠标悬浮节点显示"来自哪些 req"
