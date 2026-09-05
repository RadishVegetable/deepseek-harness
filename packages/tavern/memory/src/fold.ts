/** Deterministic append-only fact projection for Tavern Journey memory. */

import type {
  MemoryFactAuthority,
  MemoryFactConflict,
  MemoryFactEntry,
  MemoryFactEvent,
  MemoryFactProjection,
  MemoryFactRecord,
  MemoryProjectionOptions,
  MemorySubjectKeyAlias,
} from './types.ts'
import { createSubjectKeyAliasResolver } from './keys.ts'

/** The result of comparing an incoming fact with the current fact for a key. */
export type MemoryFactFreshnessDecision = 'newer-wins' | 'protected-conflict' | 'duplicate'

/** Minimal fact fields needed by the freshness-first guard. */
export interface MemoryFactFreshnessCandidate {
  readonly text: string
  readonly authority: MemoryFactAuthority
  readonly explicit?: boolean
}

/**
 * Compare two values using the Journey freshness-first rule.
 *
 * User-authorized values supersede older values. A newer inferred value cannot
 * hide an older user value or an older explicit value; both are retained and a
 * conflict is emitted. Equal text is a duplicate regardless of authority.
 * @param previous - Current value for the subject key.
 * @param incoming - Newer value being folded.
 * @returns The deterministic fold decision.
 */
export function compareFactFreshness(
  previous: MemoryFactFreshnessCandidate,
  incoming: MemoryFactFreshnessCandidate,
): MemoryFactFreshnessDecision {
  if (previous.text === incoming.text) return 'duplicate'
  if (incoming.authority === 'user') return 'newer-wins'
  if (previous.authority === 'user') return 'protected-conflict'
  if (previous.explicit === true && incoming.explicit !== true) return 'protected-conflict'
  return 'newer-wins'
}

/**
 * Return whether one event belongs to the selected memory branch.
 * @param record - Fact record to classify.
 * @param options - Sequence and branch visibility limits.
 * @returns Whether the record is visible in the selected view.
 */
export function isMemoryFactVisible(
  record: Pick<MemoryFactRecord, 'seq' | 'data'>,
  options: MemoryProjectionOptions = {},
): boolean {
  if (record.seq > (options.maxSeq ?? Number.MAX_SAFE_INTEGER)) return false
  if (options.currentBranch !== undefined && options.seedLength !== undefined) {
    return record.seq < options.seedLength || record.data.branch === options.currentBranch
  }
  if (options.branchLineage !== undefined) return options.branchLineage.includes(record.data.branch)
  return options.branch === undefined || options.branch === record.data.branch
}

/**
 * Fold visible accepted fact events into the current memory view.
 *
 * The source records are never rewritten. Replacements with a subject key are
 * compared after replay, so a protected older value remains available when a
 * later inferred value disagrees with it.
 * @param records - Append-only fact records in log order.
 * @param options - Optional sequence and branch visibility limits.
 * @returns The projected people, world facts, and unresolved conflicts.
 */
export function projectMemoryFacts(
  records: readonly MemoryFactRecord[],
  options: MemoryProjectionOptions = {},
): MemoryFactProjection {
  const active = new Map<string, MemoryFactEntry>()
  const resolveSubjectKey = createSubjectKeyAliasResolver(options.subjectKeyAliases ?? [])
  const resolvedConflictIds = new Set<string>()
  const visible = records
    .filter(record => isMemoryFactVisible(record, options))
    .sort((left, right) => left.seq - right.seq)

  for (const record of visible) {
    const data = record.data
    if (!data.accepted || data.factId === undefined) continue
    for (const conflictId of data.resolvesConflictIds ?? []) resolvedConflictIds.add(conflictId)
    if (data.operation === 'remove') {
      active.delete(data.factId)
      continue
    }
    const current = active.get(data.factId)
    const predecessor = data.replacesFactId === undefined ? current : active.get(data.replacesFactId)
    const projected = projectEntry(record, data, predecessor, resolveSubjectKey)
    if (projected === undefined) continue

    // A replacement without a structure key has no deterministic way to
    // retain two values. Remove only its predecessor from the active view;
    // both source events remain available in the append-only log.
    if (data.operation === 'replace'
      && predecessor !== undefined
      && projected.subjectKey === undefined
      && String(predecessor.factId) !== String(projected.factId)) {
      active.delete(String(predecessor.factId))
    }

    // A linked predecessor remains in the candidate set. The keyed fold below
    // decides whether it is hidden, retained as a protected disagreement, or
    // left alone when the fact has no subject key.
    active.set(String(projected.factId), projected)
  }

  const entries = [...active.values()].sort(compareEntries)
  const retained = new Set<MemoryFactEntry>()
  const conflicts: MemoryFactConflict[] = []
  const groups = new Map<string, MemoryFactEntry[]>()

  for (const entry of entries) {
    if (entry.subjectKey === undefined) {
      retained.add(entry)
      continue
    }
    const key = `${entry.target}\u0000${entry.personId ?? ''}\u0000${entry.subjectKey}`
    const group = groups.get(key) ?? []
    group.push(entry)
    groups.set(key, group)
  }

  for (const group of groups.values()) {
    let winner = group[0]
    if (winner === undefined) continue
    retained.add(winner)
    for (const incoming of group.slice(1)) {
      const decision = compareFactFreshness(winner, incoming)
      if (decision === 'duplicate') continue
      if (decision === 'protected-conflict') {
        retained.add(incoming)
        conflicts.push(makeConflict(incoming.subjectKey ?? '', winner, incoming))
        continue
      }
      retained.delete(winner)
      retained.add(incoming)
      winner = incoming
    }
  }

  const unresolvedConflicts = conflicts.filter(conflict => !resolvedConflictIds.has(conflict.id))
  const conflictByFact = new Map<string, MemoryFactConflict[]>()
  for (const conflict of unresolvedConflicts) {
    addConflict(conflictByFact, String(conflict.factId), conflict)
    addConflict(conflictByFact, String(conflict.previousFactId), conflict)
  }
  const people = new Map<string, MemoryFactEntry[]>()
  const world: MemoryFactEntry[] = []
  for (const entry of entries) {
    if (!retained.has(entry)) continue
    const projected = {
      ...entry,
      conflicts: structuredClone(conflictByFact.get(String(entry.factId)) ?? []),
    }
    if (projected.target === 'world') {
      world.push(projected)
      continue
    }
    const personId = projected.personId ?? 'person:unknown'
    const personFacts = people.get(personId) ?? []
    personFacts.push(projected)
    people.set(personId, personFacts)
  }

  return {
    people: Object.fromEntries([...people].map(([id, facts]) => [id, structuredClone(facts)])),
    world: structuredClone(world),
    conflicts: structuredClone(unresolvedConflicts),
  }
}

/**
 * Consolidate append-only fact records into one branch-safe memory projection.
 *
 * The array overload is convenient for callers that only have an alias list;
 * object options should be used when sequence or branch visibility also needs
 * to be constrained.
 * @param records - Append-only fact records in log order.
 * @param optionsOrAliases - Projection options or subject-key aliases.
 * @returns The consolidated active facts and unresolved conflicts.
 */
export function consolidateMemoryFacts(
  records: readonly MemoryFactRecord[],
  optionsOrAliases: MemoryProjectionOptions | readonly MemorySubjectKeyAlias[] = {},
): MemoryFactProjection {
  const options: MemoryProjectionOptions = isSubjectKeyAliasList(optionsOrAliases)
    ? { subjectKeyAliases: optionsOrAliases }
    : optionsOrAliases
  return projectMemoryFacts(records, options)
}

/**
 * Return all retained projected facts in deterministic event order.
 * @param projection - Folded memory projection to flatten.
 * @returns Active world and people facts sorted by event sequence.
 */
export function flattenMemoryProjection(projection: MemoryFactProjection): readonly MemoryFactEntry[] {
  return [...projection.world, ...Object.values(projection.people).flat()].sort(compareEntries)
}

function projectEntry(
  record: MemoryFactRecord,
  data: MemoryFactEvent,
  predecessor: MemoryFactEntry | undefined,
  resolveSubjectKey: (value: string | undefined) => string | undefined,
): MemoryFactEntry | undefined {
  if (data.factId === undefined || data.text === undefined || data.text.trim().length === 0) return undefined
  if (data.operation === 'replace' && predecessor === undefined) return undefined
  const subjectKey = resolveSubjectKey(data.subjectKey ?? predecessor?.subjectKey)
  const sourceAssetId = data.sourceAssetId ?? predecessor?.sourceAssetId
  const sourceEntryId = data.sourceEntryId ?? predecessor?.sourceEntryId
  const assistantSeq = data.assistantSeq ?? predecessor?.assistantSeq
  const authority = data.authority ?? 'observed'
  const source = sourceFor(authority, sourceAssetId, sourceEntryId, assistantSeq)
  return {
    factId: data.factId as MemoryFactEntry['factId'],
    target: data.target,
    ...(data.personId === undefined
      ? predecessor?.personId === undefined ? {} : { personId: predecessor.personId }
      : { personId: data.personId }),
    text: data.text.trim(),
    ...(data.label === undefined
      ? predecessor?.label === undefined ? {} : { label: predecessor.label }
      : { label: data.label }),
    branch: data.branch,
    authority,
    kind: data.kind ?? predecessor?.kind ?? 'soft',
    ...(subjectKey === undefined ? {} : { subjectKey }),
    ...(data.extractionId === undefined
      ? predecessor?.extractionId === undefined ? {} : { extractionId: predecessor.extractionId }
      : { extractionId: data.extractionId }),
    ...(data.explicit === undefined
      ? predecessor?.explicit === undefined ? {} : { explicit: predecessor.explicit }
      : { explicit: data.explicit }),
    ...(data.replacesFactId === undefined ? {} : { replacesFactId: data.replacesFactId }),
    ...(sourceAssetId === undefined ? {} : { sourceAssetId }),
    ...(sourceEntryId === undefined ? {} : { sourceEntryId }),
    ...(assistantSeq === undefined ? {} : { assistantSeq }),
    ...(data.turn === undefined
      ? predecessor?.turn === undefined ? {} : { turn: predecessor.turn }
      : { turn: data.turn }),
    source,
    eventSeq: record.seq,
    conflicts: [],
  }
}

function sourceFor(
  authority: MemoryFactAuthority,
  sourceAssetId: string | undefined,
  sourceEntryId: string | undefined,
  assistantSeq: number | undefined,
): MemoryFactEntry['source'] {
  if (authority === 'user') return { kind: 'user' }
  if (sourceAssetId !== undefined) {
    return sourceEntryId === undefined
      ? { kind: 'asset', assetId: sourceAssetId }
      : { kind: 'asset', assetId: sourceAssetId, entryId: sourceEntryId }
  }
  return assistantSeq === undefined ? { kind: 'system' } : { kind: 'assistant', assistantSeq }
}

function makeConflict(
  subjectKey: string,
  previous: MemoryFactEntry,
  incoming: MemoryFactEntry,
): MemoryFactConflict {
  return {
    id: `memory-conflict:${incoming.eventSeq}:${incoming.factId}:${previous.factId}`,
    factId: incoming.factId,
    previousFactId: previous.factId,
    subjectKey,
    previousText: previous.text,
    incomingText: incoming.text,
    previousAuthority: previous.authority,
    incomingAuthority: incoming.authority,
    ...(previous.explicit === undefined ? {} : { previousExplicit: previous.explicit }),
    ...(incoming.explicit === undefined ? {} : { incomingExplicit: incoming.explicit }),
    previousEventSeq: previous.eventSeq,
    incomingEventSeq: incoming.eventSeq,
  }
}

function addConflict(
  target: Map<string, MemoryFactConflict[]>,
  factId: string,
  conflict: MemoryFactConflict,
): void {
  const current = target.get(factId) ?? []
  current.push(conflict)
  target.set(factId, current)
}

function compareEntries(left: MemoryFactEntry, right: MemoryFactEntry): number {
  return left.eventSeq - right.eventSeq || String(left.factId).localeCompare(String(right.factId))
}

function isSubjectKeyAliasList(
  value: MemoryProjectionOptions | readonly MemorySubjectKeyAlias[],
): value is readonly MemorySubjectKeyAlias[] {
  return Array.isArray(value)
}
