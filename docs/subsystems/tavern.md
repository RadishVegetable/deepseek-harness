# Tavern

English | [中文](tavern.zh.md)

The Tavern subsystem owns the roleplay asset path: Character Card and World Info normalization, Host-side persistence, per-session selection, and the selected persona and context projection. The compatibility parser is [`dsh-tavern-compat`](../../packages/tavern/compat), serializable records and baseline projection belong to [`dsh-tavern-assets`](../../packages/tavern/assets), the pure matching compiler belongs to [`dsh-tavern-context`](../../packages/tavern/context), and the Host facade is [`dsh-tavern-host`](../../packages/tavern/host).

The browser workbench imports, edits, and exports JSON and uncompressed Character Card PNG metadata through the Host Remote service. The Tavern profile mounts it as a full-screen root surface with roleplay, asset-library, and prompt-context navigation; the surface owns no session state or image bytes. Its session selector opens existing Tavern Sessions through the shared sessions service. `selectForSession` appends the complete normalized baseline to the addressed Session before the runtime changes later model requests. For an empty session, a non-empty Character Card `firstMessage` is recorded once as the log-only `tavern/greeting` event and projected into the shared Chat flow. The workbench also edits session Memory, canonical location and time Story State, retained assistant Swipe candidates, and the latest recorded Prompt Inspector data. The runtime derives persona from the selected Character Card and activates matching World Info as source-tracked context.

World Info uses the smallest selected `scanDepth` as the recent-message window and the smallest selected `tokenBudget` as a deterministic first-fit budget. Intermediate probabilities use a stable session/source/query-derived roll, and entries sharing a group compete through deterministic ranking. Depth, sticky, and cooldown metadata remain attached to activation candidates; persistent timers and recursive scans are deferred.

## World Info Execution

SillyTavern's `checkWorldInfo` builds a reverse-depth scan buffer, appends explicitly enabled global sources such as persona, character description, scenario, and creator notes, then evaluates entries in repeated passes. Each pass applies disabled/trigger/character filters, timed effects, constant or keyword activation, inclusion-group filtering, probability, and the token budget; successful entries can add their content to a recursion buffer for another pass. The final result is split into character-side, history-side, author-note, example-message, depth, and outlet placements. See the [release implementation](https://github.com/SillyTavern/SillyTavern/blob/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b/public/scripts/world-info.js#L4597-L5162).

This execution model has several reliability costs. Activation is spread across mutable chat metadata, extension listeners, random probability/group rolls, recursive passes, and prompt-template-specific insertion points. The returned strings do not form a complete decision ledger, so reproducing why an entry was excluded requires reconstructing hidden scan state and timing metadata. Sticky and cooldown state is also attached to chat metadata rather than to explicit message or branch events, which can make edits, reloads, and branch changes difficult to reason about.

The dsh implementation intentionally keeps a source-tracked ledger and deterministic rolls, but its current runtime is not yet equivalent to that execution model. `character_book` is parsed but is not registered or included when a Character Card is selected. Entry `position`, `depth`, `recursive`, `sticky`, and `cooldown` fields are retained but do not affect activation or placement; selective matching only supports primary plus any secondary key, not SillyTavern's `NOT_ALL`, `NOT_ANY`, and `AND_ALL` logic. The current compiler also packs Memory, Story State, and World Info into one budget and uses a rough character-based token estimate.

There is one verified runtime defect: `packages/tavern/host/src/runtime.ts` supplies a deterministic `probabilityRoll`, but `packages/tavern/context/src/context-compiler.ts` omits it when calling `matchWorldInfo`. Any enabled entry with a probability strictly between 0 and 100 therefore throws `World Info entry ... requires a probability roll` instead of being evaluated. The runtime query also scans derived messages that include earlier runtime-context snapshots, which can let old injected World Info retrigger later entries; the scanner should consume a canonical visible-message window and exclude compiler snapshots.

The next backend work should be ordered as follows: wire the probability callback and add an assembled regression test; merge embedded Character Books into the selected baseline with explicit provenance; model position/depth injection as structured output rather than one replacement message; add full selective logic and group semantics; implement bounded recursive passes; then eventize sticky/cooldown state and expose every filter, match, group, budget, and placement decision in Prompt Inspector. World Info entries should also gain explicit observer/visibility policy before ensemble generation is enabled. Executable SillyTavern extensions remain unsupported data and must not run inside dsh.

## Model Experience

### What the model sees

After a session selection event, the selected Character Card fields are rendered into the persona section. An empty session also displays its durable Character Card greeting in Chat and includes it once in the persona projection. World Info entries that match the current session text are rendered as dynamic Tavern context. Without a selection event, the runtime keeps its default roleplay persona and contributes no imported asset content.

### Token effect

Imported assets and selection inspection consume no live-request tokens. Selected persona and activated World Info consume prompt tokens in later requests.

### KV Cache effect

Changing the selected Character Card or activated World Info changes the later system prompt and therefore its cache key.

## Durable state

Imported source JSON is stored through `storageDomain` and restored when the Host service starts. Session selection, opening greetings, Memory upserts, Story State changes, Swipe candidate records, and context activation fingerprints are append-only Session events, so model-visible selections can be reconstructed from the log. The greeting is a log-only event rather than an `assistant/message`, because assistant messages are reserved for model output.

## Known Limitations and Deferred Work

- The browser surface is a full-screen Tavern root inside the existing AppFrame. It reuses the durable transcript, ChatView, and composer through the `conversation` slot and `conversationChatView` service; it does not create a second runtime or send path.
- PNG import supports uncompressed `chara` metadata only; executable SillyTavern extensions and compressed PNG metadata are not handled.
- The current UI exposes Memory upserts, canonical location and time Story State, retained-candidate Swipe selection, regeneration into a child Session, and the latest-request Prompt Inspector; observer-specific L0-L3 retrieval, general-purpose fork, group chat, scene planning, and RAG remain deferred.

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
