# Agent Note: Tavern three-column workbench layout

Status: implemented

English | [中文](2026-08-26-tavern-workbench-layout.zh.md)

## Problem

The Tavern client exposes several roleplay controls, but a single long flow makes asset selection, the shared conversation, and prompt context compete for attention. World Info selection also needs a visible draft state because each immediate checkbox write changes the durable prompt baseline.

## Decision

The Tavern surface uses a three-column workbench. The character rail owns the active character, Tavern session list, World Book selection, and entry counts. The center stage renders the existing ChatView and the ConversationRoot-owned Composer. The context rail summarizes the selected baseline, latest model request, memory, Story State, and Swipe state.

Asset selection is staged locally. Character and World Info controls update a draft; Apply calls the existing Host Remote and updates the draft only after the selection event succeeds. Reset restores the last durable selection. The browser does not calculate active World Info entries for prompt truth; the context rail reads the recorded baseline and latest request.

Source editing, import/export, Memory, Story State, Swipe, and full Prompt inspection render in a drawer. The drawer is presentation state and never replaces the shared transcript or input machine. The root Tavern slot supplies connection/session chrome and a new-session action through the existing Workspace service.

The workbench uses CSS Modules, DSW semantic aliases, the existing primitive icon family, stable square framing, and responsive drawer behavior. Loading, blank, error, and empty states remain inside the Tavern surface so an unavailable connection does not fall back to the generic conversation hero as the only explanation.

## Alternatives considered

**Keep one long page with anchor tabs.** This mixes navigation with document scrolling and leaves the composer far from the context controls; the three-column arrangement keeps the next writing action and its inputs visible together.

**Create a Tavern-specific transcript and composer.** This would duplicate ChatView projection, draft persistence, input admission, cancellation, and transport; the shared ConversationRoot remains the only owner.

**Persist every checkbox immediately.** This makes exploratory selection destructive and can append several baselines before the user has reviewed the set; Apply creates one explicit durable commit while Reset remains local.

**Recompute World Info activation in the browser.** The browser lacks the Host activation ledger and exact prompt assembly context; showing a local match count could contradict the recorded request, so the inspector uses source-tracked baseline data instead.

## Consequences

The first viewport is denser and more useful for repeated roleplay turns. Mobile layouts trade persistent side rails for an explicit drawer, while the conversation remains primary. The Host Remote and Session log remain the source of durable behavior; a failed selection leaves the draft visible for correction. Full asset source JSON remains available, while field-level World Info editing and image persistence remain separate follow-up capabilities.
