# Agent Note: Stage Tavern from ordinary chat to a narrative runtime

Status: implemented

English | [中文](2026-08-29-tavern-staged-delivery.zh.md)

## Problem

Tavern needs a usable character-first roleplay loop without allowing later continuity features to mutate shared assets or introduce per-Character model calls. A staged design must still define the ownership and replay rules before automatic Journey updates become user-visible.

## Decision

Tavern uses the existing durable Session as its Journey store. The player-facing surface starts from a primary Character Card, shows attached or selected World Books as supporting context, and uses the shared conversation composer. `selectForSession` records selected asset IDs before they can affect later prompts; the runtime resolves those IDs through the current source library.

The shipped continuity layer stores natural-language facts under `people[personId]` and `world`. One GM response contains complete `story` text and optional `updates` operations. The Host persists the assistant response first, appends accepted or rejected `tavern/fact` records, projects active facts into later prompts, and keeps the raw response recoverable. User controls can correct or revoke existing facts but do not create them manually.

The browser surface keeps source-library authoring separate from an active Journey. Editing a reusable source affects future selections; it does not append a new baseline to the active Journey. World Book and World Person details combine model- or fallback-normalized source fields with Journey facts. The normalization result is a separate `tavern/assets-normalized` event and never changes the imported source.

The runtime keeps the one-call GM rule and does not create a planner, Character-specific Agent, or speaker-selection loop for the ordinary path. Each extension must identify its user-visible problem, durable events, model/storage cost, and replay behavior before becoming a default dependency.

## Alternatives considered

**Build the full structured domain model first.** Requiring relationship, inventory, and other schemas before real stories prove their value would constrain the product prematurely. Natural-language Journey facts provide continuity with a smaller durable vocabulary.

**Keep separate character-chat and world-story modes.** Separate modes would duplicate entry, transcript, and continuation semantics. Attached World Books let a character-first Journey support both focused relationships and large settings.

**Keep mutable state only in the browser.** Browser state cannot reconstruct a prompt after reload or support Session branches. Append-only Session events give the Host one replayable owner.

## Consequences

The first product path remains one durable chat flow, while source selection, fact events, context activation, and UI projections have explicit owners. Imported sources remain reusable and Journey facts stay isolated between Sessions and branch prefixes.

The system does not yet provide repeat normalization after authored Character Card or World Book edits, rich Journey-local editing of authored documents, complete World Info execution, observer-specific retrieval, or true multi-agent group chat. These capabilities require additional event vocabulary and cost decisions before they can alter the default path.

## Verification

Focused Host and client tests cover source selection, fact replay and recall, malformed update handling, branch and Journey isolation, one generation per player input, and Journey fact corrections. Documentation and persistence catalogs include the fact event and Remote vocabulary.
