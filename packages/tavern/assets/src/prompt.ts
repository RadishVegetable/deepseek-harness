/** Prompt-baseline projection for selected Tavern assets. */

import { AssetRegistryError } from './errors.ts'
import type {
  AssetSelection,
  CharacterAsset,
  PromptAssetBaseline,
  PromptAssetReference,
  PromptCharacterSection,
  PromptWorldInfoEntry,
  WorldInfoAsset,
} from './types.ts'

/**
 * Remove repeated World Books while preserving the first source's provenance.
 *
 * Character Cards may carry an embedded World Book that is also imported as a
 * standalone asset. Repeated entry text must only produce one prompt entry;
 * the baseline references still retain every selected asset.
 *
 * @param assets - Resolved World Books in display or prompt order.
 * @returns World Books with semantically identical contents collapsed.
 */
export function deduplicateWorldInfoAssets(assets: readonly WorldInfoAsset[]): readonly WorldInfoAsset[] {
  const seenEntries = new Set<string>()
  const result: WorldInfoAsset[] = []
  for (const asset of assets) {
    const entries = asset.entries.filter((entry) => {
      const fingerprint = worldInfoEntryFingerprint(entry.content)
      if (seenEntries.has(fingerprint)) return false
      seenEntries.add(fingerprint)
      return true
    })
    if (entries.length === 0 && asset.entries.length > 0) continue
    result.push(entries.length === asset.entries.length ? asset : { ...asset, entries })
  }
  return result
}

/**
 * Project resolved assets into stable prompt inputs without performing activation,
 * retrieval, token budgeting, or model-request assembly.
 *
 * @param selection - IDs and ordering requested by the caller.
 * @param character - Character resolved for `selection.characterId`, or `null`.
 * @param worldInfoAssets - World Books resolved in `selection.worldInfoIds` order.
 * @returns A detached, source-tracked prompt baseline.
 * @throws {@link AssetRegistryError} when the resolved assets do not match the selection.
 */
export function projectPromptAssetBaseline(
  selection: AssetSelection,
  character: CharacterAsset | null,
  worldInfoAssets: readonly WorldInfoAsset[],
): PromptAssetBaseline {
  if (character !== null && character.id !== selection.characterId) {
    throw new AssetRegistryError('invalid-selection', 'resolved character does not match the selection')
  }
  if (selection.characterId === null && character !== null) {
    throw new AssetRegistryError('invalid-selection', 'selection has no character but a character was resolved')
  }
  if (worldInfoAssets.length !== selection.worldInfoIds.length) {
    throw new AssetRegistryError('invalid-selection', 'resolved World Books do not match the selection')
  }
  for (const [index, asset] of worldInfoAssets.entries()) {
    if (asset.id !== selection.worldInfoIds[index]) {
      throw new AssetRegistryError('invalid-selection', 'resolved World Books do not match selection order')
    }
  }

  const selectedWorldInfoAssets = [
    ...(character?.characterBook === null || character?.characterBook === undefined ? [] : [character.characterBook]),
    ...worldInfoAssets,
  ]
  const references: PromptAssetReference[] = []
  if (character !== null) {
    references.push({ kind: 'character', assetId: character.id, version: { ...character.version } })
    if (character.characterBook !== null) {
      references.push({ kind: 'world-info', assetId: character.characterBook.id, version: { ...character.characterBook.version } })
    }
  }
  references.push(...worldInfoAssets.map(asset => ({
    kind: 'world-info' as const,
    assetId: asset.id,
    version: { ...asset.version },
  })))

  return {
    selection: {
      characterId: selection.characterId,
      worldInfoIds: [...selection.worldInfoIds],
    },
    references,
    characterSections: character === null ? [] : projectCharacterSections(character),
    worldInfoEntries: deduplicateWorldInfoAssets(selectedWorldInfoAssets).flatMap(projectWorldInfoEntries),
  }
}

function worldInfoEntryFingerprint(content: string): string {
  return content.replace(/\r\n?/g, '\n').trim()
}

/** Project non-empty character fields in the stable order used by the baseline. */
function projectCharacterSections(asset: CharacterAsset): PromptCharacterSection[] {
  const sections: PromptCharacterSection[] = []
  const fields: readonly { field: PromptCharacterSection['field']; text: string; id: string }[] = [
    { field: 'description', text: asset.description, id: 'character.description' },
    { field: 'personality', text: asset.personality, id: 'character.personality' },
    { field: 'scenario', text: asset.scenario, id: 'character.scenario' },
    { field: 'first-message', text: asset.firstMessage, id: 'character.first-message' },
    { field: 'creator-notes', text: asset.creatorNotes, id: 'character.creator-notes' },
    { field: 'message-examples', text: asset.messageExamples, id: 'character.message-examples' },
    { field: 'system-prompt', text: asset.systemPrompt, id: 'character.system-prompt' },
    { field: 'post-history-instructions', text: asset.postHistoryInstructions, id: 'character.post-history-instructions' },
  ]
  for (const field of fields) {
    if (field.text.trim().length > 0) {
      sections.push({
        id: field.id,
        field: field.field,
        text: field.text,
        sourceAssetId: asset.id,
      })
    }
  }
  for (const [index, text] of asset.alternateGreetings.entries()) {
    if (text.trim().length > 0) {
      sections.push({
        id: `character.alternate-greeting.${index + 1}`,
        field: 'alternate-greeting',
        text,
        sourceAssetId: asset.id,
      })
    }
  }
  return sections
}

/** Project World Book entries without deciding which entries are active. */
function projectWorldInfoEntries(asset: WorldInfoAsset): PromptWorldInfoEntry[] {
  return asset.entries.map(entry => ({
    id: entry.id,
    sourceAssetId: asset.id,
    keys: [...entry.keys],
    secondaryKeys: [...entry.secondaryKeys],
    selective: entry.selective ?? false,
    constant: entry.constant ?? false,
    useRegex: entry.useRegex ?? false,
    matchWholeWords: entry.matchWholeWords ?? true,
    caseSensitive: entry.caseSensitive ?? false,
    useProbability: entry.useProbability ?? false,
    content: entry.content,
    enabled: entry.enabled,
    scanDepth: asset.scanDepth,
    tokenBudget: asset.tokenBudget,
    recursiveScanning: asset.recursiveScanning,
    position: entry.position,
    depth: entry.depth,
    order: entry.order,
    recursive: entry.recursive,
    probability: entry.probability,
    group: entry.group,
    sticky: entry.sticky,
    cooldown: entry.cooldown,
  }))
}
