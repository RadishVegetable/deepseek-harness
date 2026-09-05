# Agent Note: Tavern Journey memory capability seam

Status: implemented

[English](2026-09-03-tavern-journey-memory-capability.md) | 中文

## Problem

Tavern Journey 的连续性需要一套可回放的事实视图，同时支持提取、资产启动与清洗、冲突处理、有界提示词注入、检索和剧情压缩，并且不能新增第二份按 Session 保存的记忆文档。

## Decision

`@deepseek-ai/dsh-tavern-memory` 负责纯 Journey 记忆能力。`tavern/fact` 记录是追加式唯一事实来源；`projectMemoryFacts` 按目标、人物和可选的 `subjectKey` 折叠可见记录，把受保护的分歧保留为冲突。view-local 的 `subjectKey` 别名在影响折叠、检索或注入之前，会先校验 subject domain 归属、冲突映射和循环。事实 fold、注入快照、检索数据、资产清洗视图和压缩摘要都是派生数据，可以从源记录重建。

严格提取解析器只接受固定原子词汇，完整批次格式错误时拒绝整批。入库 writer 使用 `(sessionId, span)` 幂等性，校验人物和 subject-key 归属，保留提取出处，并在不修改历史记录的前提下追加 observed 事件。`MemoryExtractionScheduler` 按 Session 串行排队，同时允许不同 Session 并发执行。提供 `ctx.jobs` 时，Host 会调度回合结束提取，以精确提示词和输出记录开始、完成或失败；提供 `ctx.tools` 时会暴露可选的只读 `fact_search` 工具。

记忆注入把稳定角色文本与动态 Journey 文本分开，在应用经过校验的 `activePeople`、`activeFacts` 和 `prefetchTopK` 上限之前移除当前请求上下文中已有的事实，并接受 view-local 的 subject-key 别名。`MemoryIndex` 是组合词法与余弦信号的可丢弃内存暴力索引。`SqliteFactIndex` 提供带版本标记、可重建事实索引查询的 SQLite provider。`EmbeddingProvider` 支持注入，`DeterministicEmbeddingProvider` 提供离线本地默认实现；这些派生 provider 都不会取代 Session 日志。

`cleanTavernAsset` 为 Character Card 和 World Book 提供确定性、带来源追踪的回退视图。Host 可以用经过校验的模型结果替换该视图，并提供预览和确认，同时保留原始源 JSON。摘要解析器只接受剧情文本、带状态的未决伏笔和只包含关系的原子清理证据，不能生成替代事实文本。启用压缩且没有挂载其他 provider 时，Host 会挂载 `TavernCompactionEngine`：它的自动范围选择使用完整回合，checkpoint 受配置限制，清理决定与现有压缩生命周期一起追加。`inspectMemory()` 只从完整的摘要和匹配 checkpoint 源 `user/message` 记录重建 checkpoint；缺少或不完整的配对会返回空的 checkpoint 数组。

线上 GM 提示词要求输出纯散文，同时保留 `story` 加 `updates` 响应路径用于兼容和回放。独立的回合结束提取器观察散文而不阻塞下一回合，因此本能力不会静默替换现有 GM wire protocol。客户端记忆面板提供 State、Plot 和 Audit 视图、源清洗预览与确认、事实编辑与删除、冲突裁决，以及在改变投影的变更前进行影响确认。更早的分阶段运行时决策仍记录在 [Tavern staged-delivery note](2026-08-29-tavern-staged-delivery.md) 和 [GM-led story note](2026-08-29-gm-led-story-segments.md) 中；本 Note 扩展它们的追加式事实基础，并记录已交付的记忆能力。

## Alternatives considered

**保存可变的 Journey 记忆文档：** 不采用，因为这会产生第二个权威来源，使 fork 可见性含义不清，并需要独立的回滚协议。现在从 Session 日志派生 fold。

**把提取和折叠都放进 Host：** 不采用，因为资产清洗、检索、提示词渲染和压缩 consumer 需要共享同一套纯词汇，而不应导入完整 Remote service。

**立即替换 GM 的 `updates` wire protocol：** 本能力不采用，因为当前 Host Remote 和回放 fixture 消费这套协议。记忆能力独立接受结构化提取格式，后续协议工作可以复用事件和 fold 规则而无需重复实现。

## Consequences

事实视图具备确定性新鲜度行为、玩家值和显式观察保护、分支安全回放、来源出处、view-local 别名、注入上限、混合检索以及可丢弃的 SQLite 或内存索引。无效模型输出可以重试而不推进游标，派生行不会成为独立事实来源，Host 压缩会把 checkpoint 文本与原子事实分开保存。

Host 负责模型路由、持久化接入、后台提取调度、可选的 `fact_search` 工具、保留源数据的清洗和原生 Tavern 压缩 provider。Host 的 `fact_search` 路径会为每次查询建立可丢弃的 `MemoryIndex`；`SqliteFactIndex` 和 embedding provider 是可替换的派生 provider，而不是 Session runtime 的默认存储。客户端消费 Host 投影和 checkpoint Remote，同时显式展示能力缺失。

异步提取可能使下一次请求短暂使用之前的投影，但精确生命周期记录、幂等键、游标和追加式事实流让重试与回放保持确定性。`inspectMemory()` 会拒绝看似 checkpoint 的普通转写内容，而不会把普通对话文本当作剧情 checkpoint；State、Plot 和 Audit 视图分别展示对应的投影、checkpoint 和事件证据，不会创建另一份记忆文档。

## Testing

Memory 测试覆盖 subject-key 归一和别名、严格整批提取解析、幂等入库、新鲜度冲突、无键替换、分支 seed 可见性、活动和审计检索行、词法加余弦排序、注入上限与当前上下文排除、确定性 embedding、带版本的 SQLite 持久化、只包含关系的摘要解析、串行提取调度和确定性资产清洗。

Host 测试覆盖回合结束提取生命周期、模型可见的记忆上下文、事实字段与投影、`inspectMemory()` checkpoint 配对、安全压缩范围选择、工具配对处理和完整 Host 压缩生命周期。客户端测试覆盖 State、Plot 和 Audit 面板视图、真实 checkpoint 字段、清洗确认、事实编辑与删除、冲突裁决和影响确认。

组装的无 key Loader snapshot 覆盖 Tavern 选择、后台提取、持久化 memory-context 注入、原生压缩、持久化生命周期记录以及通过真实应用组合完成的压缩后续写。Host aggregate typecheck 以及 memory 和 compaction 专测覆盖该 snapshot 使用的 package 与 Host 接线路径。

## Coverage gaps

跨 Journey 的通用 `dsh` 记忆插件尚未实现；本能力限定在 Journey 内，不提供用户或项目级偏好记忆。

外部或网络 embedding provider、ANN 存储、向量池和更大规模的向量索引尚未实现。可注入的 `EmbeddingProvider`、确定性本地 provider、暴力 `MemoryIndex` 和 SQLite 派生 provider 提供替换位置，但不声称已经提供这些服务。

Story State 提供规范的位置和时间变更，但场景编排和群聊尚未实现。World Info 会把 `sticky` 和 `cooldown` 元数据保留在 prompt baseline 与激活 ledger 中，但 runtime 不会持久化它们的计时器。

面向事实的专用压缩和更丰富的多条目组织尚未实现；Tavern 压缩会总结剧情 checkpoint 和只包含关系的清理，同时让原子事实保持追加式。

压缩的 Character Card 元数据和可执行的 SillyTavern 扩展不受支持。

无 key Loader snapshot 覆盖提取、注入、压缩和压缩后续写，但没有在同一场景组合 reload 与 fork 恢复，也没有组装的浏览器转写覆盖客户端记忆面板。Package、Host 和客户端测试分别覆盖这些组件。
