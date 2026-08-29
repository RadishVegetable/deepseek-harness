/**
 * Pure canonical story-state records and branch-aware projections for Tavern.
 * The module owns no Cordis service, persistence handle, clock, or other side
 * effect; callers append the returned records to their authoritative log.
 * @module @deepseek-ai/dsh-tavern-state
 */

import type {
  CompactPublicStoryState,
  JsonObject,
  JsonValue,
  SourceEventId,
  StoryBranchId,
  StoryCultivation,
  StoryEntityId,
  StoryHealth,
  StoryInventoryItem,
  StoryLocation,
  StoryOath,
  StoryRelationship,
  StoryState,
  StoryStateAuthorityKind,
  StoryStateChange,
  StoryStateChangeRecord,
  StoryStateProjection,
  StoryStateProjectionIssue,
  StoryStateProjectionIssueCode,
  StoryStateProjectionOptions,
  StoryTime,
} from './types.ts'

export type * from './types.ts'
export {
  createSwipeState,
  projectSwipeState,
  swipeCandidateId,
  swipeGroupId,
} from './swipe.ts'

/**
 * Brand a non-empty source event id for a state record.
 * @param value - source event id to validate and brand.
 * @returns the branded source event id.
 */
export function sourceEventId(value: string): SourceEventId {
  assertIdentifier(value, 'sourceEventId')
  return value as SourceEventId
}

/**
 * Brand a non-empty branch id for a story projection.
 * @param value - branch id to validate and brand.
 * @returns the branded branch id.
 */
export function storyBranchId(value: string): StoryBranchId {
  assertIdentifier(value, 'branchId')
  return value as StoryBranchId
}

/**
 * Brand a non-empty story entity id.
 * @param value - entity id to validate and brand.
 * @returns the branded entity id.
 */
export function storyEntityId(value: string): StoryEntityId {
  assertIdentifier(value, 'entityId')
  return value as StoryEntityId
}

/**
 * Create an empty canonical state for one branch.
 * @param branchId - branch that owns the new state.
 * @returns an empty version-1 story state.
 */
export function createStoryState(branchId: StoryBranchId): StoryState {
  assertIdentifier(branchId, 'branchId')
  return {
    version: 1,
    branchId,
    location: null,
    time: null,
    inventory: [],
    health: [],
    relationships: [],
    cultivation: [],
    activeOaths: [],
    extensions: {},
  }
}

/**
 * Validate a JSON value without normalizing or mutating it.
 * @param value - value to inspect.
 * @returns whether the value is an accepted JSON value.
 */
export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(item => isJsonValue(item))
  if (!isPlainObject(value)) return false
  return Object.values(value).every(item => isJsonValue(item))
}

/**
 * Validate a JSON object used as lossless extension data.
 * @param value - value to inspect.
 * @returns whether the value is an accepted JSON object.
 */
export function isJsonObject(value: unknown): value is JsonObject {
  return isPlainObject(value) && Object.values(value).every(item => isJsonValue(item))
}

/**
 * Project append-only records into the selected branch's current state.
 * Records from the selected branch and its declared ancestors are accepted;
 * all other records are returned as rejected with `stale-branch`. Invalid
 * records never change the returned state.
 * @param records - append-order state records to inspect.
 * @param options - selected branch and optional root-to-selected lineage.
 * @returns the state, accepted records, rejected records, and diagnostics.
 */
export function projectStoryState(
  records: readonly StoryStateChangeRecord[],
  options: StoryStateProjectionOptions,
): StoryStateProjection {
  const issues: StoryStateProjectionIssue[] = []
  const rejectedRecords: StoryStateChangeRecord[] = []
  const appliedRecords: StoryStateChangeRecord[] = []
  const currentBySlot = new Map<string, number>()
  const seenSourceEvents = new Set<string>()
  const branchLineage = options.branchLineage === undefined
    ? [options.branchId]
    : [...options.branchLineage]

  if (!isBranchSelectionValid(options.branchId, branchLineage)) {
    return {
      branchId: options.branchId,
      state: createStoryState(options.branchId),
      appliedRecords,
      rejectedRecords: [...records],
      issues: [{
        code: 'invalid-branch-selection',
        message: 'branchLineage must contain each branch id once and end at branchId',
      }],
    }
  }

  let state = createStoryState(options.branchId)
  let lastSequence = 0
  for (const record of records) {
    const issue = validateRecordForProjection(record, branchLineage, seenSourceEvents, lastSequence)
    if (issue !== undefined) {
      rejectedRecords.push(record)
      issues.push(issue)
      continue
    }

    const slot = stateChangeSlot(record.change)
    const previousIndex = currentBySlot.get(slot)
    const previous = previousIndex === undefined ? undefined : appliedRecords[previousIndex]
    if (previous !== undefined && authorityRank(record.authority.kind) < authorityRank(previous.authority.kind)) {
      rejectedRecords.push(record)
      issues.push(issueFor(record, 'insufficient-authority', `authority ${record.authority.kind} cannot replace ${previous.authority.kind}`))
      continue
    }

    if (previousIndex !== undefined && previous !== undefined) {
      appliedRecords[previousIndex] = invalidateRecord(previous, record.sourceEventId)
    }
    state = applyChange(state, record.change)
    currentBySlot.set(slot, appliedRecords.length)
    appliedRecords.push(record)
    seenSourceEvents.add(record.sourceEventId)
    lastSequence = record.sequence
  }

  return { branchId: options.branchId, state, appliedRecords, rejectedRecords, issues }
}

/**
 * Return a compact public projection suitable for model context assembly.
 * @param state - canonical state to project.
 * @returns a compact public state without extension or verbose description fields.
 */
export function compactPublicState(state: StoryState): CompactPublicStoryState {
  return {
    location: state.location === null ? null : {
      id: state.location.id,
      name: state.location.name,
    },
    time: state.time === null ? null : compactTime(state.time),
    inventory: state.inventory.map(item => compactInventory(item)),
    health: state.health.map(value => compactHealth(value)),
    relationships: state.relationships.map(value => compactRelationship(value)),
    cultivation: state.cultivation.map(value => compactCultivation(value)),
    activeOaths: state.activeOaths.map(value => compactOath(value)),
  }
}

/**
 * Render compact public state as stable prompt text with no extension data.
 * @param state - compact state to serialize.
 * @returns JSON text for the compact public state.
 */
export function renderCompactPublicState(state: CompactPublicStoryState): string {
  return JSON.stringify(state)
}

function assertIdentifier(value: string, name: string): void {
  if (value.trim() === '') throw new Error(`${name} must be a non-empty string`)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Reflect.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isBranchSelectionValid(branchId: StoryBranchId, lineage: readonly StoryBranchId[]): boolean {
  if (lineage.length === 0 || lineage.at(-1) !== branchId) return false
  return new Set(lineage).size === lineage.length
}

function validateRecordForProjection(
  record: StoryStateChangeRecord,
  branchLineage: readonly StoryBranchId[],
  seenSourceEvents: ReadonlySet<string>,
  lastSequence: number,
): StoryStateProjectionIssue | undefined {
  if (!branchLineage.includes(record.branchId)) return issueFor(record, 'stale-branch', 'record belongs to a branch outside the selected lineage')
  if (seenSourceEvents.has(record.sourceEventId)) return issueFor(record, 'duplicate-source-event', 'sourceEventId has already been accepted')
  if (!Number.isSafeInteger(record.sequence) || record.sequence <= lastSequence) {
    return issueFor(record, 'invalid-sequence', 'record sequence must be a positive integer greater than the previous accepted sequence')
  }
  if (record.validity.status !== 'valid') return issueFor(record, 'invalid-validity', 'invalid records cannot be projected as current state')
  if (!isAuthority(record.authority) || !isJsonObject(record.extensions)) return issueFor(record, 'invalid-record', 'record metadata is not canonical JSON')
  if (record.authority.kind === 'model-candidate') return issueFor(record, 'insufficient-authority', 'model candidates must be promoted before changing canonical state')
  const issue = validateChange(record.change)
  return issue === undefined ? undefined : issueFor(record, 'invalid-update', issue)
}

function validateChange(change: StoryStateChange): string | undefined {
  if (!isJsonObject(change.extensions)) return 'change extensions must be a JSON object'
  switch (change.kind) {
    case 'location.set': return isLocation(change.location) ? undefined : 'location value is invalid'
    case 'location.clear': return undefined
    case 'time.set': return isTime(change.time) ? undefined : 'time value is invalid'
    case 'time.clear': return undefined
    case 'inventory.upsert': return isInventoryItem(change.item) ? undefined : 'inventory item is invalid'
    case 'inventory.remove': return identifierIssue(change.itemId, 'itemId')
    case 'health.upsert': return isHealth(change.health) ? undefined : 'health value is invalid'
    case 'health.remove': return identifierIssue(change.subjectId, 'subjectId')
    case 'relationship.upsert': return isRelationship(change.relationship) ? undefined : 'relationship value is invalid'
    case 'relationship.remove': return identifierIssue(change.subjectId, 'subjectId') ?? identifierIssue(change.targetId, 'targetId')
    case 'cultivation.upsert': return isCultivation(change.cultivation) ? undefined : 'cultivation value is invalid'
    case 'cultivation.remove': return identifierIssue(change.subjectId, 'subjectId')
    case 'oath.upsert': return isOath(change.oath) ? undefined : 'oath value is invalid'
    case 'oath.remove': return identifierIssue(change.oathId, 'oathId')
    case 'extension.set': return isExtensionKey(change.namespace) && isExtensionKey(change.key) && isJsonValue(change.value)
      ? undefined
      : 'extension namespace, key, or value is invalid'
    case 'extension.remove': return isExtensionKey(change.namespace) && isExtensionKey(change.key)
      ? undefined
      : 'extension namespace or key is invalid'
  }
}

function identifierIssue(value: string, name: string): string | undefined {
  return value.trim() === '' ? `${name} must be a non-empty string` : undefined
}

function isExtensionKey(value: string): boolean {
  return value.trim() !== ''
}

function isAuthority(value: StoryStateChangeRecord['authority']): boolean {
  return isAuthorityKind(value.kind) && (value.actorId === undefined || value.actorId.trim() !== '') && isJsonObject(value.extensions)
}

function isAuthorityKind(value: string): value is StoryStateAuthorityKind {
  return value === 'user' || value === 'gm' || value === 'authored-asset' || value === 'observed' || value === 'model-candidate'
}

function authorityRank(value: StoryStateAuthorityKind): number {
  switch (value) {
    case 'model-candidate': return 0
    case 'observed': return 1
    case 'authored-asset': return 2
    case 'user': return 3
    case 'gm': return 4
  }
}

function isLocation(value: StoryLocation): boolean {
  return value.id.trim() !== '' && value.name.trim() !== '' && isJsonObject(value.extensions)
}

function isTime(value: StoryTime): boolean {
  return value.value.trim() !== '' && isJsonObject(value.extensions)
}

function isInventoryItem(value: StoryInventoryItem): boolean {
  return value.id.trim() !== '' && value.name.trim() !== '' && Number.isFinite(value.quantity) && value.quantity > 0 && isJsonObject(value.extensions)
}

function isHealth(value: StoryHealth): boolean {
  return value.subjectId.trim() !== '' && value.status.trim() !== '' && (value.severity === undefined || Number.isFinite(value.severity)) && isJsonObject(value.extensions)
}

function isRelationship(value: StoryRelationship): boolean {
  return value.subjectId.trim() !== '' && value.targetId.trim() !== '' && (value.affinity === undefined || Number.isFinite(value.affinity)) && (value.trust === undefined || Number.isFinite(value.trust)) && isJsonObject(value.extensions)
}

function isCultivation(value: StoryCultivation): boolean {
  return value.subjectId.trim() !== '' && value.realm.trim() !== '' && (value.level === undefined || Number.isSafeInteger(value.level)) && (value.progress === undefined || Number.isFinite(value.progress)) && isJsonObject(value.extensions)
}

function isOath(value: StoryOath): boolean {
  return value.id.trim() !== '' && value.text.trim() !== '' && isJsonObject(value.extensions)
}

function stateChangeSlot(change: StoryStateChange): string {
  switch (change.kind) {
    case 'location.set': case 'location.clear': return 'location'
    case 'time.set': case 'time.clear': return 'time'
    case 'inventory.upsert': return `inventory:${change.item.id}`
    case 'inventory.remove': return `inventory:${change.itemId}`
    case 'health.upsert': return `health:${change.health.subjectId}`
    case 'health.remove': return `health:${change.subjectId}`
    case 'relationship.upsert': return `relationship:${change.relationship.subjectId}:${change.relationship.targetId}`
    case 'relationship.remove': return `relationship:${change.subjectId}:${change.targetId}`
    case 'cultivation.upsert': return `cultivation:${change.cultivation.subjectId}`
    case 'cultivation.remove': return `cultivation:${change.subjectId}`
    case 'oath.upsert': return `oath:${change.oath.id}`
    case 'oath.remove': return `oath:${change.oathId}`
    case 'extension.set': case 'extension.remove': return `extension:${change.namespace}:${change.key}`
  }
}

function applyChange(state: StoryState, change: StoryStateChange): StoryState {
  switch (change.kind) {
    case 'location.set': return { ...state, location: cloneLocation(change.location) }
    case 'location.clear': return { ...state, location: null }
    case 'time.set': return { ...state, time: cloneTime(change.time) }
    case 'time.clear': return { ...state, time: null }
    case 'inventory.upsert': return { ...state, inventory: upsertById(state.inventory, change.item, item => item.id) }
    case 'inventory.remove': return { ...state, inventory: state.inventory.filter(item => item.id !== change.itemId) }
    case 'health.upsert': return { ...state, health: upsertById(state.health, change.health, value => value.subjectId) }
    case 'health.remove': return { ...state, health: state.health.filter(value => value.subjectId !== change.subjectId) }
    case 'relationship.upsert': return { ...state, relationships: upsertById(state.relationships, change.relationship, value => `${value.subjectId}:${value.targetId}`) }
    case 'relationship.remove': return { ...state, relationships: state.relationships.filter(value => value.subjectId !== change.subjectId || value.targetId !== change.targetId) }
    case 'cultivation.upsert': return { ...state, cultivation: upsertById(state.cultivation, change.cultivation, value => value.subjectId) }
    case 'cultivation.remove': return { ...state, cultivation: state.cultivation.filter(value => value.subjectId !== change.subjectId) }
    case 'oath.upsert': return { ...state, activeOaths: upsertOath(state.activeOaths, change.oath) }
    case 'oath.remove': return { ...state, activeOaths: state.activeOaths.filter(value => value.id !== change.oathId) }
    case 'extension.set': return setExtension(state, change.namespace, change.key, cloneJsonValue(change.value))
    case 'extension.remove': return removeExtension(state, change.namespace, change.key)
  }
}

function upsertById<T>(values: readonly T[], value: T, getId: (item: T) => string): readonly T[] {
  const index = values.findIndex(item => getId(item) === getId(value))
  const copy = values.slice()
  if (index === -1) copy.push(value)
  else copy[index] = value
  return copy
}

function upsertOath(values: readonly StoryOath[], value: StoryOath): readonly StoryOath[] {
  return upsertById(values, value, oath => oath.id)
}

function setExtension(state: StoryState, namespace: string, key: string, value: JsonValue): StoryState {
  const current = isJsonObject(state.extensions[namespace]) ? state.extensions[namespace] : {}
  return { ...state, extensions: { ...state.extensions, [namespace]: { ...current, [key]: value } } }
}

function removeExtension(state: StoryState, namespace: string, key: string): StoryState {
  const current = state.extensions[namespace]
  if (!isJsonObject(current)) return state
  const next: Record<string, JsonValue> = {}
  for (const [currentKey, value] of Object.entries(current)) {
    if (currentKey !== key) next[currentKey] = value
  }
  return { ...state, extensions: { ...state.extensions, [namespace]: next } }
}

function issueFor(record: StoryStateChangeRecord, code: StoryStateProjectionIssueCode, message: string): StoryStateProjectionIssue {
  return { code, message, sourceEventId: record.sourceEventId, branchId: record.branchId }
}

function invalidateRecord(record: StoryStateChangeRecord, supersededBy: SourceEventId): StoryStateChangeRecord {
  return {
    ...record,
    validity: { status: 'invalid', reason: 'superseded by a later accepted update', supersededBy, extensions: {} },
  }
}

function cloneJsonValue(value: JsonValue): JsonValue {
  if (isJsonArray(value)) return value.map(item => cloneJsonValue(item))
  if (isJsonObject(value)) {
    const result: Record<string, JsonValue> = {}
    for (const [key, child] of Object.entries(value)) result[key] = cloneJsonValue(child)
    return result
  }
  return value
}

function isJsonArray(value: unknown): value is readonly JsonValue[] {
  return Array.isArray(value) && value.every(item => isJsonValue(item))
}

function cloneLocation(value: StoryLocation): StoryLocation {
  return { ...value, extensions: cloneJsonObject(value.extensions) }
}

function cloneTime(value: StoryTime): StoryTime {
  return { ...value, extensions: cloneJsonObject(value.extensions) }
}

function cloneJsonObject(value: JsonObject): JsonObject {
  return cloneJsonValue(value) as JsonObject
}

function compactTime(value: StoryTime): CompactPublicStoryState['time'] {
  return value.calendar === undefined ? { value: value.value } : { value: value.value, calendar: value.calendar }
}

function compactInventory(value: StoryInventoryItem): CompactPublicStoryState['inventory'][number] {
  return value.unit === undefined
    ? { id: value.id, name: value.name, quantity: value.quantity }
    : { id: value.id, name: value.name, quantity: value.quantity, unit: value.unit }
}

function compactHealth(value: StoryHealth): CompactPublicStoryState['health'][number] {
  return value.severity === undefined
    ? { subjectId: value.subjectId, status: value.status }
    : { subjectId: value.subjectId, status: value.status, severity: value.severity }
}

function compactRelationship(value: StoryRelationship): CompactPublicStoryState['relationships'][number] {
  return {
    subjectId: value.subjectId,
    targetId: value.targetId,
    ...(value.phase === undefined ? {} : { phase: value.phase }),
    ...(value.affinity === undefined ? {} : { affinity: value.affinity }),
    ...(value.trust === undefined ? {} : { trust: value.trust }),
  }
}

function compactCultivation(value: StoryCultivation): CompactPublicStoryState['cultivation'][number] {
  return {
    subjectId: value.subjectId,
    realm: value.realm,
    ...(value.stage === undefined ? {} : { stage: value.stage }),
    ...(value.level === undefined ? {} : { level: value.level }),
    ...(value.progress === undefined ? {} : { progress: value.progress }),
  }
}

function compactOath(value: StoryOath): CompactPublicStoryState['activeOaths'][number] {
  return {
    id: value.id,
    text: value.text,
    ...(value.subjectId === undefined ? {} : { subjectId: value.subjectId }),
    status: value.status,
  }
}
