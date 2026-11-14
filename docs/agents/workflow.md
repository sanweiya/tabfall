# 命令与验证

## 常用命令（PowerShell）

```powershell
npm install          # 首次或依赖变动后；本机已装好
npm start            # build + serve → http://127.0.0.1:4173/
npm run build        # 只构建到 dist/
npm run typecheck    # tsc --noEmit
npm test             # node:test，18 项，约 0.5 s
npm run serve        # 只起服务，不重新构建
npm run cert         # 生成自签名证书，开启 4174 HTTPS
```

2026-11-15 实测：typecheck 通过，18/18 测试通过（~0.5 s），build ~270 ms → `dist/` 16 个文件 13.9 MB。

- 串联用 `&&`（pwsh 7 支持，遇错即停）；`;` 不会中断，别用它串三步自查。
- `npm start` 是前台进程，会在当前窗口一直跑；要并行干活就另开窗口。
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
- **导出验证**：小分辨率（480×270 / 640×360、30 fps）几秒就能跑完，够验证 WebCodecs 路径：

  ```js
  await page.evaluate(() => { /* 写 localStorage.video 后 reload */ });
  const download = await page.waitForEvent('download');
  ```

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

## 部署

推送到 `main` 即由 `.github/workflows/pages.yml` 构建并发布到 <https://sanweiya.github.io/tabfall/>；工作流会跑 typecheck / test / build，不需要本地额外操作。细节见 README 的「部署」一节。
