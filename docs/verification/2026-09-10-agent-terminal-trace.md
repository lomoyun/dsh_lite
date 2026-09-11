# 终端 Agent 日志开关验收

任务：`agent-terminal-trace`。新增 `DSH_LITE_TRACE`，默认关闭，`1/true/on` 开启。项目 `.env` 或启动 PowerShell 均可配置，重启服务生效，进程环境变量优先。

## 实现

- `terminal-trace.js` 订阅现有 DSH 会话事件，按会话、turn/step、callId 输出 JSON 行；记录输入、步骤、工具参数/完整结果、耗时、模型 response/用量、请求异常及完成状态。
- 模型实际返回的 reasoning 会记录；没有返回时不生成。完整消息输出，不重复输出流式 chunk。`ok:false` 的工具结果标为失败。
- 关闭时不订阅、不输出 trace。结束/异常后释放监听；脱敏及日志出口异常不影响对话。
- 不输出请求头、模型配置及图片二进制；常见凭证字段、认证文本和已知环境密钥脱敏。业务结果和网页展示保持原样。
- 运行时只增加日志接入，文档及 `.env.example` 提供配置方式。未修改实际 `.env`、全局模型配置、依赖、DLL 模式或用户正在运行的服务。

## 验证

`node --test --test-concurrency=1 packages/dsh-lite-web-app/test/*.test.js packages/dsh-mche/test/requirements-native.test.js`

54 项通过，0 失败（含 2 个开关子测试），耗时 26.805 秒。记录：本地 `.dsh/terminal-trace-regression.log`。

- 单元验证默认/显式关闭、完整长结果、并行工具关联和耗时、会话隔离、业务错误/异常、监听释放、日志失败隔离、脱敏及原始数据不变。
- 隔离真实 DSH 服务配合本地确定性模型，分别以 `DSH_LITE_TRACE=0/1` 上传冷凝器样表并运行工具循环。关闭无 trace；开启可看到 `mche_requirements_read` 参数、26 条原始记录及四区域 Profile、SH=27.4 K、最终 response 和服务商返回的 reasoning。网页结果未被日志修改。
- 原有需求读取/推荐、用户确认、准备阻塞、刷新恢复及会话/来源隔离回归通过。
- `pnpm run typecheck` 退出码 0；`git diff --check` 通过。

这是日志链路的确定性集成验证，未重新调用外部已配置模型；不宣称所有提供方一定返回 reasoning。没有新增界面，不需新增浏览器交互验收。代码与 TLL 记录均未提交或推送。
