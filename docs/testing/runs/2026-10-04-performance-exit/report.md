# 性能预算与独立出口执行报告

2026-10-04 UTC。基线44166fbff603584908945844f39bebf8ba210298，任务分支codex/light-3d-coffee-slice。最终精确代码/测试字节见tested-source.sha256；此报告随同一提交交付。Linux云容器、Node24.19.0、Babylon9.29.0、NullEngine/应用假DOM；不改日常存档。

## 结果

- PASS：node --check app.js、npm run typecheck、npm test **126/126**、npm run build、既有Pages base生产build、git diff --check。
- PASS：独立只读review；修正了渲染限流后隐藏/延迟重复pageshow丢失不足一帧模拟时间，以及低成本接触影被地毯覆盖两项问题，并增加回归。
- PASS：30/60/90/120/144/240Hz输入10秒均300次presentation，业务时间10秒；慢帧只渲染一次。10轮25ms可见+10ms隐藏累计0.35秒；隐藏、pagehide、重复/延迟pageshow无重复推进，始终单RAF。
- PASS：新客入口绕标牌至z8.2横道；各柜台x+1.6的出店侧道在z7.1终止。满队列Lv1/Lv20共7,200固定模拟tick验证单步≤0.125m、进出中心≥0.72m、杯保留至出口删除、账本/每快照有效。六个在途路段保存恢复与连续运行一致，招客三人不叠点。
- PASS：当前两柜台档迁移、坏/未来版路段、离线/CAS失败保护；路线worker另用基线引擎6,000真实旧快照采样验证坐标与资产不变。旧在途客安全走完一次旧路，短暂兼容例外不宣称完全消失；新客立即使用新路。
- PASS：全部既有经理B→A→金库、资金、配方快照、物件拾取/遮挡、全屏三尺寸投影、HUD、弹窗与存储回归。
- PASS（结构/数学）：静态阴影89个caster，无人物/推车caster，refreshRate=0；其bounds均在阴影clip范围内，pan/resize不改变投影，升级显式失效。NullEngine没有真实GPU就绪的shadow效果，因此失效测试直接执行更新逻辑，不把其shader重试当实际阴影缓存命中率。

## 可复现成本证据

structural-cost.mjs使用同一24人合成快照、同一NullEngine比较基线与本版，输出见structural-before.txt/structural-after.txt。可从基线git提取src文件到独立目录并复用已安装node_modules，再传目录参数重跑。

- 1280×900、设备DPR≥1.75：原缓冲3,528,000像素；新上限1,800,000像素，降低约49.0%。大viewport另受2,000,000像素上限约束；CSS全屏/实体触控大小不改。
- 60Hz屏：每秒最多60→30次场景提交；120Hz屏120→30。减少提交次数不是声称实际帧时已达标。
- 同24人：shadow caster候选544→89（人物384→0）；固定world matrix 0→191。家具阴影首次/升级时生成，不再逐帧随人物重画；人物使用接触影。
- 同快照mesh1157→1165（新增两条出口与箭头），geometry保持17。未声称降低主场景draw call总数；主要收益来自呈现次数、填充与阴影成本。
- 请求low-power GPU preference代替high-performance；浏览器可自行忽略此提示，不能承诺选中了某个GPU。

## 构建与验收边界

Pages路径构建：/idle-coffee-shop-prototype/assets/index-DZehyMK7.js。
SHA256 146285b34fe85589ba466c9c62413f6acd4d699615c02cbf598a2b122ddf540d。
构建dist/index.html SHA256 cdf6d482ffec6fabfc27b14e03f68b5db066553e1ed4d9c4b30f56b49c57d2f4。
Vite仍提示约1MB主chunk（gzip约245KB），属于现有Babylon负载提示，不伪称已消除加载成本。

NOT_RUN于本实现任务：新版本真实浏览器像素、缩小DPR后的字迹/30fps节奏、实际WebGL阴影与上下文恢复、Mac温度/功耗/风扇。已按用户新授权交发布负责人，使用既有Pages部署精确提交，再由助手云浏览器独立验收；此报告不提前写部署/浏览器PASS。未改变main、Pages工作流、发布目标或部署配置。
