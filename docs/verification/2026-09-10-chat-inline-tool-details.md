# 对话工具详情内联展示验收

任务：`chat-inline-tool-details`。本次仅调整对话展示和事件投影，不改变 Excel、MCHE 业务确认或原始会话存储。

## 实际问题

通过运行中的 `127.0.0.1:43189` 服务读取最新会话“读取一下这个表格，帮我整理”。该轮已有最终回复，历史接口 `incomplete: false`；共有 13 个工具结果，其中 3 次理解发布失败后重试。原界面把这些结果入口集中附在正文末尾，缺少明确的整轮回复状态。

原始会话及客户资料未改写；读取结果仅暂存在忽略目录 `.dsh`，不作为共享验收附件。

## 结果与规则

- 由原生公开事件投影段落 ID 和工具调用所在段落，流式正文、最终回复、历史重开使用同样的位置。没有前置文字的工具入口放在首个可见段落旁。
- 工具结果是正文中的蓝色入口，失败调用附红色“失败”文字；原始内容默认收起，点击后进入现有详情抽屉。选型入口使用“查看…建议”，避免把查看描述为确认。
- 本轮状态区分正在思考、工具处理中、正在整理回复、回复已完成、未确认完成和达到输出上限。工具返回不代表整轮完成；“回复已完成”不代表需求确认或计算执行完成。
- 后续流式更新和整轮完成保留已打开的工具抽屉；同一调用不会重复添加入口。业务确认仍需用户在既有页面执行。
- 保留原 JSON 字段并新增段落和结束原因投影；旧接口无段落信息时仍能显示内容和内联详情。没有修改持久化格式。

## 验证

1. `node --test packages/dsh-lite-web-app/test/*.test.js packages/dsh-mche/test/tools-http.test.js packages/dsh-mche/test/requirements-native.test.js packages/dsh-excel-understanding/test/native.test.js`
   - 50 通过，0 失败，1 跳过（Windows 环境不运行 Linux 图片预览案例）。覆盖流式 HTTP、并发门禁、失败/中断、历史恢复、公开信息过滤、Excel 原生工具循环、需求确认及会话隔离。
2. `pnpm run typecheck`：通过。
3. `git diff --check`：通过；仅现有 LF/CRLF 提示。
4. 真实 Chromium 浏览器交互，使用本机已有 Playwright 和隔离 DSH 实例、确定性本地模型：
   - `scripts/verify-chat-details-browser.mjs`：通过。验证完成前可见的正文与内联入口、抽屉保留、键盘 Enter/Escape 及焦点恢复、刷新恢复、并行工具状态、失败/重复结果、截断、HTML 文本安全和旧响应兼容。点击详情没有发送业务修改/确认/计算请求。
   - `scripts/verify-requirements-browser.mjs`：通过。原 26 条需求填写、模式切换、确认、未接入模式阻塞、刷新恢复和窄屏流程回归通过。
   - 桌面 1440×1000、窄屏 390×844，无页面异常或横向溢出。已人工查看桌面及窄屏截图。

浏览器复现（使用现有模块，不安装依赖）：

```powershell
$env:MCHE_BROWSER_EXECUTABLE='C:/Users/huangyunfei/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe'
node scripts/verify-chat-details-browser.mjs C:/Users/huangyunfei/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs
node scripts/verify-requirements-browser.mjs C:/Users/huangyunfei/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs
```

证据：[流式截图](evidence/chat-details-streaming.png)、[桌面截图](evidence/chat-details-desktop.png)、[窄屏截图](evidence/chat-details-mobile.png)、[交互断言](evidence/chat-details-browser.json)。截图内容为隔离测试数据。

## 边界与加载

本次未重跑全仓测试，未重新验证外部模型或 DLL 计算。系统浏览器连接不可用，已使用本机 Chromium 完成真实交互验证。

没有停止或重启用户正在运行的服务。服务重启后会加载新的后端段落投影，刷新并重开原对话即可应用新布局，无需重新向模型提问。任务代码及证据未提交、未推送。
