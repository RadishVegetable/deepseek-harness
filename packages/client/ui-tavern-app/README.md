# `@deepseek-ai/dsh-client-ui-tavern-app`

English | [中文](README.zh.md)

The Tavern-owned browser application root. It registers the built-in `root` slot, owns Tavern navigation and Journey presentation, and renders the active session through a session-aware child slot. The Library exposes visible JSON import actions for Character Cards and World Books, and successful imports are immediately available to Journey setup. Library cards also expose accessible delete actions with an explicit confirmation; successful deletion removes the card immediately, while a Host rejection keeps the asset visible and shows the raw reason in an actionable alert. The Tavern bundle disables the generic AppFrame and conversation roots so an archived active Journey returns to this library without exposing a generic composer. A successful archive shows a root status notice, while a failed archive keeps the active route and transcript available for retry. Archiving a non-current library row leaves the open current session untouched.

The Journey registers its own session Conversation projection because the Tavern profile intentionally disables the generic conversation UI. Accepted user messages and finalized GM messages come from the durable session event window; a terminal failed turn remains visible as an alert with a retry action that queues the preceding user text again. Retry-chain events stay hidden while another attempt is active, and the final failed turn is shown when the retry policy ends without an assistant message.

The root owns the `tavern.app` bilingual dictionaries and registers them with the shared locale runtime. Settings exposes the same runtime preference through a native language select, so the active Chinese or English copy updates immediately and the host preference is restored when the browser composition is reopened.

See [`docs/tavern-frontend-design.md`](../../../docs/tavern-frontend-design.md) for the product layout and lifecycle decisions.

## Model Experience

### Tavern selection and Journey transcript

#### What the model sees

The library and settings pages do not add model-visible content. Starting a `Journey` records the selected `Character Card`, `World Books`, and player identity before the first prompt; later transcript input is sent through the existing session runtime.

#### Token effect

Asset inspection uses no model tokens. Selected persona and World Book context consume prompt tokens when the Journey runtime builds a request.

#### KV Cache effect

Changing the durable selection changes the later prompt prefix and may change provider cache reuse.

## Known Limitations and Deferred Work

- **Session-only preferences** — reading-mode toggles apply during the current browser session and are not persisted.
- **Model routing** — the settings page displays the active default route but does not change model selection until the profile exposes a model-route Remote.
- **Asset authoring** — this root imports JSON Character Cards and World Books; editing existing source assets remains a separate Host capability.
- **Responsive panels** — Journey context drawers are intentionally single-session panels; multi-column comparison and group chat remain deferred.
