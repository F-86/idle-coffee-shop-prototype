# 浏览器观察证据

测试 origin：`http://127.0.0.1:4174/?test=final-react`。该 origin 与日常 origin 隔离；本轮多个标签页共享该测试 origin 的测试存档。所有业务动作均通过浏览器 UI 完成，未注入业务状态。

## 运行时结构

- `#react-root .react-app-shell`：存在。
- `#legacy-app-shell`、`#modalLayer`、`#toastStack`：不存在。
- Phaser `<canvas>`：存在。
- 图片加载失败：0。
- 最终浏览器控制台 `error` / `warn`：`[]`。

## 业务与弹窗

- 打烊前后等待 1.2 秒：余额 `¥ 6,992 → ¥ 6,992`，待收 `待收现金¥ 0 → 待收现金¥ 0`，状态变为“已打烊”；再次点击恢复营业。
- 首次弹窗迁移检查发现：React 弹窗节点存在但被旧 `.modal-window` 的 `body.modal-is-open` 显隐规则隐藏；该次记录为失败，不计入最终通过。
- 修复后：订单弹窗标题“订单台”可见，弹窗 opacity `1`，主按钮可见区域 `728×48`；真实 `Escape` 后弹窗节点移除。
- 手作订单：真实点击“开始冲泡”后按钮显示“正在冲泡…”，进度宽度约 `17.664%`，出现“冲泡开始”提示；等待约 3.2 秒后按钮回到“开始冲泡”、进度 `0%`，表示进入下一单。

## 响应式与场景

| 视口 | 读数 |
| --- | --- |
| 390×844 | root `390`，场景 `360`，柜台 world scroll width `820`，canvas 存在，图片失败 `0` |
| 844×390 | root/page 仍保持视口宽度，场景 `828`，canvas 存在，图片失败 `0` |

## 构建检查

- `node --check app.js`：PASS。
- `npm run typecheck`：PASS。
- `npm run build`：PASS；Vite 生成 `dist/`。
- `git diff --check`：PASS。
- 构建仅有 Phaser/应用 bundle 超过 500 kB 的 Vite warning；不是构建错误，后续可单独做代码分割。
