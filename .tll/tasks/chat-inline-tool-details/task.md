---
schemaVersion: 1
id: chat-inline-tool-details
title: 对话工具详情内联展示与完成状态
creator: lomoyun
owner: lomoyun
status: done
createdAt: 2026-09-10T06:29:23.543Z
updatedAt: 2026-09-10T06:45:31.716Z
---
# 对话工具详情内联展示与完成状态

## Goal

查看 MCHE 实际对话，将工具详情入口融入流式回复的对应段落，点击后展开，并明确展示本轮回复是否完成。

## Scope

对话事件投影、详情入口位置、流式状态、历史恢复与必要交互验证。沿用现有详情抽屉和业务确认门禁；不改计算业务、原始会话持久化、模型配置或依赖，不重启用户进程。

## Acceptance

正文流式可见，工具详情默认收起且入口位于相关段落；工具成功、失败和本轮回答状态可区分。完成、异常中断、历史重开均保留内容与来源，详情点击不执行业务。桌面、窄屏与键盘交互通过，现有 Excel/MCHE 详情可访问。

## References

关联已完成任务 condenser-requirements；保留其需求核对与计算确认流程。


<!-- tll:plan -->
# Plan

- [x] S1: 核对实际会话与现有流式和详情投影，确定段落定位及状态规则。
- [x] S2: 实现正文内详情入口和流式/最终/历史统一展示。
- [x] S3: 定向回归、实际浏览器交互和证据记录；见 docs/verification/2026-09-10-chat-inline-tool-details.md。
