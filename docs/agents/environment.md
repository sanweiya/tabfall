# 本机环境

2026-11-15 在本机实测；换机器或升级工具链后请重新核对。

- **仓库位置**：`C:\Users\cx\ZCode\guitar-rhythm-game\tabfall`（纯 ASCII、无空格；不要把仓库挪到含空格/中文的路径，Playwright 的 `executablePath` 和 ffmpeg 参数都容易被引号坑到）。
- **Shell**：PowerShell 7.7.0，是本机唯一 shell。`&&`、`$env:NAME=`、`Get-NetTCPConnection` 都可用；没有 `sudo`，装东西用 `winget`。
- **运行时**：Node 22.23.2 / npm 10.9.8（`engines` 只要求 >=18）。`npm install` 装 21 个包、0 漏洞。
- **浏览器**：
  - Edge 157 —— `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`，**本机唯一 Chromium 系**，Playwright 可直接驱动（已验证）。
  - Firefox 153.6 —— `C:\Program Files\Mozilla Firefox\firefox.exe`，仅在需要抽查 Firefox 渲染时用。
  - 没有 Chrome；也没装 Playwright 自带的浏览器（无 `ms-playwright` 缓存），所以**不要** `npx playwright install`，一律用 `CHROMIUM_PATH` 指向系统 Edge。
- **ffmpeg / ffprobe**：9.0.1 已在 PATH（winget 的 `Gyan.FFmpeg`），导出自查直接用。
- **openssl**：由 Git for Windows 提供（`C:\Program Files\Git\mingw64\bin\openssl.exe`），`npm run cert` 可跑；没生成 `certs/` 时 4174 端口的 HTTPS 会跳过，localhost 下 WebCodecs 导出不受影响。
- **换行**：git 系统级 `core.autocrlf=true`：入库统一 LF，工作区转 CRLF。刚被工具改写的文件可能暂时是 LF，`git` 会提示 `LF will be replaced by CRLF`——这是自动转换的正常提示，不要加 `.gitattributes` 或改 `autocrlf` 去“修”它。
- **控制台**：代码页 936。项目自己的输出（测试、构建）中文正常；若某条命令的管道里出现乱码，先 `chcp 65001`，那是控制台编码问题，不是代码问题。

## 端口：不要假定 4173 空闲

本机实测过另一个项目（页面标题 "Duck Score Motion"）的 `serve.mjs` 占着 `127.0.0.1:4173`，而 Windows 允许它与 `0.0.0.0:4173` 同时监听、且 loopback 连接会被前者抢走——症状是浏览器打开了**另一个应用**，或 Playwright 报元素不匹配。

起服务前先确认归属：

```powershell
Get-NetTCPConnection -LocalPort 4173 -State Listen | Select-Object LocalAddress,OwningProcess
```

必要时换端口：

```powershell
$env:PORT = 4175; $env:HOST = '127.0.0.1'; node scripts/serve.mjs
```

另：`npm start` / `node scripts/serve.mjs` 被强杀时子进程可能残留在端口上，重起会报 `EADDRINUSE`，按 PID 清掉再起。

## 参考项目

原文档里的 `/home/cx/文档/Code/gp-studio` 是**另一台 Linux 机器**上的只读参考，本机没有这个目录（也未装 WSL，`/home/...` 不可达），上游 `sanweiya/gp-studio` 在 GitHub 上也不存在（404）。它只是历史设计来源（横向镜头/平滑参数出自那里）：本机没有它也能完成全部工作；若真要用，克隆到 `C:\Users\cx\ZCode\gp-studio` 并**只读，不要在里面写文件**。
