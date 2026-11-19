# 不变式

改代码前先读与你要动的那一块对应的条目。这些都是踩过坑之后定下来的，不是风格偏好。

## 渲染

- **预览与导出共用 `core/render/lane.ts` 的 `drawLaneFrame`**。视觉改动必须同时影响两条路径；导出只允许分辨率/帧率不同。
- **每帧扫描是窗口化的，窗口边界有语义，别改回线性全扫**：可见音符用二分定位起点，下界必须减去全曲最长音符尾巴（`scanBounds().noteSpan*`，尾巴能比头晚一个全长）；链接窗口下界要覆盖“源已命中、目标还在判定线上方长出”的链接（取 `min(可视下界, clock - linkSpan)`），上界是判定线上方 8 noteH（再高整条链接连同目标都出了画布，目标恒在源上方）。**`planMergedGroups` 返回缓存共享对象**：按 notes 数组 + spacing/appearance/geometry 缩放做键，任何新读入的设置字段都必须进 `mergedPlanKey`，且调用方不得改写返回值。合并组组内按 tick 排序是**端点裁切的前提**（首音符=组最低点、末音符=组最高点），乱了排序裁切就会漏画。
- **数字保持正向**，谱线竖排；不画小节线、符杆、休止符。
- **泛音 / 技巧连接**：泛音形状由 `resolvedNoteShape()` 覆盖为菱形（可关）；连接目标必须取 alphaTab 的 `slideTarget` / `hammerPullDestination` / `slurDestination` 模型指针，按 played-order occurrence 映射，只有目标被 tie 合并时才回退到同弦下一个音符。
- **近距离合并形状**：`planMergedGroups()` 只在同弦、非泛音/非纯数字、中心距 <= `mergeDistance × noteH` 时合并；合并组由 `drawMergedBodies()` 画唯一形体，组内音符只画数字。远距离/跨弦/泛音仍走 `drawNoteLinks()`。不要按时间阈值硬编码，距离要用当前布局的像素。合并形体必须复用单音符的辉光逻辑（`noteGlow()` 精灵沿形体拉伸 + 随 `noteGlow`/贴近判定线的 shadowBlur），否则连成一体的音符会显得没有辉光。
- **判定线遮罩**：音符过线后必须继续绘制并由 `hitY` 裁切，不能在 `hit` 时立刻跳过；直到音符顶部也过线才完全不可见。判定/特效仍按中心过线触发。

## 时间与音频

- **音频时钟是唯一真相**。`api.timePosition`（经本地预测）驱动判定；`ScrollSmoother` 只影响画面绘制位置。不要把平滑后的位置用于命中判定。
- **默认 `spacing: 'beat'` 是 tick 线性**：4 分音符 = 4 个 16 分音符。不要改回 alphaTab 的制谱间距；那会破坏需求 6。
- **平滑**：`smoothingTau = 0.02 + 0.34 s²`，`lookahead = tau * factor`，参数与本机 `dynamic-guitar-tab`（Duck Score Motion）横向镜头一致；改任一个都要同步文档和测试（`tests/smoothing.test.ts` 锁住了曲线）。
- **导出片头**：预告阶段（`clock < 0`）的画面必须用**负时间外推谱面**（`tickAtTimeUnclamped(laneTime)`），和预览 `currentFrame()` 一致；不要把 scoreTime 夹到 0，否则整段倒数的音符会停在开局位置，音乐一响才突然开始下落。
- **导出音频时间轴**：内置伴奏是真实录音，只能按同步点算出区间后**原生速率整体截取**，视频时间轴用反函数 `scoreAtClock()` 从音频位置求谱面时间；不要重采样把伴奏拉伸到谱面 tempo（每个同步点区间的比率不同，会持续变调）。`mapScoreToAudio` / `mapAudioToScore` 的片尾外推斜率必须一致。

## 播放与多轨

- **多轨**：预览用 `changeTrackSolo` 只播选中轨；合成导出必须给其他轨 `trackVolume: 0`，否则导出会混入所有乐器。

## 透视与背景

- **透视视图**：`drawLaneFrame` 先把背景画在目标画布，再把轨道层（底板/弦线/音符/判定线/特效，以及 READY 倒计时和连击数 `drawLaneHud()`）画进缓存透明层，用 `drawPerspective()` 按条带平铺做投影变形，最后叠加平面 HUD（标题/信息/进度条/水印）；预览与导出共用这条路径。**近端比例恒为 1、只收窄远端，并按近端归一化后居中**：纵深方向的总尺寸按 cos 缩小（横向透视时画面总宽度变小），任何元素都不放大，因此不会被画幅裁切；条带必须无重叠平铺（透明层重叠会叠出亮边）；只有 READY/连击跟着轨道层变形，标题/信息/进度条/水印必须保持平面。
- **纯黑叠加模式**：`backgroundMode: 'black'` 时背景必须正好是 `#000`，不画渐变/暗角/底板，`drawFrameEdgeFade()` 在所有非 HUD 图层之后、HUD 之前把四边淡到 0（至少 32px，覆盖两个编码块），并补 2px 实心黑边；HUD 用 7.5% 内边距、进度条内缩，弦名图例要让出淡出带。不要改回全出血进度条或加回侧轨，否则叠加合成会出现边缘突变。

## 界面与存储

- **根容器不可滚动**：`.tf-app` 用 `position:fixed` + `overflow:clip`。`overflow:hidden` 仍会被浏览器在控件获得焦点时程序化滚动（`scrollTop` 变大且没有滚动条可恢复），切换设置会整页下坠。唯一允许滚动的是 `.tf-sidebar-scroll`。
- **localStorage key**：`tabfall.settings.v1`（项目设置）；纯界面偏好（目前是侧栏曲谱卡片的折叠状态）走 `tabfall.ui.v1`，不要混进 `ProjectSettings`——它不该触发引擎重绘或进导出流程。改 key 要写迁移；背景图不落盘。
- **alphaTab 署名**：画面右下角默认 `TABFALL · alphaTab`；保留 alphaTab 的许可文件与资源的可见署名。

## 资源

- `vendor/alphaTab.worker.js` 是 classic worker，`api.exportAudio` 依赖它；不要替换成 ESM 入口。
- `vendor/soundfont/sonivox.sf2`、`vendor/font/` 构建时复制到 `dist/assets/`。
- 测试夹具 `samples/tabfall-*.gp` 是原创 AlphaTex 导出的 GP7；不要加入受版权保护的歌曲文件。
