# @deepseek-ai/dsh-tavern-host

English | [Chinese](README.zh.md)

Host-side asset management and first runtime projection for the Tavern profile. `TavernAssetHost` parses Character Card V2/V3 and standalone World Info JSON, converts them to the normalized records owned by `dsh-tavern-assets`, and exposes list, import, select, and inspect operations. `TavernAssetService` persists imported source JSON through `storageDomain`, exposes the asset and session-selection operations through the Host Remote gateway, and installs the selected character persona and World Info projection for each agent.

Imported source records use the storage-domain provider and are restored when the service starts. Session selection is append-only: `selectForSession` records the complete normalized baseline in `tavern/assets-selected`. When an empty session selects a Character Card with a non-empty `firstMessage`, it also records one `tavern/greeting` event. The runtime and browser Chat projection read that event, so the opening greeting survives replay without being fabricated as an assistant model message. An embedded `character_book` remains preserved in the character's source data and is not registered as an independent World Info asset. Remote calls return detached JSON values; the in-process disposer is intentionally not exposed on the wire.

## Interface

- `listCharacters()` and `listWorldInfo()` return detached snapshots.
- `importCharacter()` and `importWorldInfo()` parse and register one document, returning the asset and a disposer.
- `select()` delegates selection validation and prompt-baseline projection to `AssetRegistry`.
- `inspectSelection()` returns the selected detached assets beside that baseline.
- `selectForSession()` appends the selected baseline to the addressed Session and records one durable opening greeting only for an empty session.
- `inspectSession()` replays the latest selected baseline from the Session log.
- `listMemory()` and `remember()` read and append session-scoped durable Memory entries.
- `inspectStoryState()` and `setStoryState()` read and append canonical location and time changes.
- `inspectSwipe()` and `selectSwipe()` read and append retained assistant-candidate selections.
- `regenerate()` creates a child Session before one completed turn, retains the selected candidate, runs the original user message for a fresh response, and returns only after the child is idle and flushed.

World Info activation uses the smallest selected `scanDepth` as the recent-message window and the smallest selected `tokenBudget` as a deterministic first-fit budget. Intermediate probabilities use a stable session, source, and query-derived roll; entries in one group compete by the compiler's deterministic ranking. Entry depth, sticky, and cooldown values are preserved in the prompt baseline and activation ledger for future stateful policies; this runtime does not yet persist sticky or cooldown timers.

The default ID is a lower-case name slug. Pass `options.id` for stable IDs across renamed assets or multiple assets with the same name.

The runtime resolves Character Card `{{char}}` and `{{user}}` macros before Harness prompt interpolation. Other simple Tavern macros are rendered with single braces so authored card text cannot be mistaken for a Harness prompt variable.

## Model Experience

### Selected Tavern context

#### What the model sees

The import and inspection operations do not change a model request. After `selectForSession`, the agent runtime adds the selected character persona and matched World Info to later system prompts; each selection and context snapshot is recorded in the Session log.

#### Token effect

Import and inspection use zero live-request tokens. Selected persona and World Info consume prompt tokens in later requests.

#### KV Cache effect

Import and inspection do not create model requests. Changing the selection changes the later system prompt and its cache key.

## Known Limitations and Deferred Work

- Memory is currently an append-only upsert projection with pinned, persistent, and scene levels; it does not implement observer-specific L0-L3 retrieval or deletion controls.
- Story State currently exposes canonical location and time changes; inventory, relationships, health, cultivation, scene orchestration, and group chat remain deferred.
- Swipe retains and selects assistant candidates in the Session log; `regenerate` creates a child Session before the target turn, copies the selected candidate, runs the original user message for a fresh response, and returns after the child is idle and flushed. A general-purpose fork command is not exposed by this package.
- The runtime records context activation snapshots and projects keyword-matched World Info into the system prompt; compressed Character Card metadata and executable SillyTavern extensions are not supported.
