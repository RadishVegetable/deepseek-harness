/** Pure durable projection for retained assistant swipe and regenerate candidates. */

import type {
  JsonObject,
  JsonValue,
  SourceEventId,
  StoryBranchId,
  StoryStateAuthority,
  StoryStateAuthorityKind,
  SwipeAssistantCandidate,
  SwipeCandidateId,
  SwipeGroupId,
  SwipeProjection,
  SwipeProjectionIssue,
  SwipeProjectionIssueCode,
  SwipeProjectionOptions,
  SwipeRecord,
  SwipeState,
} from './types.ts'
import { isJsonValue as sharedIsJsonValue, isRecord as sharedIsRecord } from '@deepseek-ai/dsh-tavern-shared'
import { validateCommonRecord } from './record-validation.ts'

/**
 * Brand a non-empty swipe group id.
 * @param value - Group identifier to validate.
 * @returns The branded group identifier.
 */
export function swipeGroupId(value: string): SwipeGroupId {
  assertIdentifier(value, 'groupId')
  return value as SwipeGroupId
}

/**
 * Brand a non-empty swipe candidate id.
 * @param value - Candidate identifier to validate.
 * @returns The branded candidate identifier.
 */
export function swipeCandidateId(value: string): SwipeCandidateId {
  assertIdentifier(value, 'candidateId')
  return value as SwipeCandidateId
}

/**
 * Create an empty retained-candidate state for one branch.
 * @param branchId - Branch identifier owning the state.
 * @returns An empty swipe state for the branch.
 */
export function createSwipeState(branchId: StoryBranchId): SwipeState {
  assertIdentifier(branchId, 'branchId')
  return { version: 1, branchId, groups: [], extensions: {} }
}

/**
 * Rebuild retained assistant candidates and their current selections from an
 * append-only log. Candidate additions never replace an existing candidate;
 * selection records are the only records that change the current pointer.
 * @param records - Durable swipe records in append order.
 * @param options - Selected branch and optional root-to-selected lineage.
 * @returns Rebuilt state and diagnostics for records that were not applied.
 */
export function projectSwipeState(
  records: readonly SwipeRecord[],
  options: SwipeProjectionOptions,
): SwipeProjection {
  const branchLineage = options.branchLineage === undefined
    ? [options.branchId]
    : [...options.branchLineage]
  const rejectedRecords: SwipeRecord[] = []
  const appliedRecords: SwipeRecord[] = []
  const issues: SwipeProjectionIssue[] = []
  const seenSourceEvents = new Set<string>()
  const candidateIds = new Set<string>()
  const currentByGroup = new Map<string, number>()

  if (!isBranchSelectionValid(options.branchId, branchLineage)) {
    return {
      branchId: options.branchId,
      state: createSwipeState(options.branchId),
      appliedRecords,
      rejectedRecords: [...records],
      issues: [{
        code: 'invalid-branch-selection',
        message: 'branchLineage must contain each branch id once and end at branchId',
      }],
    }
  }

  let state = createSwipeState(options.branchId)
  let lastSequence = 0
  for (const record of records) {
    const issue = validateRecord(record, branchLineage, seenSourceEvents, lastSequence)
    if (issue !== undefined) {
      rejectedRecords.push(record)
      issues.push(issue)
      continue
    }

    if (record.kind === 'candidate.add') {
      if (candidateIds.has(record.candidate.candidateId)) {
        rejectedRecords.push(record)
        issues.push(issueFor(record, 'duplicate-candidate', 'candidateId has already been accepted'))
        continue
      }
      state = addCandidate(state, record.groupId, record.candidate)
      candidateIds.add(record.candidate.candidateId)
    } else {
      const group = state.groups.find(value => value.groupId === record.groupId)
      if (group === undefined || !group.candidates.some(candidate => candidate.candidateId === record.candidateId)) {
        rejectedRecords.push(record)
        issues.push(issueFor(record, 'candidate-not-found', 'selection must reference an accepted candidate in its group'))
        continue
      }
      const previousIndex = currentByGroup.get(record.groupId)
      const previous = previousIndex === undefined ? undefined : appliedRecords[previousIndex]
      if (previousIndex !== undefined && previous !== undefined) {
        appliedRecords[previousIndex] = invalidateRecord(previous, record.sourceEventId)
      }
      state = selectCandidate(state, record.groupId, record.candidateId)
      currentByGroup.set(record.groupId, appliedRecords.length)
    }

    appliedRecords.push(record)
    seenSourceEvents.add(record.sourceEventId)
    lastSequence = record.sequence
  }

  return { branchId: options.branchId, state, appliedRecords, rejectedRecords, issues }
}

function addCandidate(
  state: SwipeState,
  groupId: SwipeGroupId,
  candidate: SwipeAssistantCandidate,
): SwipeState {
  const group = state.groups.find(value => value.groupId === groupId)
  const detached = cloneCandidate(candidate)
  if (group === undefined) {
    return {
      ...state,
      groups: [...state.groups, { groupId, candidates: [detached], currentCandidateId: null }],
    }
  }
  return {
    ...state,
    groups: state.groups.map(value => value.groupId === groupId
      ? { ...value, candidates: [...value.candidates, detached] }
      : value),
  }
}

function selectCandidate(
  state: SwipeState,
  groupId: SwipeGroupId,
  candidateId: SwipeCandidateId,
): SwipeState {
  return {
    ...state,
    groups: state.groups.map(group => group.groupId === groupId
      ? { ...group, currentCandidateId: candidateId }
      : group),
  }
}

function validateRecord(
  record: SwipeRecord,
  branchLineage: readonly StoryBranchId[],
  seenSourceEvents: ReadonlySet<string>,
  lastSequence: number,
): SwipeProjectionIssue | undefined {
  const commonIssue = validateCommonRecord(
    record,
    branchLineage,
    seenSourceEvents,
    lastSequence,
    isAuthority,
    isJsonObject,
    'invalid records cannot be projected as current swipe state',
  )
  if (commonIssue !== undefined) return issueFor(record, commonIssue.code, commonIssue.message)
  if (record.kind === 'candidate.select' && record.authority.kind === 'model-candidate') {
    return issueFor(record, 'insufficient-authority', 'model candidates cannot select the current assistant candidate')
  }
  const issue = record.kind === 'candidate.add'
    ? validateCandidate(record.groupId, record.candidate)
    : identifierIssue(record.groupId, 'groupId') ?? identifierIssue(record.candidateId, 'candidateId')
  return issue === undefined ? undefined : issueFor(record, 'invalid-update', issue)
}

function validateCandidate(groupId: SwipeGroupId, candidate: SwipeAssistantCandidate): string | undefined {
  return identifierIssue(groupId, 'groupId')
    ?? identifierIssue(candidate.candidateId, 'candidateId')
    ?? identifierIssue(candidate.assistantEventId, 'assistantEventId')
    ?? (isSwipeOrigin(candidate.origin) ? undefined : 'candidate origin is invalid')
    ?? (sharedIsJsonValue(candidate.content) ? undefined : 'candidate content must be canonical JSON')
    ?? (isJsonObject(candidate.extensions) ? undefined : 'candidate extensions must be a JSON object')
}

function isSwipeOrigin(value: string): value is SwipeAssistantCandidate['origin'] {
  return value === 'initial' || value === 'swipe' || value === 'regenerate'
}

function isAuthority(value: StoryStateAuthority): boolean {
  return isAuthorityKind(value.kind)
    && (value.actorId === undefined || identifierIssue(value.actorId, 'actorId') === undefined)
    && isJsonObject(value.extensions)
}

function isAuthorityKind(value: string): value is StoryStateAuthorityKind {
  return value === 'user' || value === 'gm' || value === 'authored-asset' || value === 'observed' || value === 'model-candidate'
}

function isBranchSelectionValid(branchId: StoryBranchId, lineage: readonly StoryBranchId[]): boolean {
  return lineage.length > 0 && lineage.at(-1) === branchId && new Set(lineage).size === lineage.length
}

function issueFor(record: SwipeRecord, code: SwipeProjectionIssueCode, message: string): SwipeProjectionIssue {
  return { code, message, sourceEventId: record.sourceEventId, branchId: record.branchId }
}

function invalidateRecord(record: SwipeRecord, supersededBy: SourceEventId): SwipeRecord {
  return {
    ...record,
    validity: { status: 'invalid', reason: 'superseded by a later accepted selection', supersededBy, extensions: {} },
  }
}

function identifierIssue(value: string, name: string): string | undefined {
  return value.trim() === '' ? `${name} must be a non-empty string` : undefined
}

function assertIdentifier(value: string, name: string): void {
  if (identifierIssue(value, name) !== undefined) throw new Error(`${name} must be a non-empty string`)
}

function isJsonObject(value: unknown): value is JsonObject {
  return sharedIsRecord(value) && Object.values(value).every(item => sharedIsJsonValue(item))
}

function cloneCandidate(candidate: SwipeAssistantCandidate): SwipeAssistantCandidate {
  return {
    ...candidate,
    content: cloneJsonValue(candidate.content),
    extensions: cloneJsonObject(candidate.extensions),
  }
}

function cloneJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    const items = value as readonly JsonValue[]
    return items.map(item => cloneJsonValue(item))
  }
  if (isJsonObject(value)) return cloneJsonObject(value)
  return value
}

function cloneJsonObject(value: JsonObject): JsonObject {
  const result: Record<string, JsonValue> = {}
  for (const [key, child] of Object.entries(value)) result[key] = cloneJsonValue(child)
  return result
}
