# @deepseek-ai/dsh-tavern-memory

English | [中文](README.zh.md)

Append-only memory capability for Tavern Journeys. The session log remains the source of truth for facts; folding, retrieval indexes, cleaned asset views, and injection snapshots are derived and can be rebuilt.

## Interface

`parseMemoryExtractionOutput()` validates one complete structured model response. Fenced JSON and plain JSON are accepted; malformed batches return `undefined`, allowing the owner to retry without advancing its cursor.

`parseMemorySummaryOutput()` validates the compaction response separately. It accepts only a plot summary, status-bearing open threads, and relation-only atom cleanup decisions; it cannot introduce replacement fact text.

`ingestMemoryExtraction()` validates person targets, normalizes compatible structure keys, skips duplicate values, appends observed events for add/replace/remove operations, and returns a monotonic span cursor. The operation is idempotent for `(sessionId, span)` and never mutates its input records.

`MemoryExtractionScheduler` serializes queued extraction work per session while allowing different Journeys to run concurrently. `createMemoryExtractionId()` and `memoryExtractionIdempotencyKey()` provide stable span identities for retries and reload recovery.

`projectMemoryFacts()` is the single deterministic view fold for people and world facts. A structure key identifies one entity dimension; the latest value wins except that a user value or an explicit observation cannot be silently suppressed by a later inferred observation. Such disagreements remain visible as conflicts. `MemoryIndex` is a disposable brute-force derived index and keeps superseded rows as inactive audit data.

`renderMemoryInjection()` produces the stable persona section and dynamic Journey section, with current fact provenance, open threads, and optional prefetch results. `appendMemoryInjectionSnapshot()` records the exact model-visible text as a `tavern/memory-context` session event.

`cleanTavernAsset()` supplies a source-tracked deterministic fallback for Character Cards and World Books. Its `uncleaned` flag is explicit so a model-backed cleaner can replace the view without discarding source JSON.

`resolveMemoryConfig()` validates extraction, compaction, editing, injection, and retrieval policy. In particular, the retained tail must cover the editable window plus its configured margin, and checkpoint output is checked against its token budget.

## Model Experience

### Memory injection

#### What the model sees

The owning runtime may place `staticText` in the reusable system-prefix region and `dynamicText` at the end of the request. The dynamic section contains only the folded current values and their provenance; the package does not duplicate checkpoint history or choose a message role.

#### Token effect

Extraction and retrieval add model calls only when an owning provider invokes them. Injection consumes the rendered text budget supplied by the caller; compaction rejects a checkpoint that exceeds its configured token limit.

#### KV Cache effect

The static and dynamic sections are separate. A changed fact changes the durable dynamic snapshot while leaving the persona prefix unchanged, so consumers can preserve the reusable prefix.

## Known Limitations and Deferred Work

- The Host mounts turn-end scheduling, provider routing, the optional `fact_search` tool, asset cleaning, and Tavern-specific compaction. `SqliteFactIndex` provides persistent derived index storage, and `DeterministicEmbeddingProvider` provides the local deterministic embedding fallback.
- External embedding providers, ANN storage, vector pooling, cross-Journey preference memory, and a generic dsh memory capability are deferred.
- Asset cleaning preserves the original source JSON: `cleanTavernAsset()` provides the deterministic fallback, and the Host can replace it with a validated model-produced canonical view.
