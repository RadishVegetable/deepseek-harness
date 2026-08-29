import type { NormalizedWorldInfoEntry } from './types.ts'

/** Inputs that make probabilistic selection reproducible at the caller seam. */
export interface WorldInfoMatchOptions {
  /** A deterministic value in the half-open range [0, 100) for probability checks. */
  readonly probabilityRoll?: number
}

/**
 * Return whether one enabled World Info entry is eligible for the supplied text.
 * @param entry - The normalized entry to evaluate.
 * @param text - The text scanned for entry keys.
 * @param options - Optional deterministic probability input.
 * @returns Whether the entry is eligible.
 */
export function matchesWorldInfoEntry(
  entry: NormalizedWorldInfoEntry,
  text: string,
  options: WorldInfoMatchOptions = {},
): boolean {
  if (!entry.enabled) return false
  if (!entry.constant) {
    if (!entry.keys.some(key => matchesKey(entry, key, text))) return false
    if (entry.selective && entry.secondaryKeys.length > 0
      && !entry.secondaryKeys.some(key => matchesKey(entry, key, text))) {
      return false
    }
  }
  return passesProbability(entry, options.probabilityRoll)
}

/**
 * Select matching entries in ascending insertion order without applying probability randomly.
 * @param entries - The normalized entries to evaluate.
 * @param text - The text scanned for entry keys.
 * @param options - Optional deterministic probability input.
 * @returns Matching entries ordered by insertion order.
 */
export function selectWorldInfoEntries(
  entries: readonly NormalizedWorldInfoEntry[],
  text: string,
  options: WorldInfoMatchOptions = {},
): readonly NormalizedWorldInfoEntry[] {
  return entries
    .filter(entry => matchesWorldInfoEntry(entry, text, options))
    .toSorted((left, right) => left.insertionOrder - right.insertionOrder)
}

function passesProbability(entry: NormalizedWorldInfoEntry, probabilityRoll: number | undefined): boolean {
  if (!entry.useProbability || entry.probability >= 100) return true
  if (entry.probability <= 0) return false
  if (probabilityRoll === undefined) {
    throw new TypeError(`World Info entry ${entry.id} requires probabilityRoll for probability ${entry.probability}.`)
  }
  if (!Number.isFinite(probabilityRoll) || probabilityRoll < 0 || probabilityRoll >= 100) {
    throw new RangeError('World Info probabilityRoll must be finite and in the range [0, 100).')
  }
  return probabilityRoll < entry.probability
}

function matchesKey(entry: NormalizedWorldInfoEntry, key: string, text: string): boolean {
  if (key.length === 0) return false
  if (entry.useRegex) return matchesRegex(entry, key, text)
  const haystack = entry.caseSensitive ? text : text.toLocaleLowerCase()
  const needle = entry.caseSensitive ? key : key.toLocaleLowerCase()
  if (!entry.matchWholeWords) return haystack.includes(needle)
  const escaped = escapeRegExp(needle)
  return new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, 'u').test(haystack)
}

function matchesRegex(entry: NormalizedWorldInfoEntry, pattern: string, text: string): boolean {
  try {
    const flags = entry.caseSensitive ? 'u' : 'iu'
    return new RegExp(pattern, flags).test(text)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new SyntaxError(`Invalid regular expression in World Info entry ${entry.id}: ${message}`)
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
}
