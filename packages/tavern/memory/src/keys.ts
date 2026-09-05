/** Journey-local structure keys and deterministic vocabulary derivation. */

import type { MemoryFactEntry, MemoryRosterEntry, MemorySubjectKeyAlias } from './types.ts'

/**
 * Return a canonical key spelling, or `undefined` when the key is unusable.
 * @param value - Candidate subject key.
 * @returns The normalized key when it matches the open vocabulary syntax.
 */
export function normalizeSubjectKey(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const normalized = value.normalize('NFKC').trim().replace(/\s+/gu, ' ')
  if (!isSubjectKey(normalized)) return undefined
  return normalized
}

/**
 * Validate the open two-level key format. The first dot separates an entity
 * domain (`person:<slug>` or `world:<slug>`) from a free dimension label.
 * Additional dots are retained in the dimension label for source vocabularies
 * that use labels such as `外观.发色`.
 * @param value - Candidate structure key.
 * @returns Whether the candidate has a non-empty supported domain and dimension.
 */
export function isSubjectKey(value: string): boolean {
  const separator = value.indexOf('.')
  if (separator <= 0 || separator === value.length - 1 || value.indexOf('\n') >= 0) return false
  const domain = value.slice(0, separator)
  const dimension = value.slice(separator + 1).trim()
  return /^(?:person|world):[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(domain)
    && dimension.length > 0
    && !dimension.includes('\t')
}

/**
 * Derive a subject-key alias from a caller-supplied vocabulary spelling.
 * @param value - Candidate key spelling.
 * @returns The normalized alias, or `undefined` when invalid.
 */
export function subjectKeyAlias(value: string | undefined): string | undefined {
  const normalized = normalizeSubjectKey(value)
  if (normalized === undefined) return undefined
  const separator = normalized.indexOf('.')
  const domain = normalized.slice(0, separator)
  const dimension = normalized.slice(separator + 1)
    .replace(/[：:]/gu, '.')
    .split('.')
    .map(part => part.trim())
    .filter(Boolean)
    .join('.')
  return dimension.length === 0 ? undefined : `${domain}.${dimension}`
}

/**
 * Normalize and validate the explicit subject-key relations used by a view.
 * Relations must stay within one subject domain; this prevents a view-local
 * alias from moving a person fact into the world namespace or another person.
 * Duplicate spellings are collapsed and conflicting targets fail before any
 * facts are projected.
 * @param aliases - Explicit source-to-canonical key relations.
 * @returns Deterministically ordered normalized relations.
 * @throws {@link TypeError} when a relation is invalid, ambiguous, cyclic, or
 * crosses subject domains.
 */
export function normalizeSubjectKeyAliases(
  aliases: readonly MemorySubjectKeyAlias[] = [],
): readonly MemorySubjectKeyAlias[] {
  const pairs = new Map<string, MemorySubjectKeyAlias>()
  const lookup = new Map<string, string>()
  for (const relation of aliases) {
    const alias = normalizeSubjectKey(relation.alias)
    const canonical = normalizeSubjectKey(relation.canonical)
    if (alias === undefined || canonical === undefined) {
      throw new TypeError('memory subject-key aliases require valid alias and canonical keys')
    }
    if (subjectDomain(alias) !== subjectDomain(canonical)) {
      throw new TypeError(`memory subject-key alias '${alias}' crosses subject domains`)
    }
    if (alias === canonical) {
      throw new TypeError(`memory subject-key alias '${alias}' cannot point to itself`)
    }
    const current = pairs.get(alias)
    if (current !== undefined && current.canonical !== canonical) {
      throw new TypeError(`memory subject-key alias '${alias}' has conflicting canonical keys`)
    }
    pairs.set(alias, { alias, canonical })
    for (const spelling of aliasSpellings(alias)) {
      const target = lookup.get(spelling)
      if (target !== undefined && target !== canonical) {
        throw new TypeError(`memory subject-key alias '${alias}' has conflicting canonical keys`)
      }
      lookup.set(spelling, canonical)
    }
  }
  assertAcyclicAliases(lookup)
  return [...pairs.values()]
    .sort((left, right) => compareStrings(left.alias, right.alias) || compareStrings(left.canonical, right.canonical))
}

/**
 * Create a pure resolver for a view-local subject-key alias graph.
 * Canonicalization follows transitive relations while preserving the source
 * event and its fact text. Invalid or cyclic relations fail when the resolver
 * is created, not halfway through a projection.
 * @param aliases - Explicit source-to-canonical key relations.
 * @returns A resolver that returns canonical keys or `undefined` for invalid keys.
 */
export function createSubjectKeyAliasResolver(
  aliases: readonly MemorySubjectKeyAlias[] = [],
): (value: string | undefined) => string | undefined {
  const normalized = normalizeSubjectKeyAliases(aliases)
  const lookup = new Map<string, string>()
  for (const relation of normalized) {
    for (const spelling of aliasSpellings(relation.alias)) lookup.set(spelling, relation.canonical)
  }
  return (value: string | undefined): string | undefined => {
    const initial = normalizeSubjectKey(value)
    if (initial === undefined) return undefined
    let current = initial
    const seen = new Set<string>()
    while (true) {
      if (seen.has(current)) throw new TypeError(`memory subject-key alias cycle includes '${current}'`)
      seen.add(current)
      const next = lookup.get(current) ?? lookup.get(subjectKeyAlias(current) ?? '')
      if (next === undefined) return current
      current = next
    }
  }
}

/**
 * Resolve one key through a view-local alias graph.
 * @param value - Candidate subject key.
 * @param aliases - Explicit source-to-canonical relations.
 * @returns The canonical normalized key, or `undefined` when the candidate is invalid.
 */
export function resolveSubjectKeyAlias(
  value: string | undefined,
  aliases: readonly MemorySubjectKeyAlias[] = [],
): string | undefined {
  return createSubjectKeyAliasResolver(aliases)(value)
}

/** Alias for callers that name the result rather than the relation. */
export const canonicalizeSubjectKey = resolveSubjectKeyAlias

/**
 * Build the vocabulary supplied to an extraction request. Keys from the
 * roster, active facts, and source labels are de-duplicated and sorted so the
 * same session state always renders the same prompt.
 * @param roster - Known persons and their current keys.
 * @param facts - Active folded facts.
 * @param sourceLabels - Optional labels from a cleaned asset baseline.
 * @returns Sorted canonical subject keys.
 */
export function deriveSubjectKeys(
  roster: readonly MemoryRosterEntry[],
  facts: readonly MemoryFactEntry[],
  sourceLabels: readonly string[] = [],
): readonly string[] {
  const result = new Set<string>()
  for (const person of roster) {
    for (const key of person.subjectKeys) {
      const normalized = normalizeSubjectKey(key)
      if (normalized !== undefined) result.add(normalized)
    }
  }
  for (const fact of facts) {
    const normalized = normalizeSubjectKey(fact.subjectKey)
    if (normalized !== undefined) result.add(normalized)
  }
  for (const label of sourceLabels) {
    const normalized = label.normalize('NFKC').trim()
    if (normalized.length === 0) continue
    for (const person of roster) {
      const candidate = normalizeSubjectKey(`person:${person.personId.replace(/^person:/u, '')}.${normalized}`)
      if (candidate !== undefined) result.add(candidate)
    }
  }
  return [...result].sort((left, right) => left.localeCompare(right))
}

/**
 * Return the dimension part used by display grouping.
 * @param key - Composite subject key.
 * @returns The dimension suffix, or `undefined` for an invalid key.
 */
export function subjectDimension(key: string | undefined): string | undefined {
  const normalized = normalizeSubjectKey(key)
  return normalized?.slice(normalized.indexOf('.') + 1)
}

/**
 * Split a composite natural-language fact into atomic statements without rewriting them.
 * @param text - Composite fact text.
 * @returns Non-empty atomic text segments in source order.
 */
export function splitCompositeFact(text: string): readonly string[] {
  return text
    .split(/\s*(?:[+＋、;；]|\r?\n)\s*/u)
    .map(part => part.trim())
    .filter(part => part.length > 0)
}

/**
 * Resolve an extraction candidate against the session's open vocabulary.
 * Ambiguous dimension-only candidates are rejected instead of inventing a key.
 * @param candidate - Model-provided key or dimension label.
 * @param knownKeys - Existing canonical keys from the roster and folded facts.
 * @param aliases - Optional source-to-canonical key relations used during resolution.
 * @returns A canonical known key, or `undefined` when no unique match exists.
 */
export function resolveSubjectKey(
  candidate: string | undefined,
  knownKeys: readonly string[],
  aliases: readonly MemorySubjectKeyAlias[] = [],
): string | undefined {
  if (candidate === undefined) return undefined
  const resolveAlias = createSubjectKeyAliasResolver(aliases)
  const canonicalKeys = [...new Set(knownKeys.map(resolveAlias).filter((key): key is string => key !== undefined))]
  const normalized = resolveAlias(candidate)
  if (normalized !== undefined && canonicalKeys.includes(normalized)) return normalized
  const alias = subjectKeyAlias(candidate)
  const canonicalAlias = resolveAlias(alias)
  if (canonicalAlias !== undefined && canonicalKeys.includes(canonicalAlias)) return canonicalAlias
  const dimension = normalized === undefined
    ? candidate.normalize('NFKC').trim().replace(/\s+/gu, ' ')
    : subjectDimension(normalized)
  if (dimension === undefined || dimension.length === 0) return undefined
  const matches = canonicalKeys.filter(key => subjectDimension(key) === dimension)
  return matches.length === 1 ? matches[0] : undefined
}

/**
 * Return the sorted canonical key vocabulary used by an extraction prompt.
 * @param roster - Known people and their subject keys.
 * @param facts - Active folded facts.
 * @param sourceLabels - Optional labels from cleaned source assets.
 * @returns Sorted canonical subject keys.
 */
export function deriveSubjectKeyCatalog(
  roster: readonly MemoryRosterEntry[],
  facts: readonly MemoryFactEntry[],
  sourceLabels: readonly string[] = [],
): readonly string[] {
  return deriveSubjectKeys(roster, facts, sourceLabels)
}

function aliasSpellings(value: string): readonly string[] {
  const alias = subjectKeyAlias(value)
  return alias === undefined || alias === value ? [value] : [value, alias]
}

function subjectDomain(value: string): string {
  return value.slice(0, value.indexOf('.'))
}

function assertAcyclicAliases(lookup: ReadonlyMap<string, string>): void {
  for (const start of lookup.keys()) {
    let current = start
    const seen = new Set<string>()
    while (true) {
      if (seen.has(current)) throw new TypeError(`memory subject-key alias cycle includes '${current}'`)
      seen.add(current)
      const next = lookup.get(current)
      if (next === undefined) break
      current = next
    }
  }
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
