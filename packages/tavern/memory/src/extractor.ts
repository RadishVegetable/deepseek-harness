/** Idempotent extraction writer and cursor helpers for Journey memory. */

import type {
  MemoryExtractionBatch,
  MemoryExtractionId,
  MemoryFactEntry,
  MemoryFactEvent,
  MemoryIngestInput,
  MemoryIngestResult,
  MemoryProjectionOptions,
} from './types.ts'
import { createSubjectKeyAliasResolver } from './keys.ts'
import { projectMemoryFacts, flattenMemoryProjection } from './fold.ts'

/** A queued extraction operation. Operations for one session run in order. */
export type MemoryExtractionTask<T> = () => Promise<T>

/**
 * Serialize background extraction per session while allowing independent
 * Journeys to proceed concurrently.
 */
export class MemoryExtractionScheduler {
  private readonly pending = new Map<string, Promise<void>>()

  /**
   * Enqueue one extraction operation for a session.
   * @param sessionId - Session whose cursor and event log the task may update.
   * @param task - Operation that performs one idempotent extraction span.
   * @returns The task result after all earlier work for this session settles.
   */
  enqueue<T>(sessionId: string, task: MemoryExtractionTask<T>): Promise<T> {
    const key = sessionId.normalize('NFKC').trim()
    if (key.length === 0) return Promise.reject(new Error('sessionId must not be empty'))
    const previous = this.pending.get(key) ?? Promise.resolve()
    const result = previous.then(task)
    const settled = result.then(() => undefined, () => undefined)
    this.pending.set(key, settled)
    void settled.then(() => {
      if (this.pending.get(key) === settled) this.pending.delete(key)
    })
    return result
  }

  /**
   * Return whether one session currently has queued or running work.
   * @param sessionId - Session to inspect.
   * @returns Whether work is queued or running for the session.
   */
  hasPending(sessionId: string): boolean {
    return this.pending.has(sessionId.normalize('NFKC').trim())
  }
}

/**
 * Create the stable extraction id for one session span.
 * @param sessionId - Session owning the source span.
 * @param span - Inclusive source sequence range.
 * @returns The branded extraction identifier.
 */
export function createMemoryExtractionId(
  sessionId: string,
  span: { readonly start: number; readonly end: number },
): MemoryExtractionId {
  validateSpan(span)
  const safeSessionId = sessionId.normalize('NFKC').trim()
  if (safeSessionId.length === 0) throw new Error('sessionId must not be empty')
  return `memory:${safeSessionId}:${span.start}-${span.end}` as MemoryExtractionId
}

/**
 * Return the durable idempotency key for a session span.
 * @param sessionId - Session owning the source span.
 * @param span - Inclusive source sequence range.
 * @returns The stable idempotency key.
 */
export function memoryExtractionIdempotencyKey(sessionId: string, span: { readonly start: number; readonly end: number }): string {
  return `extract:${createMemoryExtractionId(sessionId, span)}`
}

/**
 * Append a parsed extraction batch without mutating existing records.
 * Duplicate spans return the original record list and do not advance beyond
 * their existing cursor. Invalid individual atoms are reported and skipped;
 * callers should discard an entirely invalid model response before this step.
 * @param input - Session span, parsed atoms, roster, and existing log records.
 * @returns New events, projected records, and the monotonic cursor.
 */
export function ingestMemoryExtraction(input: MemoryIngestInput): MemoryIngestResult {
  validateSpan(input.span)
  const extractionId = input.extractionId.trim()
  if (extractionId.length === 0) throw new Error('extractionId must not be empty')
  const idempotencyKey = memoryExtractionIdempotencyKey(input.sessionId, input.span)
  const resolveSubjectKey = createSubjectKeyAliasResolver(input.subjectKeyAliases ?? [])
  const projectionOptions: MemoryProjectionOptions = input.subjectKeyAliases === undefined
    ? {}
    : { subjectKeyAliases: input.subjectKeyAliases }
  const previousCursor = input.cursor ?? -1
  const duplicate = input.existing.some(record =>
    record.data.extractionId === extractionId || record.data.idempotencyKey === idempotencyKey,
  )
  if (duplicate || input.span.end <= previousCursor) {
    return {
      events: [],
      records: structuredClone(input.existing),
      projection: projectMemoryFacts(input.existing, projectionOptions),
      cursor: previousCursor,
      skipped: true,
      rejected: [],
    }
  }

  const knownPeople = new Set(input.roster.map(entry => entry.personId))
  for (const update of input.rosterUpdates ?? []) {
    if (/^person:[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(`person:${update.slug}`)) knownPeople.add(`person:${update.slug}`)
  }
  const records = [...input.existing]
  const events: MemoryFactEvent[] = []
  const rejected: string[] = []
  let nextSeq = Math.max(input.nextSeq ?? 0, Math.max(-1, ...records.map(record => record.seq)) + 1)
  let projection = projectMemoryFacts(records, projectionOptions)
  const emit = (data: MemoryFactEvent): void => {
    const record = { seq: nextSeq, data }
    nextSeq += 1
    events.push(data)
    records.push(record)
    projection = projectMemoryFacts(records, projectionOptions)
  }

  for (const [index, atom] of input.atoms.entries()) {
    const personId = atom.personId
    if (atom.target === 'person' && (personId === undefined || !knownPeople.has(personId))) {
      rejected.push(`atom ${index + 1}: unknown person '${personId ?? ''}'`)
      continue
    }
    const subjectKey = compatibleSubjectKey(atom.subjectKey, atom.target, personId, resolveSubjectKey)
    const activeFacts = flattenMemoryProjection(projection)
    const predecessor = findPredecessor(activeFacts, atom.factId, subjectKey, atom.target, personId)
    if (atom.op === 'add') {
      const text = atom.text?.trim()
      if (text === undefined || text.length === 0) {
        rejected.push(`atom ${index + 1}: add requires non-empty text`)
        continue
      }
      if (predecessor !== undefined && subjectKey !== undefined && predecessor.text === text) continue
      emit({
        branch: input.branch,
        target: atom.target,
        ...(personId === undefined ? {} : { personId }),
        operation: 'add',
        factId: `fact:extraction:${extractionId}:${index + 1}`,
        text,
        ...(subjectKey === undefined ? {} : { subjectKey }),
        authority: 'observed',
        ...(atom.label === undefined ? {} : { label: atom.label.trim() }),
        kind: atom.kind ?? 'soft',
        extractionId,
        explicit: atom.explicit,
        turn: atom.anchorTurn,
        idempotencyKey,
        accepted: true,
      })
      continue
    }
    if (predecessor === undefined) {
      rejected.push(`atom ${index + 1}: ${atom.op} requires an active matching fact`)
      continue
    }
    if (atom.op === 'remove') {
      emit({
        branch: input.branch,
        target: atom.target,
        ...(personId === undefined ? {} : { personId }),
        operation: 'remove',
        factId: String(predecessor.factId),
        ...(subjectKey === undefined ? {} : { subjectKey }),
        authority: 'observed',
        kind: predecessor.kind,
        ...(predecessor.label === undefined ? {} : { label: predecessor.label }),
        extractionId,
        explicit: atom.explicit,
        turn: atom.anchorTurn,
        idempotencyKey,
        accepted: true,
      })
      continue
    }
    const text = atom.text?.trim()
    if (text === undefined || text.length === 0) {
      rejected.push(`atom ${index + 1}: replace requires non-empty text`)
      continue
    }
    if (predecessor.text === text && predecessor.explicit === atom.explicit) continue
    emit({
      branch: input.branch,
      target: atom.target,
      ...(personId === undefined ? {} : { personId }),
      operation: 'replace',
      factId: `fact:extraction:${extractionId}:${index + 1}`,
      replacesFactId: String(predecessor.factId),
      text,
      ...(subjectKey === undefined ? {} : { subjectKey }),
      authority: 'observed',
      ...(atom.label === undefined ? predecessor.label === undefined ? {} : { label: predecessor.label } : { label: atom.label.trim() }),
      kind: atom.kind ?? predecessor.kind,
      extractionId,
      explicit: atom.explicit,
      turn: atom.anchorTurn,
      idempotencyKey,
      accepted: true,
    })
  }
  return {
    events,
    records: structuredClone(records),
    projection,
    cursor: Math.max(previousCursor, input.span.end),
    skipped: false,
    rejected,
  }
}

/**
 * Alias for the append-only extraction batch operation.
 * @param input - Session span, roster, atoms, and existing records.
 * @returns The append result and projected memory view.
 */
export function ingestMemoryBatch(input: MemoryIngestInput): MemoryIngestResult {
  return ingestMemoryExtraction(input)
}

/** Stateless facade that makes the extraction writer easy to inject in tests. */
export class MemoryExtractionIngestor {
  /**
   * Append one parsed extraction batch using the supplied log snapshot.
   * @param input - Session span, roster, atoms, and existing records.
   * @returns The append result and projected memory view.
   */
  ingest(input: MemoryIngestInput): MemoryIngestResult {
    return ingestMemoryExtraction(input)
  }
}

/**
 * Validate an extraction batch before the append-only writer is called.
 * @param batch - Parsed extraction batch to validate.
 * @returns Nothing when the batch is valid.
 */
export function validateMemoryExtractionBatch(batch: MemoryExtractionBatch): void {
  if (!Array.isArray(batch.atoms) || !Array.isArray(batch.rosterUpdates)) throw new TypeError('invalid extraction batch')
  for (const atom of batch.atoms) {
    if (!Number.isSafeInteger(atom.anchorTurn) || atom.anchorTurn < 1) throw new TypeError('extraction anchorTurn must be a positive safe integer')
    if (atom.op !== 'remove' && (atom.text === undefined || atom.text.trim().length === 0)) throw new TypeError('extraction text must not be empty')
  }
}

function validateSpan(span: { readonly start: number; readonly end: number }): void {
  if (!Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end) || span.start < 0 || span.end < span.start) {
    throw new RangeError('memory extraction span must be an ordered non-negative integer range')
  }
}

function compatibleSubjectKey(
  value: string | undefined,
  target: 'person' | 'world',
  personId: string | undefined,
  resolveSubjectKey: (value: string | undefined) => string | undefined,
): string | undefined {
  const normalized = resolveSubjectKey(value)
  if (normalized === undefined) return undefined
  const domain = normalized.slice(0, normalized.indexOf('.'))
  if (target === 'world') return domain.startsWith('world:') ? normalized : undefined
  return personId !== undefined && domain === personId ? normalized : undefined
}

function findPredecessor(
  facts: readonly MemoryFactEntry[],
  factId: string | undefined,
  subjectKey: string | undefined,
  target: 'person' | 'world',
  personId: string | undefined,
): MemoryFactEntry | undefined {
  if (factId !== undefined) {
    const exact = facts.find(fact => String(fact.factId) === factId
      && fact.target === target
      && fact.personId === personId
      && (subjectKey === undefined || fact.subjectKey === subjectKey))
    if (exact !== undefined) return exact
  }
  if (subjectKey === undefined) return undefined
  return [...facts].reverse().find(fact => fact.subjectKey === subjectKey
    && fact.target === target
    && fact.personId === personId)
}
