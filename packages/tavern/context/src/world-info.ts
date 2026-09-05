/** Deterministic whole-word matching for already normalized World Info entries. */

import type {
  NormalizedWorldInfoEntry,
  WorldInfoActivationCandidate,
  WorldInfoMatchInput,
} from './types.ts'
import { compareSourceProvenance, compareStrings } from './ordering.ts'

function normalized(value: string): string {
  return value.normalize('NFKC').toLowerCase()
}

function isWordCharacter(value: string | undefined): boolean {
  return value !== undefined && /^[\p{L}\p{N}_]$/u.test(value)
}

function wholeWordMatch(text: string, key: string): boolean {
  if (key === '') return false
  let start = text.indexOf(key)
  while (start >= 0) {
    const end = start + key.length
    if (!isWordCharacter(text[start - 1]) && !isWordCharacter(text[end])) return true
    start = text.indexOf(key, start + 1)
  }
  return false
}

function matchingKeys(
  text: string,
  keys: readonly string[],
  options: Pick<NormalizedWorldInfoEntry, 'useRegex' | 'matchWholeWords' | 'caseSensitive'>,
  entryId: string,
): readonly string[] {
  const matches = new Map<string, string>()
  for (const key of keys) {
    const normalizedKey = options.caseSensitive === true ? key : normalized(key)
    const matched = normalizedKey !== '' && (options.useRegex === true
      ? matchesRegex(normalizedKey, text, options.caseSensitive === true, entryId)
      : options.matchWholeWords === false
        ? (options.caseSensitive === true ? text : normalized(text)).includes(normalizedKey)
        : wholeWordMatch(options.caseSensitive === true ? text : normalized(text), normalizedKey))
    if (matched && !matches.has(normalizedKey)) {
      matches.set(normalizedKey, key)
    }
  }
  return [...matches.entries()]
    .sort((left, right) => compareStrings(left[0], right[0]) || compareStrings(left[1], right[1]))
    .map(entry => entry[1])
}

function matchesRegex(pattern: string, text: string, caseSensitive: boolean, entryId: string): boolean {
  try {
    return new RegExp(pattern, caseSensitive ? 'u' : 'iu').test(text)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new SyntaxError(`Invalid regular expression in World Info entry ${entryId}: ${message}`)
  }
}

function passesProbability(
  entry: NormalizedWorldInfoEntry,
  probabilityRoll: number | undefined,
): boolean {
  if (entry.useProbability !== true || entry.probability === undefined || entry.probability >= 100) return true
  if (entry.probability <= 0) return false
  if (probabilityRoll === undefined) {
    throw new TypeError(`World Info entry ${entry.source.provenance.id} requires a probability roll.`)
  }
  if (!Number.isFinite(probabilityRoll) || probabilityRoll < 0 || probabilityRoll >= 100) {
    throw new RangeError('World Info probability rolls must be finite and in the range [0, 100).')
  }
  return probabilityRoll < entry.probability
}

function matchKindRank(kind: 'primary' | 'secondary'): number {
  return kind === 'primary' ? 0 : 1
}

function compareCandidates<T>(
  left: WorldInfoActivationCandidate<T>,
  right: WorldInfoActivationCandidate<T>,
): number {
  const kindOrder = matchKindRank(left.matchKind) - matchKindRank(right.matchKind)
  if (kindOrder !== 0) return kindOrder
  const countOrder = right.matchCount - left.matchCount
  if (countOrder !== 0) return countOrder
  const priorityOrder = right.source.priority - left.source.priority
  if (priorityOrder !== 0) return priorityOrder
  const keyOrder = compareStrings(left.source.key, right.source.key)
  if (keyOrder !== 0) return keyOrder
  return compareSourceProvenance(left.source, right.source)
}

/**
 * Match normalized World Info entries against a text window.
 * Matching defaults to case-insensitive, NFKC-normalized, and whole-word based.
 * Entry flags can opt into substring, regex, case-sensitive, constant, and
 * selective matching. Primary keys sort before secondary keys, followed by
 * match count, priority, and key.
 * @param input - text and normalized entries supplied by an outer parser.
 * @returns deterministically ordered activation candidates.
 */
export function matchWorldInfo<T>(
  input: WorldInfoMatchInput<T>,
): readonly WorldInfoActivationCandidate<T>[] {
  const text = input.text
  const candidates: WorldInfoActivationCandidate<T>[] = []
  for (const entry of input.entries) {
    if (entry.constant === true) {
      candidates.push({ entry, source: entry.source, matchKind: 'primary', matchedKeys: [], matchCount: 0 })
      continue
    }
    const options = {
      useRegex: entry.useRegex === true,
      matchWholeWords: entry.matchWholeWords !== false,
      caseSensitive: entry.caseSensitive === true,
    }
    const primary = matchingKeys(text, entry.keys, options, entry.source.provenance.id)
    const secondary = matchingKeys(text, entry.secondaryKeys ?? [], options, entry.source.provenance.id)
    if (entry.selective === true && entry.secondaryKeys !== undefined && entry.secondaryKeys.length > 0
      && (primary.length === 0 || secondary.length === 0)) continue
    const matchedKeys = [...primary, ...secondary]
    if (matchedKeys.length === 0 || !passesProbability(entry, input.probabilityRoll?.(entry))) continue
    candidates.push({
      entry,
      source: entry.source,
      matchKind: primary.length > 0 ? 'primary' : 'secondary',
      matchedKeys,
      matchCount: matchedKeys.length,
    })
  }
  return candidates.sort(compareCandidates)
}
