/** Branded identifiers owned by the Tavern memory package. */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifier of one structured extraction batch. */
export type MemoryExtractionId = Branded<'TavernMemoryExtractionId'>

/** Identifier of one extraction source span. */
export type MemoryExtractionSpanId = Branded<'TavernMemoryExtractionSpanId'>

/**
 * Brand a string as an extraction batch identifier.
 * @param value - Stable extraction identifier.
 * @returns The branded identifier.
 */
export function MemoryExtractionId(value: string): MemoryExtractionId {
  return value as MemoryExtractionId
}

/**
 * Brand a string as an extraction span identifier.
 * @param value - Stable span identifier.
 * @returns The branded identifier.
 */
export function MemoryExtractionSpanId(value: string): MemoryExtractionSpanId {
  return value as MemoryExtractionSpanId
}
