---
schemaVersion: 1
id: flow-topology-animation
title: 空气与冷媒流向动画及多排多流程计算
creator: lomoyun
owner: lomoyun
status: blocked
createdAt: 2026-09-11T02:32:34.742Z
updatedAt: 2026-09-11T06:11:55.024Z
---
# 空气与冷媒流向动画及多排多流程计算

## Goal

计算工况页提供空气与冷媒立体动画；结构编辑、确认快照与 DLL 入参共用版本化 topology。

## Scope

最多5排、每排6流程/500管，共用型号；逐排/交替串联和排间并联。保留单排 Profile、对话单排限制、历史和无关改动。不新增动画依赖、任意分支或其他物性/边界模式；不修改全局配置、不提交推送。

## Acceptance

结构/服务/Worker测试覆盖样例矩阵、不同管数、方向、非法结构和版本冲突；浏览器验证保存恢复、确认失效、会话隔离、键盘/窄屏/减少动态与资源释放，保存实际播放录像；真实DLL独立重放单排、串联、交替和并联，保留完整输入输出、版本、耗时与失败。任何非有限输出仍失败；缺工程依据或DLL缺陷明确阻塞，不因动画通过宣布完成。

## References

关联 mche-calculation-plugin、mche-single-row；原契约 docs/mche-native-contract.md。当前用户提供的 S1–S5 计划是授权范围。


<!-- tll:plan -->
# Plan

- [x] S1: 校准原源码和2/3Pass样例、HeadInf语义、正交坐标及独立多排PTM Profile。
- [x] S2: 版本化结构、校验、服务端编号、编辑保存、确认/准备失效和历史兼容。
- [x] S3: 原生SVG工程动画及交互、响应布局、生命周期与实际播放录像。
- [ ] S4: 共用结构生成逐排几何和连接矩阵，Worker防绕过，对话只写/执行单排。
- [ ] S5: 确定性/交互/视觉/性能与真实DLL独立重放，交付说明和明确阻塞。

S4代码链路已接通，Worker校验和对话单排限制已验证；并联分配机制缺少供应方工程依据，真实并联两路径均抛0xe06d7363，页面正式执行保持阻塞。S5定向23/23、类型检查、桌面/窄屏交互及实际播放录像通过；5组真实重放64槽与独立调用一致但42/43仍NaN，并联无完整输出。需要DLL修复、并联调用依据与真实工程确认资料后继续，不能标记整项完成。

接口说明：docs/flow-topology.md。验收记录：docs/verification/2026-09-11-flow-topology-animation.md；实际录像和原始重放：docs/verification/evidence/flow-topology/。未提交或推送；保留原任务与无关改动。

S3/S5交互补修：用户反馈对话提及计算工况却未打开右侧编辑器。增加只读导航工具和当前实时回复完成后的单次打开，空流程可进入；历史、重复事件、手动关闭、未保存草稿及会话隔离保留防护。验收证据见 docs/verification/evidence/flow-topology/editor-navigation/；本修复不改变上述真实DLL阻塞。
