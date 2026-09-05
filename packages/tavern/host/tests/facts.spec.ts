import { describe, expect, it } from 'vitest'
import {
  applyGmUpdates,
  detectConflicts,
  hardFactConstraintText,
  resolveFactProjection,
  revertFactsFrom,
  type TavernFactRecord,
} from '../src/facts.ts'
import type { TavernFactEvent } from '../src/types.ts'

function record(seq: number, data: Partial<TavernFactEvent> & Pick<TavernFactEvent, 'factId' | 'operation' | 'text'>): TavernFactRecord {
  return {
    seq,
    data: {
      branch: 'journey-a',
      target: 'world',
      authority: 'gm',
      kind: 'soft',
      accepted: true,
      ...data,
    },
  }
}

describe('Tavern fact kernel', () => {
  it('projects provenance and accepts replace/remove only for active fact ids', () => {
    const seed = record(2, {
      factId: 'fact:seed',
      operation: 'add',
      text: 'The north gate is open.',
      label: '地理',
      authority: 'authored-asset',
      kind: 'hard',
      sourceAssetId: 'world-book',
      sourceEntryId: 'entry-1',
    })
    const applied = applyGmUpdates({
      updates: { world: [{ op: 'replace', factId: 'fact:seed', text: 'The north gate is sealed.', kind: 'hard' }] },
      branch: 'journey-a',
      assistantSeq: 9,
      turn: 3,
      existing: [seed],
    })

    expect(applied.events[0]).toMatchObject({
      factId: 'fact:9:1',
      replacesFactId: 'fact:seed',
      authority: 'gm',
      kind: 'hard',
      assistantSeq: 9,
    })
    expect(applied.projection.world).toEqual(expect.arrayContaining([expect.objectContaining({
      factId: 'fact:9:1',
      text: 'The north gate is sealed.',
      authority: 'gm',
      kind: 'hard',
      source: { kind: 'asset', assetId: 'world-book', entryId: 'entry-1' },
      sourceAssetId: 'world-book',
      sourceEntryId: 'entry-1',
    })]))

    const rejected = applyGmUpdates({
      updates: { world: [{ op: 'remove', factId: 'fact:missing' }] },
      branch: 'journey-a',
      assistantSeq: 10,
      turn: 4,
      existing: [seed],
    })
    const rejectedEvent = rejected.events[0]
    if (rejectedEvent === undefined) throw new Error('rejected fact event was not created')
    expect(rejectedEvent.rejection).toContain('active factId')
  })

  it('exposes hard conflicts and renders binding constraints', () => {
    const records = [
      record(1, { factId: 'fact:one', operation: 'add', text: 'North', label: 'direction', kind: 'hard' }),
      record(2, { factId: 'fact:two', operation: 'add', text: 'South', label: 'direction', kind: 'hard' }),
    ]
    const conflicts = detectConflicts(records)
    const projection = resolveFactProjection(records)

    expect(conflicts).toHaveLength(1)
    expect(projection.conflicts).toEqual(conflicts)
    expect(projection.world.every(fact => (fact.conflicts ?? []).length > 0)).toBe(true)
    expect(hardFactConstraintText(projection)).toContain('Do not contradict')
    expect(hardFactConstraintText(projection)).toContain('North')
    expect(hardFactConstraintText(projection)).toContain('South')
  })

  it('creates append-only rollback removes and keeps the audit records', () => {
    const records = [
      record(1, { factId: 'fact:old', operation: 'add', text: 'Old', assistantSeq: 4 }),
      record(2, { factId: 'fact:new', operation: 'add', text: 'New', assistantSeq: 8 }),
    ]
    const removes = revertFactsFrom(records, 8, { branch: 'journey-a', turn: 5 })
    const after = resolveFactProjection([...records, ...removes.map((data, index) => ({ seq: 3 + index, data }))])

    expect(removes).toEqual([expect.objectContaining({
      operation: 'remove',
      factId: 'fact:new',
      authority: 'user',
      revertedFromSeq: 8,
    })])
    expect(after.world.map(fact => fact.factId)).toEqual(['fact:old'])
    expect(records).toHaveLength(2)
  })

  it('does not mix independent branches when an explicit branch is selected', () => {
    const records = [
      record(1, { branch: 'journey-a', factId: 'fact:a', operation: 'add', text: 'A' }),
      record(2, { branch: 'journey-b', factId: 'fact:b', operation: 'add', text: 'B' }),
    ]

    expect(resolveFactProjection(records, { branch: 'journey-a' }).world.map(fact => fact.text)).toEqual(['A'])
  })

  it('keeps a hard replace as a distinct incoming fact so either side can be resolved', () => {
    const seed = record(1, {
      factId: 'fact:old',
      operation: 'add',
      text: 'North gate',
      label: 'direction',
      kind: 'hard',
      authority: 'authored-asset',
    })
    const applied = applyGmUpdates({
      updates: { world: [{ op: 'replace', factId: 'fact:old', text: 'South gate', label: 'direction', kind: 'hard' }] },
      branch: 'journey-a',
      assistantSeq: 7,
      turn: 2,
      existing: [seed],
    })

    expect(applied.events[0]).toMatchObject({
      operation: 'replace',
      factId: 'fact:7:1',
      replacesFactId: 'fact:old',
    })
    expect(applied.projection.world.map(fact => fact.text)).toEqual(['North gate', 'South gate'])
    expect(applied.conflicts).toHaveLength(1)
    expect(applied.conflicts[0]).toMatchObject({ factId: 'fact:7:1', previousFactId: 'fact:old' })

    const incoming = applied.events[0]
    if (incoming === undefined) throw new Error('hard replacement event was not created')
    const removeIncoming = { ...incoming, operation: 'remove' as const, factId: 'fact:7:1' }
    delete removeIncoming.text
    const keepOld = resolveFactProjection([
      { seq: 1, data: seed.data },
      { seq: 2, data: incoming },
      { seq: 3, data: removeIncoming },
    ])
    expect(keepOld.world.map(fact => fact.text)).toEqual(['North gate'])
  })

  it('derives a distinct projection id for legacy same-id hard replacements', () => {
    const records = [
      record(1, { factId: 'fact:old', operation: 'add', text: 'North', label: 'direction', kind: 'hard' }),
      record(2, { factId: 'fact:old', operation: 'replace', text: 'South', label: 'direction', kind: 'hard' }),
    ]

    const projection = resolveFactProjection(records)
    expect(projection.world.map(fact => [String(fact.factId), fact.text])).toEqual([
      ['fact:old', 'North'],
      ['fact:fact:old:replacement:2', 'South'],
    ])
    expect(projection.conflicts?.[0]).toMatchObject({
      factId: 'fact:fact:old:replacement:2',
      previousFactId: 'fact:old',
    })
  })
})
