# Tavern

Tavern profile 将浏览器角色扮演界面挂载为全屏 root surface。它在共享 conversation slot 中保留持久化 transcript 和 composer，并通过共享 sessions 服务打开 Tavern 会话。

[English](tavern.md) | 中文

Tavern 子系统负责角色扮演资源链路：角色卡和 World Info 规范化、Host 侧持久化、按会话选择、Journey 专属事实投影，以及所选 persona 和上下文投影。兼容解析器属于 [`dsh-tavern-compat`](../../packages/tavern/compat)，可序列化记录和 baseline 投影属于 [`dsh-tavern-assets`](../../packages/tavern/assets)，纯匹配编译器属于 [`dsh-tavern-context`](../../packages/tavern/context)，Host facade 属于 [`dsh-tavern-host`](../../packages/tavern/host)。

浏览器角色扮演界面通过 Host Remote 导入和导出 JSON 以及未压缩的角色卡 PNG 元数据，并支持编辑脱离的 Journey 副本。它以角色优先的入口开始，资源和诊断工具位于次级入口；它不拥有会话状态，也不保留图片字节。`selectForSession` 会在运行时改变后续模型请求前，将完整的规范化 baseline 追加到目标 Session；即使资源库之后发生变化，运行时仍使用这份已记录的 baseline。空会话中的非空角色卡 `firstMessage` 会作为只记录日志的 `tavern/greeting` 事件写入一次，并投影到共享 Chat。次级工具检查 Journey 事实、修改或撤销已有事实、选择持久化 assistant Swipe 候选以及查看最近请求 Prompt Inspector。运行时从所选角色卡生成 persona，并把匹配的 World Info 作为带来源的动态上下文激活。

## Journey 事实

GM 协议保证每次玩家输入只产生一次模型生成。完成的响应包含 `story`，并且可以包含 `updates`；Host 接受 JSON 对象、fenced JSON 或自由文本，解析失败时将完整响应作为 `story`。assistant 消息会在应用更新前持久化，因此被拒绝的更新不会丢失玩家可见的剧情。

`updates.people[personId]` 和 `updates.world` 包含自然语言的 `add`、`replace` 和 `remove` 操作。Host 为追加分配稳定 ID，校验人物 ID 和事实集合归属，并将每个接受或拒绝的操作以 `tavern/fact` 写入，同时记录 assistant 事件序号和回合。响应指纹使 reload 和重试保持幂等。`resolveTavernFacts` 回放已接受事件生成 `people[personId]` 和 `world`；替换与撤销事件保留审计记录，子 Session 只投影其 seed 前缀。主角色卡在剧情明确识别人物前仍只是 Journey 锚点，不会自动成为人物。

## Journey 记忆

`@deepseek-ai/dsh-tavern-memory` 围绕同一个追加式 `tavern/fact` 来源提供纯记忆 seam。严格提取解析、区间幂等、按 Session 串行的提取调度、结构键归一、新鲜度优先折叠、分支可见性、带来源的资产清洗、只包含关系的压缩解析、有界注入渲染以及可丢弃的词法/余弦索引都作为派生辅助能力实现。玩家和显式观察不能被后续推断观察静默压制，被替换或冲突的源记录仍可审计。

Host 投影使用同一套 subject-key 和新鲜度规则，现有 UI 可以读取活动投影。组合 `ctx.jobs` 时，Host 会按 Session 排队 turn-end 提取、记录完整的辅助 prompt/output 并追加采纳的事实；组合 `ctx.tools` 时，会提供只读的 `fact_search` 工具。当前线上 GM 路径为兼容性保留 `story` 加 `updates`。SQLite 派生存储、真实 embedding 调用、Tavern 专用压缩引擎以及完整记忆面板仍是后续工作，详见 [Tavern Journey memory Agent Note](../../.agents/notes/implemented/architecture/2026-09-03-tavern-journey-memory-capability.md)。

UI 将整理后的源栏目和 Journey 事实一起展示在世界书和世界人物详情中。选择或 reload 后，`normalizeForSession` 会在模型路由可用时使用所选模型，校验来源引用，并将动态栏目记录到 `tavern/assets-normalized`；确定性的源文本栏目仍作为回退。源资源保持不可变并可复用；Journey 本地资源编辑只由该 Journey 保留，活动 baseline 与资源库相互脱离。事实控件可以修改或撤销已有事实，但不会手动创建事实。

World Info 使用所选资源中最小的 `scanDepth` 作为最近消息窗口，并使用最小的 `tokenBudget` 作为确定性的 first-fit 预算。中间概率使用由会话、来源和查询文本派生的稳定 roll；共享同一 group 的条目按确定性排序竞争。depth、sticky 和 cooldown 元数据会保留在激活候选上；持久化计时器和递归扫描仍待实现。

## World Info 执行

SillyTavern 的 `checkWorldInfo` 会构造按反向 depth 排列的扫描缓冲区，追加显式开启的 persona、角色描述、scenario 和 creator notes 等全局来源，然后分轮评估条目。每轮依次处理禁用/触发器/角色过滤、计时效果、constant 或关键词激活、inclusion group、概率和 token budget；成功条目可以把内容加入递归缓冲区并触发下一轮。最终结果会拆分到角色前后、历史前后、Author's Note、示例消息、depth 和 outlet 等位置。参见 [release 实现](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b/public/scripts/world-info.js#L4597-L5162)。

这种执行模型有几个可靠性成本。激活逻辑分散在可变的 chat metadata、扩展监听器、随机的概率/分组抽签、递归轮次和依赖提示词模板的位置注入中。返回值是若干字符串而不是完整的决策账本，因此要复现某条目为什么被排除，必须重新构造隐藏的扫描状态和计时元数据。Sticky 和 cooldown 也附着在 chat metadata，而不是明确的消息或分支事件上，编辑、重载和分支切换后的行为不容易推理。

dsh 实现保留带来源的 ledger 和确定性 roll。内嵌的 `character_book` 会被标准化为角色卡附属的 World Info 资产，加入选中的 prompt baseline，并排除在独立 World Info 库之外。条目的 `position`、`depth`、`recursive`、`sticky` 和 `cooldown` 字段会保留，但当前还不会改变激活或注入；选择性匹配只支持“primary 加任意 secondary”，不支持 SillyTavern 的 `NOT_ALL`、`NOT_ANY` 和 `AND_ALL` 逻辑。当前 compiler 还把 Memory、Story State 和 World Info 共用一个预算，并使用粗略的按字符估算 token。

runtime 会向 context compiler 提供稳定的 `probabilityRoll`，因此启用概率且概率严格处于 0 到 100 之间的条目，会根据会话、来源和查询确定性评估，而不会因缺少 roll 失败。query 使用会话中的可见消息和待处理输入；在追加当前激活结果前，请求消息中的 runtime context 快照会被移除，因此旧的投影不会重新成为对话轮次。

后端剩余工作是将 position/depth 注入建模为结构化输出，而不是一条替换消息；补齐选择性逻辑和分组语义；实现有界递归扫描；将 sticky/cooldown 状态事件化；并在 Prompt Inspector 展示每条过滤、命中、分组、预算和位置决策。如果未来增加多观察者或多 Agent 模式，必须先给 World Info 条目增加明确的 observer/visibility policy。当前伪群聊仍然是一轮 GM 生成和一个剧情段。可执行的 SillyTavern 扩展仍只作为不执行的数据保留，不能在 dsh 进程内运行。

## 模型体验

### 模型看到的内容

会话选择事件之后，所选角色卡字段会渲染到 persona 段落。空会话还会在 Chat 中显示持久化的角色卡开场白，并在 persona 投影中包含一次。与当前会话文本匹配的 World Info 条目会渲染为动态 Tavern 上下文。没有选择事件时，运行时保留默认角色扮演 persona，不注入导入资源内容。

### Token 影响

导入资源和检查选择不消耗实时请求 token。所选 persona 和激活的 World Info 会消耗后续请求的 prompt token。

### KV Cache 影响

改变所选角色卡或激活的 World Info 会改变后续 system prompt，因此也会改变其 cache key。

## 持久化状态

导入的源 JSON 通过 `storageDomain` 存储，并在 Host service 启动时恢复。会话选择、开场白、`tavern/assets-normalized`、`tavern/gm-response`、`tavern/fact` 操作、Memory upsert、Story State 变更、Swipe 候选记录和上下文激活 fingerprint 都是追加式 Session 事件，因此模型可见的选择、整理后的显示栏目、GM 更新和活动 Journey 事实可以从日志重建。开场白是只记录日志的事件，而不是 `assistant/message`，因为 assistant 消息只表示模型输出。自动事实事件保留被拒绝的操作用于审计，并将接受的操作关联到来源 assistant 响应。

## 已知限制与后续工作

- 浏览器页面是现有 conversation shell 内的 Tavern 角色扮演界面。它通过 `conversationChatView` service 复用持久化 transcript、ChatView 和 composer，不创建第二套运行时或发送路径。
- PNG 导入只支持未压缩的 `chara` 元数据；不处理可执行的 SillyTavern 扩展和压缩 PNG 元数据。
- 当前 UI 提供 Journey 事实查看和修正、持久化候选的 Swipe 选择、在子 Session 中重新生成以及最近请求 Prompt Inspector。旧版 Memory 和 Story State Remote 仍作为独立兼容接口保留，但主 Journey UI 不提供手动创建它们的控件。Journey 本地资源编辑后的再次整理、按 observer 隔离的 L0-L3 检索、通用 fork、真正的多 Agent 群聊、场景规划和 RAG 仍待实现。伪群聊呈现属于当前的一次 GM 剧情段模型。

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
 * Replace one Character Card in the durable source registry.
 * @param input - Character Card JSON text.
 * @param options - Existing asset ID and optional source metadata.
 * @returns The persisted replacement asset.
 */
@Remote('updateCharacter') async remoteUpdateCharacter(input: string, options: TavernUpdateOptions): Promise<CharacterAsset>

/**
 * Replace one World Book in the durable source registry.
 * @param input - World Info JSON text.
 * @param options - Existing asset ID and optional source metadata.
 * @returns The persisted replacement asset.
 */
@Remote('updateWorldInfo') async remoteUpdateWorldInfo(input: string, options: TavernUpdateOptions): Promise<WorldInfoAsset>

/**
 * Delete one source asset from the durable registry.
 * @param id - Asset identifier to delete.
 * @returns `true` when the durable record was removed.
 * @remarks Existing Journey selections keep their IDs and resolve against the current source registry. Re-import the
 * same ID to restore a Journey that references a deleted asset.
 */
@Remote('deleteAsset') async remoteDeleteAsset(id: import('@deepseek-ai/dsh-tavern-assets/types').AssetId): Promise<boolean>

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
 * Select assets for a live session and append only their references to its log.
 * @param agent - Session owner receiving the selection event.
 * @param selection - Asset IDs requested for the session.
 * @param playerIdentity - Optional player-facing identity retained by the Journey.
 * @returns The detached source selection resolved from the asset registry.
 */
@Remote('selectForSession') async remoteSelectForSession( agent: Agent, selection: AssetSelection, playerIdentity?: string | null, ): Promise<TavernSessionSelection>

/**
 * Start a Journey and materialize its authored assets as source-tracked facts.
 *
 * The normalized fields returned by the optional model pass are used only to
 * construct append-only `tavern/fact` events. The `assets-normalized` event
 * records route metadata, while the fact stream remains the Journey memory
 * source of truth.
 * @param agent - Session owner receiving the selection and authored facts.
 * @param selection - Character Card and optional World Book selection.
 * @param playerIdentity - Optional player-facing identity retained by the Journey.
 * @returns The selected source projection and its current fact projection.
 */
@Remote('bootstrapJourney') async remoteBootstrapJourney( agent: Agent, selection: AssetSelection, playerIdentity?: string | null, ): Promise<TavernBootstrapJourneyResult>

/**
 * Replace the Character Card copy inside the current Journey only.
 * @param agent - Session owner receiving the append-only asset event.
 * @param input - Character Card JSON for the current Journey selection.
 * @returns The updated Journey selection.
 */
@Remote('editJourneyCharacter') remoteEditJourneyCharacter(agent: Agent, input: string): TavernSessionSelection

/**
 * Replace a World Book copy inside the current Journey only.
 * @param agent - Session owner receiving the append-only asset event.
 * @param assetId - Selected standalone or embedded World Book ID.
 * @param input - World Info JSON for the current Journey selection.
 * @returns The updated Journey selection.
 */
@Remote('editJourneyWorldInfo') remoteEditJourneyWorldInfo(agent: Agent, assetId: import('@deepseek-ai/dsh-tavern-assets/types').AssetId, input: string): TavernSessionSelection

/**
 * Normalize the selected Journey assets once and append authored fact events.
 * @param agent - Session owner receiving the normalization event.
 * @returns The current selected Journey, or null when nothing is selected.
 */
@Remote('normalizeForSession') async remoteNormalizeForSession(agent: Agent): Promise<TavernSessionSelection | null>

/**
 * Read the latest durable asset selection for a session.
 * @param sessionId - Session whose complete durable log is inspected.
 * @returns The latest selection, or null when none is recorded.
 */
@Remote('inspectSession') async remoteInspectSession(sessionId: SessionId): Promise<TavernSessionSelection | null>

/**
 * Read a cold Tavern session for the history page without starting its Agent.
 * @param sessionId - Durable Tavern session to summarize.
 * @returns The resolved Journey character data and latest textual content.
 */
@Remote('inspectHistory') async remoteInspectHistory(sessionId: SessionId): Promise<TavernHistoryEntry>

/**
 * Read an archived Tavern Journey for the History page. Archived entries
 * intentionally use a separate Remote from active-history inspection:
 * active grouping surfaces continue to reject archived sessions while the
 * Tavern archive retains a read-and-restore path.
 * @param sessionId - Archived Tavern session to inspect.
 * @returns The resolved Journey character data and latest text.
 */
@Remote('inspectArchivedHistory') async remoteInspectArchivedHistory(sessionId: SessionId): Promise<TavernHistoryEntry>

/**
 * Archive one history session through the workspace's durable registry.
 * @param sessionId - Session identifier to hide from workspace projections.
 * @returns Resolution after the archive state is durable.
 */
@Remote('archiveHistory') async remoteArchiveHistory(sessionId: SessionId): Promise<void>

/**
 * Restore one archived history session to its workspace projections.
 * @param sessionId - Session identifier to restore.
 * @returns Resolution after the archive set is durable.
 */
@Remote('restoreHistory') async remoteRestoreHistory(sessionId: SessionId): Promise<void>

/**
 * Replace one direct user message and invalidate its stale continuation.
 * @param agent - Session owner receiving the edit transaction.
 * @param input - Target event sequence and replacement text.
 * @returns The accepted target sequence.
 */
@Remote('editMessage') remoteEditMessage(agent: Agent, input: TavernMessageEditInput): TavernMessageEditResult

/**
 * Delete a message through the current Session surface API and invalidate
 * facts derived from the deleted message and later assistant responses.
 *
 * Session currently exposes historical edits, but no physical delete
 * operation. An empty replacement is therefore the smallest replayable
 * adapter; the original message and its fact audit remain durable.
 * @param agent - Session owner receiving the deletion edit.
 * @param input - Message event sequence to hide.
 * @returns The deleted target sequence.
 */
@Remote('deleteMessage') remoteDeleteMessage(agent: Agent, input: Pick<TavernMessageEditInput, 'targetSeq'>): TavernMessageEditResult

/**
 * Inspect selected assets and their source-tracked prompt baseline.
 * @param selection - Asset IDs to inspect.
 * @returns Detached assets and the exact baseline produced by the registry.
 */
@Remote('inspectSelection') remoteInspectSelection(selection: AssetSelection): TavernSelectionInspection

/**
 * Preview the current canonical view, optionally replacing the fallback with
 * one model-cleaned view. The source asset is never changed by this Remote.
 * @param id - Asset identifier.
 * @returns The source asset and canonical cleaning record.
 */
@Remote('previewAssetCleaning') async remotePreviewAssetCleaning(id: AssetId): Promise<TavernAssetCleaningPreview>

/**
 * Persist a caller-confirmed canonical view beside its original asset.
 * @param id - Asset identifier.
 * @param view - Canonical view edited or accepted by the caller.
 * @returns The confirmed preview.
 */
@Remote('confirmAssetCleaning') async remoteConfirmAssetCleaning(id: AssetId, view: CanonicalAssetView): Promise<TavernAssetCleaningPreview>

/**
 * Inspect the canonical cleaning record without rerunning a model call.
 * @param id - Asset identifier.
 * @returns The current cleaning preview.
 */
@Remote('inspectAssetCleaning') remoteInspectAssetCleaning(id: AssetId): TavernAssetCleaningPreview

/**
 * Inspect the current Journey-local automatic fact projection and its audit records.
 * @param agent - Session owner whose fact log is inspected.
 * @returns Active facts and accepted or rejected operations in log order.
 */
@Remote('inspectFacts') remoteInspectFacts(agent: Agent): TavernFactInspection

/**
 * Rebuild plot checkpoints from the Journey's durable compaction records.
 * Ordinary transcript text is never inspected as a fallback. Missing or
 * incomplete summary/checkpoint pairs return an empty checkpoint list.
 * @param agent - Session owner whose compaction history is inspected.
 * @returns A detached list of safely reconstructed plot checkpoints.
 */
@Remote('inspectMemory') remoteInspectMemory(agent: Agent): TavernMemoryInspection

/**
 * Append one user-owned dynamic ledger section operation.
 * @param agent - Session owner receiving the configuration event.
 * @param input - Section operation and its values.
 * @returns The replayed section configuration inspection.
 */
@Remote('applySectionConfig') remoteApplySectionConfig(agent: Agent, input: TavernSectionConfigInput): TavernSectionConfigInspection

/**
 * Inspect dynamic ledger configuration reconstructed from the Session log.
 * @param agent - Session owner whose configuration is inspected.
 * @returns The current configuration and its source events.
 */
@Remote('inspectSectionConfig') remoteInspectSectionConfig(agent: Agent): TavernSectionConfigInspection

/**
 * Read only the active fact projection used by dynamic Journey columns.
 * @param agent - Session owner whose fact stream is projected.
 * @returns Active facts grouped by people and world scope.
 */
@Remote('inspectFactProjection') remoteInspectFactProjection(agent: Agent): TavernFactProjection

/**
 * Inspect the latest compiled Tavern context, including every ledger
 * inclusion and exclusion decision.
 * @param agent - Session owner whose context is inspected.
 * @returns The last durable compilation, a current compilation, or null before selection.
 */
@Remote('inspectContextActivation') remoteInspectContextActivation(agent: Agent): CompiledContext<PromptWorldInfoEntry> | null

/**
 * Inspect parsed GM response envelopes retained for one Journey.
 * @param agent - Session owner whose parsed model responses are inspected.
 * @returns Parsed responses with the assistant and durable event sequences.
 */
@Remote('inspectGmResponses') remoteInspectGmResponses(agent: Agent): readonly TavernGmResponseInspection[]

/**
 * Read the current Journey detail projection with local facts overlaid.
 * @param agent - Session owner whose resolved Journey asset projection is read.
 * @returns The latest Journey asset/person/field projection, or null before selection.
 */
@Remote('inspectJourneyAssets') remoteInspectJourneyAssets(agent: Agent): TavernJourneyAssetProjection | null

/**
 * Read current facts for one explicitly identified Journey person.
 * @param agent - Session owner whose fact projection is queried.
 * @param personId - Stable Journey person identifier.
 * @returns Active person facts.
 */
@Remote('listPersonFacts') remoteListPersonFacts(agent: Agent, personId: string): readonly import('./types.ts').TavernFactEntry[]

/**
 * Read current world facts for a Journey.
 * @param agent - Session owner whose fact projection is queried.
 * @returns Active world facts.
 */
@Remote('listWorldFacts') remoteListWorldFacts(agent: Agent): readonly import('./types.ts').TavernFactEntry[]

/**
 * Correct an existing automatic fact through an append-only replacement event.
 * @param agent - Session owner receiving the correction.
 * @param input - Existing fact ID and replacement text.
 * @returns The updated fact projection.
 */
@Remote('editFact') remoteEditFact(agent: Agent, input: TavernFactEditInput): TavernFactInspection

/**
 * Revoke an existing automatic fact without removing its source event.
 * @param agent - Session owner receiving the revocation.
 * @param input - Existing fact ID.
 * @returns The updated fact projection.
 */
@Remote('removeFact') remoteRemoveFact(agent: Agent, input: TavernFactRemovalInput): TavernFactInspection

/**
 * Resolve one hard-fact conflict by appending a user-authorized remove event
 * for the rejected side. The conflict and rejected source remain auditable.
 * @param agent - Session owner receiving the decision.
 * @param input - Conflict fact identifier and whether the incoming or prior value wins.
 * @returns The fact inspection after the decision.
 */
@Remote('resolveConflict') remoteResolveConflict( agent: Agent, input: { readonly factId: string; readonly keep: 'new' | 'old' }, ): TavernFactInspection

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

Types: [Agent](core.md) · [SessionId](core.md)

Source: [`packages/tavern/host/src/index.ts:454`](../../packages/tavern/host/src/index.ts)
<!-- END GENERATED cordis-surface -->
