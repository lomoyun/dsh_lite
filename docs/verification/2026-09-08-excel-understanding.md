# Excel 理解插件验收记录

## 交付范围

按 [用户确认计划](../excel-understanding-plan.md) 新增独立 `@dsh-lite/excel-understanding` 插件，保留现有 DSH Agent 循环、模型路由和原生日志。
实现工作簿原件/索引持久化、全部 Sheet 目录、范围读取与搜索、Linux PDF/PNG 预览、五个 Agent 工具、证据校验及版本化理解结果。
当前附件队列在发送时上传原件，正文流式输出，右侧提供概览、分页单元格、原始预览和待核对项；来源链接可定位单元格或图片区域。
模型判断始终是候选；不含正式参数映射、最终必填数量推测、DLL 调用或 A2A 服务。

本轮使用 `ui-ux-pro-max` 和 `browser:control-in-app-browser` 技能，单主代理实现并自审。
未找到本机所列 Superpowers 专项技能文件，执行了契约/错误路径检查、定向测试、完整回归和浏览器核验；没有独立第二审查者。
保留工作区原有未提交改动，没有 commit 或 push。

## 自动化验证

| 验证 | 最新结果 | 证据 |
|---|---|---|
| Linux 独立副本 `pnpm test` | **66/66 通过**，无跳过 | `.dsh/excel-linux-delivery-verify.log` |
| Windows `EXCEL_RENDER_WSL=Ubuntu; pnpm test` | **65/66**；既有会话集成返回 502 | `.dsh/excel-final-tests.log` |
| Windows 单独重跑会话集成并保留失败产物 | 仍失败于普通会话请求 502 | `.dsh/excel-windows-baseline-recheck.log`、`.dsh/lite-test-qEhEPO` |
| 最后调整标题过滤后的工作区存储/标题测试 | 2/2 通过 | `node --test packages/dsh-workspace/test/store.test.js` |
| `pnpm run typecheck` | Windows / Linux 退出 0 | 既有 TypeScript 工程，不代表新 JS 全量静态类型检查 |
| `pnpm peers check`、`pnpm run config:dump` | Windows / Linux 退出 0 | `.dsh/excel-config-final.log` 及 Linux 验证日志 |
| 插件打包 | 成功，包含 JS、渲染脚本和 Cordis patch | `.dsh/dsh-lite-excel-understanding-0.1.0.tgz` |
| JS 语法与新增代码行数检查、`git diff --check` | 60 个 JS 文件语法通过，行数/差异检查通过 | `.dsh/excel-final-syntax.mjs`、`.dsh/excel-code-check.mjs` |

Windows 失败出现在 `dsh-model-config/test/runtime.test.js` 的既有会话流程；本次全量中为 `action-flow.js:33`，单跑时为 `workspace-flow.js:25`。
本任务开始前已有 49/50 的同类 502 基线。前面一轮 Windows 曾通过 63/63，但不能覆盖最后一轮失败；本轮没有修改原工作区的原子保存实现，也没有把最后的 502 进一步断言为某个系统错误。
最后标题过滤修正已在 Windows 定向测试、Linux 最新全量中验证。

新增测试覆盖 XLSX/XLS/CSV、多 Sheet/隐藏页、合并、空白、公式及缺失缓存、批注、单位、小数逗号和前导零。
OOXML 对象测试覆盖绘图锚点、VML/OOXML 勾选属性、外链与 XML 实体拒绝；超长 CSV 保留未索引范围，范围内容与关联元数据均限制返回量。
证据测试拒绝未读区域、越界坐标、伪造原文/原值和不可重放转换；浏览器阅读不会冒充模型已读。
真实 Cordis 集成覆盖同名隔离、跨会话拒绝、连续追问、隐藏页回查、结果发布、服务重启恢复、删除清理及未发送草稿重启后删除。

图片链路使用真实 DSH `attachments.saveImage`、工具内容块和适配器，检查实际供应商请求包含图片，且未切换模型。
供应商是本地模拟端点；分别验证声明支持图片、文本模型和渲染失败。它证明传输契约，不能证明外部模型读图准确率。

## Linux 环境与隔离

在 WSL Ubuntu 的独立 Linux 工作区安装冻结依赖并运行 Node 22.23.2 / pnpm 11.7.0，避免只用 Windows 进程模拟 Linux。
实际使用发行版 LibreOffice 24.2.7.2、python3-uno、Poppler、bubblewrap 和中文字体；系统依赖安装仅使用官方 Ubuntu 软件源。
工作区位于 `/home/huangyunfei/.cache/dsh-excel-verification/run-4mhoYV/workspace`，复验脚本为 `.dsh/excel-linux-verify.sh`。
复制范围是源码/锁文件/profile 模板，不复制真实 credentials、settings 或用户会话；测试模型只用隔离配置。
实际生成普通及隐藏 Sheet 的 PDF/PNG，验证原文件字节保持一致。渲染禁用宏/链接更新，隔离网络，设置时间、内存及输出限制；依赖或隔离失败时不启用无隔离回退。

## 浏览器核验

使用隔离的 `scripts/ui-fixture.mjs` 和本地模拟模型，分别访问 Windows 后端与 Linux 后端；最新 Linux 页面为本轮临时端口 `46441`。

1. 通过真实 HTTP 上传原件，调用完整 Agent 工具循环，页面打开已保存会话后展示六个完成的详情链接，没有“确认提取”卡片拦截。
2. 理解结果展示两个 Sheet 的覆盖情况、流量原文 `1,25`、单位候选 `kg/s`、规范化候选 `1.25` 和待核对说明。
3. 点击 `来源：冷凝器!B5` 定位到 B5 单元格；保持原始文本，允许进一步查看公式、缓存及批注。
4. PDF.js 实际绘制 Linux 生成的 PDF，显示页码、原始布局和转换可能重算的说明；提供原件/PDF 下载链接。
5. 375×812 下页面宽度与 body 宽度均为 375，PDF canvas 已加载，无页面横向溢出；临时视口收尾复原。
6. 刷新后能重新打开会话和同一理解结果。完整服务重启、连续追问与删除已由真实 Cordis 集成验证。

浏览器扩展拒绝原生文件选择的 `setFiles`（`Not allowed`），因此浏览器“选择/拖入文件→发送”全过程仍未验收；队列延迟上传、同名文件和失败重试已用自动化测试覆盖。
启用方式：`chrome://extensions` → ChatGPT 扩展详情 → **Allow access to file URLs**。本轮未绕过该权限。

## 尚未验收

- 未收到真实冷凝器、蒸发器客户表路径与人工标注；通用合成工作簿不代替客户样例。
- 未测外部真实模型的语义准确率和读图质量；复杂对象会明确列为待核对，不能声称全部对象已理解。
- Windows 既有会话 502 尚未解决；Linux 全量通过不代表该 Windows 问题已消失。
- 归一化结果仍不能直接成为计算输入；需正式模板、字段映射、输入校验和独立用户确认。

因此实现与通用闭环已交付，完整业务验收仍有以上边界；TLL 的 EX4 保持待验状态。
