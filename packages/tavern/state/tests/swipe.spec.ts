import { describe, expect, it } from 'vitest'
import {
  createSwipeState,
  projectSwipeState,
  sourceEventId,
  storyBranchId,
  swipeCandidateId,
  swipeGroupId,
} from '../src/index.ts'
import type {
  JsonObject,
  SwipeAssistantCandidate,
  SwipeRecord,
  StoryStateAuthority,
} from '../src/types.ts'

const branch = storyBranchId('main')
const group = swipeGroupId('turn-1')
const gm: StoryStateAuthority = { kind: 'gm', extensions: {} }
const model: StoryStateAuthority = { kind: 'model-candidate', extensions: {} }

function record(
  sequence: number,
  event: string,
  value: Partial<SwipeRecord> & Pick<SwipeRecord, 'kind'>,
  overrides: Partial<SwipeRecord> = {},
): SwipeRecord {
  return {
    sourceEventId: sourceEventId(event),
    branchId: branch,
    sequence,
    validity: { status: 'valid', extensions: {} },
    authority: value.kind === 'candidate.add' ? model : gm,
    extensions: {},
    ...value,
    ...overrides,
  } as SwipeRecord
}

function candidate(id: string, origin: SwipeAssistantCandidate['origin'], text: string): SwipeAssistantCandidate {
  return {
    candidateId: swipeCandidateId(id),
    assistantEventId: sourceEventId(`assistant-${id}`),
    origin,
    content: { role: 'assistant', content: text },
    extensions: { retained: true } satisfies JsonObject,
  }
}

describe('projectSwipeState', () => {
  it('rebuilds multiple assistant candidates and the current selection', () => {
    const first = candidate('a', 'initial', 'First answer')
    const second = candidate('b', 'swipe', 'Alternative answer')
    const result = projectSwipeState([
      record(1, 'candidate-a', { kind: 'candidate.add', groupId: group, candidate: first }),
      record(2, 'candidate-b', { kind: 'candidate.add', groupId: group, candidate: second }),
      record(3, 'select-b', { kind: 'candidate.select', groupId: group, candidateId: second.candidateId }),
    ], { branchId: branch })

    expect(result.issues).toEqual([])
    expect(result.state.groups).toEqual([{
      groupId: group,
      candidates: [first, second],
      currentCandidateId: second.candidateId,
    }])
    expect(result.appliedRecords).toHaveLength(3)
    expect(result.appliedRecords[2]?.kind).toBe('candidate.select')
  })

  it('keeps the old candidate when regenerate appends a new candidate', () => {
    const first = candidate('a', 'initial', 'Original answer')
    const regenerated = candidate('c', 'regenerate', 'Regenerated answer')
    const result = projectSwipeState([
      record(1, 'candidate-a', { kind: 'candidate.add', groupId: group, candidate: first }),
      record(2, 'select-a', { kind: 'candidate.select', groupId: group, candidateId: first.candidateId }),
      record(3, 'candidate-c', { kind: 'candidate.add', groupId: group, candidate: regenerated }),
    ], { branchId: branch })

    const projected = result.state.groups[0]
    expect(projected?.candidates).toEqual([first, regenerated])
    expect(projected?.currentCandidateId).toBe(first.candidateId)
    expect(result.rejectedRecords).toEqual([])
  })

  it('does not replace a candidate with a duplicate id and rejects unknown selections', () => {
    const first = candidate('a', 'initial', 'Original answer')
    const duplicate = candidate('a', 'regenerate', 'Should remain separate by id')
    const result = projectSwipeState([
      record(1, 'candidate-a', { kind: 'candidate.add', groupId: group, candidate: first }),
      record(2, 'candidate-a-duplicate', { kind: 'candidate.add', groupId: group, candidate: duplicate }),
      record(3, 'select-missing', { kind: 'candidate.select', groupId: group, candidateId: swipeCandidateId('missing') }),
    ], { branchId: branch })

    expect(result.state.groups[0]?.candidates).toEqual([first])
    expect(result.rejectedRecords.map(value => value.sourceEventId)).toEqual([
      sourceEventId('candidate-a-duplicate'),
      sourceEventId('select-missing'),
    ])
    expect(result.issues.map(issue => issue.code)).toEqual(['duplicate-candidate', 'candidate-not-found'])
  })

  it('accepts ancestor records and rejects stale branches', () => {
    const parent = storyBranchId('parent')
    const child = storyBranchId('child')
    const first = candidate('a', 'initial', 'Parent answer')
    const parentRecord = record(1, 'parent-candidate', { kind: 'candidate.add', groupId: group, candidate: first }, { branchId: parent })
    const stale = record(2, 'stale-candidate', { kind: 'candidate.add', groupId: group, candidate: candidate('stale', 'swipe', 'Stale') }, { branchId: storyBranchId('other') })

    const result = projectSwipeState([parentRecord, stale], { branchId: child, branchLineage: [parent, child] })

    expect(result.state.groups[0]?.candidates).toEqual([first])
    expect(result.rejectedRecords).toEqual([stale])
    expect(result.issues[0]?.code).toBe('stale-branch')
  })

  it('rejects model candidates attempting to select the current response', () => {
    const first = candidate('a', 'initial', 'Answer')
    const result = projectSwipeState([
      record(1, 'candidate-a', { kind: 'candidate.add', groupId: group, candidate: first }),
      record(2, 'model-select', { kind: 'candidate.select', groupId: group, candidateId: first.candidateId }, { authority: model }),
    ], { branchId: branch })

    expect(result.state).toEqual({
      ...createSwipeState(branch),
      groups: [{ groupId: group, candidates: [first], currentCandidateId: null }],
    })
    expect(result.issues[0]?.code).toBe('insufficient-authority')
  })
})
