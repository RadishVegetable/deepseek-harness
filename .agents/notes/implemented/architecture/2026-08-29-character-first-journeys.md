# Agent Note: Character-first journeys with attached World Books

Status: implemented

English | [中文](2026-08-29-character-first-journeys.zh.md)

## Problem

A Tavern Journey needs a person the player can meet before it needs a Lorebook the player can inspect. A World-first entry leaves the first interaction without a relationship anchor and makes authored setting material look like the product's main object.

## Decision

The Tavern browser starts Journey creation with a primary Character Card. The entrance previews its attached World Book, accepts additional standalone World Books as background context, and only enables Journey creation after a Character Card is selected. A World Book entry that describes a person is shown as a World Person for inspection, but does not create a Character Agent or a separate model call.

The Host normalizes an embedded `character_book` as a Character Card-owned World Info asset. It includes that asset in the selected prompt baseline and excludes it from the standalone World Info library. `selectForSession` records only selected asset IDs and player identity in the Session log; the runtime resolves the current source records when the Journey needs them. Source-library replacement or deletion therefore changes what an existing ID-based Journey can resolve; the source deletion rule is defined in [Tavern source asset lifecycle](2026-09-02-tavern-source-asset-lifecycle.md).

The active surface shows source fields and dynamic `label: value` fields in Character, World Book, and World Person details. `normalizeForSession` sends the detached selected baseline through the configured model when available, validates source references, and records accepted fields in `tavern/assets-normalized`; missing routes, model failures, and invalid output use deterministic source-field fallback. Journey facts are displayed with the corresponding World Book or person and can be edited or revoked through append-only Host events.

Journey History keeps cold Session rows visible even when one inspection fails, uses the latest assistant message for its preview, opens a recorded Journey selection directly, and archives a row through the existing registry archive operation when the player deletes it. The archive retains the Session log and workspace accounting slot.

## Alternatives considered

**Start from a World.** World-first entry emphasizes Lorebook breadth before the player has someone to meet. Attached World Books retain large-setting stories without making the World the Journey root.

**Make the World own the Character roster.** That would couple reusable Lorebook data to a particular cast. Character Cards can share a World while Journeys independently discover people.

**Allow arbitrary independent World and Character roots.** Independent roots weaken the authored relationship between a Character Card and its attached context and make the opening ambiguous. Additional World Books still provide deliberate expansion after the primary card is selected.

**Normalize assets during every player turn.** That would add a second model request to the one-call narrative path and make display preparation part of story generation. The explicit selection-time operation keeps the player turn at one main model call and records its result separately from the source asset.

## Consequences

Focused relationship stories and large setting stories use the same one-GM path. Shared source assets do not share transcript, Journey facts, branches, or active baseline content. The primary Character is a setup anchor and navigation target, not a current-speaker lock.

The current Host selection API still accepts a null character for compatibility with lower-level asset tests, while the player-facing Journey entrance requires a Character Card. Attached World Book matching remains source-tracked, and its richer position, recursive, sticky, cooldown, and selective semantics are deferred. Normalization is best-effort: a Journey remains usable with deterministic fields when no model route is available.

## Verification

Client tests cover character-first creation, World-only entrance behavior, attached Character Books, World Person details, and dynamic source fields. Host tests cover embedded Character Book projection, model and fallback normalization, and source selection resolution after source-library changes.
