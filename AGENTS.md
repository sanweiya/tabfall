# TABFALL — 维护说明

这是一个独立的“音游风格六线谱视频工坊”：载入 Guitar Pro 谱面，按音游的方式竖直下落播放，并导出带伴奏的视频。

原文档里的参考项目 `/home/cx/文档/Code/gp-studio` 是**另一台 Linux 机器**上的只读参考，本机没有这个目录（也未装 WSL，`/home/...` 不可达），上游 `sanweiya/gp-studio` 在 GitHub 上也不存在（404）。它只是历史设计来源（横向镜头/平滑参数出自那里）：本机没有它也能完成全部工作；若真要用，克隆到 `C:\Users\cx\ZCode\gp-studio` 并**只读，不要在里面写文件**。

## 本机环境

2026-11-15 在本机实测，改动机器后请重新核对。

- **仓库位置**：`C:\Users\cx\ZCode\guitar-rhythm-game\tabfall`（纯 ASCII、无空格；不要把仓库挪到含空格/中文的路径，Playwright 的 `executablePath` 和 ffmpeg 参数都容易被引号坑到）。
- **Shell**：PowerShell 7.7.0，是本机唯一 shell。`&&`、`$env:NAME=`、`Get-NetTCPConnection` 都可用；没有 `sudo`，装东西用 `winget`。
- **运行时**：Node 22.23.2 / npm 10.9.8（`engines` 只要求 >=18）。`npm install` 装 21 个包、0 漏洞，`node_modules/` 已就绪。
- **浏览器**：
  - Edge 157 —— `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`，**本机唯一 Chromium 系**，Playwright 可直接驱动（已验证）。
  - Firefox 153.6 —— `C:\Program Files\Mozilla Firefox\firefox.exe`，仅在需要抽查 Firefox 渲染时用。
  - 没有 Chrome；也没装 Playwright 自带的浏览器（无 `ms-playwright` 缓存），所以**不要** `npx playwright install`，一律用 `CHROMIUM_PATH` 指向系统 Edge。
- **ffmpeg / ffprobe**：9.0.1 已在 PATH（winget 的 `Gyan.FFmpeg`），导出自查直接用。
- **openssl**：由 Git for Windows 提供（`C:\Program Files\Git\mingw64\bin\openssl.exe`），`npm run cert` 可跑；没生成 `certs/` 时 4174 端口的 HTTPS 会跳过，localhost 下 WebCodecs 导出不受影响。
- **端口**：4173（HTTP）/ 4174（HTTPS），**不要假定空闲**。本机实测过另一个项目（页面标题 "Duck Score Motion"）的 `serve.mjs` 占着 `127.0.0.1:4173`，而 Windows 允许它与 `0.0.0.0:4173` 同时监听、且 loopback 连接会被前者抢走——症状是浏览器打开了**另一个应用**，或 Playwright 报元素不匹配。起服务前先确认归属：`Get-NetTCPConnection -LocalPort 4173 -State Listen | Select-Object LocalAddress,OwningProcess`，必要时换端口（`$env:PORT = 4175; $env:HOST='127.0.0.1'; node scripts/serve.mjs`）。<br>另：`npm start` / `node scripts/serve.mjs` 被强杀时子进程可能残留在端口上，重起会报 `EADDRINUSE`，按 PID 清掉再起。
- **换行**：git 系统级 `core.autocrlf=true`：入库统一 LF，工作区转 CRLF。刚被工具改写的文件可能暂时是 LF，`git` 会提示 `LF will be replaced by CRLF`——这是自动转换的正常提示，不要加 `.gitattributes` 或改 `autocrlf` 去“修”它。
- **控制台**：代码页 936。项目自己的输出（测试、构建）中文正常；若某条命令的管道里出现乱码，先 `chcp 65001`，那是控制台编码问题，不是代码问题。

## 不变式

- **预览与导出共用 `core/render/lane.ts` 的 `drawLaneFrame`**。视觉改动必须同时影响两条路径；导出只允许分辨率/帧率不同。
- **音频时钟是唯一真相**。`api.timePosition`（经本地预测）驱动判定；`ScrollSmoother` 只影响画面绘制位置。不要把平滑后的位置用于命中判定。
- **默认 `spacing: 'beat'` 是 tick 线性**：4 分音符 = 4 个 16 分音符。不要改回 alphaTab 的制谱间距；那会破坏需求 6。
- **数字保持正向**，谱线竖排；不画小节线、符杆、休止符。
- **多轨**：预览用 `changeTrackSolo` 只播选中轨；合成导出必须给其他轨 `trackVolume: 0`，否则导出会混入所有乐器。
- **平滑**：`smoothingTau = 0.02 + 0.34 s²`，`lookahead = tau * factor`，参数与 gp-studio 横向镜头一致；改任一个都要同步文档和测试。
- **alphaTab 署名**：画面右下角默认 `TABFALL · alphaTab`；保留 alphaTab 的许可文件与资源的可见署名。
- **localStorage key**：`tabfall.settings.v1`（项目设置）；纯界面偏好（目前是侧栏曲谱卡片的折叠状态）走 `tabfall.ui.v1`，不要混进 `ProjectSettings`——它不该触发引擎重绘或进导出流程。改 key 要写迁移；背景图不落盘。
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

## 常用命令（PowerShell）

```powershell
npm install          # 首次或依赖变动后；本机已装好
npm start            # build + serve → http://127.0.0.1:4173/
npm run build        # 只构建到 dist/
npm run typecheck    # tsc --noEmit
npm test             # node:test，18 项，约 0.5 s
npm run serve        # 只起服务，不重新构建
```

2026-11-15 实测：typecheck 通过，18/18 测试通过（~0.5 s），build ~270 ms → `dist/` 16 个文件 13.9 MB。

- 串联用 `&&`（pwsh 7 支持，遇错即停）；`;` 不会中断，别用它串三步自查。
- 端口被占时：`Get-NetTCPConnection -LocalPort 4173 -State Listen | Select-Object OwningProcess`；换端口用 `$env:PORT = 4175; npm start`。
- `npm start` 是前台进程，会在当前窗口一直跑；要并行干活就另开窗口，不要 `Ctrl+C` 掉正在验证的服务后再怀疑“打不开”。
- 构建产物 `dist/` 被 `.gitignore` 忽略，随时可删：`Remove-Item -Recurse -Force dist`。

## 浏览器验证

冒烟测试（本机已跑通）：

```powershell
npm start                                              # 一个窗口跑服务
$env:CHROMIUM_PATH = "$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe"
$env:TABFALL_URL   = 'http://127.0.0.1:4173/'
node tests/e2e.mjs                                     # 另一个窗口
```

实测输出 `e2e ok: { canvas: { width: 1252, height: 704 }, clock: 905, combo: 4 }`，整页截图落在 `tests/artifacts/e2e.png`（已 gitignore）。

人工看画面/截图也用同一条通道（headless Edge + Playwright），**不需要**为了截图去装 geckodriver：

```js
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.locator('.tf-stage canvas').screenshot({ path: 'shot.png' });   // 区域截图
```

- **上传曲谱**：隐藏的 `input[type=file]` 可以直接喂文件，不用像 Linux 那套 WebDriver 一样先去掉 `hidden`、再 `sendKeys` 路径：

  ```js
  await page.locator('input[type=file]').setInputFiles(path.join(repo, 'samples/tabfall-demo.gp'));
  ```

  Windows 路径交给 `path.join()`，别手拼反斜杠。

- **改设置再刷新**：`tabfall.settings.v1` 的结构是 `{ layout, appearance, video }`。画幅由 `video.width/height` 决定（9:16 = `1080×1920`，1:1 = `1080×1080`），**没有**单独的 `aspect` 字段；透视是 `layout.perspectiveAxis`（`'off' | 'vertical' | 'horizontal'`）+ `layout.perspectiveAngle`。写完 `page.reload()` 生效。
- Firefox 只在需要确认“Firefox 用户看到的效果”时抽查 —— 本项目多数用户在 Linux 桌面，Firefox 常是他们的默认浏览器。本机未装 geckodriver，需要时：`winget install --id Mozilla.GeckoDriver -e`，然后 `geckodriver --host 127.0.0.1 --port 4444`，W3C WebDriver 的 `binary` 用 `C:\Program Files\Mozilla Firefox\firefox.exe`（参数 `-headless`）。日常回归不必走这条路。

## 改动后自查

1. `npm run typecheck && npm test && npm run build`（本机已通过）。
2. 载入 `samples/tabfall-demo.gp`（“载入示例”按钮或 `setInputFiles`），播放越过 2 s 预备，确认数字在判定线被裁切、特效落在对应弦位。
3. 切换 9:16 / 1:1（分辨率下拉，或写 `video.width/height`），确认标题不压住音符列：横屏标题在左侧，方形/竖屏标题在中上方并带 scrim。
4. 导出一段 720p / 30fps WebM，用 PATH 里的 ffprobe 校验分辨率、时长、音视频流：

   ```powershell
   ffprobe -v error -show_entries stream=codec_type,width,height:format=duration -of default=nw=1 "tests\out.webm"
   ffmpeg -hide_banner -i "tests\out.webm" -af volumedetect -f null -   # 音轨非静音：mean_volume 不应是 -inf
   ```

5. 不要提交 `dist/`、`.browser/`、`tests/artifacts/`、测试导出的 `.webm/.mp4`（`.gitignore` 已覆盖）。

## 已知限制（2026-11-15 审查，未修）

- **每帧全量扫描**：`drawLaneScene` 从第 0 个音符扫到可视窗口，`planMergedGroups` / `drawNoteLinks` 每帧为整条轨建 Map/Set。几千音符的谱面会线性变慢（导出时逐帧如此）。改法是二分可视起点、按 `(track, layout, appearance)` 缓存 merge 计划——两条路径共用 `drawLaneFrame`，改一次即可。
- **透视时弦名图例不随条带变形**：`drawStringLegend` 在 `drawPerspective` 之后平面绘制（只补了纯黑模式的边缘安全距离）。要贴合变形后的弦线，得把它移进 `drawLaneScene`。
- **离线合成没有超时**：`synthesizeScoreAudio` 的 `await api.exportAudio(...)` 若 worker 起不来（`alphaTab.worker.js` 404 / CSP 拦截）会永不返回，UI 卡在「正在渲染音轨」，取消按钮只在拿到 exporter 之后的渲染循环里生效。
- **音色库缺失不会告警**：`soundfont` fetch 失败时 alphaTab 仍会返回静音数据块，于是导出「有音轨但无声」且 `warning` 为空。修法是把 fetch 失败标志透传到 warning。
- **MP4 + Opus 回退（无 AAC 时）未端到端验证**：播放器不支持时错误要在 `output.finalize()` 才暴露，而不是在 `chooseAudioCodec` 阶段明确报错。
- **无真实伴奏夹具**：同步点映射（`mapScoreToAudio` / `mapAudioToScore`）只有数学对齐，没有带 backing track 的 GP 文件做端到端验证；补一个夹具能覆盖。
- **Firefox 未验证**：预览和导出都只在 Edge 上跑过；WebCodecs 支持面在 Firefox 上不同，导出会走 warning/降级路径（未实测）。
