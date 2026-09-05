# Agent Note: Tavern-owned Web application

Status: proposed

English | [中文](2026-08-31-tavern-owned-web-app.zh.md)

## Problem

The current Tavern profile mounts Tavern content into the generic DeepSeek Harness Web application. `AppFrame` owns the browser root and the generic conversation view owns the composer, while Tavern provides a root-side surface and a Session-scoped conversation view. Those three owners do not share one navigation state.

Archiving the active Journey clears the current Session. That correctly removes the Session-scoped Tavern view, but it also removes the CSS marker that had hidden the generic composer. The generic Harness view then becomes visible even though Tavern had already selected its library page. The result looks like a redirect to DeepSeek Harness, but it is an uncontrolled fallback inside one root tree.

The Tavern product must not depend on a generic coding-agent shell, its sidebar, its composer, or DOM-wide CSS flags for ordinary product navigation. It needs a Web application whose screen and Session lifecycle are owned by Tavern while retaining dsh's Web transport, Session persistence, model execution, and Tavern host capabilities.

This decision supersedes the client-composition statement in the [Tavern roleplay surface proposal](../feature/2026-08-24-tavern-roleplay-surface.md) that adds Tavern pages to the existing Web GUI. It does not redefine the product flow in [Tavern frontend design](../../../../docs/tavern-frontend-design.md), the GM narrative loop, or durable Journey data.

## Proposal

The Tavern profile composes one Tavern-owned browser root, `ui-tavern-app`. It is the only plugin that registers the profile's render root. The app uses ordinary dsh client runtime services and Remote APIs, but it does not mount `ui-layout`, `ui-sidebar`, `ui-conversation`, or another generic Harness screen as a visual fallback.

`ui-tavern-app` owns product navigation, active-page loading, responsive layout, notifications, and all transitions between library and Journey screens. Existing Tavern cards, editors, story presentation, and controls become Tavern components below that root. A non-visual client module may still expose shared Session or message behavior, but no generic React root owns Tavern route selection or the composer.

### Product ownership

The root app owns the following product routes:

- `library` shows Characters, Journeys, and their first-run state.
- `journey` displays one identified Journey, its Story transcript, its composer, and Journey-scoped controls.
- `history` displays archived Journeys and allows an explicit restore or open action.
- `settings` contains product-level generation, appearance, and diagnostic controls that are not part of a story turn.

Route state and current-Session state are distinct. A route selects an opaque Journey id; the Session service provides the durable record and the execution handle needed for that route. A missing, archived, or unavailable id resolves to `library` with a Tavern notification. It must never cause a generic conversation view to render.

Source-asset deletion is a separate confirmed Library operation. The root calls the Host's durable delete Remote, removes a successful result from the visible list immediately, and leaves the asset and dialog available when the Host rejects the request. The rejection message remains in the alert so an asset-in-use explanation is not lost; deleting an asset never deletes a Journey transcript.

The delete transition is one owned operation:

```text
archive active Journey succeeds
  -> clear the app's active Journey reference
  -> navigate to library
  -> refresh the Journey and history projections
```

If archive fails, the route and transcript remain in place and the app presents the error. Archiving a non-active Journey refreshes the library without changing the current route. Browser reload restores a valid Journey route when possible; otherwise it opens the library. The root remains mounted throughout every one of these transitions.

### Client composition

The Tavern bundle selects a product composition rather than hiding parts of a generic composition:

- `ui-tavern-app` registers the sole root and owns all Tavern page layout.
- Tavern asset, Journey, narrative, and settings clients expose typed data and commands consumed by that root.
- Reusable dsh foundations remain available for browser startup, connection recovery, localization, theme tokens, Remote calls, Session logs, streaming execution, and approvals.
- Generic Harness layout, generic sidebar, generic conversation renderer, generic composer, workspace navigation, and their CSS are absent from the Tavern profile.

Tavern copy belongs to the `tavern.app` locale namespace. The root registers complete Chinese and English dictionaries with the shared locale runtime, and its own Settings page writes the host locale preference through the runtime's standard service. Every Tavern slot that renders product copy receives the standard locale seat, so switching language updates the root and Journey surfaces together without a local storage mirror or a second locale context.

The app may reuse a generic presentational primitive only when it receives explicit Tavern props and cannot select a Session, mount a root, change navigation, or add global CSS. Product-specific message rendering and composer behavior belong to Tavern components. `document.documentElement.dataset` and selectors that coordinate separate visual owners are not a navigation mechanism and are removed from the Tavern path.

### Remote API and data flow

The Host remains the authority for Character assets, Journey creation, session archive and restore, transcript projection, model execution, and durable state. The browser does not duplicate those stores or infer their state from the DOM.

`ui-tavern-app` reads typed projections for the library, one Journey, and history, then invokes typed commands to create, open, archive, restore, submit, regenerate, or update product settings. If the current dsh Session API lacks a product-level meaning needed by a route, Tavern defines an explicit Remote method with that meaning instead of reaching into a generic UI store. The result carries the authoritative opaque id and enough status for the root to choose its next route.

Streaming belongs to the active `journey` route. The route subscribes to its own transcript and execution state, disposes those subscriptions when the selected Journey changes, and cannot render a composer for an absent Journey. Library and history remain useful without an active Session.

### Migration

Implementation first separates the current `ui-tavern` data and product components from registrations into `tavern` and `conversation` slots. `ui-tavern-app` then consumes those components under its single root. The Tavern bundle replaces the generic client-screen roster only for the Tavern profile; standard dsh Web profiles keep their existing application unchanged.

Persisted Sessions and Tavern events do not change because this is a presentation-ownership change. Existing Journey archives remain archives rather than destructive deletes. The old DOM marker and the generic-composer hiding rule are removed only after the Tavern root renders the equivalent library, Journey, history, empty, loading, and error states.

## Alternatives considered

**Patch `AppFrame` to understand Tavern's empty state.** This would special-case one product inside the generic shell while `AppFrame`, the generic composer, and Tavern still retain separate lifecycles. It fixes one fallback but leaves root ownership ambiguous.

**Keep the generic root and hide it with CSS.** A data attribute cannot express navigation, failure, loading, or Session availability, and it disappears with the Tavern view that needs it. Styling cannot make two roots one owner.

**Mount a second Tavern root beside the generic root.** Two roots compete for page space, focus, keyboard shortcuts, notifications, and global CSS. The Tavern profile instead has exactly one visual root.

**Build an external standalone SPA.** A separate service would duplicate dsh browser bootstrap, reconnect behavior, streaming protocol, Session persistence, and access policy. The proposed app is independent at the product UI layer while remaining a dsh client composition.

## Acceptance criteria

1. The Tavern profile registers exactly one visual root, owned by `ui-tavern-app`; no generic Harness layout, sidebar, conversation view, or composer mounts in that profile.
2. A first visit and a visit with no selected Session show the Tavern library, not a generic Harness input field or workspace surface.
3. Creating or opening a Journey selects the `journey` route, renders its Tavern transcript and composer, and uses the authoritative Journey id returned by the Host.
4. Archiving the active Journey returns to the Tavern library after a successful archive, clears the selected Journey, and never reveals a generic Harness surface.
5. Archive failure preserves the active Journey route and reports the failure without losing the transcript or composer state.
6. Restoring or opening an archived Journey is an explicit Tavern action that returns to the `journey` route; a bad or unavailable route id falls back to the Tavern library with a product notification.
7. No Tavern navigation or visibility behavior depends on `document`-wide data attributes, cross-root CSS selectors, or a generic UI store's private state.
8. Tests cover the first-run library, active Journey load, archive-success transition, archive-failure retention, restore transition, and stale-route fallback. A runnable browser-level check proves that archiving the active Journey cannot reveal the generic composer.

## Risks

The custom root initially exposes fewer generic client conveniences, so each needed behavior must be deliberately retained as a typed dsh foundation or rebuilt as a Tavern component. Reusing generic components too broadly can reintroduce hidden navigation and Session selection effects; the component boundary must stay presentational.

Tavern's product route can disagree temporarily with an asynchronous Session projection. The root must treat Host command results and refreshed projections as authoritative, show loading or error states explicitly, and avoid guessing a replacement Journey. Future multi-tab behavior requires an explicit synchronization policy rather than another implicit global-store fallback.
