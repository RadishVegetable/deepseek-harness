# Agent Note: Tavern shared helper package

Status: implemented

English | [中文](2026-08-30-tavern-shared-helpers.zh.md)

## Problem

Tavern used separate slug, labeled-line, JSON, and World Info character-detection implementations across Host, Compat, State, and UI code. Their fallback rules and Unicode handling could diverge, making identifiers and person joins depend on the caller.

## Decision

`@deepseek-ai/dsh-tavern-shared` owns the pure helper implementations. `slug` uses the Unicode letter/number rule and an explicit caller fallback; `parseLabeledLines` returns only usable rows unless a fallback label is supplied; `collectCharacterEntries` combines source lines with optional normalized overrides while returning the original entry; `parseJson`, `isRecord`, and `isJsonValue` own JSON parsing and recursive validation; `suggestedLabels` is frozen guidance rather than a schema.

The package has no runtime dependencies and uses a structural invariant companion so Cordis is not imported into the pure helper source. Compat, State, Host, and UI use the package at their existing ownership points. State retains its `isJsonValue` export as a re-export for callers, while domain-specific JSON-object wrappers remain local.

## Alternatives considered

**Keep helpers in `dsh-tavern-context`:** rejected because Compat and UI need the vocabulary without depending on the context compiler, and the new package keeps the dependency direction explicit.

**Share only a JSON utility package:** rejected because slug, source-line parsing, and World Info character recognition have the same cross-surface consistency requirement and would leave the most important duplicated heuristics in place.

**Make normalized fields replace source lines:** rejected because source `Type` and `Name` must remain available when a normalized field set is partial; the shared collector merges by label and lets normalized values override matching source rows.

## Consequences

The same slug and character recognition rules now produce compatible person identifiers across Host and UI, and JSON validation no longer drifts between GM output, storage schemas, Compat, and State. Callers must choose domain-specific slug fallbacks explicitly, and consumers that need a source-text fallback must pass a `fallbackLabel`; the shared package does not infer either policy. The helper tests cover Unicode, empty inputs, partial normalized overrides, fenced JSON, invalid JSON values, and frozen label guidance. Full coverage remains governed by the repository coverage gate rather than this focused phase check.
