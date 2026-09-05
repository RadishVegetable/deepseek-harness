import { describe, expect, it } from 'vitest'
import {
  BruteForceMemoryIndex,
  combineMemoryHybridScore,
  MemoryIndex,
  compareFactFreshness,
  cosineSimilarity,
  ingestMemoryExtraction,
  isMemoryFactVisible,
  parseMemoryExtractionOutput,
  parseMemoryExtractionOutputStrict,
  projectMemoryFacts,
  rankMemoryIndexHits,
  renderMemoryInjection,
  scoreMemoryIndexRow,
  splitCompositeFact,
} from '../src/index.ts'
import type {
  MemoryFactEvent,
  MemoryFactRecord,
  MemoryIndexRow,
  MemoryRosterEntry,
} from '../src/types.ts'

function record(seq: number, data: Partial<MemoryFactEvent> & Pick<MemoryFactEvent, 'factId' | 'text'>): MemoryFactRecord {
  return {
    seq,
    data: {
      branch: 'main',
      target: 'person',
      personId: 'person:alice',
      operation: 'add',
      authority: 'observed',
      kind: 'soft',
      accepted: true,
      ...data,
    },
  }
}

const roster: readonly MemoryRosterEntry[] = [{
  personId: 'person:alice',
  displayName: 'Alice',
  aliases: [],
  subjectKeys: ['person:alice.appearance'],
}]

describe('Tavern memory freshness fold', () => {
  it('keeps an older explicit value beside a newer inferred disagreement', () => {
    const projection = projectMemoryFacts([
      record(1, {
        factId: 'f:old',
        text: 'Alice has red hair',
        subjectKey: 'person:alice.appearance',
        explicit: true,
      }),
      record(2, {
        factId: 'f:new',
        text: 'Alice has blue hair',
        subjectKey: 'person:alice.appearance',
        explicit: false,
      }),
    ])

    expect(projection.people['person:alice']).toHaveLength(2)
    expect(projection.conflicts).toHaveLength(1)
    expect(projection.conflicts[0]?.previousExplicit).toBe(true)
  })

  it('lets a later user correction win and treats equal text as a duplicate', () => {
    const projection = projectMemoryFacts([
      record(1, { factId: 'f:old', text: 'Alice is in the north', subjectKey: 'person:alice.location' }),
      record(2, {
        factId: 'f:duplicate',
        text: 'Alice is in the north',
        subjectKey: 'person:alice.location',
      }),
      record(3, {
        factId: 'f:user',
        text: 'Alice is in the south',
        subjectKey: 'person:alice.location',
        authority: 'user',
        explicit: true,
      }),
    ])

    expect(projection.people['person:alice']?.map(fact => fact.text)).toEqual(['Alice is in the south'])
    expect(compareFactFreshness(
      { text: 'old', authority: 'user' },
      { text: 'new', authority: 'observed', explicit: false },
    )).toBe('protected-conflict')
  })

  it('does not force unkeyed facts into one dimension and applies fork visibility', () => {
    const records = [
      record(0, { factId: 'f:seed', text: 'seed', branch: 'parent' }),
      record(5, { factId: 'f:tail', text: 'replaced turn', branch: 'parent' }),
      record(6, { factId: 'f:child', text: 'child turn', branch: 'child' }),
    ]
    const projection = projectMemoryFacts(records)
    expect(projection.people['person:alice']).toHaveLength(3)
    expect(isMemoryFactVisible(records[0]!, { currentBranch: 'child', seedLength: 5 })).toBe(true)
    expect(isMemoryFactVisible(records[1]!, { currentBranch: 'child', seedLength: 5 })).toBe(false)
    expect(isMemoryFactVisible(records[2]!, { currentBranch: 'child', seedLength: 5 })).toBe(true)
  })
})

describe('Tavern memory keys and extraction', () => {
  it('splits composite facts without changing their atomic text', () => {
    expect(splitCompositeFact('外观：黑发 + 状态：受伤；位置：城门')).toEqual([
      '外观：黑发',
      '状态：受伤',
      '位置：城门',
    ])
  })

  it('writes an extraction once and leaves the cursor monotonic on retry', () => {
    const first = ingestMemoryExtraction({
      sessionId: 'session-1',
      branch: 'main',
      extractionId: 'extract-1',
      span: { start: 0, end: 2 },
      atoms: [{
        op: 'add',
        target: 'person',
        personId: 'person:alice',
        subjectKey: 'person:alice.appearance',
        text: 'Alice has red hair',
        explicit: false,
        anchorTurn: 1,
      }],
      roster,
      existing: [],
      cursor: -1,
      nextSeq: 0,
    })
    const retry = ingestMemoryExtraction({
      sessionId: 'session-1',
      branch: 'main',
      extractionId: 'extract-1',
      span: { start: 0, end: 2 },
      atoms: [],
      roster,
      existing: first.records,
      cursor: first.cursor,
      nextSeq: 1,
    })

    expect(first.events[0]).toMatchObject({ extractionId: 'extract-1', explicit: false, subjectKey: 'person:alice.appearance' })
    expect(first.cursor).toBe(2)
    expect(retry.skipped).toBe(true)
    expect(retry.events).toEqual([])
    expect(retry.cursor).toBe(2)
  })

  it('rejects an extraction atom for a person absent from the roster', () => {
    const result = ingestMemoryExtraction({
      sessionId: 'session-1',
      branch: 'main',
      extractionId: 'extract-2',
      span: { start: 2, end: 4 },
      atoms: [{
        op: 'add',
        target: 'person',
        personId: 'person:unknown',
        text: 'unknown',
        explicit: false,
        anchorTurn: 2,
      }],
      roster,
      existing: [],
      cursor: 0,
    })

    expect(result.events).toEqual([])
    expect(result.rejected[0]).toContain('unknown person')
  })
})

describe('Tavern memory prompt and parser', () => {
  it('accepts fenced strict JSON and rejects unknown fields', () => {
    const valid = parseMemoryExtractionOutputStrict('```json\n{"atoms":[{"op":"add","target":"person","personId":"person:alice","subjectKey":"person:alice.appearance","text":"黑发","explicit":false,"anchorTurn":1}],"rosterUpdates":[]}\n```')
    expect(valid.ok).toBe(true)
    expect(parseMemoryExtractionOutput('{"atoms":[{"op":"add","target":"world","text":"x","explicit":false,"anchorTurn":1,"unknown":true}]}')).toBeUndefined()
  })

  it('rejects malformed keys and world atoms carrying person ids', () => {
    expect(parseMemoryExtractionOutputStrict('{"atoms":[{"op":"add","target":"world","personId":"person:alice","text":"x","explicit":false,"anchorTurn":1}]}')).toMatchObject({ ok: false })
    expect(parseMemoryExtractionOutputStrict('{"atoms":[{"op":"add","target":"person","personId":"person:alice","subjectKey":"world:earth.location","text":"x","explicit":false,"anchorTurn":1}]}')).toMatchObject({ ok: false })
  })
})

describe('Tavern memory vector index', () => {
  it('ranks vectors, applies filters, and keeps rows detached', () => {
    const index = new MemoryIndex()
    const rows: MemoryIndexRow[] = [
      { sessionId: 'session-1', seq: 1, kind: 'fact', originId: 'f:1', personId: 'person:alice', content: 'red hair', embedding: [1, 0], active: true },
      { sessionId: 'session-1', seq: 2, kind: 'fact', originId: 'f:2', personId: 'person:bob', content: 'blue eyes', embedding: [0, 1], active: true },
      { sessionId: 'session-1', seq: 3, kind: 'fact', originId: 'f:3', content: 'inactive', embedding: [1, 0], active: false },
    ]
    index.upsertMany(rows)
    const hits = index.query({ sessionId: 'session-1', embedding: [1, 0], limit: 1 })
    expect(hits[0]?.row.originId).toBe('f:1')
    expect(index.query({ sessionId: 'session-1', personId: 'person:bob', text: 'blue' })).toHaveLength(1)
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1)
    expect(BruteForceMemoryIndex).toBe(MemoryIndex)
  })

  it('ranks lexical and cosine matches through one deterministic hybrid score', () => {
    const index = new MemoryIndex()
    index.upsertMany([
      { sessionId: 'session-1', seq: 1, kind: 'fact', originId: 'f:lexical', content: 'gate open', embedding: [0, 1], active: true },
      { sessionId: 'session-1', seq: 2, kind: 'fact', originId: 'f:vector', content: 'barrier secured', embedding: [1, 0], active: true },
      { sessionId: 'session-1', seq: 3, kind: 'fact', originId: 'f:both', content: 'gate closed', embedding: [1, 0], active: true },
    ])

    const hits = index.query({ sessionId: 'session-1', text: 'gate closed', embedding: [1, 0] })
    expect(hits.map(hit => hit.row.originId)).toEqual(['f:both', 'f:vector', 'f:lexical'])
    expect(hits[0]).toMatchObject({ lexicalScore: 1, cosineScore: 1, score: 1 })
    expect(hits[1]).toMatchObject({ lexicalScore: 0, cosineScore: 1, score: 1 })
    expect(scoreMemoryIndexRow('gate', [1, 0], { content: 'gate', embedding: [0, 1] })).toEqual({
      lexical: 1,
      cosine: 0,
      score: 1,
    })
    expect(combineMemoryHybridScore(0.25, 0.75)).toBe(0.75)
    expect(rankMemoryIndexHits(hits, 2).map(hit => hit.row.originId)).toEqual(['f:both', 'f:vector'])
  })
})

describe('Tavern memory injection', () => {
  it('renders deterministically and removes facts already in current context', () => {
    const projection = projectMemoryFacts([
      record(1, { factId: 'f:1', text: 'Alice has red hair', subjectKey: 'person:alice.appearance' }),
      record(2, { factId: 'f:2', text: 'The gate is closed', subjectKey: 'world:city.gate' }),
    ])
    const input = {
      staticPersona: 'You are the narrator.',
      playerIdentity: 'A traveler',
      projection,
      currentFactIds: ['f:1'],
      prefetched: projection.world,
      openThreads: ['Find the missing key'],
    }
    const first = renderMemoryInjection(input)
    const second = renderMemoryInjection(input)
    expect(first).toEqual(second)
    expect(first.content).not.toContain('Alice has red hair')
    expect(first.content).toContain('The gate is closed')
    expect(first.content).toContain('Find the missing key')
    expect(first.factSeqs).toEqual([2])
    expect(renderMemoryInjection({ ...input, maxCharacters: 24 }).content.length).toBeLessThanOrEqual(24)
  })

  it('applies injection limits and canonicalizes aliased subject keys', () => {
    const projection = projectMemoryFacts([
      record(1, { factId: 'f:bob', personId: 'person:bob', text: 'Bob has blue eyes', subjectKey: 'person:bob.appearance' }),
      record(2, { factId: 'f:gate', target: 'world', text: 'The gate is open', subjectKey: 'world:city.gate' }),
      record(3, { factId: 'f:alice', text: 'Alice has red hair', subjectKey: 'person:alice.appearance:hair' }),
    ])
    const snapshot = renderMemoryInjection({
      projection,
      prefetched: projection.world,
      subjectKeyAliases: [{ alias: 'person:alice.appearance:hair', canonical: 'person:alice.appearance.hair-color' }],
    }, { activePeople: 1, activeFacts: 1, prefetchTopK: 1 })

    expect(snapshot.factSeqs).toEqual([2, 3])
    expect(snapshot.content).toContain('person:alice / appearance.hair')
    expect(snapshot.content).toContain('The gate is open')
    expect(snapshot.content).not.toContain('Bob has blue eyes')
    expect(snapshot.content).not.toContain('appearance:hair')
  })
})
