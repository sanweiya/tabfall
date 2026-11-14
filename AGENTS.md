# TABFALL — 维护说明

音游风格六线谱视频工坊：载入 Guitar Pro / MusicXML 谱面，竖向下落播放并离线导出带音轨的视频。
TypeScript + React + alphaTab 1.9 + WebCodecs（Mediabunny 封装），构建用 esbuild。

细节都在 `docs/agents/`，按需打开；不要把内容抄回本文件：

| 文档 | 里面有什么 |
|---|---|
| [invariants.md](docs/agents/invariants.md) | 全部不变式（渲染 / 时间与音频 / 多轨 / 透视 / 存储），改代码前读对应条目 |
| [environment.md](docs/agents/environment.md) | 本机环境：Node、Edge/Firefox、ffmpeg、端口坑、参考项目 |
| [workflow.md](docs/agents/workflow.md) | 命令、浏览器验证配方、改动后自查、部署 |
| [known-issues.md](docs/agents/known-issues.md) | 已知限制与还没修的坑 |

## 红线（细则见 invariants.md）

- 预览与导出**共用** `core/render/lane.ts` 的 `drawLaneFrame`；视觉改动必须同时影响两条路径。
- **音频时钟是唯一真相**：`api.timePosition` 驱动判定，`ScrollSmoother` 只影响绘制位置。
- 默认 `spacing: 'beat'` 是 tick 线性（4 分音符 = 4 个 16 分音符），不要改回 alphaTab 制谱间距。
- 多轨：预览 `changeTrackSolo`，合成导出必须给其他轨 `trackVolume: 0`。
- 片头（`clock < 0`）用 `tickAtTimeUnclamped` 负时间外推，**不要**把 scoreTime 夹到 0。
- 内置伴奏只按同步点**原生速率截取**，视频时间用反函数 `scoreAtClock()`，不要重采样拉伸 tempo。
- 纯黑模式：`#000` 背景 + `drawFrameEdgeFade()` 让四边恰好为 0，条带/进度条/图例都不能破边缘。
- 判定线是遮罩：过线后继续绘制并用 `hitY` 裁切，判定仍按中心过线触发。
- 两个 localStorage 键分开：`tabfall.settings.v1`（项目设置）与 `tabfall.ui.v1`（纯界面偏好，不进导出）。
- 根容器不可滚动：`.tf-app` 用 `position: fixed` + `overflow: clip`，唯一可滚的是 `.tf-sidebar-scroll`。

## 命令

```powershell
npm install
npm start            # build + serve → http://127.0.0.1:4173/
npm run typecheck && npm test && npm run build
```

`npm test` 当前 18 项、约 0.5 s。浏览器冒烟、截图与导出自查见 [workflow.md](docs/agents/workflow.md)。

## 提交前

1. `npm run typecheck && npm test && npm run build` 全绿。
2. 动过渲染 / 时间轴 / 导出：按 [workflow.md](docs/agents/workflow.md) 的自查清单手验一遍。
3. 不提交 `dist/`、`tests/artifacts/`、测试导出的 `*.webm /*.mp4`（`.gitignore` 已覆盖）。
