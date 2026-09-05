/** Deterministic asset cleaning fallback and the model-cleaning seam. */

import type { CharacterAsset, TavernAsset, WorldInfoAsset } from '@deepseek-ai/dsh-tavern-assets/types'
import { collectCharacterEntries, parseLabeledLines, slug } from '@deepseek-ai/dsh-tavern-shared'

/** A source-tracked canonical character field. */
export interface CanonicalCharacterField {
  readonly label: string
  readonly value: string
  readonly sourceEntryId?: string
}

/** A source-tracked canonical World Book entry. */
export interface CanonicalWorldEntry {
  readonly theme: string
  readonly text: string
  readonly suggestedKeys: readonly string[]
  readonly sourceEntryId: string
  readonly role: 'npc' | 'world' | 'protagonist'
}

/** Canonical, replaceable asset view retained beside the original payload. */
export interface CanonicalAssetView {
  readonly assetId: string
  readonly kind: TavernAsset['kind']
  readonly characterFields: readonly CanonicalCharacterField[]
  readonly protagonistFields: readonly CanonicalCharacterField[]
  readonly worldEntries: readonly CanonicalWorldEntry[]
  readonly openingPrompt?: string
  readonly greeting?: string
  readonly noise: readonly { readonly sourceEntryId: string; readonly reason: 'duplicate' | 'unclassifiable' | 'stale' }[]
  readonly uncleaned: boolean
}

/**
 * Clean an imported asset without blocking on a model route. The deterministic
 * result is intentionally conservative and source-tracked; a future model
 * cleaner may replace it while the original JSON remains authoritative.
 * @param asset - Parsed normalized Character Card or World Book.
 * @returns A canonical view safe to preview and manually adjust.
 */
export function cleanTavernAsset(asset: TavernAsset): CanonicalAssetView {
  return asset.kind === 'character' ? cleanCharacter(asset) : cleanWorldInfo(asset)
}

function cleanCharacter(asset: CharacterAsset): CanonicalAssetView {
  const characterFields: CanonicalCharacterField[] = []
  for (const [label, value] of [
    ['Description', asset.description],
    ['Personality', asset.personality],
    ['Scenario', asset.scenario],
    ['Creator notes', asset.creatorNotes],
    ['Message examples', asset.messageExamples],
    ['System prompt', asset.systemPrompt],
    ['Post-history instructions', asset.postHistoryInstructions],
  ] as const) {
    if (value.trim().length > 0) characterFields.push({ label, value })
  }
  const worldEntries = asset.characterBook === null ? [] : cleanWorldEntries(asset.characterBook, 'world')
  return {
    assetId: String(asset.id),
    kind: 'character',
    characterFields,
    protagonistFields: characterFields,
    worldEntries,
    ...(asset.systemPrompt.trim().length === 0 ? {} : { openingPrompt: asset.systemPrompt }),
    ...(asset.firstMessage.trim().length === 0 ? {} : { greeting: asset.firstMessage }),
    noise: [],
    uncleaned: true,
  }
}

function cleanWorldInfo(asset: WorldInfoAsset): CanonicalAssetView {
  return {
    assetId: String(asset.id),
    kind: 'world-info',
    characterFields: [],
    protagonistFields: [],
    worldEntries: cleanWorldEntries(asset, 'world'),
    noise: [],
    uncleaned: true,
  }
}

function cleanWorldEntries(asset: WorldInfoAsset, defaultRole: 'world' | 'npc'): readonly CanonicalWorldEntry[] {
  const characterEntries = new Set(collectCharacterEntries(asset.entries).map(match => String(match.entry.id)))
  return asset.entries
    .filter(entry => entry.enabled && entry.content.trim().length > 0)
    .map((entry) => {
      const first = parseLabeledLines(entry.content.replace(/：/gu, ':'))[0]
      const theme = first?.label ?? entry.keys[0] ?? 'world'
      const role = characterEntries.has(String(entry.id)) ? 'npc' : defaultRole
      const domain = role === 'npc' ? 'person' : 'world'
      const keySlug = slug(entry.keys[0] ?? theme, 'entry')
      return {
        theme,
        text: entry.content.trim(),
        suggestedKeys: [`${domain}:${keySlug}.${slug(theme, 'detail')}`],
        sourceEntryId: String(entry.id),
        role,
      }
    })
}
