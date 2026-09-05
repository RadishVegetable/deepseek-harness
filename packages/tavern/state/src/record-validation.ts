/** Shared validation for append-only state and swipe record metadata. */

export interface CommonProjectionRecord<TAuthority> {
  readonly branchId: string
  readonly sourceEventId: string
  readonly sequence: number
  readonly validity: { readonly status: string }
  readonly authority: TAuthority
  readonly extensions: unknown
}

/** Validation failure categories for shared projection record metadata. */
export type CommonProjectionIssueCode =
  | 'invalid-record'
  | 'invalid-sequence'
  | 'duplicate-source-event'
  | 'stale-branch'
  | 'invalid-validity'

/** Validation failure returned for a shared projection record. */
export interface CommonProjectionIssue {
  readonly code: CommonProjectionIssueCode
  readonly message: string
}

/**
 * Validate metadata shared by canonical state and swipe projections.
 * @param record - Candidate record metadata to validate.
 * @param branchLineage - Branch identifiers accepted by the current projection.
 * @param seenSourceEvents - Source event identifiers already accepted in this projection.
 * @param lastSequence - Sequence number of the previous accepted record.
 * @param isAuthority - Predicate used to validate authority values.
 * @param isJsonObject - Predicate used to validate JSON object values.
 * @param invalidValidityMessage - Message returned for a non-valid record status.
 * @returns The first validation issue, or `undefined` when the metadata is valid.
 */
export function validateCommonRecord<TAuthority>(
  record: CommonProjectionRecord<TAuthority>,
  branchLineage: readonly string[],
  seenSourceEvents: ReadonlySet<string>,
  lastSequence: number,
  isAuthority: (value: TAuthority) => boolean,
  isJsonObject: (value: unknown) => boolean,
  invalidValidityMessage: string,
): CommonProjectionIssue | undefined {
  if (!branchLineage.includes(record.branchId)) return {
    code: 'stale-branch',
    message: 'record belongs to a branch outside the selected lineage',
  }
  if (seenSourceEvents.has(record.sourceEventId)) return {
    code: 'duplicate-source-event',
    message: 'sourceEventId has already been accepted',
  }
  if (!Number.isSafeInteger(record.sequence) || record.sequence <= lastSequence) return {
    code: 'invalid-sequence',
    message: 'record sequence must be a positive integer greater than the previous accepted sequence',
  }
  if (record.validity.status !== 'valid') return {
    code: 'invalid-validity',
    message: invalidValidityMessage,
  }
  if (!isAuthority(record.authority) || !isJsonObject(record.extensions)) return {
    code: 'invalid-record',
    message: 'record metadata is not canonical JSON',
  }
  return undefined
}
