# @deepseek-ai/dsh-tavern-assets

English | [Chinese](README.zh.md)

Serializable Tavern resource data for character cards and World Books. The package owns normalized asset records, a process-local registry, selection validation, and a prompt-asset baseline projection. It does not parse JSON or PNG files.

## Interface

- `CharacterAsset` stores normalized character fields, an opaque source payload, source references, and preserved extension data.
- `WorldInfoAsset` stores normalized World Book entries, an opaque source payload, source references, and preserved extension data.
- `AssetVersion` identifies the source format and normalized revision.
- `AssetSelection` stores one character ID and ordered World Book IDs.
- `AssetRegistry` registers both asset kinds, rejects duplicate IDs and blank names, lists detached snapshots, and resolves selections.
- `projectPromptAssetBaseline` turns resolved assets into source-tracked character sections and World Book activation candidates.

The compatibility parser remains a separate package. When `@deepseek-ai/dsh-tavern-compat` is available, it can populate these types without making the registry depend on parser behavior. Until then, `sourceData` and `sourceReferences` provide the preservation fields needed by an adapter.

Registration is process-local. `register()` returns a disposer, and reads return detached JSON-compatible values, so callers cannot mutate a registry snapshot through a returned object.

## Model Experience

### Asset context

#### What the model sees

Nothing directly. This package is host-side resource data and does not register prompt sections, tools, or model providers. A later Tavern context compiler consumes `PromptAssetBaseline` and decides which World Book candidates are active.

#### Token effect

Zero live-request tokens. This package does not assemble or send model requests.

#### KV Cache effect

None. The package does not create request prefixes or access an LLM provider.

## Known Limitations and Deferred Work

- No Character Card JSON/PNG parser, World Info importer, serializer, persistence provider, session integration, keyword activation, retrieval, or UI is included here.
- The prompt baseline retains World Book entries as candidates; it does not decide activation, probability, recursion, depth, visibility, or token budgets.
- The registry is process-local and must be replaced or wrapped by a durable provider before imported assets can survive a restart.
