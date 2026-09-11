# 冷凝器需求读取与填写验收

任务：`condenser-requirements`。实现范围、字段清单和使用方法见 [需求填写说明](../condenser-requirements.md)。保留工作区既有未提交内容，未提交、未推送，不改原 Excel 或真实 DLL 模式。

## 已验证行为

- 原表按标题与字段结构识别，恰好26条有值记录；改名、行列平移、隐藏页仍可读取，空字段和右侧预置选项不作为填写值。
- `82,4 °C`、`21,06 bar(a)`、原始0.55/显示55%、0K、No、false、90°?、合并区域、单位选框依据均保留。未支持的英制单位列不会被丢弃后误用公制列；缺单位、公式缓存和含糊数字继续待核。
- 冷媒7 × 空气3 × 流量2，共42种组合各自唯一输入集合。主工况32°C与测试42°C分别保存；目标热量、空间尺寸和夹角不自动替代计算输入。
- 用户确认与输入齐备分别记录；确认前差异包含旧版PTM草稿。确认原子更新工况、保存全部需求及来源快照，保留结构/工程草稿，并使旧确认及准备包失效。
- 跨会话、伪造确认、过期版本、并发确认、差异预览后的工程修改、原件篡改均拒绝。模型没有确认接口。
- 未接入模式确认后 `native=null`、`calculationReady=false`，旧PTM包无法执行。切回PTM保留此前流量等输入，确认、独立部件选择及工程核对之后才允许准备。
- 真实DSH、本地确定性模型及实际HTTP服务完成上传、工具读取/推荐、用户确认、执行阻塞、重启和历史恢复。外部模型准确率未测。

## 自动检查

| 命令 | 结果 |
|---|---|
| `node --test packages/dsh-mche/test/requirements.test.js packages/dsh-mche/test/requirements-native.test.js packages/dsh-mche/test/calculation-mapping.test.js` | 13/13通过 |
| `node --test packages/dsh-mche/test/requirements.test.js packages/dsh-mche/test/tools-http.test.js` | 最后一次定向复验10/10通过 |
| `node --test src/catalogs/flat-tubes.test.mjs src/catalogs/fins.test.mjs src/catalogs/refrigerants.test.mjs` | 16/16通过 |
| `pnpm test` | 整合回归126通过、1失败、2跳过；后续单位保护及差异显示补充以定向和浏览器复验覆盖 |
| `pnpm run typecheck` | 通过 |
| `pnpm peers check` | 通过，无依赖问题 |
| `pnpm run config:dump` | 通过 |
| `git diff --check` | 通过；Git给出既有LF/CRLF提示 |

全仓失败为 `packages/dsh-excel-understanding/test/timeout-native.test.js`：1秒无进展超时后，恢复时可能缺少模型/提示词快照；单跑也曾在继续对话时返回504。把同一用例复制到临时目录并禁用整个 `mche` 插件后，仍复现恢复快照失败。该用例未在本任务中修改，不把全仓回归称为全绿。详细本地日志：`.dsh/requirements-regression.log`，隔离诊断脚本 `.dsh/timeout-without-mche.test.mjs`。

## 浏览器验收

CUA返回 `nodeRepl.fetch request failed`，内置浏览器不可用；Playwright连接工具在既有Chrome的9222连接初始化超时。使用本机已安装的Playwright及独立无头Chromium成功完成实际页面交互，没有安装依赖、修改全局浏览器配置或接管用户会话。

可复验脚本：`scripts/verify-requirements-browser.mjs`。脚本自动创建隔离DSH工作区、上传参考文件，使用本地确定性模型；通过UI执行推荐、补填、确认、参数准备、模式切换与刷新。正常结束关闭浏览器和本次服务并清理夹具工作区。只在测试工作区确认测试输入，不构成用户的正式工程确认。

```powershell
$env:MCHE_BROWSER_EXECUTABLE='C:/Users/huangyunfei/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe'
node scripts/verify-requirements-browser.mjs C:/Users/huangyunfei/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs
```

已有可解析的Playwright依赖和匹配浏览器时，也可直接运行 `node scripts/verify-requirements-browser.mjs`。另一台机器使用自己的已有模块/浏览器路径，不安装或更改项目依赖。

已观察并断言：页面选择当前会话Excel并读取；55%、0K、No、90°?的填写值；采用PTSC推荐并补绝压；需求确认；未接入模式“开始计算”按钮禁用；切PTM补质量流量；冷媒/空气/流量模式切换后900kg/h保留；刷新恢复确认及测试原文；1440×1000和390×844布局；页面脚本错误为0。

共享证据：`evidence/condenser-requirements-browser.json`、`evidence/condenser-requirements-desktop.png`、`evidence/condenser-requirements-mobile.png`、`evidence/condenser-requirements-mobile-fields.png`。

参考原件SHA256：`5806f521604c4933f9005d4fa92f89547a6c47aa87b4f2f08f791511ee9513d0`。测试和最终校验均保持一致。XLS图片/控件完整视觉核验、外部模型准确率及新Boundary的物性/DLL工程验证未包含在本期完成结论中；原计算任务已有NaN问题继续独立保留。
