---
schemaVersion: 1
id: condenser-profile-mapping
title: 冷凝器 Excel 识别与 Profile 自动填写
creator: lomoyun
owner: lomoyun
status: done
createdAt: 2026-09-10T09:20:17.842Z
updatedAt: 2026-09-10T09:56:47.766Z
---
# 冷凝器 Excel 识别与 Profile 自动填写

## Goal

实现用户给定方案：上传冷凝器 Excel 后一次读取、单位识别、字段映射、SH 派生和完整 Profile 草稿；用户核对后确认可恢复的输入快照。

## Scope

复用 Excel 原件与单元格索引及 MCHE 插件、工具、右侧需求页、冷媒确认入口。新增版本化映射、完整 Profile、来源/单位/派生依据、修改与失效联动；保留所有非空原始记录与未映射参考资料。
仅支持当前冷凝器需求表及同结构变体。不扩展 DLL 模式、猜测物性或工程输入，不改目录原件、依赖、既有任务及无关改动，不提交或推送。

## Acceptance

真实样表26条非空记录不变，独立派生 SH=27.4 K、RH=55%、SC=0 K，空气流量原值4 m³/h。
覆盖单位列左右切换、°F/psia/lbm/h/ACFM、百分比与干度、温差等价、双选/未选/冲突；Quality 标签、移动/隐藏/重复/多表/未知字段。
修改或清除来源后 SH 重算或清空，显式 SH 冲突待处理；模式切换保值并标记输入/参考/设计目标；快照完整恢复、原件/规则/输入变化后确认与准备包失效。
验证上传、真实 Agent 工具循环、四区域展示、编辑、用户确认、刷新；回归 PTM 准备及其他模式阻塞，记录实际验证与限制。

## References

关联既有已完成任务 condenser-requirements 与进行中的 mche-calculation-plugin；沿用 docs/condenser-requirements.md。当前用户提供的 S1–S6 方案是本次范围依据。


<!-- tll:plan -->
# Plan

- [x] S1: 核对并复用原件与单元格证据、结构识别
- [x] S2: 按 Choose units 标记读取单位及非空原始记录
- [x] S3: 统一版本化映射、换算、SH 派生和冲突校验
- [x] S4: 接入 Agent 查询及完整四区域 Profile 草稿、冷媒建议
- [x] S5: 页面编辑/确认、完整快照恢复与失效联动
- [x] S6: 真实样表、单位边界、联动、Agent/页面及 PTM 回归验收

验收证据：docs/verification/2026-09-10-condenser-profile-mapping.md。最终定向25/25、桌面/手机浏览器、typecheck通过；扩展MCHE回归56/59，其他应用77通过/1失败/2跳过，旧文案断言及会话502另列记录，未宣称全仓全绿。未新增DLL模式，未提交推送。
