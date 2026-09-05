/** Pure shared helpers for Tavern identifiers, source labels, and JSON data. */

import type {
  CharacterEntryMatch,
  JsonValue,
  LabeledLine,
  SuggestedLabels,
  WorldInfoEntryLike,
} from './types.ts'

export type * from './types.ts'

/**
 * Convert a display value to a stable lower-case slug.
 * @param value - Display value to normalize; null and undefined use fallback.
 * @param fallback - Non-empty result used when value has no letters or numbers.
 * @returns A lower-case slug containing only letters, numbers, and hyphens.
 */
export function slug(value: string | null | undefined, fallback = 'item'): string {
  const normalized = value?.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')
  return normalized === undefined || normalized.length === 0 ? fallback.trim() || 'item' : normalized
}

/**
 * Parse non-empty `label: value` lines and optionally provide one explicit fallback.
 * @param text - Source text containing zero or more labeled lines.
 * @param fallbackLabel - Label used only when no usable line exists; omitted means an empty result.
 * @returns Parsed lines, or one `{ label: fallbackLabel, value: text }` when both fallback inputs are usable.
 */
export function parseLabeledLines(text: string, fallbackLabel?: string): readonly LabeledLine[] {
  const lines = text.split(/\r?\n/).flatMap((line): readonly LabeledLine[] => {
    const match = /^\s*([^:]{1,80}):\s*(.+?)\s*$/.exec(line)
    const label = match?.[1]?.trim()
    const value = match?.[2]?.trim()
    return label === undefined || value === undefined || label.length === 0 || value.length === 0
      ? []
      : [{ label, value }]
  })
  if (lines.length > 0 || fallbackLabel === undefined) return lines
  const label = fallbackLabel.trim()
  const value = text.trim()
  return label.length === 0 || value.length === 0 ? [] : [{ label, value }]
}

/**
 * Find World Info entries whose type is `character` and extract their Name field.
 * @param entries - World Info entries to inspect.
 * @param fieldsForEntry - Optional normalized fields that override source lines for one entry.
 * @returns Original entries with their extracted non-empty names, in input order.
 */
export function collectCharacterEntries<T extends WorldInfoEntryLike>(
  entries: readonly T[],
  fieldsForEntry: (entry: T) => readonly LabeledLine[] = () => [],
): readonly CharacterEntryMatch<T>[] {
  const result: CharacterEntryMatch<T>[] = []
  for (const entry of entries) {
    const fields = fieldsForEntry(entry)
    const parsed = mergeLabeledLines(parseLabeledLines(entry.content), fields)
    const type = parsed.find(field => field.label.trim().toLowerCase() === 'type')?.value.trim().toLowerCase()
    if (type !== 'character') continue
    const name = parsed.find(field => field.label.trim().toLowerCase() === 'name')?.value.trim()
    if (name === undefined || name.length === 0) continue
    result.push({ name, entry })
  }
  return result
}

function mergeLabeledLines(source: readonly LabeledLine[], overrides: readonly LabeledLine[]): readonly LabeledLine[] {
  if (overrides.length === 0) return source
  const merged = [...source]
  const positions = new Map(source.map((field, index) => [field.label.trim().toLowerCase(), index]))
  for (const override of overrides) {
    const key = override.label.trim().toLowerCase()
    const position = positions.get(key)
    if (position === undefined) {
      positions.set(key, merged.length)
      merged.push(override)
    } else {
      merged[position] = override
    }
  }
  return merged
}

/**
 * Parse JSON text, including one outer fenced-JSON block.
 * @param raw - JSON text to parse.
 * @returns The parsed JSON value, or undefined for invalid JSON.
 */
export function parseJson(raw: string): JsonValue | undefined {
  const text = raw.trim()
  const candidate = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text)?.[1]?.trim() ?? text
  if (candidate.length === 0) return undefined
  try {
    const value: unknown = JSON.parse(candidate)
    return isJsonValue(value) ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * Test whether a value is a non-array object.
 * @param value - Value to inspect.
 * @returns Whether the value is a plain object suitable for JSON field access.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Reflect.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * Test whether a value is recursively JSON-compatible.
 * @param value - Value to inspect.
 * @returns Whether the value contains only finite JSON-compatible values.
 */
export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  return isRecord(value) && Object.values(value).every(isJsonValue)
}

/** Stable soft label suggestions for normalization prompts and consumers. */
export const suggestedLabels: SuggestedLabels = Object.freeze({
  character: Object.freeze(['身份', '外貌', '性格', '背景', '关系', '目标', '能力', '秘密', '状态']),
  world: Object.freeze(['地理', '历史', '势力', '规则', '物品', '事件']),
})
