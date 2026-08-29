import { describe, expect, it } from 'vitest'
import {
  compactPublicState,
  createStoryState,
  projectStoryState,
  renderCompactPublicState,
  sourceEventId,
  storyBranchId,
  storyEntityId,
} from '../src/index.ts'
import type {
  JsonObject,
  StoryStateAuthority,
  StoryStateChange,
  StoryStateChangeRecord,
} from '../src/types.ts'

const branch = storyBranchId('main')
const source = (value: string) => sourceEventId(value)
const entity = (value: string) => storyEntityId(value)
const extensions: JsonObject = { imported: { source: 'fixture' } }
const gm: StoryStateAuthority = { kind: 'gm', extensions: {} }

function record(
  sequence: number,
  event: string,
  change: StoryStateChange,
  overrides: Partial<StoryStateChangeRecord> = {},
): StoryStateChangeRecord {
  return {
    sourceEventId: source(event),
    branchId: branch,
    sequence,
    validity: { status: 'valid', extensions: {} },
    authority: gm,
    change,
    extensions,
    ...overrides,
  }
}

describe('projectStoryState', () => {
  it('projects location, inventory, relationship, and cultivation updates', () => {
    const result = projectStoryState([
      record(1, 'e1', { kind: 'location.set', location: { id: entity('harbor'), name: 'South Harbor', description: 'Foggy', extensions: {} }, extensions: {} }),
      record(2, 'e2', { kind: 'inventory.upsert', item: { id: entity('key'), name: 'Brass key', quantity: 1, extensions: {} }, extensions: {} }),
      record(3, 'e3', { kind: 'relationship.upsert', relationship: { subjectId: entity('mira'), targetId: entity('player'), phase: 'trusting', affinity: 20, extensions: {} }, extensions: {} }),
      record(4, 'e4', { kind: 'cultivation.upsert', cultivation: { subjectId: entity('mira'), realm: 'Foundation', stage: 'early', level: 2, progress: 0.4, extensions: {} }, extensions: {} }),
    ], { branchId: branch })

    expect(result.issues).toEqual([])
    expect(result.state.location?.name).toBe('South Harbor')
    expect(result.state.inventory).toEqual([{ id: entity('key'), name: 'Brass key', quantity: 1, extensions: {} }])
    expect(result.state.relationships[0]?.phase).toBe('trusting')
    expect(result.state.cultivation[0]?.realm).toBe('Foundation')
    expect(result.appliedRecords).toHaveLength(4)
  })

  it('replaces and removes canonical values while preserving extension data', () => {
    const result = projectStoryState([
      record(1, 'e1', { kind: 'inventory.upsert', item: { id: entity('coin'), name: 'Coin', quantity: 2, extensions: { mint: 'old' } }, extensions: {} }),
      record(2, 'e2', { kind: 'inventory.upsert', item: { id: entity('coin'), name: 'Coin', quantity: 3, extensions: { mint: 'new' } }, extensions: {} }),
      record(3, 'e3', { kind: 'extension.set', namespace: 'rules', key: 'season', value: 'winter', extensions: {} }),
      record(4, 'e4', { kind: 'inventory.remove', itemId: entity('coin'), extensions: {} }),
      record(5, 'e5', { kind: 'extension.remove', namespace: 'rules', key: 'season', extensions: {} }),
    ], { branchId: branch })

    expect(result.state.inventory).toEqual([])
    expect(result.state.extensions).toEqual({ rules: {} })
    expect(result.appliedRecords[0]?.validity.status).toBe('invalid')
    expect(result.appliedRecords[0]?.validity).toMatchObject({ supersededBy: source('e2') })
    expect(result.appliedRecords[1]?.validity.status).toBe('invalid')
  })

  it('filters records from stale branches and accepts declared ancestors', () => {
    const parent = storyBranchId('parent')
    const child = storyBranchId('child')
    const ancestorRecord = record(1, 'parent-event', { kind: 'location.set', location: { id: entity('road'), name: 'Old Road', extensions: {} }, extensions: {} }, { branchId: parent })
    const childRecord = record(2, 'child-event', { kind: 'time.set', time: { value: 'day 2', extensions: {} }, extensions: {} }, { branchId: child })
    const staleRecord = record(3, 'other-event', { kind: 'location.set', location: { id: entity('tower'), name: 'Tower', extensions: {} }, extensions: {} }, { branchId: storyBranchId('other') })

    const result = projectStoryState([ancestorRecord, childRecord, staleRecord], { branchId: child, branchLineage: [parent, child] })

    expect(result.state.location?.name).toBe('Old Road')
    expect(result.state.time?.value).toBe('day 2')
    expect(result.rejectedRecords).toEqual([staleRecord])
    expect(result.issues.at(-1)?.code).toBe('stale-branch')
  })

  it('rejects invalid, duplicate, stale, and lower-authority updates', () => {
    const invalidQuantity = record(1, 'bad', { kind: 'inventory.upsert', item: { id: entity('coin'), name: 'Coin', quantity: 0, extensions: {} }, extensions: {} })
    const accepted = record(2, 'accepted', { kind: 'location.set', location: { id: entity('inn'), name: 'Inn', extensions: {} }, extensions: {} })
    const duplicate = record(3, 'accepted', { kind: 'time.set', time: { value: 'day 3', extensions: {} }, extensions: {} })
    const lowerAuthority = record(4, 'lower', { kind: 'location.set', location: { id: entity('cell'), name: 'Cell', extensions: {} }, extensions: {} }, { authority: { kind: 'model-candidate', extensions: {} } })
    const stale = record(5, 'stale', { kind: 'time.set', time: { value: 'day 4', extensions: {} }, extensions: {} }, { branchId: storyBranchId('discarded') })

    const result = projectStoryState([invalidQuantity, accepted, duplicate, lowerAuthority, stale], { branchId: branch })

    expect(result.state.location?.name).toBe('Inn')
    expect(result.state.inventory).toEqual([])
    expect(result.state.time).toBeNull()
    expect(result.rejectedRecords).toHaveLength(4)
    expect(result.issues.map(issue => issue.code)).toEqual([
      'invalid-update',
      'duplicate-source-event',
      'insufficient-authority',
      'stale-branch',
    ])
  })

  it('rejects invalid branch selections without projecting records', () => {
    const entry = record(1, 'e1', { kind: 'location.set', location: { id: entity('inn'), name: 'Inn', extensions: {} }, extensions: {} })
    const result = projectStoryState([entry], { branchId: branch, branchLineage: [storyBranchId('other')] })

    expect(result.state).toEqual(createStoryState(branch))
    expect(result.rejectedRecords).toEqual([entry])
    expect(result.issues[0]?.code).toBe('invalid-branch-selection')
  })
})

describe('compactPublicState', () => {
  it('removes verbose and extension fields and produces stable JSON', () => {
    const state = {
      ...createStoryState(branch),
      location: { id: entity('inn'), name: 'Inn', description: 'Private note', extensions: { secret: true } },
      inventory: [{ id: entity('coin'), name: 'Coin', quantity: 2, unit: 'silver', extensions: { private: true } }],
    }
    const compact = compactPublicState(state)

    expect(compact).toEqual({
      location: { id: entity('inn'), name: 'Inn' },
      time: null,
      inventory: [{ id: entity('coin'), name: 'Coin', quantity: 2, unit: 'silver' }],
      health: [],
      relationships: [],
      cultivation: [],
      activeOaths: [],
    })
    expect(renderCompactPublicState(compact)).toBe(JSON.stringify(compact))
    expect(renderCompactPublicState(compact)).not.toContain('Private note')
  })
})
