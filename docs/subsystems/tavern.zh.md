# Tavern

Tavern profile 将浏览器工作台挂载为全屏 root surface。它在共享 conversation slot 中保留持久化 transcript 和 composer，并通过共享 sessions 服务打开 Tavern 会话。

[English](tavern.md) | 中文

Tavern 子系统负责角色扮演资源链路：角色卡和 World Info 规范化、Host 侧持久化、按会话选择，以及所选 persona 和上下文投影。兼容解析器属于 [`dsh-tavern-compat`](../../packages/tavern/compat)，可序列化记录和 baseline 投影属于 [`dsh-tavern-assets`](../../packages/tavern/assets)，纯匹配编译器属于 [`dsh-tavern-context`](../../packages/tavern/context)，Host facade 属于 [`dsh-tavern-host`](../../packages/tavern/host)。

浏览器工作台通过 Host Remote 导入、编辑和导出 JSON 以及未压缩的角色卡 PNG 元数据。它不拥有会话状态，也不保留图片字节。`selectForSession` 会在运行时改变后续模型请求前，将完整的规范化 baseline 追加到目标 Session。空会话中的非空角色卡 `firstMessage` 会作为只记录日志的 `tavern/greeting` 事件写入一次，并投影到共享 Chat。工作台还提供按会话的 Memory、规范的位置和时间 Story State、持久化 assistant Swipe 候选以及最近请求 Prompt Inspector。运行时从所选角色卡生成 persona，并把匹配的 World Info 作为带来源的动态上下文激活。

World Info 使用所选资源中最小的 `scanDepth` 作为最近消息窗口，并使用最小的 `tokenBudget` 作为确定性的 first-fit 预算。中间概率使用由会话、来源和查询文本派生的稳定 roll；共享同一 group 的条目按确定性排序竞争。depth、sticky 和 cooldown 元数据会保留在激活候选上；持久化计时器和递归扫描仍待实现。

## World Info 执行

SillyTavern 的 `checkWorldInfo` 会构造按反向 depth 排列的扫描缓冲区，追加显式开启的 persona、角色描述、scenario 和 creator notes 等全局来源，然后分轮评估条目。每轮依次处理禁用/触发器/角色过滤、计时效果、constant 或关键词激活、inclusion group、概率和 token budget；成功条目可以把内容加入递归缓冲区并触发下一轮。最终结果会拆分到角色前后、历史前后、Author's Note、示例消息、depth 和 outlet 等位置。参见 [release 实现](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b/public/scripts/world-info.js#L4597-L5162)。

这种执行模型有几个可靠性成本。激活逻辑分散在可变的 chat metadata、扩展监听器、随机的概率/分组抽签、递归轮次和依赖提示词模板的位置注入中。返回值是若干字符串而不是完整的决策账本，因此要复现某条目为什么被排除，必须重新构造隐藏的扫描状态和计时元数据。Sticky 和 cooldown 也附着在 chat metadata，而不是明确的消息或分支事件上，编辑、重载和分支切换后的行为不容易推理。

dsh 实现有意保留带来源的 ledger 和确定性 roll，但当前 runtime 还没有等价覆盖这套执行模型。`character_book` 已解析，却不会在选择 Character Card 时注册或并入运行时。条目的 `position`、`depth`、`recursive`、`sticky` 和 `cooldown` 字段会保留，但不会影响激活或注入；选择性匹配只支持“primary 加任意 secondary”，不支持 SillyTavern 的 `NOT_ALL`、`NOT_ANY` 和 `AND_ALL` 逻辑。当前 compiler 还把 Memory、Story State 和 World Info 共用一个预算，并使用粗略的按字符估算 token。

已验证一个运行时缺陷：`packages/tavern/host/src/runtime.ts` 提供了确定性的 `probabilityRoll`，但 `packages/tavern/context/src/context-compiler.ts` 调用 `matchWorldInfo` 时没有传入它。因此启用了概率且概率严格处于 0 到 100 之间的条目，会抛出 `World Info entry ... requires a probability roll`，而不是完成评估。当前 runtime query 还会扫描包含此前 runtime-context 快照的派生消息，旧的注入 World Info 可能因此再次触发后续条目；扫描器应只使用规范的可见消息窗口，并排除 compiler 快照。

后端下一步应按以下顺序推进：先传递 probability callback 并增加 assembled 回归测试；再以明确来源把内嵌 Character Book 合并到选中的 baseline；随后将 position/depth 注入建模为结构化输出，而不是一条替换消息；补齐选择性逻辑和分组语义；实现有界递归扫描；最后把 sticky/cooldown 状态事件化，并在 Prompt Inspector 展示每条过滤、命中、分组、预算和位置决策。启用 ensemble 生成前，还需要给 World Info 条目增加明确的 observer/visibility policy。可执行的 SillyTavern 扩展仍只作为不执行的数据保留，不能在 dsh 进程内运行。

## 模型体验

### 模型看到的内容

会话选择事件之后，所选角色卡字段会渲染到 persona 段落。空会话还会在 Chat 中显示持久化的角色卡开场白，并在 persona 投影中包含一次。与当前会话文本匹配的 World Info 条目会渲染为动态 Tavern 上下文。没有选择事件时，运行时保留默认角色扮演 persona，不注入导入资源内容。

### Token 影响

导入资源和检查选择不消耗实时请求 token。所选 persona 和激活的 World Info 会消耗后续请求的 prompt token。

### KV Cache 影响

改变所选角色卡或激活的 World Info 会改变后续 system prompt，因此也会改变其 cache key。

## 持久化状态

导入的源 JSON 通过 `storageDomain` 存储，并在 Host service 启动时恢复。会话选择、开场白、Memory upsert、Story State 变更、Swipe 候选记录和上下文激活 fingerprint 都是追加式 Session 事件，因此模型可见的选择可以从日志重建。开场白是只记录日志的事件，而不是 `assistant/message`，因为 assistant 消息只表示模型输出。

## 已知限制与后续工作

- 浏览器页面是现有 conversation shell 内的 Tavern 角色扮演工作台。它通过 `conversationChatView` service 复用持久化 transcript、ChatView 和 composer，不创建第二套运行时或发送路径。
- PNG 导入只支持未压缩的 `chara` 元数据；不处理可执行的 SillyTavern 扩展和压缩 PNG 元数据。
- 当前 UI 提供 Memory upsert、规范的位置和时间 Story State、持久化候选的 Swipe 选择、在子 Session 中重新生成以及最近请求 Prompt Inspector；按 observer 隔离的 L0-L3 检索、通用 fork、群聊、场景规划和 RAG 仍待实现。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxtavernassets--tavernassetservice"></a>

### `ctx.tavernAssets` — `TavernAssetService`

Host Cordis service exposing Tavern asset operations through Typert Remote.

```ts cordis-catalog
/**
 * List all imported Character Cards.
 * @returns Detached Character Card snapshots.
 */
@Remote('listCharacters') remoteListCharacters(): readonly CharacterAsset[]

/**
 * List all imported World Info assets.
 * @returns Detached World Info snapshots.
 */
@Remote('listWorldInfo') remoteListWorldInfo(): readonly WorldInfoAsset[]

/**
 * Import one Character Card JSON document and return its detached asset.
 * @param input - Character Card JSON text.
 * @param options - Optional stable ID and source metadata.
 * @returns The persisted detached Character Card asset.
 */
@Remote('importCharacter') async remoteImportCharacter(input: string, options?: TavernImportOptions): Promise<CharacterAsset>

/**
 * Import one standalone World Info JSON document and return its detached asset.
 * @param input - World Info JSON text.
 * @param options - Optional stable ID and source metadata.
 * @returns The persisted detached World Info asset.
 */
@Remote('importWorldInfo') async remoteImportWorldInfo(input: string, options?: TavernImportOptions): Promise<WorldInfoAsset>

/**
 * Replace one persisted Character Card under its existing ID.
 * @param input - Character Card JSON text.
 * @param options - Existing asset ID and optional source metadata.
 * @returns The persisted replacement asset.
 */
@Remote('updateCharacter') async remoteUpdateCharacter(input: string, options: TavernUpdateOptions): Promise<CharacterAsset>

/**
 * Replace one persisted World Info asset under its existing ID.
 * @param input - World Info JSON text.
 * @param options - Existing asset ID and optional source metadata.
 * @returns The persisted replacement asset.
 */
@Remote('updateWorldInfo') async remoteUpdateWorldInfo(input: string, options: TavernUpdateOptions): Promise<WorldInfoAsset>

/**
 * Export one persisted Character Card as JSON.
 * @param id - Character asset ID.
 * @returns A compact JSON Character Card document.
 */
@Remote('exportCharacter') remoteExportCharacter(id: import('@deepseek-ai/dsh-tavern-assets/types').AssetId): string

/**
 * Export one persisted World Info asset as JSON.
 * @param id - World Info asset ID.
 * @returns A compact JSON World Info document.
 */
@Remote('exportWorldInfo') remoteExportWorldInfo(id: import('@deepseek-ai/dsh-tavern-assets/types').AssetId): string

/**
 * Resolve selected assets into a source-tracked prompt baseline.
 * @param selection - Asset IDs requested by the caller.
 * @returns The selected prompt baseline.
 */
@Remote('select') remoteSelect(selection: AssetSelection): PromptAssetBaseline

/**
 * Select assets for a live session and append the complete baseline to its log.
 * @param agent - Session owner receiving the selection event.
 * @param selection - Asset IDs requested for the session.
 * @returns The detached durable session selection.
 */
@Remote('selectForSession') remoteSelectForSession(agent: Agent, selection: AssetSelection): TavernSessionSelection

/**
 * Read the latest durable asset selection for a live session.
 * @param agent - Session owner whose log is inspected.
 * @returns The latest selection, or null when none is recorded.
 */
@Remote('inspectSession') remoteInspectSession(agent: Agent): TavernSessionSelection | null

/**
 * Replace one direct user message and invalidate its stale continuation.
 * @param agent - Session owner receiving the edit transaction.
 * @param input - Target event sequence and replacement text.
 * @returns The accepted target sequence.
 */
@Remote('editMessage') remoteEditMessage(agent: Agent, input: TavernMessageEditInput): TavernMessageEditResult

/**
 * Inspect selected assets and their source-tracked prompt baseline.
 * @param selection - Asset IDs to inspect.
 * @returns Detached assets and the exact baseline produced by the registry.
 */
@Remote('inspectSelection') remoteInspectSelection(selection: AssetSelection): TavernSelectionInspection

/**
 * List enabled durable memory entries for a session.
 * @param agent - Session owner whose log is inspected.
 * @returns Detached enabled Memory entries in log order.
 */
@Remote('listMemory') remoteListMemory(agent: Agent): readonly import('./types.ts').TavernMemoryEntry[]

/**
 * Append or replace one durable memory entry for a session.
 * @param agent - Session owner receiving the Memory event.
 * @param input - Memory text and optional stable fields.
 * @returns The detached Memory entry written to the Session log.
 */
@Remote('remember') remoteRemember(agent: Agent, input: import('./types.ts').TavernMemoryInput): import('./types.ts').TavernMemoryEntry

/**
 * Read canonical story state and its source records for inspection.
 * @param agent - Session owner whose log is inspected.
 * @returns The projected Story State and source records.
 */
@Remote('inspectStoryState') remoteInspectStoryState(agent: Agent): import('./types.ts').TavernStoryStateInspection

/**
 * Read retained assistant candidates for the current session lineage.
 * @param agent - Session owner whose log is inspected.
 * @returns Candidate groups and projection diagnostics.
 */
@Remote('inspectSwipe') remoteInspectSwipe(agent: Agent): import('./types.ts').TavernSwipeInspection

/**
 * Append a user-authorized current-candidate selection.
 * @param agent - Session owner receiving the selection event.
 * @param input - Candidate group and candidate IDs to select.
 * @returns Candidate groups after the selection is projected.
 */
@Remote('selectSwipe') remoteSelectSwipe(agent: Agent, input: import('./types.ts').TavernSwipeSelectionInput): import('./types.ts').TavernSwipeInspection

/**
 * Fork before one completed turn, retain its selected assistant candidate,
 * and run the original user message on the child for a fresh response.
 * The returned child has completed its first turn and passed a persistence
 * barrier, so callers can inspect or reload it immediately.
 * @param agent - Source session owner.
 * @param input - Candidate group and candidate to retain in the child.
 * @returns The child session created for regeneration.
 */
@Remote('regenerate') async remoteRegenerate(agent: Agent, input: TavernRegenerateInput): Promise<TavernRegenerateResult>

/**
 * Append one user-authorized canonical story-state change.
 * @param agent - Session owner receiving the Story State event.
 * @param change - Canonical location or time change to append.
 * @returns Story State after the change is projected.
 */
@Remote('setStoryState') remoteSetStoryState(agent: Agent, change: StoryStateChange): import('./types.ts').TavernStoryStateInspection
```

Types: [Agent](core.md)

Source: [`packages/tavern/host/src/index.ts:320`](../../packages/tavern/host/src/index.ts)
<!-- END GENERATED cordis-surface -->
