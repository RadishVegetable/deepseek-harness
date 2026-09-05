/** U-shaped prompt injection and durable snapshot helpers. */

import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {
  MemoryFactEntry,
  MemoryFactProjection,
  MemoryConfig,
  MemoryInjectionInput,
  MemoryInjectionSnapshot,
} from './types.ts'
import { DEFAULT_MEMORY_CONFIG } from './config.ts'
import { flattenMemoryProjection } from './fold.ts'
import { createSubjectKeyAliasResolver } from './keys.ts'

/** Explicit dynamic-memory limits applied while selecting injection facts. */
export interface MemoryInjectionLimits {
  /** Maximum number of person owners represented by base facts. */
  readonly activePeople: number
  /** Maximum number of folded base facts before retrieval prefetch. */
  readonly activeFacts: number
  /** Maximum number of additional retrieved facts after de-duplication. */
  readonly prefetchTopK: number
}

/** Optional selection inputs used by the injection renderer and focused adapters. */
export interface MemoryInjectionSelectionOptions extends Partial<MemoryInjectionLimits> {
  /** Partial nested injection settings accepted for config-shaped callers. */
  readonly injection?: Partial<MemoryInjectionLimits>
  /** Retrieved facts considered after the folded active-fact selection. */
  readonly prefetched?: readonly MemoryFactEntry[]
  /** Fact IDs already visible in the request context. */
  readonly currentFactIds?: readonly string[]
  /** Event sequences already visible in the request context. */
  readonly currentEventSeqs?: readonly number[]
  /** Subject-key aliases applied before de-duplication and rendering. */
  readonly subjectKeyAliases?: MemoryInjectionInput['subjectKeyAliases']
}

/** Config-shaped or direct limits accepted by {@link renderMemoryInjection}. */
export type MemoryInjectionLimitSource = MemoryConfig | MemoryInjectionSelectionOptions

/**
 * Render static persona and changing Journey memory into one durable snapshot.
 * The projection is already folded, so this renderer never displays a
 * superseded value beside its current value.
 * @param input - Persona, identity, folded facts, open threads, and prefetch.
 * @param config - Resolved memory config or an equivalent injection-limit object.
 * @returns Rendered static/dynamic sections and source fact sequences.
 */
export function renderMemoryInjection(
  input: MemoryInjectionInput,
  config: MemoryInjectionLimitSource = DEFAULT_MEMORY_CONFIG,
): MemoryInjectionSnapshot {
  validateMaxCharacters(input.maxCharacters)
  const staticLines = [
    input.staticPersona?.trim() ?? '',
    input.playerIdentity?.trim() ? `玩家身份：${input.playerIdentity.trim()}` : '',
  ].filter(line => line.length > 0)
  const rawStaticText = staticLines.join('\n\n')
  const selectedFacts = selectMemoryInjectionFacts(input.projection, {
    ...resolveMemoryInjectionLimits(config),
    ...(input.prefetched === undefined ? {} : { prefetched: input.prefetched }),
    ...(input.currentFactIds === undefined ? {} : { currentFactIds: input.currentFactIds }),
    ...(input.currentEventSeqs === undefined ? {} : { currentEventSeqs: input.currentEventSeqs }),
    ...(input.subjectKeyAliases === undefined ? {} : { subjectKeyAliases: input.subjectKeyAliases }),
  })
  const factLines = [...selectedFacts]
    .sort((left, right) => left.eventSeq - right.eventSeq)
    .map(renderFact)
  const threadLines = (input.openThreads ?? []).map(thread => thread.trim()).filter(Boolean).map(thread => `- ${thread}`)
  const dynamicParts = [
    factLines.length > 0 ? `【旅程演化设定】\n${factLines.join('\n')}` : '',
    threadLines.length > 0 ? `【未决伏笔】\n${threadLines.join('\n')}` : '',
  ].filter(part => part.length > 0)
  const rawDynamicText = dynamicParts.join('\n\n')
  const bounded = boundSnapshot(rawStaticText, rawDynamicText, input.maxCharacters)
  return {
    staticText: bounded.staticText,
    dynamicText: bounded.dynamicText,
    content: bounded.content,
    factSeqs: [...new Set(selectedFacts.map(fact => fact.eventSeq))].sort((left, right) => left - right),
    fingerprint: stableFingerprint(bounded.content),
  }
}

/**
 * Select folded active facts and a bounded retrieved tail for prompt injection.
 * Person owners are ranked by their newest fact; world facts are always eligible.
 * Current-context facts are removed before either limit is counted.
 * @param projection - Folded branch-visible memory projection.
 * @param options - Limits, retrieved candidates, and de-duplication filters.
 * @returns Facts selected in deterministic event order.
 */
export function selectMemoryInjectionFacts(
  projection: MemoryFactProjection,
  options: MemoryInjectionSelectionOptions = {},
): readonly MemoryFactEntry[] {
  const limits = resolveMemoryInjectionLimits(options)
  const resolveSubjectKey = createSubjectKeyAliasResolver(options.subjectKeyAliases ?? [])
  const currentFactIds = new Set(options.currentFactIds ?? [])
  const currentEventSeqs = new Set(options.currentEventSeqs ?? [])
  const allFacts = dedupeFacts(flattenMemoryProjection(projection).map(fact => normalizeInjectionFact(fact, resolveSubjectKey)))
    .filter(fact => !currentFactIds.has(String(fact.factId)) && !currentEventSeqs.has(fact.eventSeq))

  const peopleById = new Map<string, MemoryFactEntry[]>()
  for (const fact of allFacts) {
    if (fact.target !== 'person') continue
    const personId = fact.personId ?? 'person:unknown'
    const facts = peopleById.get(personId) ?? []
    facts.push(fact)
    peopleById.set(personId, facts)
  }
  const activePeople = [...peopleById.entries()]
    .sort((left, right) => newestFact(right[1]).eventSeq - newestFact(left[1]).eventSeq
      || compareStrings(left[0], right[0]))
    .slice(0, limits.activePeople)
    .map(([personId]) => personId)
  const activePeopleSet = new Set(activePeople)
  const baseCandidates = allFacts.filter(fact => fact.target === 'world'
    || activePeopleSet.has(fact.personId ?? 'person:unknown'))
  const baseFacts = [...baseCandidates]
    .sort((left, right) => right.eventSeq - left.eventSeq || compareStrings(String(left.factId), String(right.factId)))
    .slice(0, limits.activeFacts)
  const selectedIds = new Set(baseFacts.map(fact => String(fact.factId)))
  const prefetched = dedupeFacts((options.prefetched ?? [])
    .map(fact => normalizeInjectionFact(fact, resolveSubjectKey)))
    .filter(fact => !currentFactIds.has(String(fact.factId))
      && !currentEventSeqs.has(fact.eventSeq)
      && !selectedIds.has(String(fact.factId)))
    .sort((left, right) => right.eventSeq - left.eventSeq || compareStrings(String(left.factId), String(right.factId)))
    .slice(0, limits.prefetchTopK)
  return [...baseFacts, ...prefetched]
    .sort((left, right) => left.eventSeq - right.eventSeq || compareStrings(String(left.factId), String(right.factId)))
}

/**
 * Resolve injection limits from a full memory config or a partial direct input.
 * @param source - Full config or partial injection settings.
 * @returns Validated positive injection limits.
 */
export function resolveMemoryInjectionLimits(
  source: MemoryInjectionLimitSource = DEFAULT_MEMORY_CONFIG,
): MemoryInjectionLimits {
  const values: Partial<MemoryInjectionLimits> = isMemoryConfig(source)
    ? source.injection
    : source.injection ?? source
  const limits = {
    activePeople: values.activePeople ?? DEFAULT_MEMORY_CONFIG.injection.activePeople,
    activeFacts: values.activeFacts ?? DEFAULT_MEMORY_CONFIG.injection.activeFacts,
    prefetchTopK: values.prefetchTopK ?? DEFAULT_MEMORY_CONFIG.injection.prefetchTopK,
  }
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be positive`)
  }
  return limits
}

function isMemoryConfig(source: MemoryInjectionLimitSource): source is MemoryConfig {
  return 'extraction' in source
}

/** Alias for callers that treat the output as a prompt snapshot. */
export const renderMemoryContext = renderMemoryInjection

/**
 * Append a model-visible snapshot to the session log at its commit point.
 * @param session - Session receiving the durable snapshot.
 * @param branch - Branch whose projection produced the snapshot.
 * @param snapshot - Exact static and dynamic text shown to the model.
 * @returns The appended memory-context event.
 */
export function appendMemoryInjectionSnapshot(
  session: Session,
  branch: string,
  snapshot: MemoryInjectionSnapshot,
): SessionEvent<'tavern/memory-context'> {
  return session.append('tavern/memory-context', {
    branch,
    content: snapshot.content,
    staticText: snapshot.staticText,
    dynamicText: snapshot.dynamicText,
    factSeqs: [...snapshot.factSeqs],
    fingerprint: snapshot.fingerprint,
  })
}

function normalizeInjectionFact(
  fact: MemoryFactEntry,
  resolveSubjectKey: (value: string | undefined) => string | undefined,
): MemoryFactEntry {
  const subjectKey = resolveSubjectKey(fact.subjectKey)
  if (subjectKey === undefined || subjectKey === fact.subjectKey) return fact
  return { ...fact, subjectKey }
}

function dedupeFacts(facts: readonly MemoryFactEntry[]): readonly MemoryFactEntry[] {
  const selected = new Map<string, MemoryFactEntry>()
  for (const fact of facts) {
    const key = String(fact.factId)
    const previous = selected.get(key)
    if (previous === undefined
      || previous.eventSeq < fact.eventSeq
      || (previous.eventSeq === fact.eventSeq && compareStrings(previous.text, fact.text) > 0)) {
      selected.set(key, fact)
    }
  }
  return [...selected.values()]
}

function newestFact(facts: readonly MemoryFactEntry[]): MemoryFactEntry {
  const newest = [...facts].sort((left, right) => right.eventSeq - left.eventSeq
    || compareStrings(String(left.factId), String(right.factId)))[0]
  if (newest === undefined) throw new Error('memory injection person group must not be empty')
  return newest
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function renderFact(fact: MemoryFactEntry): string {
  const key = fact.subjectKey?.slice(fact.subjectKey.indexOf('.') + 1) ?? fact.label ?? '未分类事实'
  const owner = fact.target === 'world' ? '世界' : fact.personId ?? '人物'
  const origin = fact.authority === 'user'
    ? '玩家修改'
    : fact.authority === 'authored-asset'
      ? '原始资产'
      : fact.turn === undefined ? `事件 ${fact.eventSeq}` : `第 ${fact.turn} 回合`
  return `- ${owner} / ${key}：${fact.text}（${origin}）`
}

function boundSnapshot(staticText: string, dynamicText: string, maxCharacters: number | undefined): {
  readonly staticText: string
  readonly dynamicText: string
  readonly content: string
} {
  const content = [staticText, dynamicText].filter(part => part.length > 0).join('\n\n')
  if (maxCharacters === undefined || content.length <= maxCharacters) {
    return { staticText, dynamicText, content }
  }
  const boundedContent = content.slice(0, maxCharacters)
  const separator = staticText.length > 0 && dynamicText.length > 0 ? '\n\n' : ''
  if (boundedContent.length <= staticText.length) {
    return { staticText: boundedContent, dynamicText: '', content: boundedContent }
  }
  const dynamicStart = staticText.length + separator.length
  return {
    staticText,
    dynamicText: boundedContent.slice(dynamicStart),
    content: boundedContent,
  }
}

function validateMaxCharacters(maxCharacters: number | undefined): void {
  if (maxCharacters !== undefined && (!Number.isSafeInteger(maxCharacters) || maxCharacters < 0)) {
    throw new RangeError('maxCharacters must be a non-negative safe integer')
  }
}

/**
 * Return a stable, dependency-free fingerprint for one rendered context.
 * @param value - Rendered context text.
 * @returns The deterministic FNV-1a fingerprint.
 */
export function stableFingerprint(value: string): string {
  let hash = 2166136261
  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`
}
