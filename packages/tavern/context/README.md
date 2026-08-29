# @deepseek-ai/dsh-tavern-context

English | [中文](README.zh.md)

Pure observer-aware context compilation for Tavern sessions. The package has no Cordis, parser, persistence, model, or filesystem dependency.

## Interface

`compileContext()` accepts normalized source records, the current observer and branch, optional normalized World Info entries, and explicit character/token budgets. It filters in this order: observer scope, visibility, authority, branch, and validity. Eligible World Info entries are then matched, gated by a caller-supplied deterministic probability roll, reduced to one winner per group, and deterministically ordered, deduplicated by `source.key`, and packed with first-fit budget checks. Depth, sticky, and cooldown values remain attached to the normalized entries for a stateful owner; this pure package does not maintain those timers.

`matchWorldInfo()` is the parser seam. Callers provide normalized entries with primary and secondary keys; this package performs case-insensitive NFKC normalization and whole-word matching. Primary matches sort before secondary matches, then match count, priority, and deterministic source key.

The result contains `stablePrefix` and `dynamicSuffix` source records. Their text is the model-visible content; provenance remains attached to each record. The `ledger` records every rejection and inclusion, including observer, visibility, authority, branch, validity, no-match, duplicate, and budget reasons. A supplied token estimator is required for a token limit and is also used in the returned usage and ledger entries.

## Model Experience

### Context records

#### What the model sees

The concatenated text of `stablePrefix` followed by `dynamicSuffix`, in the returned order. This package does not choose a message role or serialize metadata; an owning consumer renders the selected records.

#### Token effect

Selected source text consumes the caller's character and token budgets. The compiler does not estimate tokens unless a caller supplies `tokenEstimator`.

#### KV Cache effect

Stable records are returned separately so a consumer can keep them in a reusable request prefix. Dynamic records are returned after them and can change without changing the stable record order.

## Known Limitations and Deferred Work

- World Info parsing, recursion, persistence, and activation event writing are owned by later packages. This compiler applies explicit probability and group selection, but it does not maintain recursive scans or sticky/cooldown timers.
- Whole-word matching treats letters, numbers, and underscore as word characters; locale-specific tokenization is outside this pure matcher.
- Budget packing is deterministic first-fit. It skips an over-budget record so a later smaller record can still be selected.
