# Agent Note: Tavern Journey memory capability seam

Status: implemented

English | [中文](2026-09-03-tavern-journey-memory-capability.zh.md)

## Problem

Tavern Journey continuity needs one replayable fact view that supports extraction, asset bootstrap and cleaning, conflict handling, bounded prompt injection, retrieval, and narrative compaction without creating a second session-scoped memory document.

## Decision

`@deepseek-ai/dsh-tavern-memory` owns the pure Journey memory capability. `tavern/fact` records are the append-only source of truth; `projectMemoryFacts` folds visible records by target, person, and optional `subjectKey`, retaining protected disagreements as conflicts. View-local `subjectKey` aliases are normalized and validated for subject-domain ownership, conflicting mappings, and cycles before they affect folding, retrieval, or injection. Fact folds, injection snapshots, retrieval data, cleaned asset views, and compaction summaries are derived and rebuildable from source records.

The strict extraction parser accepts only the fixed atom vocabulary and rejects a malformed complete batch. The ingestion writer uses `(sessionId, span)` idempotency, validates person and subject-key ownership, retains extraction provenance, and appends observed events without mutating prior records. `MemoryExtractionScheduler` serializes queued work per Session while allowing different Sessions to run concurrently. Host schedules turn-end extraction when `ctx.jobs` is available, logs its start, completion, or failure with the exact prompt and output, and exposes the optional read-only `fact_search` tool when `ctx.tools` is available.

Memory injection separates stable persona text from dynamic Journey text, removes facts already present in the request context before applying the validated `activePeople`, `activeFacts`, and `prefetchTopK` caps, and accepts view-local subject-key aliases. `MemoryIndex` is a disposable in-memory brute-force index that combines lexical and cosine signals. `SqliteFactIndex` provides a version-stamped SQLite-backed provider for rebuildable fact-index queries. `EmbeddingProvider` is injectable, and `DeterministicEmbeddingProvider` supplies the offline local default; neither derived provider replaces the Session log.

`cleanTavernAsset` provides a deterministic, source-tracked fallback for Character Cards and World Books. Host can replace that view with a validated model result and exposes preview and confirmation while retaining the original source JSON. The summary parser accepts plot text, status-bearing open threads, and relation-only atom cleanup evidence; it cannot create replacement fact text. When compaction is enabled and no other provider is mounted, Host mounts `TavernCompactionEngine`, whose automatic range selection uses complete turns, whose checkpoint is bounded by configuration, and whose cleanup decisions are appended beside the existing compaction lifecycle. `inspectMemory()` reconstructs checkpoints only from complete summary and matching checkpoint-source `user/message` records, and returns an empty checkpoint list for missing or incomplete pairs.

The live GM instruction requests plain prose, while the `story` plus `updates` response path remains available for compatibility and replay. The independent turn-end extractor observes prose without blocking the next turn, so this capability does not silently replace the existing GM wire protocol. The client mounts a memory panel with State, Plot, and Audit views, source-cleaning preview and confirmation, fact edit and removal, conflict resolution, and impact confirmation before projection-changing mutations. The broader staged-runtime decisions remain in [the Tavern staged-delivery note](2026-08-29-tavern-staged-delivery.md) and [the GM-led story note](2026-08-29-gm-led-story-segments.md); this note extends their append-only fact foundation and records the delivered memory capability.

## Alternatives considered

**Store a mutable Journey memory document:** rejected because it would create a second authority, make fork visibility ambiguous, and require a separate rollback protocol. The fold is derived from the Session log instead.

**Keep extraction and folding inside Host:** rejected because asset cleaning, retrieval, prompt rendering, and compaction consumers need the same pure vocabulary without importing the full Remote service.

**Replace the GM `updates` wire protocol immediately:** not selected because the current Host Remote and replay fixtures consume that protocol. The memory capability accepts the structured extraction format independently, so later protocol work can preserve the event and fold rules without duplicating them.

## Consequences

The fact view has deterministic freshness behavior, protected user and explicit observations, branch-safe replay, source provenance, view-local aliasing, bounded injection, hybrid retrieval, and a disposable SQLite or in-memory index. Invalid model output can be retried without advancing a cursor, derived rows do not become an independent source of truth, and Host compaction keeps checkpoint text separate from atomic facts.

Host owns model routing, persistence integration, background extraction scheduling, the optional `fact_search` tool, source-preserving cleaning, and the native Tavern compaction provider. The Host `fact_search` path builds a disposable `MemoryIndex`; `SqliteFactIndex` and the embedding provider are replaceable derived providers rather than the default Session runtime store. The client consumes the Host projections and checkpoint Remote while keeping capability failures visible.

Asynchronous extraction can leave the next request briefly on the previous projection, but the exact lifecycle records, idempotency key, cursor, and append-only fact stream keep retries and replay deterministic. `inspectMemory()` rejects transcript lookalikes instead of treating ordinary conversation text as a checkpoint, and the State, Plot, and Audit views expose the corresponding projection, checkpoint, and event evidence without creating another memory document.

## Testing

Memory tests cover subject-key normalization and aliases, strict whole-batch extraction parsing, idempotent ingestion, freshness conflicts, unkeyed replacement, branch seed visibility, active and audit retrieval rows, lexical-plus-cosine ranking, injection caps and current-context exclusion, deterministic embeddings, versioned SQLite persistence, relation-only summary parsing, serial extraction scheduling, and deterministic asset cleaning.

Host tests cover turn-end extraction lifecycle, model-visible memory context, fact fields and projection, `inspectMemory()` checkpoint pairing, safe compaction range selection, tool-pair handling, and the complete Host compaction lifecycle. Client tests cover the State, Plot, and Audit panel views, real checkpoint fields, cleaning confirmation, fact edit and removal, conflict resolution, and impact confirmation.

The assembled keyless Loader snapshot covers Tavern selection, background extraction, durable memory-context injection, native compaction, persisted lifecycle records, and post-compaction continuation through the real application composition. The Host aggregate typecheck and the focused memory and compaction tests cover the package and Host integration paths used by that snapshot.

## Coverage gaps

A generic cross-Journey `dsh` memory plugin is not implemented; this capability is Journey-local and does not provide user- or project-level preference memory.

External or network embedding providers, ANN storage, vector pooling, and larger-scale vector indexing are not implemented. The injectable `EmbeddingProvider`, deterministic local provider, brute-force `MemoryIndex`, and SQLite-derived provider define replacement points without claiming those services.

Story State exposes canonical location and time changes, but scene orchestration and group chat are not implemented. World Info retains `sticky` and `cooldown` metadata in the prompt baseline and activation ledger, but the runtime does not persist their timers.

Fact-specific compaction and richer multi-entry organization are not implemented; Tavern compaction summarizes narrative checkpoints and relation-only cleanup while atomic facts remain append-only.

Compressed Character Card metadata and executable SillyTavern extensions are not supported.

The keyless Loader snapshot covers extraction, injection, compaction, and post-compaction continuation, but it does not combine reload and fork recovery in one scenario, and no assembled browser transcript covers the client memory panel. Package, Host, and client tests cover those components separately.
