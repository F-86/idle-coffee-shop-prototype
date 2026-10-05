# 可选真实帧节奏诊断执行报告

2026-10-04 21:46–21:58 UTC。基线任务分支 `734363a6db2e72e4e2b52b1a9343263bc5d96d0d`；线上内容基线 `c8b37c60ae02f225af8896718addb06c99a4ac85`。本报告与被测代码同提交，最终文件见 [源代码指纹](source-sha256.txt)。环境 cloud Linux / Node24 / Babylon9.29.0。辅助REQ-3D-024、[TC-3D-015](../../cases/slice/TC-3D-015.md)。

## 先查工具与已有数据

当前 `readRenderStats` 只有模式、目标预算、累计提交帧、buffer/mesh/静态阴影等结构统计。已有可见QA只显示路线，不能从截图间隔可靠推导帧间隔分布。此任务检查了支持的cloud browser文档：DOM/截图/console日志可读，无公开性能trace/逐帧采样API，read-only evaluate不能安装采样回调。因此选择小型opt-in应用仪表，不通过控制台注入或未公开CDP能力。

此前云端本地origin被`ERR_BLOCKED_BY_CLIENT`拒绝、线上浏览器不支持WebGL；本轮没有重试或换网络绕过。用户Mac真实路线/资金链已经另记，但从未产生可用帧时或温度数据。旧结构对比是合成24人的NullEngine：阴影候选544→89、冻结mesh0→191、mesh1157→1165；只能说明结构工作变化，不是GPU、FPS或发热实测。当前smooth采样预算又高于旧省电默认，不能据这些旧数字推断最新Mac更凉。

## 实现范围

- 严格`?qa=1`才构造，默认折叠无采样。Performance QA沿唯一应用RAF链记录成功返回的场景绘制提交对应的真实RAF时间戳，显示10秒窗口FPS、nearest-rank p50/p95/max、>50ms/>100ms数量及本段累计秒数/帧间隔/长间隔。
- 固定64KiB环形存储，记录无每帧分配；1Hz排序/读取场景/DOM。现场记录mode、目标预算、CSS viewport、DPR、buffer、有效DPR、客户阶段/等级/配方、mesh、core时间、弹窗/route panel与可见焦点状态。
- 隐藏/焦点丢失与恢复、尺寸/模式/读档/新店、WebGL丢失与恢复重开段，排除后台间隔；context丢失不因scene对象还在就伪报有效FPS。freeze保留最后一次1Hz读数与匹配上下文；重新开始仅影响诊断。
- 折叠Route QA跳过逐帧投影/捕获/DOM与marker，核心有限事件历史继续保留；便于减少测量期间的额外QA工作。
- 未改普通HUD、core、渲染器、经济、save/schema、依赖、Pages工作流或发布配置。无网络遥测。

## PASS：明确模拟时间的自动验证

- `node --check app.js`、`npm run typecheck`。
- `npm test`：**181/181 PASS**，0 FAIL/SKIP，10.46秒真实命令耗时；帧序列与业务时间明确是测试模拟，见 [完整输出](automated-tests.txt)。
- `npm run build`：PASS，主资源 `index-PITzn4pH.js` 1,017.31kB / gzip251.31kB。
- 现有Pages路径构建、独立outDir：PASS，主资源 `index-DmhXXphE.js` 1,017.34kB / gzip251.34kB；见 [默认](build-output.txt) / [Pages](pages-build-output.txt) 构建输出。既有>500kB提醒保留，不误报失败或无告警。
- `git diff --check`：PASS；core/render/依赖/工作流相对基线无diff。
- 独立复核：最终47/47相关测试+typecheck通过；额外20000间隔算术oracle、16000帧覆盖/窗口/重置oracle通过。无剩余阻断。

独立复核发现并已修复：初版把RAF timestamp称为字面绘制起点；已明确为提交绘制的RAF节奏，不能证明GPU完成/上屏帧。初版仅检查scene存在；已监听上下文丢失/恢复停止统计。初版环刚满但未覆盖也标截断；已改成最近被覆盖端点仍在窗口才显示截断。都有直接回归覆盖。

## 真机证据状态与后续

- 新面板真实浏览器像素：**NOT_RUN**；之前云端origin限制仍存在。
- 新版Mac实际RAF节奏/FPS/p50/p95：**NOT_RUN**，不得把181项模拟测试的数值当真机数据。
- GPU时间、实际呈现帧、CPU/功耗/温度：**NOT_RUN**。
- 具体下一步见 [Mac测量计划](../../plans/performance-measurement.md)：固定同机/浏览器/viewport/相机/等级配方与无操作自动客流，四个模式顺序段各30真实秒预热+至少60真实秒有效前台采样，单列后台/失焦检查。现场客流若不同须记录，不当严格A/B；温度需独立传感证据。

本次仅提交/正常推送既有任务分支供审查，不合并main，不部署，不改发布目标。main-only工作流不会因任务分支push运行；本报告不声称本提交已有远端Pages CI或部署。

## 2026-10-05 后续实测复核

Mac现已产生四段末窗帧节奏及buffer记录，见[独立复核报告](../2026-10-05-mac-performance-review/report.md)。上文NOT_RUN为本报告初次交付时的状态。新证据的p50/p95只有最后滚动窗口范围；补全的累计冻结行确认各79–99秒采样段的FPS及累计>50/100ms计数0，仍不能扩大成所有场景无卡顿结论。后台切换未留存目标页面的实际hidden/focus事件，因此INCONCLUSIVE，未据此判产品失败；温度/功耗仍NOT_RUN。
