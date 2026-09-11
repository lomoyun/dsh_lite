---
schemaVersion: 1
id: agent-terminal-trace
title: 终端 Agent 调用与响应日志开关
creator: lomoyun
owner: lomoyun
status: done
createdAt: 2026-09-10T11:24:23.580Z
updatedAt: 2026-09-10T11:37:13.380Z
---
# 终端 Agent 调用与响应日志开关

## Goal

通过环境变量开启/关闭终端 Agent 调度与响应日志，让用户在启动终端查看调用参数、结果、模型返回及耗时。

## Scope

新增默认关闭的 DSH_LITE_TRACE 开关，接入现有聊天运行时事件，提供启动状态、请求/步骤/工具/模型response/错误/耗时日志。记录模型实际返回的文本与 reasoning（如有），不推测内部思考。不记录请求头/配置凭证，对常见敏感字段和环境密钥脱敏；不改页面、工具选择、持久化、依赖或全局模型设置，不修改用户 .env 或重启现有服务。

## Acceptance

- 不配置/0 时不输出调试日志；1 时启动终端明确显示已启用，后续聊天打印完整调用参数、结果、response及会话/步骤/时间。
- 工具并发可按 callId 关联、识别工具级失败与请求异常；结束或超时释放监听，不重复记录其他会话。
- 常见凭证字段、已知环境密钥和图片二进制不输出；日志异常不使对话失败。
- 通过定向单元测试及隔离真实 DSH 工具循环开/关验收；提供 PowerShell 和 .env 配置方式。

## References

相关已完成任务：excel-processing-convergence、chat-inline-tool-details。此次为新的日志可观测性目标，保留旧任务和无关改动。


<!-- tll:plan -->
# Plan

- [x] S1: 确认原生事件结构，实现默认关闭的终端日志及脱敏。
- [x] S2: 接入聊天生命周期，补充环境示例和使用说明。
- [x] S3: 验证开关、完整结果、并发/异常/释放以及隔离真实工具循环，记录并交付。
