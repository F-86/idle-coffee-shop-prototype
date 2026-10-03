# 实体嵌入操作修订计划

2026-10-03 UTC，基线fce3e7c。用户认可全屏构图后要求消除HUD感：只有¥金额HUD，其他入口必须真实3D实体。新增REQ-3D-013–015/TC-3D-008。

范围：删除所有常驻DOM投影按钮；墙面咖啡/金库/营业/设置、柜台配方/升级、入口与经理实体文字材质；正常depth/光照；最近实物几何拾取；同目标按下/抬起、drag/hold/cancel、DPR和触控尺度；canvas键盘访问、弹窗及应用生命周期回归。

不修改经济、core、package/workflow、schema、离线或CloudKit适配范围。

验证：核心原15用例；Babylon NullEngine结构/物理表面/触控投影/遮挡/DPR/清理；main真实handler通过mockDOM应用harness；typecheck/build/check。云浏览器已有ERR_BLOCKED_BY_CLIENT，不尝试绕过或切换shellbrowser。实际新pixels/原生dialog/触控由Mac独立origin验证。旧三图只是改动输入证据，不属于新通过证据。
