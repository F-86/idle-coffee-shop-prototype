---
run: 2026-09-20-0051-character-clarity
date: 2026-09-20
scope: REQ-UI-004, REQ-UI-006, TC-UI-006
environment: local Vite preview on 127.0.0.1:5180
status: PASS (candidate gap test)
---

# 方块人物清晰度

## 结论

人物模糊问题已修复：Phaser 从强制 Canvas 改为 `AUTO`，启用适合方块素材的 `pixelArt` 硬边渲染并关闭抗锯齿，同时适度放大咖啡师、顾客和经理的显示尺寸。桌面和横屏画面中角色轮廓、服装色块及动作均更易辨认，没有遮挡柜台主操作。

## 实际验证

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 桌面人物 | PASS | 真实浏览器截图中咖啡师尺寸由原先偏小的轮廓提升，头发、脸部、围裙/外套色块和手部姿态清楚；经理推车与顾客人物不再被背景灯光软化。 |
| 844×390 横屏 | PASS | 横屏截图中三组顾客仍能辨认并保持在各自候客地毯，咖啡师位于对应柜台后方；柜台图标、升级按钮和容量反馈仍可操作。 |
| 渲染策略 | PASS | `ShopScene` 使用 `Phaser.AUTO`、`pixelArt: true`、`antialias: false`、`roundPixels: true`；角色显示尺寸分别上调，未修改经济或队列逻辑。 |
| 场景层级 | PASS | 角色仍由同一个 Phaser canvas 绘制，入口、候客地毯、柜台、经理路线和背景相对位置保持不变。 |
| 控制台与图片 | PASS | 重新加载后的独立浏览器页无 warn/error，页面图片失败数为 0。 |

## 静态检查

- `npm run typecheck`：通过。
- `npm run build`：通过；保留既有 Vite chunk-size warning，没有编译失败。
- `node --check app.js`：通过。
- `git diff --check`：通过。

## 限制

- 当前验证使用 Codex 本地浏览器的桌面与横屏模拟，不等同于真实物理手机屏幕；不同 DPR 和系统缩放仍需设备抽样。
- 本轮没有重绘或替换角色位图，只修正渲染方式和显示尺寸；如果后续希望角色更接近原作卡通比例，可再单独做素材裁切/重绘评审。
- 未部署、未提交、未 push。
