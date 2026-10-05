# 轻3D预览覆盖矩阵

| 需求 | 用例 | 验证方式 |
|---|---|---|
| REQ-3D-002 | [TC-3D-001](cases/slice/TC-3D-001.md) | 核心资金守恒 + 真实UI经营链 |
| REQ-3D-003 | [TC-3D-002](cases/slice/TC-3D-002.md) | 核心快照/交易 + 真实UI |
| REQ-3D-004 | [TC-3D-003](cases/slice/TC-3D-003.md) | 时间分片/重复输入/暂停 |
| REQ-3D-006 | [TC-3D-004](cases/slice/TC-3D-004.md) | schema/离线端点/异常保护 |
| REQ-3D-007 | [TC-3D-005](cases/slice/TC-3D-005.md) | in-memory opaque CAS与幂等；真实iCloud不在范围 |
| REQ-3D-001/005 | [TC-3D-006](cases/slice/TC-3D-006.md) | NullEngine结构与资源 + 桌面/触控UI |

实际结果见 runs/2026-10-03-light-3d-slice/report.md。精确商业平衡仍为draft，不以源码生成预期证明自己的公式正确。

## 用户反馈后的全屏世界

REQ-3D-009/010/011/012 → [TC-3D-007](cases/slice/TC-3D-007.md)，[计划](plans/fullscreen-world.md)。几何/输入/源代码契约与实际Mac scene-fill截图分别记录，不混作通过。


## 用户反馈后的实体嵌入操作

REQ-3D-013/014/015 → [TC-3D-008](cases/slice/TC-3D-008.md)，[计划](plans/embedded-scene-controls.md)。真实实体字牌、深度拾取、键盘与应用生命周期handler验证，和真实浏览器三尺寸截图分别记录。CPU模拟不代替视觉验收。


## 用户指定金库和柜台前脸

REQ-3D-016/017/018 → [TC-3D-009](cases/slice/TC-3D-009.md)，[计划](plans/vault-front-layout.md)。新的HUD/入口预期替代旧TC008对应静态数量，核心和生命周期保护继续回归。

## 用户指定表面与近到远顺序

REQ-3D-019/020/021 → [TC-3D-010](cases/slice/TC-3D-010.md)，[计划](plans/room-route-refinement.md)。真实core路径、当前两柜台存档路线迁移与图标间隔取代旧TC009对应的“core不改/仅渲染映射”；其余UI与保存保护继续回归。

## 性能预算与进出分流

REQ-3D-022/023 → [TC-3D-011](cases/slice/TC-3D-011.md)、[计划](plans/performance-exit.md)。RenderBudget多刷新时钟、应用生命周期尾部、静态/动态几何、完整路径/存档测试与结构成本对比；GPU帧时与Mac发热另外测量，禁止冒充通过。

## 清晰度与连续运动

REQ-3D-024 → [TC-3D-012](cases/slice/TC-3D-012.md)、[计划](plans/smooth-clarity.md)。默认显示刷新、分档采样/偏好、固定步插值、恒定速度、原始状态一致性、生命周期；实际GPU像素/帧时/发热另验。

## 离店至入口侧边界

REQ-3D-025 → [TC-3D-013](cases/slice/TC-3D-013.md)、[计划](plans/customer-boundary-exit.md)。延伸返程横道、路口让行、连续性/分离/无死锁、v2原位延长、箭头删除；不是无几何交点的承诺。

## 路线验收身份与事实诊断

REQ-3D-020/025 辅助 → [TC-3D-014](cases/slice/TC-3D-014.md)、[计划](plans/route-observability.md)。严格opt-in、完整固定步事件、实际模型ID投影、收款/路过区别、有限内存、状态/保存不变和生命周期；真机视觉结果另外记录。

## 真实浏览器帧节奏测量辅助

REQ-3D-024 辅助 → [TC-3D-015](cases/slice/TC-3D-015.md)、[计划](plans/performance-measurement.md)。有界单调RAF间隔、滚动分位/长间隔、1Hz UI、前台/焦点/上下文丢失/尺寸/模式分段、冻结、默认零采样与经济/保存不变。真机采样和温度结论另记，不以自动时钟测试代替。

## 独立清晰60帧选项

REQ-3D-026 → [TC-3D-016](cases/slice/TC-3D-016.md)、[计划](plans/clear-60.md)。30–240Hz调度、同smooth像素预算、原生按钮/选择、旧偏好保留、新偏好读回、存档字节不变、插值/经营一致性和QA新分段；Mac实际buffer/节奏/字牌观感独立验收。

## 金库靠近与地毯完整接角

REQ-3D-028 → [TC-3D-018](cases/slice/TC-3D-018.md)、[计划](plans/scene-alignment.md)。三尺寸/双DPR投影间隔、真实拾取、全宽接角射线与无重叠几何；真实新像素、触控与顾客经过另验。

## 存档恢复失败保护

REQ-3D-029 → [TC-3D-019](cases/slice/TC-3D-019.md)、[计划](plans/save-recovery-safety.md)。570→0丢档链、仓库写屏障、失败/缺失/坏档分流、明确新店、备份/移除失败与CAS、重复恢复/时钟/后台保护；假DOM执行实际handler，不替代真实浏览器验收。

## 无时长上限、80%离线经营

REQ-3D-030 → [TC-3D-020](cases/slice/TC-3D-020.md)、[计划](plans/offline-unlimited.md)。精确新旧策略/分段/同核心回放、异步原子领取、取消/代际/CAS/异常和真正main handler；7天/30天云端实测与MacUI验收分别记录。

## 手动文件存档

REQ-3D-031 → [TC-3D-021](cases/slice/TC-3D-021.md)、[PORTABLE-QA-1.0](plans/portable-save-files.md)。协议/完整性/账本、备份与乐观冲突故障、实际main.ts异步与生命周期；Mac/iPhone/Safari原生文件及iCloud到达需独立合成数据验收，不混作自动同步通过。

## 游戏化操作面板

REQ-3D-032 → [TC-3D-022](cases/slice/TC-3D-022.md)、[计划](plans/game-panel-redesign.md)。统一升级/设置/存档层级、原生文件输入、可见确认后果、恢复入口和离线简明结果；原TC-3D-019/020/021资产与失败保护继续回归，真实像素/原生选择器单独验收。

## 咖啡独立升级与柜台双入口

REQ-3D-033 → [TC-3D-023](cases/slice/TC-3D-023.md)、[计划](plans/coffee-upgrades-and-counter-controls.md)。独立实体拾取/面板/购买、配方等级与制作快照、在线离线同核心、经济2和文件2迁移/拒绝未知版本、旧实现拒绝新档；保持恢复/离线/文件安全回归，像素/真机独立验收。
