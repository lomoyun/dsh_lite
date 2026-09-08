# @dsh-lite/model-config

DSH / Cordis 原生模型配置插件，版本 0.4.0。
导出 `name`、`inject`、`Config`、`apply`，同时声明 `dsh.bundle.patch`，
可通过原生 `dsh plugin --profile <name> add <tgz绝对路径>` 安装并启用。

## 宿主契约

需要宿主已提供 `llm`、`settings`、`credentials`、`agentDefaultModel`、`webServer`。
前四项来自 dsh-base；webServer 来自 `@deepseek-ai/dsh-host-webserver`。
已验证 DSH 0.1.2-rc.1 / Cordis 4.0.2。裸 Cordis 或仅安装 npm 包不会自动提供这些服务。

插件不自行监听端口，通过共享 webServer 注册：
- `/models` 及其静态资源；
- `/api/model-config/*` 配置 API。

插件卸载仅注销自己的路由，不关闭宿主 HTTP 服务。
“返回对话”指向宿主 `/`。HTTP 请求限制为本机同源，不能作为公网管理后台。

在本仓库运行：

```powershell
pnpm start
pnpm --dir packages/dsh-model-config pack --pack-destination ../../dist
```

访问 http://127.0.0.1:43187/models 。无需第二端口或独立启动命令。

## 配置与存储

支持已加载的 `llm-deepseek` 和 `llm-pi-ai`：
连接地址、密钥引用、原生默认模型，以及每个连接的多模型目录。
自定义接口支持 OpenAI Chat Completions、OpenAI Responses、Anthropic Messages 协议。

连接设置使用 DSH settings 按路径修改，并使用 revision 拒绝陈旧覆盖。
默认 provider/model 写入 `agent-default-model`，切换时清除旧 reasoningEffort。
旧请求输出上限保留在 `model-config-ui.maxTokens`；新模型编辑产生的独立上限保存在
`model-config-ui.modelLimits` 数组（provider/model/maxTokens），匹配项优先于旧全局值。
宿主需在创建 Agent 时读取并传入 agentOptions，本仓库 web-app 已接入。
“保存连接”按顺序写连接与凭据，不构成跨服务事务；部分失败返回连接 ID、partial 和提示，便于安全重试。

API Key 仅写入 DSH credentials；读取接口只返回配置状态、来源和可写状态。
环境来源只读；页面不回传明文、不用 localStorage 保存密钥。
默认存储位于 DSH home 的 `settings.yaml` 和 `.credentials.yaml`，
后者不承诺磁盘加密。配置页面保存不会自动调用外部模型验证密钥有效性。

Apple 设置风格侧栏支持多组连接和切换查看；点击模型的“设为默认”才改变原生默认模型。
新连接支持中文名称，内部 ID、密钥引用自动生成，技术字段收进高级设置。
未保存修改会阻止误切换，保存过程中表单不可编辑。
新增连接仍要求首个模型 ID，容量使用默认值，保存后可在模型弹窗中按实际服务调整。
给已有提供方填写模型会按 ID 追加或更新，保留其他模型；不修改模型参数时只保存连接字段。
暂不支持删除提供方、恢复整个目录或 OAuth 登录。

新增 API：POST `/api/model-config/connection` 一次保存连接与密钥；
POST `/api/model-config/model` 保存单模型目录与请求上限；
POST `/api/model-config/catalog` 显式读取已保存连接的模型列表（10 秒超时、1 MiB 上限、不跟随重定向）。
目录探测不是推理测试；404/405 可手动添加模型。不会在保存时自动发送任何模型请求。
原 `/provider`、`/credential`、`/limits`、`/selection` API 保留兼容。

## 与旧版本的区别

0.4.0 简化连接表单、一次保存密钥、独立模型列表与输出上限，新增显式模型目录探测。
搭配 web-app 0.3.0 支持每次新对话临时选择模型，不修改全局默认。旧模型输出上限保持兼容。

0.3.0 增加侧边栏多配置管理、显式启用和编辑保护，模型目录保存改为追加/更新。
Token 统计由 web-app 插件从原生会话事件读取，不在此插件复制统计或新增存储。

0.2.0 移除独立 HTTP listener，改为共享 webServer，加入 dsh.bundle 声明。
原有 settings 和 credentials 数据继续使用，无迁移或清空。
新版不接受独立 port 配置；端口应在宿主 HTTP 条目设置。

## 验证

仓库根目录运行 `pnpm test`。集成测试通过原生 lite profile 启动，
使用隔离 home、本地模拟模型和虚构密钥，检查保存、冲突、实际模型请求、
多轮会话与重启恢复。真实服务商兼容性需单独验证。
