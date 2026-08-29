# @deepseek-ai/dsh-tavern-host

[English](README.md) | 中文

面向 Tavern 配置的 Host 侧资产管理和第一阶段运行时投影模块。`TavernAssetHost` 解析 Character Card V2/V3 和独立 World Info JSON，将其转换为 `dsh-tavern-assets` 所有的标准记录，并提供 list、import、select、inspect 操作。`TavernAssetService` 通过 `storageDomain` 持久化导入源，通过 Host Remote 暴露资源和会话选择操作，并为每个 agent 安装当前角色 persona 与 World Info 投影。

导入源由 storage domain provider 保存，并在服务启动时恢复。会话选择采用追加事件：`selectForSession` 将完整的标准化 baseline 写入 `tavern/assets-selected`。空会话选择包含非空 `firstMessage` 的角色卡时，还会写入一个 `tavern/greeting` 事件。运行时和浏览器 Chat 投影都从该事件读取开场白，因此回放时不会把开场白伪造成模型生成的 assistant 消息。角色卡中的嵌入式 `character_book` 会保留在角色源数据中，但不会隐式注册为独立 World Info 资产。

## 接口

- `listCharacters()` 和 `listWorldInfo()` 返回脱离注册表的快照。
- `importCharacter()` 和 `importWorldInfo()` 解析并注册一个文档，返回资产和 disposer。
- `select()` 委托 `AssetRegistry` 执行选择校验和 prompt baseline 投影。
- `inspectSelection()` 返回选中的脱离快照及同一份 baseline。
- `selectForSession()` 将选择的 baseline 追加到目标 Session，并且只在空会话中记录一次持久化开场白。
- `inspectSession()` 从 Session 日志重放最近一次选择。
- `listMemory()` 和 `remember()` 读取并追加按会话持久化的 Memory 条目。
- `inspectStoryState()` 和 `setStoryState()` 读取并追加规范的位置和时间变更。
- `inspectSwipe()` 和 `selectSwipe()` 读取并追加持久化的 assistant 候选选择。
- `regenerate()` 在一个已完成轮次之前创建子 Session，保留选中的候选，运行原用户消息生成新回复，并在 child 空闲且完成 flush 后返回。

World Info 激活会使用所选资源中最小的 `scanDepth` 作为最近消息窗口，并使用最小的 `tokenBudget` 作为确定性的 first-fit 预算。中间概率由会话、来源和查询文本派生出的稳定 roll 处理；同一 group 内的条目按 compiler 的确定性排序竞争。条目的 depth、sticky 和 cooldown 会保留在 prompt baseline 和激活 ledger 中，供后续有状态策略使用；当前 runtime 尚未持久化 sticky 或 cooldown 计时器。

默认 ID 是名称的小写 slug。重命名资产或存在同名资产时，请通过 `options.id` 指定稳定 ID。

运行时会在 Harness 提示词插值之前解析角色卡中的 `{{char}}` 和 `{{user}}` 宏。其他简单 Tavern 宏会降级为单花括号文本，避免角色卡原文被误认为 Harness 提示词变量。

## 模型体验

### 所选 Tavern 上下文

#### 模型可见内容

导入和检查操作不会改变模型请求。调用 `selectForSession` 后，agent runtime 会把当前角色 persona 和匹配的 World Info 加入后续 system prompt；每次选择和上下文快照都会记录在 Session 日志中。选中的角色字段和 World Info 条目文本会作为作者提供的剧情数据渲染，不会授予工具或改变 system policy。

#### Token 影响

导入和检查不消耗实时请求 token；选中的 persona 和 World Info 会消耗后续请求的 prompt token。

#### KV Cache 影响

导入和检查本身不创建模型请求。选择变化会改变后续请求的 system prompt 和 cache key。

## 已知限制与后续工作

- Memory 当前是带 pinned、persistent、scene 层级的追加式 upsert 投影；尚未实现按 observer 隔离的 L0-L3 检索或删除控件。
- Story State 当前提供规范的位置和时间变更；库存、关系、健康、修炼、场景编排和群聊仍待实现。
- Swipe 会在 Session 日志中保留并选择 assistant 候选；`regenerate` 会在目标轮次之前创建子 Session，复制选中的候选，运行原用户消息生成新回复，并在 child 空闲且完成 flush 后返回。本包未暴露通用 fork 命令。
- 运行时会记录上下文激活快照并把关键词匹配的 World Info 投影到 system prompt；不支持压缩的角色卡元数据和可执行的 SillyTavern 扩展。
