# Agent Note: Tavern Journey memory system

Status: proposed

English | [中文](2026-09-02-tavern-journey-memory-system.zh.md)

## Problem

Tavern Journeys need a continuity fact view that can be rebuilt from the Session log and support background extraction, branch editing, prompt injection, retrieval, and compaction; a second mutable memory document would create a competing source of truth and leave fork visibility, revocation, and audit semantics ambiguous.

## Proposal

### Source and ownership

`tavern/fact` events are the append-only source of truth for Journey facts; fold views, retrieval indexes, cleaned asset views, and injection snapshots are derived data that can be rebuilt from the log. `@deepseek-ai/dsh-tavern-memory` provides pure parsing, ingestion, folding, indexing, injection, and compaction helpers, while Host owns model routing, Session integration, background jobs, and the optional read-only `fact_search` tool.

Facts retain `target`, `personId`, `subjectKey`, `authority`, `explicit`, provenance, and extraction-batch fields. `subjectKey` is an open two-level index key; when a key cannot be normalized, the natural-language fact remains without losing content. Folding and consolidation never rewrite fact text.

### Extraction lifecycle

Turn-end extraction runs in `ctx.jobs` in the background and does not block the next GM request; work is serialized per Session and concurrent across Sessions. The compaction path handles plot summaries, open threads, and relation-only cleanup evidence rather than duplicating atomic fact writes.

Structured output must pass whole-batch validation; malformed output is discarded without advancing the cursor. Ingestion is idempotent for `(sessionId, span)`, retains source events, extraction ids, and utterance turns, and advances the cursor only after appending observed facts. Missed facts can be re-extracted from log ranges; the log does not depend on the index.

### Fold and branch lifecycle

`projectMemoryFacts()` is the single fact view consumed by the UI, injection, and index builders. Facts with the same `subjectKey` use freshness-first ordering by source event sequence; a user fact or explicit observation cannot be silently suppressed by a later inferred observation, so protected disagreements remain conflicts. Superseded records stay in the log and audit index.

Fact visibility reuses the Session seed-prefix and current-branch rules. A fork does not delete parent-branch facts or move index rows; the child projects only inherited-prefix and child records. Historical edit, deletion, and regeneration use the owning fork/regenerate lifecycle, while a tail-only wording edit may retain in-place message editing and re-anchor extraction results.

### Prompt and retrieval

Injection is split into a stable persona section, historical checkpoints, and a dynamic Journey-fact section. Dynamic snapshots record the exact model-visible text, fact sequences, and fingerprint; fact changes rewrite only the dynamic section so the stable prefix remains reusable. `fact_search` is for long-tail verification, and prefetch or injection must not repeat facts already visible in the current request.

Asset import preserves the original JSON and produces a source-entry-tracked canonical view; a failed cleaner uses a deterministic fallback and marks it `uncleaned`. Static protagonist settings and dynamic Journey facts remain separate, while NPC and world entries use the existing activation and later retrieval policies.

### Configuration and integration

Extraction routes, windows, retained-tail size, edit window, injection limits, retrieval mode, and checkpoint budgets are validated configuration. Host rejects a retained-tail/edit-window violation at startup; deployment-varying thresholds must not be plugin constants.

The current capability keeps the GM `story` plus `updates` compatibility wire path; structured extraction, SQLite-derived storage, real embeddings, Tavern-specific compaction, and the complete memory panel are mounted incrementally. The current capability scope is recorded in [the Tavern Journey memory capability note](../../implemented/architecture/2026-09-03-tavern-journey-memory-capability.md).

## Alternatives considered

**Store a mutable Journey memory document:** rejected because it would compete with the Session log for fact ownership and require another fork, revocation, and persistence protocol.

**Have the GM write fact-update JSON directly:** rejected because it couples narrative output to fact extraction and lets format failure contaminate the main response; background structured extraction can reject and retry a whole batch.

**Implement all memory logic inside Host:** rejected because asset cleaning, folding, retrieval, injection, and compaction need shared pure data rules without depending on the full Remote service.

**Use a cross-Journey generic memory store:** rejected for v1 because Journey fact visibility and Session evidence belong to Tavern; cross-Journey user preferences belong to the separate dsh memory-plugin proposal.

## Acceptance criteria

1. `tavern/fact` is the only fact source, and folding, indexing, and injection snapshots are rebuildable from the log.
2. Turn-end extraction is serialized per Session and concurrent across Sessions; failed batches do not advance the cursor, and repeated spans do not duplicate writes.
3. `subjectKey` folding implements freshness-first ordering and preserves conflicts protected from inferred observations by user and explicit observations.
4. A fork projection contains only the seed prefix and current-branch records; parent-branch facts are neither deleted nor moved.
5. Model-visible dynamic memory text is recorded as Session events, with stable persona settings and dynamic facts rendered separately.
6. Original Tavern assets remain available, canonical views retain source tracking, and cleaner failure does not block import.
7. Variable thresholds are validated Config fields, and startup fails when the retained tail cannot cover the edit window.
8. A real composed snapshot eventually covers extraction, injection, branch editing, and compaction lifecycles; unsupported snapshot evidence remains an explicit implementation gap until those integrations ship.

## Risks

Background extraction can miss or misclassify facts, so the complete log, provenance, and retryable cursor must remain authoritative; an incorrect merge is harder to recover than a duplicate. Asynchronous updates can leave the next request briefly on the previous view, so consumers must accept eventual consistency. Separating stable prefixes and dynamic injection adds replay fields, and neither compaction nor a derived index may replace atomic events. The compatibility `updates` path leaves two production formats during migration; the eventual switch must preserve the event and fold rules.
