# 网页图标

2026-10-05 UTC；REQ-WEB-ICON-001。

为 Mellow Bean 增加原创咖啡杯标识：奶油底、深绿色杯身、浓缩咖啡色杯口与蒸汽。优先保证浏览器标签页的 16px 可辨识，兼顾深浅色界面。

- 主入口使用可缩放 SVG，ICO 提供 16 / 32 / 48px 后备。
- Apple 添加到主屏幕使用 180px 无透明背景 PNG；其他支持 PNG 网页图标的浏览器可读取 192px PNG。
- 静态文件仅来自本项目，Vite 构建必须正确支持根路径和现有 `/idle-coffee-shop-prototype/` Pages 子路径。
- 图标不声明安装能力，不加入 manifest、service worker、离线缓存或启动模式；不修改经营、存档、部署配置。

源文件：`public/icons/mellow-bean.svg`。派生文件由 Inkscape 1.4 按目标像素直接渲染，Pillow 12.3 将主屏幕图标铺到不透明的 `#f8edda` 底色，并打包三个 ICO 尺寸。图形为项目原创，无字体、照片、外部素材或运行时依赖。

验收见 [图标测试计划](../../testing/plans/web-icon.md)。
