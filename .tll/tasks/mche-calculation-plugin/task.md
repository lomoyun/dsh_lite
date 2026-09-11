---
schemaVersion: 1
id: mche-calculation-plugin
title: MCHE 实际计算插件
creator: lomoyun
owner: lomoyun
status: doing
createdAt: 2026-09-10T01:18:31.193Z
updatedAt: 2026-09-10T02:04:25.828Z
---
# MCHE 实际计算插件

## Goal
完成当前选型快照 → 用户工况和工程确认 → 原生映射 → 异步 CalcCondenser → 可追溯结果的插件闭环。

## Scope
以用户已授权的 `docs/mche-calculation-plan.md` 为完整方案，单排、单流程、冷媒 PTM、均匀空气与冷媒分配；按钮与明确对话指令共用后端。保护原目录和无关改动，不包含蒸发器、优化、多排、多流程或外部服务，不提交推送。

关联旧任务：`mche-single-row`。该任务保存此前设计与初始实施证据。本独立交付按 2026-09-10 更新的 TLL 规则单独登记，保留旧记录，不重写历史。

## Acceptance
全部42参数、容量、单位和版本依据明确；输入确认/过期/会话隔离/幂等有效；真实x86调用、异步持久化、取消/超时/重启中断和结果追溯可用；完成自动、浏览器和回归验证。真实工程确认资料缺失或DLL异常须作为验收阻塞，不以测试夹具或模拟成功代替。

已知边界：当前LTR输出42/43为NaN，严格失败；当前目录组合的工程确认资料尚未收到。基线MCHE29/30，既有会话502。

<!-- tll:plan -->
# Plan

完整获批设计：`docs/mche-calculation-plan.md`。关联旧任务 `mche-single-row` 的初始实施checkpoint；范围未扩大。

- [x] S1: 建立42参数契约、Profile、单位/容量/未用槽规则、181运行文件哈希和x86实际加载检查；证据见 docs/mche-native-contract.md。
- [x] S2: 独立计算草稿、来源、用户确认、确定性映射、快照/规则失效与原表对照；定向测试通过。
- [x] S3: 20工具及共用HTTP服务，真实用户消息授权、按钮独立于模型、幂等并发任务、分页结果；11项计算专项复测通过，另保留既有间歇502记录。
- [ ] S4: Worker串行/持久化/取消/超时/重启与页面已实现，故障和离线接口通过；实际浏览器验收因CUA连接失败和Playwright初始化超时受阻。
- [ ] S5: 两组真实原生执行与独立示例64槽对照一致；42/43槽NaN阻塞成功验收，当前目录只有明确标记的合成接口夹具，缺用户实际工程确认资料。全仓117通过/1聊天502失败/2跳过，不标为全绿。

当前证据与待办：docs/verification/2026-09-09-mche-calculation.md；固定输入输出：docs/verification/evidence/mche-20260910-native.json。未提交推送，任务不finish。下一步依赖真实工程确认资料、DLL异常说明或修正版本、可用浏览器连接；分别恢复对应验收，不以模拟值替代。
