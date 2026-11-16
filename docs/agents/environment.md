# 本机环境

2026-11-16 在本机（LMDE 7 / Linux）实测；换机器或升级工具链后请重新核对。
本项目是从 Windows 机器整目录拷过来的，下面几条「拷贝遗留」都踩过，别重复踩。

- **仓库位置**：`/home/cx/文档/Code/guitar-rhythm-game/tabfall`。路径含中文（`文档`），对本机 Node / npm / bash / geckodriver 都没问题；只是报错栈里会把中文转成 `%E6%96%87%E6%A1%A3`，属正常现象，不要为此挪目录或改 `TMPDIR`。
- **Shell**：bash 5.2（`/bin/bash`），不是 PowerShell。命令用 `&&` 串联、`VAR=value cmd` 传环境变量、`ss -ltnp` 查端口。
- **系统**：LMDE 7 (gigi)，x86_64，时区 Asia/Shanghai，`LANG=zh_CN.UTF-8`。
- **运行时**：Node 26.13.1 / npm 11.20.0（`engines` 只要求 >=18）。`npm ci` 装 21 个包、约 1.3 s、0 漏洞。
  - npm 11 会提示 `esbuild` 的 postinstall 未获批准（`npm warn install-scripts`）。**可以忽略**：esbuild 通过可选依赖 `@esbuild/linux-x64` 取二进制，构建实测正常。真遇到 `You installed esbuild for another platform`，说明 `node_modules` 又是从 Windows 拷来的，删掉重装即可（见下）。
- **浏览器**（**没有 Chromium 系**）：
  - Firefox 160.0 —— LMDE 软件包，真实二进制 `/opt/firefox/firefox`，`/usr/bin/firefox` 只是转调它的 shell 脚本。这是本机唯一浏览器。
  - geckodriver 0.37.1 —— `~/.local/bin/geckodriver`（手动装的独立二进制，已在 PATH），与 Firefox 160 配对正常（已实测建会话、播放、截图、导出）。升级 Firefox 后若版本不匹配，按 [「geckodriver：版本维护」](#geckodriver版本维护已授权自行更新) 自行更新，不用先问。
  - 没有 Chrome / Chromium / Edge，也没有 Playwright 自带的浏览器（无 `~/.cache/ms-playwright`）。所以 `tests/e2e.mjs`（Playwright + `CHROMIUM_PATH`）在本机**跑不了**；日常浏览器验证走 `tests/firefox-e2e.mjs`（geckodriver，零额外依赖）。不要 `npx playwright install` 去补 Chromium——没必要，还会拖几百 MB。
- **ffmpeg / ffprobe**：**没装**。需要校验导出的分辨率/时长时先 `sudo apt install ffmpeg`；日常自查不依赖它（导出成功页会显示文件名、体积、警告）。
- **openssl**：`/usr/bin/openssl` 可用，`npm run cert` 已生成自签证书（`certs/dev-cert.pem` / `dev-key.pem`，已被 gitignore），所以 `npm start` 会同时开 `http://127.0.0.1:4175/` 和 `https://127.0.0.1:4176/`（本机 LAN IP 192.168.1.9 也在 SAN 里；IP 变了要重跑 `npm run cert`）。localhost 本身就是安全上下文，导出不一定需要 HTTPS；远程设备才需要。
- **换行**：拷贝过来时工作区是 CRLF，而 git 索引里是 LF，导致 38 个文件、9 万行「全被修改」的假 diff。已统一转成 LF 并用 `git add -A` 刷新索引，现在 `git status` 干净。
  - 本机 `core.autocrlf` 未设置（Linux 默认 false），**保持现状**：不要设成 `true`，也不要让 Windows 上的编辑器把文件再存成 CRLF。
  - 若又出现「插入行数 = 删除行数」的 diff，先 `git diff --ignore-cr-at-eol` 确认只是换行，再按上面办法把 CRLF 转回 LF。
- **node_modules 不能跨系统拷**：从 Windows 带来的 `node_modules` 里是 `@esbuild/win32-x64`，在本机 `npm test` / `npm run build` 会直接报平台不符（tsx 也依赖 esbuild）。修复就是 `rm -rf node_modules && npm ci`（已做）。`dist/` 同理，重新 `npm run build` 即可。

## 端口：4173 已被别的项目占用

本机 `127.0.0.1:4173` 常驻另一个项目 `/home/cx/文档/Code/dynamic-guitar-tab` 的静态服务（页面标题 "Duck Score Motion"），进程就是 `node scripts/serve.mjs`。所以**本项目默认改用 4175（HTTP）/ 4176（HTTPS）**，`scripts/serve.mjs` 的默认值已改好，不要改回 4173。

起服务前先确认端口归属：

```bash
ss -ltnp | grep -E ':(4175|4176)\b'
```

若 4175 也被占用（比如上次没关干净），临时换一个：

```bash
PORT=4178 TLS_PORT=4179 node scripts/serve.mjs
```

`npm start` / `node scripts/serve.mjs` 被 Ctrl+C 之外的方式强杀时，子进程可能仍占着端口，重起会报 `EADDRINUSE`；用 `ss -ltnp` 找到 PID 再 `kill <pid>`。

## 浏览器验证通道

| 通道 | 命令 | 本机状态 |
|---|---|---|
| Firefox + geckodriver（默认） | `node tests/firefox-e2e.mjs`（需先起服务） | 已跑通：Firefox 160 + geckodriver 0.37.1，截图落在 `tests/artifacts/firefox*.png` |
| Playwright + Chromium | `CHROMIUM_PATH=... node tests/e2e.mjs` | 缺浏览器，跑不了；不要为此装 Playwright 浏览器 |

Firefox 160 的 WebCodecs 实测：VP8 / VP9 / AV1 / H.264 视频编码可用，Opus 音频编码可用，**没有 AAC**。因此 MP4 导出在 Firefox 上会回退到 Opus 音轨并在成功页给出提示（和部分 Linux Chromium 一样），WebM 完全正常。

## geckodriver：版本维护（已授权自行更新）

- **位置**：`~/.local/bin/geckodriver`，解压出来的独立 ELF（不是符号链接），已在 PATH。**不走 apt**：系统包 `firefox-geckodriver` 在本机只装了文档（`dpkg -L firefox-geckodriver` 只有 `/usr/share/doc/...`），apt 升级不会动这个二进制。
- **当前**：geckodriver 0.37.1 + Firefox 160.0。2026-11-16 查证 GitHub 最新版也是 v0.37.1，暂无需更新。
- **授权**：用户 2026-11-16 明确交代——**以后出现版本问题时自行更新 geckodriver，不必再问**。这是本机唯一允许代理自行升级的工具；其它系统包照旧用 apt。
- **什么算版本问题**：`npm run test:firefox` 建会话即失败，典型报错 `Unable to find a matching set of capabilities`、`SessionNotCreatedException`、marionette 握手超时，或 geckodriver 明说不支持当前 Firefox。先核对两边版本：

  ```bash
  geckodriver --version | head -1
  /opt/firefox/firefox --version
  ```

- **更新**（GitHub 走 7890 代理，直连会超时；已按下面这套实测下载成功）：

  ```bash
  TAG=$(curl --proxy http://127.0.0.1:7890 -sL https://api.github.com/repos/mozilla/geckodriver/releases/latest \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["tag_name"])')
  echo "$TAG"
  curl --proxy http://127.0.0.1:7890 -fL -o /tmp/geckodriver.tar.gz \
    "https://github.com/mozilla/geckodriver/releases/download/$TAG/geckodriver-${TAG}-linux64.tar.gz"
  tar -xzf /tmp/geckodriver.tar.gz -C /tmp geckodriver
  install -m 755 /tmp/geckodriver ~/.local/bin/geckodriver
  geckodriver --version
  ```

- **回滚**：更新前留一份旧二进制 `cp ~/.local/bin/geckodriver ~/.local/bin/geckodriver.bak`，出问题覆盖回来即可。
- **更新后必做**：`npm run build && npm run serve`（4175）→ 另一个终端 `npm run test:firefox`，确认输出 `firefox e2e ok`，并看一眼 `tests/artifacts/firefox-canvas.png`。

## 参考项目

`gp-studio`（Duck Score Motion 的早期版本）不在本机——`/home/cx/文档/Code/gp-studio` 不存在。它的逻辑来源是同级的 `dynamic-guitar-tab`（本机正在 4173 上跑的那个项目）：平滑参数、镜头公式出自那里。需要对照时**只读** `dynamic-guitar-tab`，不要在里面改文件；那是一个独立仓库，改坏了会影响它自己的开发。
