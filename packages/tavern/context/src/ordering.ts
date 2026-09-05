/** Deterministic ordering helpers shared by context and World Info projections. */

import type { ContextSourceRecord } from './types.ts'

/**
 * Compare two strings using the ordering required by context projections.
 * @param left - First string to compare.
 * @param right - Second string to compare.
 * @returns -1 when `left` sorts first, 1 when `right` sorts first, or 0 when equal.
 */
export function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * Compare source provenance after callers have applied their domain-specific priority.
 * @param left - First source record, compared by provenance kind, id, then text.
 * @param right - Second source record, compared by provenance kind, id, then text.
 * @returns -1 when `left` sorts first, 1 when `right` sorts first, or 0 when equal.
 */
export function compareSourceProvenance<T>(
  left: Pick<ContextSourceRecord<T>, 'provenance' | 'text'>,
  right: Pick<ContextSourceRecord<T>, 'provenance' | 'text'>,
): number {
  const provenanceOrder = compareStrings(left.provenance.kind, right.provenance.kind)
  if (provenanceOrder !== 0) return provenanceOrder
  const idOrder = compareStrings(left.provenance.id, right.provenance.id)
  if (idOrder !== 0) return idOrder
  return compareStrings(left.text, right.text)
}
