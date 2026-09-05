/** Durable and derived vocabulary for Tavern Journey memory. */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable identity for one extraction attempt. */
export type MemoryExtractionId = Branded<'TavernMemoryExtractionId'>

/** Stable identity assigned to an observed memory atom. */
export type MemoryFactId = Branded<'TavernMemoryFactId'>

/** Fact target used by extraction and projection. */
export type MemoryFactTarget = 'person' | 'world'

/** Authority ordering used by the freshness fold. */
export type MemoryFactAuthority = 'model-candidate' | 'observed' | 'authored-asset' | 'user' | 'gm'

/** Whether a fact participates in the hard-fact compatibility surface. */
export type MemoryFactKind = 'soft' | 'hard'

/** One explicit alias from a source subject key to a canonical key. */
export interface MemorySubjectKeyAlias {
  readonly alias: string
  readonly canonical: string
}

/** Injectable embedding implementation used only by derived retrieval data. */
export interface EmbeddingProvider {
  /** Model label written beside every vector produced by this provider. */
  readonly model: string
  /** Provider-owned vector format version written beside every vector. */
  readonly version: string
  /** Embed one piece of derived text without changing the authoritative log. */
  embed(text: string): readonly number[]
}

/** Provenance retained by a projected fact without making the event log mutable. */
export type MemoryFactSource =
  | { readonly kind: 'asset'; readonly assetId: string; readonly entryId?: string }
  | { readonly kind: 'assistant'; readonly assistantSeq: number }
  | { readonly kind: 'user' }
  | { readonly kind: 'system' }

/** An append-only fact event. The text is never rewritten by folding. */
export interface MemoryFactEvent {
  readonly branch: string
  readonly target: MemoryFactTarget
  readonly personId?: string
  readonly operation: 'add' | 'replace' | 'remove'
  readonly factId?: string
  readonly text?: string
  readonly label?: string
  readonly authority?: MemoryFactAuthority
  readonly kind?: MemoryFactKind
  readonly subjectKey?: string
  readonly extractionId?: string
  readonly explicit?: boolean
  readonly sourceAssetId?: string
  readonly sourceEntryId?: string
  readonly assistantSeq?: number
  readonly turn?: number
  readonly idempotencyKey?: string
  readonly replacesFactId?: string
  readonly accepted: boolean
  readonly rejection?: string
  readonly resolvesConflictIds?: readonly string[]
  readonly revertedFromSeq?: number
}

/** One event with its durable log sequence. */
export interface MemoryFactRecord {
  readonly seq: number
  readonly data: MemoryFactEvent
}

/** One active fact returned by the deterministic view fold. */
export interface MemoryFactEntry {
  readonly factId: MemoryFactId
  readonly target: MemoryFactTarget
  readonly personId?: string
  readonly text: string
  readonly label?: string
  readonly branch: string
  readonly authority: MemoryFactAuthority
  readonly kind: MemoryFactKind
  readonly subjectKey?: string
  readonly extractionId?: string
  readonly explicit?: boolean
  readonly replacesFactId?: string
  readonly source: MemoryFactSource
  readonly sourceAssetId?: string
  readonly sourceEntryId?: string
  readonly eventSeq: number
  readonly assistantSeq?: number
  readonly turn?: number
  readonly conflicts: readonly MemoryFactConflict[]
}

/** One unresolved protected-fact disagreement. */
export interface MemoryFactConflict {
  readonly id: string
  readonly factId: MemoryFactId
  readonly previousFactId: MemoryFactId
  readonly subjectKey: string
  readonly previousText: string
  readonly incomingText: string
  readonly previousAuthority: MemoryFactAuthority
  readonly incomingAuthority: MemoryFactAuthority
  readonly previousExplicit?: boolean
  readonly incomingExplicit?: boolean
  readonly previousEventSeq: number
  readonly incomingEventSeq: number
}

/** Fold result consumed by UI, injection, and index builders. */
export interface MemoryFactProjection {
  readonly people: Readonly<Record<string, readonly MemoryFactEntry[]>>
  readonly world: readonly MemoryFactEntry[]
  readonly conflicts: readonly MemoryFactConflict[]
}

/** Branch and sequence limits for a projection. */
export interface MemoryProjectionOptions {
  readonly maxSeq?: number
  readonly branch?: string
  readonly branchLineage?: readonly string[]
  /** Current fork id when applying the inherited-prefix visibility rule. */
  readonly currentBranch?: string
  /** Seed prefix length; records before this sequence remain inherited. */
  readonly seedLength?: number
  /** Explicit subject-key aliases applied only while building this view. */
  readonly subjectKeyAliases?: readonly MemorySubjectKeyAlias[]
}

/** One known person and its currently observed dimensions. */
export interface MemoryRosterEntry {
  readonly personId: string
  readonly displayName: string
  readonly aliases: readonly string[]
  readonly subjectKeys: readonly string[]
}

/** One structured fact emitted by the extraction model. */
export interface MemoryExtractionAtom {
  readonly op: 'add' | 'replace' | 'remove'
  readonly target: MemoryFactTarget
  readonly personId?: string
  readonly subjectKey?: string
  readonly label?: string
  readonly text?: string
  readonly factId?: string
  readonly replacesFactId?: string
  readonly kind?: MemoryFactKind
  readonly explicit: boolean
  readonly anchorTurn: number
}

/** Roster update emitted beside extraction atoms. */
export interface MemoryRosterUpdate {
  readonly action: 'add'
  readonly slug: string
  readonly displayName: string
}

/** Strict structured extraction result. */
export interface MemoryExtractionBatch {
  readonly atoms: readonly MemoryExtractionAtom[]
  readonly rosterUpdates: readonly MemoryRosterUpdate[]
}

/** Result of strict extraction parsing; invalid model output never becomes a batch. */
export type MemoryExtractionParseResult =
  | { readonly ok: true; readonly value: MemoryExtractionBatch }
  | { readonly ok: false; readonly error: string }

/** Four-layer input to the extraction prompt. */
export interface MemoryExtractionPromptInput {
  readonly longRange: string
  readonly middleTranscript: string
  readonly currentTurn: string
  readonly roster: readonly MemoryRosterEntry[]
  readonly existingSubjectKeys?: readonly string[]
}

/** Input to the append-only extraction writer. */
export interface MemoryIngestInput {
  readonly sessionId: string
  readonly branch: string
  readonly extractionId: string
  readonly span: { readonly start: number; readonly end: number }
  readonly atoms: readonly MemoryExtractionAtom[]
  readonly rosterUpdates?: readonly MemoryRosterUpdate[]
  readonly roster: readonly MemoryRosterEntry[]
  readonly existing: readonly MemoryFactRecord[]
  /** Subject-key aliases applied while matching and projecting extracted atoms. */
  readonly subjectKeyAliases?: readonly MemorySubjectKeyAlias[]
  readonly cursor?: number
  readonly nextSeq?: number
}

/** Output of one idempotent extraction write. */
export interface MemoryIngestResult {
  readonly events: readonly MemoryFactEvent[]
  readonly records: readonly MemoryFactRecord[]
  readonly projection: MemoryFactProjection
  readonly cursor: number
  readonly skipped: boolean
  readonly rejected: readonly string[]
}

/** One derived retrieval row; it is never the source of truth. */
export interface MemoryIndexRow {
  readonly sessionId: string
  readonly seq: number
  readonly kind: 'fact' | 'wi-entry' | 'person-static' | 'roster'
  readonly originId: string
  readonly subjectKey?: string
  readonly personId?: string
  readonly content: string
  readonly embedding?: readonly number[]
  /** Embedding model label; vectors with another label are not comparable. */
  readonly embeddingModel?: string
  /** Embedding format version; vectors with another version are not comparable. */
  readonly embeddingVersion?: string
  /** Short model spelling retained for rows written by the initial index seam. */
  readonly model?: string
  /** Short version spelling accepted for rows written by external adapters. */
  readonly version?: string
  readonly active: boolean
}

/** Query filters for the derived index. */
export interface MemoryIndexQuery {
  readonly sessionId: string
  readonly text?: string
  readonly subjectKey?: string
  /** Subject-key aliases applied when matching this filter. */
  readonly subjectKeyAliases?: readonly MemorySubjectKeyAlias[]
  readonly personId?: string
  readonly embedding?: readonly number[]
  /** Optional embedding model label; mismatched vectors are ignored safely. */
  readonly embeddingModel?: string
  /** Optional embedding version; mismatched vectors are ignored safely. */
  readonly embeddingVersion?: string
  /** Short model spelling accepted for compatibility with derived rows. */
  readonly model?: string
  /** Short version spelling accepted for compatibility with derived rows. */
  readonly version?: string
  readonly limit?: number
}

/** One ranked derived-index hit. */
export interface MemoryIndexHit {
  readonly row: MemoryIndexRow
  readonly score: number
  /** Lexical component of the hybrid score, in the range [0, 1]. */
  readonly lexicalScore?: number
  /** Cosine component of the hybrid score, in the range [-1, 1]. */
  readonly cosineScore?: number
}

/**
 * Provider seam for a disposable derived index.
 *
 * Implementations must treat fact records as authoritative input: rebuilding
 * may discard every derived row for one session, while query results must be
 * scoped to the requested session and contain no inactive rows.
 */
export interface MemoryIndexProvider {
  /** Rebuild one session's derived rows from append-only fact records. */
  rebuild(sessionId: string, records: readonly MemoryFactRecord[], options?: MemoryProjectionOptions): void
  /** Insert or replace one derived row. */
  upsert(row: MemoryIndexRow): void
  /** Insert or replace derived rows atomically when the provider supports it. */
  upsertMany(rows: readonly MemoryIndexRow[]): void
  /** Mark one derived row inactive without deleting its audit identity. */
  tombstone(sessionId: string, seq: number, kind: MemoryIndexRow['kind'], originId: string): void
  /** Return ranked active rows for one session. */
  query(input: MemoryIndexQuery): readonly MemoryIndexHit[]
  /** Return detached rows for diagnostics and invariant checks. */
  list(sessionId?: string): readonly MemoryIndexRow[]
  /** Release provider resources. */
  close(): void
}

/** Dynamic memory content rendered at the end of a model request. */
export interface MemoryInjectionInput {
  readonly staticPersona?: string
  readonly playerIdentity?: string
  readonly projection: MemoryFactProjection
  readonly openThreads?: readonly string[]
  readonly prefetched?: readonly MemoryFactEntry[]
  /** Subject-key aliases applied to folded and prefetched facts before selection. */
  readonly subjectKeyAliases?: readonly MemorySubjectKeyAlias[]
  /** Fact IDs already present in the current request context. */
  readonly currentFactIds?: readonly string[]
  /** Event sequences already present in the current request context. */
  readonly currentEventSeqs?: readonly number[]
  readonly maxCharacters?: number
}

/** Durable injection snapshot and its source fact sequences. */
export interface MemoryInjectionSnapshot {
  readonly staticText: string
  readonly dynamicText: string
  readonly content: string
  readonly factSeqs: readonly number[]
  readonly fingerprint: string
}

/** Configurable memory and compaction policy. */
export interface MemoryConfig {
  readonly extraction: {
    readonly turnEnd: boolean
    readonly midWindowTurns: number
    readonly route?: string
  }
  readonly compaction: {
    readonly chunkTurns: readonly [number, number]
    readonly retainedTailTurns: number
    readonly checkpointBudgetTokens: number
    readonly summaryRoute?: string
  }
  readonly edit: { readonly windowTurns: number; readonly marginTurns: number }
  readonly injection: { readonly activePeople: number; readonly activeFacts: number; readonly prefetchTopK: number }
  readonly retrieval: {
    readonly embeddingModel?: string
    readonly embeddingVersion?: string
    readonly mode: 'brute' | 'ann'
    readonly wiVectorActivation: boolean
  }
}

/** A compacted narrative checkpoint. Facts remain in the event log. */
export interface MemoryCheckpoint {
  readonly plotSummary: string
  readonly openThreads: readonly string[]
  readonly shadowedTurns: { readonly start: number; readonly end: number }
}

/** Durable lifecycle record for one background extraction request. */
export interface MemoryExtractionEvent {
  /** Extraction lifecycle phase; only `complete` advances the cursor. */
  readonly phase: 'start' | 'complete' | 'failed'
  /** Branch whose transcript span was supplied to the extractor. */
  readonly branch: string
  /** Stable id for the inclusive source span. */
  readonly extractionId: string
  /** Inclusive turn range supplied to the model. */
  readonly span: { readonly start: number; readonly end: number }
  /** Current conversation turn. */
  readonly turn: number
  /** Provider route used for the auxiliary call. */
  readonly provider: string
  /** Model identifier used for the auxiliary call. */
  readonly model: string
  /** Exact prompt text supplied to the extractor. */
  readonly prompt: string
  /** Complete text returned by the extractor, when available. */
  readonly rawOutput?: string
  /** Cursor after the accepted extraction, on a complete event. */
  readonly cursor?: number
  /** Newly introduced people retained for later extraction roster prompts. */
  readonly rosterUpdates?: readonly MemoryRosterUpdate[]
  /** Whether the parsed batch was accepted and appended. */
  readonly accepted?: boolean
  /** Fail-closed parser or provider error. */
  readonly error?: string
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Durable model-visible memory injection snapshot. */
    'tavern/memory-context': {
      readonly branch: string
      readonly content: string
      readonly staticText: string
      readonly dynamicText: string
      readonly factSeqs: readonly number[]
      readonly fingerprint: string
    }
    /** Durable lifecycle and cursor record for background memory extraction. */
    'tavern/memory-extraction': MemoryExtractionEvent
  }
}
