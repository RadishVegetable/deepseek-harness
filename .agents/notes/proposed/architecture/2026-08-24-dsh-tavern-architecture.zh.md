# Agent Note: dsh Tavern 的上下文、记忆与角色扮演组合架构

Status: proposed

[English](2026-08-24-dsh-tavern-architecture.md) | 中文

## Problem

SillyTavern 是角色卡和 World Info 的重要兼容目标，但它的运行时会把作者设定、模型生成的记忆和聊天历史压缩成一次可变的 Prompt 组装。系统没有每个角色独立的知识视角，没有权威的结构化剧情状态，也没有由事件驱动、可重放的检索决策记录。因此长对话会重复事实、遗忘事实、暴露私密知识，并把大量无关内容重复消耗在每轮输入中。

目标产品需要使用同一条 GM 驱动的故事循环，同时支持聚焦关系故事和多个角色在同一剧情中行动的大世界设定。它必须兼容酒馆资源格式，作为 TypeScript dsh 组合运行在 Docker 中，提供可用的 Web 页面，并且在控制每次模型调用输入的同时，能显示实际发送给模型的完整上下文。所有模型可见内容都必须可以从 dsh Session 日志重建。

## Proposal

构建可选的 dsh Tavern 组合。它复用 dsh 的 Session、Prompt、LLM、压缩、Web 和分支能力，增加酒馆专用的资源、剧情状态、记忆、上下文、编排和连续性插件。Tavern profile 根据所选资源和 profile 策略组合所需插件，不替换 dsh 核心，也不嵌入 SillyTavern 的 JavaScript 运行时。

下文描述的执行模式已由[已实现的 GM 驱动剧情段决策](../../implemented/architecture/2026-08-29-gm-led-story-segments.md)取代。本提案中较新决策没有重新定义的知识视图、上下文编译、资源兼容性和日志重放决策仍然有效。[已实现的 Tavern 分阶段交付决策](../../implemented/architecture/2026-08-29-tavern-staged-delivery.md)和 GM 决策重新定义了默认连续性模型：旅程专属的自然语言人物事实和世界事实取代固定的关系、物品或健康状态投影，成为下一阶段的实现目标。

交付阶段由[已实现的 Tavern 分阶段交付决策](../../implemented/architecture/2026-08-29-tavern-staged-delivery.md)定义。本文描述的包拓扑和结构化运行时是目标架构；第一阶段可以只复用现有 Session 和普通自由文本聊天，不必挂载所有后续子系统。

已有的[酒馆角色扮演界面提案](../feature/2026-08-24-tavern-roleplay-surface.md)继续负责功能级的 UI 和 swipe 方案；本记录负责它依赖的跨模块架构和知识模型。

### 组合和 GM 叙事循环

```text
Tavern Web UI and API
        |
Tavern profile and session-scoped composition
        |
+-------+---------+----------+----------+----------+
| assets | state  | memory   | context  | narrative |
| ST    | story  | L0-L3    | compiler | GM loop   |
| import| state  | views    | retrieval| segments  |
+-------+---------+----------+----------+----------+
        |
dsh Session log, projections, prompt surface, LLM, Web, storage
```

profile 提供一条 GM 叙事循环。一次玩家输入产生一次 GM 模型生成和一个剧情段。剧情段可以包含旁白、设定变化以及多个角色的行动或对白。这是一种伪群聊呈现，不是一组角色 Agent：运行时不会为每个角色分别调用模型，也不会在调用之间选择发言者。profile 可以按需启用规划或连续性处理，但它们不是面向玩家的独立交互模式。

选择角色卡或 World Info 只选择资源和默认配置，不会隐式授予 shell、web、filesystem、skill 或 subagent 等无关工具。

### 领域模型

系统分开保存五类信息：

- **资源**：作者控制的输入，例如角色卡、Character Book、World Info 条目、World Book、preset 或导入的 PNG。
- **旅程材料**：由导入来源快照创建的旅程专属角色卡和世界书副本。
- **事实**：`people[personId]` 或 `world` 下的一条自然语言连续性记录。事实可以描述关系、身份、物品、传闻、发现或其他剧情概念，不要求为它建立专门的产品字段。
- **知识视图**：某个观察者可以使用的事实，包括信念、传闻、推断和错误信念。第一版只向模型提供一个 GM 视图；角色知识是叙事数据和投影元数据，不是角色 Agent 的独立请求。
- **事件来源**：记录资源快照、剧情正文、事实操作、上下文决策和分支的 Session 事件。投影永远不是事实来源。

L0-L3 保留记忆抽象层级，但不负责隔离：

```text
L0  raw Session events and transcript segments
L1  observer-specific atomic memories
L2  observer-specific scene or episode memories
L3  observer-specific stable long-term memories
```

知识隔离使用独立维度表达：

```text
observerId       gm | character:<id> | player | narrator
visibility       public | witnessed | heard | private | gm-only
epistemicStatus  canon | belief | rumor | inference | false-belief
acquisition     witnessed | heard | read | told | inferred | granted
authority       user | gm | authored-asset | observed | model-candidate
provenance       source event ids and asset references
```

同一个事件可以为不同观察者生成不同记忆。角色不知道秘密，不代表系统删除秘密，而是角色知识视图排除该秘密。这是叙事软隔离，不是安全隔离。

角色卡和世界书是作者定义的基线。旅程专属事实行是连续性层。以后如果某些值需要精确的机器校验，可以增加固定投影作为可选扩展；它们不是默认叙事循环的必需部分，也不会取代自然语言事实记录。

### 剧情事件和模型可见性

Session 事件日志是唯一权威来源。Tavern 增加资源选择、场景指令和计划、公开或私密场景节拍、状态变化、知识获取、记忆候选、上下文决策和连续性决策等声明合并事件类型。影响重建的事件必须在读取时被识别；具体事件名和字段类型由声明它的 package 负责。

每次模型请求都使用 dsh 现有的 request/header 和 request/context 持久化路径。编译后的上下文快照记录实际发送给模型的渲染段落、来源 ID、编译策略版本、观察者、token 预算、选中的候选和被过滤的候选。历史模型请求不能依赖当前检索索引或数据库记录才能重放。

模型生成的记忆首先是带来源事件和权威元数据的候选。用户或 GM 可以提升、修正、失效或固定它。修正通过新事件关闭旧断言的有效期，而不是删除旧信念，因为旧信念可能解释后续的戏剧行为。

分支属于事件模型。Swipe、重新生成和历史编辑都在稳定回合边界创建或替换 Session 分支。L1-L3 和结构化剧情状态都从当前分支投影，废弃分支不会污染活动剧情。

### 上下文编译和检索

上下文编译器为一次 GM 生成组装一个模型可见视图，并为玩家和诊断界面提供安全投影，顺序如下：

```text
stable prefix
  system rules, asset baseline, stable setting, tool schemas
dynamic suffix
  current Journey facts
  public scene state
  observer L3
  observer L2
  filtered and ranked L1
  recent visible events
  current player input
```

检索必须先过滤，再执行语义排序：

```text
observer and visibility filter
  -> validity and branch filter
  -> Journey fact projection
  -> keyword or FTS candidate lookup
  -> vector retrieval when needed
  -> rerank and deduplicate
  -> token-budget packing
```

World Info 激活保留酒馆的确定性规则，包括关键词、secondary keys、整词匹配、递归、深度、分组、概率、sticky、cooldown 和插入位置。向量检索可以扩展候选召回，但不能绕过可见性和有效性检查，也不能把候选自动提升为正典。

编译器统一管理稳定资源、公共状态、GM 记忆、最近事件和输出预留的 token 预算。它不会把完整聊天记录或完整 World Info 集合复制到每个请求。稳定前缀的缓存键包含资源版本、GM 上下文策略版本、记忆投影版本、编译策略版本和工具 schema 版本。动态检索结果放在稳定前缀之后，以避免破坏可复用前缀。

第一版不会创建角色专属的模型请求。剧情段中的角色归属只是 transcript 渲染和状态投影使用的输出元数据。GM 上下文必须在会导致非预期泄露时排除玩家无权查看的信息；这是上下文策略问题，不是把一个回合拆成多个角色调用就能解决的问题。

### SillyTavern 兼容

兼容层支持 Character Card V1/V2 JSON、PNG 内嵌卡片、V2 `character_book` 和独立 World Info JSON 的导入导出。SillyTavern 的 `World` 按可复用的 World Info/Lorebook 条目集合处理，可以附加到角色卡或旅程，但不会变成拥有角色栏和权威剧情状态的世界实体。关联的 `extensions.world` 是附属引用，不是另一种世界模型。兼容层保留未知字段、原始条目顺序、源文本、关键词、secondary keys、插入位置、深度、递归、分组行为、概率、sticky、cooldown 和可往返导出的扩展数据。

导入器保存原始资源并生成标准化原生资源。原生模型可以为检索建立条目索引和设定引用，但不会把 Lorebook 变成拥有角色的实体图。导入器保留原始扁平 World Info 条目，以便导出时保持兼容。静态资源不会被静默转换成 L3 记忆。

第一版会把任意 SillyTavern JavaScript 扩展、regex 脚本、远程服务钩子和 UI 专属行为保留为不执行的扩展数据。导出仍可保留这些字段，但 dsh 进程不会执行它们。无法满足语义的必需字段在导入时明确失败，未知的非执行元数据继续保留。

### UI、Docker 和可观测性

Web 组合提供聊天、角色卡和 World Info 管理、场景控制、记忆查看、剧情状态查看、分支和 swipe 控制以及 Prompt Inspector。Inspector 显示单次 GM 请求、实际渲染段落、token 预算、缓存键、召回候选、带原因的过滤候选、来源事件和连续性警告。它必须明确区分发送给模型的内容和仅供调试的诊断数据。

Docker 镜像构建 TypeScript workspace，并在可配置的容器绑定地址上运行选定 profile。profile 必须显式启用容器绑定，不能依赖只适用于开发环境的 host 覆盖。持久化存储包括 Session 日志、导入资源、投影和索引；向量存储是可选的，可以从来源事件重建。

### 安全和失败行为

角色卡、World Info、记忆和模型输出都是数据，不是系统指令。编译器把它们放入声明的 Prompt 段落，不允许导入文本改变系统策略或授予工具。工具组合由 profile 显式决定。

错误配置和无效持久化数据必须明确失败。运行时降级也必须可观察：向量提供方不可用时回退到结构化和 FTS 检索；没有记忆结果时不能凭空创建记忆；请求超预算时使用配置的优先级裁剪；GM 生成失败时按 profile 策略停止回合或生成带标记的降级旁白。连续性警告必须在自动修复或重试前记录。

### Package 归属

第一版 package 拓扑如下：

```text
packages/tavern/compat        pure ST parsers, serializers, and asset preservation
packages/tavern/assets        asset service and session asset selection
packages/tavern/state         optional typed projections over Journey facts
packages/tavern/memory        L0-L3 projections, observer views, and providers
packages/tavern/context       activation, retrieval, budget, and prompt compiler
packages/tavern/orchestration GM narrative loop and Story segment consumers
packages/tavern/continuity    validators, warnings, and repair policy
packages/bundle/tavern        installable profile and plugin composition
```

纯解析和渲染辅助函数保持为普通 TypeScript 模块。可替换后端的能力使用 Service Definition、Provider 和 Consumer 三个角色。第一版使用本地持久化提供方和 FTS；向量和外部记忆服务是可选能力提供方，不是领域模型的前置条件。

## Alternatives considered

**直接修改 SillyTavern。** 这样可以保留现有 UI，但仍然以可变 Prompt 管线、分裂的 completion 路径和分支语义为核心。它无法充分利用 dsh 的事件日志、Prompt 重建和插件组合能力。

**创建独立的替代服务。** 这会重复实现 dsh 的 Session 持久化、Prompt 组装、Web 流式传输、分支和能力策略。目标是 dsh 组合，而不是第二个 agent runtime。

**使用全局记忆并要求模型遵守角色知识。** 一个包含所有秘密的模型可见 Prompt 不是真正的软隔离。可靠的知识不对称需要独立观察者投影和检索前过滤。

**把向量 RAG 作为剧情数据库。** 相似度检索无法强制当前地点、物品、死亡、修为境界、关系状态、分支有效性或权威等级。结构化投影和来源事件负责这些值，RAG 只负责召回候选文本。

**每次回复都先调用规划器或角色 Agent。** 这会增加聚焦关系回合的 token 和延迟，而分开的角色调用也会让一段有因果关系的剧情更难连贯生成。第一版使用一次 GM 生成；只有明确接受额外成本的 profile 才启用可选规划。

**在群聊中按角色分别调用模型。** 这会重复发送相同的 World Book、旅程和场景上下文，增加发言者调度，并把 token 消耗在协调上。一次 GM 生成可以在一个剧情段中标注多个角色块，同时保持因果顺序。

## Acceptance criteria

1. dsh Tavern profile 从现有 dsh package 组合，并在显式配置的绑定地址上启动 Docker Web 页面。
2. 每次玩家输入产生一次 GM 生成和一个剧情段，该剧情段可以包含旁白以及多个角色的行动或对白；不需要角色专属调用。
3. 同一个 Character Card V1/V2 或 World Info 资源往返导入导出时不丢失支持字段和未知元数据。
4. 角色请求不能召回其 observer、visibility、branch、validity 或 authority 排除的记忆。
5. GM 请求及其接受的剧情段作为一个叙事回合记录；玩家无权查看的内容由 GM 上下文策略排除，角色归属不会创建另一个模型可见请求。
6. canon、belief、rumor、inference 和 false-belief 始终可区分，并在修正和分支投影中保留来源事件。
7. 旅程专属人物和世界事实使用事实操作校验，并从选定分支投影；固定类型投影是可选扩展，而不是默认连续性存储。
8. Prompt Inspector 可以重放精确的模型可见上下文，并显示 token、检索、缓存和连续性决策。
9. Swipe、重新生成和历史编辑从选定分支投影记忆和剧情状态，不污染下游分支。
10. 可运行的无密钥示例和 snapshot 覆盖聚焦关系回合、多角色剧情段、恋爱关系变化、修为状态变化以及 ST 导入导出往返。

## Risks

观察者模型增加了领域复杂度，而且不是安全隔离。产品必须明确 GM、角色、玩家和界面查看者的语义。一次 GM 生成可能过长或发出互相矛盾的事实操作，因此需要输出预算、封套校验、事实 ID 和可恢复截断。第一版不会完整兼容酒馆扩展；可执行扩展必须移植为显式 dsh 插件。精确上下文快照会增加 Session 体积，因此压缩和投影存储必须在保留重放能力的同时允许索引重建。自动连续性更新可能改写用户刻意制造的戏剧内容，因此 Host 必须保留原始剧情并记录每个接受或拒绝的操作。
