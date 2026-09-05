/** Journey-local natural-language facts and their append-only projection. */

import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {
  CharacterAsset,
  PromptAssetBaseline,
  WorldInfoAsset,
  WorldInfoEntry,
} from '@deepseek-ai/dsh-tavern-assets/types'
import { createHash } from 'node:crypto'
import type {
  TavernFactEntry,
  TavernFactAuthority,
  TavernFactConflict,
  TavernFactEvent,
  TavernFactKind,
  TavernFactProjection,
  TavernGmUpdateCandidate,
  TavernGmUpdatesParseResult,
  TavernGmResponse,
  TavernJourneyAssetProjection,
  TavernJourneyField,
  TavernJourneyPerson,
  TavernJourneySelection,
  TavernPersonId,
  TavernFactTarget,
} from './types.ts'
import { collectCharacterEntries, isRecord, parseLabeledLines, slug } from '@deepseek-ai/dsh-tavern-shared'
import { compareFactFreshness, normalizeSubjectKey } from '@deepseek-ai/dsh-tavern-memory'

const HARD_FACT_LABELS = [
  'location', 'geography', 'direction', 'position', 'time', 'date', 'alive', 'dead',
  'death', 'count', 'quantity', 'number', 'rule', 'law', 'status', 'state',
  '方位', '地点', '地理', '位置', '时间', '日期', '生死', '数量', '规则', '状态',
] as const

/** A validated automatic fact mutation ready for Host application. */
export interface ValidatedTavernFactOperation {
  readonly target: TavernFactTarget
  readonly personId?: TavernPersonId
  readonly operation: 'add' | 'replace' | 'remove'
  readonly factId?: string
  readonly replacesFactId?: string
  readonly text?: string
  readonly label?: string
  readonly kind: TavernFactKind
  readonly subjectKey?: string
  readonly extractionId?: string
  readonly explicit?: boolean
}

/** Result of applying one parsed GM response to a Journey session. */
export interface AppliedTavernGmResponse {
  readonly response: TavernGmResponse
  readonly factEvents: readonly SessionEvent<'tavern/fact'>[]
}

/** A fact event paired with its append-only log sequence for pure projection. */
export interface TavernFactRecord {
  readonly seq: number
  readonly data: TavernFactEvent
}

/** Branch and sequence scope used by the fact projector. */
export interface ResolveFactProjectionOptions {
  readonly maxSeq?: number
  /** Exact branch when the records contain more than one independent stream. */
  readonly branch?: string
  /** Ordered branch lineage, including the current branch, for fork projection. */
  readonly branchLineage?: readonly string[]
}

/** Input to the side-effect-free GM update validator and event builder. */
export interface ApplyGmUpdatesInput {
  readonly updates: unknown
  readonly branch: string
  readonly assistantSeq: number
  readonly turn: number
  readonly baseline?: PromptAssetBaseline
  readonly existing: readonly TavernFactRecord[]
  readonly idempotencyKey?: string
}

/** Pure result of validating and applying one GM updates envelope. */
export interface AppliedGmUpdates {
  readonly events: readonly TavernFactEvent[]
  readonly projection: TavernFactProjection
  readonly conflicts: readonly TavernFactConflict[]
}

/** Options for generating append-only invalidation events after a message deletion. */
export interface RevertFactsOptions {
  readonly branch?: string
  readonly turn?: number
}

interface TavernFactOperationCandidate {
  readonly op: string
  readonly factId?: string
  readonly replacesFactId?: string
  readonly text?: string
  readonly label?: string
  readonly kind?: string
  readonly subjectKey?: string
  readonly extractionId?: string
  readonly explicit?: boolean
}

type ActiveFactIndex = Map<string, TavernFactEntry>

/**
 * Parse the untrusted `updates` member into operation candidates without applying any mutation.
 * @param updates - Untrusted value from one parsed GM response.
 * @returns Extracted candidates and an envelope-level rejection when the collection is malformed.
 */
export function parseTavernGmUpdates(updates: unknown): TavernGmUpdatesParseResult {
  const operations = collectOperations(updates)
  const rejection = updateEnvelopeRejection(updates, operations.length)
  return {
    operations,
    ...(rejection === undefined ? {} : { rejection }),
  }
}

/**
 * Project accepted automatic fact events into active Journey facts.
 * @param session - Session event log whose accepted fact events are projected.
 * @param maxSeq - Inclusive sequence limit for historical projection.
 * @returns Active Journey facts grouped by person and world scope.
 */
export function resolveTavernFacts(session: Pick<Session, 'events'>, maxSeq = Number.MAX_SAFE_INTEGER): TavernFactProjection {
  return resolveFactProjection(
    session.events
      .filter((event): event is SessionEvent<'tavern/fact'> => event.type === 'tavern/fact')
      .filter(event => factIsVisibleInSession(session, event.seq, event.data.branch))
      .map(event => ({ seq: event.seq, data: event.data })),
    { maxSeq },
  )
}

/**
 * Keep a fork's inherited seed prefix and its own branch suffix in one projection.
 * Seed events retain their original branch for auditability; `seedLength` is the
 * durable boundary that prevents parent events from the replaced turn leaking in.
 * @param session - Session view containing the event log and optional fork metadata.
 * @param seq - Fact event sequence to classify.
 * @param branch - Branch recorded by the fact event.
 * @returns Whether the fact belongs to the visible session lineage.
 */
export function factIsVisibleInSession(
  session: Pick<Session, 'events'> & Partial<Pick<Session, 'id' | 'header'>>,
  seq: number,
  branch: string,
): boolean {
  const seedLength = session.header?.seedLength
  const sessionId = session.id
  if (seedLength === undefined || sessionId === undefined) return true
  return seq < seedLength || branch === String(sessionId)
}

/** Alias for callers that use the predicate name rather than the session name. */
export const isTavernFactVisibleInSession = factIsVisibleInSession

/**
 * Rebuild the active fact projection from immutable fact records.
 *
 * The input is a branch-local lineage: a fork includes its inherited prefix
 * before its own events. When callers combine independent logs, they must pass
 * `branch` or `branchLineage`; an exact branch intentionally excludes inherited
 * records unless those branch ids are listed in `branchLineage`.
 * @param records - Fact records in append order.
 * @param options - Optional sequence and branch scope.
 * @returns Active facts, grouped by target, with unresolved hard conflicts.
 */
export function resolveFactProjection(
  records: readonly TavernFactRecord[],
  options: ResolveFactProjectionOptions = {},
): TavernFactProjection {
  const active = new Map<string, TavernFactEntry>()
  const visible = records
    .filter(record => record.seq <= (options.maxSeq ?? Number.MAX_SAFE_INTEGER))
    .filter(record => branchIncluded(record.data.branch, options))
  for (const record of visible) {
    const data = record.data
    if (!data.accepted || data.factId === undefined) continue
    const current = active.get(data.factId)
    if (data.operation === 'remove') {
      active.delete(data.factId)
      continue
    }
    const predecessor = data.replacesFactId === undefined ? current : active.get(data.replacesFactId)
    const entry = projectFactEntry(record, data, current, predecessor)
    if (entry === undefined) continue
    active.set(String(entry.factId), entry)
  }
  const subjectFold = foldSubjectKeyFacts(active)
  for (const factId of active.keys()) {
    if (!subjectFold.retained.has(factId)) active.delete(factId)
  }
  const conflicts = [...detectConflicts(visible), ...subjectFold.conflicts]
  const conflictsByFact = new Map<string, TavernFactConflict[]>()
  for (const conflict of conflicts) {
    const incoming = conflictsByFact.get(String(conflict.factId)) ?? []
    incoming.push(conflict)
    conflictsByFact.set(String(conflict.factId), incoming)
    const previous = conflictsByFact.get(String(conflict.previousFactId)) ?? []
    previous.push(conflict)
    conflictsByFact.set(String(conflict.previousFactId), previous)
  }
  const people = new Map<string, TavernFactEntry[]>()
  const world: TavernFactEntry[] = []
  for (const entry of active.values()) {
    const withConflicts = {
      ...entry,
      conflicts: structuredClone(conflictsByFact.get(String(entry.factId)) ?? []),
    }
    if (entry.target === 'world') world.push(withConflicts)
    else {
      const personFacts = people.get(String(entry.personId)) ?? []
      personFacts.push(withConflicts)
      people.set(String(entry.personId), personFacts)
    }
  }
  return {
    people: Object.fromEntries([...people].map(([personId, facts]) => [personId, structuredClone(facts)])),
    world: structuredClone(world),
    conflicts: structuredClone(conflicts),
  }
}

/**
 * Render active hard facts as a deterministic model-visible constraint block.
 * @param projection - Active fact projection to constrain the next generation.
 * @returns Empty text when no hard facts exist, otherwise a binding constraint section.
 */
export function hardFactConstraintText(projection: TavernFactProjection): string {
  const facts = [...projection.world, ...Object.values(projection.people).flat()]
    .filter(fact => fact.kind === 'hard')
  if (facts.length === 0) return ''
  return [
    'Hard facts are binding constraints. Do not contradict them unless the player explicitly resolves the conflict.',
    ...facts.map(fact => `- ${fact.target === 'world' ? 'world' : fact.personId ?? 'person'} / ${fact.label ?? 'Fact'}: ${fact.text}`),
  ].join('\n')
}

/**
 * Alias for callers that name the generated block by its rendering role.
 * @param projection - Active fact projection to constrain the next generation.
 * @returns The deterministic hard-fact constraint block.
 */
export function renderHardFactConstraints(projection: TavernFactProjection): string {
  return hardFactConstraintText(projection)
}

function branchIncluded(branch: string, options: ResolveFactProjectionOptions): boolean {
  if (options.branchLineage !== undefined) return options.branchLineage.includes(branch)
  return options.branch === undefined || options.branch === branch
}

/**
 * Detect unresolved disagreements between hard facts for one entity and label.
 *
 * The detector uses maps keyed by fact id and entity/label, so replay remains
 * linear in the number of fact events. Soft facts and equal hard values are
 * intentionally ignored. A later event can explicitly clear a conflict id;
 * this is how a user decision remains visible in the append-only audit trail.
 * @param records - Fact records in append order.
 * @param options - Optional sequence and branch scope.
 * @returns Current unresolved hard-fact disagreements in encounter order.
 */
export function detectConflicts(
  records: readonly TavernFactRecord[],
  options: ResolveFactProjectionOptions = {},
): readonly TavernFactConflict[] {
  const active = new Map<string, FactState>()
  const hardByKey = new Map<string, Set<string>>()
  const conflicts = new Map<string, TavernFactConflict>()
  for (const record of records) {
    if (record.seq > (options.maxSeq ?? Number.MAX_SAFE_INTEGER)
      || !branchIncluded(record.data.branch, options)) continue
    const data = record.data
    if (!data.accepted || data.factId === undefined) continue
    for (const conflictId of data.resolvesConflictIds ?? []) conflicts.delete(conflictId)
    if (data.subjectKey !== undefined) continue
    if (data.operation === 'remove') {
      const previous = active.get(data.factId)
      if (previous !== undefined) removeHardFact(previous, hardByKey)
      active.delete(data.factId)
      deleteConflictsForFact(conflicts, data.factId)
      continue
    }
    if (data.text === undefined) continue
    const current = active.get(data.factId)
    if (data.operation === 'replace' && current === undefined && data.replacesFactId === undefined) continue
    const previous = data.replacesFactId === undefined ? current : active.get(data.replacesFactId)
    if (data.operation === 'replace' && previous === undefined) continue
    const factId = projectedFactId(record, data, current)
    const keepsPredecessor = data.replacesFactId !== undefined || (factId !== data.factId)
    if (!keepsPredecessor && previous !== undefined) removeHardFact(previous, hardByKey)
    const subjectKey = normalizeSubjectKey(data.subjectKey)
    const incoming: FactState = {
      factId,
      target: data.personId === undefined && previous?.personId === undefined ? 'world' : 'person',
      text: data.text,
      authority: data.authority ?? 'gm',
      kind: factKind(data),
      ...(subjectKey === undefined ? {} : { subjectKey }),
      ...(data.explicit === undefined ? {} : { explicit: data.explicit }),
      ...(data.extractionId === undefined ? {} : { extractionId: data.extractionId }),
      eventSeq: record.seq,
      ...(data.personId !== undefined
        ? { personId: data.personId as TavernPersonId }
        : previous?.personId === undefined ? {} : { personId: previous.personId }),
      ...(data.label !== undefined
        ? { label: data.label }
        : previous?.label === undefined ? {} : { label: previous.label }),
    }
    if (incoming.kind === 'hard') {
      const key = factEntityKey(incoming)
      const peers = hardByKey.get(key) ?? new Set<string>()
      if (previous !== undefined
        && previous.kind === 'hard'
        && previous.text !== incoming.text
        && sameFactEntity(previous, incoming)) {
        addConflict(conflicts, previous, incoming, record.seq)
      }
      for (const peerId of peers) {
        const peer = active.get(peerId)
        if (peer !== undefined && peer.text !== incoming.text) addConflict(conflicts, peer, incoming, record.seq)
      }
      peers.add(incoming.factId)
      hardByKey.set(key, peers)
    }
    active.set(incoming.factId, incoming)
  }
  return [...conflicts.values()]
}

interface FactState {
  readonly factId: string
  readonly target: TavernFactTarget
  readonly personId?: TavernPersonId
  readonly label?: string
  readonly text: string
  readonly authority: TavernFactAuthority
  readonly kind: TavernFactKind
  readonly subjectKey?: string
  readonly explicit?: boolean
  readonly extractionId?: string
  readonly eventSeq: number
  readonly sourceAssetId?: string
  readonly sourceEntryId?: string
  readonly assistantSeq?: number
  readonly turn?: number
}

function factEntityKey(fact: Pick<FactState, 'target' | 'personId' | 'label'> & Partial<Pick<FactState, 'subjectKey'>>): string {
  return fact.subjectKey === undefined
    ? `${fact.target}:${fact.personId ?? ''}:${(fact.label ?? '').trim().toLocaleLowerCase()}`
    : `subject:${fact.subjectKey}`
}

function sameFactEntity(left: FactState, right: FactState): boolean {
  return factEntityKey(left) === factEntityKey(right)
}

function removeHardFact(fact: FactState, index: Map<string, Set<string>>): void {
  if (fact.kind !== 'hard') return
  const key = factEntityKey(fact)
  const ids = index.get(key)
  if (ids === undefined) return
  ids.delete(fact.factId)
  if (ids.size === 0) index.delete(key)
}

function addConflict(
  conflicts: Map<string, TavernFactConflict>,
  previous: FactState,
  incoming: FactState,
  incomingEventSeq: number,
): void {
  const id = `conflict:${incomingEventSeq}:${incoming.factId}:${previous.factId}`
  conflicts.set(id, {
    id,
    factId: incoming.factId as TavernFactEntry['factId'],
    previousFactId: previous.factId as TavernFactEntry['factId'],
    label: incoming.label ?? previous.label ?? 'Fact',
    previousText: previous.text,
    incomingText: incoming.text,
    previousAuthority: previous.authority,
    incomingAuthority: incoming.authority,
    previousEventSeq: previous.eventSeq,
    incomingEventSeq,
  })
}

function deleteConflictsForFact(conflicts: Map<string, TavernFactConflict>, factId: string): void {
  for (const [id, conflict] of conflicts) {
    if (String(conflict.factId) === factId || String(conflict.previousFactId) === factId) conflicts.delete(id)
  }
}

function factKind(data: TavernFactEvent): TavernFactKind {
  return data.kind ?? inferFactKind(data.label)
}

function projectedFactId(
  record: TavernFactRecord,
  data: TavernFactEvent,
  current: TavernFactEntry | FactState | undefined,
): string {
  if (data.replacesFactId !== undefined) return String(data.factId)
  if (data.operation !== 'replace' || current === undefined || current.text === data.text || data.authority === 'user') {
    return String(data.factId)
  }
  if (factKind(data) !== 'hard') return String(data.factId)
  return `fact:${String(data.factId)}:replacement:${record.seq}`
}

interface SubjectFoldResult {
  readonly retained: ReadonlySet<string>
  readonly conflicts: readonly TavernFactConflict[]
}

/** Fold structure-keyed facts while preserving explicit and user conflicts. */
function foldSubjectKeyFacts(active: ReadonlyMap<string, TavernFactEntry>): SubjectFoldResult {
  const retained = new Set(active.keys())
  const groups = new Map<string, TavernFactEntry[]>()
  for (const entry of active.values()) {
    if (entry.subjectKey === undefined) continue
    const groupKey = `${entry.target}\u0000${entry.personId ?? ''}\u0000${entry.subjectKey}`
    const group = groups.get(groupKey) ?? []
    group.push(entry)
    groups.set(groupKey, group)
  }
  const conflicts: TavernFactConflict[] = []
  for (const group of groups.values()) {
    group.sort((left, right) => left.eventSeq - right.eventSeq)
    let winner = group[0]
    if (winner === undefined) continue
    for (const incoming of group.slice(1)) {
      const decision = compareFactFreshness(
        { text: winner.text, authority: winner.authority ?? 'gm', ...(winner.explicit === undefined ? {} : { explicit: winner.explicit }) },
        { text: incoming.text, authority: incoming.authority ?? 'gm', ...(incoming.explicit === undefined ? {} : { explicit: incoming.explicit }) },
      )
      if (decision === 'duplicate') {
        retained.delete(String(incoming.factId))
        continue
      }
      if (decision === 'protected-conflict') {
        const subjectKey = incoming.subjectKey
        if (subjectKey === undefined) continue
        conflicts.push({
          id: `conflict:subject:${incoming.eventSeq}:${incoming.factId}:${winner.factId}`,
          factId: incoming.factId,
          previousFactId: winner.factId,
          subjectKey,
          label: subjectKey.slice(subjectKey.indexOf('.') + 1),
          previousText: winner.text,
          incomingText: incoming.text,
          previousAuthority: winner.authority ?? 'gm',
          incomingAuthority: incoming.authority ?? 'gm',
          ...(winner.explicit === undefined ? {} : { previousExplicit: winner.explicit }),
          ...(incoming.explicit === undefined ? {} : { incomingExplicit: incoming.explicit }),
          previousEventSeq: winner.eventSeq,
          incomingEventSeq: incoming.eventSeq,
        })
        continue
      }
      retained.delete(String(winner.factId))
      winner = incoming
    }
  }
  return { retained, conflicts }
}

/**
 * Read one person's active facts from a Journey projection.
 * @param session - Session event log whose fact events are projected.
 * @param personId - Person identifier whose active facts are returned.
 * @returns Active facts for the requested person.
 */
export function queryTavernPersonFacts(
  session: Pick<Session, 'events'>,
  personId: string,
): readonly TavernFactEntry[] {
  const people = resolveTavernFacts(session).people
  return Object.hasOwn(people, personId) ? people[personId] ?? [] : []
}

/**
 * Read active world facts from a Journey projection.
 * @param session - Session event log whose fact events are projected.
 * @returns Active facts in the world collection.
 */
export function queryTavernWorldFacts(session: Pick<Session, 'events'>): readonly TavernFactEntry[] {
  return resolveTavernFacts(session).world
}

/**
 * Project the current Journey details from its resolved source selection and active facts.
 * @param selection - Selected asset IDs resolved to current source data.
 * @param facts - Active fact projection to overlay on the source data.
 * @returns Latest people, dynamic fields, and source-backed selection details.
 */
export function projectTavernJourneyAssets(
  selection: TavernJourneySelection,
  facts: TavernFactProjection,
): TavernJourneyAssetProjection {
  const sourcePeople = collectSourcePeople(selection)
  const people = sourcePeople.map(source => projectPerson(source, facts.people[source.personId] ?? []))
  const sourcePersonIds = new Set(sourcePeople.map(person => person.personId))
  for (const [personId, personFacts] of Object.entries(facts.people)) {
    if (sourcePersonIds.has(personId) || personFacts.length === 0) continue
    people.push(projectPerson({
      personId,
      name: latestFieldValue(personFacts.flatMap(factFields), 'name') ?? humanizePersonId(personId),
      source: sourceReferenceFromFacts(personFacts),
      content: '',
    }, personFacts))
  }

  const worldFacts = facts.world
  const characterPersonId = selection.character === null ? undefined : `person:${slug(selection.character.name, 'person')}`
  const characterFacts = characterPersonId === undefined ? [] : facts.people[characterPersonId] ?? []
  const character = projectCharacter(selection.character, people, characterFacts)
  return {
    ...structuredClone(selection),
    character,
    characterName: character?.name ?? selection.characterName,
    people,
    characterFields: characterFacts.flatMap(factFields),
    worldFields: worldFacts.flatMap(factFields),
    facts: structuredClone(facts),
  }
}

function sourceReferenceFromFacts(
  facts: readonly TavernFactEntry[],
): { readonly assetId: WorldInfoAsset['id']; readonly entryId: WorldInfoEntry['id'] } | null {
  const fact = facts.find(candidate => candidate.sourceAssetId !== undefined && candidate.sourceEntryId !== undefined)
  return fact?.sourceAssetId === undefined || fact.sourceEntryId === undefined
    ? null
    : { assetId: fact.sourceAssetId as WorldInfoAsset['id'], entryId: fact.sourceEntryId as WorldInfoEntry['id'] }
}

interface PersonSeed {
  readonly personId: string
  readonly name: string
  readonly source: { readonly assetId: WorldInfoAsset['id']; readonly entryId: WorldInfoEntry['id'] } | null
  readonly content: string
}

function collectSourcePeople(selection: TavernJourneySelection): PersonSeed[] {
  const worlds = selection.character?.characterBook === null || selection.character?.characterBook === undefined
    ? [...selection.worldInfo]
    : [selection.character.characterBook, ...selection.worldInfo]
  const people: PersonSeed[] = []
  const knownEntries = new Set<string>()
  for (const world of worlds) {
    for (const entry of world.entries) {
      const sourceEntryKey = `${String(world.id)}\u0000${String(entry.id)}`
      if (knownEntries.has(sourceEntryKey)) continue
      knownEntries.add(sourceEntryKey)
      const character = collectCharacterEntries([entry])[0]
      if (character === undefined) continue
      const name = character.name
      const personId = `person:${slug(name, 'person')}`
      people.push({
        personId,
        name,
        source: { assetId: world.id, entryId: entry.id },
        content: entry.content,
      })
    }
  }
  return people
}

function projectPerson(source: PersonSeed, facts: readonly TavernFactEntry[]): TavernJourneyPerson {
  const localFields = facts.flatMap(factFields)
  const name = latestFieldValue(localFields, 'name') ?? source.name
  const content = [source.content, ...facts.map(fact => fact.text)].filter(text => text.length > 0).join('\n')
  return {
    personId: source.personId as TavernPersonId,
    name,
    source: source.source,
    content,
    fields: localFields,
    facts: structuredClone(facts),
  }
}

function projectCharacter(
  character: CharacterAsset | null,
  people: readonly TavernJourneyPerson[],
  facts: readonly TavernFactEntry[],
): CharacterAsset | null {
  if (character === null) return null
  const person = people.find(candidate => candidate.personId === `person:${slug(character.name, 'person')}`)
  const name = latestFieldValue(facts.flatMap(factFields), 'name') ?? person?.name
  return name === undefined || name === character.name
    ? structuredClone(character)
    : { ...structuredClone(character), name }
}

function factFields(fact: TavernFactEntry): readonly TavernJourneyField[] {
  const parsed = parseLabeledLines(fact.text)
  if (fact.label !== undefined) {
    return [{
      id: String(fact.factId),
      label: fact.label,
      value: labeledValue(fact.text, fact.label),
      factId: fact.factId,
      origin: 'fact',
    }]
  }
  if (parsed.length > 0) {
    return parsed.map((field, index) => ({
      id: `${String(fact.factId)}:${index + 1}`,
      label: field.label,
      value: field.value,
      factId: fact.factId,
      origin: 'fact' as const,
    }))
  }
  return [{ id: String(fact.factId), label: 'Fact', value: fact.text, factId: fact.factId, origin: 'fact' }]
}

function latestFieldValue(fields: readonly TavernJourneyField[], label: string): string | undefined {
  const normalized = label.toLocaleLowerCase()
  return [...fields].reverse().find(field => field.label.trim().toLocaleLowerCase() === normalized)?.value.trim() || undefined
}

function labeledValue(text: string, label: string): string {
  const normalizedLabel = label.trim().toLocaleLowerCase()
  return parseLabeledLines(text)
    .find(field => field.label.trim().toLocaleLowerCase() === normalizedLabel)?.value ?? text.trim()
}

function humanizePersonId(personId: string): string {
  const value = personId.replace(/^person:/, '').replace(/-/g, ' ').trim()
  return value.replace(/\b\w/g, character => character.toUpperCase()) || personId
}

/**
 * Validate one GM update envelope and build immutable fact events without I/O.
 *
 * The returned events are ready for a Session append adapter. Validation is
 * performed against a working projection after every accepted operation, which
 * makes a same-envelope add followed by replace deterministic and ensures that
 * replace/remove cannot target an unknown or cross-collection fact id.
 * @param input - Envelope, source branch, anchors, and existing fact records.
 * @returns Accepted and rejected events plus the resulting pure projection.
 */
export function applyGmUpdates(input: ApplyGmUpdatesInput): AppliedGmUpdates {
  const parsed = parseTavernGmUpdates(input.updates)
  const records = [...input.existing]
  const events: TavernFactEvent[] = []
  const initialProjection = resolveFactProjection(records)
  const activeFacts = activeFactIndex(initialProjection)
  const activePersonIds = new Set([...activeFacts.values()]
    .map(fact => fact.personId)
    .filter((personId): personId is TavernPersonId => personId !== undefined))
  const knownPersonIds = new Set(input.baseline === undefined ? [] : knownTavernPersonIds(input.baseline))
  let nextSeq = Math.max(-1, ...records.map(record => record.seq)) + 1
  const append = (data: TavernFactEvent): void => {
    const seq = nextSeq
    events.push(data)
    records.push({ seq, data })
    nextSeq += 1
    applyWorkingFact(activeFacts, seq, data)
    if (data.personId !== undefined && data.accepted) activePersonIds.add(data.personId as TavernPersonId)
  }
  if (parsed.rejection !== undefined) {
    append({
      branch: input.branch,
      target: 'world',
      operation: 'add',
      authority: 'gm',
      kind: 'soft',
      assistantSeq: input.assistantSeq,
      turn: input.turn,
      ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
      accepted: false,
      rejection: parsed.rejection,
    })
  }
  for (const [index, candidate] of parsed.operations.entries()) {
    const validation = validateOperation(candidate, knownPersonIds, activePersonIds, activeFacts)
    const factId = validation.accepted && validation.operation === 'add'
      ? `fact:${input.assistantSeq}:${index + 1}`
      : validation.accepted && validation.operation === 'replace' && validation.kind === 'hard'
        ? `fact:${input.assistantSeq}:${index + 1}`
        : validation.factId
    const replacesFactId = validation.accepted
      && validation.operation === 'replace'
      ? validation.replacesFactId
        ?? (validation.kind === 'hard'
          && validation.factId !== undefined
          && factId !== validation.factId
          ? validation.factId
          : undefined)
      : undefined
    append({
      branch: input.branch,
      target: validation.target,
      ...(validation.personId === undefined ? {} : { personId: validation.personId }),
      operation: validation.operation,
      ...(factId === undefined ? {} : { factId }),
      ...(replacesFactId === undefined ? {} : { replacesFactId }),
      ...(validation.text === undefined ? {} : { text: validation.text }),
      ...(validation.label === undefined ? {} : { label: validation.label }),
      ...(validation.subjectKey === undefined ? {} : { subjectKey: validation.subjectKey }),
      ...(validation.extractionId === undefined ? {} : { extractionId: validation.extractionId }),
      ...(validation.explicit === undefined ? {} : { explicit: validation.explicit }),
      authority: 'gm',
      kind: validation.kind,
      assistantSeq: input.assistantSeq,
      turn: input.turn,
      ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
      accepted: validation.accepted,
      ...(validation.rejection === undefined ? {} : { rejection: validation.rejection }),
    })
  }
  const projection = resolveFactProjection(records)
  return { events, projection, conflicts: projection.conflicts ?? [] }
}

/**
 * Apply a GM response once, retaining rejected operations and preserving story.
 * @param session - Journey session receiving accepted and rejected fact events.
 * @param response - Parsed GM response containing story and optional updates.
 * @param assistantSeq - Sequence number of the assistant message that produced the response.
 * @param turn - Conversation turn associated with the response.
 * @param baseline - Journey asset baseline used to validate person targets.
 * @returns The response and fact events appended for this application.
 */
export function applyTavernGmResponse(
  session: Session,
  response: TavernGmResponse,
  assistantSeq: number,
  turn: number,
  baseline: PromptAssetBaseline | undefined,
): AppliedTavernGmResponse {
  const idempotencyKey = gmResponseIdempotencyKey(response, turn)
  const sameResponse = session.events.filter((event): event is SessionEvent<'tavern/fact'> =>
    event.type === 'tavern/fact' && event.data.idempotencyKey === idempotencyKey)
  if (sameResponse.length > 0) return { response: structuredClone(response), factEvents: sameResponse }
  const existing = session.events.filter((event): event is SessionEvent<'tavern/fact'> =>
    event.type === 'tavern/fact' && event.data.assistantSeq === assistantSeq)
  if (existing.length > 0) return { response: structuredClone(response), factEvents: existing }
  const applied = applyGmUpdates({
    updates: response.updates,
    branch: String(session.id),
    assistantSeq,
    turn,
    ...(baseline === undefined ? {} : { baseline }),
    idempotencyKey,
    existing: session.events
      .filter((event): event is SessionEvent<'tavern/fact'> => event.type === 'tavern/fact')
      .map(event => ({ seq: event.seq, data: event.data })),
  })
  const factEvents = applied.events.map(data => session.append('tavern/fact', data))
  return { response: structuredClone(response), factEvents }
}

function gmResponseIdempotencyKey(response: TavernGmResponse, turn: number): string {
  const serialized = JSON.stringify(response)
  const digest = createHash('sha256').update(serialized).digest('hex')
  return `gm:${turn}:${digest}`
}

function updateEnvelopeRejection(value: unknown, operationCount: number): string | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) return 'updates must be an object'
  const keys = Object.keys(value)
  if (keys.length === 0) return 'updates must contain people or world operation arrays'
  const unknown = keys.filter(key => key !== 'people' && key !== 'world')
  if (unknown.length > 0) return `updates contains unknown field${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`
  if (value['people'] !== undefined && !isRecord(value['people'])) {
    return operationCount === 0 ? 'updates.people must be an object' : undefined
  }
  if (value['world'] !== undefined && !Array.isArray(value['world'])) {
    return operationCount === 0 ? 'updates.world must be an array' : undefined
  }
  const people = value['people']
  const world = value['world']
  if ((world === undefined || world.length === 0)
    && (people === undefined || Object.keys(people).length === 0)) {
    return 'updates must contain at least one operation'
  }
  return undefined
}

/**
 * Append one user correction without allowing a user-created fact.
 * @param session - Journey session receiving the replacement event.
 * @param input - Existing fact identifier and replacement text.
 * @returns The replacement event appended to the Session log.
 */
export function appendTavernFactEdit(
  session: Session,
  input: { readonly factId: string; readonly text: string },
): SessionEvent<'tavern/fact'> {
  const current = findFact(resolveTavernFacts(session), input.factId)
  if (current === undefined) throw new Error(`Tavern fact '${input.factId}' was not found`)
  const text = input.text.trim()
  if (text.length === 0) throw new Error('Tavern fact text must not be empty')
  return session.append('tavern/fact', {
    branch: String(session.id),
    target: current.target,
    ...(current.personId === undefined ? {} : { personId: current.personId }),
    operation: 'replace',
    factId: current.factId,
    text,
    ...(current.assistantSeq === undefined ? {} : { assistantSeq: current.assistantSeq }),
    ...(current.turn === undefined ? {} : { turn: current.turn }),
    authority: 'user',
    kind: current.kind ?? 'soft',
    ...(current.subjectKey === undefined ? {} : { subjectKey: current.subjectKey }),
    explicit: true,
    accepted: true,
    ...((current.conflicts ?? []).length === 0 ? {} : { resolvesConflictIds: (current.conflicts ?? []).map(conflict => conflict.id) }),
  })
}

/**
 * Append a user revocation while retaining the original fact event.
 * @param session - Journey session receiving the revocation event.
 * @param factId - Existing active fact identifier.
 * @returns The revocation event appended to the Session log.
 */
export function appendTavernFactRemoval(
  session: Session,
  factId: string,
): SessionEvent<'tavern/fact'> {
  const current = findFact(resolveTavernFacts(session), factId)
  if (current === undefined) throw new Error(`Tavern fact '${factId}' was not found`)
  return session.append('tavern/fact', {
    branch: String(session.id),
    target: current.target,
    ...(current.personId === undefined ? {} : { personId: current.personId }),
    operation: 'remove',
    factId: current.factId,
    ...(current.assistantSeq === undefined ? {} : { assistantSeq: current.assistantSeq }),
    ...(current.turn === undefined ? {} : { turn: current.turn }),
    authority: 'user',
    ...(current.kind === undefined ? {} : { kind: current.kind }),
    ...(current.subjectKey === undefined ? {} : { subjectKey: current.subjectKey }),
    explicit: true,
    accepted: true,
  })
}

/**
 * Build append-only remove events for active facts produced at or after a
 * deleted assistant sequence. The original events remain untouched; callers
 * append the returned data to the current branch's Session.
 * @param records - Branch-local fact records in append order.
 * @param assistantSeq - Deleted assistant message sequence threshold.
 * @param options - Optional branch and turn metadata for the remove events.
 * @returns One user-authorized remove event per affected active fact.
 */
export function revertFactsFrom(
  records: readonly TavernFactRecord[],
  assistantSeq: number,
  options: RevertFactsOptions = {},
): readonly TavernFactEvent[] {
  const projection = resolveFactProjection(records, options.branch === undefined ? {} : { branch: options.branch })
  const facts = [...Object.values(projection.people).flat(), ...projection.world]
  return facts
    .filter(fact => fact.assistantSeq !== undefined && fact.assistantSeq >= assistantSeq)
    .map(fact => ({
      branch: options.branch ?? fact.branch ?? 'journey',
      target: fact.target,
      ...(fact.personId === undefined ? {} : { personId: fact.personId }),
      operation: 'remove' as const,
      factId: String(fact.factId),
      ...(fact.assistantSeq === undefined ? {} : { assistantSeq: fact.assistantSeq }),
      ...(options.turn === undefined && fact.turn === undefined ? {} : { turn: options.turn ?? fact.turn }),
      authority: 'user' as const,
      ...(fact.subjectKey === undefined ? {} : { subjectKey: fact.subjectKey }),
      explicit: true,
      ...(fact.kind === undefined ? {} : { kind: fact.kind }),
      accepted: true,
      revertedFromSeq: assistantSeq,
    }))
}

/**
 * Return person IDs explicitly represented by selected World Book entries.
 * @param baseline - Journey asset baseline whose World Book entries are inspected.
 * @returns Stable person IDs declared by character-type entries.
 */
export function knownTavernPersonIds(baseline: PromptAssetBaseline): readonly string[] {
  const ids = new Set<string>()
  for (const entry of baseline.worldInfoEntries) {
    const character = collectCharacterEntries([entry])[0]
    if (character === undefined) continue
    ids.add(`person:${slug(character.name, 'person')}`)
  }
  return [...ids]
}

function collectOperations(updates: unknown): readonly TavernGmUpdateCandidate[] {
  const result: TavernGmUpdateCandidate[] = []
  if (!isRecord(updates)) return []
  const world = updates['world']
  if (Array.isArray(world)) {
    for (const operation of world) result.push({ target: 'world', operation: asOperation(operation) })
  } else if (world !== undefined) {
    result.push({ target: 'world', operation: undefined })
  }
  const people = updates['people']
  if (isRecord(people)) {
    for (const [personId, values] of Object.entries(people)) {
      if (!Array.isArray(values)) {
        result.push({ target: 'people', personId, operation: undefined })
        continue
      }
      for (const operation of values) result.push({ target: 'people', personId, operation: asOperation(operation) })
    }
  } else if (people !== undefined) {
    result.push({ target: 'people', operation: undefined })
  }
  return result
}

function validateOperation(
  candidate: TavernGmUpdateCandidate,
  knownPersonIds: ReadonlySet<string>,
  activePersonIds: ReadonlySet<string>,
  activeFacts: ActiveFactIndex,
): ValidatedTavernFactOperation & { readonly accepted: boolean; readonly rejection?: string } {
  const operation = candidate.operation
  const normalizedOperation = operation === undefined || !isFactOperation(operation.op) ? 'add' : operation.op
  const kind = operation?.kind === 'hard'
    ? 'hard'
    : operation?.kind === 'soft'
      ? 'soft'
      : inferFactKind(operation?.label)
  const subjectKey = normalizeSubjectKey(operation?.subjectKey)
  const common = {
    target: candidate.target === 'people' ? 'person' as const : 'world' as const,
    ...(candidate.personId === undefined ? {} : { personId: candidate.personId as TavernPersonId }),
    operation: normalizedOperation,
    ...(operation?.factId === undefined ? {} : { factId: operation.factId }),
    ...(operation?.replacesFactId === undefined ? {} : { replacesFactId: operation.replacesFactId }),
    ...(operation?.text === undefined ? {} : { text: operation.text.trim() }),
    ...(operation?.label === undefined ? {} : { label: operation.label.trim() }),
    ...(subjectKey === undefined ? {} : { subjectKey }),
    ...(operation?.extractionId === undefined ? {} : { extractionId: operation.extractionId.trim() }),
    ...(operation?.explicit === undefined ? {} : { explicit: operation.explicit }),
    kind,
  }
  if (operation === undefined) return { ...common, accepted: false, rejection: 'updates entry must be an array of valid operations' }
  if (operation.kind !== undefined && operation.kind !== 'soft' && operation.kind !== 'hard') {
    return { ...common, accepted: false, rejection: `unknown fact kind '${operation.kind}'` }
  }
  if (operation.label !== undefined && operation.label.trim().length === 0) {
    return { ...common, accepted: false, rejection: 'label must be non-empty when provided' }
  }
  if (operation.explicit !== undefined && typeof operation.explicit !== 'boolean') {
    return { ...common, accepted: false, rejection: 'explicit must be boolean when provided' }
  }
  if (operation.extractionId !== undefined && operation.extractionId.trim().length === 0) {
    return { ...common, accepted: false, rejection: 'extractionId must be non-empty when provided' }
  }
  if (operation.subjectKey !== undefined && normalizeSubjectKey(operation.subjectKey) === undefined) {
    return { ...common, accepted: false, rejection: 'subjectKey is invalid' }
  }
  if (subjectKey !== undefined) {
    const domain = subjectKey.slice(0, subjectKey.indexOf('.'))
    if (candidate.target === 'people' && domain !== candidate.personId) {
      return { ...common, accepted: false, rejection: 'person subjectKey must match personId' }
    }
    if (candidate.target === 'world' && !domain.startsWith('world:')) {
      return { ...common, accepted: false, rejection: 'world subjectKey must use world:<slug>' }
    }
  }
  if (candidate.target === 'people') {
    if (candidate.personId === undefined || !/^person:[a-z0-9][a-z0-9-]*$/.test(candidate.personId)) {
      return { ...common, accepted: false, rejection: 'personId must use the person:<slug> format' }
    }
    if (!knownPersonIds.has(candidate.personId) && !activePersonIds.has(candidate.personId) && operation.op !== 'add') {
      return { ...common, accepted: false, rejection: `unknown personId '${candidate.personId}'` }
    }
  }
  if (!isFactOperation(operation.op)) {
    return { ...common, accepted: false, rejection: `unknown fact operation '${operation.op}'` }
  }
  const existing = operation.factId === undefined ? undefined : activeFacts.get(operation.factId)
  if (operation.op === 'add') {
    if (operation.text === undefined || operation.text.trim().length === 0) {
      return { ...common, accepted: false, rejection: 'add requires non-empty text' }
    }
    return { ...common, text: operation.text.trim(), accepted: true }
  }
  if (operation.factId === undefined || existing === undefined) {
    return { ...common, accepted: false, rejection: 'replace/remove requires an active factId' }
  }
  if (operation.op === 'replace' && (operation.text === undefined || operation.text.trim().length === 0)) {
    return { ...common, accepted: false, rejection: 'replace requires non-empty text' }
  }
  const candidateTarget = candidate.target === 'people' ? 'person' : 'world'
  if (existing.target !== candidateTarget || (existing.personId ?? undefined) !== candidate.personId) {
    return { ...common, accepted: false, rejection: 'factId belongs to another fact collection' }
  }
  const label = operation.op === 'replace' ? operation.label?.trim() ?? existing.label : undefined
  return {
    ...common,
    ...(label === undefined ? {} : { label }),
    ...(operation.text === undefined ? {} : { text: operation.text.trim() }),
    accepted: true,
  }
}

function activeFactIndex(projection: TavernFactProjection): ActiveFactIndex {
  const active = new Map<string, TavernFactEntry>()
  for (const facts of Object.values(projection.people)) {
    for (const fact of facts) active.set(String(fact.factId), fact)
  }
  for (const fact of projection.world) active.set(String(fact.factId), fact)
  return active
}

function applyWorkingFact(index: ActiveFactIndex, seq: number, data: TavernFactEvent): void {
  if (!data.accepted || data.factId === undefined) return
  if (data.operation === 'remove') {
    index.delete(data.factId)
    return
  }
  const current = index.get(data.factId)
  const predecessor = data.replacesFactId === undefined ? current : index.get(data.replacesFactId)
  const entry = projectFactEntry({ seq, data }, data, current, predecessor)
  if (entry === undefined) return
  index.set(String(entry.factId), entry)
}

function projectFactEntry(
  record: TavernFactRecord,
  data: TavernFactEvent,
  current: TavernFactEntry | FactState | undefined,
  predecessor: TavernFactEntry | FactState | undefined,
): TavernFactEntry | undefined {
  if (data.factId === undefined || data.text === undefined) return undefined
  if (data.operation === 'replace' && predecessor === undefined) return undefined
  const factId = projectedFactId(record, data, current)
  const subjectKey = normalizeSubjectKey(data.subjectKey ?? predecessor?.subjectKey)
  return {
    factId: factId as TavernFactEntry['factId'],
    target: data.personId === undefined && predecessor?.personId === undefined ? 'world' : 'person',
    ...(data.personId === undefined
      ? predecessor?.personId === undefined ? {} : { personId: predecessor.personId }
      : { personId: data.personId as TavernPersonId }),
    text: data.text,
    ...(data.label !== undefined ? { label: data.label } : predecessor?.label === undefined ? {} : { label: predecessor.label }),
    branch: data.branch,
    authority: data.authority ?? 'gm',
    kind: data.kind ?? 'soft',
    ...(subjectKey === undefined ? {} : { subjectKey }),
    ...(data.extractionId === undefined
      ? predecessor?.extractionId === undefined ? {} : { extractionId: predecessor.extractionId }
      : { extractionId: data.extractionId }),
    ...(data.explicit === undefined
      ? predecessor?.explicit === undefined ? {} : { explicit: predecessor.explicit }
      : { explicit: data.explicit }),
    ...(data.replacesFactId === undefined ? {} : { replacesFactId: data.replacesFactId }),
    source: projectFactSource(data, predecessor),
    ...(data.sourceAssetId !== undefined
      ? { sourceAssetId: data.sourceAssetId }
      : predecessor?.sourceAssetId === undefined ? {} : { sourceAssetId: predecessor.sourceAssetId }),
    ...(data.sourceEntryId !== undefined
      ? { sourceEntryId: data.sourceEntryId }
      : predecessor?.sourceEntryId === undefined ? {} : { sourceEntryId: predecessor.sourceEntryId }),
    eventSeq: record.seq,
    ...(data.assistantSeq !== undefined
      ? { assistantSeq: data.assistantSeq }
      : predecessor?.assistantSeq === undefined ? {} : { assistantSeq: predecessor.assistantSeq }),
    ...(data.turn !== undefined ? { turn: data.turn } : predecessor?.turn === undefined ? {} : { turn: predecessor.turn }),
    conflicts: [],
  }
}

function projectFactSource(
  data: TavernFactEvent,
  predecessor: TavernFactEntry | FactState | undefined,
): import('./types.ts').TavernFactSource {
  if (data.authority === 'user') return { kind: 'user' }
  const sourceAssetId = data.sourceAssetId ?? predecessor?.sourceAssetId
  if (sourceAssetId !== undefined) {
    const sourceEntryId = data.sourceEntryId ?? predecessor?.sourceEntryId
    return sourceEntryId === undefined
      ? { kind: 'asset', assetId: sourceAssetId }
      : { kind: 'asset', assetId: sourceAssetId, entryId: sourceEntryId }
  }
  const assistantSeq = data.assistantSeq ?? predecessor?.assistantSeq
  return assistantSeq === undefined ? { kind: 'system' } : { kind: 'assistant', assistantSeq }
}

function findFact(projection: TavernFactProjection, factId: string): TavernFactEntry | undefined {
  for (const facts of Object.values(projection.people)) {
    const found = facts.find(fact => fact.factId === factId)
    if (found !== undefined) return found
  }
  return projection.world.find(fact => fact.factId === factId)
}

/**
 * Infer whether a fact label describes a hard or soft fact.
 * @param label - Optional fact label to classify.
 * @returns `hard` when the label contains a known hard-fact term; otherwise `soft`.
 */
export function inferFactKind(label: string | undefined): TavernFactKind {
  const normalized = label?.trim().toLocaleLowerCase() ?? ''
  return HARD_FACT_LABELS.some(term => normalized.includes(term))
    ? 'hard'
    : 'soft'
}

function asOperation(value: unknown): TavernFactOperationCandidate | undefined {
  if (!isRecord(value) || typeof value['op'] !== 'string') return undefined
  const unknown = Object.keys(value).filter(key => !['op', 'factId', 'replacesFactId', 'text', 'label', 'kind', 'subjectKey', 'extractionId', 'explicit'].includes(key))
  if (unknown.length > 0) return undefined
  return {
    op: value['op'],
    ...(typeof value['factId'] === 'string' ? { factId: value['factId'] } : {}),
    ...(typeof value['replacesFactId'] === 'string' ? { replacesFactId: value['replacesFactId'] } : {}),
    ...(typeof value['text'] === 'string' ? { text: value['text'] } : {}),
    ...(typeof value['label'] === 'string' ? { label: value['label'] } : {}),
    ...(typeof value['kind'] === 'string' ? { kind: value['kind'] } : {}),
    ...(typeof value['subjectKey'] === 'string' ? { subjectKey: value['subjectKey'] } : {}),
    ...(typeof value['extractionId'] === 'string' ? { extractionId: value['extractionId'] } : {}),
    ...(typeof value['explicit'] === 'boolean' ? { explicit: value['explicit'] } : {}),
  }
}

function isFactOperation(value: string): value is 'add' | 'replace' | 'remove' {
  return value === 'add' || value === 'replace' || value === 'remove'
}
