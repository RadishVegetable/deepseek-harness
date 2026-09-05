/** Serializable asset vocabulary shared by Tavern asset providers and consumers. */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** A JSON scalar value. */
export type JsonPrimitive = string | number | boolean | null

/** A JSON object whose values are themselves JSON values. */
export interface JsonObject {
  readonly [key: string]: JsonValue
}

/** A value that can be represented by JSON without executable behavior. */
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[]

/** Nominal identifier used by persisted Tavern assets and their references. */
export type AssetId = Branded<'TavernAssetId'>

/** The two asset kinds owned by this package. */
export type TavernAssetKind = 'character' | 'world-info'

/** A version tuple that identifies the source format and normalized revision. */
export interface AssetVersion {
  /** Source or native format identifier, such as `character-card-v2`. */
  readonly format: string
  /** Non-negative revision within the format. */
  readonly revision: number
}

/** A durable pointer to the file, URL, embedded payload, or other asset source. */
export interface AssetSourceReference {
  /** Source kind supplied by the compatibility adapter. */
  readonly kind: string
  /** Stable locator for the source; it is not interpreted by this package. */
  readonly locator: string
  /** Source media type, or `null` when the adapter has no type information. */
  readonly mediaType: string | null
  /** Optional source digest, or `null` when the adapter has no digest. */
  readonly digest: string | null
}

/** A normalized character asset with its source payload retained for round trips. */
export interface CharacterAsset {
  /** Discriminator for the asset registry. */
  readonly kind: 'character'
  /** Stable asset identifier. */
  readonly id: AssetId
  /** User-facing character name; registry registration rejects blank names. */
  readonly name: string
  /** Format and revision of the imported or native asset. */
  readonly version: AssetVersion
  /** Source pointers retained by the compatibility adapter. */
  readonly sourceReferences: readonly AssetSourceReference[]
  /** Opaque source fields retained without parser-specific interpretation. */
  readonly sourceData: JsonObject
  /** Character description text. */
  readonly description: string
  /** Character personality text. */
  readonly personality: string
  /** Scenario text associated with the character. */
  readonly scenario: string
  /** Initial greeting text. */
  readonly firstMessage: string
  /** Creator-authored notes retained from the source card. */
  readonly creatorNotes: string
  /** Example dialogue retained from the source card. */
  readonly messageExamples: string
  /** Alternative greeting texts in source order. */
  readonly alternateGreetings: readonly string[]
  /** Optional character-specific system prompt text. */
  readonly systemPrompt: string
  /** Instructions placed after conversation history. */
  readonly postHistoryInstructions: string
  /** Character-card-owned World Book, kept out of the standalone asset library. */
  readonly characterBook: WorldInfoAsset | null
  /** Non-executable extension fields preserved by the adapter. */
  readonly extensions: JsonObject
}

/** Supported insertion locations for a World Book entry. */
export type WorldInfoPosition = 'before-character' | 'after-character' | 'before-history' | 'after-history' | 'at-depth'

/** One normalized World Book entry retained inside a World Info asset. */
export interface WorldInfoEntry {
  /** Stable entry identifier within the asset. */
  readonly id: AssetId
  /** Primary keyword list in source order. */
  readonly keys: readonly string[]
  /** Secondary keyword list in source order. */
  readonly secondaryKeys: readonly string[]
  /** Whether primary and secondary keys must both match. */
  readonly selective?: boolean
  /** Whether this entry activates without keyword matching. */
  readonly constant?: boolean
  /** Whether keys are regular expressions. */
  readonly useRegex?: boolean
  /** Whether literal keys must match whole words. */
  readonly matchWholeWords?: boolean
  /** Whether key matching preserves case. */
  readonly caseSensitive?: boolean
  /** Whether probability filtering applies to this entry. */
  readonly useProbability?: boolean
  /** Text inserted when the entry is activated. */
  readonly content: string
  /** Whether the entry is eligible for activation. */
  readonly enabled: boolean
  /** Prompt insertion location. */
  readonly position: WorldInfoPosition
  /** History depth used by depth-based activation. */
  readonly depth: number
  /** Stable source order used to break activation ties. */
  readonly order: number
  /** Whether this entry can activate another entry during recursive matching. */
  readonly recursive: boolean
  /** Activation probability as a percentage from 0 through 100. */
  readonly probability: number
  /** Optional activation group. */
  readonly group: string | null
  /** Sticky activation duration, or `null` when disabled. */
  readonly sticky: number | null
  /** Cooldown duration, or `null` when disabled. */
  readonly cooldown: number | null
  /** Non-executable extension fields preserved by the adapter. */
  readonly extensions: JsonObject
}

/** A normalized World Book asset and its retained source payload. */
export interface WorldInfoAsset {
  /** Discriminator for the asset registry. */
  readonly kind: 'world-info'
  /** Stable asset identifier. */
  readonly id: AssetId
  /** User-facing World Book name; registry registration rejects blank names. */
  readonly name: string
  /** Format and revision of the imported or native asset. */
  readonly version: AssetVersion
  /** Source pointers retained by the compatibility adapter. */
  readonly sourceReferences: readonly AssetSourceReference[]
  /** Opaque source fields retained without parser-specific interpretation. */
  readonly sourceData: JsonObject
  /** Maximum history depth requested by the source, or null when unspecified. */
  readonly scanDepth: number | null
  /** Source token budget requested by the World Book, or null when unspecified. */
  readonly tokenBudget: number | null
  /** Whether recursive entry scanning is enabled by the source. */
  readonly recursiveScanning: boolean
  /** World Book entries in source order. */
  readonly entries: readonly WorldInfoEntry[]
  /** Non-executable extension fields preserved by the adapter. */
  readonly extensions: JsonObject
}

/** Either asset kind accepted by the registry. */
export type TavernAsset = CharacterAsset | WorldInfoAsset

/** IDs selected for one Tavern prompt assembly. */
export interface AssetSelection {
  /** Selected character, or `null` for a scene without a character. */
  readonly characterId: AssetId | null
  /** Selected World Book IDs in the order requested by the caller. */
  readonly worldInfoIds: readonly AssetId[]
}

/** Versioned asset reference included in a prompt baseline for cache keys and inspection. */
export interface PromptAssetReference {
  /** Asset kind. */
  readonly kind: TavernAssetKind
  /** Referenced asset identifier. */
  readonly assetId: AssetId
  /** Version used for this baseline. */
  readonly version: AssetVersion
}

/** A character field projected into the stable prompt baseline. */
export type CharacterPromptField =
  | 'description'
  | 'personality'
  | 'scenario'
  | 'first-message'
  | 'alternate-greeting'
  | 'creator-notes'
  | 'message-examples'
  | 'system-prompt'
  | 'post-history-instructions'

/** A character text section with an asset source reference. */
export interface PromptCharacterSection {
  /** Stable section identifier within the baseline. */
  readonly id: string
  /** Character field represented by this section. */
  readonly field: CharacterPromptField
  /** Text copied from the character asset. */
  readonly text: string
  /** Character asset that supplied the text. */
  readonly sourceAssetId: AssetId
}

/** A World Book entry projected as an activation candidate. */
export interface PromptWorldInfoEntry {
  /** Entry identifier. */
  readonly id: AssetId
  /** World Book asset that supplied the entry. */
  readonly sourceAssetId: AssetId
  /** Primary keyword list. */
  readonly keys: readonly string[]
  /** Secondary keyword list. */
  readonly secondaryKeys: readonly string[]
  /** Whether primary and secondary keys must both match. */
  readonly selective: boolean
  /** Whether this entry activates without keyword matching. */
  readonly constant: boolean
  /** Whether keys are regular expressions. */
  readonly useRegex: boolean
  /** Whether literal keys must match whole words. */
  readonly matchWholeWords: boolean
  /** Whether key matching preserves case. */
  readonly caseSensitive: boolean
  /** Whether probability filtering applies to this entry. */
  readonly useProbability: boolean
  /** Entry text. */
  readonly content: string
  /** Whether the entry may activate. */
  readonly enabled: boolean
  /** World Book scan window in messages, or null when unspecified. */
  readonly scanDepth: number | null
  /** World Book token budget, or null when unspecified. */
  readonly tokenBudget: number | null
  /** Whether recursive World Book scanning is enabled. */
  readonly recursiveScanning: boolean
  /** Prompt insertion location. */
  readonly position: WorldInfoPosition
  /** History depth. */
  readonly depth: number
  /** Source order. */
  readonly order: number
  /** Recursive activation flag. */
  readonly recursive: boolean
  /** Activation probability. */
  readonly probability: number
  /** Optional activation group. */
  readonly group: string | null
  /** Sticky activation duration. */
  readonly sticky: number | null
  /** Cooldown duration. */
  readonly cooldown: number | null
}

/** Stable, source-tracked prompt inputs produced from an asset selection. */
export interface PromptAssetBaseline {
  /** Asset IDs that produced this baseline. */
  readonly selection: AssetSelection
  /** Versioned references for the stable assets. */
  readonly references: readonly PromptAssetReference[]
  /** Character sections in deterministic field order. */
  readonly characterSections: readonly PromptCharacterSection[]
  /** World Book entries available to a later activation compiler. */
  readonly worldInfoEntries: readonly PromptWorldInfoEntry[]
}
