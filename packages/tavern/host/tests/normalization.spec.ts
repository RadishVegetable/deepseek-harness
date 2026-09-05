import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { TavernAssetHost } from '../src/index.ts'
import {
  bootstrapJourney,
  normalizeJourney,
  normalizeJourneyDeterministic,
} from '../src/normalization.ts'
import type { TavernJourneySelection } from '../src/types.ts'

function selection(): TavernJourneySelection {
  const host = new TavernAssetHost()
  const character = host.importCharacter({
    spec: 'chara_card_v2',
    data: { name: 'Anchor', description: 'A patient archivist.' },
  }, { id: 'normalization-card' }).asset
  const world = host.importWorldInfo({
    name: 'People',
    entries: {
      medie: {
        uid: 1,
        key: ['Medie'],
        content: 'Name: Medie\nType: character\nRole: secretary\n秘密: Keeps the lower archive key.',
      },
      place: {
        uid: 2,
        key: ['archive'],
        content: '地理: The lower archive is beneath the eastern hall.',
      },
    },
  }, { id: 'normalization-world' }).asset
  const assetSelection = { characterId: character.id, worldInfoIds: [world.id] }
  return {
    selection: assetSelection,
    baseline: host.select(assetSelection),
    character,
    worldInfo: [world],
    characterName: character.name,
    worldInfoNames: [world.name],
  }
}

function agentThatFailsModel(): Agent {
  const stream = async function* (): AsyncIterable<never> {
    throw new Error('normalizer unavailable')
  }
  return {
    options: { provider: 'mock', model: 'mock' },
    session: { id: 'normalization-session', requestHeader: () => undefined },
    ctx: { llm: { listProviders: () => [{ id: 'mock', name: 'mock' }], stream } },
  } as unknown as Agent
}

function agentWithoutModelRoute(): Agent {
  const stream = async function* (): AsyncIterable<never> {
    throw new Error('normalizer must not be called without a route')
  }
  return {
    options: { provider: 'missing', model: 'missing' },
    session: { id: 'normalization-no-route', requestHeader: () => undefined },
    ctx: { llm: { listProviders: () => [], stream } },
  } as unknown as Agent
}

describe('Tavern Journey normalization', () => {
  it('deterministically converts card and character World Book entries to sourced facts', () => {
    const result = normalizeJourneyDeterministic(selection())

    expect(result.origin).toBe('heuristic')
    expect(result.facts.some(fact => fact.sourceAssetId === 'normalization-card' && fact.target === 'person')).toBe(true)
    expect(result.facts.find(fact => fact.personId === 'person:medie' && fact.label === 'Type')).toMatchObject({
      sourceAssetId: 'normalization-world',
      sourceEntryId: 'normalization-world.entry-1',
      target: 'person',
    })
    expect(result.facts.find(fact => fact.label === '地理')).toMatchObject({
      target: 'world',
      sourceAssetId: 'normalization-world',
      sourceEntryId: 'normalization-world.entry-2',
    })
  })

  it('falls back after a model failure and emits authored bootstrap events', async () => {
    const chosen = selection()
    const normalized = await normalizeJourney(agentThatFailsModel(), chosen)
    const bootstrapped = await bootstrapJourney(agentThatFailsModel(), chosen, { branch: 'journey-bootstrap' })

    expect(normalized.origin).toBe('heuristic')
    expect(normalized.facts.length).toBeGreaterThan(0)
    expect(bootstrapped.factEvents).toHaveLength(bootstrapped.facts.length)
    expect(bootstrapped.factEvents.every(event => event.authority === 'authored-asset' && event.accepted)).toBe(true)
    expect(bootstrapped.factEvents.every(event => event.sourceAssetId !== undefined)).toBe(true)
    expect(bootstrapped.factEvents.find(event => event.personId === 'person:medie')).toMatchObject({
      sourceEntryId: 'normalization-world.entry-1',
      kind: 'soft',
    })
  })

  it('skips the model normalizer when its provider route is not registered', async () => {
    const result = await normalizeJourney(agentWithoutModelRoute(), selection())

    expect(result.origin).toBe('heuristic')
    expect(result.facts.length).toBeGreaterThan(0)
  })
})
