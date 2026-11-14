# TABFALL — 维护说明

这是一个独立的“音游风格六线谱视频工坊”。参考项目 `/home/cx/文档/Code/gp-studio` 只读，不要在里面写文件。

## 不变式

- **预览与导出共用 `core/render/lane.ts` 的 `drawLaneFrame`**。视觉改动必须同时影响两条路径；导出只允许分辨率/帧率不同。
- **音频时钟是唯一真相**。`api.timePosition`（经本地预测）驱动判定；`ScrollSmoother` 只影响画面绘制位置。不要把平滑后的位置用于命中判定。
- **默认 `spacing: 'beat'` 是 tick 线性**：4 分音符 = 4 个 16 分音符。不要改回 alphaTab 的制谱间距；那会破坏需求 6。
- **数字保持正向**，谱线竖排；不画小节线、符杆、休止符。
- **多轨**：预览用 `changeTrackSolo` 只播选中轨；合成导出必须给其他轨 `trackVolume: 0`，否则导出会混入所有乐器。
- **平滑**：`smoothingTau = 0.02 + 0.34 s²`，`lookahead = tau * factor`，参数与 gp-studio 横向镜头一致；改任一个都要同步文档和测试。
- **alphaTab 署名**：画面右下角默认 `TABFALL · alphaTab`；保留 alphaTab 的许可文件与资源的可见署名。
- **localStorage key**：`tabfall.settings.v1`。改 key 要写迁移；背景图不落盘。
- **根容器不可滚动**：`.tf-app` 用 `position:fixed` + `overflow:clip`。`overflow:hidden` 仍会被浏览器在控件获得焦点时程序化滚动（`scrollTop` 变大且没有滚动条可恢复），切换设置会整页下坠。唯一允许滚动的是 `.tf-sidebar-scroll`。
- **泛音 / 技巧连接**：泛音形状由 `resolvedNoteShape()` 覆盖为菱形（可关）；连接目标必须取 alphaTab 的 `slideTarget` / `hammerPullDestination` / `slurDestination` 模型指针，按 played-order occurrence 映射，只有目标被 tie 合并时才回退到同弦下一个音符。
- **近距离合并形状**：`planMergedGroups()` 只在同弦、非泛音/非纯数字、中心距 <= `mergeDistance × noteH` 时合并；合并组由 `drawMergedBodies()` 画唯一形体，组内音符只画数字。远距离/跨弦/泛音仍走 `drawNoteLinks()`。不要按时间阈值硬编码，距离要用当前布局的像素。合并形体必须复用单音符的辉光逻辑（`noteGlow()` 精灵沿形体拉伸 + 随 `noteGlow`/贴近判定线的 shadowBlur），否则连成一体的音符会显得没有辉光。
- **透视视图**：`drawLaneFrame` 先把背景画在目标画布，再把轨道层（底板/弦线/音符/判定线/特效，以及 READY 倒计时和连击数 `drawLaneHud()`）画进缓存透明层，用 `drawPerspective()` 按条带平铺做投影变形，最后叠加平面 HUD（标题/信息/进度条/水印）；预览与导出共用这条路径。**近端比例恒为 1、只收窄远端，并按近端归一化后居中**：纵深方向的总尺寸按 cos 缩小（横向透视时画面总宽度变小），任何元素都不放大，因此不会被画幅裁切；条带必须无重叠平铺（透明层重叠会叠出亮边）；只有 READY/连击跟着轨道层变形，标题/信息/进度条/水印必须保持平面。
- **纯黑叠加模式**：`backgroundMode: 'black'` 时背景必须正好是 `#000`，不画渐变/暗角/底板，`drawFrameEdgeFade()` 在所有非 HUD 图层之后、HUD 之前把四边淡到 0（至少 32px，覆盖两个编码块），并补 2px 实心黑边；HUD 用 7.5% 内边距、进度条内缩。不要改回全出血进度条或加回侧轨，否则叠加合成会出现边缘突变。
- **导出片头**：预告阶段（`clock < 0`）的画面必须用**负时间外推谱面**（`tickAtTimeUnclamped(laneTime)`），和预览 `currentFrame()` 一致；不要把 scoreTime 夹到 0，否则整段倒数的音符会停在开局位置，音乐一响才突然开始下落。
- **导出音频时间轴**：内置伴奏是真实录音，只能按同步点算出区间后**原生速率整体截取**，视频时间轴用反函数 `scoreAtClock()` 从音频位置求谱面时间；不要重采样把伴奏拉伸到谱面 tempo（每个同步点区间的比率不同，会持续变调）。
- **判定线遮罩**：音符过线后必须继续绘制并由 `hitY` 裁切，不能在 `hit` 时立刻跳过；直到音符顶部也过线才完全不可见。判定/特效仍按中心过线触发。

## 资源

- `vendor/alphaTab.worker.js` 是 classic worker，`api.exportAudio` 依赖它；不要替换成 ESM 入口。
- `vendor/soundfont/sonivox.sf2`、`vendor/font/` 构建时复制到 `dist/assets/`。
- 测试夹具 `samples/tabfall-*.gp` 是原创 AlphaTex 导出的 GP7；不要加入受版权保护的歌曲文件。

## 常用命令

```bash
npm start        # build + serve http://127.0.0.1:4173/
npm run build
npm run typecheck
npm test
```

浏览器测试是可选的：`CHROMIUM_PATH=/path/to/chrome TABFALL_URL=... node tests/e2e.mjs`（Playwright，仅用于无头快速回归）。

**人工/截图验证统一用本机 Firefox + geckodriver**，不要再用 Playwright 自带的 Chromium/Firefox 构建（它驱动不了系统 Firefox，且这台机器会被识别成 ubuntu20.04 而拒绝安装）：

```bash
sudo apt install firefox-geckodriver     # 版本跟随系统 Firefox，推荐
geckodriver --host 127.0.0.1 --port 4444 # 另开终端
```

用 W3C WebDriver 驱动 headless Firefox（`binary=/usr/bin/firefox`，参数 `-headless --width=1440 --height=900`）；上传曲谱前先把隐藏的 `input[type=file]` 临时去掉 `hidden` 并显示出来，再对元素 `sendKeys` 文件路径；截图用元素截图（`.tf-stage canvas`）。验证透视/READY/连击时先 `execute/sync` 写 `localStorage['tabfall.settings.v1']` 再刷新。

## 改动后自查

1. `npm run typecheck && npm test && npm run build`。
2. 载入 `samples/tabfall-demo.gp`，播放到出效果，确认数字在判定线消失、特效在对应弦位。
3. 切换 9:16 / 1:1，确认标题不压住音符列（横屏标题在左侧，方形/竖屏标题在中上方并带 scrim）。
4. 导出一段 720p / 30fps WebM，`ffprobe` 确认分辨率、时长、音视频流；检查音轨非静音。
5. 不要提交 `dist/`、`.browser/`、测试导出的 `.webm/.mp4`。
