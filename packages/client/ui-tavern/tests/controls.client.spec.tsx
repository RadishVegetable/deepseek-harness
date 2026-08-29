// @vitest-environment jsdom
/** Client interaction coverage for the second Tavern workbench batch. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { RequestView, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  CharacterAsset,
  PromptAssetBaseline,
  StoryStateChange,
  TavernStoryStateInspection,
  TavernSwipeInspection,
  WorldInfoAsset,
} from '@deepseek-ai/dsh-tavern-host/client'
import { PromptInspector, TavernAssetEditor, TavernMemoryEditor, TavernStoryStateEditor, TavernSwipeEditor } from '../src/client/TavernControls.tsx'
import type { TavernAssetsRemote as TavernRemote } from '../src/client/index.ts'
import { en } from '../src/client/locales.ts'

const SESSION_ID = 'tavern-controls' as SessionId

const character: CharacterAsset = {
  kind: 'character',
  id: 'aria' as CharacterAsset['id'],
  name: 'Aria Vale',
  version: { format: 'chara_card_v2', revision: 1 },
  sourceReferences: [],
  sourceData: { spec: 'chara_card_v2', data: { name: 'Aria Vale' } },
  description: 'An archivist.',
  personality: 'Careful.',
  scenario: 'An archive.',
  firstMessage: 'Welcome.',
  creatorNotes: '',
  messageExamples: '',
  alternateGreetings: [],
  systemPrompt: '',
  postHistoryInstructions: '',
  extensions: {},
}

const worldInfo: WorldInfoAsset = {
  kind: 'world-info',
  id: 'archive' as WorldInfoAsset['id'],
  name: 'Archive Book',
  version: { format: 'world-info-v2', revision: 1 },
  sourceReferences: [],
  sourceData: { name: 'Archive Book', entries: [] },
  scanDepth: null,
  tokenBudget: null,
  recursiveScanning: false,
  entries: [],
  extensions: {},
}

const selectionBaseline: PromptAssetBaseline = {
  selection: { characterId: character.id, worldInfoIds: [worldInfo.id] },
  references: [{ kind: 'character', assetId: character.id, version: character.version }],
  characterSections: [{ id: 'aria.description', field: 'description', text: character.description, sourceAssetId: character.id }],
  worldInfoEntries: [{
    id: 'archive.entry-1' as WorldInfoAsset['id'],
    sourceAssetId: worldInfo.id,
    keys: ['archive'],
    secondaryKeys: [],
    selective: false,
    constant: false,
    useRegex: false,
    matchWholeWords: false,
    caseSensitive: false,
    useProbability: false,
    scanDepth: null,
    tokenBudget: null,
    recursiveScanning: false,
    content: 'The archive is old.',
    enabled: true,
    position: 'before-character',
    depth: 0,
    order: 1,
    recursive: false,
    probability: 100,
    group: null,
    sticky: null,
    cooldown: null,
  }],
}

const storyInspection: TavernStoryStateInspection = {
  projection: {
    branchId: 'story-session' as never,
    state: {
      version: 1,
      branchId: 'story-session' as never,
      location: null,
      time: null,
      inventory: [],
      health: [],
      relationships: [],
      cultivation: [],
      activeOaths: [],
      extensions: {},
    },
    appliedRecords: [],
    rejectedRecords: [],
    issues: [],
  },
  records: [],
}

const swipeInspection: TavernSwipeInspection = {
  groups: [{
    groupId: 'turn:1',
    currentCandidateId: 'candidate:1',
    candidates: [
      { candidateId: 'candidate:1', origin: 'initial', text: 'The first answer.' },
      { candidateId: 'candidate:2', origin: 'swipe', text: 'The alternate answer.' },
      { candidateId: 'candidate:3', origin: 'regenerate', text: 'The regenerated answer.' },
    ],
  }],
  issues: [],
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function translate(key: keyof typeof en): string {
  return en[key]
}

function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value }
}

describe('Tavern second-batch controls', () => {
  it('updates and exports the selected Character Card and World Info source', async () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const updateCharacter = vi.fn(async () => ok(character))
    const updateWorldInfo = vi.fn(async () => ok(worldInfo))
    const exportCharacter = vi.fn(async () => ok('{"data":{"name":"Aria Vale"}}'))
    const exportWorldInfo = vi.fn(async () => ok('{"name":"Archive Book"}'))
    const onCharacterUpdated = vi.fn(async () => {})
    const onWorldInfoUpdated = vi.fn(async () => {})
    const remote = {
      updateCharacter,
      updateWorldInfo,
      exportCharacter,
      exportWorldInfo,
    } as unknown as TavernRemote

    render(<TavernAssetEditor
      characters={[character]}
      worldInfoLibrary={[worldInfo]}
      character={character}
      tavernAssets={remote}
      t={translate}
      onCharacterUpdated={onCharacterUpdated}
      onWorldInfoUpdated={onWorldInfoUpdated}
      onError={() => {}}
    />)

    const sourceEditors = screen.getAllByLabelText('Source JSON')
    fireEvent.change(sourceEditors[0]!, { target: { value: '{"data":{"name":"Aria Updated"}}' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save asset' })[0]!)
    await waitFor(() => {
      expect(updateCharacter).toHaveBeenCalledWith(
        '{"data":{"name":"Aria Updated"}}', { id: character.id },
      )
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'Export JSON' })[0]!)
    await waitFor(() => { expect(exportCharacter).toHaveBeenCalledWith(character.id) })

    const worldSource = screen.getAllByLabelText('Source JSON')[1]!
    fireEvent.change(worldSource, { target: { value: '{"name":"Archive Updated","entries":[]}' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save asset' })[1]!)
    await waitFor(() => {
      expect(updateWorldInfo).toHaveBeenCalledWith(
        '{"name":"Archive Updated","entries":[]}', { id: worldInfo.id },
      )
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'Export JSON' })[1]!)
    await waitFor(() => { expect(exportWorldInfo).toHaveBeenCalledWith(worldInfo.id) })
  })

  it('loads memories and writes an added memory through the Remote', async () => {
    const listMemory = vi.fn(async (_sessionId: SessionId) => ok([{ id: 'oath', text: 'The oath is binding.', level: 'pinned' as const, enabled: true, label: null }]))
    const remember = vi.fn(async (_sessionId: SessionId, input: { text: string }) => ok({ id: 'new-memory', text: input.text, level: 'persistent' as const, enabled: true, label: null }))
    const remote = { listMemory, remember } as unknown as TavernRemote

    render(<TavernMemoryEditor sessionId={SESSION_ID} tavernAssets={remote} t={translate} onError={() => {}} />)

    await waitFor(() => { expect(screen.getByText('The oath is binding.')).toBeTruthy() })
    fireEvent.change(screen.getByLabelText('Memory text'), { target: { value: 'The lantern is lit.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add memory' }))
    await waitFor(() => {
      expect(remember).toHaveBeenCalledWith(SESSION_ID, {
        text: 'The lantern is lit.', level: 'persistent', label: null,
      })
    })
    expect(await screen.findByText('The lantern is lit.')).toBeTruthy()
  })

  it('writes location and time changes through the Story State Remote', async () => {
    const inspectStoryState = vi.fn(async (_sessionId: SessionId) => ok(storyInspection))
    const setStoryState = vi.fn(async (_sessionId: SessionId, _change: StoryStateChange) => ok(storyInspection))
    const remote = { inspectStoryState, setStoryState } as unknown as TavernRemote

    render(<TavernStoryStateEditor sessionId={SESSION_ID} tavernAssets={remote} t={translate} onError={() => {}} />)

    await waitFor(() => { expect(inspectStoryState).toHaveBeenCalledTimes(1) })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'South Harbor' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save state' })[0]!)
    await waitFor(() => {
      const change = setStoryState.mock.calls[0]?.[1]
      expect(change?.kind).toBe('location.set')
      if (change?.kind === 'location.set') expect(change.location.name).toBe('South Harbor')
    })

    fireEvent.change(screen.getByLabelText('Time value'), { target: { value: 'Day 2, dusk' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save state' })[1]!)
    await waitFor(() => {
      const change = setStoryState.mock.calls[1]?.[1]
      expect(change?.kind).toBe('time.set')
      if (change?.kind === 'time.set') expect(change.time.value).toBe('Day 2, dusk')
    })
  })

  it('shows the model prompt sections and Tavern source summary', () => {
    const latest: Extract<RequestView, { purpose: 'assistant' }> = {
      purpose: 'assistant',
      turn: 1,
      step: 1,
      startSeq: 4,
      startedAt: 1,
      completedAt: 2,
      status: 'complete',
      provenance: { provider: 'test-provider', model: 'test-model' },
      usage: {},
      prompt: {
        config: { provider: 'test-provider', model: 'test-model' },
        system: 'You are Aria.',
        tools: [{ name: 'remember', description: 'Store a memory.', parameters: { type: 'object' } }],
      },
    }

    render(<PromptInspector latest={latest} baseline={selectionBaseline} t={translate} />)

    expect(screen.getByText('You are Aria.')).toBeTruthy()
    expect(screen.getByText('remember')).toBeTruthy()
    expect(screen.getByText('The archive is old.')).toBeTruthy()
    expect(screen.getByText(/character: aria/)).toBeTruthy()
    expect(screen.getByText('archive.entry-1')).toBeTruthy()
  })

  it('selects adjacent candidates through the group controls', async () => {
    const selectSwipe = vi.fn(async (_sessionId: SessionId, input: { groupId: string; candidateId: string }) => ok({
      ...swipeInspection,
      groups: [{ ...swipeInspection.groups[0]!, currentCandidateId: input.candidateId }],
    }))
    const onSelected = vi.fn()
    const remote = { selectSwipe } as unknown as TavernRemote

    render(<TavernSwipeEditor
      sessionId={SESSION_ID}
      tavernAssets={remote}
      inspection={swipeInspection}
      t={translate}
      onSelected={onSelected}
      onError={() => {}}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Next candidate turn:1' }))
    await waitFor(() => {
      expect(selectSwipe).toHaveBeenCalledWith(SESSION_ID, { groupId: 'turn:1', candidateId: 'candidate:2' })
      expect(onSelected).toHaveBeenCalled()
    })
  })

  it('exposes regeneration as an optional async callback without requiring a Remote method', async () => {
    const onRegenerate = vi.fn(async (_groupId: string, _candidateId: string) => {})
    const remote = {} as TavernRemote

    render(<TavernSwipeEditor
      sessionId={SESSION_ID}
      tavernAssets={remote}
      inspection={swipeInspection}
      t={translate}
      onSelected={() => {}}
      onError={() => {}}
      onRegenerate={onRegenerate}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate turn:1' }))
    await waitFor(() => { expect(onRegenerate).toHaveBeenCalledWith('turn:1', 'candidate:1') })
  })
})
