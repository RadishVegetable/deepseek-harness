# dsh-tavern-compat

English | [中文](README.zh.md)

`@deepseek-ai/dsh-tavern-compat` is a dependency-free parser and matcher for Tavern Character Cards and World Info. It has no Cordis runtime dependency and returns plain normalized data for later Tavern adapters.

## Parsing

`parseCharacterCard(input)` accepts a JSON string or JSON object for `chara_card_v2` and `chara_card_v3`. It reads fields from `data` first and falls back to the top level, so cards exported in either form work. The result normalizes common names such as `first_mes` to `firstMessage`, parses an embedded `character_book`, and retains the parsed input in `raw`. Unknown top-level and data fields are retained in `unknown` and `dataUnknown`; `rawJson` retains the exact input text when the caller supplied a string.

`parseCharacterCardPng(input)` extracts the Base64 JSON in a Character Card PNG `chara` metadata chunk and passes it through the same normalizer. Uncompressed `tEXt` and `iTXt` chunks are supported; compressed metadata is rejected explicitly. The parser reads metadata only and never retains PNG image bytes.

`parseWorldInfo(input)` accepts standalone World Info/YMLv2 data. Both numeric-key entry objects and entry arrays are accepted. Document controls such as `scan_depth`, `token_budget`, and `recursive_scanning` are retained, and entry controls such as `key`/`keys`, `keysecondary`/`secondary_keys`, `disable`/`enabled`, `use_regex`/`useRegex`, `order`/`insertion_order`, probability, depth, groups, sticky activation, and cooldown are normalized. Entry and document unknown fields remain available beside their `raw` values.

Malformed JSON, object fields with the wrong type, and unsupported Character Card specs throw descriptive errors. No input object is mutated.

## Matching

`matchesWorldInfoEntry(entry, text)` handles disabled, constant, selective, substring, whole-word, case-sensitive, and regular-expression entries. Selective entries require a primary key and, when configured, at least one secondary key. Empty keys never match. Invalid regular expressions throw a `SyntaxError` instead of being ignored.

`selectWorldInfoEntries(entries, text)` filters matching entries and orders them by ascending `insertionOrder`. Probability is never random: entries with `useProbability=false` are not gated, 0% and 100% are deterministic, and intermediate probabilities require a caller-provided `probabilityRoll` in `[0, 100)`.

## Model Experience

### Request context and condition

#### What the model sees

This package only parses and matches data; a later Tavern context compiler such as `compileContext()` decides which normalized fields enter a model request.

#### Token effect

Zero direct token effect.

#### KV Cache effect

None; this package does not create or modify model requests.

## Known Limitations and Deferred Work

- **No compressed PNG metadata** - compressed `zTXt`/`iTXt` Character Card chunks require a runtime-specific decompressor before parsing.
- **No recursive World Info scan** - this package evaluates one supplied text and does not implement recursion, depth budgets, groups, or persistence timers.
- **No probability source** - callers must provide a deterministic roll when an entry has an intermediate probability.
