# Excel 理解插件

独立 DSH bundle `@dsh-lite/excel-understanding`。保留原件、索引和来源证据；语义解释始终是当前对话模型的候选结论。

## 接入

仓库默认 profile 已包含此插件。已有 profile 不会被启动器自动覆盖；在实际 `DSH_HOME/profiles/lite/package.json` 的 `dsh.profile.bundles` 中加入 `@dsh-lite/excel-understanding` 后重启。
本次工作区的实际 profile 已同步加入。可通过 `pnpm run config:dump` 核对。

插件依赖 DSH 的 `tools`、`llm`、`attachments`、`webServer` 服务；网页 HTTP 入口使用 `liteWorkspace` 校验会话归属。
`ctx.excelUnderstanding.service` 是当前网页适配入口；核心 `ExcelService` 可单独创建并用于本地测试。
旧 `/api/tables/import` 仅作为兼容入口保留，新附件走 `/api/excel/upload`。

## Linux 原始预览

```sh
sudo apt-get install libreoffice-calc python3-uno poppler-utils bubblewrap fonts-noto-cjk
pnpm install --frozen-lockfile
DSH_HOME=/var/lib/dsh pnpm start
```

DSH 支持 Node.js `^22.19.0 || >=24.0.0`，本仓库固定 pnpm 11.7.0。
请挂载整个 `DSH_HOME` 为持久化卷，以同时保留插件产物、DSH 会话和图片附件。
服务继续使用原有本地访问限制；远程代理、鉴权和公网部署不在本期范围内。
Linux 主机必须允许 bubblewrap 创建用户/网络命名空间；失败时停止预览并返回未核验状态，不降级为无隔离转换。
使用系统维护的安全更新版本；中文字体影响原布局还原。

渲染进程只读挂载输入和系统运行库，只有本次输出目录可写；隔离网络，清空继承环境。通过 UNO 以 `MacroExecutionMode=0`、`UpdateDocMode=0` 打开工作簿，禁止宏和外链更新。
限制为 55 秒总执行时间、每进程 1.5 GiB 地址空间、45 秒 CPU、20 MiB 输出、最多 12 页。父进程结束时清理所属进程组；不保存转换后的工作簿。
预览来自 LibreOffice 的打印布局，可能重算公式、显示批注或改变分页；永不写回原始索引。达到 12 页即保守标记部分预览。

Windows 开发环境可显式设置 `EXCEL_RENDER_WSL=Ubuntu` 使用该 WSL 发行版的同一隔离渲染器。未设置时结构读取照常可用，原始预览返回环境不可用。

## 工具

| 工具 | 输入重点 | 输出重点 |
|---|---|---|
| `excel_inspect` | `fileId, metadataOffset?` | 全部 Sheet、范围、隐藏状态、对象、索引限制 |
| `excel_read_range` | `fileId, sheet, range` | `requestedRange, returnedRange, nextRanges, partial, cells, quote` |
| `excel_search` | `fileId, query, offset?` | 字面匹配位置、`nextOffset` |
| `excel_preview` | `fileId, sheet, range?, page?` | PDF/PNG 逻辑引用、图片能力状态、预览限制 |
| `excel_publish_understanding` | `fileId, understanding` | 经过来源校验的 `resultId`，供页面及未来适配器读取 |

工具从真实执行上下文取得 `sessionId`，不接受模型指定会话。当前模型必须明确声明 `inputModalities` 包含 `image` 才提供图片；未知或文本模型返回未核验状态，不切换模型。
每次预览工具最多向模型提供一个指定页，通过 DSH `attachments.saveImage` 和工具图片内容块发送；其余页可继续调用。
发送图片只是提供视觉证据；视觉结论必须作为 `observations` 发布，程序无法证明图片中的语义。

## 结果契约 v1

```json
{
  "schemaVersion": 1,
  "overview": "工作簿用途与 Sheet 关联",
  "coverage": [{"sheet": "输入", "purpose": "客户资料", "ranges": ["A1:C3"]}],
  "fields": [{
    "label": "流量",
    "raw": "1,25",
    "normalized": {"kind": "decimal_comma", "value": 1.25},
    "unit": "kg/s",
    "explanation": "小数逗号转换后的候选值，需核对",
    "evidence": [{"fileId": "文件 UUID", "sheet": "输入", "range": "B3", "quote": "1,25"}]
  }],
  "observations": [],
  "issues": [{"kind": "missing", "message": "温度未填写"}]
}
```

- 每个结构引用必须位于原工作簿且已由 Agent 读取；浏览器查阅不增加 Agent 的已读覆盖。
- 已读确认依据原生日志中完整、未截断的新版工具结果；工具刚执行完不等于已送达。连续或交错分页通过严格矩形并集校验，缺口返回 `EXCEL_COVERAGE_INCOMPLETE`、Sheet 和待补读坐标，Agent 可补读后重试。
- `quote` 精确匹配显示文本；矩形区域用制表符分列、换行分行。空白保留为空。
- 引用不匹配返回 `EXCEL_QUOTE_MISMATCH`、`sourcePath` 和具体坐标；原文不超过 8000 字节时附 `expectedQuote`。只引用标题时缩小坐标，预览不可用等环境说明不应伪造单元格来源。
- `raw` 对应单格证据，默认 `evidence[0]`；可用 `valueEvidence` 指定下标。公式原式、缓存结果、显示文本单独保留；缺少缓存不补零。
- 支持可重放的 `identity`、`trim`、`decimal_comma`、`number` 转换。其他单位换算等保留原值，在解释/问题中提出，不自动采纳。
- 图片证据包含 `fileId, sheet, previewId, page, region, observation`。`region` 为归一化 `[左,上,右,下]`，页面必须已提供给模型；没有 OCR 精确原文校验承诺。
- 服务补齐所有 Sheet 的实际索引/读取/理解范围及未核验问题。`validation.calculationReady` 固定为 `false`；模型用途解释、单位和归一化均不等于业务事实已证明。
- 无正式字段模板时不推测最终必填项总数。不包含正式字段映射、原件编辑、DLL 计算或 A2A 服务。

## 存储及限制

`DSH_HOME/excel-understanding/files/<fileId>/` 保存 `original`、`meta.json`、`index.json`、`state.json`、结果 JSON 和 `previews/<previewId>/`。
原文件和索引使用 SHA-256，文件 ID 随每次上传生成，同名同内容仍隔离。来源和预览在使用时校验摘要；写入按文件串行并原子替换。
结果通过 `schemaVersion + fileId + resultId + sha256` 引用，不包含绝对路径或 DOM；未来 A2A 适配器可调用服务读取 JSON 和产物。

单文件上限 5 MiB、ZIP 展开 64 MiB、256 Sheet、每 Sheet 最多 50000 行、整个索引最多 200000 个单元格；目录保留全部 Sheet。
单次读取至多 2000 格，完整工具响应（单元格、原文、元数据、会话引用等）最多 32000 字节，预留当前 DSH 50000 字节内联限制的余量；应继续读取全部 `nextRanges`。
单格及关联元数据无法放入预算时明确报错，不记录已读。宿主使用更低限制而截断结果时，该结果也不会确认；应进一步缩小读取范围或调整已评审的宿主预算。
CSV 逐行计数并保留完整范围；达到预算后不把未索引部分当成空白。每次搜索最多返回 100 个命中。
概览保留全部 Sheet 目录，各类区域、合并、对象及隐藏行列每页至多 12 项，通过 `nextMetadataOffset` 继续查阅。
范围读取中的关联元数据同样最多展示 12 项；`metadataPartial` 为真时，使用概览分页继续检查全部元数据。
超出解析资源限制时保留原文件和明确错误，允许下载与删除；不声称解析完整。

XLSX 可识别图片/绘图锚点、批注、VML 和部分 OOXML 勾选属性；勾选字符只是字符。ActiveX、复杂控件、扩展对象等保守列为待核对。
XLS 对象覆盖不完整，始终列出该限制。Sheet 区域是连续非空行的边界概览，字段语义和同一行内的多区域仍由模型按坐标查阅。

显式删除附件会删除插件目录内的原件、索引、预览与结果；历史引用仍存在并显示已删除。
DSH 会话事件及其内容寻址的图片副本由宿主管理，插件不越权删除共享附件对象；需要彻底清除宿主历史时应使用宿主的数据保留流程。
首条消息发送前创建的仍存活草稿可以接收附件；重启后没有提示词快照的草稿不可继续推理，其已保存附件可通过按会话的本地 API 查阅/删除。
旧版 `state.reads` 保留，但只有带 `version: 2` 的完整响应确认记录用于新结果的证据校验；历史附件和索引无需重新上传，继续理解时重新分页读取即可。

网页整轮默认 `timeoutMs=600000`（十分钟），无进展默认 `idleTimeoutMs=180000`（三分钟），可在 `lite-web-app` 的 Cordis config 中调整。只有当前 Agent 的模型/工具/步骤事件刷新无进展计时，SSE 心跳不刷新；两类超时分别返回 `TURN_TIMEOUT` / `TURN_IDLE_TIMEOUT` 和 504，已保存附件及结果可重新打开查看。

## 验证

```sh
pnpm test
pnpm run typecheck
pnpm peers check
pnpm run config:dump
```

Linux 自动执行真实图片链路测试；Windows 可设置 `EXCEL_RENDER_WSL=Ubuntu` 后执行同一测试。
设置 `EXCEL_REGRESSION_FILE` 为本地客户蒸发器 XLS 原件路径，可执行 D33=10 psid 的实际文件链路回归；原件只读，测试使用独立临时会话，不把客户表加入源码。
测试供应商为本地模拟端点，覆盖真实 DSH 工具循环及请求中的图片数据，不能替代真实模型准确率验收。
完整证据及未验项见 `docs/verification/2026-09-08-excel-understanding.md`。
分页、引用及超时恢复修复见 [修复验证记录](../../docs/verification/2026-09-08-excel-read-recovery.md)。

实现依据：[SheetJS 单元格](https://docs.sheetjs.com/docs/csf/cell/)、[LibreOffice 加载选项](https://api.libreoffice.org/docs/idl/ref/servicecom_1_1sun_1_1star_1_1document_1_1MediaDescriptor.html)、[PDF.js 示例](https://mozilla.github.io/pdf.js/examples/)。
