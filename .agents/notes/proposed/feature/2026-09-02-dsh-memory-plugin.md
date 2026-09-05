# Agent Note: dsh memory plugin

Status: proposed

English | [中文](2026-09-02-dsh-memory-plugin.zh.md)

## Problem

dsh needs to retain user- or project-level facts, preferences, instructions, and tasks asynchronously without changing the append-only Session log or model-request reconstruction semantics, then provide traceable profiles and recall in later Sessions. A mutable memory summary would lose provenance, branch, and revocation information.

## Proposal

### Capability roles

The memory capability consists of a Service Definition, Providers, and Consumers. The Service Definition owns the vocabulary for atomic memories, patches, provenance, and folding; Providers own append-only storage and replaceable retrieval; Consumers own profile injection and the optional `memory_search` tool. The extractor makes one structured LLM request and does not need a subagent; background scheduling uses `ctx.jobs` or idle maintenance.

Memory ownership has two orthogonal axes: `user` and `project`. User ownership uses `dsh-identity`, and project ownership uses the working directory; when ownership cannot be determined it must be explicit degradation or rejection, never a silent global write.

### Atomic data and profile folding

Atomic memories are append-only records with `type`, `subjectKey`, natural-language content, owner, `grade`, scope, utterance time, and provenance. A profile is a deterministic fold of patches, not a mutable result document; a user-authored profile is also a time-stamped assertion in the same fold.

Within one subject, freshness-first ordering uses the source event's utterance time. `user-explicit` cannot be automatically replaced by a newer `ai-inferred` value; other conflicts may use the newest assertion. Superseded, duplicate, and revoked atoms remain available, with relations and tombstones making the current view rebuildable.

A scene summary is an optional view, not a required promotion layer. It cites atomic sources and provides narrative continuity; profile promotion requires independent evidence and an explicit patch and cannot recursively generate from the previous summary.

### Extraction lifecycle

The extractor shares a cursor and `(sessionId, span)` idempotency key and reads durable log ranges when compaction, Session idle/close, or a backlog threshold triggers it. Compaction handles history that will be replaced or hidden, idle handles an uncovered tail, and neither trigger runs in the pre-step hot path.

Each batch reads source text from the log, makes one structured LLM call, then looks up matching subjects and appends new atoms, duplicate-of relations, or supersede relations before advancing the cursor. Invalid model output rejects the whole batch, and re-extraction does not depend on a previous profile or summary.

### Injection and retrieval

Stable profiles belong in `ctx.systemPrompt.section()` for a reusable system prefix; faster-changing atoms and scene views belong in `ctx.systemPrompt.context()` after retained history; low-frequency notices use `agent.inject()`. Model-visible content from all three mounts must be reconstructable through Session events.

The retrieval Provider filters by owner, scope, branch, and validity before applying keyword, embedding, and time or heat ranking. V1 may use application-level brute-force retrieval; each vector pins an `embeddingModel`, and changing the model requires an explicit re-embedding pass. Injection carries must-know profile facts, while `memory_search` handles long-tail verification and skips facts already present in the current context.

### Revocation, compaction, and configuration

Memory revocation appends a tombstone instead of physically deleting data. Message revocation remains dsh fork semantics: child ancestry and provenance identify affected atoms, and folding excludes them. A provider request already sent to a model cannot be recalled; retained logs are not model-visible in a new branch by themselves.

Thresholds, top-k values, embedding models, compaction triggers, and profile budgets are validated Config fields; cross-boundary memory, extraction, and patch ids use `Branded<B>`. Extraction and consolidation must prove provenance continuity, rebuildable indexes, and Model-visible ⟺ logged; SDK projections change only when the implementation actually affects them.

## Alternatives considered

**Store one mutable profile file:** rejected because updates would erase provenance, conflicts, and revocation evidence; patch folding provides the same current view while retaining atomic records.

**Put all memories in the system prompt on every request:** rejected because it wastes tokens, breaks prefix caching, and delegates conflict resolution to the model; stable profiles and on-demand recall should be separate.

**Introduce a vector database first:** rejected because personal and project memory fits application-level retrieval, and a Provider seam can replace the implementation when scale changes.

**Use a subagent for extraction:** rejected for v1 because the input is a recorded transcript range and one structured call is sufficient; tool-assisted extraction can later extend the Provider/Consumer relationship.

**Put all memory implementation in Tavern:** rejected because user and project memory spans Tavern; ownership, identity, and injection mounts belong to a general dsh capability.

## Acceptance criteria

1. Service Definition, Provider, profile Consumer, and optional retrieval Consumer responsibilities can be replaced independently.
2. Atomic, patch, relation, and revocation records carry provenance and are rebuildable from the Session or an explicitly owned durable source.
3. The freshness-first fold protects explicit user assertions and does not hand unresolved contradictions to the model for ad hoc arbitration.
4. Compaction, idle, and backlog triggers share cursor and idempotent ingestion, and an invalid batch does not advance the cursor.
5. Model-visible content from system prompt, PromptContext, and inject has a corresponding log event, and retrieval cannot bypass owner or scope filters.
6. V1 does not require a vector database or subagent, and replacing the retrieval Provider does not change Consumer interfaces.
7. A keyless runnable snapshot eventually proves profile injection, long-tail recall, reload, and fork revocation; pre-implementation evidence gaps remain explicit.

## Risks

Asynchronous distillation can miss, misclassify, or complete out of order, so assertions must sort by utterance time and retain original provenance. Recursive consumption of derived profiles or summaries can drift, so generation must be bounded by evidence and one-generation loss. Injection is model-visible data, and any unlogged source breaks replay. Cross-machine identity, subagent ownership, budget truncation, and executable revocation remain later decisions and must not be replaced by hidden global defaults.
