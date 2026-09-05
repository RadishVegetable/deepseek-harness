# @deepseek-ai/dsh-tavern-host

[English](README.md) | 中文

面向 Tavern 配置的 Host 侧资产管理和 Journey 运行时模块。`TavernAssetHost` 解析 Character Card V2/V3 和独立 World Info JSON，将其转换为 `dsh-tavern-assets` 所有的标准记录，并提供 list、import、select、inspect 操作。`TavernAssetService` 通过 `storageDomain` 持久化导入源，通过 Host Remote 暴露资源、会话选择和 Journey 事实操作，并为每个 agent 安装当前角色 persona 与 World Info 投影。

导入源由 storage domain provider 保存，并在服务启动时恢复。会话选择采用追加事件：`selectForSession` 只将资源 ID 和玩家身份写入 `tavern/assets-selected`；需要 prompt 或 Remote 返回脱离资源时，Host 通过 durable 源注册表解析这些 ID。当前 Journey 的动态栏目只从 `tavern/fact` 事件投影。事实可以覆盖详情中的显示栏目，例如以 `label: Name` 更新已有世界人物的显示名，但不会改写源资源。空会话选择包含非空 `firstMessage` 的角色卡时，还会写入一个 `tavern/greeting` 事件。运行时和浏览器 Chat 投影都从该事件读取开场白，因此回放时不会把开场白伪造成模型生成的 assistant 消息。角色卡中的嵌入式 `character_book` 会保留在角色源数据中，被标准化为附属 World Info 资产，但不会隐式注册为独立 World Info 资产。Journey 启动 Remote 会在返回前等待有界的会话持久化屏障；屏障超时时调用失败，而模型整理仍是尽力执行并确定性回退。选择之后，`normalizeForSession` 会针对源注册表投影最多执行一次辅助模型调用，校验模型返回的每个来源 ID，将结果转换为 authored `tavern/fact` 事件，并只在 `tavern/assets-normalized` 中记录 origin 和 route 元数据。没有模型路由、模型失败或输出无效时使用确定性的源栏目回退。同一个 Session 的并发整理请求共享一次调用；如果调用期间 Journey 选择发生变化，则丢弃旧结果。

## Journey 事实

一次玩家输入仍只产生一次主要 GM 生成。当前 GM 提示词要求输出纯散文；Host 先持久化 assistant 响应，并在组合了 `ctx.jobs` 时排入独立的回合结束提取任务，不阻塞下一回合。旧的 `story` 加 `updates` 解析器仍保留，用于回放和已有 fixture；这个兼容路径接受的操作与提取器接受的原子事实都会追加 `tavern/fact` 事件。没有这些结构化路径时，普通叙事文本不会成为持久化事实。

`updates.people[personId]` 和 `updates.world` 包含自然语言的 `add`、`replace` 和 `remove` 操作。操作可以携带任意显示 `label`，但不会改变事实正文的自然语言形式。Host 为追加操作分配 `fact:<assistantSeq>:<operationIndex>` ID，允许格式有效的 `add` 引入新的 `person:<slug>`，为 `replace` 和 `remove` 校验事实归属，并为每个接受或拒绝的操作追加一条 `tavern/fact` 事件。每条事件都带有 assistant 序号、回合、分支以及确定性的响应幂等键；相同响应重放或 reload 后重试都不会重复追加。

`resolveTavernFacts` 按日志顺序从已接受事件重建 `people[personId]` 和 `world`。替换和撤销都追加新事件，因此活动投影会改变而审计记录保留；Session 子分支只会看到其 seed 前缀中的事件。人物可以通过所选 World Book 的人物身份或有效的 GM `add` 进入投影；主角色卡不会自动成为人物。查询 Remote 返回活动事实，`editFact` 和 `removeFact` 允许玩家修改或撤销已有事实，但不会手动创建事实。

World Person 的稳定 ID 由 authored 事实中的来源锚点生成，显示名则优先读取该 ID 下最新的 `Name` 事实；因此重命名不会创建重复人物，也不会因为全局资源库变化而丢失 Journey 本地修改。兼容的 `updates` envelope 和回合结束记忆提取器是能够产生持久化变更的结构化路径。

## 旅程记忆

当前 GM 提示词要求输出纯散文。兼容的 `story` 加 `updates` 解析器仍用于回放和已有 fixture；另有独立的回合结束提取器观察散文，不阻塞下一回合。当组合了 `ctx.jobs` 时，Host 会为每个完成回合排入一个提取任务，把精确提示词和输出写入 Session 日志，并追加采纳的 `tavern/fact` 事件。Host 启动时会校验记忆策略；部署可通过服务的 `memory` 配置提供该策略。

`@deepseek-ai/dsh-tavern-memory` 负责共享的 subject-key 折叠、新鲜度保护、分支可见性、注入快照和可丢弃的检索索引，因此 Host、UI 与压缩消费者使用同一个投影。该包提供 `SqliteFactIndex`，它是带版本标记、可从事实源重建事实索引查询的 SQLite 提供方；`EmbeddingProvider` 支持注入，`DeterministicEmbeddingProvider` 提供离线默认实现。`MemoryIndex` 组合词法与余弦信号执行混合检索，不要求网络 embedding 调用。Host 会在 agent pre-step 把可见记忆渲染为提示词注入快照，记录精确快照；提供 `ctx.tools` 时还会注册只读的 `fact_search` 工具。

`inspectFacts()`、`listPersonFacts()` 和 `listWorldFacts()` 暴露当前投影与审计记录；`editFact()`、`removeFact()` 和冲突裁决都会向同一事实流追加决定。确定性资产清洗提供预览和确认，同时保留源记录。未挂载其他压缩提供方且未禁用压缩时，`TavernCompactionEngine` 会选择完整回合、提交有界 checkpoint，并记录只包含关系的清理证据。`inspectMemory()` 只从完整的 compaction/summary 记录及其匹配的 checkpoint 源 `user/message` 重建 checkpoint 和剧情投影；不会回退到普通转写内容，缺失或不完整的数据会返回空的 checkpoint 数组。

客户端记忆面板提供 State、Plot 和 Audit 视图，支持清洗预览与确认、事实编辑/删除、冲突裁决，并在会影响 Journey 投影的变更前要求影响确认。

## 接口

- `listCharacters()` 和 `listWorldInfo()` 返回脱离注册表的快照。
- `importCharacter()` 和 `importWorldInfo()` 解析并注册一个文档，返回资产和 disposer。
- `select()` 委托 `AssetRegistry` 执行选择校验和 prompt baseline 投影。
- `inspectSelection()` 返回选中的脱离快照及同一份 baseline。
- `selectForSession()` 将资源 ID 和可选玩家身份追加到目标 Session，并且只在空会话中记录一次持久化开场白。
- `inspectSession()` 从 Session 日志重放最近一次资源选择，并通过注册表解析源资源。
- `deleteAsset()` 从内存和持久化注册表中删除源资源，不检查 Journey 引用；仍选择该 ID 的 Journey 在再次导入相同 ID 前无法解析其资源。
- `inspectHistory()` 读取冷 Session 摘要，除非 durable WorkspaceRegistry 已归档该会话；`archiveHistory()` 持久化归档状态，并对重复归档、未知会话或缺少 registry 分别返回结构化的 `history-already-archived`、`history-not-found` 或 `history-archive-unavailable` 错误。
- `inspectArchivedHistory()` 读取已归档 Session 保留的记录摘要，`restoreHistory()` 移除归档标记，不删除或重写记录。
- `editJourneyCharacter()` 和 `editJourneyWorldInfo()` 为当前 Journey 追加已授权的字段事实，不会修改资源库。
- `normalizeForSession()` 根据所选源注册表投影准备 authored `tavern/fact` 事件，并只将整理元数据记录到 `tavern/assets-normalized`；动态栏目从事实投影读取。
- `inspectFacts()` 返回当前 Journey 事实投影以及已接受或拒绝的 `tavern/fact` 记录。
- 当工具注册表可用时，`fact_search` 是针对可见 Journey 事实投影的只读模型工具。
- `applySectionConfig()` 将动态栏目配置追加到 Session 日志；重试已应用的相同操作时返回回放投影而不追加重复事件，`inspectSectionConfig()` 可在 reload 后重建配置。
- `listPersonFacts()` 和 `listWorldFacts()` 查询当前 Journey 事实投影。
- `editFact()` 为已有事实追加替换；`removeFact()` 追加撤销。两者都不会创建新事实。
- Journey 记忆统一来自追加式 `tavern/fact` 事实流。事实投影、编辑、撤销、冲突裁决和审计都使用这条流，不再存在第二份按会话保存的记忆文档。
- `previewAssetCleaning()`、`confirmAssetCleaning()` 和 `inspectAssetCleaning()` 提供确定性的源记录保留式资产清洗。
- `inspectMemory()` 只在 compaction/summary 记录完整且存在匹配的 checkpoint 源消息时返回 checkpoint 与剧情投影；缺失或不完整的配对会产生空的 checkpoint 列表。
- 启用压缩且没有其他提供方时，`TavernCompactionEngine` 作为原生回退压缩提供方挂载；它压缩完整回合，并让原子事实保持追加式。
- `inspectStoryState()` 和 `setStoryState()` 读取并追加规范的位置和时间变更。
- `inspectSwipe()` 和 `selectSwipe()` 读取并追加持久化的 assistant 候选选择。
- `regenerate()` 在一个已完成轮次之前创建子 Session，保留选中的候选，运行原用户消息生成新回复，并在 child 空闲且完成 flush 后返回。

World Info 激活会使用所选资源中最小的 `scanDepth` 作为最近消息窗口，并使用最小的 `tokenBudget` 作为确定性的 first-fit 预算。中间概率由会话、来源和查询文本派生出的稳定 roll 处理；同一 group 内的条目按 compiler 的确定性排序竞争。条目的 depth、sticky 和 cooldown 会保留在 prompt baseline 和激活 ledger 中，供后续有状态策略使用；当前 runtime 尚未持久化 sticky 或 cooldown 计时器。

默认 ID 是名称的小写 slug。重命名资产或存在同名资产时，请通过 `options.id` 指定稳定 ID。

运行时会在 Harness 提示词插值之前解析角色卡中的 `{{char}}` 和 `{{user}}` 宏。其他简单 Tavern 宏会降级为单花括号文本，避免角色卡原文被误认为 Harness 提示词变量。

## 模型体验

### 所选 Tavern 上下文

#### 模型可见内容

导入和检查操作不会改变模型请求。调用 `selectForSession` 后，agent runtime 会把当前角色 persona、匹配的 World Info 和渲染后的 Journey 记忆注入加入后续 system prompt；每次选择、记忆快照和上下文快照都会记录在 Session 日志中。选中的角色字段和 World Info 条目文本会作为作者提供的剧情数据渲染，不会授予工具或改变 system policy。

#### Token 影响

导入和检查不消耗实时请求 token；选中的 persona、World Info 和渲染后的 Journey 记忆会消耗后续请求的 prompt token。

#### KV Cache 影响

导入和检查本身不创建模型请求。选择或可见记忆投影变化会改变后续请求的 system prompt 和 cache key。

## 已知限制与后续工作

- 旧版 Memory 和 Story State Remote 仍作为独立兼容接口保留；主 Journey UI 不提供手动创建 Memory 或 Story State。自动连续性事实是自然语言 Journey 事件，不会写入固定的关系、库存、健康或修炼字段。
- 整理在有可用模型路由时使用所选模型，否则使用确定性的源栏目回退。`TavernCompactionEngine` 会把完整回合压缩为有界 checkpoint 并记录只包含关系的清理证据；事实原子仍保持追加式，因此面向事实的专用压缩和更丰富的多条目整理仍待实现。
- 默认 embedding provider 是确定性的，`EmbeddingProvider` 支持注入；外部或网络 embedding provider、ANN 存储、向量池化以及更大规模的向量索引仍待实现。
- 组装后的 keyless Loader snapshot 已覆盖 Tavern 选择、后台提取、持久化的 `tavern/memory-context` 注入、原生压缩、持久化生命周期记录和压缩后的继续运行。将 reload 与 fork 恢复合并到同一场景仍待实现，完整的跨进程 transcript 验证以及覆盖客户端记忆面板的 assembled browser transcript 也仍待补齐。
- 跨 Journey 的通用 `dsh` 记忆插件不属于当前交付的 Tavern 能力，仍待实现。
- Story State 通过次级控件提供规范的位置和时间变更；场景编排、群聊以及 World Info `sticky`/`cooldown` 计时器的持久化仍待实现。
- Swipe 会在 Session 日志中保留并选择 assistant 候选；`regenerate` 会在目标轮次之前创建子 Session，复制选中的候选，运行原用户消息生成新回复，并在 child 空闲且完成 flush 后返回。本包未暴露通用 fork 命令。
- 运行时会记录上下文激活快照并把关键词匹配的 World Info 投影到 system prompt；不支持压缩的角色卡元数据和可执行的 SillyTavern 扩展。
