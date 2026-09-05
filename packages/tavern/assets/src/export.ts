/** JSON serializers for normalized Tavern assets. */

import type {
  CharacterAsset,
  JsonObject,
  JsonValue,
  TavernAsset,
  WorldInfoAsset,
  WorldInfoEntry,
} from './types.ts'

type MutableJsonObject = { [key: string]: JsonValue }

/** Formatting options for a serialized JSON asset. */
export interface JsonExportOptions {
  /** Indent the JSON with two spaces instead of emitting compact JSON. */
  readonly pretty?: boolean
  /** Append one newline to the serialized JSON document. */
  readonly trailingNewline?: boolean
}

/**
 * Serialize a CharacterAsset while retaining unknown source fields.
 *
 * @param asset - Normalized Character Card asset to serialize.
 * @param options - Optional JSON formatting options.
 * @returns A JSON document suitable for re-import by the compatibility parser.
 */
export function serializeCharacterAsset(asset: CharacterAsset, options?: JsonExportOptions): string {
  return stringifyJson(characterJson(asset), options)
}

/**
 * Serialize a WorldInfoAsset while retaining unknown source fields and entry order.
 *
 * @param asset - Normalized World Info asset to serialize.
 * @param options - Optional JSON formatting options.
 * @returns A JSON document suitable for re-import by the compatibility parser.
 */
export function serializeWorldInfoAsset(asset: WorldInfoAsset, options?: JsonExportOptions): string {
  return stringifyJson(worldInfoJson(asset), options)
}

/**
 * Serialize either supported Tavern asset kind.
 * @param asset - Normalized asset to serialize.
 * @param options - Optional JSON formatting options.
 * @returns A JSON document suitable for re-import by the compatibility parser.
 */
export function serializeTavernAsset(asset: TavernAsset, options?: JsonExportOptions): string {
  return asset.kind === 'character'
    ? serializeCharacterAsset(asset, options)
    : serializeWorldInfoAsset(asset, options)
}

function characterJson(asset: CharacterAsset): JsonObject {
  const root = cloneObject(asset.sourceData)
  const data = isJsonObject(root.data) ? cloneObject(root.data) : root
  data.name = asset.name
  data.description = asset.description
  data.personality = asset.personality
  data.scenario = asset.scenario
  data.first_mes = asset.firstMessage
  data.creator_notes = asset.creatorNotes
  data.mes_example = asset.messageExamples
  data.alternate_greetings = [...asset.alternateGreetings]
  data.system_prompt = asset.systemPrompt
  data.post_history_instructions = asset.postHistoryInstructions
  data.extensions = cloneObject(asset.extensions)
  if (data !== root) root.data = data
  return root
}

function worldInfoJson(asset: WorldInfoAsset): JsonObject {
  const root = cloneObject(asset.sourceData)
  root.name = asset.name
  root.extensions = cloneObject(asset.extensions)

  if (isJsonObject(root.originalData)) {
    const originalData = cloneObject(root.originalData)
    originalData.name = asset.name
    originalData.extensions = cloneObject(asset.extensions)
    originalData.entries = updateEntryContainer(originalData.entries, asset.entries)
    root.originalData = originalData
  }
  root.entries = updateEntryContainer(root.entries, asset.entries)
  return root
}

function updateEntryContainer(value: JsonValue | undefined, entries: readonly WorldInfoEntry[]): JsonValue {
  if (Array.isArray(value)) {
    return updateArrayEntries(value, entries)
  }
  if (isJsonObject(value)) {
    const keys = Object.keys(value)
    const result = cloneObject(value)
    for (const [index, key] of keys.entries()) {
      const current = value[key]
      if (isJsonObject(current) && entries[index] !== undefined) {
        result[key] = updateEntry(current, entries[index])
      }
    }
    for (let index = keys.length; index < entries.length; index += 1) {
      const entry = entries[index]
      if (entry === undefined) throw new Error(`World Info entry ${index} is missing during export`)
      result[String(index)] = canonicalEntry(entry)
    }
    return result
  }
  return entries.map(canonicalEntry)
}

function updateArrayEntries(value: readonly JsonValue[], entries: readonly WorldInfoEntry[]): JsonValue[] {
  const result = value.map((current, index) =>
    isJsonObject(current) && entries[index] !== undefined ? updateEntry(current, entries[index]) : cloneValue(current))
  for (let index = value.length; index < entries.length; index += 1) {
    const entry = entries[index]
    if (entry === undefined) throw new Error(`World Info entry ${index} is missing during export`)
    result.push(canonicalEntry(entry))
  }
  return result
}

function updateEntry(source: JsonObject, entry: WorldInfoEntry): JsonObject {
  const result = cloneObject(source)
  setExistingOr(result, ['keys', 'key'], [...entry.keys])
  setExistingOr(result, ['secondary_keys', 'secondaryKeys', 'keysecondary'], [...entry.secondaryKeys])
  setExistingOr(result, ['selective'], entry.selective ?? false)
  setExistingOr(result, ['constant'], entry.constant ?? false)
  setExistingOr(result, ['use_regex', 'useRegex'], entry.useRegex ?? false)
  setExistingOr(result, ['match_whole_words', 'matchWholeWords'], entry.matchWholeWords ?? true)
  setExistingOr(result, ['case_sensitive', 'caseSensitive'], entry.caseSensitive ?? false)
  setExistingOr(result, ['useProbability'], entry.useProbability ?? false)
  result.content = entry.content
  if ('enabled' in source) result.enabled = entry.enabled
  else if ('disable' in source) result.disable = !entry.enabled
  else result.enabled = entry.enabled
  if ('position' in source) result.position = rawPosition(entry.position)
  if ('insertion_order' in source) result.insertion_order = entry.order
  else if ('insertionOrder' in source) result.insertionOrder = entry.order
  else if ('order' in source) result.order = entry.order
  else result.insertion_order = entry.order
  if ('probability' in source) result.probability = entry.probability
  if ('depth' in source) result.depth = entry.depth
  if ('group' in source) result.group = entry.group
  if ('sticky' in source) result.sticky = entry.sticky
  if ('cooldown' in source) result.cooldown = entry.cooldown
  return result
}

function canonicalEntry(entry: WorldInfoEntry): JsonObject {
  return {
    keys: [...entry.keys],
    secondary_keys: [...entry.secondaryKeys],
    selective: entry.selective ?? false,
    constant: entry.constant ?? false,
    use_regex: entry.useRegex ?? false,
    match_whole_words: entry.matchWholeWords ?? true,
    case_sensitive: entry.caseSensitive ?? false,
    useProbability: entry.useProbability ?? false,
    content: entry.content,
    enabled: entry.enabled,
    position: rawPosition(entry.position),
    insertion_order: entry.order,
    depth: entry.depth,
    probability: entry.probability,
    group: entry.group,
    sticky: entry.sticky,
    cooldown: entry.cooldown,
    extensions: cloneObject(entry.extensions),
  }
}

function setExistingOr(result: { [key: string]: JsonValue }, keys: readonly string[], value: JsonValue): void {
  const key = keys.find(candidate => candidate in result) ?? keys[0]
  if (key === undefined) throw new Error('World Info export field aliases must not be empty')
  result[key] = value
}

function rawPosition(position: WorldInfoEntry['position']): string {
  switch (position) {
    case 'before-character': return 'before_char'
    case 'after-character': return 'after_char'
    case 'before-history': return 'before_an'
    case 'after-history': return 'after_an'
    case 'at-depth': return 'at_depth'
  }
}

function stringifyJson(value: JsonObject, options: JsonExportOptions | undefined): string {
  const json = JSON.stringify(value, undefined, options?.pretty === true ? 2 : undefined)
  const result = json
  return options?.trailingNewline === true ? `${result}\n` : result
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function cloneObject(value: JsonObject): MutableJsonObject {
  return cloneValue(value) as JsonObject
}

function cloneValue(value: JsonValue): JsonValue {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(cloneValue)
  const result: Record<string, JsonValue> = {}
  for (const [key, nested] of Object.entries(value)) result[key] = cloneValue(nested)
  return result
}
