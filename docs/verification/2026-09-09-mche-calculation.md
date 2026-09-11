# MCHE 实际计算插件实施与验收记录

实施时间：2026-09-09至2026-09-10。任务：`mche-calculation-plugin`，关联原 `mche-single-row`。获批范围见 [实施方案](../mche-calculation-plan.md)。本记录区分代码实现、接口数值回归、浏览器交互和工程精度，不以模拟成功替代原生调用。

## 当前结论

计算输入/工程确认、确定性映射、工具与HTTP、独立x86 Worker、异步持久化、取消/超时/重启中断、结果追溯及页面代码已实现。全部目录继续可查。只开放当前Profile中已核对的WATER物性绑定、均匀矩形孔、均匀百叶窗映射。

**S5验收未完成，任务未标记完成：**

- 真实LTR与当前目录的合成测试输入均调用了真实DLL，64槽结果与独立示例调用一致，但42/43槽（管/翅片温度）为NaN。两条执行路径都稳定复现；程序严格记录failed，保留标记和所有有限部分结果。尚不能提交一例完整成功的工程计算。
- 未收到用户确认的“当前目录组合＋工程补充＋PTM工况”资料。测试用A44S/B01/WATER及等面积孔宽明确标注为合成夹具，不能当作工程确认。目录原值、原流通面积均未改。
- 浏览器控制连接失败：CUA `nodeRepl.fetch request failed`；独立Playwright接口初始化连接 `ws://localhost:9222/devtools/browser` 超时。未完成实际点击、视觉布局、浏览器刷新/取消验收；没有伪造截图。
- 既有间歇性聊天502仍会影响对话测试，根因未定位。基线及当前均有同类失败，不能据此宣称全量回归通过。

## 实现证据

| 步骤 | 实现与核验 |
|---|---|
| S1 | [42参数契约](../mche-native-contract.md)、机器contract、181文件哈希、Profile及确定性Mapper摘要；真实32位/SHProp加载位置检查 |
| S2 | 独立calculation子状态、来源与原表快照、用户确认、相关输入/快照/规则变更失效；查询不失效；工况与工程核对表 |
| S3 | 20个插件工具（原15＋新增5），共用HTTP业务服务；确认仅用户入口；原始用户消息授权；准备包过期、会话边界、按钮/对话幂等和并发合并 |
| S4 | 每次独立Python进程、全服务串行、默认120秒、取消2秒后终止本任务进程；运行记录追加保存；重启中断不重跑；结果绑定原输入 |
| S5 | LTR/目录合成输入真实执行与独立对照、故障/状态测试完成；真实工程成功算例及浏览器验收受阻 |

实现入口：[插件说明](../../packages/dsh-mche/README.md)、[计算服务](../../packages/dsh-mche/src/calculation-service.js)、[映射](../../packages/dsh-mche/src/calculation-mapper.js)、[任务执行与持久化](../../packages/dsh-mche/src/calculation-runner.js)、[Worker](../../packages/dsh-mche/src/worker/worker.py)、[页面](../../packages/dsh-lite-web-app/public/mche-calculation.js)。

## 自动验证

以下是实际执行记录；较早通过的结果不覆盖后续失败。`.dsh/`中的完整日志及运行目录为本checkout本地证据，不承诺随Git同步。

| 命令 / 阶段 | 实际结果 / 日志 |
|---|---|
| 实施前MCHE基线 | 29/30；refrigerant-native.test.js出现聊天502；`.dsh/calculation-baseline.log` |
| 原有service/fin/refrigerant定向回归 | 22/22；`.dsh/calculation-first-tests.log` |
| 三个目录测试 | 16/16；`.dsh/calculation-catalog-tests.log` |
| 阶段性MCHE全包测试 | 40/40；`.dsh/calculation-mche-final-tests.log`；之后新增了离线测试及分页检查 |
| 最后一次全仓 `pnpm test` | 120项：117通过、1失败、2跳过；失败为原有MCHE native.test.js聊天502；`.dsh/calculation-all-final.log` |
| 分页/缺依赖等收尾后 `node --test packages/dsh-mche/test/*.test.js` | 41项：40通过、1失败；失败为calculation-native.test.js引用指令后的聊天502；映射/原生/故障/离线测试通过；`.dsh/calculation-mche-delivery-tests.log` |
| 最后计算专项复测 | 全部11项通过（包括对话和离线计算）；`.dsh/calculation-final-acceptance.log`；不能消除前述间歇性502记录 |
| 无模型密钥独立测试 | 1/1；确认、准备、真实计算到原生失败结果均不产生模型请求；`.dsh/calculation-offline-native.log` |
| `pnpm run typecheck` | 通过（最后用pnpm.cmd直接执行确认退出0） |
| `pnpm peers check` | 通过，No peer dependency issues found |
| `pnpm run config:dump` | 配置加载通过；未在报告复制凭据或完整环境 |
| `git -c core.safecrlf=false diff --check` | 退出0；未修改Git配置或提交 |
| 新页面JS `node --check` | mche-calculation.js、mche-view.js、app.js语法通过；不替代浏览器交互 |
| `scripts/mche-runtime-setup.ps1 -CheckOnly` | 实际Worker32位、加载位置及181文件校验通过 |

新增定向场景覆盖：负摄氏、0%湿度、绝压、角度rad/degree、节距/净间距/FPI、管数与连接矩阵、未知孔型/翅片结构、EG/PG、目录面积冲突、无关缺项、未确认/更换快照/旧准备包、跨会话、重复点击、按钮与对话并发、运行中修改、分页、排队/运行取消、超时、崩溃、非法JSONL、非有限结果、缺DLL/哈希不匹配、重启中断。

最后收尾还核验了：仅插件内绑定导入且忽略外部Python环境；Worker绑定代码纳入准备包摘要；未参与计算的逻辑tubePitch修改不使原生准备过期；已建任务丢失响应后即使方案改变，重试原requestId也只返回原任务并标记历史。全量回归记录在这些收尾之前；收尾后重跑11项计算专项、真实独立对照、typecheck/peers，未把先前全仓结果当作最新全量通过。

模拟Worker只用于失败、排队和取消测试，不提供模拟数值成功。DSH集成使用本地确定性模型和真实插件/Worker；不验证外部模型理解准确率。

502复测记录：`.dsh/calculation-502-recheck.log`中超时恢复及模型配置测试失败；串行复测`.dsh/calculation-502-serial.log`中超时恢复通过、表格动作返回409。后续全量同两模块通过，而另一MCHE对话失败。单独留存了失败工作区和会话边界，尚不能确定根因；没有修改无关Agent循环来隐藏失败。

## 真实原生调用与独立对照

运行使用项目 `.dsh/mche-python-x86/python.exe`，独立于外部旧解释器。没有改动外部SHDLL junction。实际主DLL/物性版本见 [契约](../mche-native-contract.md)。

重放命令：

```powershell
.\scripts\mche-runtime-setup.ps1 -CheckOnly
node scripts/mche-native-replay.mjs 'E:\projects_related_files\微通道'
```

后一命令调用独立维护的 `run_ltr_case.py`/`mche_driver.py`，用其 `CaseBuffers` 和 `invoke` 重新分配原生缓冲并调用DLL，不经过新Worker执行方法。新Worker与参考程序共用同一DLL，因此这是ABI/输入及数值回归对照，不是独立物理模型精度证明。

独立调用源码SHA-256：run_ltr_case.py=`58122ac197059410eec180b96dfb32abe5fd2441c5effbe4041f5ac291d4f23f`；mche_driver.py=`30aeda65dc57b569eb402fcf614a905937a6ebd2f3e68b42e9f20db52b5d109c`。

可随仓库保存的 [原生输入、完整输出和对照JSON](evidence/mche-20260910-native.json)包含两组归一化数组、64槽输出、NaN位置、Profile/Mapper摘要及明确标注的合成确认值。完整catalog-run（包括三个目录快照、逐字段来源、触发和运行环境）保存在 `.dsh/calculation-replay-evidence/catalog-run.json`。

| 原始输出 | LTR重放 | 当前目录合成夹具 | 单位 |
|---|---:|---:|---|
| 换热量 | 9398.148056638463 | 7737.516763870328 | W |
| 冷媒质量流量 | 0.25 | 0.25 | kg/s |
| 空气压降 | 0 | 0 | Pa |
| 冷媒压降 | 4075.3530788556236 | 19267.82233717745 | Pa |
| 空气出口温度 | 309.2180273830509 | 307.56271834449905 | K |
| 冷媒出口绝压 | 95924.64692114438 | 80732.17766282255 | Pa |
| 冷媒出口温度 | 309.15034376334927 | 310.741115769345 | K |
| 管/翅片温度42/43 | NaN / NaN | NaN / NaN | K |
| 与独立调用一致槽数 | 64/64 | 64/64 | 包括同位置NaN标记 |
| 新Worker状态 | failed | failed | 非有限结果禁止成功 |

旧软件LTR保存的空气压降约150.698Pa，与当前DLL不同；不把旧保存值作为当前版本工程精度基准。原示例函数返回true并未检查所有槽的有限性，不能据其success字段认为本插件应返回成功。

合成目录输入逐项核对：Tube首排为 `[0,31,0.6916,0.002,0.0254,0,14,0.00086,0.0011452226305431897,0,0,0,0,0]`；余56项为单排未使用容量。孔宽是测试中按目录面积构造的等面积矩形值，**没有证据证明实际A44S孔型就是此形状**，生产Mapper不会自动构造这个值。FPI按测试明确的节距定义；温度/压力/流量及翅片采用值、单位、来源均保存在JSON中。没有用户真实工况预填到生产状态。

本机的一个物性XLSX存在按读取进程不同而得到不同文件流的现象：PowerShell读取5520805字节；Node和实际x86 Python读取5519781字节且SHA匹配契约。环境预检因此由实际Worker计算所有文件哈希，未更换允许哈希；没有据PowerShell的不同流重写原资源。

## 浏览器验收待办与复现入口

已准备隔离的本地模型/DSH/UI夹具，原测试会话和工程来源均明确标为测试。工具连接失败发生在导航初始化阶段，尚未进行页面操作。

```powershell
node scripts/mche-ui-fixture.mjs
```

脚本输出独立端口、工作区及会话ID，并在 `.dsh/calculation-ui-state.json` 登记；三个测试部件已选、计算草稿未确认。它不会改动用户正式会话。浏览器连接恢复后需要完成：

1. 打开输出地址及测试会话，从“MCHE方案”进入工况/工程核对；修改、保存、核对来源，验证未确认时阻塞。
2. 确认合成测试输入，准备参数、查看最终数组，点击开始计算，看到任务及NaN失败详情；刷新页面和重开会话仍可查。
3. 再次计算、取消本次任务，核对状态恢复及重复请求不重复建任务；更换参数后旧结果标为历史。
4. 对话发送“开始计算”、引用该句、修改后计算，分别验证授权和确认门禁；同时记录是否遇到既有502。
5. 检查桌面/窄屏布局、键盘焦点、可读状态、日志详情和模型不可用时的页面按钮。

任务状态、确认API、刷新重启恢复及取消已通过相应后端测试；上述浏览器实际交互仍必须另验，不能以接口测试代替。

## 解除阻塞所需资料

需要用户提供至少一组精确部件型号及工程采用依据：孔型与流通面积、翅片焊前/后高度和Width/Depth对应、Full/Overall开窗、节距或净间距、材料导热系数、Extend Fin/长度及装配说明，连同PTM和空气工况、管数、方向。也可提供可核对的本地资料路径。程序可以整理草稿，但需要用户实际确认。

DLL方面需澄清当前版本为何返回42/43槽NaN及空气压降0，或提供修正DLL及相应契约/示例证据；更换版本后重新验证。没有工程依据前不忽略NaN、不放宽面积核对、不把其他介质目录序号当编码。

未提交、未推送。保留工作区原有改动；TLL记录、实现、报告及本地运行环境的版本控制状态分别保留，任务未finish。
