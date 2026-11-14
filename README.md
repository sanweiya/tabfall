# TABFALL · 音游谱面视频工坊

把 Guitar Pro / MusicXML 曲谱变成**下落式音游六线谱视频**：只保留竖排的六根弦线和数字，音符从上往下落到一条静止的判定线，击中有 Phigros 风格星芒或烟雾散开，最后离线导出带音轨的 MP4 / WebM。

**在线试用**：<https://sanweiya.github.io/tabfall/>（GitHub Pages，每次推送到 `main` 自动重新部署；导出功能需要支持 WebCodecs 的 Chrome / Edge）

## 它是什么

- **解析**：alphaTab 1.9 负责读取 `.gp3/.gp4/.gp5/.gpx/.gp/.gp7/.gp8/.musicxml/.mxl`，也支持 `.alphatex`。
- **音频**：alphaTab 播放内置伴奏；没有伴奏时用 Sonivox 音色库实时合成。预览和导出都使用 alphaTab 的音频时钟。
- **画面**：不使用 alphaTab 的制谱 SVG 排版，而是把 alphaTab 解析出的 played-order tick（已处理反复、跳跃、速度变化）投影到自制的竖排音游轨道上。这样才能做到“数字占用长度 = 书写时值”，而不是制谱软件的横向排版间距。
- **导出**：逐帧调用与预览同一个渲染函数，用 WebCodecs + Mediabunny 封装，不是录屏。

## 功能

| 需求 | 实现 |
|---|---|
| 音频同步 | alphaTab `timePosition` 是唯一时间基准；带内置伴奏的 GP 文件直接播放伴奏，无伴奏时用合成器。 |
| 竖排单行六线谱 | 六根弦线竖排、时间向下；判定线固定不动，音符从上方落入。弦序可切换“高音弦在右/左”（alphaTab 的弦号 1 = 最低音弦）。 |
| 只显示谱线和数字 | 不画小节线、符杆、休止符、谱号、歌词。数字保持正向，谱线是竖向的。可选拍点参考线，默认关闭。 |
| 击中特效 | Phigros 星芒、烟雾散开、火花、无；命中后数字立即消失，可按弦/技巧着色。 |
| 平滑算法 | 本地预测音频时钟 + 一阶低通 + 预读补偿；只平滑画面滚动，不影响音频、判定和击中时刻。 |
| 时值长度 | 默认按拍子（tick）线性排布：4 分音符严格占 4 个 16 分音符；可选按时间线性排布。尾迹模式可把音符时值画成 hold 长度。 |
| 纯黑叠加模式 | 背景可切换为真正的 #000，无渐变/暗角/底板；辉光与所有非 HUD 图层在边框前渐变到 0，可直接用加亮/滤色叠到别的视频上。 |
| 透视视图 | 轨道平面可绕水平或垂直轴旋转，纵向/横向透视、角度 -60°~+60° 可调；以近端为基准归一化（不放大、不裁切），只收窄远端，画面在纵深方向的总尺寸随之变小；READY 与连击数跟随透视，标题/进度条/水印保持平面。 |
| 外观自定义 | 预设主题、背景色/背景图、弦线、音符形状/配色/字体/圆角/辉光、判定线、尾迹、HUD、连击等；泛音默认菱形，击勾弦/滑音可连接音符 |

## 快速开始

要求 Node.js ≥ 18；导出需要支持 WebCodecs 的 Chrome / Edge。

```bash
npm install
npm start           # 构建并启动 http://127.0.0.1:4173/
```

局域网远程访问并需要导出视频时，用 HTTPS：

```bash
npm run cert        # 生成自签名证书（自动包含本机 LAN IPv4）
npm start           # 同时开启 http://<LAN-IP>:4173 和 https://<LAN-IP>:4174
```

浏览器第一次打开 HTTPS 会提示证书不受信任，点“高级 → 继续访问”即可；之后该来源被视为安全上下文，WebCodecs 视频导出可用。IP 变化后重新运行 `npm run cert` 并重启。

也可以分开：

```bash
npm run build       # 只构建到 dist/
npm run serve       # 只启动静态服务（默认同时尝试 4174 HTTPS，证书缺失时自动跳过）
npm run typecheck
npm test
```

**必须通过 http 访问**，不要双击 `dist/index.html`：alphaTab 需要 fetch worker、字体和音色库，`file://` 会被浏览器拦截。

打开页面会自动载入一段内置原创示例 `Neon Run`（AlphaTex）。点击「打开曲谱」或把 GP 文件拖进窗口即可替换。

## 部署

线上版本由 GitHub Actions 构建并发布到 GitHub Pages：

- **地址**：<https://sanweiya.github.io/tabfall/>
- **触发**：推送到 `main`，或在 Actions 页面手动 `Run workflow`（`gh workflow run "Deploy to GitHub Pages"`）。
- **流程**：`npm ci` → `npm run typecheck` → `npm test` → `npm run build` → 把 `dist/` 作为 Pages 产物上传并部署。
- **前提**：仓库 Settings → Pages → Source 选择 **GitHub Actions**（本仓库已配置，等价于 `gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow`）。
- **子路径**：这是项目站点，位于 `/tabfall/` 下。`index.html` 只用 `./app.js` / `./app.css` 这类相对路径，应用本身用 `document.baseURI` 推导 `assets/` 前缀，所以构建时不需要额外的 basePath 参数。

因为 Pages 是 HTTPS 来源，线上版本的 WebCodecs 导出可直接使用（本地用 `file://` 打开则不行）。

## 使用

1. **载入**：拖入 `.gp*` / `.musicxml` / `.alphatex`。曲谱在本地解析，不会上传。
2. **选轨道**：右侧轨道下拉会显示每个轨道的弦数、音符数，以及该轨道从第几秒开始。主音吉他通常在开头就进入；如果某轨前奏很长，会出现「跳到首音」按钮。
3. **预览**：播放 / 暂停、`Home` 重开、方向键 ±1 秒、拖动进度条。
4. **调外观**：「布局 / 外观 / 特效 / 视频」四个页签。所有改动实时生效，自动保存到 `localStorage`（背景图只保留在当前会话）。
5. **导出**：视频页签 →「导出视频」，或右上角按钮。先选画幅、帧率、格式和质量，再开始离线渲染。完成后会自动下载，也可以再次下载。
6. **收窄侧栏**：左上角的曲谱卡片可以折叠成一行——点卡片右上角的箭头折叠，折叠后点整行展开。折叠状态记在本地（`localStorage`），下次打开保持，方便长时间调参时给下面的设置面板腾地方。

### 快捷键

| 键 | 动作 |
|---|---|
| `Space` | 播放 / 暂停 |
| `Home` | 从头开始（带预备时间） |
| `←` / `→` | 后退 / 前进 1 秒 |
| `E` | 打开导出对话框 |

## 关键设计

### 竖排六线谱

横向六线谱顺时针转 90° 后，时间轴变成“从上往下”，弦线变成竖线。数字如果跟着旋转就会侧躺，所以渲染时**每个数字都保持正向**（等价于把数字反向旋转 90°）。弦 1（高音 E）默认在右侧，与旋转后的阅读方向一致；可在外观里翻转。

轨道绘制顺序：背景 → 轨道底板/辉光 → 弦线 → 可选的拍点参考线 → 时值尾迹 → 音符 → 判定线 → 击中特效 → HUD。`drawLaneFrame()` 是预览和导出唯一的绘制入口。

### tick 投影与时值

`core/score-data.ts` 遍历 alphaTab 的 played-order tick lookup：

- 反复、反复次数、跳跃等都由 alphaTab 解析后的 `MasterBarTickLookup` 表示；
- 同一个 beat 对象在反复时会以不同 `occurrence` 再次出现；
- tie 目的地合并到起点音符，时值累加；
- 每个音符记录 `tick / endTick / timeMs / endTimeMs / string / fret / tags`。

默认布局 `spacing: 'beat'` 下：

```text
y = hitY - (note.tick - visualTick) * pxPerTick
pxPerTick = pxPerBeat / 960
```

所以 4 分音符（960 tick）是 16 分音符（240 tick）的 4 倍长度，和速度变化无关；速度变化时滚动速度随之改变（听起来像“曲子变快，谱面也变快”）。切到 `spacing: 'time'` 后则每秒距离固定。

尾迹模式 `long` 只画长音/连音，`all` 给所有音符画时值尾迹，`off` 关闭。尾迹长度直接由 `endTick - tick` 映射，因此可以把“4 分音符真正占 4 个 16 分长度”直接看出来。

### 平滑

没有平滑时，alphaTab 的音频时钟回调粒度较粗，画面会一顿一顿。实现分两层：

1. **本地预测时钟**：每帧按墙钟时间前进，再用 `api.timePosition` 做缓慢修正；偏差过大时直接对齐（如拖动进度）。
2. **显示位置一阶滤波 + 预读**：与参考项目 GP Studio 横向镜头的思路一致：

```text
tau       = 0.02 + 0.34 * strength²
lookahead = tau * factor(mode)          // off 0 / 保守 0.6 / 标准 0.9 / 激进 1.0
target    = position(audioTime + lookahead)
visual   += (target - visual) * (1 - exp(-dt / tau))
```

音频时间、tick、判定和特效时间戳完全不受滤波影响。拖动进度、跨段跳跃时直接 snap，不会滑过反复段。

### 预备拍与时间轴

视频时间轴从 `-leadIn` 开始：

- 前 `leadIn` 秒画面显示倒计时 `READY 3/2/1`，音符从上方提前落下；
- 音频在 `scoreTime = 0` 时开始；
- 最后一个音符后继续渲染 `outro` 秒尾奏留白。

预览和导出使用同一套负时间 tick 外推（`tickAtTimeUnclamped`），所以片头是预览里看到的样子：倒计时期间音符已经在判定线上方下落，数到 0 时第一音正好过线。

### 泛音与连接

- **泛音菱形**：`Note.isHarmonic` 在解析时写成 `harmonic` 标签，渲染时 `resolvedNoteShape()` 会强制使用菱形（可在外观里关闭这个覆盖）。菱形里的数字仍然是正向的；全局音符形状也提供菱形选项。
- **击勾弦 / 连音 / 滑音连接**：alphaTab 在起始音符上保存了 `hammerPullDestination`、`slurDestination`、`slideTarget`。`attachLinks()` 把这些模型指针映射到 played-order 的音符事件上（反复时按 occurrence 匹配；目标被 tie 合并时回退到同弦的下一个音符）。
- **近距离形状合并**：同弦、非泛音/纯数字、中心距小于 `合并距离 × 音符高度` 的连接音会合并成一个连续形体。圆形会变成竖向胶囊，胶囊/方形会变成连续长条；内部不再保留各自的形状边框，数字直接排在这条形体上。`合并距离` 默认 1.6 倍音符高度，可在外观里调。
- **远距离连线**：超出合并距离、不同弦、泛音或纯数字时，使用 **缎带 / 细线 / 虚线** 的曲线连接；击勾弦/连音和滑音可以分别开关。
- 起始音符击中后，合并形体或连线会从判定线继续延伸到目标音符，直到目标也到达判定线。
- 所有连接、菱形和数字都走同一条 tick/time 投影，所以倍速、速度变化、竖屏导出都保持一致。

### 击中与特效

判定使用**原始音频时钟**（不是平滑后的画面位置）：当 `clock >= note.timeMs` 时在判定线对应弦位生成特效。判定线同时是一层**遮罩**：音符中心过线后不会突然消失，而是被线裁切，继续露出仍在线上方的部分；直到音符顶部也过线才完全消失。特效粒子用固定种子生成，导出与预览逐帧一致。

- **Phigros**：扁平几何风格——加粗的正位方框、45° 菱形框、两段加粗旋转圆弧、中心圆点，以及少量尺寸较大的实心方形碎片（约三分之一随机虚化，其余保持清晰）；不使用叠加式光晕或星芒。
- **烟雾**：多组柔和烟团 + 受压上升的粒子，数字化成烟散开。
- **火花**：短促的放射光点。
- **无**：直接消失。

### 音频与导出

- 预览：alphaTab 的 `EnabledAutomatic` 播放器；音频时钟来自 `api.timePosition`。
- 导出：先离线生成音频（合成器或内置伴奏），再解码到 48 kHz，按 `leadIn/outro` 拼接成完整时间轴；视频逐帧绘制到离屏 canvas，然后由 WebCodecs 编码、Mediabunny 封装。
- **内置伴奏按原生速率截取，不做时间拉伸**：先按同步点算出覆盖全曲的音频区间，再把它整体搬到 48 kHz 输出缓冲；视频时间轴反过来由音频位置求谱面时间（`scoreAtClock`），与预览一致。重采样到谱面 tempo 会让音高随小节变化，是必须避免的。
- 多轨曲谱只导出当前选中轨道的合成音频（`trackVolume` 其余轨道为 0）；预览端用 `changeTrackSolo` 达到同样效果。
- 映射内置伴奏时使用 alphaTab 的 `MidiFileGenerator.generateSyncPoints()`（`synthTime ↔ syncTime` 线性插值），所以 Guitar Pro 的音频同步点会被保留。
- 导出前会对音频做峰值限制，避免 Opus 编码削波。

| 容器 | 视频 | 音频 |
|---|---|---|
| MP4 | H.264（avc1） | AAC；浏览器没有 AAC 编码器时回退 Opus，并在成功页提示 |
| WebM | VP9（回退 VP8） | Opus |

> Chromium 在部分 Linux 发行版上不提供 AAC 编码器，这是浏览器能力问题，不是文件问题；MP4 + Opus 在 Chrome / VLC 可正常播放。

## 自定义一览

- **布局**：拍/时间基准、每拍距离或每秒速度、平滑强度、预读补偿、判定线高度、轨道宽度、水平位置、音符大小、透视视角（纵向/横向/关闭）与角度、预备时间、尾奏。
- **外观**：5 套主题预设；背景上下色/背景图（压暗、模糊）；轨道底板和辉光；弦线颜色/粗细/透明度；弦序、弦名、弦号；音符形状（胶囊/圆/方/菱形/纯数字）、按弦/强调色/技巧配色、8 色盘、宽高/圆角/描边/辉光、字体、数字自动对比；泛音菱形开关；技巧角标；击勾弦/连音/滑音连接、近距离合并开关与合并距离、远距离缎带/细线/虚线样式；时值尾迹模式/宽度/透明度；判定线颜色/粗细/光晕/长度；拍点参考线；标题/艺术家/曲谱信息/进度条/水印/连击；READY 与连击文字尺寸。
- **特效**：Phigros / 烟雾 / 火花 / 无、强度、时长、判定线闪光、连击。
- **视频**：16:9、9:16、1:1、4:5、自定义尺寸；30/60 fps；MP4/WebM；低/标准/高码率；含音轨；文件名。

## 目录

```text
index.html
src/
  main.tsx            入口
  App.tsx             工作台外壳、播放/导出状态
  panels.tsx          四个设置页签
  ui/controls.tsx     滑块、开关、颜色等控件
  storage.ts          localStorage / 格式化
  app.css             全部 UI 样式
core/
  score-data.ts       alphaTab 模型 -> 竖排音符事件
  timeline.ts         tick/ms 映射、反复、平滑滤波器
  engine.ts           alphaTab 播放器、预览循环、命中判定
  export-video.ts     WebCodecs 离线导出
  render/lane.ts      竖排音游轨道渲染器
  render/effects.ts   击中特效
  types.ts            设置与数据模型
  demo.ts             内置示例 AlphaTex
vendor/               alphaTab worker/core、Bravura、Sonivox
scripts/              esbuild 构建、零依赖静态服务器
samples/              原创 GP7 测试夹具
tests/                单元测试与可选浏览器测试
docs/                 截图
```

## 开发与测试

```bash
npm run typecheck
npm test                 # 解析、反复、tie、时值比例、弦序、预备拍外推
npm run build
```

单元测试使用 `samples/tabfall-*.gp`，它们是由 `tests/make-fixtures.ts` 从内置 AlphaTex 导出的原创 GP7，不含第三方歌曲。

可选的浏览器端到端测试（Playwright，需要本机有 Chromium / Chrome）：

```bash
# 先用 npm start 或 npm run serve 起服务
CHROMIUM_PATH=/path/to/chrome TABFALL_URL=http://127.0.0.1:4173/ node tests/e2e.mjs
```

需要人工看画面/截图时，用**本机 Firefox + geckodriver**（不要用 Playwright 自带的浏览器构建）：

```bash
sudo apt install firefox-geckodriver   # 版本跟随系统 Firefox
geckodriver --host 127.0.0.1 --port 4444
# 然后用 W3C WebDriver 驱动 firefox --headless，截图 .tf-stage canvas
```

会检查：页面载入、画布尺寸、播放后时钟与连击、无控制台错误，并截图到 `tests/artifacts/e2e.png`。

如果需要重新生成 GP 夹具：

```bash
npx tsx tests/make-fixtures.ts
```

## 已知限制

- 一次只显示/播放一个轨道；切换轨道会保留当前播放位置。
- 只做六线谱投影，不显示标准五线谱、歌词、和弦图、反复记号等制谱信息。
- 推弦/滑弦技巧以角标和颜色表示，不画音高曲线；泛音为菱形数字。
- 没有片段裁剪；长前奏会按曲谱完整进入视频，可用「跳到首音」先预览主段。
- 背景图不写入 localStorage（避免配额问题），刷新后需重新选择。
- 导出的帧率和分辨率受浏览器 WebCodecs 编码器限制；远程设备必须走 HTTPS（自签名即可）才能导出。
- 音频合成质量取决于 Sonivox 音色库和曲谱的 MIDI 信息。

## 第三方组件与许可

- [alphaTab](https://www.alphatab.net/) 1.9.0 — MPL-2.0。解析、播放、MIDI 生成、音色库和音频导出都由它完成。许可文件：`vendor/alphaTab-LICENSE`。
- [Bravura](https://github.com/steinbergmedia/bravura) SMuFL 字体 — SIL Open Font License 1.1。`vendor/font/`。
- [Sonivox](https://github.com/pschatzmann/sonivox) SoundFont — 见 `vendor/soundfont/LICENSE`。
- [mediabunny](https://mediabunny.dev/) — MPL-2.0（MP4/WebM 封装）。
- 平滑参数与“只滤波画面、不滤波音频”的设计参考了本地项目 `gp-studio`（Duck Score Motion）的横向镜头实现；本工具的竖排投影、音游渲染和导出管线为独立实现。

alphaTab 是 alphaTab 项目的名称；本工具与 alphaTab 官方无隶属关系。
