# Agent Note: dsh Tavern architecture for context, memory, and roleplay composition

Status: proposed

English | [中文](2026-08-24-dsh-tavern-architecture.zh.md)

## Problem

SillyTavern is a useful compatibility target for character cards and World Info, but its runtime reduces authored setting, generated memory, and chat history to one mutable prompt assembly. It has no durable knowledge view per character, no authoritative structured story state, and no event-backed replay of retrieval decisions. Long chats therefore repeat facts, lose facts, expose private knowledge, and spend input tokens on content that is not relevant to the current turn.

The target product must support both direct conversation with one character and GM-led scenes in which several characters act inside one narrative. It must preserve SillyTavern asset compatibility, run as a TypeScript dsh composition in Docker, expose a usable Web UI, and show the exact context sent to each model call while keeping model-visible content reconstructable from the dsh Session log.

## Proposal

Build an optional dsh Tavern composition. The composition reuses dsh Session, prompt, LLM, compaction, Web, and branching capabilities, and adds Tavern-specific asset, story-state, memory, context, orchestration, and continuity plugins. A Tavern profile composes only the plugins required by the selected interaction mode and assets. It does not replace dsh core or embed SillyTavern's JavaScript runtime.

The existing [Tavern roleplay surface proposal](../feature/2026-08-24-tavern-roleplay-surface.md) remains the feature-level UI and swipe proposal. This note owns the cross-cutting architecture and the knowledge model that proposal depends on.

### Composition and modes

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

The profile exposes three execution modes:

- `direct`: one active character answers the user's turn with one main model call. Memory extraction and vector indexing are asynchronous.
- `single-scene`: one character remains the main actor, but a planner is invoked for scene transitions, time jumps, major state changes, or hidden-plot control.
- `ensemble`: a GM planner produces structured scene beats and only active actors receive independent character-context calls. Actors with different private knowledge are never generated from one prompt that contains all of their secrets.

`direct` is the default. The planner is `on-demand`, not an unconditional extra call. A profile may enable or disable each capability explicitly; selecting a character card or World Info asset selects data and defaults, but does not silently grant unrelated tools such as shell, web, filesystem, skill, or subagent access.

### Domain model

The product keeps five different kinds of information separate:

- **Asset**: author-controlled input such as a Character Card, Character Book, World Info entry, preset, or imported PNG.
- **Canon**: a user- or GM-authorized story assertion. Canon is not the same as a model-generated memory.
- **Story state**: structured current values such as location, time, inventory, cultivation realm, health, relationship phase, or active oath.
- **Knowledge view**: the facts an observer may use, including belief, rumor, inference, and false belief.
- **Memory**: a source-tracked projection of events at L1, L2, or L3. Memory is not the source of truth; the Session event log is.

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

The character card is the authored baseline. L3 is the character's evolving long-term cognition. Relationship state, inventory, location, health, cultivation, time, and other mechanically constrained values are separate projections because vector retrieval cannot reliably enforce their current value.

### Story events and model visibility

The Session event log is the only authoritative source. Tavern contributes declaration-merged event types for asset selection, scene commands and plans, public or private scene beats, state changes, knowledge acquisition, memory candidates, context decisions, and continuity decisions. Exact event names and payload types are owned by the package that declares them and are required-on-read when they affect reconstruction.

Every model request uses the existing dsh request/header and request/context persistence path. The compiled context snapshot records the exact rendered model-visible sections, source ids, compiler policy version, observer id, budget ledger, and selected or filtered candidates. A retrieval index or current database row is never required to replay a historical model request.

Generated memory is first a candidate with source event ids and authority metadata. A user or GM can promote, correct, invalidate, or pin it. A correction creates a new event and closes the old assertion's validity; it does not erase the old belief, because the old belief can explain later dramatic behavior.

Branching is part of the event model. Swipe, regenerate, and historical edit create or replace a Session branch at a stable turn boundary. L1-L3 and structured state are projected from the selected branch, so a discarded branch cannot contaminate the active story.

### Context compilation and retrieval

The context compiler produces a separate view for the GM, each character, and the public narrator. It packs context in this order:

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

Retrieval always filters before semantic ranking:

```text
observer and visibility filter
  -> validity and branch filter
  -> structured state lookup
  -> keyword or FTS candidate lookup
  -> vector retrieval when needed
  -> rerank and deduplicate
  -> token-budget packing
```

World Info activation keeps deterministic SillyTavern rules such as keys, secondary keys, whole-word matching, recursion, depth, groups, probability, sticky entries, cooldowns, and insertion position. Vector search may expand candidate recall, but it never bypasses those visibility and validity checks and never promotes a candidate to canon.

The compiler owns one token ledger for stable assets, public state, observer memory, recent events, and output reservation. It does not copy the full transcript or full World Info collection into every request. Stable prefixes are cacheable by asset version, observer id, memory projection version, compiler policy version, and tool schema version. Dynamic retrieval remains after the stable prefix so it does not invalidate the reusable prefix.

In ensemble mode the planner may read the complete GM view, but each actor call receives only that actor's beat and knowledge view. Actors with identical visibility and no private state may be grouped for a cost-saving fast path; this path is not used when their contexts differ. The default cost control is active-actor selection, compact state projections, asynchronous extraction, and on-demand planning, not a single prompt containing hidden information for every actor.

### SillyTavern compatibility

The compatibility layer accepts and exports Character Card V1 and V2 JSON, PNG-embedded cards, V2 `character_book`, and standalone World Info JSON. It preserves unknown fields, original entry order, source text, keys, secondary keys, insertion positions, depth, recursion, group behavior, probability, sticky and cooldown settings, and extension data needed for round trips.

The importer stores the original asset and produces a native normalized asset. The native model may represent a graph or tree of entities and relations, but the importer retains the original flat World Info entries so export remains compatible. Static assets are not silently converted into L3 memory.

Arbitrary SillyTavern JavaScript extensions, regex scripts, remote service hooks, and UI-specific behavior are preserved as unsupported extension data in the first version; they are not executed inside the dsh process. Unsupported required fields fail loudly at import, while unknown non-executable metadata remains available for export.

### UI, Docker, and observability

The Web composition provides chat, character and World Info asset management, scene controls, memory inspection, story-state inspection, branch and swipe controls, and a Prompt Inspector. The inspector shows the GM or character observer, exact rendered sections, token ledger, cache key, retrieved candidates, filtered candidates with reasons, source events, and continuity warnings. It must distinguish model-visible context from diagnostic data that was not sent to the model.

The Docker image builds the TypeScript workspace and serves the selected profile on a configurable container bind address. The profile must explicitly opt into container binding and must not depend on a development-only host override. Persistent storage includes Session logs, imported assets, projections, and indexes; vector storage is optional and can be rebuilt from source events.

### Security and failure behavior

Card, World Info, memory, and model output are data, not system instructions. The compiler places them in declared prompt sections and does not allow imported text to change system policy or grant tools. Tool composition is explicit in the profile.

Misconfiguration and invalid durable data fail loudly. Runtime degradation is explicit: an unavailable vector provider falls back to structured and FTS retrieval; a missing memory result does not invent one; an over-budget request follows its configured priority policy; a failed actor call can produce a GM-marked fallback or stop the scene according to profile policy. A continuity warning is logged before any automatic repair or retry.

### Package ownership

The first package topology is:

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

Pure parsing and rendering helpers remain ordinary TypeScript modules. A capability with a replaceable backend has a Service Definition, a Provider, and Consumers. The first implementation uses a local durable provider and FTS; vector and external-memory providers are optional capability providers, not requirements of the domain model.

## Alternatives considered

**Extend SillyTavern in place.** This keeps the existing UI but leaves the mutable prompt pipeline, split completion paths, and branch semantics as the ownership center. It loses the dsh event log, prompt reconstruction, and plugin composition that are required to make memory and visibility reliable.

**Build one standalone replacement service.** This would duplicate dsh Session persistence, prompt assembly, Web streaming, branching, and capability policy. The product needs a dsh composition, not a second agent runtime.

**Use one global memory store and instruct the model to respect character knowledge.** A model-visible prompt containing every secret is not soft isolation. Separate observer projections and pre-retrieval filtering are required for reliable narrative knowledge asymmetry.

**Use vector RAG as the story database.** Similarity search cannot enforce current location, inventory, death, cultivation realm, relationship state, branch validity, or authority. Structured projections and source events own those values; RAG only recalls candidate text.

**Always call a GM planner before every response.** This increases token use and latency for direct romance or cultivation conversations without improving a one-actor turn. Planner use is on-demand, and ensemble scenes pay for independent actor calls only when their knowledge views differ.

**Create one prompt containing all actor instructions and private memories.** This is cheaper in request count but exposes private context to the same model attention and cannot guarantee actor-level knowledge separation. It remains available only for actors with identical visibility and no private data.

## Acceptance criteria

1. A dsh Tavern profile composes from existing dsh packages and boots a Docker Web surface with an explicit configurable bind address.
2. Direct mode generates a one-character turn without an unconditional planner call, while scene and ensemble triggers invoke the planner according to the selected policy.
3. The same imported Character Card V1/V2 or World Info asset round-trips without losing supported fields or unknown metadata.
4. A character request cannot retrieve a memory whose observer, visibility, branch, validity, or authority excludes that character.
5. A public event becomes available to later actors in the same scene only after it is logged; private thoughts and GM-only plans remain excluded from other actor views.
6. Canon, belief, rumor, inference, and false belief remain distinguishable and retain source events through correction and branch projection.
7. Location, inventory, health, relationship, and cultivation state are validated as structured projections rather than inferred solely from vector results.
8. Prompt Inspector can replay the exact model-visible context and show token, retrieval, cache, and continuity decisions.
9. Swipe, regenerate, and historical edit project memory and story state from the selected branch without downstream contamination.
10. Keyless runnable examples and snapshots cover direct conversation, a romance relationship change, a cultivation state change, a secret known by one actor, and an ST import/export round trip.

## Risks

The observer model adds domain complexity and does not provide security isolation. The product must keep GM, character, narrator, and viewer semantics explicit. Multiple independent actor calls increase latency and output cost; active-actor selection, prefix caching, compact projections, and on-demand planning are required defaults. ST extension compatibility is intentionally incomplete in the first version; executable extensions must be ported as explicit dsh plugins. Exact context snapshots increase Session size, so compaction and projection storage must preserve replay while allowing derived indexes to be rebuilt. Automatic continuity repair can rewrite user-authored drama, so warnings and retries are preferred until a profile explicitly enables repair.
