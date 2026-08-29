/** Pure observer-aware context filtering, ordering, deduplication, and packing. */

import { matchWorldInfo } from './world-info.ts'
import type {
  Authority,
  CompileContextInput,
  CompiledContext,
  ContextDecision,
  ContextDecisionReason,
  ContextSourceRecord,
  ContextUsage,
  Observer,
  ObserverScope,
  NormalizedWorldInfoEntry,
  Visibility,
} from './types.ts'

type SourceOccurrence<T> =
  | {
    readonly source: ContextSourceRecord<T>
    readonly origin: 'source'
  }
  | {
    readonly source: ContextSourceRecord<T>
    readonly origin: 'world-info'
    readonly entry: NormalizedWorldInfoEntry<T>
  }

interface CompileCandidate<T> {
  readonly source: ContextSourceRecord<T>
  readonly origin: 'source' | 'world-info'
  readonly entry?: NormalizedWorldInfoEntry<T>
  readonly matchKind?: 'primary' | 'secondary'
  readonly matchedKeys?: readonly string[]
  readonly matchCount: number
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function compareObservers(left: Observer, right: Observer): number {
  const kindOrder = compareStrings(left.kind, right.kind)
  if (kindOrder !== 0) return kindOrder
  if (left.kind !== 'character' || right.kind !== 'character') return 0
  return compareStrings(left.id, right.id)
}

function observersEqual(left: Observer, right: Observer): boolean {
  return compareObservers(left, right) === 0
}

function observerScopeAllows(scope: ObserverScope, observer: Observer): boolean {
  return scope.kind === 'all' || observersEqual(scope.observer, observer)
}

function visibilityAllows(
  visibility: Visibility,
  sourceObserver: ObserverScope,
  observer: Observer,
): boolean {
  if (visibility === 'public') return true
  if (visibility === 'gm-only') return observer.kind === 'gm'
  return sourceObserver.kind === 'specific' && observersEqual(sourceObserver.observer, observer)
}

function authorityAllows(authority: Authority, observer: Observer): boolean {
  if (authority === 'public') return true
  if (authority === 'gm') return observer.kind === 'gm'
  if (authority === 'player') return observer.kind === 'player' || observer.kind === 'gm'
  if (authority === 'character') return observer.kind === 'character' || observer.kind === 'gm'
  return observer.kind === 'narrator' || observer.kind === 'gm'
}

function branchAllows<T>(source: ContextSourceRecord<T>, branch: string): boolean {
  return source.branch.kind === 'all' || source.branch.id === branch
}

function filterReason<T>(
  source: ContextSourceRecord<T>,
  observer: Observer,
  branch: string,
): Exclude<ContextDecisionReason, 'included' | 'not-matched' | 'duplicate' | `budget-${string}`> | undefined {
  if (!observerScopeAllows(source.observer, observer)) return 'observer'
  if (!visibilityAllows(source.visibility, source.observer, observer)) return 'visibility'
  if (!authorityAllows(source.authority, observer)) return 'authority'
  if (!branchAllows(source, branch)) return 'branch'
  if (source.validity.status === 'invalid') return 'invalid'
  return undefined
}

function occurrenceOrder<T>(left: SourceOccurrence<T>, right: SourceOccurrence<T>): number {
  const keyOrder = compareStrings(left.source.key, right.source.key)
  if (keyOrder !== 0) return keyOrder
  const originOrder = left.origin === right.origin ? 0 : left.origin === 'source' ? -1 : 1
  if (originOrder !== 0) return originOrder
  const provenanceOrder = compareStrings(left.source.provenance.kind, right.source.provenance.kind)
  if (provenanceOrder !== 0) return provenanceOrder
  const idOrder = compareStrings(left.source.provenance.id, right.source.provenance.id)
  if (idOrder !== 0) return idOrder
  return compareStrings(left.source.text, right.source.text)
}

function candidateMatchRank<T>(candidate: CompileCandidate<T>): number {
  if (candidate.matchKind === undefined) return 0
  return candidate.matchKind === 'primary' ? 1 : 2
}

function candidateOrder<T>(left: CompileCandidate<T>, right: CompileCandidate<T>): number {
  const stabilityOrder = left.source.stability === right.source.stability
    ? 0
    : left.source.stability === 'stable' ? -1 : 1
  if (stabilityOrder !== 0) return stabilityOrder
  const priorityOrder = right.source.priority - left.source.priority
  if (priorityOrder !== 0) return priorityOrder
  const matchOrder = candidateMatchRank(left) - candidateMatchRank(right)
  if (matchOrder !== 0) return matchOrder
  const countOrder = right.matchCount - left.matchCount
  if (countOrder !== 0) return countOrder
  const keyOrder = compareStrings(left.source.key, right.source.key)
  if (keyOrder !== 0) return keyOrder
  const provenanceOrder = compareStrings(left.source.provenance.kind, right.source.provenance.kind)
  if (provenanceOrder !== 0) return provenanceOrder
  const idOrder = compareStrings(left.source.provenance.id, right.source.provenance.id)
  if (idOrder !== 0) return idOrder
  return compareStrings(left.source.text, right.source.text)
}

function validateBudget(budget: CompileContextInput['budget']): void {
  if (budget === undefined) return
  for (const [name, value] of [
    ['maxCharacters', budget.maxCharacters],
    ['maxTokens', budget.maxTokens],
  ] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new Error(`ContextBudget.${name} must be a non-negative safe integer`)
    }
  }
  if (budget.maxTokens !== undefined && budget.tokenEstimator === undefined) {
    throw new Error('ContextBudget.tokenEstimator is required when maxTokens is set')
  }
}

function characterCount(text: string): number {
  return Array.from(text).length
}

function sourceUsage<T>(source: ContextSourceRecord<T>, tokenEstimator: ((text: string) => number) | undefined): ContextUsage {
  const characters = characterCount(source.text)
  if (tokenEstimator === undefined) return { characters }
  const tokens = tokenEstimator(source.text)
  if (!Number.isSafeInteger(tokens) || tokens < 0) {
    throw new Error(`Token estimator returned an invalid count for source "${source.key}"`)
  }
  return { characters, tokens }
}

function withOptional(
  matchKind: 'primary' | 'secondary' | undefined,
  matchedKeys: readonly string[] | undefined,
): { matchKind?: 'primary' | 'secondary'; matchedKeys?: readonly string[] } {
  return {
    ...(matchKind === undefined ? {} : { matchKind }),
    ...(matchedKeys === undefined ? {} : { matchedKeys }),
  }
}

function makeDecision(
  order: number,
  occurrence: Pick<SourceOccurrence<unknown>, 'source' | 'origin'>,
  outcome: 'included' | 'excluded',
  reason: ContextDecisionReason,
  details: Partial<Pick<ContextDecision, 'matchKind' | 'matchedKeys' | 'attempted' | 'accepted'>> = {},
): ContextDecision {
  return {
    order,
    key: occurrence.source.key,
    origin: occurrence.origin,
    outcome,
    reason,
    ...details,
  }
}

function budgetReason(charactersExceeded: boolean, tokensExceeded: boolean): ContextDecisionReason {
  if (charactersExceeded && tokensExceeded) return 'budget-both'
  if (charactersExceeded) return 'budget-characters'
  return 'budget-tokens'
}

/**
 * Compile a model-visible context view without runtime or persistence access.
 * Sources are filtered in observer, visibility, authority, branch, and validity
 * order, then matched, sorted, deduplicated, and packed by explicit budgets.
 * @param input - observer, branch, normalized sources, and optional limits.
 * @returns stable prefix, dynamic suffix, usage, and a replayable ledger.
 */
export function compileContext<T>(input: CompileContextInput<T>): CompiledContext<T> {
  validateBudget(input.budget)
  const budget = input.budget
  const occurrences: SourceOccurrence<T>[] = input.sources.map(source => ({ source, origin: 'source' }))
  const worldEntries = input.worldInfo?.entries ?? []
  for (const entry of worldEntries) occurrences.push({ source: entry.source, origin: 'world-info', entry })
  occurrences.sort(occurrenceOrder)

  const ledger: ContextDecision[] = []
  const directCandidates: CompileCandidate<T>[] = []
  const eligibleWorld: Extract<SourceOccurrence<T>, { origin: 'world-info' }>[] = []
  let order = 0
  for (const occurrence of occurrences) {
    const reason = filterReason(occurrence.source, input.observer, input.branch)
    if (reason !== undefined) {
      ledger.push(makeDecision(order++, occurrence, 'excluded', reason))
    } else if (occurrence.origin === 'source') {
      directCandidates.push({ source: occurrence.source, origin: occurrence.origin, matchCount: 0 })
    } else {
      eligibleWorld.push(occurrence)
    }
  }

  const matchedEntries = new Set<NormalizedWorldInfoEntry<T>>()
  const matchedCandidates: CompileCandidate<T>[] = []
  if (input.worldInfo !== undefined) {
    const matches = matchWorldInfo({
      text: input.worldInfo.text,
      entries: eligibleWorld.map(occurrence => occurrence.entry),
    })
    for (const match of matches) {
      matchedEntries.add(match.entry)
      matchedCandidates.push({
        source: match.source,
        origin: 'world-info',
        entry: match.entry,
        matchKind: match.matchKind,
        matchedKeys: match.matchedKeys,
        matchCount: match.matchCount,
      })
    }
  }
  const groupedCandidates: CompileCandidate<T>[] = []
  const selectedGroups = new Set<string>()
  for (const candidate of matchedCandidates) {
    const group = candidate.entry?.group
    if (group !== undefined && group !== null && group !== '') {
      if (selectedGroups.has(group)) {
        ledger.push(makeDecision(order++, {
          source: candidate.source,
          origin: candidate.origin,
        }, 'excluded', 'group', withOptional(candidate.matchKind, candidate.matchedKeys)))
        continue
      }
      selectedGroups.add(group)
    }
    groupedCandidates.push(candidate)
  }
  for (const occurrence of eligibleWorld) {
    if (!matchedEntries.has(occurrence.entry)) {
      ledger.push(makeDecision(order++, occurrence, 'excluded', 'not-matched'))
    }
  }

  const candidates = [...directCandidates, ...groupedCandidates].sort(candidateOrder)
  const seenKeys = new Set<string>()
  const stablePrefix: ContextSourceRecord<T>[] = []
  const dynamicSuffix: ContextSourceRecord<T>[] = []
  const tokenEstimator = budget?.tokenEstimator
  let usedCharacters = 0
  let usedTokens = tokenEstimator === undefined ? undefined : 0
  for (const candidate of candidates) {
    const occurrence = { source: candidate.source, origin: candidate.origin }
    const matchDetails = withOptional(candidate.matchKind, candidate.matchedKeys)
    if (seenKeys.has(candidate.source.key)) {
      ledger.push(makeDecision(order++, occurrence, 'excluded', 'duplicate', matchDetails))
      continue
    }
    seenKeys.add(candidate.source.key)
    const attempted = sourceUsage(candidate.source, tokenEstimator)
    const charactersExceeded = budget?.maxCharacters !== undefined
      && usedCharacters + attempted.characters > budget.maxCharacters
    const tokensExceeded = budget?.maxTokens !== undefined
      && usedTokens !== undefined
      && attempted.tokens !== undefined
      && usedTokens + attempted.tokens > budget.maxTokens
    if (charactersExceeded || tokensExceeded) {
      ledger.push(makeDecision(order++, occurrence, 'excluded', budgetReason(charactersExceeded, tokensExceeded), {
        ...matchDetails,
        attempted,
      }))
      continue
    }
    stablePrefix.push(...candidate.source.stability === 'stable' ? [candidate.source] : [])
    dynamicSuffix.push(...candidate.source.stability === 'dynamic' ? [candidate.source] : [])
    usedCharacters += attempted.characters
    if (usedTokens !== undefined && attempted.tokens !== undefined) usedTokens += attempted.tokens
    ledger.push(makeDecision(order++, occurrence, 'included', 'included', {
      ...matchDetails,
      accepted: attempted,
    }))
  }

  const usage: ContextUsage = usedTokens === undefined
    ? { characters: usedCharacters }
    : { characters: usedCharacters, tokens: usedTokens }
  return {
    stablePrefix,
    dynamicSuffix,
    ledger,
    usage,
  }
}
