/**
 * Cordis-free vocabulary for observer-aware Tavern context compilation.
 * Parsers, storage, and runtime adapters provide these normalized records.
 * @module @deepseek-ai/dsh-tavern-context/types
 */

/** A model-visible observer in a Tavern session. */
export type Observer =
  | { readonly kind: 'gm' }
  | { readonly kind: 'player' }
  | { readonly kind: 'narrator' }
  | { readonly kind: 'character'; readonly id: string }

/** The observer scope assigned to a context source. */
export type ObserverScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'specific'; readonly observer: Observer }

/** Visibility classification applied after the source observer scope. */
export type Visibility = 'public' | 'private' | 'gm-only'

/** Minimum observer authority required to receive a source. */
export type Authority = 'public' | 'player' | 'character' | 'narrator' | 'gm'

/** Branch scope that determines whether a source belongs to the current branch. */
export type BranchScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'branch'; readonly id: string }

/** Validity state supplied by the owning projection. */
export type SourceValidity =
  | { readonly status: 'valid' }
  | { readonly status: 'invalid'; readonly reason: string }

/** Whether a source belongs in the reusable prefix or changing suffix. */
export type ContextStability = 'stable' | 'dynamic'

/** Source provenance retained for prompt inspection and replay. */
export interface ContextProvenance {
  /** Provenance family such as `character-card` or `world-info`. */
  readonly kind: string
  /** Stable id within the provenance family. */
  readonly id: string
  /** Durable source event ids, when the producer has them. */
  readonly eventIds?: readonly string[]
}

/** One normalized source record eligible for context compilation. */
export interface ContextSourceRecord<T = unknown> {
  /** Deterministic deduplication and ledger key. */
  readonly key: string
  /** Text presented to the model when the source is selected. */
  readonly text: string
  /** Prefix or suffix placement class. */
  readonly stability: ContextStability
  /** Observer scope before visibility and authority checks. */
  readonly observer: ObserverScope
  /** Visibility class for this source. */
  readonly visibility: Visibility
  /** Minimum authority required for this source. */
  readonly authority: Authority
  /** Branch scope for this source. */
  readonly branch: BranchScope
  /** Current validity supplied by the source owner. */
  readonly validity: SourceValidity
  /** Source origin used by inspection and replay. */
  readonly provenance: ContextProvenance
  /** Higher values sort before lower values within a stability class. */
  readonly priority: number
  /** Parser- or provider-owned metadata carried without interpretation. */
  readonly metadata?: T
}

/** Parser output required by the World Info matcher; no card parser is included. */
export interface NormalizedWorldInfoEntry<T = unknown> {
  /** Context source emitted when this entry activates. */
  readonly source: ContextSourceRecord<T>
  /** Primary keys matched as whole words. */
  readonly keys: readonly string[]
  /** Secondary keys matched as whole words after primary keys. */
  readonly secondaryKeys?: readonly string[]
  /** Whether primary and secondary keys must both match. */
  readonly selective?: boolean
  /** Whether this entry is active without keyword matching. */
  readonly constant?: boolean
  /** Whether keys are regular expressions instead of literal text. */
  readonly useRegex?: boolean
  /** Whether literal keys must match whole words. */
  readonly matchWholeWords?: boolean
  /** Whether key matching preserves case. */
  readonly caseSensitive?: boolean
  /** Whether the probability field gates activation. */
  readonly useProbability?: boolean
  /** Activation probability as a percentage from 0 through 100. */
  readonly probability?: number
  /** Entry insertion depth retained for the prompt renderer. */
  readonly depth?: number
  /** Entries with the same group compete deterministically for one slot. */
  readonly group?: string | null
  /** Sticky activation duration retained for a stateful provider. */
  readonly sticky?: number | null
  /** Cooldown duration retained for a stateful provider. */
  readonly cooldown?: number | null
}

/** Input for deterministic World Info matching. */
export interface WorldInfoMatchInput<T = unknown> {
  /** Text window searched by the matcher. */
  readonly text: string
  /** Already normalized entries; parsing is outside this package. */
  readonly entries: readonly NormalizedWorldInfoEntry<T>[]
  /** Deterministic roll used for entries with intermediate probabilities. */
  readonly probabilityRoll?: (entry: NormalizedWorldInfoEntry<T>) => number
}

/** One normalized entry activated by whole-word matching. */
export interface WorldInfoActivationCandidate<T = unknown> {
  /** Entry that produced this activation. */
  readonly entry: NormalizedWorldInfoEntry<T>
  /** Source record emitted by the activation. */
  readonly source: ContextSourceRecord<T>
  /** Primary keys outrank secondary keys. */
  readonly matchKind: 'primary' | 'secondary'
  /** Original key spellings that matched, in deterministic order. */
  readonly matchedKeys: readonly string[]
  /** Number of distinct matched keys. */
  readonly matchCount: number
}

/** Explicit limits for first-fit context packing. */
export interface ContextBudget {
  /** Maximum Unicode code-point count across selected source text. */
  readonly maxCharacters?: number
  /** Maximum estimated token count across selected source text. */
  readonly maxTokens?: number
  /** Caller-owned token estimator; required when `maxTokens` is set. */
  readonly tokenEstimator?: (text: string) => number
}

/** Observer, branch, source, and optional World Info input to the compiler. */
export interface CompileContextInput<T = unknown> {
  /** Observer whose model-visible view is being compiled. */
  readonly observer: Observer
  /** Current branch id. */
  readonly branch: string
  /** Direct records that do not require World Info matching. */
  readonly sources: readonly ContextSourceRecord<T>[]
  /** Optional normalized World Info search input. */
  readonly worldInfo?: WorldInfoMatchInput<T>
  /** Optional explicit first-fit limits. */
  readonly budget?: ContextBudget
}

/** Stable reason recorded for every context compilation decision. */
export type ContextDecisionReason =
  | 'included'
  | 'observer'
  | 'visibility'
  | 'authority'
  | 'branch'
  | 'invalid'
  | 'not-matched'
  | 'group'
  | 'duplicate'
  | 'budget-characters'
  | 'budget-tokens'
  | 'budget-both'

/** Measured text usage for selected or attempted source text. */
export interface ContextUsage {
  /** Unicode code-point count. */
  readonly characters: number
  /** Estimated tokens when a token estimator was supplied. */
  readonly tokens?: number
}

/** Selection outcome recorded for one context compilation decision. */
export type ContextDecisionOutcome = 'included' | 'excluded'

/** One replayable compiler decision with its stable reason and attempted usage. */
export interface ContextDecision {
  /** Deterministic source key. */
  readonly key: string
  /** Whether the record came from direct input or World Info. */
  readonly origin: 'source' | 'world-info'
  /** Selection outcome. */
  readonly outcome: ContextDecisionOutcome
  /** Why the source was selected or rejected. */
  readonly reason: ContextDecisionReason
  /** Matching details for an activated World Info candidate. */
  readonly matchKind?: 'primary' | 'secondary'
  /** Original World Info keys that matched. */
  readonly matchedKeys?: readonly string[]
  /** Text usage attempted by a budget decision. */
  readonly attempted?: ContextUsage
  /** Text usage committed by an included decision. */
  readonly accepted?: ContextUsage
  /** Deterministic evaluation position within this ledger. */
  readonly order: number
}

/** JSON-serializable decision entries exposed to context inspection consumers. */
export type ContextLedger = readonly ContextDecision[]

/** Pure compiler output split into stable and changing context records. */
export interface CompiledContext<T = unknown> {
  /** Selected stable records, ordered as the reusable prompt prefix. */
  readonly stablePrefix: readonly ContextSourceRecord<T>[]
  /** Selected dynamic records, ordered after the stable prefix. */
  readonly dynamicSuffix: readonly ContextSourceRecord<T>[]
  /** Complete filtering, matching, deduplication, and budget ledger. */
  readonly ledger: ContextLedger
  /** Aggregate usage of selected source text. */
  readonly usage: ContextUsage
}
