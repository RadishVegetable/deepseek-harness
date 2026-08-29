import type {
  BinaryInput,
  JsonInput,
  JsonObject,
  JsonValue,
  NormalizedCharacterCard,
  NormalizedWorldInfo,
  NormalizedWorldInfoEntry,
} from './types.ts'

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const characterFieldNames = new Set([
  'name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example',
  'creator_notes', 'system_prompt', 'post_history_instructions', 'alternate_greetings',
  'tags', 'creator', 'character_version', 'extensions', 'character_book',
  'avatar', 'creatorcomment', 'talkativeness', 'fav', 'create_date',
])

const worldFieldNames = new Set([
  'name', 'description', 'scan_depth', 'scanDepth', 'token_budget', 'tokenBudget',
  'recursive_scanning', 'recursiveScanning', 'extensions', 'entries', 'originalData',
])

const entryFieldNames = new Set([
  'uid', 'id', 'key', 'keys', 'keysecondary', 'secondary_keys', 'secondaryKeys',
  'content', 'enabled', 'disable', 'constant', 'selective', 'use_regex', 'useRegex',
  'match_whole_words', 'matchWholeWords', 'case_sensitive', 'caseSensitive',
  'position', 'insertion_order', 'insertionOrder', 'order', 'probability',
  'useProbability', 'depth', 'group', 'sticky', 'cooldown', 'extensions',
])

interface ParsedObject {
  readonly value: JsonObject
  readonly rawJson?: string
}

interface EntrySource {
  readonly sourceKey: string
  readonly value: JsonObject
}

/**
 * Parse and normalize a Character Card V2/V3 JSON document.
 * @param input - A JSON string or parsed JSON object.
 * @returns The normalized card and retained source fields.
 */
export function parseCharacterCard(input: JsonInput): NormalizedCharacterCard {
  const parsed = parseObject(input, 'Character Card')
  const root = parsed.value
  const data = has(root, 'data')
    ? requireObject(root.data, 'Character Card data')
    : root
  const specValue = stringOrUndefined(root.spec ?? data.spec, 'Character Card spec')
  const spec = specValue === undefined
    ? undefined
    : requireCardSpec(specValue)
  const specVersionValue = stringOrUndefined(root.spec_version ?? data.spec_version, 'Character Card spec_version')
  const source = (name: string, ...aliases: string[]): JsonValue | undefined => {
    for (const key of [name, ...aliases]) {
      if (has(data, key)) return data[key]
    }
    if (data !== root) {
      for (const key of [name, ...aliases]) {
        if (has(root, key)) return root[key]
      }
    }
    return undefined
  }
  const bookValue = source('character_book')
  const characterBook = bookValue === undefined || bookValue === null
    ? null
    : normalizeWorldInfo(requireObject(bookValue, 'Character Card character_book'), 'character-book')
  const result: NormalizedCharacterCard = {
    kind: 'character-card',
    ...(spec === undefined ? {} : { spec }),
    ...(specVersionValue === undefined ? {} : { specVersion: specVersionValue }),
    name: stringOrDefault(source('name'), 'Character Card name'),
    description: stringOrDefault(source('description'), 'Character Card description'),
    personality: stringOrDefault(source('personality'), 'Character Card personality'),
    scenario: stringOrDefault(source('scenario'), 'Character Card scenario'),
    firstMessage: stringOrDefault(source('first_mes'), 'Character Card first_mes'),
    messageExamples: stringOrDefault(source('mes_example'), 'Character Card mes_example'),
    creatorNotes: stringOrDefault(source('creator_notes', 'creatorcomment'), 'Character Card creator_notes'),
    systemPrompt: stringOrDefault(source('system_prompt'), 'Character Card system_prompt'),
    postHistoryInstructions: stringOrDefault(source('post_history_instructions'), 'Character Card post_history_instructions'),
    alternateGreetings: stringArrayOrDefault(source('alternate_greetings'), 'Character Card alternate_greetings'),
    tags: stringArrayOrDefault(source('tags'), 'Character Card tags'),
    creator: stringOrDefault(source('creator'), 'Character Card creator'),
    characterVersion: stringOrDefault(source('character_version'), 'Character Card character_version'),
    extensions: objectOrDefault(source('extensions'), 'Character Card extensions'),
    characterBook,
    raw: cloneObject(root),
    ...(parsed.rawJson === undefined ? {} : { rawJson: parsed.rawJson }),
    unknown: unknownFields(root, new Set(['spec', 'spec_version', 'data', ...characterFieldNames, 'spec_version'])),
    dataUnknown: data === root ? {} : unknownFields(data, new Set(['spec', 'spec_version', ...characterFieldNames])),
  }
  return result
}

/**
 * Extract the UTF-8 Character Card JSON stored in a PNG `chara` text chunk.
 * Uncompressed `tEXt` and `iTXt` chunks are supported; compressed chunks fail
 * explicitly because this package is shared with the browser and has no
 * synchronous runtime-specific decompressor.
 * @param input - PNG bytes as an ArrayBuffer or Uint8Array.
 * @returns The embedded Character Card JSON text.
 * @throws {TypeError} When the input is not a PNG byte sequence.
 * @throws {RangeError} When the PNG has no supported `chara` chunk.
 */
export function extractCharacterCardJson(input: BinaryInput): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (!startsWith(bytes, PNG_SIGNATURE)) throw new TypeError('Character Card PNG has an invalid PNG signature.')

  let offset = PNG_SIGNATURE.length
  while (offset < bytes.length) {
    if (bytes.length - offset < 12) throw new RangeError('Character Card PNG has a truncated chunk.')
    const length = readUint32(bytes, offset)
    const type = ascii(bytes, offset + 4, offset + 8)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (dataEnd > bytes.length - 4) throw new RangeError(`Character Card PNG chunk ${type} is truncated.`)
    const data = bytes.subarray(dataStart, dataEnd)
    if (type === 'tEXt') {
      const text = readTextChunk(data)
      if (text?.keyword === 'chara') return decodeBase64Json(text.value)
    } else if (type === 'iTXt') {
      const text = readInternationalTextChunk(data)
      if (text?.keyword === 'chara') {
        if (text.compressed) throw new RangeError('Compressed Character Card iTXt chunks are not supported.')
        return decodeBase64Json(text.value)
      }
    } else if (type === 'zTXt' && asciiBeforeNull(data) === 'chara') {
      throw new RangeError('Compressed Character Card zTXt chunks are not supported.')
    }
    offset = dataEnd + 4
    if (type === 'IEND') break
  }
  throw new RangeError('Character Card PNG does not contain a supported chara text chunk.')
}

/**
 * Parse a Character Card embedded in a PNG container.
 * @param input - PNG bytes as an ArrayBuffer or Uint8Array.
 * @returns The normalized Character Card and retained source fields.
 */
export function parseCharacterCardPng(input: BinaryInput): NormalizedCharacterCard {
  return parseCharacterCard(extractCharacterCardJson(input))
}

/**
 * Parse and normalize a standalone World Info/YMLv2 JSON document.
 * @param input - A JSON string or parsed JSON object.
 * @returns The normalized World Info document.
 */
export function parseWorldInfo(input: JsonInput): NormalizedWorldInfo {
  const parsed = parseObject(input, 'World Info')
  return normalizeWorldInfo(parsed.value, 'standalone', parsed.rawJson)
}

function normalizeWorldInfo(root: JsonObject, sourceKind: NormalizedWorldInfo['sourceKind'], rawJson?: string): NormalizedWorldInfo {
  const originalData = has(root, 'originalData') && isObject(root.originalData) ? root.originalData : undefined
  const entriesValue = has(root, 'entries') ? root.entries : originalData?.entries
  const entrySources = entriesValue === undefined ? [] : readEntrySources(entriesValue)
  const name = nullableString(firstValue(root, ['name']) ?? firstValue(originalData, ['name']), 'World Info name')
  const description = nullableString(firstValue(root, ['description']) ?? firstValue(originalData, ['description']), 'World Info description')
  const scanDepth = nullableNumber(firstValue(root, ['scan_depth', 'scanDepth']) ?? firstValue(originalData, ['scan_depth', 'scanDepth']), 'World Info scan_depth')
  const tokenBudget = nullableNumber(firstValue(root, ['token_budget', 'tokenBudget']) ?? firstValue(originalData, ['token_budget', 'tokenBudget']), 'World Info token_budget')
  const recursiveScanning = nullableBoolean(firstValue(root, ['recursive_scanning', 'recursiveScanning']) ?? firstValue(originalData, ['recursive_scanning', 'recursiveScanning']), 'World Info recursive_scanning')
  const extensionValue = firstValue(root, ['extensions']) ?? firstValue(originalData, ['extensions'])
  const extensions = extensionValue === undefined || extensionValue === null
    ? {}
    : requireObject(extensionValue, 'World Info extensions')
  return {
    kind: 'world-info',
    sourceKind,
    name,
    description,
    scanDepth,
    tokenBudget,
    recursiveScanning,
    extensions: cloneObject(extensions),
    entries: entrySources.map(source => normalizeEntry(source.value, source.sourceKey)),
    raw: cloneObject(root),
    ...(rawJson === undefined ? {} : { rawJson }),
    unknown: unknownFields(root, worldFieldNames),
  }
}

function normalizeEntry(source: JsonObject, sourceKey: string): NormalizedWorldInfoEntry {
  const extensions = has(source, 'extensions') && isObject(source.extensions) ? source.extensions : undefined
  const value = (keys: readonly string[]): JsonValue | undefined => firstValue(source, keys) ?? firstValue(extensions, keys)
  const uidValue = value(['uid', 'id'])
  const uid = uidValue === undefined || uidValue === null
    ? null
    : stringOrNumber(uidValue, `World Info entry ${sourceKey} uid`)
  const enabledValue = booleanOrUndefined(value(['enabled']), `World Info entry ${sourceKey} enabled`)
  const disabledValue = booleanOrUndefined(value(['disable']), `World Info entry ${sourceKey} disable`)
  const enabled = enabledValue ?? !(disabledValue ?? false)
  const result: NormalizedWorldInfoEntry = {
    uid,
    id: uid === null ? sourceKey : String(uid),
    sourceKey,
    keys: stringArray(value(['keys', 'key']), `World Info entry ${sourceKey} key`),
    secondaryKeys: stringArray(value(['secondary_keys', 'secondaryKeys', 'keysecondary']), `World Info entry ${sourceKey} secondary_keys`),
    content: stringOrDefault(value(['content']), `World Info entry ${sourceKey} content`),
    enabled,
    constant: booleanOrDefault(value(['constant']), `World Info entry ${sourceKey} constant`, false),
    selective: booleanOrDefault(value(['selective']), `World Info entry ${sourceKey} selective`, false),
    useRegex: booleanOrDefault(value(['use_regex', 'useRegex']), `World Info entry ${sourceKey} use_regex`, false),
    matchWholeWords: booleanOrDefault(value(['match_whole_words', 'matchWholeWords']), `World Info entry ${sourceKey} match_whole_words`, false),
    caseSensitive: booleanOrDefault(value(['case_sensitive', 'caseSensitive']), `World Info entry ${sourceKey} case_sensitive`, false),
    position: nullableStringOrNumber(value(['position']), `World Info entry ${sourceKey} position`),
    depth: numberOrDefault(value(['depth']), `World Info entry ${sourceKey} depth`, 0),
    insertionOrder: numberOrDefault(value(['insertion_order', 'insertionOrder', 'order']), `World Info entry ${sourceKey} insertion_order`, 0),
    probability: numberOrDefault(value(['probability']), `World Info entry ${sourceKey} probability`, 100),
    useProbability: booleanOrDefault(value(['useProbability']), `World Info entry ${sourceKey} useProbability`, false),
    group: nullableString(value(['group']), `World Info entry ${sourceKey} group`),
    sticky: nullableNumber(value(['sticky']), `World Info entry ${sourceKey} sticky`),
    cooldown: nullableNumber(value(['cooldown']), `World Info entry ${sourceKey} cooldown`),
    raw: cloneObject(source),
    unknown: unknownFields(source, entryFieldNames),
  }
  return result
}

function readEntrySources(value: JsonValue): EntrySource[] {
  if (Array.isArray(value)) {
    return value.map((entry, index) => ({ sourceKey: String(index), value: requireObject(entry, `World Info entry ${index}`) }))
  }
  const object = requireObject(value, 'World Info entries')
  return Object.keys(object)
    .sort(compareEntryKeys)
    .map(sourceKey => ({ sourceKey, value: requireObject(object[sourceKey], `World Info entry ${sourceKey}`) }))
}

function compareEntryKeys(left: string, right: string): number {
  const leftNumber = numericKey(left)
  const rightNumber = numericKey(right)
  if (leftNumber !== undefined && rightNumber !== undefined) return leftNumber - rightNumber
  if (leftNumber !== undefined) return -1
  if (rightNumber !== undefined) return 1
  return left.localeCompare(right)
}

function numericKey(value: string): number | undefined {
  if (!/^\d+$/.test(value)) return undefined
  const number = Number(value)
  return Number.isSafeInteger(number) ? number : undefined
}

function parseObject(input: JsonInput, label: string): ParsedObject {
  if (typeof input === 'string') {
    let parsed: unknown
    try {
      parsed = JSON.parse(input) as unknown
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new SyntaxError(`${label} is not valid JSON: ${message}`)
    }
    return { value: requireObject(parsed, label), rawJson: input }
  }
  return { value: requireObject(input, label) }
}

function startsWith(value: Uint8Array, prefix: Uint8Array): boolean {
  return prefix.every((byte, index) => value[index] === byte)
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return byteAt(bytes, offset) * 0x1000000
    + byteAt(bytes, offset + 1) * 0x10000
    + byteAt(bytes, offset + 2) * 0x100
    + byteAt(bytes, offset + 3)
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let value = ''
  for (let index = start; index < end; index += 1) value += String.fromCharCode(byteAt(bytes, index))
  return value
}

function byteAt(bytes: Uint8Array, index: number): number {
  const byte = bytes[index]
  if (byte === undefined) throw new RangeError(`PNG byte ${index} is out of range`)
  return byte
}

function asciiBeforeNull(bytes: Uint8Array): string {
  const end = bytes.indexOf(0)
  return ascii(bytes, 0, end < 0 ? bytes.length : end)
}

function readTextChunk(bytes: Uint8Array): { keyword: string; value: string } | undefined {
  const separator = bytes.indexOf(0)
  if (separator < 0) return undefined
  return { keyword: ascii(bytes, 0, separator), value: ascii(bytes, separator + 1, bytes.length) }
}

function readInternationalTextChunk(bytes: Uint8Array): { keyword: string; value: string; compressed: boolean } | undefined {
  const keywordEnd = bytes.indexOf(0)
  if (keywordEnd < 0 || bytes.length <= keywordEnd + 2) return undefined
  const compressed = bytes[keywordEnd + 1] === 1
  let offset = keywordEnd + 3
  const languageEnd = bytes.indexOf(0, offset)
  if (languageEnd < 0) return undefined
  offset = languageEnd + 1
  const translatedEnd = bytes.indexOf(0, offset)
  if (translatedEnd < 0) return undefined
  return {
    keyword: ascii(bytes, 0, keywordEnd),
    value: new TextDecoder().decode(bytes.subarray(translatedEnd + 1)),
    compressed,
  }
}

function decodeBase64Json(value: string): string {
  const normalized = value.replace(/\s+/g, '')
  if (normalized.length === 0 || normalized.length % 4 !== 0) throw new SyntaxError('Character Card PNG chara data is not valid Base64.')
  const bytes: number[] = []
  for (let index = 0; index < normalized.length; index += 4) {
    const quartet = normalized.slice(index, index + 4)
    const a = base64Digit(quartet[0])
    const b = base64Digit(quartet[1])
    const c = quartet[2] === '=' ? 64 : base64Digit(quartet[2])
    const d = quartet[3] === '=' ? 64 : base64Digit(quartet[3])
    if (a < 0 || b < 0 || c < 0 || d < 0 || (c === 64 && d !== 64)) {
      throw new SyntaxError('Character Card PNG chara data is not valid Base64.')
    }
    bytes.push((a << 2) | (b >> 4))
    if (c !== 64) bytes.push(((b & 15) << 4) | (c >> 2))
    if (d !== 64) bytes.push(((c & 3) << 6) | d)
    if ((c === 64 || d === 64) && index + 4 !== normalized.length) {
      throw new SyntaxError('Character Card PNG chara data has invalid Base64 padding.')
    }
  }
  return new TextDecoder().decode(Uint8Array.from(bytes))
}

function base64Digit(value: string | undefined): number {
  if (value === undefined) throw new SyntaxError('Character Card PNG chara data is not valid Base64.')
  return BASE64_ALPHABET.indexOf(value)
}

function requireObject(value: unknown, label: string): JsonObject {
  if (!isObject(value)) throw new TypeError(`${label} must be a JSON object.`)
  return value
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function has(object: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key)
}

function firstValue(object: JsonObject | undefined, keys: readonly string[]): JsonValue | undefined {
  if (object === undefined) return undefined
  for (const key of keys) {
    if (has(object, key)) return object[key]
  }
  return undefined
}

function stringOrUndefined(value: JsonValue | undefined, label: string): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string.`)
  return value
}

function stringOrDefault(value: JsonValue | undefined, label: string): string {
  return stringOrUndefined(value, label) ?? ''
}

function nullableString(value: JsonValue | undefined, label: string): string | null {
  return stringOrUndefined(value, label) ?? null
}

function stringArrayOrDefault(value: JsonValue | undefined, label: string): readonly string[] {
  return value === undefined || value === null ? [] : stringArray(value, label)
}

function stringArray(value: JsonValue | undefined, label: string): readonly string[] {
  if (value === undefined || value === null) return []
  if (typeof value === 'string') return [value]
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
    throw new TypeError(`${label} must be a string or an array of strings.`)
  }
  return [...value]
}

function objectOrDefault(value: JsonValue | undefined, label: string): JsonObject {
  return value === undefined || value === null ? {} : cloneObject(requireObject(value, label))
}

function booleanOrUndefined(value: JsonValue | undefined, label: string): boolean | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be a boolean.`)
  return value
}

function booleanOrDefault(value: JsonValue | undefined, label: string, fallback: boolean): boolean {
  return booleanOrUndefined(value, label) ?? fallback
}

function nullableBoolean(value: JsonValue | undefined, label: string): boolean | null {
  return booleanOrUndefined(value, label) ?? null
}

function stringOrNumber(value: JsonValue, label: string): string | number {
  if (typeof value === 'string' || typeof value === 'number') return value
  throw new TypeError(`${label} must be a string or number.`)
}

function nullableStringOrNumber(value: JsonValue | undefined, label: string): string | number | null {
  return value === undefined || value === null ? null : stringOrNumber(value, label)
}

function numberOrDefault(value: JsonValue | undefined, label: string, fallback: number): number {
  if (value === undefined || value === null) return fallback
  if (typeof value === 'string' && value.trim() !== '') value = Number(value)
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label} must be a finite number.`)
  return value
}

function nullableNumber(value: JsonValue | undefined, label: string): number | null {
  return value === undefined || value === null ? null : numberOrDefault(value, label, 0)
}

function requireCardSpec(value: string): 'chara_card_v2' | 'chara_card_v3' {
  if (value !== 'chara_card_v2' && value !== 'chara_card_v3') {
    throw new RangeError(`Unsupported Character Card spec ${JSON.stringify(value)}; expected chara_card_v2 or chara_card_v3.`)
  }
  return value
}

function unknownFields(object: JsonObject, known: ReadonlySet<string>): JsonObject {
  const unknown: Record<string, JsonValue> = {}
  for (const [key, value] of Object.entries(object)) {
    if (!known.has(key)) unknown[key] = cloneValue(value)
  }
  return unknown
}

function cloneObject(value: JsonObject): JsonObject {
  return cloneValue(value) as JsonObject
}

function cloneValue(value: JsonValue): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}
