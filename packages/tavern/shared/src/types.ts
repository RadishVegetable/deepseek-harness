/** JSON values and structural inputs used by the dependency-free Tavern helpers. */

/** A JSON primitive. */
export type JsonPrimitive = string | number | boolean | null

/** A JSON object with recursively JSON-compatible values. */
export interface JsonObject {
  readonly [key: string]: JsonValue
}

/** A value that can be represented without executable data. */
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[]

/** One parsed non-empty label/value line. */
export interface LabeledLine {
  readonly label: string
  readonly value: string
}

/** The smallest World Info entry accepted by character-entry discovery. */
export interface WorldInfoEntryLike {
  readonly content: string
}

/** A World Info entry identified as a character. */
export interface CharacterEntryMatch<T extends WorldInfoEntryLike> {
  readonly name: string
  readonly entry: T
}

/** Read-only label suggestions grouped by the kind of Tavern source. */
export interface SuggestedLabels {
  readonly character: readonly string[]
  readonly world: readonly string[]
}
