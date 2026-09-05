# Agent Note: Tavern roleplay surface with source-tracked context

Status: proposed

English | [中文](2026-08-24-tavern-roleplay-surface.zh.md)

## Problem

SillyTavern (ST) is the reference roleplay frontend, but its context management is structurally unsound: one linear chat array, truncated by locally estimated token counts, with world info matched by substring against the last two messages and injected into the same string. Setting text, world info, and chat history are three independent token ledgers that never negotiate; the same fact appears in multiple places with no deduplication; summaries coexist with the original messages they summarize; switching a historical swipe does not invalidate downstream replies. The visible result is setting dilution and hallucination in long chats. We want a tavern-grade roleplay surface on DeepSeek Harness that fixes these mechanisms rather than re-skinning them, using the plugin composition model to run one GM narrative loop with a deliberately small tool set.

## Proposal

Build a `tavern` capability family and a `tavern` profile. Roleplay is a first-class session shape whose model-visible input is reconstructed from the session log, not a rendered string. The four products of this work:

1. **Character Card as Journey anchor.** A Character Card is a directory (and a JSON/PNG importer) that supplies the primary character information, opening messages, embedded `character_book`, attached World Info references, and Journey defaults. Its fields map to GM prompt sections with declared roles; no field is silently dropped (ST's `creator_notes`, Text-Completion `system_prompt`, and `wiBefore` slots are preserved). The card supplies story data, not a Character Agent or a separate reply pipeline.
2. **Source-tracked World Book context.** Embedded and attached World Info/Lorebook entries, along with Journey memory, are activated by an authoritative matching pipeline, then injected as sourced runtime-context snapshots and appended to the session log as `tavern/context-activation` durable events. A SillyTavern `World` remains a reusable Lorebook collection, not a world entity with an owned cast. The model sees structured "setting / world / memory / history" tiers; every injected fact has a log-backed source, satisfying model-visible ⟺ logged.
3. **One GM Story segment and branch.** One player input produces one GM generation and one Story segment. The segment may contain narration plus actions or dialogue for multiple Characters, with optional block attribution for rendering and state projection. Swipe and regeneration create a branch or replace a Narrative turn; downstream derived history becomes invalid, so the transcript never needs one model call per Character.
4. **Small tool set.** The tavern preset mounts only `dsh-persona` (complete), the tavern world-info/memory rows, and `ask_user_question`; no bash, fs, web, skill, plan, or subagent schemas reach the model. Roleplay prompts stay tiny and cache-friendly.

The delivery stack is a new bundle `@deepseek-ai/dsh-tavern` (layered over `dsh-base` + `dsh-web-app`) and a `tavern` profile; `ui-tavern` client plugins add the chat page, character editor, world-info editor, and swipe picker to the existing web GUI.

## Context pipeline

One GM model request for a Tavern Session is assembled from the Session log in this order, replacing ST's single concatenated string:

```text
session log (append-only, the only fact source)
  ├─ system prompt: harness identity + GM narrative rules + primary Character Card
  ├─ sourced runtime-context snapshots (sourced tiers, newest-first):
  │    ├─ attached World Book and setting entries
  │    ├─ World Info activations (tavern/context-activation events)
  │    └─ Journey memory entries (tavern/memory events)
  └─ derived history: deriveMessages() over the log, compaction-folded
```

Invariants that fix the ST defects:

- **The log is authoritative.** Chat, injections, and memory are all `SessionEvent`s; the model request is a pure projection. ST's dual-API divergence (Text vs Chat Completion) cannot recur because there is one projection path.
- **Injection is sourced and logged.** Each context activation names the triggering message seq and the activated entry; when the triggering message is truncated away by compaction, the activation is retired with it instead of leaving an orphaned injection (ST scans full history but injects into the truncated prompt).
- **Compaction folds, not overlaps.** The `compaction` seam replaces a folded range with a `compaction/summary` and a replacement user message; the original messages leave the derived history. ST keeps summary and originals side by side.
- **Edits invalidate downstream.** A swipe/fork or an edit of an injected-upstream message removes derived nodes above the change point, so the model never sees a reply that was generated against a different branch.

## Package layout

New `packages/tavern/` group, all `@deepseek-ai/dsh-tavern-*`:

| Package | Role | Key interface |
|---|---|---|
| `tavern/character` | Service Definition + provider + card parser | `ctx.characters` — `parse(input): CharacterCard` (JSON + PNG), `expand(card): GM context source` |
| `tavern/world-info` | Service Definition + provider + activation pipeline | `ctx.worldInfo` — `activate(session, buffer): Activation[]`; resolves embedded and attached Lorebooks, injects activations, appends `tavern/context-activation` |
| `tavern/memory` | Memory seam + provider + retrieval | `ctx.tavernMemory` — `remember(session, entry)`, `query(session, scope): entries`; appends `tavern/memory` events |
| `tavern/swipe` | Swipe/fork Consumer + invalidation | `ctx.tavernSwipes` — `swipe(session, at): Session`, `regenerate(session, at): void` (surface replace) |
| `tavern/narrative` | GM narrative-loop Consumer | one GM generation per player input; Story segment blocks identify Character attribution without Character calls |
| `client/ui-tavern` | Browser plugins | chat page, character/world/memory editors, swipe picker via `ctx.slots.register` |

The seam rule: `character` and `world-info` have one provider each today, but the Service Definition / Provider split is justified by the card-format and retrieval strategies that already vary across tavern ecosystems (chub/venus-style cards, embeddings vs keyword retrieval); one adapter is a hypothetical seam, the import surface is a real one.

## Session events (declaration-merged into `SessionEventMap`)

```ts
interface SessionEventMap {
  'tavern/character-selected': { characterId: string; cardVersion: number }   // ignorable: false
  'tavern/context-activation': { entryId: string; triggerSeq: number; tier: 'world' | 'memory' } // ignorable: false
  'tavern/memory': { entryId: string; text: string; scope: string }           // ignorable: false
  'tavern/swipe-forked': { sourceSeq: number; childSessionId: string }        // ignorable: false
}
```

All four are required-on-read: a reader that does not know them must refuse the log, because each changes what the model sees. Structural format changes stay within `SESSION_FORMAT_VERSION` 0.

## Alternatives considered

### Why not extend SillyTavern?

ST's context pipeline is the defect, not the surface: fixing truncation, injection sourcing, and invalidation inside ST means rewriting `script.js`'s generation path and `world-info.js`'s matching, then re-verifying two API families. That is a rewrite with a frontend attached. DeepSeek Harness already ships the session log, deriveMessages, compaction, fork lineage, and plugin composition that the fix requires; building here converts "rewrite ST's core" into "mount plugins."

### Why not a standalone tavern frontend on the dsh SDK?

A separate SPA (ST-style: own Express server, own chat storage) re-implements sessions, persistence, and streaming that `dsh-web-app` already serves, and it forks the product into two UIs. A `ui-tavern` client plugin reuses the conversation renderer, session persistence, and the slot system; the cost of a new page is one `ctx.slots.register` per view.

### Why not character-as-config in the profile?

Per-session Character Card selection cannot be a profile-level patch: a patch replaces whole row configs and a profile is one process-wide tree. Character Card selection belongs to the Journey and records its attached baseline as a durable event, so the GM request inherits the replay guarantee without creating a Character Agent.

### Why not reuse the generic `compaction` command as-is?

Compaction-basic's thresholds and tail-keeping are tuned for coding sessions; tavern needs a chat-tuned policy (keep first greeting, protect pinned memory, prefer summarizing world-info-heavy stretches). The seam is consumed as-is with a tavern provider registered on `ctx.compaction`, not forked.

### Why not per-Character group chat?

Independent Character calls repeat the same World Book, Journey, and Scene context, add speaker scheduling, and spend tokens on coordination. One GM generation can attribute multiple Character blocks while preserving causal order in one Story segment; the first version therefore has pseudo-group presentation only.

## Acceptance criteria

1. `dsh --profile tavern` boots with `dsh-base` + `dsh-web-app` + the tavern bundle; the model receives no tool schemas except `ask_user_question`.
2. A Character Card JSON or PNG imports as a Journey anchor, preserves its attached Lorebook references, and produces one GM context containing the card's authored character information.
3. A world-info entry with keyword `armor` activates exactly when an in-window message contains the whole word, appends a `tavern/context-activation` event, and appears in the next request as a sourced runtime-context snapshot; a non-matching message activates nothing.
4. `swipe()` on message N forks a child session sharing events up to N; regenerating message N in a session removes all derived messages above N from the next request.
5. Editing message M invalidates a summary whose folded range includes M (the summary leaves the derived history).
6. The web GUI renders the character-first Journey flow, Tavern chat page, Character Card editor, World Info editor, and swipe picker; a keyless snapshot replay of a Tavern Session reproduces a multi-Character Story segment.
7. A Dockerfile builds the workspace and serves the profile on `0.0.0.0:3080` with a patched webserver row; `--host 0.0.0.0` remains rejected at the CLI.

## Risks

- **The primary Character Card is fixed for a Journey.** A Journey that has produced content cannot silently replace its entry character or attached Lorebook baseline; changing the relationship anchor requires a new Journey or branch so the GM context remains reconstructable.
- **Character cards vary wildly across ecosystems.** The v1 parser targets the `characterCardV2`-style JSON schema and char PNG tEXt chunks; cards outside that contract fail loud at import rather than guessing.
- **Context budget negotiation is policy, not mechanism.** The injection pipeline needs a tavern-specific budget that arbitrates between world info, memory, and history (ST's three-ledger problem). The seam is designed; the first provider ships a fixed-priority arbitration, with smarter policy deferred.
- **This proposal commits to forks over in-place swipe arrays.** Every swipe costs a session (and a child log); storage and UI density for heavy swipe use are unproven.
