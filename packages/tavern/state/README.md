# `@deepseek-ai/dsh-tavern-state`

English | [中文](README.zh.md)

Pure TypeScript value model for structured Tavern story state. It defines canonical JSON records for location, time, inventory, health, relationships, cultivation, active oaths, and namespaced extension data. It does not import Cordis, own persistence, or mutate a Session.

## Public interface

Import the package root for runtime functions and `@deepseek-ai/dsh-tavern-state/types` for types only.

- `createStoryState(branchId)` creates an empty version-1 state.
- `sourceEventId(value)`, `storyBranchId(value)`, and `storyEntityId(value)` create branded ids after rejecting empty strings.
- `projectStoryState(records, options)` folds append-order records from the selected branch lineage. It returns the current state, accepted records, rejected records, and machine-readable issues.
- `compactPublicState(state)` removes descriptions and extension data from the model-facing state projection.
- `renderCompactPublicState(state)` emits the compact projection as JSON text.

Each `StoryStateChangeRecord` retains its source event id, branch id, sequence, validity, authority, change payload, and extension object. A later accepted update invalidates the earlier record for the same logical slot with a `supersededBy` source event id; the original record remains available for replay and audit.

The projection accepts records from the selected branch and its root-to-selected ancestors. It rejects stale branches, duplicate source events, non-increasing sequences, invalid records, invalid updates, records explicitly marked invalid, and lower-authority replacements. It treats authority precedence as `model-candidate < observed < authored-asset < user < gm`.

Known fields use explicit discriminated changes. Additional durable fields belong in `extension.set` and `extension.remove`, while unknown metadata on records and known values stays in `extensions` for lossless transport.

## Model Experience

### Compact public story state

#### What the model sees

Consumers may serialize `compactPublicState(state)` into a prompt section containing current location and time, inventory quantities, health summaries, relationships, cultivation values, and active oaths. Descriptions, private ownership fields, and all extension objects are excluded by this package's public projection.

#### Token effect

Conditional and bounded by the number of current inventory, health, relationship, cultivation, and oath records. The projection removes verbose fields but does not impose a token budget.

#### KV Cache effect

The package produces a replacement dynamic state section. Any change to a compact field changes that section; stable preceding prompt sections remain the responsibility of the context compiler.

## Known Limitations and Deferred Work

- **No persistence adapter** - callers must append records to the authoritative Session log and pass a deterministic record sequence to the pure projector.
- **No observer filtering** - public compact state does not decide whether a fact is visible to GM, player, narrator, or a character; that policy belongs to the context and memory packages.
- **No automatic conflict merge** - records with lower authority are rejected instead of silently merged, and callers must append a new authoritative correction.
