# Agent Note: dsh Tavern architecture for context, memory, and roleplay composition

Status: proposed

English | [中文](2026-08-24-dsh-tavern-architecture.zh.md)

## Problem

SillyTavern is a useful compatibility target for character cards and World Info, but its runtime reduces authored setting, generated memory, and chat history to one mutable prompt assembly. It has no durable knowledge view per character, no authoritative structured story state, and no event-backed replay of retrieval decisions. Long chats therefore repeat facts, lose facts, expose private knowledge, and spend input tokens on content that is not relevant to the current turn.

The target product must use one GM-led story loop for both focused relationship stories and large settings in which several Characters act inside one narrative. It must preserve SillyTavern asset compatibility, run as a TypeScript dsh composition in Docker, expose a usable Web UI, and show the exact context sent to each model call while keeping model-visible content reconstructable from the dsh Session log.

## Proposal

Build an optional dsh Tavern composition. The composition reuses dsh Session, prompt, LLM, compaction, Web, and branching capabilities, and adds Tavern-specific asset, story-state, memory, context, orchestration, and continuity plugins. A Tavern profile composes the plugins required by the selected assets and profile policy. It does not replace dsh core or embed SillyTavern's JavaScript runtime.

The execution modes described below are superseded by the [implemented GM-led story segments decision](../../implemented/architecture/2026-08-29-gm-led-story-segments.md). This proposal remains active for knowledge-view, context-compilation, asset-compatibility, and log-replay decisions that newer decisions do not redefine. The [implemented staged delivery decision](../../implemented/architecture/2026-08-29-tavern-staged-delivery.md) and GM decision redefine the default continuity model: Journey-local natural-language people and world facts replace fixed relationship, inventory, or health projections as the next implementation target.

Delivery is staged by the [implemented Tavern staged delivery decision](../../implemented/architecture/2026-08-29-tavern-staged-delivery.md). The package topology and structured runtime described here are the target architecture; Phase 1 may use the existing Session and ordinary free-text chat without mounting every later subsystem.

The existing [Tavern roleplay surface proposal](../feature/2026-08-24-tavern-roleplay-surface.md) remains the feature-level UI and swipe proposal. This note owns the cross-cutting architecture and the knowledge model that proposal depends on.

### Composition and GM narrative loop

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

The profile exposes one GM narrative loop. One player input produces one GM model generation and one Story segment. The segment may contain narration, setting changes, and actions or dialogue for multiple Characters. This is a pseudo-group presentation, not a group of Character Agents: the runtime does not make one model call per Character and does not select a speaker between calls. Optional planning or continuity passes may be enabled for a profile that accepts their cost, but they are not separate player-facing interaction modes.

Selecting a Character Card or World Info asset selects data and defaults, but does not silently grant unrelated tools such as shell, web, filesystem, skill, or subagent access.

### Domain model

The product keeps five different kinds of information separate:

- **Asset**: author-controlled input such as a Character Card, Character Book, World Info entry, World Book, preset, or imported PNG.
- **Journey material**: the Journey-local Character Card and World Book copies created from imported source snapshots.
- **Fact**: a natural-language continuity line under `people[personId]` or `world`. A fact can describe a relationship, role, item, rumor, discovery, or any other story concept without requiring a dedicated product field.
- **Knowledge view**: the facts an observer may use, including belief, rumor, inference, and false belief. In the first version, the model receives one GM view; Character knowledge is narrative data and projection metadata, not a separate Character Agent request.
- **Event source**: Session events that record asset snapshots, story text, fact operations, context decisions, and branches. A projection is never the source of truth.

L0-L3 retain their useful memory abstraction but do not provide isolation:

```text
L0  raw Session events and transcript segments
L1  observer-specific atomic memories
L2  observer-specific scene or episode memories
L3  observer-specific stable long-term memories
```

Knowledge isolation is expressed by independent axes:

```text
observerId       gm | character:<id> | player | narrator
visibility       public | witnessed | heard | private | gm-only
epistemicStatus  canon | belief | rumor | inference | false-belief
acquisition     witnessed | heard | read | told | inferred | granted
authority       user | gm | authored-asset | observed | model-candidate
provenance       source event ids and asset references
```

The same event may produce different memories for different observers. A secret is not deleted from the system when a character does not know it; it is excluded by the character's knowledge view. This is narrative soft isolation, not a security boundary.

The Character Card and World Book are authored baselines. Journey-local fact lines are the evolving continuity layer. Fixed projections for values that later require exact machine checks remain optional extensions; they are not required by the default narrative loop and do not replace the natural-language fact record.

### Story events and model visibility

The Session event log is the only authoritative source. Tavern contributes declaration-merged event types for asset selection, scene commands and plans, public or private scene beats, state changes, knowledge acquisition, memory candidates, context decisions, and continuity decisions. Exact event names and payload types are owned by the package that declares them and are required-on-read when they affect reconstruction.

Every model request uses the existing dsh request/header and request/context persistence path. The compiled context snapshot records the exact rendered model-visible sections, source ids, compiler policy version, observer id, budget ledger, and selected or filtered candidates. A retrieval index or current database row is never required to replay a historical model request.

Generated memory is first a candidate with source event ids and authority metadata. A user or GM can promote, correct, invalidate, or pin it. A correction creates a new event and closes the old assertion's validity; it does not erase the old belief, because the old belief can explain later dramatic behavior.

Branching is part of the event model. Swipe, regenerate, and historical edit create or replace a Session branch at a stable turn boundary. L1-L3 and structured state are projected from the selected branch, so a discarded branch cannot contaminate the active story.

### Context compilation and retrieval

The context compiler produces the one model-visible GM view and a player-safe diagnostic projection. It packs the GM context in this order:

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

Retrieval always filters before semantic ranking:

```text
observer and visibility filter
  -> validity and branch filter
  -> Journey fact projection
  -> keyword or FTS candidate lookup
  -> vector retrieval when needed
  -> rerank and deduplicate
  -> token-budget packing
```

World Info activation keeps deterministic SillyTavern rules such as keys, secondary keys, whole-word matching, recursion, depth, groups, probability, sticky entries, cooldowns, and insertion position. Vector search may expand candidate recall, but it never bypasses those visibility and validity checks and never promotes a candidate to canon.

The compiler owns one token ledger for stable assets, public state, GM memory, recent events, and output reservation. It does not copy the full transcript or full World Info collection into every request. Stable prefixes are cacheable by asset version, GM-context policy version, memory projection version, compiler policy version, and tool schema version. Dynamic retrieval remains after the stable prefix so it does not invalidate the reusable prefix.

The first version never creates a Character-specific model request. Character attribution in a Story segment is output metadata for transcript rendering and state projection. The GM context must exclude information that the player is not permitted to see when that information would cause an unintended reveal; this is a context policy concern, not a benefit of splitting one turn into multiple Character calls.

### SillyTavern compatibility

The compatibility layer accepts and exports Character Card V1 and V2 JSON, PNG-embedded cards, V2 `character_book`, and standalone World Info JSON. A SillyTavern `World` is treated as a reusable World Info/Lorebook collection that can be attached to a Character Card or Journey; it does not become a world entity with an owned Character roster or authoritative story state. The associated `extensions.world` value is an attachment reference, not a second kind of world model. The importer preserves unknown fields, original entry order, source text, keys, secondary keys, insertion positions, depth, recursion, group behavior, probability, sticky and cooldown settings, and extension data needed for round trips.

The importer stores the original asset and produces a native normalized asset. The native model may index entries and derive setting references for retrieval, but it does not turn a Lorebook into an entity graph with owned Characters. The importer retains the original flat World Info entries so export remains compatible. Static assets are not silently converted into L3 memory.

Arbitrary SillyTavern JavaScript extensions, regex scripts, remote service hooks, and UI-specific behavior are preserved as unsupported extension data in the first version; they are not executed inside the dsh process. Unsupported required fields fail loudly at import, while unknown non-executable metadata remains available for export.

### UI, Docker, and observability

The Web composition provides chat, Character Card and World Info asset management, scene controls, memory inspection, story-state inspection, branch and swipe controls, and a Prompt Inspector. The inspector shows the single GM request, exact rendered sections, token ledger, cache key, retrieved candidates, filtered candidates with reasons, source events, and continuity warnings. It must distinguish model-visible context from diagnostic data that was not sent to the model.

The Docker image builds the TypeScript workspace and serves the selected profile on a configurable container bind address. The profile must explicitly opt into container binding and must not depend on a development-only host override. Persistent storage includes Session logs, imported assets, projections, and indexes; vector storage is optional and can be rebuilt from source events.

### Security and failure behavior

Card, World Info, memory, and model output are data, not system instructions. The compiler places them in declared prompt sections and does not allow imported text to change system policy or grant tools. Tool composition is explicit in the profile.

Misconfiguration and invalid durable data fail loudly. Runtime degradation is explicit: an unavailable vector provider falls back to structured and FTS retrieval; a missing memory result does not invent one; an over-budget request follows its configured priority policy; a failed GM generation can produce a marked fallback or stop the turn according to profile policy. A continuity warning is logged before any automatic repair or retry.

### Package ownership

The first package topology is:

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

Pure parsing and rendering helpers remain ordinary TypeScript modules. A capability with a replaceable backend has a Service Definition, a Provider, and Consumers. The first implementation uses a local durable provider and FTS; vector and external-memory providers are optional capability providers, not requirements of the domain model.

## Alternatives considered

**Extend SillyTavern in place.** This keeps the existing UI but leaves the mutable prompt pipeline, split completion paths, and branch semantics as the ownership center. It loses the dsh event log, prompt reconstruction, and plugin composition that are required to make memory and visibility reliable.

**Build one standalone replacement service.** This would duplicate dsh Session persistence, prompt assembly, Web streaming, branching, and capability policy. The product needs a dsh composition, not a second agent runtime.

**Use one global memory store and instruct the model to respect character knowledge.** A model-visible prompt containing every secret is not soft isolation. Separate observer projections and pre-retrieval filtering are required for reliable narrative knowledge asymmetry.

**Use vector RAG as the story database.** Similarity search cannot enforce current location, inventory, death, cultivation realm, relationship state, branch validity, or authority. Structured projections and source events own those values; RAG only recalls candidate text.

**Always call a planner or a Character Agent before every response.** This increases token use and latency for focused relationship turns, while separate Character calls make one causal Story segment harder to compose. The first version uses one GM generation; optional planning is reserved for profiles that explicitly accept the extra cost.

**Call the model once per Character in a group chat.** This repeats the same World Book, Journey, and Scene context, adds speaker scheduling, and spends tokens on coordination. A single GM generation can attribute multiple Character blocks while preserving the causal order in one Story segment.

## Acceptance criteria

1. A dsh Tavern profile composes from existing dsh packages and boots a Docker Web surface with an explicit configurable bind address.
2. Every player input produces one GM generation and one Story segment that can contain narration and actions or dialogue for multiple Characters; no Character-specific call is required.
3. The same imported Character Card V1/V2 or World Info asset round-trips without losing supported fields or unknown metadata.
4. A character request cannot retrieve a memory whose observer, visibility, branch, validity, or authority excludes that character.
5. The GM request and its accepted Story segment are logged as one Narrative turn; player-hidden context is excluded by the GM context policy, and Character attribution does not create another model-visible request.
6. Canon, belief, rumor, inference, and false belief remain distinguishable and retain source events through correction and branch projection.
7. Journey-local people and world facts are validated as fact operations and projected from the selected branch; typed projections are optional extensions rather than the default continuity store.
8. Prompt Inspector can replay the exact model-visible context and show token, retrieval, cache, and continuity decisions.
9. Swipe, regenerate, and historical edit project memory and story state from the selected branch without downstream contamination.
10. Keyless runnable examples and snapshots cover a focused relationship turn, a multi-Character Story segment, a romance relationship change, a cultivation state change, and an ST import/export round trip.

## Risks

The observer model adds domain complexity and does not provide security isolation. The product must keep GM, Character, player, and viewer semantics explicit. A single GM generation can become long or emit contradictory fact operations, so output budgets, envelope validation, fact IDs, and recoverable truncation are required. ST extension compatibility is intentionally incomplete in the first version; executable extensions must be ported as explicit dsh plugins. Exact context snapshots increase Session size, so compaction and projection storage must preserve replay while allowing derived indexes to be rebuilt. Automatic continuity updates can rewrite user-authored drama, so the Host must retain the original story and log every accepted or rejected operation.
