# 命令与验证

## 常用命令（bash）

```bash
npm ci               # 首次或依赖变动后；本机已装好（node_modules 不能从 Windows 拷）
npm start            # build + serve → http://127.0.0.1:4175/
npm run build        # 只构建到 dist/
npm run typecheck    # tsc --noEmit
npm test             # node:test，18 项，约 0.6 s
npm run serve        # 只起服务，不重新构建
npm run cert         # 生成自签名证书，开启 4176 HTTPS
npm run test:firefox # geckodriver + 本机 Firefox 冒烟测试（需先起服务）
```

2026-11-16 实测：typecheck 通过，18/18 测试通过（~0.58 s），build ~287 ms → `dist/` 16 个文件 14 MB。

- 串联用 `&&`（bash 遇错即停）；`;` 不会中断，别用它串三步自查。
- `npm start` 是前台进程，会在当前终端一直跑；要并行干活就另开终端，或 `npm start > /tmp/tabfall.log 2>&1 &` 后 `tail -f`。
- 端口是 **4175 / 4176**，不是 4173 —— 4173 被同级项目 `dynamic-guitar-tab` 占着，详见 [environment.md](environment.md)。
- 构建产物 `dist/` 被 `.gitignore` 忽略，随时可删：`rm -rf dist`。

## 浏览器验证：geckodriver + 本机 Firefox

本机没有 Chromium 系浏览器，**默认走 Firefox**。`tests/firefox-e2e.mjs` 直接用 W3C WebDriver 驱动系统 Firefox（不依赖 Playwright，也不下载任何浏览器）。geckodriver 在 `~/.local/bin`，升级 Firefox 后若版本不匹配，按 [environment.md](environment.md#geckodriver版本维护已授权自行更新) 自行更新：

```bash
npm run build
npm run serve                    # 终端 1，默认 4175
npm run test:firefox             # 终端 2
```

实测输出（Firefox 160.0 / geckodriver 0.37.1）：

```text
firefox e2e: Firefox 160.0 via geckodriver 0.37.1
firefox e2e ok: { url: 'http://127.0.0.1:4175/', canvas: { width: 1252, height: 704 }, clock: 911, combo: 5, colors: 302, ... }
```

脚本会自己拉起 `geckodriver --host 127.0.0.1 --port 4444`（已有一个在跑就复用，结束时只关自己启动的那个），然后：载入内置示例 → 校验画布尺寸与非空绘制 → 播放并等待 `clock > 900 && combo > 2` → 验证暂停状态下的 `→` / `Home` 快捷键 → 截图到 `tests/artifacts/firefox.png`（整页）和 `tests/artifacts/firefox-canvas.png`（`.tf-canvas` 原图，最适合看渲染）。

可用环境变量：

```bash
TABFALL_URL=http://127.0.0.1:4175/   # 默认值
FIREFOX_BIN=/opt/firefox/firefox     # 默认值；/usr/bin/firefox 是转调它的脚本
GECKODRIVER=geckodriver              # 默认从 PATH 取（本机 ~/.local/bin/geckodriver）
GECKODRIVER_PORT=4444
HEADLESS=0                           # 开可见窗口，需要 DISPLAY
```

手动开一个会话看画面（不跑断言）：

```bash
geckodriver --host 127.0.0.1 --port 4444 --log error &
curl -s -X POST http://127.0.0.1:4444/session \
  -H 'content-type: application/json' \
  -d '{"capabilities":{"alwaysMatch":{"browserName":"firefox","pageLoadStrategy":"eager","moz:firefoxOptions":{"binary":"/opt/firefox/firefox","args":["-headless"]}}}}'
# 之后用返回的 sessionId 调 .../url、.../screenshot、.../execute/sync
```

要点：

- headless 下没有用户手势，音频会被自动播放策略拦掉，alphaTab 时钟停在 0。测试脚本已在 `moz:firefoxOptions.prefs` 里设了 `media.autoplay.default=0`、`media.autoplay.blocking_policy=0`、`media.autoplay.block-webaudio=false`；自己写脚本时也要带上，否则 `clock` 永远不动。
- `execute/sync` 的函数体里**不能写 `await`**（不是 async 函数），要返回 Promise，geckodriver 会等它。
- 页面里的 `window.onerror` 捕获不到加载前的脚本错误；脚本是在载入后挂监听，只能覆盖运行期错误。

## 用 WebDriver 做人工抽查

下面的片段沿用 `firefox-e2e.mjs` 里的命名：`id` 是 sessionId，`wd(method, path, body)` 发 WebDriver 请求，`run(script)` 是 `execute/sync` 的包装。

**上传曲谱**：`input[type=file]` 是隐藏的，先把它显形，再把绝对路径发给它：

```js
await run("const i=document.querySelector('input[type=file]'); i.hidden=false; i.style.cssText='display:block;position:fixed;left:0;top:0;width:200px;height:30px;z-index:9999';");
const element = await wd('POST', `/session/${id}/element`, { using: 'css selector', value: 'input[type=file]' });
const key = element['element-6066-11e4-a52e-4f735466cecf'];
await wd('POST', `/session/${id}/element/${key}/value`, {
  text: '/home/cx/文档/Code/guitar-rhythm-game/tabfall/samples/tabfall-repeat.gp',
  value: ['/home/cx/文档/Code/guitar-rhythm-game/tabfall/samples/tabfall-repeat.gp'],
});
```

实测载入 `samples/tabfall-repeat.gp` 后曲谱卡片变成 “Repeat Test”（载入完 App 会清空 input，`files` 为空是正常的）。路径里有中文没问题，**别用 shell 拼引号**，直接把绝对路径放进 JSON。

**改设置再刷新**：`tabfall.settings.v1` 的结构是 `{ layout, appearance, video }`。画幅由 `video.width/height` 决定（9:16 = `1080×1920`，1:1 = `1080×1080`），**没有**单独的 `aspect` 字段；透视是 `layout.perspectiveAxis`（`'off' | 'vertical' | 'horizontal'`）+ `layout.perspectiveAngle`。用 `execute/sync` 写 `localStorage` 后重新 `POST .../url` 即可生效。

**导出验证**：小分辨率（480×270 / 30 fps）几十秒就能跑完，够验证 WebCodecs 路径。点开右上角「导出视频」→ `.tf-modal` 里选画幅/帧率/格式 → 点 `.tf-modal .tf-btn.is-primary`，等 `.tf-export-done`（成功页会显示文件名、体积、警告）：

```js
await run("document.querySelector('.tf-topbar-actions .is-primary').click()");
await run("document.querySelector('.tf-modal .tf-btn.is-primary').click()");
// 轮询：出现 .tf-export-done 即成功；出现 .tf-warning.is-error 即失败
```

2026-11-16 在 Firefox 160 实测（480×270 / 30 fps，demo 曲谱 0:31.8、956 帧）：

| 格式 | 结果 | 说明 |
|---|---|---|
| WebM | 2.4 MB，成功 | VP9 + Opus |
| MP4 | 3.8 MB，成功 | H.264 + **Opus 回退**，成功页提示“当前浏览器不支持 AAC 编码” |

Firefox 的 WebCodecs 支持面实测：`vp8` / `vp09` / `av01` / `avc1` 视频编码可用，`opus` 音频可用，`mp4a.40.2`（AAC）**不可用**。要看导出文件时，可以在下载对话框里另存，或临时设 `browser.download.dir`；日常自查看成功页的信息就够。

若之后装了 ffmpeg，可进一步校验：

```bash
ffprobe -v error -show_entries stream=codec_type,codec_name,width,height:format=duration -of default=nw=1 tests/out.webm
ffmpeg -hide_banner -i tests/out.webm -af volumedetect -f null -   # mean_volume 不应是 -inf
```

## 渲染性能基准

`npx tsx tests/bench-lane.ts`（不进 `npm test`）用合成大谱量化每帧扫描成本。2026-11-20 修复“每帧全量扫描”后的实测（6000 音符、1920×1080）：

| 每帧成本 | 修复前 | 修复后 |
|---|---|---|
| merge 计划（union-find 全曲重建） | ~4.95 ms | ~0.0007 ms（缓存命中，≈6700×） |
| 可见音符扫描 | ~3016 个/帧 | ~38 个/帧（二分窗口） |
| 链接遍历 | 6000 个/帧 | ~44 个/帧（窗口化） |
| 合并组映射 | 全组音符/帧 | 每组 2 个端点 + 可见组 |

改渲染算法时的**逐像素 A/B**（证明行为不变的最强手段）：`window.__tabfall.engine.seek(t)` 会清特效、重置平滑器并立即绘制定帧。流程：`git stash push -- core/render/lane.ts` → `npm run build` → 起 4175 服务 → 用 WebDriver 会话 `seek(12000)`/`seek(2500)` 各等 300 ms，`getImageData` 全画布在页面内算 FNV-1a 哈希 → `git stash pop` → 重建 → 同法再算 → 两个位置的哈希都必须一致（2026-11-20 修复时实测 `d17f5ef2` / `96dfcd90`，新旧完全相同）。

## Chromium 通道（本机不可用）

`tests/e2e.mjs` 是 Playwright 版本，需要本机有 Chromium / Chrome：

```bash
CHROMIUM_PATH=/path/to/chrome TABFALL_URL=http://127.0.0.1:4175/ node tests/e2e.mjs
```

本机既没有 Chromium 也没装 Playwright 的浏览器缓存，**不要**为了它 `npx playwright install`；需要 Chromium 行为时再单独评估（比如临时装 `chromium` 包），日常回归用 Firefox 通道。

## 改动后自查

1. `npm run typecheck && npm test && npm run build`（本机已通过）。
2. 起服务（4175）后 `npm run test:firefox`，看 `tests/artifacts/firefox-canvas.png`：数字应为正向、在判定线处被裁切，特效落在对应弦位。
3. 载入 `samples/tabfall-demo.gp` 或点「载入示例」，播放越过 2 s 预备，确认连击增长、无控制台错误（脚本已断言）。
4. 切换 9:16 / 1:1（分辨率下拉，或写 `video.width/height`），确认标题不压住音符列：横屏标题在左侧，方形/竖屏标题在中上方并带 scrim。
5. 导出一段 480×270 / 30 fps 的 WebM 与 MP4，确认成功页信息与上表一致（MP4 在 Firefox 上应出现 Opus 回退提示）。
6. 不要提交 `dist/`、`.browser/`、`tests/artifacts/`、测试导出的 `.webm/.mp4`（`.gitignore` 已覆盖）。

## 部署

推送到 `main` 即由 `.github/workflows/pages.yml` 构建并发布到 <https://sanweiya.github.io/tabfall/>；工作流会跑 typecheck / test / build，不需要本地额外操作。细节见 README 的「部署」一节。**推送即发布**，未经明确许可不要 push。
