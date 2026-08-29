/** Client-safe wire vocabulary for the Tavern asset Host service. */

import type {
  AssetSelection,
  AssetId,
  CharacterAsset,
  PromptAssetBaseline,
  TavernAsset,
  WorldInfoAsset,
} from '@deepseek-ai/dsh-tavern-assets/types'
import type {
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

/** Durable selection state projected from one session's latest asset event. */
export interface TavernSessionSelection {
  readonly selection: AssetSelection
  readonly baseline: PromptAssetBaseline
  readonly characterName: string | null
  readonly worldInfoNames: readonly string[]
}

/** A durable memory entry shown to the model when enabled. */
export interface TavernMemoryEntry {
  /** Stable id within the session. */
  readonly id: string
  /** Text retained as story context. */
  readonly text: string
  /** Context tier controlling prompt stability. */
  readonly level: 'pinned' | 'persistent' | 'scene'
  /** Whether this memory remains eligible for projection. */
  readonly enabled: boolean
  /** Optional user-facing label. */
  readonly label: string | null
}

/** Input accepted by the memory editor. */
export interface TavernMemoryInput {
  readonly id?: string
  readonly text: string
  readonly level?: TavernMemoryEntry['level']
  readonly label?: string | null
}

/** Durable memory event payload. */
export interface TavernMemoryEvent {
  readonly operation: 'upsert' | 'remove'
  readonly memory: TavernMemoryEntry
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
