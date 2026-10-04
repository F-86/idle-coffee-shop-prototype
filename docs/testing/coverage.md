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
