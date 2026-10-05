# 网页图标验收计划

2026-10-05 UTC；WEB-ICON-QA-1.0；REQ-WEB-ICON-001。

## 独立用例

- TC-WEB-ICON-001：页面声明本地 SVG 与多尺寸 ICO；文件非空，无站外请求。分别构建根路径和 Pages 子路径，读取产物中的真实 href，确认文件存在、HTTP 200 与正确 MIME。
- TC-WEB-ICON-002：Apple 180px 与 PNG 192px 尺寸正确，RGB 无 alpha/tRNS。像素检查四角与背景均不透明；实际 iOS/Android 添加到主屏幕后检查图标、裁剪和名称。
- TC-WEB-ICON-003：ICO 含 16 / 32 / 48px 三帧，解码尺寸与文件头一致。按实际大小在浅/深背景检查；放大预览不能代替 16px 验收。
- TC-WEB-ICON-004：SVG 可单独渲染，无字体、远程图片、脚本或外链。没有新增 manifest/service worker/离线缓存，也没有改变游戏行为、存档和 Pages 工作流。

## 回归与边界

执行 `node --check app.js`、`npm run typecheck`、`npm test`、`npm run build`，再执行 `npm run build -- --base=/idle-coffee-shop-prototype/`。使用独立测试 origin，不触碰日常存档。真实浏览器标题栏和手机主屏幕需分别记录 PASS / FAIL / BLOCKED / NOT_RUN，不能用文件头和 HTTP 检查冒充实机通过。产物预览仅证明图标设计与渲染，不证明设备已更新缓存。
