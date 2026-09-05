import { describe, expect, it } from 'vitest'
import {
  AssetRegistry,
  AssetRegistryError,
  createAssetId,
  serializeCharacterAsset,
  serializeWorldInfoAsset,
} from '../src/index.ts'
import type {
  CharacterAsset,
  WorldInfoAsset,
} from '../src/index.ts'

const source = {
  kind: 'file',
  locator: 'cards/aria.json',
  mediaType: 'application/json',
  digest: 'sha256:card',
}

function character(id: string, name = 'Aria'): CharacterAsset {
  return {
    kind: 'character',
    id: createAssetId(id),
    name,
    version: { format: 'character-card-v2', revision: 1 },
    sourceReferences: [source],
    sourceData: { unknownField: { preserved: true } },
    description: 'A careful guide.',
    personality: 'Patient and direct.',
    scenario: 'The pair meets in a quiet archive.',
    firstMessage: 'Welcome to the archive.',
    creatorNotes: 'Keep this note.',
    messageExamples: '',
    alternateGreetings: ['The archive is closed tonight.'],
    systemPrompt: 'Stay in character.',
    postHistoryInstructions: 'Keep the answer focused.',
    characterBook: null,
    extensions: { vendor: 'example' },
  }
}

function worldInfo(id: string, name = 'Archive'): WorldInfoAsset {
  return {
    kind: 'world-info',
    id: createAssetId(id),
    name,
    version: { format: 'world-info-v2', revision: 1 },
    sourceReferences: [{ ...source, locator: 'world/archive.json', digest: 'sha256:world' }],
    sourceData: { originalOrder: ['entry-1'] },
    scanDepth: null,
    tokenBudget: null,
    recursiveScanning: true,
    entries: [{
      id: createAssetId(`${id}.entry-1`),
      keys: ['archive'],
      secondaryKeys: ['keeper'],
      content: 'The archive keeps records of forgotten treaties.',
      enabled: true,
      position: 'at-depth',
      depth: 2,
      order: 10,
      recursive: true,
      probability: 100,
      group: null,
      sticky: null,
      cooldown: null,
      extensions: { originalUid: 7 },
    }],
    extensions: { exportedBy: 'fixture' },
  }
}

describe('createAssetId', () => {
  it('retains non-blank IDs without normalizing them', () => {
    expect(createAssetId(' aria ')).toBe(' aria ')
  })

  it('rejects blank IDs', () => {
    expect(() => createAssetId('  ')).toThrow(AssetRegistryError)
    expect(() => createAssetId('')).toThrow(/must not be empty/)
  })
})

describe('AssetRegistry', () => {
  it('registers, lists, resolves, and disposes both asset kinds', () => {
    const registry = new AssetRegistry()
    const disposeCharacter = registry.register(character('character.aria'))
    registry.register(worldInfo('world.archive'))

    expect(registry.listCharacters().map(asset => asset.id)).toEqual(['character.aria'])
    expect(registry.listWorldInfo().map(asset => asset.id)).toEqual(['world.archive'])
    expect(registry.getCharacter(createAssetId('character.aria'))?.name).toBe('Aria')
    expect(registry.getWorldInfo(createAssetId('world.archive'))?.name).toBe('Archive')

    disposeCharacter()
    expect(registry.getCharacter(createAssetId('character.aria'))).toBeUndefined()
    disposeCharacter()
  })

  it('rejects duplicate IDs across character and World Book kinds', () => {
    const registry = new AssetRegistry()
    registry.register(character('shared'))
    expect(() => registry.register(worldInfo('shared'))).toThrow(
      expect.objectContaining({ code: 'duplicate-id' }),
    )
  })

  it('replaces same-kind IDs with a rollback-safe disposer', () => {
    const registry = new AssetRegistry()
    const original = character('shared', 'Original')
    registry.register(original)

    const rollback = registry.replace(character('shared', 'Updated'))
    expect(registry.getCharacter(createAssetId('shared'))?.name).toBe('Updated')

    rollback()
    expect(registry.getCharacter(createAssetId('shared'))?.name).toBe('Original')
  })

  it('does not let a stale replacement disposer remove a later update', () => {
    const registry = new AssetRegistry()
    registry.register(character('shared', 'Original'))
    const stale = registry.replace(character('shared', 'First update'))
    registry.replace(character('shared', 'Second update'))

    stale()
    expect(registry.getCharacter(createAssetId('shared'))?.name).toBe('Second update')
  })

  it('removes an asset and returns a detached rollback snapshot', () => {
    const registry = new AssetRegistry()
    registry.register(character('removable'))

    const removed = registry.remove(createAssetId('removable'))

    expect(removed?.id).toBe('removable')
    expect(registry.getCharacter(createAssetId('removable'))).toBeUndefined()
    if (removed === undefined) throw new Error('asset was not removed')
    registry.replace(removed)
    expect(registry.getCharacter(createAssetId('removable'))?.name).toBe('Aria')
    expect(registry.remove(createAssetId('missing'))).toBeUndefined()
  })

  it('rejects replacement across asset kinds', () => {
    const registry = new AssetRegistry()
    registry.register(character('shared'))
    expect(() => registry.replace(worldInfo('shared'))).toThrow(
      expect.objectContaining({ code: 'duplicate-id' }),
    )
  })

  it('rejects blank names and malformed source metadata', () => {
    const registry = new AssetRegistry()
    expect(() => registry.register(character('blank-name', '  '))).toThrow(
      expect.objectContaining({ code: 'invalid-name' }),
    )
    expect(() => registry.register({
      ...character('bad-source'),
      sourceReferences: [{ ...source, locator: '  ' }],
    })).toThrow(expect.objectContaining({ code: 'invalid-source-reference' }))
  })

  it('rejects duplicate World Book entry IDs', () => {
    const asset = worldInfo('world.duplicate')
    const entry = asset.entries[0]!
    const registry = new AssetRegistry()
    expect(() => registry.register({
      ...asset,
      entries: [entry, { ...entry }],
    })).toThrow(expect.objectContaining({ code: 'duplicate-entry-id' }))
  })

  it('keeps registered snapshots detached from caller-owned arrays and objects', () => {
    const asset = character('detached')
    const registry = new AssetRegistry()
    registry.register(asset)

    expect(registry.getCharacter(asset.id)).not.toBe(asset)
    expect(registry.getCharacter(asset.id)?.sourceReferences).not.toBe(asset.sourceReferences)
    expect(registry.getCharacter(asset.id)?.sourceData).not.toBe(asset.sourceData)
    expect(registry.getCharacter(asset.id)?.sourceData).toEqual(asset.sourceData)
  })

  it('resolves a selection into a source-tracked prompt baseline', () => {
    const registry = new AssetRegistry()
    registry.register(character('character.aria'))
    registry.register(worldInfo('world.archive'))

    const baseline = registry.select({
      characterId: createAssetId('character.aria'),
      worldInfoIds: [createAssetId('world.archive')],
    })

    expect(baseline.references).toEqual([
      {
        kind: 'character',
        assetId: 'character.aria',
        version: { format: 'character-card-v2', revision: 1 },
      },
      {
        kind: 'world-info',
        assetId: 'world.archive',
        version: { format: 'world-info-v2', revision: 1 },
      },
    ])
    expect(baseline.characterSections.map(section => section.id)).toEqual([
      'character.description',
      'character.personality',
      'character.scenario',
      'character.first-message',
      'character.creator-notes',
      'character.system-prompt',
      'character.post-history-instructions',
      'character.alternate-greeting.1',
    ])
    expect(baseline.worldInfoEntries[0]).toMatchObject({
      id: 'world.archive.entry-1',
      sourceAssetId: 'world.archive',
      keys: ['archive'],
      secondaryKeys: ['keeper'],
      content: 'The archive keeps records of forgotten treaties.',
    })
  })

  it('collapses a standalone copy of an embedded Character Card World Book', () => {
    const embedded = worldInfo('embedded-book', 'Embedded Book')
    const card = {
      ...character('character.with-book'),
      characterBook: { ...embedded, id: createAssetId('character.with-book.character-book') },
    }
    const registry = new AssetRegistry()
    registry.register(card)
    registry.register(worldInfo('standalone-copy', 'Standalone Copy'))

    const baseline = registry.select({
      characterId: card.id,
      worldInfoIds: [createAssetId('standalone-copy')],
    })

    expect(baseline.references).toHaveLength(3)
    expect(baseline.worldInfoEntries).toHaveLength(1)
    expect(baseline.worldInfoEntries[0]?.sourceAssetId).toBe('character.with-book.character-book')
  })

  it('allows a characterless selection and reports missing or repeated assets', () => {
    const registry = new AssetRegistry()
    registry.register(worldInfo('world.archive'))
    expect(registry.select({ characterId: null, worldInfoIds: [] }).characterSections).toEqual([])
    expect(() => registry.select({ characterId: createAssetId('missing'), worldInfoIds: [] }))
      .toThrow(expect.objectContaining({ code: 'asset-not-found' }))
    expect(() => registry.select({
      characterId: null,
      worldInfoIds: [createAssetId('world.archive'), createAssetId('world.archive')],
    })).toThrow(expect.objectContaining({ code: 'duplicate-selection-id' }))
  })
})

describe('asset JSON serializers', () => {
  it('writes updated Character Card fields while retaining source fields', () => {
    const asset = {
      ...character('aria'),
      name: 'Updated Aria',
      description: 'A changed description.',
      sourceData: {
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: {
          name: 'Aria',
          description: 'Original description.',
          first_mes: 'Hello.',
          creator_notes: 'Keep this note.',
          extensions: { source: true },
          unknown_data: 'retained',
        },
        unknown_top_level: 7,
      },
    }

    const exported = JSON.parse(serializeCharacterAsset(asset)) as Record<string, unknown>
    expect(exported.unknown_top_level).toBe(7)
    expect(exported.data).toMatchObject({
      name: 'Updated Aria',
      description: 'A changed description.',
      creator_notes: 'Keep this note.',
      unknown_data: 'retained',
    })
  })

  it('writes updated World Info entries in both YMLv2 containers', () => {
    const asset = worldInfo('archive')
    const exported = JSON.parse(serializeWorldInfoAsset({
      ...asset,
      name: 'Updated Archive',
      entries: [{ ...asset.entries[0]!, content: 'Updated treaty record.' }],
      sourceData: {
        entries: {
          '1': {
            key: ['archive'],
            content: 'Old root record.',
            disable: false,
            order: 10,
            unknown_root: true,
          },
        },
        originalData: {
          name: 'Archive',
          entries: [{ keys: ['archive'], content: 'Old original record.', unknown_original: true }],
        },
        unknown_world: 'retained',
      },
    })) as Record<string, unknown>

    expect(exported.name).toBe('Updated Archive')
    expect(exported.unknown_world).toBe('retained')
    expect((exported.entries as Record<string, Record<string, unknown>>)['1']).toMatchObject({
      key: ['archive'],
      content: 'Updated treaty record.',
      unknown_root: true,
    })
    expect((exported.originalData as Record<string, unknown>).entries).toEqual([
      expect.objectContaining({ content: 'Updated treaty record.', unknown_original: true }),
    ])
  })
})
