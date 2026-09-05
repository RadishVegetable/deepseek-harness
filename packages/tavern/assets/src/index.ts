/** Serializable Tavern asset registry and prompt-baseline projection. */

export { AssetRegistryError } from './errors.ts'
export type { AssetRegistryErrorCode } from './errors.ts'
export { serializeCharacterAsset, serializeTavernAsset, serializeWorldInfoAsset } from './export.ts'
export type { JsonExportOptions } from './export.ts'
export { deduplicateWorldInfoAssets, projectPromptAssetBaseline } from './prompt.ts'
export { AssetRegistry, createAssetId } from './registry.ts'
export type {
  AssetId,
  AssetSelection,
  AssetSourceReference,
  AssetVersion,
  CharacterAsset,
  CharacterPromptField,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  PromptAssetBaseline,
  PromptAssetReference,
  PromptCharacterSection,
  PromptWorldInfoEntry,
  TavernAsset,
  TavernAssetKind,
  WorldInfoAsset,
  WorldInfoEntry,
  WorldInfoPosition,
} from './types.ts'
