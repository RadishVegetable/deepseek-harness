# Agent Note: Tavern 资源选择与提示词投影

Status: implemented

Tavern profile 将工作台挂载为全屏 root surface，并提供自己的导航和会话选择器；transcript 与 composer 仍来自共享 `conversation` slot。

[English](2026-08-24-tavern-asset-selection-and-prompt-projection.md) | 中文

## 问题

Tavern Web 标签需要为一个 Session 选择导入的角色卡和 World Info，同时模型可见的 persona 与上下文必须能够从 Session 日志重建。仅保存在浏览器中的草稿无法提供重启恢复，静态 preset 也无法为一个活动 Session 切换角色。

## 决策

第一阶段 Tavern 使用 `@deepseek-ai/dsh-tavern-host` 作为资源存储、会话选择和 agent 提示词投影的 Host 所有者。Character Card V2/V3 JSON、未压缩的角色卡 PNG 元数据以及独立 World Info JSON 由 `dsh-tavern-compat` 标准化并注册到 `dsh-tavern-assets`；原始 JSON 通过 `storageDomain` 持久化，并在 Host 启动时恢复。

`selectForSession` 校验选择，将完整的标准化 baseline 追加为 `tavern/assets-selected`，并返回脱离注册表的会话选择。每个 agent 安装一个由当前角色生成的完整 `persona` section，以及一个动态的 `tavern:world-info` section。World Info 使用纯编译器提供的 observer、branch、validity、整词匹配、确定性排序和 ledger 规则。编译结果发生变化时，会在下一次模型可见投影前记录 `tavern/context-activation`。

浏览器包 `@deepseek-ai/dsh-client-ui-tavern` 注册一个 `conversation.view` 标签页。它通过 Host Remote 导入 JSON 和角色卡 PNG 文件，选择一个角色卡和多个 World Info，读取最近的 Session 选择，并显示最近一次记录的 system prompt。PNG 导入只读取未压缩的 `chara` 元数据，不保留图片字节。UI 不拥有 Session 状态，也不会自行增加提示词内容。

同一个 Host Remote 还提供按会话的 Memory upsert、规范的位置和时间 Story State 变更、持久化 assistant Swipe 候选的检查和选择，以及源 JSON 更新/导出。浏览器工作台展示这些操作，但不增加第二套会话存储或发送路径。

Tavern bundle 在 Web profile 之上加载 Host 与浏览器包，并选择 `tavern` 直接角色扮演 preset。该 preset 不加载编码工具；选择资源后，后续请求会通过 Host runtime 改变。

Remote wire 类型使用显式的 `./types` 出口。`AssetId` 使用共享的 `Branded` 原语，使 Typert JSON 校验器将 brand 视为仅存在于编译期的数据。

## 考虑过的替代方案

**把选择保存在浏览器中。** 这样会失去重启恢复能力，并使提示词依赖 Session 日志之外的客户端状态。

**把当前角色放进进程级 preset。** 这无法表达按 Session 的角色切换，还会让无关 Session 共享同一份角色 baseline。

**把导入文本直接注入一个拼接字符串。** 这样会丢失来源信息，绕过 observer-aware context compiler 和激活 ledger。

## 验证

- `packages/tavern/host/tsconfig.json` 的 Host TypeScript 编译通过。
- `tsconfig.client.json` 的 Client aggregate TypeScript 编译通过。
- `packages/tavern/host/tests/host.spec.ts` 与 `packages/client/ui-tavern/tests/views.client.spec.tsx` 通过；测试分别使用真实 Host facade 和客户端 slot 组合。
- `@deepseek-ai/dsh-tavern-host` 的 Host Typert 分析和生成通过，包含 Remote client 声明与运行时 descriptor。

## 延后内容

更大范围的 Tavern 架构仍负责按 observer 隔离的 L0-L3 记忆、完整的 swipe/fork 和 regenerate 行为、群聊、场景规划、可执行扩展处理以及更丰富的历史 Prompt Inspector 视图。当前实现提供规范的位置和时间 Story State、按会话的 Memory upsert、持久化候选的 Swipe 选择和最近请求 Prompt Inspector 数据。上下文激活快照会记录编译后的 World Info 决策；无依赖解析器不会解码压缩的 `zTXt`/`iTXt` 角色卡元数据。

## 后果

导入资源通过源记录在 Host 重启后恢复，会话选择、Memory、Story State 和 Swipe 选择通过追加事件恢复。只有在 Session 选择事件之后，persona 和 World Info 的变化才会对模型可见，因此请求可以从日志重建。UI 保持兼容现有 conversation 与 Trajectory surface，并提供内嵌 Tavern 工作台，但还没有独立的 Tavern 运行时或完整分支命令。
