---
schemaVersion: 1
id: excel-processing-convergence
title: Excel 识别与处理收敛：快、准、少调用
creator: lomoyun
owner: lomoyun
status: done
createdAt: 2026-09-10T10:55:17.872Z
updatedAt: 2026-09-10T11:19:08.676Z
---
# Excel 识别与处理收敛：快、准、少调用

## Goal

保留 Agent 自主选工具，以专用冷凝器需求读取优先、困难案例定向补证据，减少重复提取、识别和整理。标准样表以 1～3 次识别调用为优化目标，不设硬上限。

## Scope

覆盖上传后的提示、工具描述、通用理解错误诊断和 Profile 草稿引导。沿用四区域 Profile、原始记录、用户确认与 DLL 边界；不新增业务工具，不改参数、错误码、持久化格式、全局模型配置、依赖或 DLL 模式。保留既有任务及无关改动。

## Acceptance

- 新会话首轮获得服务端核验的 fileId、Sheet 概览及 revision=0；已有完整结果不重复读取、推荐或发布。
- 多候选请用户选择；未知结构与分页按具体问题补证据；原值和转换错误定位字段名、路径、坐标，保留严格校验。
- 样表保留 26 条原始记录，SH=27.4 K、RH=55%、SC=0 K、风量原值 4 m³/h；公英制、冲突、隐藏/移动/多表/未知字段回归通过。
- 验证四区域草稿、来源修改与 SH 重算/清除、需求确认、刷新恢复及不支持模式阻塞。引导客户需求入口，不主动重复生成参数表卡片。
- 当前已配置模型在隔离会话用相同样表与原始请求运行 3 次，分别记录总耗时、首次 Profile 耗时、识别及后续调用、重复和失败重试，与用户提供的 436 秒 / 20 次基线比较；确定性与真实模型结果分开报告。

## References

相关已完成任务：condenser-requirements、condenser-profile-mapping。实现以本次用户提供的 S1—S5 方案为准；验证入口见 docs/condenser-requirements.md。


<!-- tll:plan -->
# Plan

- [x] S1: 新会话注入 MCHE 指引及最新 revision，保留服务端附件核验，取消通用 Excel 强制调用顺序。
- [x] S2: 专用 requirements_read 优先，复用完整 Profile、原始记录、单位/派生、推荐、精确冷媒匹配及最新版本。
- [x] S3: 多候选选择与困难结构定向补证据，按需分页；扩充字段错误诊断，保留原校验和并发门禁。
- [x] S4: 以服务端 Profile 为映射依据，引导客户需求核对确认；根据真实复测在现有 notes 补充版本、模式/缺项定义、中性核对及测试条件说明。
- [x] S5: 最终35项定向验收通过，浏览器交互通过；当前模型最终三次均1次识别+1次冷媒建议、零重复/重试，平均42.695秒。广回归既有失败及过程复测见验收记录。

验收与边界：docs/verification/2026-09-10-excel-processing-convergence.md。
