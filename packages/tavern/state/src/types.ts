/**
 * Canonical types for structured Tavern story state and its append-only records.
 * This file contains no runtime code so consumers can import the model without
 * loading the projection implementation.
 * @module @deepseek-ai/dsh-tavern-state/types
 */

declare const SourceEventIdBrand: unique symbol
declare const StoryBranchIdBrand: unique symbol
declare const StoryEntityIdBrand: unique symbol
declare const SwipeGroupIdBrand: unique symbol
declare const SwipeCandidateIdBrand: unique symbol

/** A JSON value accepted by a durable Tavern state record. */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue }

/** A JSON object used for lossless extension data. */
export type JsonObject = { readonly [key: string]: JsonValue }

/** An opaque id of the Session event that produced a state record. */
export type SourceEventId = string & { readonly [SourceEventIdBrand]: 'SourceEventId' }

/** An opaque branch id used to select a story projection. */
export type StoryBranchId = string & { readonly [StoryBranchIdBrand]: 'StoryBranchId' }

/** An opaque id for a state entity such as an item, character, or oath. */
export type StoryEntityId = string & { readonly [StoryEntityIdBrand]: 'StoryEntityId' }

/** An opaque id for one assistant-candidate group. */
export type SwipeGroupId = string & { readonly [SwipeGroupIdBrand]: 'SwipeGroupId' }

/** An opaque id for one assistant candidate within a swipe group. */
export type SwipeCandidateId = string & { readonly [SwipeCandidateIdBrand]: 'SwipeCandidateId' }

/** The sources that may authorize a canonical structured-state update. */
export type StoryStateAuthorityKind = 'user' | 'gm' | 'authored-asset' | 'observed' | 'model-candidate'

/** Authority metadata retained beside each state change. */
export interface StoryStateAuthority {
  readonly kind: StoryStateAuthorityKind
  readonly actorId?: StoryEntityId
  readonly extensions: JsonObject
}

/** Validity metadata for an append-only state record. */
export type StoryStateRecordValidity =
  | { readonly status: 'valid'; readonly extensions: JsonObject }
  | {
    readonly status: 'invalid'
    readonly reason: string
    readonly supersededBy?: SourceEventId
    readonly extensions: JsonObject
  }

/** Canonical location value projected into story state. */
export interface StoryLocation {
  readonly id: StoryEntityId
  readonly name: string
  readonly description?: string
  readonly extensions: JsonObject
}

/** Canonical story time value. `value` is owned by the selected calendar. */
export interface StoryTime {
  readonly value: string
  readonly calendar?: string
  readonly timezone?: string
  readonly extensions: JsonObject
}

/** One canonical inventory entry. Quantity must be a finite positive number. */
export interface StoryInventoryItem {
  readonly id: StoryEntityId
  readonly name: string
  readonly quantity: number
  readonly unit?: string
  readonly ownerId?: StoryEntityId
  readonly extensions: JsonObject
}

/** One subject's current health summary. */
export interface StoryHealth {
  readonly subjectId: StoryEntityId
  readonly status: string
  readonly severity?: number
  readonly extensions: JsonObject
}

/** One directed relationship between two story entities. */
export interface StoryRelationship {
  readonly subjectId: StoryEntityId
  readonly targetId: StoryEntityId
  readonly phase?: string
  readonly affinity?: number
  readonly trust?: number
  readonly extensions: JsonObject
}

/** One subject's current cultivation state. */
export interface StoryCultivation {
  readonly subjectId: StoryEntityId
  readonly realm: string
  readonly stage?: string
  readonly level?: number
  readonly progress?: number
  readonly extensions: JsonObject
}

/** One oath that is currently active in the canonical story state. */
export interface StoryOath {
  readonly id: StoryEntityId
  readonly text: string
  readonly subjectId?: StoryEntityId
  readonly status: 'active' | 'fulfilled' | 'broken'
  readonly extensions: JsonObject
}

/** The canonical JSON state reconstructed from accepted state records. */
export interface StoryState {
  readonly version: 1
  readonly branchId: StoryBranchId
  readonly location: StoryLocation | null
  readonly time: StoryTime | null
  readonly inventory: readonly StoryInventoryItem[]
  readonly health: readonly StoryHealth[]
  readonly relationships: readonly StoryRelationship[]
  readonly cultivation: readonly StoryCultivation[]
  readonly activeOaths: readonly StoryOath[]
  readonly extensions: JsonObject
}

/** A discriminated append-only mutation of one canonical state field. */
export type StoryStateChange =
  | { readonly kind: 'location.set'; readonly location: StoryLocation; readonly extensions: JsonObject }
  | { readonly kind: 'location.clear'; readonly extensions: JsonObject }
  | { readonly kind: 'time.set'; readonly time: StoryTime; readonly extensions: JsonObject }
  | { readonly kind: 'time.clear'; readonly extensions: JsonObject }
  | { readonly kind: 'inventory.upsert'; readonly item: StoryInventoryItem; readonly extensions: JsonObject }
  | { readonly kind: 'inventory.remove'; readonly itemId: StoryEntityId; readonly extensions: JsonObject }
  | { readonly kind: 'health.upsert'; readonly health: StoryHealth; readonly extensions: JsonObject }
  | { readonly kind: 'health.remove'; readonly subjectId: StoryEntityId; readonly extensions: JsonObject }
  | { readonly kind: 'relationship.upsert'; readonly relationship: StoryRelationship; readonly extensions: JsonObject }
  | {
    readonly kind: 'relationship.remove'
    readonly subjectId: StoryEntityId
    readonly targetId: StoryEntityId
    readonly extensions: JsonObject
  }
  | { readonly kind: 'cultivation.upsert'; readonly cultivation: StoryCultivation; readonly extensions: JsonObject }
  | { readonly kind: 'cultivation.remove'; readonly subjectId: StoryEntityId; readonly extensions: JsonObject }
  | { readonly kind: 'oath.upsert'; readonly oath: StoryOath; readonly extensions: JsonObject }
  | { readonly kind: 'oath.remove'; readonly oathId: StoryEntityId; readonly extensions: JsonObject }
  | {
    readonly kind: 'extension.set'
    readonly namespace: string
    readonly key: string
    readonly value: JsonValue
    readonly extensions: JsonObject
  }
  | { readonly kind: 'extension.remove'; readonly namespace: string; readonly key: string; readonly extensions: JsonObject }

/** A durable change with source, branch, validity, and authority metadata. */
export interface StoryStateChangeRecord {
  readonly sourceEventId: SourceEventId
  readonly branchId: StoryBranchId
  readonly sequence: number
  readonly validity: StoryStateRecordValidity
  readonly authority: StoryStateAuthority
  readonly change: StoryStateChange
  readonly extensions: JsonObject
}

/** The branch and ancestor chain used for one state projection. */
export interface StoryStateProjectionOptions {
  readonly branchId: StoryBranchId
  /** Root-to-selected branch ids. Omission projects records from `branchId` only. */
  readonly branchLineage?: readonly StoryBranchId[]
}

/** A reason why one record could not affect the selected state. */
export type StoryStateProjectionIssueCode =
  | 'invalid-branch-selection'
  | 'invalid-record'
  | 'invalid-sequence'
  | 'duplicate-source-event'
  | 'stale-branch'
  | 'invalid-validity'
  | 'insufficient-authority'
  | 'invalid-update'

/** Diagnostic emitted while projecting records. */
export interface StoryStateProjectionIssue {
  readonly code: StoryStateProjectionIssueCode
  readonly message: string
  readonly sourceEventId?: SourceEventId
  readonly branchId?: StoryBranchId
}

/** The accepted state, applied records, and rejected record diagnostics. */
export interface StoryStateProjection {
  readonly branchId: StoryBranchId
  readonly state: StoryState
  readonly appliedRecords: readonly StoryStateChangeRecord[]
  readonly rejectedRecords: readonly StoryStateChangeRecord[]
  readonly issues: readonly StoryStateProjectionIssue[]
}

/** Why an assistant candidate was added to a swipe group. */
export type SwipeCandidateOrigin = 'initial' | 'swipe' | 'regenerate'

/** One assistant response retained as a selectable candidate. */
export interface SwipeAssistantCandidate {
  readonly candidateId: SwipeCandidateId
  readonly assistantEventId: SourceEventId
  readonly origin: SwipeCandidateOrigin
  /** Detached assistant content; its JSON fields remain available to consumers. */
  readonly content: JsonValue
  readonly extensions: JsonObject
}

/** The projected candidates and current selection for one assistant turn. */
export interface SwipeGroupState {
  readonly groupId: SwipeGroupId
  readonly candidates: readonly SwipeAssistantCandidate[]
  readonly currentCandidateId: SwipeCandidateId | null
}

/** Durable swipe state reconstructed from accepted candidate records. */
export interface SwipeState {
  readonly version: 1
  readonly branchId: StoryBranchId
  readonly groups: readonly SwipeGroupState[]
  readonly extensions: JsonObject
}

/** Append-only record that adds or selects a retained assistant candidate. */
export type SwipeRecord = {
  readonly sourceEventId: SourceEventId
  readonly branchId: StoryBranchId
  readonly sequence: number
  readonly validity: StoryStateRecordValidity
  readonly authority: StoryStateAuthority
  readonly extensions: JsonObject
} & (
  | {
    readonly kind: 'candidate.add'
    readonly groupId: SwipeGroupId
    readonly candidate: SwipeAssistantCandidate
  }
  | {
    readonly kind: 'candidate.select'
    readonly groupId: SwipeGroupId
    readonly candidateId: SwipeCandidateId
  }
)

/** The branch and ancestor chain used for one swipe projection. */
export interface SwipeProjectionOptions {
  readonly branchId: StoryBranchId
  /** Root-to-selected branch ids. Omission projects records from `branchId` only. */
  readonly branchLineage?: readonly StoryBranchId[]
}

/** A reason why one swipe record could not affect the selected projection. */
export type SwipeProjectionIssueCode =
  | 'invalid-branch-selection'
  | 'invalid-record'
  | 'invalid-sequence'
  | 'duplicate-source-event'
  | 'stale-branch'
  | 'invalid-validity'
  | 'insufficient-authority'
  | 'duplicate-candidate'
  | 'candidate-not-found'
  | 'invalid-update'

/** Diagnostic emitted while projecting durable swipe records. */
export interface SwipeProjectionIssue {
  readonly code: SwipeProjectionIssueCode
  readonly message: string
  readonly sourceEventId?: SourceEventId
  readonly branchId?: StoryBranchId
}

/** The rebuilt swipe state, accepted records, rejected records, and diagnostics. */
export interface SwipeProjection {
  readonly branchId: StoryBranchId
  readonly state: SwipeState
  readonly appliedRecords: readonly SwipeRecord[]
  readonly rejectedRecords: readonly SwipeRecord[]
  readonly issues: readonly SwipeProjectionIssue[]
}

/** Compact model-facing state with extension and verbose description fields removed. */
export interface CompactPublicStoryState {
  readonly location: { readonly id: StoryEntityId; readonly name: string } | null
  readonly time: { readonly value: string; readonly calendar?: string } | null
  readonly inventory: readonly {
    readonly id: StoryEntityId
    readonly name: string
    readonly quantity: number
    readonly unit?: string
  }[]
  readonly health: readonly { readonly subjectId: StoryEntityId; readonly status: string; readonly severity?: number }[]
  readonly relationships: readonly {
    readonly subjectId: StoryEntityId
    readonly targetId: StoryEntityId
    readonly phase?: string
    readonly affinity?: number
    readonly trust?: number
  }[]
  readonly cultivation: readonly {
    readonly subjectId: StoryEntityId
    readonly realm: string
    readonly stage?: string
    readonly level?: number
    readonly progress?: number
  }[]
  readonly activeOaths: readonly {
    readonly id: StoryEntityId
    readonly subjectId?: StoryEntityId
    readonly text: string
    readonly status: StoryOath['status']
  }[]
}
