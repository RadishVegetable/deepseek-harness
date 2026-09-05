import { describe, expect, it } from 'vitest'
import { resolveFactProjection } from '../src/facts.ts'
import type { TavernFactRecord } from '../src/facts.ts'

describe('Host memory fact fields', () => {
  it('preserves subjectKey, extractionId, and explicit through projection', () => {
    const records: TavernFactRecord[] = [
      {
        seq: 1,
        data: {
          branch: 'main',
          target: 'person',
          personId: 'person:alice',
          operation: 'add',
          factId: 'fact:old',
          text: 'Alice has red hair',
          subjectKey: 'person:alice.appearance',
          extractionId: 'extract:1',
          explicit: true,
          authority: 'observed',
          kind: 'soft',
          accepted: true,
        },
      },
      {
        seq: 2,
        data: {
          branch: 'main',
          target: 'person',
          personId: 'person:alice',
          operation: 'add',
          factId: 'fact:new',
          text: 'Alice has blue hair',
          subjectKey: 'person:alice.appearance',
          extractionId: 'extract:2',
          explicit: false,
          authority: 'observed',
          kind: 'soft',
          accepted: true,
        },
      },
    ]

    const projection = resolveFactProjection(records)
    expect(projection.people['person:alice']).toHaveLength(2)
    expect(projection.people['person:alice']?.map(fact => [fact.subjectKey, fact.extractionId, fact.explicit])).toEqual([
      ['person:alice.appearance', 'extract:1', true],
      ['person:alice.appearance', 'extract:2', false],
    ])
    expect(projection.conflicts).toHaveLength(1)
  })
})
