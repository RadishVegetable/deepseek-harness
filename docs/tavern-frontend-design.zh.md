# Tavern 前端设计

[English](tavern-frontend-design.md) | 中文

本文定义以 GM 驱动互动小说为核心的沉浸式 Tavern 浏览器交互模型。运行时和持久化约定仍由 [`dsh-tavern-host`](../packages/tavern/host/README.md) 负责，共享 conversation 界面仍由 [`ui-conversation`](../packages/client/ui-conversation/README.md) 负责。

## 产品定位

Tavern 呈现的是一个角色和一段持续发展的故事，而不是配置工作台。用户进入后首先看到的是要认识的角色或正在进行的旅程；附属世界书条目为故事提供发展空间，但不会成为主要入口。

模型始终是 GM。GM 是模型承担的叙事职责：它读取世界、角色、世界书、旅程历史和当前状态，然后续写故事。角色卡提供角色信息，不会创建另一个模型、Agent 或回复链路。

每次玩家输入只产生一次模型请求。GM 响应包含完整的 `story` 正文，并且可以携带自然语言 Journey 事实的 `updates`；普通自由文本仍然有效，无法解析封套时会完整显示为 `story`。

GM 控制世界和非玩家角色，但不会悄悄替玩家决定对白、行动、选择或内心感受。剧情段可以呈现后果或邀请玩家行动，同时把下一步决定留给玩家。

## 交付阶段

当前运行时提供完整的角色扮演循环：选择主角色卡、查看其附属世界书、配置 Journey、准备动态源栏目、交换由 GM 创作的剧情段，并在之后恢复 transcript。Journey 事实会在 assistant 响应持久化后追加到 Session 日志，下一次请求会召回活动投影。真正的多 Agent 群聊和按角色调用模型仍不属于这个设计。

后续层只增加能够由具体用户可见问题证明价值的结构。作者编辑资源后的再次整理、块级归属、更丰富的 Scene 摘要、按 observer 隔离的检索、连续性修复和规划都必须保留原始 transcript，并让一次玩家输入保持一次模型生成。

## 术语

- **GM** —— 模型承担的叙事职责。它维持连续性、决定接下来发生什么，并写出所有可见叙事内容。通常不会把 GM 作为 transcript 中的角色渲染出来。
- **角色卡** —— 旅程的作者设定起点。它包含角色的身份、背景、性格、目标、关系、已知信息、能力、边界、说话方式、附属 World Info 或设定、附属世界书以及旅程默认配置。
- **世界** —— 与 SillyTavern 兼容的可复用 World Info/Lorebook 资源。它是一组作者条目和激活元数据，可以附加到多张角色卡或多个旅程；它不拥有角色栏、当前剧情状态或旅程入口。
- **角色** —— 由角色卡和 Journey 专属自然语言事实描述的故事实体；不要求固定的关系、库存、健康或类似字段，角色卡也不会自动进入 `people`。
- **世界书** —— 附属或选中的 World/Lorebook 条目集合，包括内嵌的 V2 `character_book`。激活条件匹配当前旅程时，GM 可以使用这些条目；它不会实例化角色，也不会成为独立的世界运行时。
- **旅程** —— 由一张主角色卡锚定的一次独立故事。它会记录角色卡附属的世界书上下文，然后拥有自己的 transcript、场景、角色、`people[personId]` 和 `world` 事实、剧情状态、记忆、分支和配置覆盖。
- **场景** —— 旅程中的局部情境：当前地点、时间、参与者、即时矛盾和可执行行动。场景变化不会自动创建新旅程。
- **叙事回合** —— 一次玩家输入和一次 GM 生成。
- **剧情段** —— 一个叙事回合中 GM 生成的完整内容，可以包含旁白、环境变化以及多个角色的行动和对白。
- **伪群聊** —— 在一个剧情段中把行动或对白归属于多个角色。它是一次 GM 输出，不是多个 Agent、多次模型调用或发言者选择循环。

这些概念的关系是：

```text
Character Card (required journey anchor)
  +-- character information
  +-- attached World Book / Lorebook entries
  +-- attached Character Book / World Book
  +-- journey defaults
  `-- optional supporting Character Cards
        | snapshots into
Journey
  +-- primary Character
  +-- attached World Book / Lorebook context
  +-- transcript of story segments
  +-- current scene
  +-- Character and World Book source snapshots
  +-- people[personId] and world fact projections
  `-- journey-specific configuration
```

## 角色、附属世界与旅程

角色卡是旅程的社交和叙事起点。它附属的世界书可以包含只服务于亲密对话的小型设定、描述王国的条目，也可以没有更大的设定。旅程会记录所选角色卡及其 Lorebook 条目，不会与其他旅程共享可变的故事状态。

同一个 World/Lorebook 资源可以被多张角色卡复用，以方便作者组织设定。这种复用不代表世界拥有角色：每个旅程仍从一张主角色卡开始，角色栏再由所选角色卡、可选的附属角色卡以及 GM 引入的角色逐步扩展。

这套模型可以覆盖两端体验，而不需要两套运行时：

- **聚焦角色的旅程** —— 秘书、恋人、伙伴、同事或其他主角色可以只携带亲密对话所需的信息。故事需要时，GM 仍然可以引入其他 NPC。
- **大世界旅程** —— 主角色卡可以附属描述王国、学院、末日聚落、修仙设定或其他大型设定的世界书条目。玩家通过角色进入这个设定，并在 GM 续写故事时逐步遇见更多角色。

所有旅程仍使用同一套 GM 叙事循环、角色状态模型和剧情段格式。浏览世界是作者管理和查看资源的行为，不是另一种创建旅程的模式。

## 开启旅程

Tavern 入口围绕一个必选角色、角色附属上下文和一个结果组织：

1. 选择或创建主角色卡。没有要认识或跟随的角色，就不能创建旅程。
2. 查看角色卡附属的世界书或内嵌的 `character_book`。角色卡和 profile 允许时，再添加可选的附属角色卡或世界书。世界书提到的角色不会自动成为已经登场的角色。
3. 设置玩家身份，以及属于本旅程的少量生成和叙事偏好。
4. 创建旅程并进入开场场景。旅程从第一个回合开始拥有自己的 transcript 和状态投影。

世界库仍作为次级 Lorebook 资源视图提供。玩家从那里选择世界时，界面会预览引用该世界的角色卡，并在创建旅程前引导玩家选择一张角色卡；它不会启动没有角色的旅程。

第一条内容可以来自所选角色卡的作者开场白，也可以来自 GM 生成的开场。作者开场白是旅程的初始条件，不是假装模型已经说过的话。导入的源资源保持不可变并可复用；新导入的资源只影响未来选择，活动 Journey 读取自身已经记录的 baseline，并在此基础上投影本 Journey 的本地资产编辑和事实更新。

## 叙事回合

运行时将每次发送都视为续写故事的请求。assistant 响应作为一条普通消息保存，只有在响应持久化后才应用合法的 Journey 事实：

```text
player input
  |
GM context: World Book entries + Characters + Journey + Scene + transcript
  | one model generation
Story segment
  +-- narration and environment
  +-- actions and dialogue for zero or more Characters
  +-- optional updates.people[personId]
  +-- optional updates.world
  `-- a natural point for the player's next action
```

支持的封套是：

```json
{
  "story": "The complete prose continuation.",
  "updates": {
    "people": { "person:medie": [{ "op": "add", "text": "Medie is the player's permanent secretary." }] },
    "world": [{ "op": "add", "text": "The court recognizes the appointment." }]
  }
}
```

Host 为追加操作分配 fact ID，校验人物和事实目标，记录被拒绝的操作，并把活动事实投影到下一次请求。`replace` 和 `remove` 引用已有 `factId`；它们追加审计事件而不抹掉历史。响应指纹保证 reload 或重试同一 assistant 响应时不会重复追加事实。

当后续阶段需要识别对白或已登场角色时，逻辑结果可以携带块级元数据，同时不把一次生成拆成多个调用：

```text
{
  turnId,
  blocks: [
    { kind: "narration", text: "..." },
    { kind: "dialogue", characterId: "secretary", text: "..." },
    { kind: "action", characterId: "guard", text: "..." }
  ],
  stateChanges: []
}
```

`stateChanges` 是后续阶段的候选机制，不是第一阶段的要求。角色归属是呈现和投影元数据，不是独立的模型角色。

transcript 将完整剧情段作为一个叙事结果保存，即使其中包含多个角色的块。重新生成、编辑、继续和分支都作用于叙事回合，因此编辑点之后的故事状态和派生上下文会从选定分支重新构建。

## 事实投影和详情

角色和世界书详情会把已记录的源栏目与活动 Journey 事实放在一起。使用 `label: value` 语法的世界书文本会显示为动态栏目；栏目名称不是固定的产品 schema。GM 事实可以携带任意显示标签，同时保留自然语言正文，因此后续事实可以新增 `Secret` 或 `Player-specific` 等栏目；没有标签的事实归入 `Fact`。当所选世界书条目识别出角色，或 GM 的 `add` 引入格式有效的 `person:<slug>` 时，才会显示世界人物，其 Journey 事实也会一并显示。活动 Journey 可以编辑或撤销已有事实，但面向玩家的界面不提供手动创建事实。

Prompt Inspector 会把最近一次已记录的模型请求与保留的 GM 响应 envelope 配对展示，包括 `story` 和原始 `updates`。剧情事实面板单独列出追加式事实事件，包括被拒绝的操作及其原因，从模型输出、Host 校验到当前 Journey 投影都可以逐步追溯。

## Tavern 界面

入口和活动旅程采用不同的视觉重点：

```text
Tavern entrance: characters | journeys | attached World Books

Journey header: primary Character | World Book | Journey | Scene | connection | Journey actions

Character and World Book panel Story stage and composer      Journey state panel
Character portrait and card    complete Story segments        current Scene
attached World Book preview    one shared input path          Character states
selected Lorebook entries      streaming GM generation        story state and memory
```

剧情区是视觉中心。它在顶部附近显示主角色、由附属世界书上下文和旅程状态推导出的当前场景，以及最近故事上下文，让 transcript 像小说一样易读，并为每个剧情段保留足够间隔，使用户能跟随时间、地点和参与者的变化。主要流程不展示提示词组装、提供方字段或工作区术语。

### 角色栏

角色栏把主角色放在最前面，然后列出可选的已配置角色和已经遇到的角色。它不表示主角色是唯一发言者，也不表示玩家被锁定在一种关系上。任何角色都可以在同一个剧情段中多次出现、离开、行动或发言。

选择角色后打开详情视图，显示它已有的源栏目和 Journey 事实。当源数据或后续带标签的事实提供身份、角色、秘密或玩家专属信息时，栏目可以出现；界面不要求每个角色都拥有相同栏目。已有世界人物使用快照来源名字对应的稳定 ID，最新的 `Name` 事实覆盖显示名，从而不会因重命名产生重复人物。GM 专用计划和其他角色的私密知识不会出现在玩家视图中。

### 世界栏

附属世界书面板为旅程提供持续的空间感，同时不取代角色面板。它概览当前地点、时间、天气或其他相关条件、活动事件以及附属或选中的 Lorebook 条目。世界书条目以源材料和激活状态呈现，而不是一个很长的技术提示词检查器。

世界栏可以打开模型或回退方式整理的世界书条目、世界人物详情和活动世界事实，但不会替换剧情区。玩家返回叙事时，当前场景和 composer 保持不变。整理后的栏目保留源资源和条目标识；没有模型路由或有效模型结果时，当前显示使用确定性的源文本栏目。后续带标签的事实会直接进入对应详情的动态栏目，因此新出现的 `Secret` 或 `Player-specific` 等概念不需要预先加入固定 schema。

## 配置

配置按玩家实际选择的三类内容组织：角色卡、世界书和其他旅程设置。默认视图只展示会立即影响体验的设置；技术采样控制放在高级设置中。

### 角色配置

- 起始角色组中的角色卡及其顺序。
- 必选的主角色卡和可选的附属角色卡。
- 玩家身份或 persona，包括 GM 可以使用的玩家名称和信息。
- 角色卡提供多个开场白时的作者开场白选择。
- 附属世界书或内嵌的 `character_book` 在这里作为所选角色卡的一部分查看，而不是独立的旅程根对象。
- 角色卡携带的角色叙事约束，不在主流程中暴露原始提示词组装。

### 世界书配置

- 角色卡附属的 Character Book 或世界书；角色卡提供时默认启用。
- 为旅程额外启用的世界书。
- 作者允许玩家选择时的世界书分组或单独条目。
- 条目作为作者设定材料可用，还是仅作为 GM 上下文可用。
- 附属世界书和旅程关于地点、时间与开场条件的默认值。

### 其他旅程配置

- 模型提供方、模型以及模型支持的推理强度。
- 以 Temperature 呈现的创意度，由 profile 选择产品默认值。
- 以最大生成剧情段长度呈现的回复长度。
- Streaming 以及本旅程提供的叙事风格或 GM 指令。
- 属于本旅程的分支、重新生成、继续和 transcript 展示偏好。

### 高级与诊断配置

当所选提供方支持时，Top P、Top K、Min P、Top A、频率惩罚、存在惩罚、重复惩罚和 seed 只在高级设置中提供。Stop strings、提示词顺序、上下文大小、世界书扫描深度、递归扫描和世界书 token 预算属于带有提供方或 profile 默认值的运行时控制；主界面不要求玩家管理 token 算术。

Prompt Inspector、精确模型请求、检索决定、来源事件和连续性诊断属于独立的 GM 或开发者视图。它们可用于调试，但不会把玩家的主要体验重新变成工作台。

## 旅程连续性

- 即使两个旅程引用同一张角色卡或 World/Lorebook 资源，每个旅程仍拥有独立的事件历史和状态投影。
- 资源库保持不可变；新导入的资源只影响未来选择。活动 Journey 保留选择事件记录的角色卡和世界书 baseline；自动事实投影只由本 Journey 的接受事件或用户修正事件改变。
- 有实际故事内容后修改主角色卡或附属世界书 baseline，或者修改生成配置，会创建新的旅程分支或新的旅程，而不是悄悄改写原故事。
- 重新生成和历史编辑会使编辑点之后派生的剧情段、状态变化和上下文决定失效。
- 当前角色栏和世界状态都从选定的旅程分支投影而来，不由浏览器维护第二套数据库。

## 归属和边界

`ui-tavern` 负责角色优先的入口、旅程呈现、响应式面板、角色和附属世界书详情视图、动态事实控件以及面向玩家的配置状态。`dsh-tavern-host` 负责资源存储、角色卡及附属上下文解析、旅程选择、事实事件持久化和投影、世界书激活、状态校验、记忆、分支和模型可见上下文投影。`ui-conversation` 负责共享 transcript 传输、草稿持久化、流式输出、取消和 composer 机制。

Tavern surface 不会为每个角色分别创建请求，不会创建第二套 transcript、第二个 composer 或只存在于浏览器中的故事状态。GM 叙事循环未来可以增加可选的规划或连续性处理，但这些是运行时优化，不得改变玩家看到的模型：一次玩家输入推进一个由 GM 创作的剧情段。

## 视觉方向

视觉语言是具有克制酒馆氛围的亲密故事空间，而不是 IDE。首屏使用主角色真实的头像、Lorebook 提供的场景图（如果有）、角色名称、当前场景和最新剧情段，让用户立即知道自己正在和谁经历什么。

- 使用分层的深色中性底色，搭配克制的铜色、红色或青色强调；避免单色仪表盘，也避免用渐变作为主要氛围。
- 保持剧情区开放且以排版为主。框定卡片只用于重复的角色条目、详情视图和模态工具；页面分区保持无框。
- 技术控件放在紧凑的图标操作、抽屉或独立诊断视图中。不要把“打开工作区”、Prompt Inspector 或资源 ID 放在主要导航里。
- 在确实能表达角色或设定时使用肖像和 Lorebook 关联的场景媒体。空白和加载状态也保持相同的视觉身份，不退回通用 DSH 工作台外壳。

## 范围

### 当前运行时

- 角色库和旅程库，World/Lorebook 库作为次级的附属资源视图提供。
- 以角色卡和附属世界书选择为核心的设置流程。
- 玩家身份、少量 Journey 设置、开场白以及可恢复的持久化 transcript。
- 通过共享 conversation 链路，每次玩家输入进行一次模型请求，得到完整 `story` 和可选 `updates`。
- Journey 专属的自然语言人物和世界事实，支持追加式投影、修正、撤销和下一次请求召回。
- 提供动态源栏目和不允许手动创建事实的沉浸式角色、世界书详情及一个 composer。
- 面向产品的生成设置，以及与故事流程分离的高级采样和诊断控件。

### 后续层

- 可选的块级归属、已遇到角色栏、当前 Scene 摘要和更丰富的故事呈现。
- 在具体使用场景证明价值后，再增加作者编辑源资源后的再次整理、更丰富的 Journey 专属作者资源编辑、按 observer 隔离的记忆检索和更完整的 World Info 执行。
- 当 profile 明确启用额外成本时提供可选的连续性修复和长篇规划。
- 图片生成、TTS、RAG 和生态扩展作为独立能力提供。

## 验收信号

1. Tavern 首个页面打开角色和可恢复的旅程，并且主要流程中没有 DSH“打开工作区”操作。
2. 创建旅程必须先选择主角色卡，并将其附属世界书/Lorebook 条目、可选附属角色卡和其他旅程配置呈现为清晰可辨的分组。
3. 只浏览世界时，界面会引导用户选择角色卡，不能创建没有角色的旅程。
4. 玩家输入触发一次 GM 模型生成和一个剧情段，该剧情段可以包含旁白以及多个角色的行动和对白。
5. 结构化 GM 响应可以追加自然语言人物或世界事实，下一次请求包含带来源事件信息的活动投影。
6. transcript 不要求存在当前发言者，GM 也不会悄悄选择玩家的行动、对白或内心感受。
7. 引用同一张角色卡及其附属 World/Lorebook 资源的多个旅程保留独立的 transcript、场景、角色事实、记忆和分支。
8. 活动旅程明确呈现主角色、附属世界书/Lorebook 上下文、当前场景、角色栏和玩家可见的角色详情，同时不替换剧情区；所选源栏目经过模型或回退方式整理并保留来源标识。
9. 高级采样控制和 Prompt Inspector 仍可访问，但不会支配 Tavern 的主要体验。
10. 空白、加载、错误、流式输出、重新生成、分支、窄屏和详情视图状态都可用，文本和控件不重叠。
