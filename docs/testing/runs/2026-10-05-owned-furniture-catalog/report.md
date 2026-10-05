# 分组家具库存执行报告

- 日期：2026-10-05 UTC。
- 基线：`af38c0b1aac4055b63316836d06d0f2330413c5d`，树 `0d765088d61e16da9bb871c15ce900da6974cdfb`。
- 分支：`codex/owned-furniture-catalog`。
- 范围：REQ-3D-043 / TC-3D-030；装修目录/UI 与从当前草稿派生的库存视图。无存档、经济、离线策略版本变化；未改门口路径、原料、营业暂停或发布配置。
- 环境：云端 Linux 工作树，Node 内建测试、真实核心/持久化、模拟 DOM/scene；未使用用户 Mac。测试时间采用用例控制的模拟时间，以下耗时为实际测试运行时间。

## PASS

- `node --check app.js`。
- `npm run typecheck`。
- `npm test`：488/488，通过；约 18.0 秒。覆盖既有经营、手动原料、离线、存档保护、布局、路线、场景结构与 UI 处理器回归。
- 本任务专门 TC-3D-030：11/11，通过；包括单类型图片卡、数量、购买待结算、空库存不能拖购、重复旧节点事件、已付款优先、升级/配方/亲和身份、同款 C/D 自动选取、取消、存档/文件往返、余额、键盘焦点与不抢焦点。
- 原 TC-3D-026 拖动用例改为先明确添置待购库存，再拖动同一件物件；继续覆盖无效位置、面板/HUD/对话框、次要指针、横滑、丢失捕获、取消、失焦、Escape、拖后 click 和迟到松手。
- `npm exec -- tsc --noEmit -p qa/file-probe/tsconfig.json`。
- `node --test qa/file-probe/probe.test.mjs`：14/14，通过。
- `npm run build` 及 `npm run build -- --base=/idle-coffee-shop-prototype/`。
- `git diff --check`。
- 独立代码审查：未发现剩余库存、收费或实例身份缺陷。修复一项键盘可访问性问题：目录重建后保留操作焦点；打开实例选择器时进入首项。后续模拟 DOM 用例覆盖该修复。

构建仍提示主包超过 500 kB，为现有 BabylonJS 分包体积警告；构建成功，本次没有变更打包或部署配置。

## NOT_RUN / 边界

- 本分支真实浏览器像素、真实鼠标/触控、不同尺寸屏幕及 3D 截图尚未执行。模拟 DOM 及 NullEngine 不等价于真实浏览器通过。
- 尚未执行 main 合并或 Pages 发布；本任务仅正常提交并推送功能分支。现有 workflow 只在 main push 或手动触发运行，功能分支推送不自动部署。
- 真实浏览器复测使用 [TC-3D-030](../../cases/slice/TC-3D-030.md) 中列出的尺寸和独立测试存档；不要改日常存档。
