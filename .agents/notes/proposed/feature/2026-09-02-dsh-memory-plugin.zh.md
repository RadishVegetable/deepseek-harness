# Agent Note: dsh 记忆系统插件设计

Status: proposed

[English](2026-09-02-dsh-memory-plugin.md) | 中文

## Problem

dsh 需要在不改变 Session 追加式日志和模型请求重建语义的前提下，异步保存用户或项目级的事实、偏好、指令和任务，并在后续会话中提供可追踪的画像与召回。把记忆写成可变摘要会失去来源、分支和撤销信息。

## Proposal

### 能力角色

记忆能力由 Service Definition、Provider 和 Consumers 组成。Service Definition 定义原子记忆、patch、来源和 fold 词汇；Provider 负责追加式存储和可替换检索；Consumers 负责画像注入和可选的 `memory_search` 工具。提取器只调用一次结构化 LLM 请求，不需要 subagent，后台调度由 `ctx.jobs` 或 idle maintenance 负责。

记忆归属分为 `user` 和 `project` 两个正交轴。用户身份使用 `dsh-identity`，项目归属使用工作目录；归属不足以确定时必须显式降级或拒绝，不能静默写入全局库。

### 原子数据与画像 fold

原子记忆以 append-only 记录保存，包含 `type`、`subjectKey`、自然语言内容、owner、`grade`、scope、表态时间和 provenance。画像不是可变结果文档，而是 patch 流的确定性 fold；用户手写画像也作为带时间的表态进入同一折叠函数。

同一主题按来源事件的表态时间 freshness-first。`user-explicit` 不能被更新的 `ai-inferred` 自动覆盖；其余冲突可按最新表态折叠。被覆盖、重复或撤销的原子仍保留，关系和 tombstone 使当前视图可重算。

场景摘要是可选的视图，不是晋升所需的层级。摘要只引用原子来源并承担情节连贯；画像晋升需要独立证据和显式 patch，不能从上一版摘要递归生成。

### 提取生命周期

提取器共享 cursor 和 `(sessionId, span)` 幂等键，在 compaction、会话 idle/收尾或积压阈值达到时读取持久化日志区间。压缩只处理会被替换或隐藏的历史，idle 触发处理未覆盖尾部，二者都不进入 pre-step 热路径。

每批先从日志读取原文，再执行一次结构化 LLM 调用，随后按 subjectKey 检索并追加新原子、duplicate-of 或 supersede 关系，最后推进 cursor。无效模型输出整批拒绝，补提取不依赖上一版画像或摘要。

### 注入与检索

稳定画像放入 `ctx.systemPrompt.section()`，用于可复用的系统前缀；变化较快的原子与场景视图放入 `ctx.systemPrompt.context()`，位于保留历史之后；低频提醒使用 `agent.inject()`。三个挂点产生的模型可见内容都必须通过 Session 事件可重建。

检索 Provider 先按 owner、scope、分支和有效性过滤，再使用关键词、embedding 和时间或热度策略排序。v1 可以使用应用层暴力检索；每条向量固定 `embeddingModel`，替换模型时显式重嵌。注入只提供必须知道的画像，`memory_search` 负责长尾查证，并跳过当前上下文已经包含的事实。

### 撤销、压缩与配置

记忆撤销追加 tombstone，不物理删除。消息撤销仍由 dsh 的 fork 语义表达；根据 child 血缘和 provenance 找到受影响原子，再通过 fold 排除它们。已发送给模型的 provider 请求不能收回，日志留存也不等于新分支的模型可见性。

阈值、top-k、embedding 模型、压缩触发和画像预算全部是 validated Config；跨边界的 memory、extraction 和 patch id 使用 `Branded<B>`。提取和整理必须证明 provenance 连续、索引可重建和 Model-visible ⟺ logged，SDK 投影只有在实际受影响时同步扩展。

## Alternatives considered

**保存一个可变画像文件：** 不采用，因为更新会抹掉来源、冲突和撤销证据；patch fold 可以提供同样的当前视图并保留原子记录。

**每轮把全部记忆放进 system prompt：** 不采用，因为会浪费 token、破坏前缀缓存并把冲突裁决交给模型；稳定画像和按需召回应分开。

**一开始引入向量数据库：** 不采用，因为个人与项目记忆规模适合应用层检索，Provider seam 足以在规模变化时替换实现。

**让 subagent 负责提取：** v1 不采用，因为输入是已记录的转写区间，单次结构化调用足够；需要工具参与时再扩展 Provider/Consumer 关系。

**把所有记忆实现放进 Tavern：** 不采用，因为用户和项目记忆跨越 Tavern，归属、身份和注入挂点应由通用 dsh 能力拥有。

## Acceptance criteria

1. Service Definition、Provider、画像 Consumer 和可选检索 Consumer 的职责可独立替换。
2. 原子、patch、关系和撤销记录都携带 provenance，并从 Session 或其明确持久化来源重建。
3. freshness-first fold 保护用户显式表态，当前视图不把未解决矛盾交给模型临时裁决。
4. compaction、idle 和 backlog 触发共享 cursor 与幂等入库，错误批次不会推进 cursor。
5. system prompt、PromptContext 和 inject 的模型可见内容都有对应日志事件，检索不会绕过 owner 和 scope 过滤。
6. v1 不要求向量数据库或 subagent，替换检索 Provider 不改变 Consumer 的接口。
7. keyless runnable snapshot 最终证明画像注入、长尾检索、reload 和 fork 撤销；实现前的证据缺口保持明确记录。

## Risks

异步蒸馏可能漏记、误归类或乱序完成，必须以表态时间排序并保留原始 provenance。画像晋升和摘要若递归消费派生结果会产生漂移，因此生成操作必须受证据和一代损耗限制。注入内容属于模型可见数据，任何未记录的来源都会破坏回放。跨机器用户身份、subagent 归属、预算截断和撤销执行仍需要后续决策，不能以隐式全局默认值代替。
