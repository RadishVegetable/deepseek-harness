# `@deepseek-ai/dsh-client-ui-tavern`

English | [中文](README.zh.md)

The optional Tavern workbench. It registers one `conversation.view` tab that reads the existing session snapshot and Trajectory target, presents the selected Character Card and opening greeting, projects recent durable roleplay messages, lists, imports, edits, and exports Character Card/World Info assets, records the current selection in the Session log, and provides session-scoped Memory, location/time Story State, and Prompt Inspector controls. It owns no conversation state; Host Remote owns asset storage and session selection.

The full transcript and request, including all recorded prompt headers and tool schemas, remain in the existing conversation and [`ui-trajectory`](../ui-trajectory/README.md) views. The Tavern tab does not render a second transcript or input machine; the shared conversation composer remains the only send path. The asset editor updates the retained source JSON under the existing asset ID and downloads Host-serialized JSON. Memory edits call the session Remote, Story State edits are limited to canonical location and time changes, and Swipe shows retained assistant candidates, records the selected candidate, and starts regeneration into a child Session. Prompt Inspector shows the recorded system prompt and tools, selected World Info entries, and source identifiers from the selected baseline.

The Tavern profile adds a root-level full-screen surface with roleplay, asset-library, and prompt-context navigation. Its session selector opens existing Tavern Sessions through the shared sessions service.

See the [Tavern frontend design](../../../docs/tavern-frontend-design.md) reference for the workbench layout and interaction model.

## Model Experience

None, as the UI adds no model-visible message or composer path; saved asset selection, Memory entries, and location/time Story State are projected by the Host runtime into later prompts.

#### KV Cache effect

The plugin changes later prompt content only when a user saves a selection, Memory entry, or Story State value; those changes can affect prompt-prefix reuse for subsequent requests.

## Known Limitations and Deferred Work

- **Limited PNG import** — the view reads uncompressed `chara` metadata from Character Card PNGs and never stores image bytes; executable SillyTavern extensions are not handled.
- **Prompt detail scope** — Prompt Inspector shows the latest recorded request and selected asset baseline; use Trajectory for the complete request history and prompt-change timeline.
- **Later Tavern layers** — group chat, scene orchestration, alternate greeting selection, observer-specific memory retrieval, and RAG remain separate capabilities. The workbench exposes candidate Swipe selection and regeneration into a child Session; it does not expose a general-purpose fork command.
