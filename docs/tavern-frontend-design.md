# Tavern frontend design

English | [中文](tavern-frontend-design.zh.md)

This reference defines the browser interaction model for an immersive Tavern built around GM-led interactive fiction. The runtime and persistence contracts remain owned by [`dsh-tavern-host`](../packages/tavern/host/README.md), and the shared conversation surface remains owned by [`ui-conversation`](../packages/client/ui-conversation/README.md).

## Product premise

Tavern presents a character and an ongoing story, not a configuration workbench. The first useful action is meeting a character or resuming a journey; attached World Book entries give the story room to grow without becoming the primary entry point.

The model is always the GM. GM is a runtime responsibility that reads the world, characters, World Book, journey history, and current state, then writes the next part of the story. A Character Card supplies information about a character; it does not create another model, agent, or reply pipeline.

Each player input creates one model request. The GM response contains complete `story` text and may carry an `updates` envelope for natural-language Journey facts; ordinary free text remains valid and is displayed in full when the envelope cannot be parsed.

The GM controls the world and non-player characters, but does not silently decide the player's dialogue, actions, choices, or inner feelings. A story segment can present a consequence or an invitation to act while leaving the player's next decision open.

## Delivery stages

The current runtime delivers the complete roleplay loop: choose a primary Character Card, review its attached World Book, configure a Journey, prepare dynamic source fields, exchange GM-authored story segments, and resume the transcript later. Journey facts are appended to the Session log after the assistant response, and the next request recalls their active projection. True multi-agent group chat and per-Character model calls remain outside this design.

Deferred layers add only structure justified by a concrete user-visible problem. Repeat organization after authored asset edits, block attribution, richer Scene summaries, observer-specific retrieval, continuity repair, and planning must preserve the raw transcript and keep one player input to one model generation.

## Vocabulary

- **GM**: the model's narrative responsibility. It maintains continuity, chooses what happens next, and writes all visible narrative content. It is not normally rendered as a character in the transcript.
- **Character Card**: the authored starting point for a Journey. It contains a character's identity, background, personality, goals, relationships, knowledge, capabilities, boundaries, speaking style, attached World Book/Lorebook context, and journey defaults.
- **World**: the SillyTavern-compatible reusable World Info/Lorebook asset. It is a collection of authored entries and activation metadata that can be attached to several Character Cards or Journeys; it does not own a character roster, current story state, or Journey entry point.
- **Character**: a story entity described by a Character Card and Journey-local natural-language facts. Fixed relationship, inventory, health, or similar fields are not required; a Character Card is not automatically added to `people`.
- **World Book**: the attached or selected collection of World/Lorebook entries, including an embedded V2 `character_book`. The GM can use an entry when its activation conditions match the current Journey; the collection does not instantiate a Character or become a separate world runtime.
- **Journey**: one independent story anchored by a primary Character Card. It snapshots the card's attached World Book context, then owns its transcript, scene, Characters, `people[personId]` and `world` facts, story state, memory, branches, and configuration overrides.
- **Scene**: the local situation inside a Journey: the current location, time, participants, immediate tension, and available actions. A Scene can change without creating a new Journey.
- **Narrative turn**: one player input followed by one GM generation.
- **Story segment**: the complete GM output for a Narrative turn. It may contain narration, environment changes, actions, and dialogue for multiple Characters.
- **Pseudo-group chat**: a Story segment that attributes actions or dialogue to multiple Characters. It is one GM output, not multiple agents, model calls, or a speaker-selection loop.

The relationships are:

```text
Character Card (required journey anchor)
  +-- character information
  +-- attached World Book / Lorebook entries
  +-- attached Character Book / World Book
  +-- journey defaults
  `-- optional supporting Character Cards
        | snapshots into
Journey
  +-- primary Character
  +-- attached World Book / Lorebook context
  +-- transcript of story segments
  +-- current scene
  +-- Character and World Book source snapshots
  +-- people[personId] and world fact projections
  `-- journey-specific configuration
```

## Character, attached world, and journey

A Character Card is the social and narrative starting point of a Journey. Its attached World Book may contain a small private setting, references that describe a kingdom, or no larger setting at all. A Journey snapshots the selected Character Card and its attached Lorebook entries, then never shares mutable story state with another Journey.

The same World/Lorebook asset can be reused by multiple Character Cards for authoring efficiency. That reuse does not make the World the product's owner of Characters: each Journey still starts with a primary Character Card, and its roster grows from the selected card, optional supporting cards, and Characters introduced by the GM.

This supports both ends of the experience without two runtime models:

- **Focused character journey**: a secretary, lover, companion, colleague, or other primary character can carry only the information needed for a close conversation. The GM can still introduce other NPCs when the story calls for them.
- **Large-world journey**: a primary Character Card can attach World Book entries that describe a kingdom, academy, post-apocalyptic settlement, cultivation setting, or other large setting. The player enters that setting through the Character and can meet further Characters as the GM writes the story.

Every Journey uses the same GM narrative loop, character state model, and story segment format. Browsing a World asset is an authoring and inspection action; it is not a separate Journey creation mode.

## Starting a journey

The Tavern entrance is organized around a required character choice, the character's attached context, and one result:

1. Choose or create the primary Character Card. A Journey cannot be created without a character to meet or follow.
2. Review the card's attached World Book or embedded `character_book`. Add optional supporting Character Cards or World Books when the card and profile permit it. A Character mentioned in a World Book is not automatically an encountered Character.
3. Set the player identity and the small set of generation and narrative preferences that belong to this Journey.
4. Create the Journey and enter its opening Scene. The Journey receives its own transcript and state projection from the first turn.

The World library remains available as a secondary Lorebook asset view. Choosing a World there previews the Character Cards that attach it and routes the player to a Character Card before Journey creation; it never starts a characterless Journey.

The first message may be an authored greeting from the selected Character Card or a GM-generated opening. An authored greeting is an opening condition of the Journey, not a model response that pretends the model already spoke. Imported source assets remain immutable and reusable; newly imported assets affect future selections, while the active Journey reads its recorded baseline and projects its own local asset edits and fact updates over that baseline.

## Narrative turn

The runtime treats each send as a request to continue the story. It stores the assistant response as one ordinary message and applies any valid Journey facts only after that response is durable:

```text
player input
  |
GM context: World Book entries + Characters + Journey + Scene + transcript
  | one model generation
Story segment
  +-- narration and environment
  +-- actions and dialogue for zero or more Characters
  +-- optional updates.people[personId]
  +-- optional updates.world
  `-- a natural point for the player's next action
```

The supported envelope is:

```json
{
  "story": "The complete prose continuation.",
  "updates": {
    "people": { "person:medie": [{ "op": "add", "text": "Medie is the player's permanent secretary." }] },
    "world": [{ "op": "add", "text": "The court recognizes the appointment." }]
  }
}
```

The Host assigns fact IDs to additions, validates person and fact targets, logs rejected operations, and projects only active facts into the next request. `replace` and `remove` reference an existing `factId`; they append audit events instead of erasing history. A response fingerprint prevents duplicate facts when reload or retry repeats the same assistant result.

When a later stage needs to identify dialogue or encountered Characters, the logical result can carry block metadata without splitting the generation into separate calls:

```text
{
  turnId,
  blocks: [
    { kind: "narration", text: "..." },
    { kind: "dialogue", characterId: "secretary", text: "..." },
    { kind: "action", characterId: "guard", text: "..." }
  ],
  stateChanges: []
}
```

`stateChanges` are a later-stage candidate mechanism, not a Phase 1 requirement. A character attribution is presentation and projection metadata; it is not a separate model actor.

The transcript keeps the complete Story segment as one narrative result even when its blocks contain several Characters. Regenerate, edit, continue, and branch operate on the Narrative turn, so downstream story state and derived context are rebuilt from the selected branch.

## Fact projection and details

The Character and World Book detail views combine recorded source fields with active Journey facts. World Book lines that use `label: value` syntax are displayed as dynamic fields; the field names are not a closed product schema. A GM fact may carry an arbitrary display label while keeping its body as natural language, so a later fact can add a field such as `Secret` or `Player-specific`. An unlabeled fact remains under `Fact`. A World Person is shown when a selected World Book entry identifies a character or a GM `add` introduces a valid `person:<slug>`, and its Journey facts appear with the entry. The active Journey can edit or revoke existing facts, but the player-facing surface does not create facts manually.

The Prompt Inspector pairs the latest recorded model request with the retained parsed GM envelope, including `story` and raw `updates`. The Story facts panel separately lists the append-only fact events, including rejected operations and their reasons, so a display or recall issue can be traced from model output to Host validation and the active Journey projection.

## Tavern surface

The entrance and active Journey use different emphasis:

```text
Tavern entrance: characters | journeys | attached World Books

Journey header: primary Character | World Book | Journey | Scene | connection | Journey actions

Character and World Book panel Story stage and composer      Journey state panel
Character portrait and card    complete Story segments        current Scene
attached World Book preview    one shared input path          Character states
selected Lorebook entries      streaming GM generation        story state and memory
```

The Story stage is the visual center. It shows the primary Character, the current Scene derived from the attached World Book context and Journey state, and the latest story context near the top, keeps the transcript readable as prose, and gives each Story segment enough separation to follow changes in time, place, and participants. It does not expose prompt assembly, provider fields, or workspace terminology in the primary flow.

### Character panel

The Character panel puts the primary Character first, then lists optional configured and encountered characters. It does not imply that the primary character is the only speaker or that the player is locked to one relationship. Any Character may appear, leave, act, or speak several times in one Story segment.

Selecting a Character opens a detail view with its available source fields and Journey facts. Field names may include identity, role, secret, or player-specific information when the source or a later labeled fact provides them; the UI does not require every field. An existing World Person keeps the stable ID derived from its snapshot name, while its latest `Name` fact supplies the display name, so renames do not create duplicate people. GM-only plans and other characters' private knowledge remain outside the player view.

### World panel

The attached World Book panel gives the Journey a persistent sense of place without replacing the Character panel. It summarizes the current location, time, weather or other relevant conditions, active events, and the attached or selected Lorebook entries. World Book entries are presented as source material and activation status, not as a long technical prompt inspector.

The panel opens model- or fallback-normalized World Book entries, World Person details, and active world facts without replacing the Story stage. The player can return to the narrative with the current Scene and composer intact. Normalized fields retain source asset and entry identifiers; the current display uses deterministic source labels when no model route or valid model result is available. Later labeled facts enter the corresponding detail's dynamic fields directly, so a new concept such as `Secret` or `Player-specific` does not require a predefined schema.

## Configuration

Configuration is grouped by the three things the player is actually choosing: Character Cards, World Book, and other Journey settings. The default view exposes only settings that affect the experience immediately; technical sampling controls live in an advanced section.

### Character configuration

- Character Cards and their order in the starting cast.
- The required primary Character Card and optional supporting Character Cards.
- Player identity or persona, including the name and information the GM may use for the player.
- Authored opening greeting selection when a card supplies alternatives.
- The attached World Book or embedded `character_book` is reviewed here as part of the selected Character Card, not as an independent Journey root.
- Character-specific narrative constraints carried by the card, without exposing raw prompt assembly in the main flow.

### World Book configuration

- The Character Card's attached Character Book or World Book, enabled by default when the card supplies it.
- Additional World Books enabled for the Journey.
- World Book entry groups or individual entries when the author permits player selection.
- Whether an entry is available as authored setting material or only as GM context.
- Attached World Book and Journey defaults for location, time, and starting conditions.

### Other Journey configuration

- Model provider, model, and model-supported reasoning effort.
- Creativity, presented as Temperature, with the product default chosen by the profile.
- Reply length, presented as the maximum generated Story segment length.
- Streaming and the narrative style or GM instruction supplied by the Journey.
- Branch, regeneration, continuation, and transcript display preferences that belong to this Journey.

### Advanced and diagnostic configuration

Top P, Top K, Min P, Top A, frequency penalty, presence penalty, repetition penalty, and seed are available only in advanced settings when the selected provider supports them. Stop strings, prompt order, context size, World Book scan depth, recursive scanning, and World Book token budget are runtime controls with provider or profile defaults; the main UI does not make players manage token arithmetic.

Prompt Inspector, exact model requests, retrieval decisions, source events, and continuity diagnostics belong to a separate GM or developer view. They are available for debugging without changing the player's primary experience into a workbench.

## Journey continuity

- A Journey has an independent event history and state projection even when it references the same Character Card or World/Lorebook assets as another Journey.
- The source library is immutable; newly imported assets affect future selections. The active Journey keeps the Character Card and World Book baseline recorded by its selection event; its automatic fact projection is changed only by its own accepted or user correction events.
- Changing the primary Character Card, attached World Book baseline, or generation configuration after meaningful story content exists creates a new Journey branch or a new Journey, rather than silently rewriting the existing story.
- Regeneration and historical edits invalidate downstream Story segments, state changes, and context decisions derived from the edited point.
- The current Character roster and World state are projections of the selected Journey branch. They are not a second database maintained by the browser.

## Ownership and boundaries

`ui-tavern` owns the character-first entrance, Journey presentation, responsive panels, Character and attached World Book detail views, dynamic fact controls, and player-facing configuration state. `dsh-tavern-host` owns asset storage, Character Card and attached-context resolution, Journey selection, fact event persistence and projection, World Book activation, state validation, memory, branching, and the model-visible context projection. `ui-conversation` owns the shared transcript transport, draft persistence, streaming, cancellation, and composer mechanics.

The Tavern surface never creates one request per Character, a second transcript, a second composer, or a browser-only story state. The GM narrative loop may later gain optional planning or continuity passes, but those are runtime optimizations and must not change the player's model: one player input advances one GM-authored Story segment.

## Visual direction

The visual language is an intimate story space with a restrained tavern atmosphere, not an IDE. The first viewport uses the primary Character's real portrait, a Lorebook-provided scene image when available, the Character name, current Scene, and the latest Story segment as immediate orientation.

- Use layered dark neutrals with restrained copper, red, or teal accents; avoid a single-hue dashboard and avoid gradients as the primary atmosphere.
- Keep the Story stage open and typographic. Use framed cards only for repeated Character items, detail views, and modal tools; page sections remain unframed.
- Keep technical controls behind compact icon actions, drawers, or a separate diagnostic view. Do not show "open workspace", Prompt Inspector, or asset IDs as primary navigation.
- Use portraits and Lorebook-associated scene media where they communicate the actual Character or setting. Empty states and loading states retain the same visual identity instead of returning to generic DSH workbench chrome.

## Scope

### Current runtime

- Character library and Journey library, with the World/Lorebook library available as a secondary attached-asset view.
- Character Card and attached World Book selection as the primary setup flow.
- Player identity, a small set of Journey settings, opening greeting, and durable transcript reload.
- One model request per player input through the shared conversation path, with complete `story` text and optional `updates`.
- Journey-local natural-language person and world facts with append-only projection, correction, revocation, and next-request recall.
- Immersive Character and World Book detail views with dynamic source fields and no manual fact-creation control.
- Product-facing generation settings with advanced sampling and diagnostic controls separated from the story flow.

### Deferred layers

- Optional block attribution, encountered Character roster, current Scene summaries, and richer story presentation.
- Repeat normalization after authored source edits, richer authored Journey-local asset editing, observer-specific memory retrieval, and richer World Info execution when a concrete use case justifies them.
- Optional continuity repair and long-story planning when a profile explicitly enables the extra cost.
- Media generation, TTS, RAG, and executable ecosystem extensions as separate capabilities.

## Acceptance signals

1. The first Tavern screen opens on Characters and resumable Journeys, with no DSH "open workspace" action in the primary flow.
2. Creating a Journey requires a primary Character Card and presents its attached World Book/Lorebook entries, optional supporting cards, and other Journey configuration as recognizable groups.
3. A World-only browse action routes to a Character Card and cannot create a characterless Journey.
4. A player input results in one GM model generation and one Story segment that can contain narration plus actions and dialogue for multiple Characters.
5. A structured GM response can append a natural-language person or world fact, and the next request contains the active projection with source event provenance.
6. The transcript does not require a current speaker, and the GM does not silently choose the player's actions, speech, or inner feelings.
7. Multiple Journeys referencing one Character Card and its attached World/Lorebook assets retain independent transcripts, scenes, character facts, memories, and branches.
8. The active Journey visibly presents the primary Character, attached World Book/Lorebook context, current Scene, Character roster, and player-visible Character details without replacing the Story stage; selected source fields are model- or fallback-normalized and retain their source identifiers.
9. Advanced sampling controls and Prompt Inspector remain reachable but do not dominate the primary Tavern experience.
10. Empty, loading, error, streaming, regeneration, branch, narrow, and detail-view states remain usable without overlapping text or controls.
