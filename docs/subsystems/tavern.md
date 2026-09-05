# Tavern

English | [中文](tavern.zh.md)

The Tavern subsystem owns the roleplay asset path: Character Card and World Info normalization, Host-side persistence, per-session selection, Journey-local fact projection, and the selected persona and context projection. The compatibility parser is [`dsh-tavern-compat`](../../packages/tavern/compat), serializable records and baseline projection belong to [`dsh-tavern-assets`](../../packages/tavern/assets), the pure matching compiler belongs to [`dsh-tavern-context`](../../packages/tavern/context), and the Host facade is [`dsh-tavern-host`](../../packages/tavern/host).

The browser roleplay surface imports and exports JSON and uncompressed Character Card PNG metadata through the Host Remote service and supports edits to detached Journey copies. The Tavern profile mounts it as a full-screen root surface with a character-first entrance and secondary asset and diagnostic tools; the surface owns no session state or image bytes. Its session selector opens existing Tavern Sessions through the shared sessions service. `selectForSession` appends the complete normalized baseline to the addressed Session before the runtime changes later model requests; the runtime continues to use that recorded baseline when the source library changes. For an empty session, a non-empty Character Card `firstMessage` is recorded once as the log-only `tavern/greeting` event and projected into the shared Chat flow. Secondary tools inspect Journey facts, edit or revoke existing facts, select retained assistant Swipe candidates, and inspect the latest recorded Prompt Inspector data. The runtime derives persona from the selected Character Card and activates matching World Info as source-tracked context.

## Journey facts

The GM protocol keeps one model generation per player input. A completed response contains `story` and may contain `updates`; the Host accepts a JSON object, fenced JSON, or free text, and uses the complete response as `story` when parsing fails. The assistant message is persisted before updates are applied, so a rejected update cannot remove the visible story.

`updates.people[personId]` and `updates.world` contain natural-language `add`, `replace`, and `remove` operations. The Host assigns stable IDs to additions, validates person IDs and fact collection ownership, and records every accepted or rejected operation in `tavern/fact` with the assistant event sequence and turn. A response fingerprint makes reload and retry idempotent. `resolveTavernFacts` replays accepted events into `people[personId]` and `world`; replacement and revocation events preserve the audit trail, and a child Session projects only its seed prefix. A primary Character Card remains a Journey anchor until the story explicitly identifies a person in a selected World Book.

## Journey memory

`@deepseek-ai/dsh-tavern-memory` provides the pure memory seam around the same append-only `tavern/fact` source. Strict extraction parsing, span idempotency, per-Session extraction serialization, subject-key normalization, freshness-first folding, branch visibility, source-tracked asset cleaning, relation-only compaction parsing, bounded injection rendering, and a disposable lexical/cosine index are implemented as derived helpers. User and explicit observations cannot be silently suppressed by later inferred observations, while superseded or conflicting source records remain auditable.

The Host projector consumes the same subject-key and freshness rules, and the existing UI can read its active projection. When `ctx.jobs` is composed, Host queues turn-end extraction per Session, logs the exact auxiliary prompt/output, and appends accepted facts; when `ctx.tools` is composed, it exposes the read-only `fact_search` tool. The current live GM path retains `story` plus `updates` for compatibility. SQLite-backed derived storage, real embedding calls, Tavern-specific compaction, and the full memory-panel UI remain follow-up work described in the [Tavern Journey memory Agent Note](../../.agents/notes/implemented/architecture/2026-09-03-tavern-journey-memory-capability.md).

The UI presents normalized source fields and Journey facts together in World Book and World Person details. After selection or reload, `normalizeForSession` uses the selected model route when available, validates source references, and records dynamic fields in `tavern/assets-normalized`; deterministic source-line fields remain the fallback. Source assets remain immutable and reusable; Journey-local asset edits are retained only by that Journey, and the active baseline stays detached from the source library. Fact controls can edit or revoke an existing fact but do not create one manually.

World Info uses the smallest selected `scanDepth` as the recent-message window and the smallest selected `tokenBudget` as a deterministic first-fit budget. Intermediate probabilities use a stable session/source/query-derived roll, and entries sharing a group compete through deterministic ranking. Depth, sticky, and cooldown metadata remain attached to activation candidates; persistent timers and recursive scans are deferred.

## World Info Execution

SillyTavern's `checkWorldInfo` builds a reverse-depth scan buffer, appends explicitly enabled global sources such as persona, character description, scenario, and creator notes, then evaluates entries in repeated passes. Each pass applies disabled/trigger/character filters, timed effects, constant or keyword activation, inclusion-group filtering, probability, and the token budget; successful entries can add their content to a recursion buffer for another pass. The final result is split into character-side, history-side, author-note, example-message, depth, and outlet placements. See the [release implementation](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b/public/scripts/world-info.js#L4597-L5162).

This execution model has several reliability costs. Activation is spread across mutable chat metadata, extension listeners, random probability/group rolls, recursive passes, and prompt-template-specific insertion points. The returned strings do not form a complete decision ledger, so reproducing why an entry was excluded requires reconstructing hidden scan state and timing metadata. Sticky and cooldown state is also attached to chat metadata rather than to explicit message or branch events, which can make edits, reloads, and branch changes difficult to reason about.

The dsh implementation keeps a source-tracked ledger and deterministic rolls. An embedded `character_book` is normalized as a Character Card-owned World Info asset, included in the selected prompt baseline, and excluded from the standalone World Info library. Entry `position`, `depth`, `recursive`, `sticky`, and `cooldown` fields are retained but do not yet change activation or placement; selective matching supports primary plus any secondary key, not SillyTavern's `NOT_ALL`, `NOT_ANY`, and `AND_ALL` logic. The current compiler also packs Memory, Story State, and World Info into one budget and uses a rough character-based token estimate.

The runtime supplies a stable `probabilityRoll` to the context compiler, so an enabled entry with a probability strictly between 0 and 100 is evaluated deterministically for the session, source, and query instead of failing because no roll was supplied. The query uses the session's visible messages and pending input; runtime context snapshots are removed from the request messages before the current activation is appended, so an earlier projection does not become a new conversation turn.

The remaining backend work is to model position/depth injection as structured output rather than one replacement message, add full selective logic and group semantics, implement bounded recursive passes, eventize sticky/cooldown state, and expose every filter, match, group, budget, and placement decision in Prompt Inspector. If a future multi-observer or multi-agent mode is added, World Info entries must first gain explicit observer/visibility policy. The current pseudo-group path remains one GM generation and one Story segment. Executable SillyTavern extensions remain unsupported data and must not run inside dsh.

## Model Experience

### What the model sees

After a session selection event, the selected Character Card fields are rendered into the persona section. An empty session also displays its durable Character Card greeting in Chat and includes it once in the persona projection. World Info entries that match the current session text are rendered as dynamic Tavern context. Without a selection event, the runtime keeps its default roleplay persona and contributes no imported asset content.

### Token effect

Imported assets and selection inspection consume no live-request tokens. Selected persona and activated World Info consume prompt tokens in later requests.

### KV Cache effect

Changing the selected Character Card or activated World Info changes the later system prompt and therefore its cache key.

## Durable state

Imported source JSON is stored through `storageDomain` and restored when the Host service starts. Session selection, opening greetings, `tavern/assets-normalized`, `tavern/gm-response`, `tavern/fact` operations, Memory upserts, Story State changes, Swipe candidate records, and context activation fingerprints are append-only Session events, so model-visible selections, normalized display fields, parsed GM updates, and active Journey facts can be reconstructed from the log. The greeting is a log-only event rather than an `assistant/message`, because assistant messages are reserved for model output. Automatic fact events retain rejected operations for audit and link accepted operations to the originating assistant response.

## Known Limitations and Deferred Work

- The browser surface is a full-screen Tavern root inside the existing AppFrame. It reuses the durable transcript, ChatView, and composer through the `conversation` slot and `conversationChatView` service; it does not create a second runtime or send path.
- PNG import supports uncompressed `chara` metadata only; executable SillyTavern extensions and compressed PNG metadata are not handled.
- The current UI exposes Journey fact inspection and correction, retained-candidate Swipe selection, regeneration into a child Session, and the latest-request Prompt Inspector. Legacy Memory and Story State Remotes remain separate compatibility surfaces, but the main Journey UI does not expose manual creation for them. Re-normalization after Journey-local source edits, observer-specific L0-L3 retrieval, general-purpose fork, true multi-agent group chat, scene planning, and RAG remain deferred. Pseudo-group presentation is part of the current one-GM Story segment model.

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
