# `@deepseek-ai/dsh-client-ui-tavern`

English | [中文](README.zh.md)

Legacy Tavern conversation contributions and data-facing controls. The current Tavern bundle composes [`ui-tavern-app`](../ui-tavern-app/README.md) as its sole browser root; this package is retained for the existing Character Card greeting, message-edit, and compatibility tests while the application shell migrates. It must not own root visibility or navigation state.

The full transcript and request, including all recorded prompt headers and tool schemas, remain in the existing conversation and [`ui-trajectory`](../ui-trajectory/README.md) views. The Tavern tab does not render a second transcript or input machine; the shared conversation composer remains the only send path. When the optional model-selection plugin is composed, Tavern projects its model control into Journey Settings and removes the per-message model seat from the roleplay composer. The source library is immutable through this surface: its JSON editor is read-only and its export reflects the reusable source asset. An active Journey can edit its detached Character Card or World Book copy; those edits append a Journey-local snapshot event and never mutate the source library. On selection and reload, the view asks Host to prepare recorded dynamic fields from the Journey baseline; World Book and World Person details render those `label: value` fields and fall back to source lines when no normalized fields are available. Automatic Journey facts can carry an arbitrary display label while retaining natural-language text, so later facts can add new fields such as `Secret` or `Player-specific`; a latest `Name` fact overrides an existing World Person's display name and a new `person:<slug>` fact creates a new person. Unlabeled facts remain under `Fact`. Players can edit or revoke existing facts, but the surface provides no manual fact-creation control. Swipe shows retained assistant candidates, records the selected candidate, and starts regeneration into a child Session. Prompt Inspector shows the recorded system prompt, tools, assistant text, parsed GM `story` and `updates`, selected World Info entries, and source identifiers from the selected baseline; the Story facts panel also shows every accepted or rejected fact event with its sequence and rejection reason.

The Tavern profile adds a root-level full-screen roleplay surface. Its top-level navigation separates the active story from completed Tavern Journeys, while asset and diagnostic tools stay secondary to the character and Journey flow.

See the [Tavern frontend design](../../../docs/tavern-frontend-design.md) reference for the Journey layout and interaction model.

## Model Experience

None, as the UI adds no model-visible message or composer path. The Host projects the saved asset selection, accepted automatic facts, legacy Memory entries, and location/time Story State into later prompts; fact sources retain their Session event sequence for Prompt Inspector and audit views.

#### KV Cache effect

The plugin changes later prompt content when a user saves a selection, edits or revokes a Journey fact, or uses a retained legacy Memory or Story State control; newly imported source assets affect cache keys only for future Journey selections.

## Known Limitations and Deferred Work

- **Limited PNG import** — the view reads uncompressed `chara` metadata from Character Card PNGs and never stores image bytes; executable SillyTavern extensions are not handled.
- **Prompt detail scope** — Prompt Inspector shows the latest recorded request, assistant text, parsed GM envelope, and selected asset baseline, while the Story facts panel shows the full fact-event audit; use Trajectory for the complete request history and prompt-change timeline.
- **Fact organization** — Normalized fields use the selected model route when available and deterministic source lines otherwise. Fact labels are optional presentation metadata; fact compaction and richer multi-entry organization remain deferred.
- **Later Tavern layers** — group chat, scene orchestration, alternate greeting selection, observer-specific memory retrieval, and RAG remain separate capabilities. The roleplay surface exposes candidate Swipe selection and regeneration into a child Session; it does not expose a general-purpose fork command.
