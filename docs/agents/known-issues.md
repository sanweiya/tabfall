# 已知限制

2026-11-15 的一次代码审查里确认过、但当时没修的问题。修之前先看这里，别重复踩。

- **每帧全量扫描**：`drawLaneScene` 从第 0 个音符扫到可视窗口，`planMergedGroups` / `drawNoteLinks` 每帧为整条轨建 Map/Set。几千音符的谱面会线性变慢（导出时逐帧如此）。改法是二分可视起点、按 `(track, layout, appearance)` 缓存 merge 计划——两条路径共用 `drawLaneFrame`，改一次即可。
- **透视时弦名图例不随条带变形**：`drawStringLegend` 在 `drawPerspective` 之后平面绘制（只补了纯黑模式的边缘安全距离）。要贴合变形后的弦线，得把它移进 `drawLaneScene`。
- **离线合成没有超时**：`synthesizeScoreAudio` 的 `await api.exportAudio(...)` 若 worker 起不来（`alphaTab.worker.js` 404 / CSP 拦截）会永不返回，UI 卡在「正在渲染音轨」，取消按钮只在拿到 exporter 之后的渲染循环里生效。
- **音色库缺失不会告警**：`soundfont` fetch 失败时 alphaTab 仍会返回静音数据块，于是导出「有音轨但无声」且 `warning` 为空。修法是把 fetch 失败标志透传到 warning。
- **MP4 + Opus 回退（无 AAC 时）未端到端验证**：播放器不支持时错误要在 `output.finalize()` 才暴露，而不是在 `chooseAudioCodec` 阶段明确报错。
- **无真实伴奏夹具**：同步点映射（`mapScoreToAudio` / `mapAudioToScore`）只有数学对齐，没有带 backing track 的 GP 文件做端到端验证；补一个夹具能覆盖。
- **Firefox 未验证**：预览和导出都只在 Edge 上跑过；WebCodecs 支持面在 Firefox 上不同，导出会走 warning/降级路径（未实测）。
