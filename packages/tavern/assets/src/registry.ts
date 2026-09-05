/** In-memory registry and selection resolver for serializable Tavern assets. */

import { AssetRegistryError } from './errors.ts'
import { projectPromptAssetBaseline } from './prompt.ts'
import type {
  AssetId,
  AssetSelection,
  CharacterAsset,
  JsonObject,
  JsonValue,
  TavernAsset,
  WorldInfoAsset,
} from './types.ts'
import type { PromptAssetBaseline } from './types.ts'

/**
 * Create an asset ID after checking the only invariant this package owns.
 * The original text is retained; validation does not normalize persisted IDs.
 *
 * @param value - Candidate asset ID.
 * @returns The candidate as a nominal asset ID.
 * @throws {@link AssetRegistryError} when the ID is blank.
 */
export function createAssetId(value: string): AssetId {
  if (value.trim().length === 0) {
    throw new AssetRegistryError('invalid-id', 'asset id must not be empty')
  }
  return value as AssetId
}

/**
 * Registry for character and World Book snapshots.
 *
 * Registration is process-local and has no persistence or Cordis lifecycle. Each
 * registration returns a disposer, and every read returns detached data. IDs are
 * unique across both asset kinds so a selection cannot resolve ambiguously.
 */
export class AssetRegistry {
  private readonly assets = new Map<AssetId, TavernAsset>()

  /**
   * Register one character or World Book snapshot.
   *
   * @param asset - Normalized asset produced by a parser or authoring adapter.
   * @returns A disposer that removes this registration if it is still current.
   * @throws {@link AssetRegistryError} for blank names, duplicate IDs, invalid versions, or invalid source references.
   */
  register(asset: TavernAsset): () => void {
    validateAsset(asset)
    if (this.assets.has(asset.id)) {
      throw new AssetRegistryError('duplicate-id', `asset id '${asset.id}' is already registered`)
    }
    return this.replace(asset)
  }

  /**
   * Replace a registered asset with the same ID and kind, or register it when
   * the ID is unused. The returned disposer restores the previous snapshot,
   * which lets a durable caller roll back an update after a failed write.
   *
   * @param asset - Normalized asset to install.
   * @returns A stale-safe disposer for the replacement.
   * @throws {@link AssetRegistryError} for invalid assets or a cross-kind ID collision.
   */
  replace(asset: TavernAsset): () => void {
    validateAsset(asset)
    const previous = this.assets.get(asset.id)
    if (previous !== undefined && previous.kind !== asset.kind) {
      throw new AssetRegistryError('duplicate-id', `asset id '${asset.id}' is already registered as ${previous.kind}`)
    }
    const previousSnapshot = previous === undefined ? undefined : cloneAsset(previous)
    const snapshot = cloneAsset(asset)
    this.assets.set(snapshot.id, snapshot)
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.assets.get(snapshot.id) !== snapshot) return
      if (previousSnapshot === undefined) {
        this.assets.delete(snapshot.id)
      } else {
        this.assets.set(snapshot.id, cloneAsset(previousSnapshot))
      }
    }
  }

  /**
   * Remove one registered asset and return a detached snapshot for rollback.
   *
   * @param id - Asset identifier to remove.
   * @returns The removed asset, or `undefined` when the identifier is absent.
   */
  remove(id: AssetId): TavernAsset | undefined {
    const asset = this.assets.get(id)
    if (asset === undefined) return undefined
    const snapshot = cloneAsset(asset)
    this.assets.delete(id)
    return snapshot
  }

  /**
   * Return a registered character by ID.
   *
   * @param id - Character asset ID.
   * @returns A detached character snapshot, or `undefined` when absent or another asset kind owns the ID.
   */
  getCharacter(id: AssetId): CharacterAsset | undefined {
    const asset = this.assets.get(id)
    return asset?.kind === 'character' ? cloneAsset(asset) : undefined
  }

  /**
   * Return a registered World Book by ID.
   *
   * @param id - World Book asset ID.
   * @returns A detached World Book snapshot, or `undefined` when absent or another asset kind owns the ID.
   */
  getWorldInfo(id: AssetId): WorldInfoAsset | undefined {
    const asset = this.assets.get(id)
    return asset?.kind === 'world-info' ? cloneAsset(asset) : undefined
  }

  /**
   * List registered characters in registration order.
   *
   * @returns Detached character snapshots.
   */
  listCharacters(): readonly CharacterAsset[] {
    return [...this.assets.values()]
      .filter((asset): asset is CharacterAsset => asset.kind === 'character')
      .map(cloneCharacterAsset)
  }

  /**
   * List registered World Books in registration order.
   *
   * @returns Detached World Book snapshots.
   */
  listWorldInfo(): readonly WorldInfoAsset[] {
    return [...this.assets.values()]
      .filter((asset): asset is WorldInfoAsset => asset.kind === 'world-info')
      .map(cloneWorldInfoAsset)
  }

  /**
   * Resolve an asset selection and project it into a prompt baseline.
   *
   * @param selection - Character and World Book IDs in desired prompt order.
   * @returns A detached baseline containing source-tracked character sections and World Book candidates.
   * @throws {@link AssetRegistryError} when an ID is missing or repeated in the selection.
   */
  select(selection: AssetSelection): PromptAssetBaseline {
    validateSelection(selection)
    const character = selection.characterId === null
      ? null
      : this.requireCharacter(selection.characterId)
    const worldInfoAssets = selection.worldInfoIds.map(id => this.requireWorldInfo(id))
    return projectPromptAssetBaseline(selection, character, worldInfoAssets)
  }

  /** Resolve a required character or throw a stable not-found error. */
  private requireCharacter(id: AssetId): CharacterAsset {
    const character = this.getCharacter(id)
    if (character === undefined) {
      throw new AssetRegistryError('asset-not-found', `character asset '${id}' was not found`)
    }
    return character
  }

  /** Resolve a required World Book or throw a stable not-found error. */
  private requireWorldInfo(id: AssetId): WorldInfoAsset {
    const worldInfo = this.getWorldInfo(id)
    if (worldInfo === undefined) {
      throw new AssetRegistryError('asset-not-found', `World Book asset '${id}' was not found`)
    }
    return worldInfo
  }
}

/** Validate an asset before it can enter the registry. */
function validateAsset(asset: TavernAsset): void {
  if (asset.id.trim().length === 0) {
    throw new AssetRegistryError('invalid-id', 'asset id must not be empty')
  }
  if (asset.name.trim().length === 0) {
    throw new AssetRegistryError('invalid-name', 'asset name must not be empty')
  }
  if (asset.version.format.trim().length === 0 || !Number.isInteger(asset.version.revision) || asset.version.revision < 0) {
    throw new AssetRegistryError('invalid-version', `asset '${asset.id}' has an invalid version`)
  }
  for (const source of asset.sourceReferences) {
    if (source.kind.trim().length === 0 || source.locator.trim().length === 0) {
      throw new AssetRegistryError('invalid-source-reference', `asset '${asset.id}' has an empty source reference`)
    }
  }
  if (asset.kind === 'world-info') validateWorldInfoEntries(asset)
}

/** Reject duplicate or blank IDs inside one World Book. */
function validateWorldInfoEntries(asset: WorldInfoAsset): void {
  const ids = new Set<AssetId>()
  for (const entry of asset.entries) {
    if (entry.id.trim().length === 0) {
      throw new AssetRegistryError('invalid-id', `World Book '${asset.id}' contains an empty entry id`)
    }
    if (ids.has(entry.id)) {
      throw new AssetRegistryError('duplicate-entry-id', `World Book '${asset.id}' repeats entry id '${entry.id}'`)
    }
    ids.add(entry.id)
  }
}

/** Reject duplicate IDs in the caller's requested selection. */
function validateSelection(selection: AssetSelection): void {
  const ids = new Set<AssetId>()
  for (const id of selection.worldInfoIds) {
    if (ids.has(id) || id === selection.characterId) {
      throw new AssetRegistryError('duplicate-selection-id', `asset id '${id}' is repeated in the selection`)
    }
    ids.add(id)
  }
}

/** Deep-copy a JSON value without retaining caller-owned object references. */
function cloneJsonValue(value: JsonValue): JsonValue {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(cloneJsonValue)
  const object = {} as Record<string, JsonValue>
  for (const [key, nested] of Object.entries(value)) object[key] = cloneJsonValue(nested)
  return object
}

/** Deep-copy the common asset fields and kind-specific nested values. */
function cloneAsset(asset: CharacterAsset): CharacterAsset
function cloneAsset(asset: WorldInfoAsset): WorldInfoAsset
function cloneAsset(asset: TavernAsset): TavernAsset
function cloneAsset(asset: TavernAsset): TavernAsset {
  const common = {
    kind: asset.kind,
    id: asset.id,
    name: asset.name,
    version: { ...asset.version },
    sourceReferences: asset.sourceReferences.map(source => ({ ...source })),
    sourceData: cloneJsonValue(asset.sourceData) as JsonObject,
    extensions: cloneJsonValue(asset.extensions) as JsonObject,
  }
  if (asset.kind === 'character') {
    return {
      ...common,
      kind: 'character',
      description: asset.description,
      personality: asset.personality,
      scenario: asset.scenario,
      firstMessage: asset.firstMessage,
      creatorNotes: asset.creatorNotes,
      messageExamples: asset.messageExamples,
      alternateGreetings: [...asset.alternateGreetings],
      systemPrompt: asset.systemPrompt,
      postHistoryInstructions: asset.postHistoryInstructions,
      characterBook: asset.characterBook === null ? null : cloneWorldInfoAsset(asset.characterBook),
    }
  }
  return {
    ...common,
    kind: 'world-info',
    scanDepth: asset.scanDepth,
    tokenBudget: asset.tokenBudget,
    recursiveScanning: asset.recursiveScanning,
    entries: asset.entries.map(entry => ({
      id: entry.id,
      keys: [...entry.keys],
      secondaryKeys: [...entry.secondaryKeys],
      ...(entry.selective === undefined ? {} : { selective: entry.selective }),
      ...(entry.constant === undefined ? {} : { constant: entry.constant }),
      ...(entry.useRegex === undefined ? {} : { useRegex: entry.useRegex }),
      ...(entry.matchWholeWords === undefined ? {} : { matchWholeWords: entry.matchWholeWords }),
      ...(entry.caseSensitive === undefined ? {} : { caseSensitive: entry.caseSensitive }),
      ...(entry.useProbability === undefined ? {} : { useProbability: entry.useProbability }),
      content: entry.content,
      enabled: entry.enabled,
      position: entry.position,
      depth: entry.depth,
      order: entry.order,
      recursive: entry.recursive,
      probability: entry.probability,
      group: entry.group,
      sticky: entry.sticky,
      cooldown: entry.cooldown,
      extensions: cloneJsonValue(entry.extensions) as JsonObject,
    })),
  }
}

/** Copy one character after a discriminant-specific collection filter. */
function cloneCharacterAsset(asset: CharacterAsset): CharacterAsset {
  return cloneAsset(asset)
}

/** Copy one World Book after a discriminant-specific collection filter. */
function cloneWorldInfoAsset(asset: WorldInfoAsset): WorldInfoAsset {
  return cloneAsset(asset)
}
