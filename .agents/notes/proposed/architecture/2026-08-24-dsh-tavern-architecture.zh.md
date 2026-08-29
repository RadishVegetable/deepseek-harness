# Agent Note: dsh Tavern 的上下文、记忆与角色扮演组合架构

Status: proposed

[English](2026-08-24-dsh-tavern-architecture.md) | 中文

## Problem

SillyTavern 是角色卡和 World Info 的重要兼容目标，但它的运行时会把作者设定、模型生成的记忆和聊天历史压缩成一次可变的 Prompt 组装。系统没有每个角色独立的知识视角，没有权威的结构化剧情状态，也没有由事件驱动、可重放的检索决策记录。因此长对话会重复事实、遗忘事实、暴露私密知识，并把大量无关内容重复消耗在每轮输入中。

目标产品需要同时支持单角色直聊，以及 GM 在同一剧情中控制多个角色行动的场景。它必须兼容酒馆资源格式，作为 TypeScript dsh 组合运行在 Docker 中，提供可用的 Web 页面，并且在控制每次模型调用输入的同时，能显示实际发送给模型的完整上下文。所有模型可见内容都必须可以从 dsh Session 日志重建。

## Proposal

构建可选的 dsh Tavern 组合。它复用 dsh 的 Session、Prompt、LLM、压缩、Web 和分支能力，增加酒馆专用的资源、剧情状态、记忆、上下文、编排和连续性插件。Tavern profile 只组合当前交互模式和资源需要的插件，不替换 dsh 核心，也不嵌入 SillyTavern 的 JavaScript 运行时。

已有的[酒馆角色扮演界面提案](../feature/2026-08-24-tavern-roleplay-surface.md)继续负责功能级的 UI 和 swipe 方案；本记录负责它依赖的跨模块架构和知识模型。

### 组合和运行模式

```text
Tavern Web UI and API
        |
Tavern profile and session-scoped composition
        |
+-------+---------+----------+----------+----------+
| assets | state  | memory   | context  | scene    |
| ST    | story  | L0-L3    | compiler | planner  |
| import| state  | views    | retrieval| scheduler|
+-------+---------+----------+----------+----------+
        |
dsh Session log, projections, prompt surface, LLM, Web, storage
```

系统提供三种运行模式：

- `direct`：一个活跃角色处理用户当前回合，使用一次主模型调用。记忆提取和向量索引异步执行。
- `single-scene`：仍然只有一个主要角色，但在场景转换、时间跳跃、重大状态变化或隐藏剧情控制时按需调用规划器。
- `ensemble`：GM 规划器生成结构化场景节拍，只有实际行动的角色才接收独立的角色上下文调用。拥有不同私密知识的角色绝不会使用包含彼此秘密的同一个 Prompt 生成。

默认模式是 `direct`。规划器采用 `on-demand` 策略，不会无条件增加一次模型调用。profile 可以显式启用或关闭每项能力；选择角色卡或 World Info 只选择资源和默认配置，不会隐式授予 shell、web、filesystem、skill 或 subagent 等无关工具。

### 领域模型

系统分开保存五类信息：

- **资源**：作者控制的输入，例如角色卡、Character Book、World Info 条目、preset 或导入的 PNG。
- **正典**：用户或 GM 授权的剧情断言。正典不等于模型自动生成的记忆。
- **剧情状态**：地点、时间、物品、修为境界、健康、关系阶段、当前誓言等结构化当前值。
- **知识视图**：某个观察者可以使用的事实，包括信念、传闻、推断和错误信念。
- **记忆**：基于来源事件构建的 L1、L2 或 L3 投影。记忆不是事实来源，Session 事件日志才是。

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

角色卡是作者定义的初始基线，L3 是剧情发展后角色形成的长期认知。关系状态、物品、地点、健康、修为、时间和其他需要严格保持当前值的字段使用独立投影，因为向量检索不能可靠地强制这些字段的当前状态。

### 剧情事件和模型可见性

Session 事件日志是唯一权威来源。Tavern 增加资源选择、场景指令和计划、公开或私密场景节拍、状态变化、知识获取、记忆候选、上下文决策和连续性决策等声明合并事件类型。影响重建的事件必须在读取时被识别；具体事件名和字段类型由声明它的 package 负责。

每次模型请求都使用 dsh 现有的 request/header 和 request/context 持久化路径。编译后的上下文快照记录实际发送给模型的渲染段落、来源 ID、编译策略版本、观察者、token 预算、选中的候选和被过滤的候选。历史模型请求不能依赖当前检索索引或数据库记录才能重放。

模型生成的记忆首先是带来源事件和权威元数据的候选。用户或 GM 可以提升、修正、失效或固定它。修正通过新事件关闭旧断言的有效期，而不是删除旧信念，因为旧信念可能解释后续的戏剧行为。

分支属于事件模型。Swipe、重新生成和历史编辑都在稳定回合边界创建或替换 Session 分支。L1-L3 和结构化剧情状态都从当前分支投影，废弃分支不会污染活动剧情。

### 上下文编译和检索

上下文编译器为 GM、每个角色和公共旁白生成独立视图，并按以下顺序组装：

```text
stable prefix
  system rules, asset baseline, stable setting, tool schemas
dynamic suffix
  current structured state
  public scene state
  observer L3
  observer L2
  filtered and ranked L1
  recent visible events
  current user input or actor beat
```

检索必须先过滤，再执行语义排序：

```text
observer and visibility filter
  -> validity and branch filter
  -> structured state lookup
  -> keyword or FTS candidate lookup
  -> vector retrieval when needed
  -> rerank and deduplicate
  -> token-budget packing
```

World Info 激活保留酒馆的确定性规则，包括关键词、secondary keys、整词匹配、递归、深度、分组、概率、sticky、cooldown 和插入位置。向量检索可以扩展候选召回，但不能绕过可见性和有效性检查，也不能把候选自动提升为正典。

编译器统一管理稳定资源、公共状态、观察者记忆、最近事件和输出预留的 token 预算。它不会把完整聊天记录或完整 World Info 集合复制到每个请求。稳定前缀的缓存键包含资源版本、观察者 ID、记忆投影版本、编译策略版本和工具 schema 版本。动态检索结果放在稳定前缀之后，以避免破坏可复用前缀。

在 ensemble 模式中，规划器可以读取完整 GM 视图，但每个角色调用只接收自己的节拍和知识视图。可见性相同且没有私密状态的角色可以使用节省成本的快速路径；只要角色上下文不同，就不能使用该路径。默认的成本控制方式是只选择活跃角色、使用紧凑状态投影、异步提取和按需规划，而不是在一个 Prompt 中放入所有角色的隐藏信息。

### SillyTavern 兼容

兼容层支持 Character Card V1/V2 JSON、PNG 内嵌卡片、V2 `character_book` 和独立 World Info JSON 的导入导出。它保留未知字段、原始条目顺序、源文本、关键词、secondary keys、插入位置、深度、递归、分组行为、概率、sticky、cooldown 和可往返导出的扩展数据。

导入器保存原始资源并生成标准化原生资源。原生模型可以使用实体关系图或树，但导入器保留原始扁平 World Info 条目，以便导出时保持兼容。静态资源不会被静默转换成 L3 记忆。

第一版会把任意 SillyTavern JavaScript 扩展、regex 脚本、远程服务钩子和 UI 专属行为保留为不执行的扩展数据。导出仍可保留这些字段，但 dsh 进程不会执行它们。无法满足语义的必需字段在导入时明确失败，未知的非执行元数据继续保留。

### UI、Docker 和可观测性

Web 组合提供聊天、角色卡和 World Info 管理、场景控制、记忆查看、剧情状态查看、分支和 swipe 控制以及 Prompt Inspector。Inspector 显示 GM 或角色观察者、实际渲染段落、token 预算、缓存键、召回候选、带原因的过滤候选、来源事件和连续性警告。它必须明确区分发送给模型的内容和仅供调试的诊断数据。

Docker 镜像构建 TypeScript workspace，并在可配置的容器绑定地址上运行选定 profile。profile 必须显式启用容器绑定，不能依赖只适用于开发环境的 host 覆盖。持久化存储包括 Session 日志、导入资源、投影和索引；向量存储是可选的，可以从来源事件重建。

### 安全和失败行为

角色卡、World Info、记忆和模型输出都是数据，不是系统指令。编译器把它们放入声明的 Prompt 段落，不允许导入文本改变系统策略或授予工具。工具组合由 profile 显式决定。

错误配置和无效持久化数据必须明确失败。运行时降级也必须可观察：向量提供方不可用时回退到结构化和 FTS 检索；没有记忆结果时不能凭空创建记忆；请求超预算时使用配置的优先级裁剪；角色调用失败时按 profile 策略停止场景或生成带 GM 标记的降级旁白。连续性警告必须在自动修复或重试前记录。

### Package 归属

第一版 package 拓扑如下：

```text
packages/tavern/compat        pure ST parsers, serializers, and asset preservation
packages/tavern/assets        asset service and session asset selection
packages/tavern/state         structured story-state definitions and projections
packages/tavern/memory        L0-L3 projections, observer views, and providers
packages/tavern/context       activation, retrieval, budget, and prompt compiler
packages/tavern/orchestration direct, single-scene, and ensemble consumers
packages/tavern/continuity    validators, warnings, and repair policy
packages/bundle/tavern        installable profile and plugin composition
```

纯解析和渲染辅助函数保持为普通 TypeScript 模块。可替换后端的能力使用 Service Definition、Provider 和 Consumer 三个角色。第一版使用本地持久化提供方和 FTS；向量和外部记忆服务是可选能力提供方，不是领域模型的前置条件。

## Alternatives considered

**直接修改 SillyTavern。** 这样可以保留现有 UI，但仍然以可变 Prompt 管线、分裂的 completion 路径和分支语义为核心。它无法充分利用 dsh 的事件日志、Prompt 重建和插件组合能力。

**创建独立的替代服务。** 这会重复实现 dsh 的 Session 持久化、Prompt 组装、Web 流式传输、分支和能力策略。目标是 dsh 组合，而不是第二个 agent runtime。

**使用全局记忆并要求模型遵守角色知识。** 一个包含所有秘密的模型可见 Prompt 不是真正的软隔离。可靠的知识不对称需要独立观察者投影和检索前过滤。

**把向量 RAG 作为剧情数据库。** 相似度检索无法强制当前地点、物品、死亡、修为境界、关系状态、分支有效性或权威等级。结构化投影和来源事件负责这些值，RAG 只负责召回候选文本。

**每次回复都先调用 GM 规划器。** 这会增加单角色恋爱或修仙对话的 token 和延迟，却不能改善一个角色的普通回合。规划器按需调用，ensemble 只在角色知识视图不同且需要行动时支付独立角色调用成本。

**把所有角色指令和私密记忆放入一个 Prompt。** 这减少了请求次数，但会把私密上下文暴露给同一个模型注意力，不能保证角色级知识隔离。只有可见性相同且不存在私密数据的角色才允许使用该快速路径。

## Acceptance criteria

1. dsh Tavern profile 从现有 dsh package 组合，并在显式配置的绑定地址上启动 Docker Web 页面。
2. direct 模式不会无条件调用规划器；scene 和 ensemble 触发器按选择的策略调用规划器。
3. 同一个 Character Card V1/V2 或 World Info 资源往返导入导出时不丢失支持字段和未知元数据。
4. 角色请求不能召回其 observer、visibility、branch、validity 或 authority 排除的记忆。
5. 公开事件只有在记录后才对同一场景的后续角色可见；私密内心和 GM 计划不会进入其他角色视图。
6. canon、belief、rumor、inference 和 false-belief 始终可区分，并在修正和分支投影中保留来源事件。
7. 地点、物品、健康、关系和修为状态使用结构化投影校验，而不是只依赖向量结果推断。
8. Prompt Inspector 可以重放精确的模型可见上下文，并显示 token、检索、缓存和连续性决策。
9. Swipe、重新生成和历史编辑从选定分支投影记忆和剧情状态，不污染下游分支。
10. 可运行的无密钥示例和 snapshot 覆盖单角色对话、恋爱关系变化、修为状态变化、单角色知晓秘密以及 ST 导入导出往返。

## Risks

观察者模型增加了领域复杂度，而且不是安全隔离。产品必须明确 GM、角色、旁白和界面查看者的语义。多个独立角色调用会增加延迟和输出成本，因此活跃角色选择、前缀缓存、紧凑投影和按需规划必须成为默认策略。第一版不会完整兼容酒馆扩展；可执行扩展必须移植为显式 dsh 插件。精确上下文快照会增加 Session 体积，因此压缩和投影存储必须在保留重放能力的同时允许索引重建。自动连续性修复可能改写用户刻意制造的戏剧内容，因此在 profile 显式启用修复之前，默认只警告并重试。
