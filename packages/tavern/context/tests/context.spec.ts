import { describe, expect, it } from 'vitest'
import {
  compileContext,
  matchWorldInfo,
  type ContextSourceRecord,
  type NormalizedWorldInfoEntry,
  type Observer,
} from '../src/index.ts'

const alice: Observer = { kind: 'character', id: 'alice' }

function source(
  key: string,
  text: string,
  options: Partial<ContextSourceRecord> = {},
): ContextSourceRecord {
  return {
    key,
    text,
    stability: 'dynamic',
    observer: { kind: 'all' },
    visibility: 'public',
    authority: 'public',
    branch: { kind: 'all' },
    validity: { status: 'valid' },
    provenance: { kind: 'test', id: key },
    priority: 0,
    ...options,
  }
}

function worldEntry(
  record: ContextSourceRecord,
  keys: readonly string[],
  secondaryKeys: readonly string[] = [],
): NormalizedWorldInfoEntry {
  return { source: record, keys, secondaryKeys }
}

describe('compileContext', () => {
  it('filters private, gm-only, other-branch, invalid, and unauthorized records for a character', () => {
    const result = compileContext({
      observer: alice,
      branch: 'main',
      sources: [
        source('public', 'public fact'),
        source('private-bob', 'bob secret', {
          observer: { kind: 'specific', observer: { kind: 'character', id: 'bob' } },
          visibility: 'private',
          authority: 'character',
        }),
        source('gm-plan', 'gm plan', { visibility: 'gm-only', authority: 'gm' }),
        source('other-branch', 'alternate fact', { branch: { kind: 'branch', id: 'alternate' } }),
        source('invalid', 'revoked fact', { validity: { status: 'invalid', reason: 'revoked' } }),
        source('gm-authority', 'authority fact', { authority: 'gm' }),
      ],
    })

    expect(result.stablePrefix).toHaveLength(0)
    expect(result.dynamicSuffix.map(record => record.key)).toEqual(['public'])
    expect(result.ledger.find(decision => decision.key === 'private-bob')).toMatchObject({
      outcome: 'excluded',
      reason: 'observer',
    })
    expect(result.ledger.find(decision => decision.key === 'gm-plan')).toMatchObject({
      outcome: 'excluded',
      reason: 'visibility',
    })
    expect(result.ledger.find(decision => decision.key === 'other-branch')).toMatchObject({
      outcome: 'excluded',
      reason: 'branch',
    })
    expect(result.ledger.find(decision => decision.key === 'invalid')).toMatchObject({
      outcome: 'excluded',
      reason: 'invalid',
    })
    expect(result.ledger.find(decision => decision.key === 'gm-authority')).toMatchObject({
      outcome: 'excluded',
      reason: 'authority',
    })
  })

  it('matches public world info only on whole words', () => {
    const entries = [
      worldEntry(source('armor', 'Armor rules', { stability: 'stable' }), ['armor']),
      worldEntry(source('armored', 'Armored rules'), ['armored']),
    ]

    const result = compileContext({
      observer: alice,
      branch: 'main',
      sources: [],
      worldInfo: { text: 'The armor is ready, but glass is nearby.', entries },
    })

    expect(result.stablePrefix.map(record => record.key)).toEqual(['armor'])
    expect(result.dynamicSuffix).toHaveLength(0)
    expect(result.ledger.find(decision => decision.key === 'armored')).toMatchObject({
      outcome: 'excluded',
      reason: 'not-matched',
    })
  })

  it('preserves selective, substring, and constant World Info semantics', () => {
    const result = matchWorldInfo({
      text: 'Harmony is mentioned beside a harmony-gate.',
      entries: [
        { ...worldEntry(source('selective', 'requires both'), ['Harmony'], ['Brother']), selective: true },
        { ...worldEntry(source('substring', 'substring'), ['harmony-gate']), matchWholeWords: false },
        { ...worldEntry(source('constant', 'always on'), ['never']), constant: true },
      ],
    })

    expect(result.map(candidate => candidate.source.key)).toEqual(['substring', 'constant'])
  })

  it('honors case-sensitive and regular-expression matching flags', () => {
    const result = matchWorldInfo({
      text: 'Armor and armor+',
      entries: [
        { ...worldEntry(source('case', 'case'), ['Armor']), caseSensitive: true },
        { ...worldEntry(source('regex', 'regex'), ['armor\\+']), useRegex: true },
      ],
    })

    expect(result.map(candidate => candidate.source.key)).toEqual(['case', 'regex'])
  })

  it('applies deterministic probability rolls before compiling an activation', () => {
    const entry = {
      ...worldEntry(source('probable', 'probable'), ['armor']),
      useProbability: true,
      probability: 50,
    }
    expect(matchWorldInfo({
      text: 'armor',
      entries: [entry],
      probabilityRoll: () => 49.99,
    })).toHaveLength(1)
    expect(matchWorldInfo({
      text: 'armor',
      entries: [entry],
      probabilityRoll: () => 50,
    })).toHaveLength(0)
  })

  it('keeps only the first deterministically ranked entry in a World Info group', () => {
    const result = compileContext({
      observer: alice,
      branch: 'main',
      sources: [],
      worldInfo: {
        text: 'armor',
        entries: [
          { ...worldEntry(source('second', 'second', { priority: 1 }), ['armor']), group: 'equipment' },
          { ...worldEntry(source('first', 'first', { priority: 2 }), ['armor']), group: 'equipment' },
        ],
      },
    })
    expect(result.dynamicSuffix.map(record => record.key)).toEqual(['first'])
    expect(result.ledger.find(decision => decision.key === 'second')).toMatchObject({
      outcome: 'excluded',
      reason: 'group',
    })
  })

  it('records the reason when character and token budgets reject a candidate', () => {
    const result = compileContext({
      observer: alice,
      branch: 'main',
      sources: [
        source('first', '12345', { stability: 'stable', priority: 10 }),
        source('second', '67890', { priority: 9 }),
        source('third', 'abc', { priority: 8 }),
      ],
      budget: {
        maxCharacters: 7,
        maxTokens: 2,
        tokenEstimator: text => Math.ceil(text.length / 3),
      },
    })

    expect(result.stablePrefix.map(record => record.key)).toEqual(['first'])
    expect(result.dynamicSuffix).toHaveLength(0)
    expect(result.usage).toEqual({ characters: 5, tokens: 2 })
    expect(result.ledger.find(decision => decision.key === 'second')).toMatchObject({
      outcome: 'excluded',
      reason: 'budget-both',
      attempted: { characters: 5, tokens: 2 },
    })
    expect(result.ledger.find(decision => decision.key === 'third')).toMatchObject({
      outcome: 'excluded',
      reason: 'budget-both',
    })
  })

  it('orders and deduplicates records independently of input order', () => {
    const stable = source('stable', 'stable', { stability: 'stable', priority: 0 })
    const beta = source('beta', 'beta', { priority: 1 })
    const alpha = source('alpha', 'alpha', { priority: 1 })
    const entries = [
      worldEntry(beta, ['second']),
      worldEntry(alpha, ['first']),
      worldEntry(alpha, ['first']),
    ]

    const compile = (records: readonly ContextSourceRecord[], worldEntries: readonly NormalizedWorldInfoEntry[]) => compileContext({
      observer: alice,
      branch: 'main',
      sources: records,
      worldInfo: { text: 'first second', entries: worldEntries },
    })

    const first = compile([stable], entries)
    const second = compile([stable], [...entries].reverse())

    expect(first.stablePrefix.map(record => record.key)).toEqual(['stable'])
    expect(first.dynamicSuffix.map(record => record.key)).toEqual(['alpha', 'beta'])
    expect(second.dynamicSuffix.map(record => record.key)).toEqual(['alpha', 'beta'])
    expect(first.ledger.filter(decision => decision.reason === 'duplicate')).toHaveLength(1)
  })
})

describe('matchWorldInfo', () => {
  it('ranks primary whole-word matches before secondary matches and then by key', () => {
    const result = matchWorldInfo({
      text: 'alpha beta',
      entries: [
        worldEntry(source('zeta', 'zeta'), [], ['beta']),
        worldEntry(source('alpha', 'alpha'), ['alpha']),
        worldEntry(source('beta', 'beta'), ['beta']),
      ],
    })

    expect(result.map(candidate => candidate.source.key)).toEqual(['alpha', 'beta', 'zeta'])
    expect(result[0]).toMatchObject({ matchKind: 'primary', matchedKeys: ['alpha'] })
    expect(result[2]).toMatchObject({ matchKind: 'secondary', matchedKeys: ['beta'] })
  })
})
