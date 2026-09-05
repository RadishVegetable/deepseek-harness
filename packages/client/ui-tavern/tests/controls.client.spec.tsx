// @vitest-environment jsdom
/** Client interaction coverage for secondary Tavern tools. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { RequestView, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  AssetId,
  CharacterAsset,
  PromptAssetBaseline,
  StoryStateChange,
  TavernFactConflict,
  TavernFactEntry,
  TavernFactInspection,
  TavernJourneyField,
  TavernGmResponseInspection,
  TavernStoryStateInspection,
  TavernSwipeInspection,
  WorldInfoAsset,
} from '@deepseek-ai/dsh-tavern-host/client'
import { PromptInspector, TavernAssetEditor, TavernStoryStateEditor, TavernSwipeEditor } from '../src/client/TavernControls.tsx'
import { FactInspection } from '../src/client/TavernView.tsx'
import { projectLedger, TavernLedger } from '../src/client/TavernLedger.tsx'
import type { TavernAssetsRemote as TavernRemote, TavernContextActivation } from '../src/client/index.ts'
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
  characterBook: null,
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

function translate(key: string): string {
  return key === 'none' ? '' : en[key as keyof typeof en] ?? key
}

function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value }
}

describe('Tavern second-batch controls', () => {
  it('updates and exports the selected Character Card and World Info source', async () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const exportCharacter = vi.fn(async () => ok('{"data":{"name":"Aria Vale"}}'))
    const exportWorldInfo = vi.fn(async () => ok('{"name":"Archive Book"}'))
    const updateCharacter = vi.fn(async () => ok(character))
    const updateWorldInfo = vi.fn(async () => ok(worldInfo))
    const onAssetsUpdated = vi.fn(async () => {})
    const remote = {
      exportCharacter,
      exportWorldInfo,
      updateCharacter,
      updateWorldInfo,
    } as unknown as TavernRemote

    render(<TavernAssetEditor
      characters={[character]}
      worldInfoLibrary={[worldInfo]}
      character={character}
      tavernAssets={remote}
      t={translate}
      onAssetsUpdated={onAssetsUpdated}
      onError={() => {}}
    />)

    const sourceEditors = screen.getAllByLabelText('Source JSON')
    expect(sourceEditors[0]).toHaveProperty('readOnly', false)
    fireEvent.change(sourceEditors[0]!, { target: { value: '{"data":{"name":"Aria edited"}}' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save asset' })[0]!)
    await waitFor(() => { expect(updateCharacter).toHaveBeenCalledWith('{"data":{"name":"Aria edited"}}', { id: character.id }) })

    fireEvent.change(sourceEditors[1]!, { target: { value: '{"name":"Archive edited","entries":[]}' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save asset' })[1]!)
    await waitFor(() => { expect(updateWorldInfo).toHaveBeenCalledWith('{"name":"Archive edited","entries":[]}', { id: worldInfo.id }) })
    expect(onAssetsUpdated).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getAllByRole('button', { name: 'Export JSON' })[0]!)
    await waitFor(() => { expect(exportCharacter).toHaveBeenCalledWith(character.id) })

    fireEvent.click(screen.getAllByRole('button', { name: 'Export JSON' })[1]!)
    await waitFor(() => { expect(exportWorldInfo).toHaveBeenCalledWith(worldInfo.id) })
  })

  it('deletes Character Card and World Info assets and refreshes the library', async () => {
    const deleteAsset = vi.fn(async () => ok(true))
    const onAssetsUpdated = vi.fn(async () => {})
    const remote = {
      deleteAsset,
      exportCharacter: vi.fn(async () => ok('{}')),
      exportWorldInfo: vi.fn(async () => ok('{}')),
      updateCharacter: vi.fn(async () => ok(character)),
      updateWorldInfo: vi.fn(async () => ok(worldInfo)),
    } as unknown as TavernRemote

    render(<TavernAssetEditor
      characters={[character]}
      worldInfoLibrary={[worldInfo]}
      character={character}
      tavernAssets={remote}
      t={translate}
      onAssetsUpdated={onAssetsUpdated}
      onError={() => {}}
    />)

    // Destructive actions use a two-step inline confirm: the first click
    // arms the button, the second click fires the Remote.
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]!)
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete asset' })[0]!)
    await waitFor(() => { expect(deleteAsset).toHaveBeenCalledWith(character.id) })
    await waitFor(() => { expect(screen.getAllByRole('button', { name: 'Delete' })[1]).toHaveProperty('disabled', false) })
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[1]!)
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete asset' })[0]!)

    await waitFor(() => { expect(deleteAsset).toHaveBeenCalledWith(worldInfo.id) })
    expect(onAssetsUpdated).toHaveBeenCalledTimes(2)
  })

  it('edits detached Journey copies without exposing source-library mutation', async () => {
    const selection = {
      selection: { characterId: character.id, worldInfoIds: [worldInfo.id] },
      baseline: selectionBaseline,
      character,
      worldInfo: [worldInfo],
      characterName: character.name,
      worldInfoNames: [worldInfo.name],
    }
    const editJourneyCharacter = vi.fn(async (_sessionId: SessionId, _input: string) => ok(selection))
    const editJourneyWorldInfo = vi.fn(async (_sessionId: SessionId, _assetId: AssetId, _input: string) => ok(selection))
    const onJourneyUpdated = vi.fn(async () => {})
    const remote = { editJourneyCharacter, editJourneyWorldInfo } as unknown as TavernRemote

    render(<TavernAssetEditor
      characters={[character]}
      worldInfoLibrary={[worldInfo]}
      character={character}
      sessionId={SESSION_ID}
      tavernAssets={remote}
      t={translate}
      onJourneyUpdated={onJourneyUpdated}
      onError={() => {}}
    />)

    const sourceEditors = screen.getAllByLabelText('Source JSON')
    fireEvent.change(sourceEditors[0]!, { target: { value: '{"data":{"name":"Aria Journey"}}' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save asset' })[0]!)
    await waitFor(() => { expect(editJourneyCharacter).toHaveBeenCalledWith(SESSION_ID, '{"data":{"name":"Aria Journey"}}') })
    fireEvent.change(sourceEditors[1]!, { target: { value: '{"name":"Archive Journey","entries":[]}' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save asset' })[1]!)
    await waitFor(() => { expect(editJourneyWorldInfo).toHaveBeenCalledWith(SESSION_ID, worldInfo.id, '{"name":"Archive Journey","entries":[]}') })
    expect(onJourneyUpdated).toHaveBeenCalled()
  })

  it('edits and removes an automatic fact through the fact panel', async () => {
    const fact: TavernFactEntry = {
      factId: 'fact:1:1' as TavernFactEntry['factId'],
      target: 'world' as const,
      text: 'The archive belongs to the player.',
      source: { kind: 'assistant', assistantSeq: 3 },
      eventSeq: 4,
      assistantSeq: 3,
      turn: 1,
    }
    const inspection: TavernFactInspection = { projection: { people: {}, world: [fact] }, records: [] }
    const editFact = vi.fn(async (factId: string, text: string) => {
      expect(factId).toBe('fact:1:1')
      return ok({ projection: { people: {}, world: [{ ...fact, text }] }, records: [] })
    })
    const removeFact = vi.fn(async (factId: string) => {
      expect(factId).toBe('fact:1:1')
      return ok({ projection: { people: {}, world: [] }, records: [] })
    })

    render(
      <FactInspection
        inspection={inspection}
        t={translate}
        onEdit={async (factId, text) => { await editFact(factId, text) }}
        onRemove={async (factId) => { await removeFact(factId) }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'The archive is entrusted to the player.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save edit' }))
    await waitFor(() =>{  expect(editFact).toHaveBeenCalledWith('fact:1:1', 'The archive is entrusted to the player.') })

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    await waitFor(() =>{  expect(removeFact).toHaveBeenCalledWith('fact:1:1') })
  })

  it('saves a fact with Enter and cancels the draft with Escape', async () => {
    const fact: TavernFactEntry = {
      factId: 'fact:keyboard' as TavernFactEntry['factId'],
      target: 'world',
      text: 'The archive is closed.',
      source: { kind: 'assistant', assistantSeq: 3 },
      eventSeq: 4,
      assistantSeq: 3,
      turn: 1,
    }
    const onEdit = vi.fn(async () => {})
    render(<FactInspection
      inspection={{ projection: { people: {}, world: [fact] }, records: [] }}
      t={translate}
      onEdit={onEdit}
      onRemove={async () => {}}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const editor = screen.getByRole('textbox')
    fireEvent.change(editor, { target: { value: 'The archive is open.' } })
    fireEvent.keyDown(editor, { key: 'Escape' })
    expect(onEdit).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByText('The archive is closed.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const secondEditor = screen.getByRole('textbox')
    fireEvent.change(secondEditor, { target: { value: 'The archive is open.' } })
    fireEvent.keyDown(secondEditor, { key: 'Enter' })
    await waitFor(() => { expect(onEdit).toHaveBeenCalledWith('fact:keyboard', 'The archive is open.') })
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('offers explicit decisions for unresolved hard-fact conflicts', async () => {
    const fact: TavernFactEntry = {
      factId: 'fact:conflict:new' as TavernFactEntry['factId'],
      target: 'world',
      text: 'The western gate is open.',
      label: 'Gate status',
      source: { kind: 'assistant', assistantSeq: 7 },
      eventSeq: 8,
      assistantSeq: 7,
      turn: 2,
    }
    const conflict: TavernFactConflict = {
      id: 'conflict:gate',
      factId: fact.factId,
      previousFactId: 'fact:conflict:old' as TavernFactEntry['factId'],
      label: 'Gate status',
      previousText: 'The western gate is sealed.',
      incomingText: fact.text,
      previousAuthority: 'authored-asset',
      incomingAuthority: 'model-candidate',
      previousEventSeq: 4,
      incomingEventSeq: 8,
    }
    const onResolve = vi.fn(async () => {})
    render(<FactInspection
      inspection={{ projection: { people: {}, world: [fact], conflicts: [conflict] }, records: [] }}
      t={translate}
      onEdit={async () => {}}
      onRemove={async () => {}}
      onResolve={onResolve}
    />)

    expect(screen.getByRole('alert').textContent).toContain('Setting conflict detected')
    fireEvent.click(screen.getByRole('button', { name: 'Keep new value' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep old value' }))
    await waitFor(() => {
      expect(onResolve).toHaveBeenNthCalledWith(1, 'conflict:gate', 'new')
      expect(onResolve).toHaveBeenNthCalledWith(2, 'conflict:gate', 'old')
    })
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

  it('shows model input sections and available request result metadata', () => {
    const latest: Extract<RequestView, { purpose: 'assistant' }> = {
      purpose: 'assistant',
      turn: 1,
      step: 1,
      startSeq: 4,
      startedAt: 1,
      completedAt: 2,
      status: 'complete',
      resultSeq: 8,
      provenance: { provider: 'test-provider', model: 'test-model' },
      usage: { inputTokens: 321, outputTokens: 87 },
      prompt: {
        config: { provider: 'test-provider', model: 'test-model' },
        system: 'You are Aria.',
        tools: [{ name: 'remember', description: 'Store a memory.', parameters: { type: 'object' } }],
      },
    }

    const gmResponse: TavernGmResponseInspection = {
      eventSeq: 9,
      assistantSeq: 8,
      turn: 1,
      response: {
        story: 'The gate opens, and the secretary arrives.',
        updates: { world: [{ op: 'add', label: 'Role', text: 'The secretary serves the player.' }] },
      },
    }

    const contextActivation: TavernContextActivation = {
      ledger: [
        {
          key: 'world:archive',
          origin: 'world-info',
          outcome: 'included',
          reason: 'included',
          matchedKeys: ['archive'],
          attempted: { characters: 42, tokens: 11 },
          accepted: { characters: 42, tokens: 11 },
          order: 0,
        },
        {
          key: 'world:harbor',
          origin: 'world-info',
          outcome: 'excluded',
          reason: 'not-matched',
          attempted: { characters: 35 },
          order: 1,
        },
      ],
      usage: { characters: 42, tokens: 11 },
    }

    render(<PromptInspector latest={latest} baseline={selectionBaseline} output="A complete response." gmResponses={[gmResponse]} contextActivation={contextActivation} t={translate} />)

    expect(screen.getByText('You are Aria.')).toBeTruthy()
    expect(screen.getByText('remember')).toBeTruthy()
    expect(screen.getByText(en['prompt.statusComplete'])).toBeTruthy()
    expect(screen.getAllByText('#8').length).toBeGreaterThan(0)
    expect(screen.getByText(/"inputTokens": 321/)).toBeTruthy()
    expect(screen.getByText(en['prompt.outputRecorded'])).toBeTruthy()
    expect(screen.getByText('A complete response.')).toBeTruthy()
    expect(screen.getByText('The archive is old.')).toBeTruthy()
    expect(screen.getByText(/Character Card: aria/)).toBeTruthy()
    expect(screen.getByText('archive.entry-1')).toBeTruthy()
    expect(screen.getByText('Parsed GM response')).toBeTruthy()
    expect(screen.getByText('The gate opens, and the secretary arrives.')).toBeTruthy()
    expect(screen.getByText(/"op": "add"/)).toBeTruthy()
    expect(screen.getByText('Context activation decisions (2)')).toBeTruthy()
    expect(screen.getByText('Included')).toBeTruthy()
    expect(screen.getByText('Excluded')).toBeTruthy()
    expect(screen.getByText((_, element) => element?.textContent === 'Matched keys: archive')).toBeTruthy()
    expect(screen.getByText((_, element) => element?.textContent === 'Reason: Passed filtering')).toBeTruthy()
    expect(screen.getByText((_, element) => element?.textContent === 'Reason: No keywords matched')).toBeTruthy()
    expect(screen.getByText('Total usage')).toBeTruthy()
    expect(screen.getByText('Attempted usage: characters 35')).toBeTruthy()
  })

  it('shows accepted and rejected fact events in the audit panel', () => {
    const inspection: TavernFactInspection = {
      projection: { people: {}, world: [] },
      records: [{
        seq: 7,
        data: {
          branch: String(SESSION_ID),
          target: 'world',
          operation: 'add',
          assistantSeq: 6,
          turn: 2,
          text: 'The malformed update is retained for review.',
          accepted: false,
          rejection: 'updates.world must be an array',
        },
      }],
    }

    render(<FactInspection inspection={inspection} t={translate} onEdit={async () => {}} onRemove={async () => {}} />)

    expect(screen.getByText('Fact audit records (1)')).toBeTruthy()
    expect(screen.getByText('Rejected')).toBeTruthy()
    expect(screen.getByText('updates.world must be an array')).toBeTruthy()
    expect(screen.getByText(/Assistant message #6/)).toBeTruthy()
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

  it('projects fact-origin journey fields into editable ledger sections', () => {
    const fact: TavernFactEntry = {
      factId: 'fact:ledger' as TavernFactEntry['factId'],
      target: 'world',
      label: '天气',
      text: '海风转冷。',
      source: { kind: 'assistant', assistantSeq: 1 },
      eventSeq: 1,
    }
    const field: TavernJourneyField = {
      id: 'fact:ledger',
      label: '天气',
      value: fact.text,
      factId: fact.factId,
      origin: 'fact',
    }

    const projection = projectLedger(undefined, [field], { people: {}, world: [fact] }, translate)

    expect(projection.world).toHaveLength(1)
    expect(projection.world[0]?.name).toBe('天气')
    expect(projection.world[0]?.items[0]?.value).toBe('海风转冷。')
    expect(projection.world[0]?.items[0]?.fact?.factId).toBe(fact.factId)
  })

  it('routes rendered fact ledger edits and removals to the supplied callbacks', async () => {
    const fact: TavernFactEntry = {
      factId: 'fact:rendered-ledger' as TavernFactEntry['factId'],
      target: 'world',
      label: 'weather',
      text: 'Cold sea wind.',
      source: { kind: 'assistant', assistantSeq: 1 },
      eventSeq: 1,
    }
    const onEdit = vi.fn(async () => {})
    const onRemove = vi.fn(async () => {})

    render(<TavernLedger
      characterFields={undefined}
      worldFields={[{ id: 'fact:rendered-ledger', label: 'weather', value: fact.text, factId: fact.factId, origin: 'fact' }]}
      facts={{ people: {}, world: [fact] }}
      t={translate}
      onEdit={onEdit}
      onRemove={onRemove}
      sectionNames={{}}
      hiddenSections={new Set()}
      sectionOrder={{ character: [], world: ['world:weather'] }}
      onRenameSection={() => {}}
      onDeleteSection={() => {}}
      onReorderSections={() => {}}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit: weather' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Fact text' }), { target: { value: 'Warmer sea wind.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save edit: weather' }))
    await waitFor(() => { expect(onEdit).toHaveBeenCalledWith('fact:rendered-ledger', 'Warmer sea wind.') })
    fireEvent.click(screen.getByRole('button', { name: 'Revoke: weather' }))
    await waitFor(() => { expect(onRemove).toHaveBeenCalledWith('fact:rendered-ledger') })
  })
})
