# @deepseek-ai/dsh-tavern-host

English | [Chinese](README.zh.md)

Host-side asset management and Journey runtime for the Tavern profile. `TavernAssetHost` parses Character Card V2/V3 and standalone World Info JSON, converts them to the normalized records owned by `dsh-tavern-assets`, and exposes list, import, select, and inspect operations. `TavernAssetService` persists imported source JSON through `storageDomain`, exposes asset, session-selection, and Journey-fact operations through the Host Remote gateway, and installs the selected character persona and World Info projection for each agent.

Imported source records use the storage-domain provider and are restored when the service starts. Session selection is append-only: `selectForSession` records only asset IDs and player identity in `tavern/assets-selected`; the Host resolves those IDs through the durable source registry when a prompt or Remote response needs detached assets. The active Journey projects dynamic fields only from `tavern/fact` events. Facts can override detail fields, such as a `label: Name` update for an existing World Person, without rewriting the source asset. When an empty session selects a Character Card with a non-empty `firstMessage`, it also records one `tavern/greeting` event. The runtime and browser Chat projection read that event, so the opening greeting survives replay without being fabricated as an assistant model message. An embedded `character_book` is preserved in the character's source data, normalized as an attached World Info asset, and not registered as an independent World Info asset. Remote calls return detached JSON values; the in-process disposer is intentionally not exposed on the wire. Journey-start Remotes wait for a bounded session-persistence barrier before resolving; a barrier timeout rejects the call, while model normalization remains best-effort and falls back deterministically. After selection, `normalizeForSession` optionally performs one auxiliary model call against the source registry projection, converts the validated result into authored `tavern/fact` events, and records only origin and route metadata in `tavern/assets-normalized`. Missing model routes, model failures, and invalid output use deterministic source-field fallback. Concurrent normalization requests for one Session share one call, and a result is discarded if the Journey selection changes while the call is running.

## Journey facts

One player input still produces one main GM generation. The live GM instruction requests plain prose; the Host persists the assistant response and, when `ctx.jobs` is composed, schedules an independent turn-end extractor instead of blocking the next turn. The legacy `story` plus `updates` parser remains for replay and existing fixtures; accepted operations from that compatibility path and accepted extractor atoms both append `tavern/fact` events. Ordinary story prose is not treated as a durable fact without one of those structured paths.

`updates.people[personId]` and `updates.world` contain natural-language `add`, `replace`, and `remove` operations. An operation may carry an arbitrary display `label` without changing the natural-language fact body. The Host assigns `fact:<assistantSeq>:<operationIndex>` IDs to additions, allows a valid `add` to introduce a new `person:<slug>`, validates fact ownership for `replace` and `remove`, and appends one `tavern/fact` event for every accepted or rejected operation. Each event carries the assistant sequence, turn, branch, and a deterministic response idempotency key. Replaying the same response or retrying after reload does not append duplicate operations.

`resolveTavernFacts` rebuilds `people[personId]` and `world` from accepted events in log order. Replacements and removals append new events, so the active projection changes without erasing the audit trail; a Session child sees only the events in its seed prefix. A person enters the projection through a selected World Book identity or a valid GM `add`; the primary Character Card is not automatically a person. The query Remotes return active facts, while `editFact` and `removeFact` let the player correct or revoke an existing fact without creating one manually.

A World Person keeps the source-name-derived ID from its authored fact anchors and uses the latest `Name` fact for display. A rename therefore updates the existing person instead of creating a duplicate and remains isolated from source-library changes. The compatibility `updates` envelope and the turn-end memory extractor are the structured paths that can make a persistent change.

## Journey memory

The live GM instruction requests plain prose. The compatible `story` plus `updates` parser remains for replay and existing fixtures, while a separate turn-end extractor observes the prose without blocking the next turn. When `ctx.jobs` is composed, the Host queues one extraction job per completed turn, records its exact prompt and output in the Session log, and appends accepted `tavern/fact` events. The memory policy is validated at Host startup; deployments can supply it through the `memory` service config.

`@deepseek-ai/dsh-tavern-memory` owns the shared subject-key fold, freshness protection, branch visibility, injection snapshots, and disposable retrieval index, so Host, UI, and compaction consumers use the same projection. The package ships `SqliteFactIndex`, a version-stamped SQLite-backed provider for rebuildable derived fact-index queries, and an injectable `EmbeddingProvider`; `DeterministicEmbeddingProvider` supplies the offline default. `MemoryIndex` combines lexical and cosine signals for hybrid retrieval without requiring a network embedding call. The Host renders the visible memory into a prompt-injection snapshot at agent pre-step, logs the exact snapshot, and exposes the read-only `fact_search` tool when `ctx.tools` is available.

`inspectFacts()`, `listPersonFacts()`, and `listWorldFacts()` expose the active projection and audit records; `editFact()`, `removeFact()`, and conflict resolution append decisions to the same fact stream. Deterministic asset cleaning provides preview and confirmation while preserving source records. When no other compaction provider is mounted and compaction is not disabled, `TavernCompactionEngine` selects complete turns, commits bounded checkpoints, and records relation-only cleanup evidence. `inspectMemory()` reconstructs checkpoints and plot projection only from complete compaction/summary records paired with their matching checkpoint source `user/message`; it does not fall back to ordinary transcript content, and missing or incomplete data returns an empty checkpoint array.

The client memory panel exposes State, Plot, and Audit views. It supports cleaning preview and confirmation, fact edit/remove, conflict resolution, and an impact-confirmation step before changes that affect the Journey projection.

## Interface

- `listCharacters()` and `listWorldInfo()` return detached snapshots.
- `importCharacter()` and `importWorldInfo()` parse and register one document, returning the asset and a disposer.
- `select()` delegates selection validation and prompt-baseline projection to `AssetRegistry`.
- `inspectSelection()` returns the selected detached assets beside that baseline.
- `selectForSession()` appends asset IDs and optional player identity to the addressed Session and records one durable opening greeting only for an empty session.
- `inspectSession()` replays the latest selection IDs and resolves the source assets through the registry.
- `deleteAsset()` removes a source asset from the in-memory and durable registries without checking Journey references; a Journey that still selects the ID cannot resolve its assets until that ID is imported again.
- `inspectHistory()` reads a cold Session summary unless the durable WorkspaceRegistry has archived the session; `archiveHistory()` persists that archive state and reports structured `history-already-archived`, `history-not-found`, or `history-archive-unavailable` failures.
- `inspectArchivedHistory()` reads the retained transcript summary for an archived Session, and `restoreHistory()` removes the archive marker without deleting or rewriting its log.
- `editJourneyCharacter()` and `editJourneyWorldInfo()` append user-authorized fact events for changed Journey fields without changing the source library.
- `normalizeForSession()` prepares authored `tavern/fact` events from the selected source registry projection and records only normalization metadata in `tavern/assets-normalized`; dynamic fields are read from the fact projection.
- `inspectFacts()` returns the active Journey fact projection and accepted or rejected `tavern/fact` records.
- `fact_search` is a read-only model tool over the visible Journey fact projection when the tool registry is available.
- `applySectionConfig()` appends dynamic section configuration to the Session log; retrying an already-applied command returns the replayed projection without adding a duplicate event, and `inspectSectionConfig()` reconstructs it after reload.
- `listPersonFacts()` and `listWorldFacts()` query the active Journey fact projection.
- `editFact()` appends a replacement for an existing fact; `removeFact()` appends a revocation. Neither operation creates a new fact.
- Journey memory is the append-only `tavern/fact` stream. Fact projection, editing, revocation, conflict decisions, and audit all use that stream; there is no second session-scoped memory document.
- `previewAssetCleaning()`, `confirmAssetCleaning()`, and `inspectAssetCleaning()` expose deterministic source-preserving asset cleaning.
- `inspectMemory()` returns checkpoint and plot projection only for complete compaction/summary records with matching checkpoint source messages; missing or incomplete pairs produce an empty checkpoint list.
- `TavernCompactionEngine` is the native fallback compaction provider when compaction is enabled and no other provider is mounted; it compacts complete turns and keeps atomic facts append-only.
- `inspectStoryState()` and `setStoryState()` read and append canonical location and time changes.
- `inspectSwipe()` and `selectSwipe()` read and append retained assistant-candidate selections.
- `regenerate()` creates a child Session before one completed turn, retains the selected candidate, runs the original user message for a fresh response, and returns only after the child is idle and flushed.

World Info activation uses the smallest selected `scanDepth` as the recent-message window and the smallest selected `tokenBudget` as a deterministic first-fit budget. Intermediate probabilities use a stable session, source, and query-derived roll; entries in one group compete by the compiler's deterministic ranking. Entry depth, sticky, and cooldown values are preserved in the prompt baseline and activation ledger for future stateful policies; this runtime does not yet persist sticky or cooldown timers.

The default ID is a lower-case name slug. Pass `options.id` for stable IDs across renamed assets or multiple assets with the same name.

The runtime resolves Character Card `{{char}}` and `{{user}}` macros before Harness prompt interpolation. Other simple Tavern macros are rendered with single braces so authored card text cannot be mistaken for a Harness prompt variable.

## Model Experience

### Selected Tavern context

#### What the model sees

The import and inspection operations do not change a model request. After `selectForSession`, the agent runtime adds the selected character persona, matched World Info, and any rendered Journey memory injection to later system prompts; each selection, memory snapshot, and context snapshot is recorded in the Session log.

#### Token effect

Import and inspection use zero live-request tokens. Selected persona, World Info, and rendered Journey memory consume prompt tokens in later requests.

#### KV Cache effect

Import and inspection do not create model requests. Changing the selection or visible memory projection changes the later system prompt and its cache key.

## Known Limitations and Deferred Work

- The legacy Memory and Story State Remotes remain separate compatibility surfaces; the main Journey UI does not expose manual Memory or Story State creation. Automatic continuity facts are natural-language Journey events and do not populate fixed relationship, inventory, health, or cultivation fields.
- Normalization uses the selected model route when available and deterministic source-field fallback otherwise. `TavernCompactionEngine` compacts complete turns into bounded checkpoints and relation-only cleanup evidence; fact atoms remain append-only, so fact-specific compaction and richer multi-entry organization remain deferred.
- The default embedding provider is deterministic and `EmbeddingProvider` is injectable; external or network embedding providers, ANN storage, vector pooling, and larger-scale vector indexing remain deferred.
- The assembled keyless Loader snapshot covers Tavern selection, background extraction, durable `tavern/memory-context` injection, native compaction, persisted lifecycle records, and post-compaction continuation. A single scenario combining reload and fork recovery remains deferred, as do full cross-process transcript verification and an assembled browser transcript for the client memory panel.
- A generic cross-Journey `dsh` memory plugin is not part of the shipped Tavern capability and remains deferred.
- Story State exposes canonical location and time changes for existing secondary controls; scene orchestration, group chat, and persistence for World Info `sticky`/`cooldown` timers remain deferred.
- Swipe retains and selects assistant candidates in the Session log; `regenerate` creates a child Session before the target turn, copies the selected candidate, runs the original user message for a fresh response, and returns after the child is idle and flushed. A general-purpose fork command is not exposed by this package.
- The runtime records context activation snapshots and projects keyword-matched World Info into the system prompt; compressed Character Card metadata and executable SillyTavern extensions are not supported.
