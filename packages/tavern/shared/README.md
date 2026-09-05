# `@deepseek-ai/dsh-tavern-shared`

English | [中文](README.zh.md)

Pure shared helpers for Tavern identifiers, labeled source text, JSON validation, and World Info character discovery. The package has no Cordis, persistence, model, filesystem, or UI dependency and performs no I/O.

## Interface

- `slug(value, fallback)` uses the Unicode letter/number rule `[^\p{L}\p{N}]`, lower-cases the result, and returns the explicit fallback for empty input.
- `parseLabeledLines(text, fallbackLabel)` parses non-empty `label: value` lines. It returns no fallback when `fallbackLabel` is omitted; when supplied, it emits one fallback row only if the source has no usable labeled line and both values are non-empty.
- `collectCharacterEntries(entries, fieldsForEntry)` identifies `Type: character` entries and returns their original entry plus the extracted `Name`. Optional normalized fields can override source lines without changing ownership of the entry.
- `parseJson`, `isRecord`, and `isJsonValue` provide one JSON parsing and validation implementation for Tavern consumers.
- `suggestedLabels` is frozen read-only guidance grouped into `character` and `world` labels. Consumers may display or prompt with it but must not treat it as a schema.

## Model Experience

### Shared helper data

#### What the model sees

Nothing directly. Consumers may include `suggestedLabels` in a normalization prompt; this package does not create model requests or prompt sections.

#### Token effect

Zero direct token effect. Any prompt cost from label suggestions belongs to the consuming normalization operation.

#### KV Cache effect

None. This package has no request or cache ownership.

## Known Limitations and Deferred Work

- `parseLabeledLines` recognizes one colon-separated label/value pair per line and does not parse arbitrary structured documents.
- `collectCharacterEntries` uses the exact normalized type value `character`; other World Info role conventions remain the responsibility of the compatibility parser or caller.
