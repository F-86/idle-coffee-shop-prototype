# Mellow Bean 文件 / iCloud Drive 独立验证页

目标：用固定合成 JSON 验证浏览器选文件、导出新副本、重新读取与手动跨设备传递。不是游戏导入/导出功能，不是 CloudKit 接入，也不宣称自动云存档。

## 本地运行与独立构建

在仓库根目录，使用现有 Node 24 与已锁定依赖：

```sh
npm ci
npm exec -- vite --config qa/file-probe/vite.config.ts
# 打开 http://127.0.0.1:4191/ ，独立于游戏的 4180 origin

npm exec -- tsc --noEmit -p qa/file-probe/tsconfig.json
node --test qa/file-probe/probe.test.mjs
npm exec -- vite build --config qa/file-probe/vite.config.ts
npm exec -- vite preview --config qa/file-probe/vite.config.ts
```

独立输出为 `.qa-dist/file-probe/`，不进入默认游戏 `dist/`。未改变 package scripts、默认入口、游戏源码、依赖、Pages 工作流或发布目标。此页尚未发布，不能用现有线上游戏网址代替测试页。跨设备需要两台设备各自打开这份页面的副本，或后续单独批准的 HTTPS 托管；本任务未添加发布目标。

## 可观察行为

- 只有明确点击后才打开选择器。初次加载只检测能力，不发起权限请求。
- 通用 `<input type=file>` 导入；Blob/File 下载兜底；增强文件选择器按 secure context 和实际 API 检测；Web Share 必须针对当前 JSON 通过 `canShare({files})`。
- 仅接收本工具固定五字段 schema，固定合成 payload。文件名必须为 `mellow-bean-probe-*.json`、不超过 180 个 ASCII 字符、不含路径；文件最多 16 KiB。无 eval，输出用 textContent。
- 读取原始字节一次，严格 UTF-8 解码，验证 JSON；SHA-256 对原始文件字节计算，包含 BOM/空白差异。无 SubtleCrypto 时明确“无法校验”，不会报告 hash 通过。
- 导出每次生成随机新文件名。增强另存为拒绝更改建议名称和所有非空目标；文件写入后关闭并重新读回，逐字节比较。
- 没有就地编辑。revision +1 只修改内存候选，必须另存新副本。取消、权限拒绝、校验失败保留先前有效内容。
- 本页最多保留 32 条导出比较基准，仅在标签页内存中；刷新后丢失。不保存句柄、不用 localStorage/IndexedDB、不调用 requestPermission、不选目录、不登录或配置 iCloud/CloudKit。
- 不记录云盘提供方或真实路径。分享返回只表示 API 返回；下载请求不等于完成；同机读回一致不等于 iCloud 同步。

## 安全与平台边界

增强保存选择器没有通用的“原子地仅创建全新文件”语义。随机唯一名称、严格保留名称与非空拒绝能保护本工具原始测试文件；这不是并发写入/文件替换的事务保证。只在专门的测试位置选择新文件，不选择任何真实文件。若系统先建立了空文件后本页拒绝写入，可能留下空副本。写入后出错时目标结果可能不确定；不会把它报告为成功。

不要选择浏览器的“每次访问都允许”。本页不主动请求持久权限；若系统无法只授予本次所选测试文件访问，则取消并使用通用选择与下载路线。

Safari 是否显示 iCloud Drive、下载放在哪、能否分享 JSON 都取决于系统设置、版本和文件类型。API 缺失是正常兜底路径。localhost 可作为安全上下文，普通 HTTP 局域网 IP 通常不可以，不能据此误判手机 Safari 能力。

## 证据与资料

- [行为规格](../../docs/product/specs/icloud-file-probe.md)
- [独立测试计划与手工步骤](../../docs/testing/plans/icloud-file-probe.md)
- [本次执行结果](../../docs/testing/runs/2026-10-05-icloud-file-probe/report.md)
- [Chrome File System Access guide](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)
- [Chrome persistent permission choices](https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api)
- [WebKit: OPFS is origin-private storage](https://webkit.org/blog/12257/the-file-system-access-api-with-origin-private-file-system/)
- [WebKit external File System Access position](https://github.com/WebKit/standards-positions/issues/28)
- [Apple: Safari download location, iCloud Drive or On My iPhone](https://support.apple.com/guide/iphone/customize-your-safari-settings-iphb3100d149/ios)
- [Web Share specification: share targets and files](https://www.w3.org/TR/web-share/)

资料核对日期：2026-10-05。实际支持仍以现场能力检测及系统选择器为准。
