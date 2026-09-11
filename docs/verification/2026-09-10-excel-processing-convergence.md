# Excel 识别与处理收敛验收

日期：2026-09-10。独立任务：`excel-processing-convergence`。既有 `condenser-requirements`、`condenser-profile-mapping` 及其历史保留。

## 实现

- `mche-input.js` 在新会话 revision=0 时也注入指引与最新方案状态；附件仍由服务端核验 fileId、文件名和全部 Sheet 概览。
- `workbook-message.js` 与工具描述改为按用户意图选择专用处理，困难时定向补证据。标准冷凝器表优先一次 requirements_read，复用完整 Profile、原文、换算/SH、推荐与冷媒精确匹配。
- 版本参数描述及结果的现有 notes 指明最新顶层方案版本；真实版本冲突继续拒绝。notes 复用后端模式标签、字段、缺项及主工况/测试条件规则，避免模型自行解读缩写。
- 通用理解原始值、转换及证据错误附字段名、字段路径、来源坐标、实际原因和可重放的期望值；保留 EXCEL_INVALID、原 HTTP 状态及现有 quote/coverage 诊断。只修正出错字段即可重新发布，不放松校验。
- 沿用四区域草稿与客户需求核对入口，不主动另加参数表卡片；独立表格仍可按用户明确要求整理。可疑风量只核对原值/单位，测试条件单列。
- 没有新增业务工具、改变工具参数结构或持久化格式，没有改全局模型配置、依赖、DLL 模式或用户确认门禁。成功 Profile 契约保持，说明在现有 notes 中补充。

## 确定性与交互验证

最终定向命令：

```powershell
node --test --test-concurrency=1 packages/dsh-mche/test/requirements*.test.js packages/dsh-mche/test/tools-http.test.js packages/dsh-lite-web-app/test/mche-input.test.js packages/dsh-excel-understanding/test/read-contract.test.js packages/dsh-excel-understanding/test/service.test.js
```

**35/35 通过，无跳过**，日志 `.dsh/convergence-acceptance.log`。覆盖：

- 26条记录；SH=27.4 K、RH=55%、SC=0 K、风量原文 `4 m³/h`。
- 公英制、单位选择/冲突、公式缓存待核、隐藏/移动行列、多候选不写草稿、用户选表及未知字段保留。
- 新会话首次模型请求含真实文件/Sheet与 revision=0；客户端伪造的文件名/Sheet被服务端覆盖；确定性模型一次调用获得完整结果。
- 读取后直接复用冷媒匹配与最新方案版本进行建议；旧版本写入仍失败。
- 通用错误定位非首个字段、原值与转换差异、quote路径；定向修正成功。分页后仅补目标行可局部发布，但声明整表覆盖仍失败。
- 需求编辑/确认、原件校验、重启恢复、SH重算、原值保留及不支持模式继续阻塞。

使用本机已有 Playwright/Chromium 运行 `scripts/verify-requirements-browser.mjs`：桌面1440×1000、手机390×844通过，页面错误0。验证四区域草稿、修改两个SH来源、清除来源、明确SH冲突、推荐、确认、模式切换、执行阻塞与刷新恢复。只使用隔离工作区和确定性模型，未把夹具输入当作正式工程确认。机器记录见 [浏览器结果](evidence/excel-processing-convergence-browser.json)。

`pnpm run typecheck` 与 `git diff --check` 通过。

较广回归为125通过、2失败、2跳过；随后受影响MCHE范围复测58/60通过。两项失败为 `fin-native.test.js:13`、`refrigerant-native.test.js:10` 仍期待“确认翅片型号/确认冷媒”，既有 `response-view.js` 实际使用“查看翅片选型建议/查看冷媒选型建议”。这些文件未改动，[前次验收](2026-09-10-condenser-profile-mapping.md) 已记录同样失败。两个跳过项是Linux视觉预览与真实蒸发器视觉链路。日志 `.dsh/convergence-regression.log`、`.dsh/convergence-final-mche.log`。

补充提示后的并行测试曾在需求追问出现一次502；单独复测及最终串行35项均通过，未改超时、压缩或全局环境。保留 `.dsh/convergence-output-guidance-tests.log`、`.dsh/convergence-native-recheck.log`，不把广回归称为全绿。

## 当前模型三次验收

模型：当前配置的 **DeepSeek-V4-Flash-0731**。将当前本地配置复制到独立DSH目录，使用相同模型、相同文件及原始请求连续创建三个新会话；未写源配置或操作用户原会话。关闭测试服务后清空隔离目录中的凭证副本。脚本：`node scripts/verify-excel-convergence.mjs`。

原始请求从既有会话 `dca79a47-8f37-40e2-abd3-50dbe05c5569` 的页面历史核实：

> 读取一下这个文件，然后帮我整理计算需要的资料

原件：`答复_/3-冷凝器客户输入.xls`；SHA-256：`5806f521604c4933f9005d4fa92f89547a6c47aa87b4f2f08f791511ee9513d0`。

| 最终运行 | 总耗时 | 首次Profile | 识别调用 | 后续冷媒建议 | 总调用 | 重复/失败重试 |
|---|---:|---:|---:|---:|---:|---|
| 1 | 53.123 s | 15.012 s | 1 | 1 | 2 | 0 / 0 |
| 2 | 31.391 s | 6.267 s | 1 | 1 | 2 | 0 / 0 |
| 3 | 43.570 s | 4.393 s | 1 | 1 | 2 | 0 / 0 |

三次均为 `mche_requirements_read(revision=0)` → `refrigerant_propose_selection(revision=1)`，没有重复文件列表、方案查询、推荐、通用读取或理解发布，也没有整理参数表卡片。数据均为26条、4区域、SH=27.4 K、RH=55%、SC=0 K、风量原文4 m³/h。逐次检查回复：推荐ptsc采用入口P&T+出口SC，真正输入缺项为空气绝压；主工况32°C与测试42°C分开说明，未建议替代风量或再次确认RH转换，均引导客户需求页。

平均42.695秒，对用户提供的436秒/20次调用基线，耗时约减少90.2%，总调用减少90%。总耗时从上传完成后的聊天请求计至流式响应结束，首次Profile按成功工具结果事件计时；上传、建会话不计入。基线耗时沿用用户提供值，未重跑旧版本，因此是参考对比。原会话20次工具详情已核实。

实现中另有两组校准运行，保留本地报告：`.dsh/convergence-exploratory-result.json`、`.dsh/convergence-version-calibration-result.json`。首组发现旧版本重试、无必要局部读取和自由文本解释问题；第二组已收敛调用但仍有替代风量示例/混淆测试温度。随后补强参数描述及后端notes，以上表格仅使用最终代码的三次结果，不将较好样本混入平均值。

完整机器证据（含工具参数与最终回复）见 [模型验收结果](evidence/excel-processing-convergence-model.json)。

## 边界与交付状态

本次验证当前模板及已有同结构变体；未知模板、图片选框或未核验公式仍需定向补证据。真实模型准确性结果限于同一份样表的三次运行，不代表任意模板都能自动映射；工程物性/DLL模式边界保持原状。

代码及TLL记录未提交、未推送。现有用户服务未被重启，后端改动需在该服务下次重启时加载；验收使用本次启动并已关闭的隔离服务。
