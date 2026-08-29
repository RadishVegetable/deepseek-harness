/** JSON values accepted at the parser seam. */
export type JsonValue = null | boolean | number | string | JsonObject | JsonValue[]

/** A JSON object with recursively JSON-compatible values. */
export type JsonObject = { readonly [key: string]: JsonValue }

/** A JSON string or an already parsed JSON object. */
export type JsonInput = string | JsonObject

/** A PNG byte sequence accepted by the Character Card container parser. */
export type BinaryInput = Uint8Array | ArrayBuffer

/** A normalized Character Card V2/V3 document. */
export interface NormalizedCharacterCard {
  readonly kind: 'character-card'
  readonly spec?: 'chara_card_v2' | 'chara_card_v3'
  readonly specVersion?: string
  readonly name: string
  readonly description: string
  readonly personality: string
  readonly scenario: string
  readonly firstMessage: string
  readonly messageExamples: string
  readonly creatorNotes: string
  readonly systemPrompt: string
  readonly postHistoryInstructions: string
  readonly alternateGreetings: readonly string[]
  readonly tags: readonly string[]
  readonly creator: string
  readonly characterVersion: string
  readonly extensions: JsonObject
  readonly characterBook: NormalizedWorldInfo | null
  readonly raw: JsonObject
  readonly rawJson?: string
  readonly unknown: JsonObject
  readonly dataUnknown: JsonObject
}

/** A normalized standalone World Info document or embedded character book. */
export interface NormalizedWorldInfo {
  readonly kind: 'world-info'
  readonly sourceKind: 'standalone' | 'character-book'
  readonly name: string | null
  readonly description: string | null
  readonly scanDepth: number | null
  readonly tokenBudget: number | null
  readonly recursiveScanning: boolean | null
  readonly extensions: JsonObject
  readonly entries: readonly NormalizedWorldInfoEntry[]
  readonly raw: JsonObject
  readonly rawJson?: string
  readonly unknown: JsonObject
}

/** A normalized World Info entry with common Tavern/YMLv2 aliases resolved. */
export interface NormalizedWorldInfoEntry {
  readonly uid: string | number | null
  readonly id: string
  readonly sourceKey: string
  readonly keys: readonly string[]
  readonly secondaryKeys: readonly string[]
  readonly content: string
  readonly enabled: boolean
  readonly constant: boolean
  readonly selective: boolean
  readonly useRegex: boolean
  readonly matchWholeWords: boolean
  readonly caseSensitive: boolean
  readonly position: string | number | null
  readonly depth?: number
  readonly insertionOrder: number
  readonly probability: number
  readonly useProbability: boolean
  readonly group?: string | null
  readonly sticky?: number | null
  readonly cooldown?: number | null
  readonly raw: JsonObject
  readonly unknown: JsonObject
}
