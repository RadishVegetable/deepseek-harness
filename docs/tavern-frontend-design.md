# Tavern frontend design

English | [中文](tavern-frontend-design.zh.md)

This reference defines the browser interaction model for the Tavern roleplay workbench. The runtime and persistence contracts remain owned by [`dsh-tavern-host`](../packages/tavern/host/README.md) and the shared conversation surface remains owned by [`ui-conversation`](../packages/client/ui-conversation/README.md).

## Design read

Tavern is a roleplay production tool for people who repeatedly select a character, inspect injected context, and write turns. It uses a focused workbench language: cool neutral surfaces, one business accent from the DSW theme, compact typography, visible state, and restrained motion.

The working dials are `DESIGN_VARIANCE: 4`, `MOTION_INTENSITY: 3`, and `VISUAL_DENSITY: 6`. These values keep the interface distinctive enough to feel like a writing tool while preserving scanability during long sessions.

## Layout

The Tavern surface fills the available application column and keeps one primary task in view.

```text
Tavern bar: brand | connection state | session selector | new session

Character rail      Conversation stage                         Context rail
character identity  shared ChatView and shared Composer         active assets
session list        durable greeting and message flow           World Info entries
World Book list     no duplicate send path                       memory/state status
library and import  -------------------------------------------------------------
                    drawer: library editor or prompt inspector
```

The character rail stays narrow and stable. Its World Book rows expose entry counts, selection state, and the saved-versus-draft distinction without opening an editor. The conversation stage has the largest track and contains the only transcript and composer. The context rail summarizes the current prompt inputs and the latest recorded model request.

On narrow viewports the context rail hides and the character and World Info rail becomes a compact strip above the conversation. The Tavern main area scrolls independently when the stacked content is taller than the viewport. The conversation stage remains the first viewport content, and opening a drawer does not unmount the shared ChatView or Composer.

## Interaction model

Character and World Info selection is a two-step operation. Controls edit a local draft, the Apply action appends one `tavern/assets-selected` event, and Reset returns the draft to the latest durable selection. A failed Apply preserves the draft and shows an inline error.

The library drawer owns source JSON editing, import, and export. Memory and canonical Story State controls share that drawer because they modify the current session, while Swipe candidates remain session-scoped controls beside them. Prompt inspection opens a separate drawer and reads the recorded request and source-tracked baseline; it does not recompute World Info activation in the browser.

The top bar exposes connection, session, and loading states. A pending session list, an unavailable Tavern Remote, a blank session, and a failed asset request each have a distinct message and recovery action. Skeleton rows preserve the final rail proportions while the first asset pull is pending.

## Visual system

Feature CSS uses CSS Modules and the semantic `--dsw-alias-*` tokens described in [`web-styling.md`](web-styling.md). The page uses one corner-radius rule: square workbench sections, `6px` framed tool surfaces, and full-radius status dots only where the shape is semantic. Borders and spacing establish hierarchy; shadows are reserved for the open drawer.

The primary action uses the theme business accent and the secondary actions use layer and border aliases. Icon buttons use the existing `dsh-client-ui-primitives` icon family and include a native tooltip title for unfamiliar actions. Focus rings, reduced motion, keyboard navigation, and readable text contrast are part of every interactive state.

## Ownership and non-goals

`ui-tavern` owns presentation state such as the active drawer, asset draft, and responsive rail visibility. `dsh-tavern-host` owns asset storage, selection events, memory, Story State, Swipe, and prompt baselines. `ui-conversation` owns message projection, draft persistence, input admission, streaming, cancellation, and transport. Tavern never creates a second chat store or send path.

The workbench does not claim group chat, scene orchestration, alternate greeting selection, recursive World Info compilation, persistent sticky/cooldown timers, or RAG. Those capabilities need their own runtime contracts before they receive UI controls.

## Acceptance signals

- The first viewport communicates the active character, current session, connection state, selected World Info, and the shared composer.
- The ChatView and Composer remain the only transcript and send implementation.
- Selection changes are visibly unsaved until Apply succeeds.
- Prompt inspection shows recorded model input and source identifiers without fabricating browser-side activation results.
- Blank, loading, error, empty, drawer-open, and narrow layouts remain usable without overlapping text or controls.
