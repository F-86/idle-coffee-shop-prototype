# 独立文件往返测试页

线上路径：https://f-86.github.io/idle-coffee-shop-prototype/file-probe/

这里只处理固定 schema 的合成测试 JSON，不接受游戏存档或任意个人数据。文件内容只在当前标签页内存中处理，无上传、遥测、localStorage、IndexedDB、文件句柄持久化、目录访问或主动持久授权请求。线上代码公开，用户选择的文件不随页面发布。

## 验证与本地运行

```sh
npm exec -- tsc --noEmit -p qa/file-probe/tsconfig.json
node --test qa/file-probe/probe.test.mjs
npm exec -- vite --config qa/file-probe/vite.config.ts
npm exec -- vite build --config qa/file-probe/vite.config.ts
```

默认独立构建到 `.qa-dist/file-probe/`，使用相对资源路径。Pages 工作流在原有游戏构建完成后，仅将这一目录添加到 `dist/file-probe/`。不修改游戏源码、入口、依赖或原有构建命令。测试 JSON、存档及测试报告不放入站点。

## Mac → 手机 → Mac

1. 在 Mac 生成 revision 1 并导出到系统中可见的 iCloud Drive 测试位置。
2. 手机 Safari 打开本页，通过“选择测试文件（通用）”读取同一文件，人工核对 probeId、revision 与完整 SHA-256。不要为了继续现有测试而生成新 ID。
3. 点击 revision +1，以同一 probeId 生成 revision 2 内存候选。通过下载或受支持的系统分享菜单另存新副本到“文件 / iCloud Drive”。原文件不会就地改写。
4. Mac 读取新副本，人工核对 probeId、revision 2 与手机显示的 SHA-256。

浏览器不能证明存储提供方、保存位置或 iCloud 同步完成。下载发起和系统分享返回也不等于文件保存完成。跨设备证据必须来自两台设备实际读取的文件。Safari 的文件选择、下载位置及可分享类型取决于系统版本和设置；增强文件选择器缺失时使用通用选择/下载。

## 安全边界

只选择专门测试位置的合成文件，不选择真实存档。增强另存为使用随机新文件名并拒绝改名或非空目标，但文件系统没有通用的原子仅新建语义；若出错，可能留下空文件，写入后的结果也可能不确定。页面明确显示失败而不伪称成功。

页面不请求“每次访问都允许”。如系统不能仅授予本次所选测试文件访问，请取消并使用通用路线。刷新会丢弃所有内存内容和最多 32 条导出校验基准。
