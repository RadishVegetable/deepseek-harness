# Agent Note: Tavern asset selection and prompt projection

Status: implemented

English | [中文](2026-08-24-tavern-asset-selection-and-prompt-projection.zh.md)

## Problem

The Tavern Web tab needs to select imported Character Cards and World Info for one Session, while model-visible persona and context must remain reconstructable from the Session log. A browser-only draft cannot provide durable selection, and a static preset cannot change the character for one live Session.

## Decision

The first Tavern slice uses `@deepseek-ai/dsh-tavern-host` as the Host owner of asset storage, session selection, and agent prompt projection. Character Card V2/V3 JSON, uncompressed Character Card PNG metadata, and standalone World Info JSON are normalized by `dsh-tavern-compat` and registered in `dsh-tavern-assets`; original source JSON is persisted through `storageDomain` and restored during Host startup.

`selectForSession` validates the selection, appends the complete normalized baseline as `tavern/assets-selected`, and returns a detached session selection. Each agent installs a complete `persona` section from the selected character and a dynamic `tavern:world-info` section. World Info uses the pure compiler's observer, branch, validity, whole-word matching, deterministic ordering, and ledger rules. A changed compiled snapshot is recorded as `tavern/context-activation` before the next model-visible projection.

The browser package `@deepseek-ai/dsh-client-ui-tavern` registers a `conversation.view` tab. It imports JSON and Character Card PNG files through Host Remote, selects one Character Card and multiple World Info assets, reads the latest Session selection, and displays the latest recorded system prompt. PNG import reads only uncompressed `chara` metadata and does not retain image bytes. The UI owns no Session state and adds no prompt content by itself.

The same Host Remote also exposes session Memory upserts, canonical location and time Story State changes, retained assistant Swipe candidate inspection and selection, and source JSON update/export. The browser workbench presents these operations without adding a second conversation store or send path. The Tavern profile mounts the workbench as a full-screen root surface with its own navigation and Session selector; transcript and composer rendering still come from the shared `conversation` slot.

The Tavern bundle loads the Host and browser packages over the Web profile and selects the `tavern` direct-roleplay preset. The preset does not load coding tools; selecting assets changes later requests through the Host runtime.

The Remote wire vocabulary uses explicit `./types` exports for asset and context types. `AssetId` uses the shared `Branded` primitive so the Typert JSON validator treats the brand as compile-time-only data.

## Alternatives considered

**Keep selection in the browser.** This would lose restart recovery and make the prompt depend on client state that is absent from the Session log.

**Put the selected character in the process-wide preset.** This cannot represent per-Session switching and would make unrelated Sessions share one character baseline.

**Inject imported text directly into one concatenated prompt string.** This would discard source provenance and bypass the observer-aware context compiler and activation ledger.

## Verification

- Host TypeScript compilation passes for `packages/tavern/host/tsconfig.json`.
- Client aggregate TypeScript compilation passes for `tsconfig.client.json`.
- `packages/tavern/host/tests/host.spec.ts` and `packages/client/ui-tavern/tests/views.client.spec.tsx` pass through the real Host facade and client slot composition.
- Host Typert analysis and generation pass for `@deepseek-ai/dsh-tavern-host`, including the Remote client declaration and runtime descriptor.

## Deferred

The broader Tavern architecture still owns observer-specific L0-L3 memory, full swipe/fork and regenerate behavior, group chat, scene planning, executable extension handling, and richer historical Prompt Inspector views. The current implementation provides canonical location and time Story State, session Memory upserts, retained-candidate Swipe selection, and latest-request Prompt Inspector data. The context activation snapshot records the compiled World Info decision, and compressed `zTXt`/`iTXt` Character Card metadata is not decoded by the dependency-free parser.

## Consequences

Imported assets survive Host restart through source records, while Session choices, Memory, Story State, and Swipe selections survive through append-only events. Persona and World Info changes are model-visible only after a Session selection event, so the request can be reconstructed from the log. The UI remains compatible with the existing conversation and Trajectory surfaces and provides a full-screen Tavern root surface in the AppFrame, but it does not yet provide a standalone Tavern runtime or full branch commands.
