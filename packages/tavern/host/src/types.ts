/** Client-safe wire vocabulary for the Tavern asset Host service. */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { CompactionId } from '@deepseek-ai/dsh-compaction'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  AssetSelection,
  AssetId,
  CharacterAsset,
  PromptAssetBaseline,
  TavernAsset,
  WorldInfoAsset,
} from '@deepseek-ai/dsh-tavern-assets/types'
import type {
  JsonValue,
  StoryStateAuthority,
  StoryStateChange,
  StoryStateChangeRecord,
  StoryStateProjection,
  StoryStateRecordValidity,
  SwipeAssistantCandidate,
  SwipeCandidateId,
  SwipeGroupId,
} from '@deepseek-ai/dsh-tavern-state/types'

export type {
  AssetId,
  AssetSelection,
  AssetSourceReference,
  CharacterAsset,
  PromptAssetBaseline,
  TavernAsset,
  WorldInfoAsset,
} from '@deepseek-ai/dsh-tavern-assets/types'
export type {
  StoryState,
  StoryStateAuthority,
  StoryStateChange,
  StoryStateChangeRecord,
  StoryStateProjection,
} from '@deepseek-ai/dsh-tavern-state/types'
export type { CompactionId } from '@deepseek-ai/dsh-compaction'

/** A source-tracked canonical character field exposed by the Host. */
export interface CanonicalCharacterField {
  readonly label: string
  readonly value: string
  readonly sourceEntryId?: string
}

/** A source-tracked canonical World Book entry exposed by the Host. */
export interface CanonicalWorldEntry {
  readonly theme: string
  readonly text: string
  readonly suggestedKeys: readonly string[]
  readonly sourceEntryId: string
  readonly role: 'npc' | 'world' | 'protagonist'
}

/** Canonical, replaceable asset view retained beside the original payload. */
export interface CanonicalAssetView {
  readonly assetId: string
  readonly kind: TavernAsset['kind']
  readonly characterFields: readonly CanonicalCharacterField[]
  readonly protagonistFields: readonly CanonicalCharacterField[]
  readonly worldEntries: readonly CanonicalWorldEntry[]
  readonly openingPrompt?: string
  readonly greeting?: string
  readonly noise: readonly { readonly sourceEntryId: string; readonly reason: 'duplicate' | 'unclassifiable' | 'stale' }[]
  readonly uncleaned: boolean
}

/** Route used by the optional asset-cleaning model pass. */
export interface TavernAssetCleaningRoute {
  readonly provider: string
  readonly model: string
}

/** Durable state of the derived canonical view beside one source asset. */
export interface TavernAssetCleaningRecord {
  /** `fallback` is conservative import-time output; `model` is an accepted model pass. */
  readonly status: 'fallback' | 'model' | 'confirmed'
  readonly origin: 'heuristic' | 'model'
  readonly view: CanonicalAssetView
  readonly route?: TavernAssetCleaningRoute
  readonly error?: string
}

/** Asset plus its current canonical view returned by cleaning Remotes. */
export interface TavernAssetCleaningPreview {
  readonly asset: TavernAsset
  readonly record: TavernAssetCleaningRecord
  readonly confirmed: boolean
}

/** Stable identifier assigned by the Host to one Journey fact. */
export type TavernFactId = Branded<'TavernFactId'>

/** Stable identifier used for a world person in one Journey. */
export type TavernPersonId = Branded<'TavernPersonId'>

/** Single entity target stored by one immutable fact event. */
export type TavernFactTarget = 'person' | 'world'

/** Collection key used by the GM updates envelope before event expansion. */
export type TavernFactUpdateScope = 'people' | 'world'

/** Source authority used to order and audit one Journey fact. */
export type TavernFactAuthority = 'model-candidate' | 'observed' | 'authored-asset' | 'user' | 'gm'

/** Whether a fact may participate in hard-fact conflict detection. */
export type TavernFactKind = 'soft' | 'hard'

/** Non-optional display provenance for one projected fact. */
export type TavernFactSource =
  | { readonly kind: 'asset'; readonly assetId: string; readonly entryId?: string }
  | { readonly kind: 'assistant'; readonly assistantSeq: number }
  | { readonly kind: 'user' }
  | { readonly kind: 'system' }

/** One model-requested mutation of a Journey fact collection. */
export interface TavernFactOperation {
  readonly op: 'add' | 'replace' | 'remove'
  readonly factId?: string
  readonly replacesFactId?: string
  readonly text?: string
  /** Optional arbitrary display-column label; the fact text remains natural language. */
  readonly label?: string
  /** Optional conflict class; absent operations are classified from their label. */
  readonly kind?: TavernFactKind
  readonly subjectKey?: string
  readonly extractionId?: string
  readonly explicit?: boolean
}

/** Optional automatic fact mutations carried by one GM response. */
export interface TavernGmUpdates {
  readonly people?: Readonly<Record<string, readonly TavernFactOperation[]>>
  readonly world?: readonly TavernFactOperation[]
}

/** One untrusted operation candidate extracted from a GM updates envelope. */
export interface TavernGmUpdateCandidate {
  readonly target: TavernFactUpdateScope
  readonly personId?: string
  readonly operation: {
    readonly op: string
    readonly factId?: string
    readonly replacesFactId?: string
    readonly text?: string
    readonly label?: string
    readonly kind?: string
    readonly subjectKey?: string
    readonly extractionId?: string
    readonly explicit?: boolean
  } | undefined
}

/** Parsed operation candidates and an optional envelope-level rejection. */
export interface TavernGmUpdatesParseResult {
  readonly operations: readonly TavernGmUpdateCandidate[]
  readonly rejection?: string
}

/** The model-visible response envelope returned by one GM request. */
export interface TavernGmResponse {
  readonly story: string
  /** JSON value from the model; Host validation owns the accepted update vocabulary. */
  readonly updates?: JsonValue
}

/** Durable parsed GM envelope retained when the visible assistant message is reduced to story text. */
export interface TavernGmResponseEvent {
  /** Sequence of the assistant message that produced this envelope. */
  readonly assistantSeq: number
  /** Conversation turn associated with the assistant response. */
  readonly turn: number
  /** Parsed story and optional automatic updates. */
  readonly response: TavernGmResponse
}

/** Parsed GM response with its durable event sequence for UI audit views. */
export interface TavernGmResponseInspection extends TavernGmResponseEvent {
  /** Sequence of the `tavern/gm-response` event that retained this envelope. */
  readonly eventSeq: number
}

/** One active natural-language fact projected from the Journey log. */
export interface TavernFactEntry {
  readonly factId: TavernFactId
  readonly target: TavernFactTarget
  readonly personId?: TavernPersonId
  readonly text: string
  /** Optional arbitrary display-column label supplied by the GM. */
  readonly label?: string
  /** Branch id; optional only for legacy client fixtures and pre-v1 logs. */
  readonly branch?: string
  /** Runtime-produced events always carry authority; optional for legacy wire readers. */
  readonly authority?: TavernFactAuthority
  /** Runtime-produced events always carry kind; optional for legacy wire readers. */
  readonly kind?: TavernFactKind
  /** Optional journey-derived key used to fold one entity dimension. */
  readonly subjectKey?: string
  /** Extraction batch that produced this fact, when it was observed. */
  readonly extractionId?: string
  /** Whether an observed fact came from an explicit player statement. */
  readonly explicit?: boolean
  /** Fact linked as the predecessor of this projection. */
  readonly replacesFactId?: string
  /** Structured provenance for rendering without optional-field interpolation. */
  readonly source: TavernFactSource
  readonly sourceAssetId?: string
  readonly sourceEntryId?: string
  readonly eventSeq: number
  readonly assistantSeq?: number
  readonly turn?: number
  /** The unresolved hard-fact conflicts involving this active entry. */
  readonly conflicts?: readonly TavernFactConflict[]
}

/** Deterministic Journey-local automatic fact projection. */
export interface TavernFactProjection {
  readonly people: Readonly<Record<string, readonly TavernFactEntry[]>>
  readonly world: readonly TavernFactEntry[]
  /** Hard-fact conflicts retained for the audit and conflict-resolution views. */
  readonly conflicts?: readonly TavernFactConflict[]
}

/** One unresolved hard-fact disagreement retained by the projection. */
export interface TavernFactConflict {
  readonly id: string
  readonly factId: TavernFactId
  readonly previousFactId: TavernFactId
  readonly label: string
  readonly previousText: string
  readonly incomingText: string
  readonly previousAuthority: TavernFactAuthority
  readonly incomingAuthority: TavernFactAuthority
  readonly subjectKey?: string
  readonly previousExplicit?: boolean
  readonly incomingExplicit?: boolean
  readonly previousEventSeq: number
  readonly incomingEventSeq: number
}

/** One detail field projected from a Journey asset or a Journey fact. */
export interface TavernJourneyField {
  /** Stable field identifier. Fact fields use their fact identifier. */
  readonly id: string
  /** User-facing dynamic column label. */
  readonly label: string
  /** Natural-language field value. */
  readonly value: string
  /** Source asset when this field came from an imported snapshot. */
  readonly sourceAssetId?: AssetId
  /** Source World Book entry when this field came from an imported snapshot. */
  readonly sourceEntryId?: AssetId
  /** Fact that supplied this field, when it is Journey-local. */
  readonly factId?: TavernFactId
  /** Origin of the field. */
  readonly origin: 'asset' | 'fact'
}

/** One person shown by the current Journey detail projection. */
export interface TavernJourneyPerson {
  /** Stable Journey person identifier. */
  readonly personId: TavernPersonId
  /** Latest display name, including Journey-local Name facts. */
  readonly name: string
  /** Source entry, or null for a person introduced by a Journey fact. */
  readonly source: { readonly assetId: AssetId; readonly entryId: AssetId } | null
  /** Source content followed by active Journey-local facts. */
  readonly content: string
  /** Source and Journey-local fields in display order. */
  readonly fields: readonly TavernJourneyField[]
  /** Active facts retained for edit and audit links. */
  readonly facts: readonly TavernFactEntry[]
}

/** Latest Journey-local asset detail projection derived from one selection and its facts. */
export interface TavernJourneyAssetProjection extends TavernJourneySelection {
  /** People from source World Book entries plus Journey-local additions. */
  readonly people: readonly TavernJourneyPerson[]
  /** Character-card fields, including Journey-local fields for the selected character. */
  readonly characterFields: readonly TavernJourneyField[]
  /** World-level fields, including fields introduced by labeled facts. */
  readonly worldFields: readonly TavernJourneyField[]
  /** Active automatic facts used to build this projection. */
  readonly facts: TavernFactProjection
  /** Durable Character Card opening greeting rendered before transcript messages. */
  readonly openingGreeting?: TavernGreetingEvent
}

/** Accepted or rejected automatic fact operation retained for audit and replay. */
export interface TavernFactEvent {
  readonly branch: string
  readonly target: TavernFactTarget
  readonly personId?: string
  readonly operation: 'add' | 'replace' | 'remove'
  readonly factId?: string
  readonly text?: string
  /** Optional arbitrary display-column label supplied by the GM. */
  readonly label?: string
  /** Source authority for this immutable event. */
  /** Runtime-produced events always carry authority; optional for old logs. */
  readonly authority?: TavernFactAuthority
  /** Soft facts may coexist; hard facts participate in conflict detection. */
  /** Runtime-produced events always carry kind; optional for old logs. */
  readonly kind?: TavernFactKind
  /** Structure key used to fold one entity dimension without rewriting text. */
  readonly subjectKey?: string
  /** Extraction batch that produced this append-only event. */
  readonly extractionId?: string
  /** Explicit player setting or retcon, as opposed to narrative inference. */
  readonly explicit?: boolean
  /** Asset that supplied a normalized authored fact. */
  readonly sourceAssetId?: string
  /** World Book entry that supplied a normalized authored fact. */
  readonly sourceEntryId?: string
  /** Assistant message sequence that produced this event, when applicable. */
  readonly assistantSeq?: number
  /** Conversation turn that produced this event, when applicable. */
  readonly turn?: number
  /** Stable retry key for one parsed GM response within a turn. */
  readonly idempotencyKey?: string
  /** Requested predecessor when a hard replacement is retained as a new fact. */
  readonly replacesFactId?: string
  readonly accepted: boolean
  readonly rejection?: string
  /** Conflict ids explicitly cleared by a later user decision. */
  readonly resolvesConflictIds?: readonly string[]
  /** Sequence threshold that caused an append-only rollback remove event. */
  readonly revertedFromSeq?: number
}

/** Resolved assets and prompt baseline for one Journey. */
export interface TavernJourneySelection {
  readonly selection: AssetSelection
  readonly baseline: PromptAssetBaseline
  readonly character: CharacterAsset | null
  readonly worldInfo: readonly WorldInfoAsset[]
  readonly characterName: string | null
  readonly worldInfoNames: readonly string[]
  /** Optional player-facing identity retained with the Journey selection. */
  readonly playerIdentity?: string | null
  /** Host-derived canonical views; omitted from session selection wire events. */
  readonly canonical?: {
    readonly character?: CanonicalAssetView
    readonly worldInfo: readonly CanonicalAssetView[]
  }
}

/** Append-only metadata for a Journey-local source edit. */
export interface TavernAssetsEditedEvent {
  readonly selection: AssetSelection
  readonly playerIdentity?: string | null
  /** Legacy detached fields accepted only when replaying old logs. */
  readonly baseline?: PromptAssetBaseline
  readonly character?: CharacterAsset | null
  readonly worldInfo?: readonly WorldInfoAsset[]
  readonly characterName?: string | null
  readonly worldInfoNames?: readonly string[]
  /** Asset kind changed by the local Journey edit. */
  readonly editedKind: 'character' | 'world-info'
  /** Asset ID changed by the local Journey edit. */
  readonly editedAssetId: AssetId
}

/** User correction for an existing Journey fact. */
export interface TavernFactEditInput {
  readonly factId: string
  readonly text: string
}

/** User revocation for an existing Journey fact. */
export interface TavernFactRemovalInput {
  readonly factId: string
}

/** Fact projection and audit records returned to the Tavern client. */
export interface TavernFactInspection {
  readonly projection: TavernFactProjection
  readonly records: readonly { readonly seq: number; readonly data: TavernFactEvent }[]
}

/** Scope whose dynamic ledger sections can be configured by a Journey user. */
export type TavernSectionConfigScope = 'character' | 'world'

/** Append-only operation applied to one dynamic ledger section. */
export type TavernSectionConfigOperation = 'add' | 'rename' | 'remove' | 'reorder' | 'restore'

/** User request converted into one durable section configuration event. */
export interface TavernSectionConfigInput {
  readonly scope: TavernSectionConfigScope
  readonly operation: TavernSectionConfigOperation
  /** Existing section id for all operations except add. */
  readonly sectionId?: string
  /** Required for add and rename. */
  readonly name?: string
  /** Complete or partial stable order for reorder. */
  readonly order?: readonly string[]
}

/** Durable section configuration event; it changes presentation projection only. */
export interface TavernSectionConfigEvent {
  readonly branch: string
  readonly scope: TavernSectionConfigScope
  readonly sectionId: string
  readonly operation: TavernSectionConfigOperation
  readonly name?: string
  readonly order?: readonly string[]
}

/** Configuration projection for one dynamic ledger scope. */
export interface TavernSectionConfigScopeProjection {
  readonly names: Readonly<Record<string, string>>
  readonly hidden: readonly string[]
  readonly order: readonly string[]
}

/** Current dynamic ledger configuration reconstructed from the Session log. */
export interface TavernSectionConfigProjection {
  readonly character: TavernSectionConfigScopeProjection
  readonly world: TavernSectionConfigScopeProjection
}

/** Section configuration projection together with its append-only audit records. */
export interface TavernSectionConfigInspection {
  readonly projection: TavernSectionConfigProjection
  readonly records: readonly { readonly seq: number; readonly data: TavernSectionConfigEvent }[]
}

/** Result returned after a Journey selection has been normalized into facts. */
export interface TavernBootstrapJourneyResult {
  /** The selected source assets resolved for this Journey. */
  readonly selection: TavernSessionSelection
  /** Active facts reconstructed from the append-only Journey stream. */
  readonly factProjection: TavernFactProjection
}

/** Durable opening greeting selected from a Character Card for one Session. */
export interface TavernGreetingEvent {
  readonly characterId: AssetId
  readonly characterName: string
  readonly text: string
  readonly selectionSeq: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** The first Character Card greeting displayed and projected into later prompts. */
    'tavern/greeting': TavernGreetingEvent
    /** An accepted or rejected GM fact operation linked to its assistant reply. */
    'tavern/fact': TavernFactEvent
    /** Parsed GM response retained for fact recovery after transcript projection. */
    'tavern/gm-response': TavernGmResponseEvent
    /** Audit metadata for the normalization pass that produced authored facts. */
    'tavern/assets-normalized': TavernAssetsNormalizedEvent
    /** User-owned dynamic ledger section configuration. */
    'tavern/section-config': TavernSectionConfigEvent
    /** Optional memory/compaction capability status. */
    'tavern/memory-capability': TavernMemoryCapabilityEvent
    /** Durable fact-search result shown to the model. */
    'tavern/fact-search': TavernFactSearchEvent
    /** Atomic tombstones for history-derived memory facts. */
    'tavern/memory-revert': TavernMemoryRevertEvent
    /** Memory extraction cursor advancement or initialization. */
    'tavern/memory-cursor': TavernMemoryCursorEvent
    /** Fork boundary used by the memory projection. */
    'tavern/memory-fork': TavernMemoryForkEvent
    /** Relation-only cleanup decisions returned by compaction. */
    'tavern/memory-cleanup': TavernMemoryCleanupEvent
  }
}

/** Source metadata supplied by the host that owns an imported document. */
export interface TavernImportSource {
  readonly kind: string
  readonly locator: string
  readonly mediaType?: string | null
  readonly digest?: string | null
}

/** Optional identity and provenance overrides for one imported document. */
export interface TavernImportOptions {
  readonly id?: string
  readonly source?: TavernImportSource
}

/** Required identity and optional provenance for a same-ID asset update. */
export interface TavernUpdateOptions {
  readonly id: string
  readonly source?: TavernImportSource
}

/** Result of importing a normalized asset into the process-local registry. */
export interface TavernImportResult<T extends TavernAsset> {
  readonly asset: T
  readonly dispose: () => void
}

/** Read-only result returned by `inspectSelection`. */
export interface TavernSelectionInspection {
  readonly selection: AssetSelection
  readonly baseline: PromptAssetBaseline
  readonly character: CharacterAsset | null
  readonly worldInfo: readonly WorldInfoAsset[]
}

/** Durable audit metadata for one normalization pass.
 *
 * The normalized values are deliberately absent. They are represented only by
 * the authored `tavern/fact` events appended by the same pass.
 */
export interface TavernAssetsNormalizedEvent {
  /** Whether authored facts came from the auxiliary model call or local fallback. */
  readonly origin: 'model' | 'heuristic'
  /** Auxiliary route used for an accepted model pass, when available. */
  readonly route?: { readonly provider: string; readonly model: string }
}

/** Durable status for an optional memory capability or its degradation. */
export interface TavernMemoryCapabilityEvent {
  readonly branch: string
  readonly capability: 'extraction' | 'compaction' | 'embedding' | 'retrieval' | 'wi-vector'
  readonly status: 'available' | 'degraded' | 'scheduled' | 'failed'
  readonly turn?: number
  readonly mode?: 'brute' | 'ann'
  readonly route?: TavernAssetCleaningRoute
  readonly reason?: string
}

/** Durable result of a model-visible fact search. */
export interface TavernFactSearchEvent {
  readonly branch: string
  readonly query: string
  readonly personId?: string
  readonly subjectKey?: string
  readonly limit: number
  readonly mode: 'brute' | 'ann'
  readonly embeddingModel?: string
  readonly degraded?: string
  readonly hits: readonly {
    readonly factId: string
    readonly text: string
    readonly score: number
    readonly eventSeq: number
  }[]
}

/** Atomic invalidation record for extraction facts tied to edited history. */
export interface TavernMemoryRevertEvent {
  readonly branch: string
  readonly sourceSeq: number
  readonly factIds: readonly string[]
  readonly extractionIds: readonly string[]
  readonly cursorBefore: number
  readonly cursorAfter: number
}

/** Cursor initialization or advancement record used by fork/replay diagnostics. */
export interface TavernMemoryCursorEvent {
  readonly branch: string
  readonly cursor: number
  readonly source: 'fork' | 'extraction' | 'revert'
  readonly extractionId?: string
  readonly span?: { readonly start: number; readonly end: number }
}

/** Visible fork lineage metadata for the memory projection and audit panel. */
export interface TavernMemoryForkEvent {
  readonly branch: string
  readonly parentBranch: string
  readonly seedLength: number
  readonly cursor: number
}

/** Relation-only cleanup decision written during a Tavern compaction. */
export interface TavernMemoryCleanupEvent {
  readonly branch: string
  readonly compactionId: string
  readonly action: 'merge-alias' | 'mark-duplicate'
  readonly evidence: readonly string[]
}

/** One plot checkpoint reconstructed from a complete Tavern compaction pair. */
export interface TavernMemoryCheckpoint {
  /** Compaction transaction that produced this checkpoint. */
  readonly compactionId: CompactionId
  /** Sequence of the log-only `compaction/summary` event. */
  readonly summarySeq: number
  /** Sequence of the replacement `user/message` checkpoint. */
  readonly checkpointSeq: number
  /** Plot text retained by the compaction provider. */
  readonly plotSummary: string
  /** Open plot threads retained by the compaction provider. */
  readonly openThreads: readonly string[]
  /** Conversation turns covered by the shadowed source messages. */
  readonly shadowedTurns: { readonly start: number; readonly end: number }
}

/** Read-only Journey memory projection returned by `inspectMemory`. */
export interface TavernMemoryInspection {
  readonly checkpoints: readonly TavernMemoryCheckpoint[]
}

/** Durable selection state projected from one session's latest asset event. */
export interface TavernSessionSelection {
  readonly selection: AssetSelection
  readonly baseline: PromptAssetBaseline
  readonly character: CharacterAsset | null
  readonly worldInfo: readonly WorldInfoAsset[]
  readonly characterName: string | null
  readonly worldInfoNames: readonly string[]
  /** Player identity supplied at Journey startup, when present. */
  readonly playerIdentity?: string | null
  /** Host-local canonical views used by the prompt projection; omitted from legacy selection events. */
  readonly canonical?: {
    readonly character?: CanonicalAssetView
    readonly worldInfo: readonly CanonicalAssetView[]
  }
}

/** Cold-session summary used by the Tavern history page. */
export interface TavernHistoryEntry {
  readonly sessionId: SessionId
  /** The resolved Journey selection used to enter the cold session immediately. */
  readonly selection: TavernSessionSelection | null
  readonly character: CharacterAsset | null
  readonly characterName: string | null
  readonly lastContent: string | null
}

/** Durable story-state event payload. */
export interface TavernStoryStateEvent {
  readonly branch: string
  readonly change: StoryStateChange
  readonly authority: StoryStateAuthority
  readonly validity: StoryStateRecordValidity
}

/** Read-only story-state inspection returned to the client. */
export interface TavernStoryStateInspection {
  readonly projection: StoryStateProjection
  readonly records: readonly StoryStateChangeRecord[]
}

/** Durable swipe candidate mutation retained beside the assistant message log. */
export type TavernSwipeEvent =
  | {
    readonly kind: 'candidate.add'
    readonly branch: string
    readonly groupId: SwipeGroupId
    readonly candidate: SwipeAssistantCandidate
    readonly authority: StoryStateAuthority
    readonly validity: StoryStateRecordValidity
  }
  | {
    readonly kind: 'candidate.select'
    readonly branch: string
    readonly groupId: SwipeGroupId
    readonly candidateId: SwipeCandidateId
    readonly authority: StoryStateAuthority
    readonly validity: StoryStateRecordValidity
  }

/** Read-only swipe state and diagnostics returned to the client. */
export interface TavernSwipeInspection {
  readonly groups: readonly TavernSwipeGroup[]
  readonly issues: readonly { readonly code: string; readonly message: string }[]
}

/** Flat wire representation of one retained assistant-candidate group. */
export interface TavernSwipeGroup {
  readonly groupId: string
  readonly currentCandidateId: string | null
  readonly candidates: readonly TavernSwipeCandidate[]
}

/** Flat wire representation of one retained assistant candidate. */
export interface TavernSwipeCandidate {
  readonly candidateId: string
  readonly origin: 'initial' | 'swipe' | 'regenerate'
  readonly text: string
}

/** User-authorized selection of one retained assistant candidate. */
export interface TavernSwipeSelectionInput {
  readonly groupId: string
  readonly candidateId: string
}

/** Request to regenerate one assistant turn from the selected candidate. */
export interface TavernRegenerateInput {
  readonly groupId: string
  readonly candidateId: string
}

/** Child session ready for inspection after one Tavern regeneration turn and persistence flush. */
export interface TavernRegenerateResult {
  readonly sessionId: import('@deepseek-ai/dsh-session/types').SessionId
}

/** Text replacement requested for one direct user message in a Tavern session. */
export interface TavernMessageEditInput {
  readonly targetSeq: number
  readonly text: string
}

/** Durable result returned after a Tavern message edit is accepted. */
export interface TavernMessageEditResult {
  readonly targetSeq: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** A durable assistant candidate addition or user selection. */
    'tavern/swipe': TavernSwipeEvent
  }
}

/** Wire-safe response returned by a character import. */
export type TavernCharacterImportResponse = CharacterAsset

/** Wire-safe response returned by a World Info import. */
export type TavernWorldInfoImportResponse = WorldInfoAsset
