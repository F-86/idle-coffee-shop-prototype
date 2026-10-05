# 文件 / iCloud 路径探针执行记录

日期：2026-10-05 UTC。基线：`59c77998a95e23aa508a855e46b79561a4422f01`，tree `45c44db712c7307a0da44214423561967ce8cc85`。任务分支：`codex/icloud-file-probe`。环境：云 Linux、Node 24.19.0、项目锁定 TypeScript/Vite。全部输入为合成数据；未访问用户 Mac、iCloud 账户或真实游戏档。

## 已验证

- **PASS** TC-FILE-001–013：13/13 Node 用例。真实 File/ArrayBuffer 和 WebCrypto API 用于文件字节/UTF-8/hash 检查，独立 `node:crypto` SHA-256 作为 oracle。选择器与写流由测试替身验证，不冒充系统实测。
- **PASS** 独立 `tsc --noEmit -p qa/file-probe/tsconfig.json`。
- **PASS** 项目 `node --check app.js`、`npm run typecheck`、`npm test`，251/251 既有游戏测试。
- **PASS** 默认游戏生产构建；仍有既有大 chunk 提示，不是测试失败。
- **PASS** 独立探针构建，输出 `.qa-dist/file-probe/`，不依赖 Babylon/game bundle。
- **PASS** 源码/变更范围检查：无游戏源码、默认入口、package scripts、依赖或 `.github/workflows` 变动。
- 代码复核发现 `File.text()` 会消除 UTF-8 BOM，导致“原始字节 hash”不准确。已改为有界 ArrayBuffer 单次读取、严格解码、原始字节 SHA-256 与保存后逐字节比较，并新增 TC-FILE-013 回归。

## 真实 UI 与设备边界

- **BLOCKED** 云端 Chromium UI：安装的 Chromium 154 启动遇到平台 `socket() failed: Operation not permitted`；允许的运行方式复核后仍相同。未绕过限制。
- **BLOCKED** 支持的云浏览器访问独立 localhost 页面：`net::ERR_BLOCKED_BY_CLIENT`。没有像素截图、实际 picker、真实下载/分享的 PASS 证据。
- **NOT_RUN** TC-FILE-014–019：真实浏览器交互、Safari 文件提供方、原生另存为权限、iCloud 正反向双设备到达。下一步须使用允许的设备/浏览器，按[手工测试计划](../../plans/icloud-file-probe.md)执行。
- 没有接受持久授权、登录或创建 CloudKit 容器；没有发布该探针、修改 Pages，或触碰既有 Mac 游戏预览。

## 结论

合成文件逻辑与独立构建通过；原生 UI 和 iCloud 可行性仍待实测。此提交可以用于下一步受控设备验证，不能据此宣称 Safari/iCloud 已通过、自动云存档可用或跨设备同步完成。
