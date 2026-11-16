# 已知限制

2026-11-15 的一次代码审查里确认过、但当时没修的问题（2026-11-16 在 Linux + Firefox 上补了实测）。修之前先看这里，别重复踩。

- **每帧全量扫描**：`drawLaneScene` 从第 0 个音符扫到可视窗口，`planMergedGroups` / `drawNoteLinks` 每帧为整条轨建 Map/Set。几千音符的谱面会线性变慢（导出时逐帧如此）。改法是二分可视起点、按 `(track, layout, appearance)` 缓存 merge 计划——两条路径共用 `drawLaneFrame`，改一次即可。
- **透视时弦名图例不随条带变形**：`drawStringLegend` 在 `drawPerspective` 之后平面绘制（只补了纯黑模式的边缘安全距离）。要贴合变形后的弦线，得把它移进 `drawLaneScene`。
- **离线合成没有超时**：`synthesizeScoreAudio` 的 `await api.exportAudio(...)` 若 worker 起不来（`alphaTab.worker.js` 404 / CSP 拦截）会永不返回，UI 卡在「正在渲染音轨」，取消按钮只在拿到 exporter 之后的渲染循环里生效。
- **音色库缺失不会告警**：`soundfont` fetch 失败时 alphaTab 仍会返回静音数据块，于是导出「有音轨但无声」且 `warning` 为空。修法是把 fetch 失败标志透传到 warning。
- **MP4 + Opus 回退只在 Firefox 上端到端验证过**：2026-11-16 用 Firefox 160 导出 480×270 / 30 fps MP4 成功（3.8 MB，H.264 + Opus，成功页有回退提示）。但代码里仍是“先按首选编码器试”，失败要到 `output.finalize()` 才暴露，没有在 `chooseAudioCodec` 阶段提前判定；其它缺 AAC 的浏览器是否走同一条路径尚未验证。
- **无真实伴奏夹具**：同步点映射（`mapScoreToAudio` / `mapAudioToScore`）只有数学对齐，没有带 backing track 的 GP 文件做端到端验证；补一个夹具能覆盖。
- **Firefox 已做冒烟验证，但没跑过全量回归**：2026-11-16 在 Firefox 160 + geckodriver 0.37.1 上用 `tests/firefox-e2e.mjs` 实测了预览、播放时钟、连击、快捷键、截图，并手工导出了 WebM / MP4 各一段（480×270 / 30 fps）。Firefox 没有 AAC 编码器，MP4 会回退 Opus 并给出提示；AV1 / H.264 / VP8 / VP9 视频编码均可用。尚未在 Firefox 上验证的：长曲谱/多轨/透视/纯黑模式下逐帧导出的视觉一致性、9:16 与 1:1 画幅、导出取消路径。
