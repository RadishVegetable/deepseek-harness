# Agent Note: 带来源上下文的 Tavern 角色扮演界面

Status: proposed

[English](2026-08-24-tavern-roleplay-surface.md) | 中文

## 问题

SillyTavern 是角色扮演界面的参考实现，但它的上下文管理在结构上不可靠：聊天只有一个线性数组，使用本地估算的 token 截断，World Info 通过最近消息的字符串匹配激活，并注入同一个字符串。设定文本、世界信息和聊天历史分别计算 token，彼此不协商；同一事实可能在多个位置重复；摘要和被摘要的原文同时存在；切换历史消息的 swipe 不会使下游回复失效。长对话因此会稀释设定并产生幻觉。我们需要在 DeepSeek Harness 上提供酒馆级角色扮演界面，修复这些机制，而不是只重新制作外观，并利用插件组合运行一条带有明确小工具集的 GM 叙事循环。

## 提案

构建 `tavern` 能力族和 `tavern` profile。角色扮演是 Session 的一种一等形态，模型可见输入从 Session 日志重建，而不是从一个渲染字符串重建。该工作包含四项产品能力：

1. **角色卡作为旅程锚点。** 角色卡是一个目录，也可以由 JSON/PNG 导入，并提供主角色信息、开场消息、内嵌的 `character_book`、附属 World Info 引用和旅程默认配置。角色卡字段映射到带明确职责的 GM Prompt 段落，不静默丢弃 ST 的 `creator_notes`、Text-Completion 的 `system_prompt` 和 `wiBefore` 插槽。角色卡提供故事数据，不创建角色 Agent 或独立回复链路。
2. **带来源的世界书上下文注入。** 内嵌和附属的 World Info/Lorebook 条目以及旅程记忆由权威匹配管线激活，作为带来源的运行时上下文快照注入，并以 `tavern/context-activation` 持久化事件追加到 Session 日志。SillyTavern 的 `World` 保持为可复用的 Lorebook 条目集合，不是拥有角色阵容的世界实体。模型看到的是结构化的“设定 / 世界 / 记忆 / 历史”层级，每个注入事实都有日志来源，满足模型可见内容必须可记录和重建的要求。
3. **一次 GM 剧情段和分支。** 一次玩家输入产生一次 GM 生成和一个剧情段。剧情段可以包含旁白以及多个角色的行动或对白，并可携带用于呈现和状态投影的块级归属。Swipe 和重新生成创建分支或替换叙事回合，使下游派生历史失效；transcript 不需要为每个角色分别调用模型。
4. **小工具集。** Tavern preset 只挂载完整的 `dsh-persona`、酒馆 World Info/记忆行和 `ask_user_question`；bash、fs、web、skill、plan、subagent 的 schema 不会进入模型上下文。角色扮演 Prompt 保持小且适合缓存。

交付栈是新的 `@deepseek-ai/dsh-tavern` bundle，叠加在 `dsh-base` 和 `dsh-web-app` 上，并提供 `tavern` profile；`ui-tavern` 客户端插件向现有 Web GUI 增加聊天页、角色编辑器、World Info 编辑器和 swipe 选择器。

## 上下文管线

Tavern Session 的一次 GM 模型请求按以下顺序从 Session 日志组装，取代 ST 的单一拼接字符串：

```text
session log (append-only, the only fact source)
  ├─ system prompt: harness identity + GM narrative rules + primary Character Card
  ├─ sourced runtime-context snapshots (sourced tiers, newest-first):
  │    ├─ attached World Book and setting entries
  │    ├─ World Info activations (tavern/context-activation events)
  │    └─ Journey memory entries (tavern/memory events)
  └─ derived history: deriveMessages() over the log, compaction-folded
```

修复 ST 缺陷的约束如下：

- **日志是权威来源。** 聊天、注入和记忆都是 `SessionEvent`，模型请求是纯投影。Text 和 Chat Completion 的双 API 分歧不会重新出现，因为它们使用同一条投影路径。
- **注入带来源并持久化。** 每次上下文激活都记录触发消息序号和激活条目；触发消息被 compaction 截断后，激活也会随之失效，不会留下孤立注入。
- **压缩折叠而不是重叠。** `compaction` 能力将被折叠范围替换成 `compaction/summary` 和替代用户消息，原消息离开派生历史。摘要和原文不会同时出现在上下文中。
- **编辑使下游失效。** Swipe、分支或编辑注入上游消息时，变更点之后的派生节点被移除，模型不会看到基于另一条分支生成的回复。

## Package layout

新增 `packages/tavern/` 组，包名使用 `@deepseek-ai/dsh-tavern-*`：

| Package | Role | Key interface |
|---|---|---|
| `tavern/character` | Service Definition + provider + card parser | `ctx.characters` — `parse(input): CharacterCard` (JSON + PNG), `expand(card): GM context source` |
| `tavern/world-info` | Service Definition + provider + activation pipeline | `ctx.worldInfo` — `activate(session, buffer): Activation[]`; resolves embedded and attached Lorebooks, injects activations, appends `tavern/context-activation` |
| `tavern/memory` | Memory seam + provider + retrieval | `ctx.tavernMemory` — `remember(session, entry)`, `query(session, scope): entries`; appends `tavern/memory` events |
| `tavern/swipe` | Swipe/fork Consumer + invalidation | `ctx.tavernSwipes` — `swipe(session, at): Session`, `regenerate(session, at): void` (surface replace) |
| `tavern/narrative` | GM narrative-loop Consumer | one GM generation per player input; Story segment blocks identify Character attribution without Character calls |
| `client/ui-tavern` | Browser plugins | chat page, character/world/memory editors, swipe picker via `ctx.slots.register` |

能力规则是：`character` 和 `world-info` 目前各有一个提供方，但卡片格式和检索策略在不同酒馆生态中已经不同，因此 Service Definition / Provider 的拆分是有现实依据的。单一适配器只是当前实现，不是能力边界。

## Session events

以下事件通过声明合并加入 `SessionEventMap`：

```ts
interface SessionEventMap {
  'tavern/character-selected': { characterId: string; cardVersion: number }   // ignorable: false
  'tavern/context-activation': { entryId: string; triggerSeq: number; tier: 'world' | 'memory' } // ignorable: false
  'tavern/memory': { entryId: string; text: string; scope: string }           // ignorable: false
  'tavern/swipe-forked': { sourceSeq: number; childSessionId: string }        // ignorable: false
}
```

四类事件都属于读取时必需的事件。不了解它们的读取器必须拒绝读取日志，因为它们都会改变模型可见内容。结构性格式变化仍然由 `SESSION_FORMAT_VERSION` 0 管理。

## Alternatives considered

### Why not extend SillyTavern?

ST 的上下文管线本身就是缺陷所在。直接扩展意味着重写 `script.js` 的生成路径和 `world-info.js` 的匹配逻辑，并重新验证两套 API。dsh 已经提供 Session 日志、`deriveMessages`、compaction、分支血缘和插件组合，因此应在 dsh 上挂载角色扮演能力。

### Why not a standalone tavern frontend on the dsh SDK?

独立 SPA 会重新实现 Session、持久化和流式 UI，并使产品出现两套界面。`ui-tavern` 客户端插件可以复用现有 Web GUI 的会话持久化、对话渲染和 slot 系统。

### Why not character-as-config in the profile?

按 Session 选择角色卡不能使用 profile 级 patch，因为 profile 是进程级配置树，而角色选择属于旅程。角色卡选择应记录其附属 baseline 的持久化事件，让 GM 请求继承回放保证，而不创建角色 Agent。

### Why not reuse the generic `compaction` command as-is?

通用 compaction-basic 的阈值和尾部保留策略面向 coding Session。Tavern 需要保留首次问候、保护固定记忆，并优先折叠设定信息密集的历史。它应消费 compaction 能力，并注册 Tavern 专用 Provider，而不是复制 core 的实现。

### Why not per-Character group chat?

独立的角色调用会重复发送相同的 World Book、旅程和场景上下文，增加发言者调度，并把 token 消耗在协调上。一次 GM 生成可以在一个剧情段中标注多个角色块，同时保持因果顺序；因此第一版只提供伪群聊呈现。

## Acceptance criteria

1. `dsh --profile tavern` 使用 `dsh-base`、`dsh-web-app` 和 Tavern bundle 启动，模型只收到 `ask_user_question` 等明确允许的工具 schema。
2. Character Card JSON 或 PNG 可以作为旅程锚点导入，保留附属 Lorebook 引用，并生成包含角色作者设定信息的一次 GM 上下文。
3. 关键词为 `armor` 的 World Info 条目只在窗口内消息包含整词时激活，并追加 `tavern/context-activation` 事件；不匹配时不激活。
4. `swipe()` 在消息 N 处分叉，子 Session 共享 N 之前的事件；重新生成消息 N 后，后续派生消息不会进入下一次请求。
5. 编辑被摘要折叠范围中的消息时，该摘要从派生历史中失效。
6. Web GUI 提供角色优先的旅程流程、Tavern 聊天页、角色卡编辑器、World Info 编辑器和 swipe 选择器，并能通过无密钥 snapshot 重放包含多角色剧情段的 Tavern Session。
7. Dockerfile 构建 workspace，并在 `0.0.0.0:3080` 提供 profile；CLI 的 `--host 0.0.0.0` 拒绝规则仍由 profile 显式处理。

## Risks

- **旅程的主角色卡固定。** 已经产生内容的旅程不能静默替换入口角色或附属 Lorebook baseline；改变关系锚点必须创建新的旅程或分支，以保持 GM 上下文可重建。
- **角色卡生态差异很大。** 第一版只承诺 Character Card V2 风格 JSON 和 PNG tEXt 数据，其他格式在导入时明确失败。
- **上下文预算仲裁是策略而不是机制。** 注入管线需要在 World Info、记忆和历史之间使用 Tavern 专用预算；首个提供方可以使用固定优先级，复杂策略后续再增加。
- **方案选择 Session 分支而不是原地 swipe 数组。** 每次 swipe 都增加一个 Session 和子日志，重度使用时的存储量和 UI 密度需要实际工作流验证。
