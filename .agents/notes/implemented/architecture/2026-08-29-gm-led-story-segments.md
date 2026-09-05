# Agent Note: GM-led story segments

Status: implemented

English | [中文](2026-08-29-gm-led-story-segments.zh.md)

## Problem

An interactive Tavern story is not a sequence of isolated character replies. A player input can require setting prose, several character actions, dialogue, and a new situation in one coherent continuation. Calling a model separately for each character repeats context, spends tokens on coordination, and incorrectly makes a Character appear to be the model's conversation partner.

## Decision

Tavern uses one GM narrative loop for every Journey. The model receives the selected Character Card baseline, attached and selected World Books, Journey history, and active Journey context. One player input produces one model generation and one assistant response; that response can contain narration, environment changes, and actions or dialogue for any visible Characters.

The GM response protocol contains complete `story` text and an optional `updates` envelope. `updates.people[personId]` and `updates.world` contain natural-language `add`, `replace`, and `remove` operations. The Host accepts JSON objects, fenced JSON, and ordinary free text; a response it cannot parse is retained in full as `story`. It persists the assistant response before applying updates and never calls a second model to extract facts.

Journey facts are append-only `tavern/fact` events projected into `people[personId]` and `world`. The Host allocates fact IDs for additions, validates person and fact targets, records rejected operations with the assistant sequence and turn, and uses a response fingerprint for retry idempotence. Replacements and removals append events without erasing the original operation. A Character Card is a Journey anchor and does not become a person unless a selected World Book explicitly identifies that person.

The active Journey reads its selected asset IDs from `tavern/assets-selected` and resolves the current source records when it builds context. Accepted fact events add Journey-local continuity without mutating the imported Character Card or World Book source. World Person display names resolve by the source-name-derived person ID and the latest `Name` fact, while labeled facts project into dynamic detail fields. Multiple Journeys can reference the same source records without sharing transcripts, facts, branches, or source-library edits. The browser displays a story segment as one response and provides no current-speaker lock or Character-specific send path.

## Alternatives considered

**Call the model once per Character.** Per-Character calls repeat the World, Journey, and Scene context and require a scheduler to decide ordering. One GM generation preserves causal order and avoids coordination calls.

**Call a planner and then a Character writer on every turn.** Two mandatory calls increase latency and can make a plan diverge from the prose. Planning remains an optional later capability with an explicit cost.

**Use a fixed relationship and state schema.** Fixed fields would force every story into a product vocabulary before the relevant distinctions are known. Natural-language facts preserve arbitrary story concepts while the operation envelope supplies durable mutation semantics.

**Mutate the imported Character Card or World Book.** Shared source mutation would leak one Journey's discoveries into another and destroy the authored source. Journey fact events keep source records reusable; source-library replacement remains an explicit library operation, and ID-based Journeys resolve the current record.

## Consequences

The common path has one model request per player input, complete assistant prose, automatic continuity updates, deterministic replay, and auditable rejection records. Prompt context can recall active person and world facts with the originating event sequence, while Prompt Inspector can trace the selected baseline and activation record.

The fact vocabulary stays intentionally small and does not model relationship, inventory, health, or similar fields. The current UI displays model- or fallback-normalized source fields, overlays Journey facts as dynamic fields, lets players edit or revoke existing facts, and exposes the latest request input and assistant text through Prompt Inspector. Block-level attribution, repeat normalization after authored asset edits, and richer Journey-local authored asset editing remain deferred.

## Verification

Host tests cover structured and free-text parsing, one generation per input, accepted person and world updates, malformed and unauthorized operations, replacement and revocation, audit retention, retry and reload idempotence, branch isolation, source immutability, and next-request recall. Client tests cover World Person and World Book details plus fact edit and revoke controls.
