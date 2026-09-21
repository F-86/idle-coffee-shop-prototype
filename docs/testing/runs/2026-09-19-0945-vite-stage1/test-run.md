# 阶段 1 · Vite / React / TypeScript 工程骨架

执行时间：2026-09-19（Asia/Shanghai）  
运行目录：`/Users/jane/.codex/worktrees/8204/idle-coffee-shop-prototype`  
测试 origin：`http://127.0.0.1:4173/?test=vite-stage1`（dev）、`http://127.0.0.1:4174/?test=vite-preview-stage1`（preview）

## 范围

验证阶段 1 的工程入口和回退边界，不把 React 挂载探针当作业务迁移完成。现有 JavaScript engine、DOM renderer、Phaser scene 和单一 `requestAnimationFrame` 仍负责产品行为。

## 实际命令

| 检查 | 结果 |
| --- | --- |
| `npm install` | PASS；生成 `package-lock.json`，依赖安装完成 |
| `npm run typecheck` | PASS；strict TypeScript 检查无错误 |
| `npm run build` | PASS；Vite 8.3.0 生成 `dist/` |
| dev 浏览器启动 | PASS；标题、旧 DOM 控件、React 挂载探针和 Phaser canvas 存在 |
| preview 浏览器启动 | PASS；场景资源加载完成，未加载图片数为 0 |
| dev UI 营业切换 | PASS；通过可访问按钮点击后显示“已打烊” |
| 移动 390 宽 smoke | PASS；页面保持在视口宽度内，场景保留横向浏览容器 |
| 桌面 1280 宽 smoke | PASS；页面和 Phaser canvas 正常渲染 |
| `npm run build` 控制台 | PASS；仅保留 Vite 对 classic Phaser 脚本不能打包的提示；构建插件已将运行时资源复制到 `dist/assets/` |

## 证据与边界

- 当前阶段没有改写业务状态；React 只挂载 `data-react-migration="stage-1"` 探针，避免第二个时间循环或第二份金币状态。
- `dist/assets/` 的未哈希运行时资源由 Vite 配置临时复制，以保持旧 Phaser scene 的 URL 和静态回退资源路径；阶段 3 接入 npm Phaser 后应删除该兼容层。
- 本轮未执行完整产品浏览器用例；阶段 0 的完整 M1 基线见 [Phaser / M1 核心经营](../2026-09-19-0925-phaser-m1/test-run.md)。
- 阶段 2 待迁移：纯 TypeScript core、类型化事件、存档 schema 迁移和 legacy UI adapter。
