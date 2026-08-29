# Agent Note: Tavern roleplay workspace overview

Status: implemented

English | [中文](2026-08-25-tavern-roleplay-workspace.zh.md)

## Problem

The Tavern resource tab needs to expose roleplay context without creating a second conversation store or a second send protocol. A resource-only panel leaves the selected character's opening and recent story state disconnected from the session that will receive the next user turn.

## Decision

The Tavern conversation view presents a roleplay workspace above the existing conversation composer. It shows the selected Character Card, opening greeting, direct one-character mode, and the most recent durable user and assistant prose projected from the session snapshot. The existing conversation composer remains the only send entry and continues to own input admission, draft persistence, streaming, cancellation, and Session transport.

The conversation plugin exposes its Chat store, Host-backed actions, and ChatView component through the `conversationChatView` client service. Tavern consumes that service face, keeping the shared value implementation inside `ui-conversation` and preserving client bundle purity.

The Tavern client marks the document with an explicit `dshSurface` value while the plugin is mounted; the layout listens for that marker instead of inferring the surface from the URL. Startup selects an existing empty Tavern Session over an ordinary empty Session, creates one through the Workspace service when needed, and leaves a non-empty current Session untouched.

The layout declares a root-level `tavern` slot. The Tavern plugin contributes full-screen root chrome with roleplay, asset-library, prompt-context navigation, and a Tavern Session selector; the generic conversation header is hidden on this surface. The chrome opens Sessions through the shared session service, while the existing `conversation` slot remains the only transcript and composer tree.

When no Character Card is selected, the workspace shows an explicit empty state and the shared composer remains unavailable for the Tavern roleplay path. Asset import and Session selection continue to use the existing Host Remote and append-only selection event; an empty session with a non-empty Character Card `firstMessage` also receives one durable `tavern/greeting` event. The greeting is projected into the shared Chat flow and persona without becoming an `assistant/message`, and the browser package owns no transcript or roleplay state.

The same workspace exposes Host-backed source editing and export, session Memory upserts, canonical location and time Story State controls, retained assistant Swipe candidates, and a Prompt Inspector for the latest recorded request. These controls append their domain events to the Session log; the workspace does not maintain a parallel roleplay database.

World Info runtime compilation uses the smallest selected `scanDepth` as the recent-message query window and the smallest selected `tokenBudget` as a deterministic first-fit budget. Intermediate probability uses a stable session/source/query-derived roll, and entries sharing a group compete through deterministic ranking. Depth, sticky, and cooldown metadata remain source-tracked in the baseline and activation ledger; recursive scans and persistent sticky/cooldown timers are deferred.

## Alternatives considered

**Create a second Tavern input machine.** This would duplicate draft persistence, admission, cancellation, and error handling, and could submit a message through a different path from the transcript.

**Render the full ChatView inside the Tavern tab.** The generic conversation view already owns the transcript and composer layout, so nesting it would duplicate the chat flow and create competing scroll and input regions.

**Append the greeting as an `assistant/message`.** Session validation reserves assistant messages for model calls, so a synthetic greeting would violate the event-to-message invariant. The log-only `tavern/greeting` event lets both runtime and Chat reconstruct the same authored opening text.

## Verification

- `packages/client/ui-tavern/tests/views.client.spec.tsx` passes through the real slot composition.
- The Tavern client package typecheck and bundle pass.
- The conversation client package typecheck and bundle pass.
- Focused Tavern, greeting, ChatView, and session-skeleton tests pass.
- Host swipe projection and client Memory, Story State, Swipe, and Prompt Inspector controls pass their focused tests.
- The local Web page shows one shared composer beneath the Tavern workspace after the generated client bundle is loaded.

## Consequences

The Tavern root is a full-screen roleplay workspace inside the existing AppFrame rather than a second runtime. Character greeting and recent messages are visible where asset selection happens, while full transcript rendering and send behavior remain owned by `ui-conversation`. The durable greeting is single-use for an empty session; switching characters after conversation content exists does not inject a new card greeting. Memory, canonical Story State, retained Swipe selection, source editing, and latest-request Prompt Inspector are available as session controls; full fork/regenerate behavior, alternate greeting selection, observer-specific memory retrieval, group chat, scene planning, and RAG remain separate capabilities.
