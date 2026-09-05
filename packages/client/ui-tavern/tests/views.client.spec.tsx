// @vitest-environment jsdom
/** Real client composition and rendered prompt summary for the Tavern view. */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ComponentType } from 'react'
import { EMPTY_CHAT_SNAPSHOT, SlotRegistry, createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ConversationSnapshot, RequestView, SessionId, SessionListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  AssetId,
  AssetSelection,
  CharacterAsset,
  TavernFactInspection,
  TavernHistoryEntry,
  TavernJourneyAssetProjection,
  TavernSessionSelection,
  WorldInfoAsset,
} from '@deepseek-ai/dsh-tavern-host/client'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as localeApply, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import type { ChatStore, ChatStoreState, ChatViewInjected, ChatViewSlotProps, ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, inject } from '../src/client/index.ts'
import { TavernView } from '../src/client/TavernView.tsx'
import { en } from '../src/client/locales.ts'
import type { TavernAssetsRemote, TavernContextActivation } from '../src/client/index.ts'
import { setTavernSection } from '../src/client/navigation.ts'
import type { TrajectorySnapshot } from '@deepseek-ai/dsh-client-ui-trajectory/client'

const SID = 'tavern-test' as SessionId
const CHARACTER = {
  kind: 'character',
  id: 'aster' as AssetId,
  name: 'Aster',
  version: { format: 'character-card-v2', revision: 1 },
  sourceReferences: [],
  sourceData: {},
  description: 'A quiet archivist who keeps the last lighthouse lit.',
  personality: 'Observant and patient.',
  scenario: 'The harbor is waiting for a storm.',
  firstMessage: 'The lighthouse door opens before you knock.',
  creatorNotes: '',
  messageExamples: '',
  alternateGreetings: [],
  systemPrompt: '',
  postHistoryInstructions: '',
  characterBook: null,
  extensions: {},
} satisfies CharacterAsset

const WORLD_INFO = {
  kind: 'world-info',
  id: 'guilder' as AssetId,
  name: 'YMLv2',
  version: { format: 'world-info-v2', revision: 1 },
  sourceReferences: [],
  sourceData: {},
  scanDepth: 50,
  tokenBudget: 2_000,
  recursiveScanning: false,
  entries: [{
    id: 'guilder.chandra' as AssetId,
    keys: ['Chandra'],
    secondaryKeys: [],
    selective: true,
    constant: false,
    useRegex: false,
    matchWholeWords: true,
    caseSensitive: false,
    useProbability: true,
    content: 'Name: Chandra\nType: character\nAppearance: Red hair and bronze skin.',
    enabled: true,
    position: 'before-character',
    depth: 4,
    order: 1,
    recursive: false,
    probability: 100,
    group: null,
    sticky: null,
    cooldown: null,
    extensions: {},
  }],
  extensions: {},
} satisfies WorldInfoAsset

const CHARACTER_WITH_BOOK = { ...CHARACTER, characterBook: WORLD_INFO } satisfies CharacterAsset

const request: Extract<RequestView, { purpose: 'assistant' }> = {
  purpose: 'assistant',
  turn: 1,
  step: 1,
  startSeq: 4,
  startedAt: 1_000,
  completedAt: 2_000,
  status: 'complete',
  provenance: { provider: 'test-provider', model: 'test-model' },
  usage: { cacheReadTokens: 12, cacheWriteTokens: 3 },
  prompt: {
    config: { provider: 'test-provider', model: 'test-model' },
    system: 'The kingdom is east of the river.',
    tools: [],
  },
}

const trajectory: TrajectorySnapshot = {
  eventNodes: [],
  eventLocations: new Map(),
  requests: [request],
  callSchemas: new Map(),
  partial: null,
  runningCalls: [],
}

const snapshot: ConversationSnapshot = {
  sessionId: SID,
  views: { get: () => trajectory },
  chat: EMPTY_CHAT_SNAPSHOT,
  nodes: [],
  turnTimings: new Map(),
  turnEnds: new Map(),
  partial: null,
  runningCalls: [],
  pending: [],
  queue: [],
  running: false,
  subagent: null,
  composerPhase: 'active',
  removed: false,
  openState: 'open',
  openError: null,
  hasMore: false,
  loadingOlder: false,
  promptError: null,
  blank: false,
  lastAgentError: null,
}

afterEach(() => {
  vi.useRealTimers()
  cleanup()
  setTavernSection('story')
})

function makeViewProps(
  listCharacters: () => Promise<unknown> = async () => ({ ok: true, value: [] }),
  options: {
    listWorldInfo?: () => readonly WorldInfoAsset[]
    selection?: TavernSessionSelection | null
    journeyProjection?: TavernJourneyAssetProjection | null
    contextActivation?: TavernContextActivation | null
    bootstrapFactProjection?: TavernFactInspection['projection']
    importCharacter?: () => Promise<unknown>
    importWorldInfo?: () => Promise<unknown>
    facts?: TavernFactInspection
    history?: {
      readonly summary: { readonly id: SessionId; readonly displayTitle: string; readonly updatedAt: number }
      readonly entry: TavernHistoryEntry
    }
    historyList?: readonly {
      readonly summary: { readonly id: SessionId; readonly displayTitle: string; readonly updatedAt: number }
      readonly entry: TavernHistoryEntry
    }[]
    inspectHistory?: () => Promise<unknown>
    openSession?: (sessionId: SessionId) => void
    archiveHistory?: (sessionId: SessionId) => Promise<unknown>
    archiveSession?: (sessionId: SessionId) => Promise<void>
    bootstrapJourney?: (sessionId: SessionId, selection: AssetSelection, playerIdentity?: string | null) => Promise<unknown>
    inspectJourneyAssets?: () => Promise<unknown>
  } = {},
) {
  const store = createSnapshotStore(snapshot)
  const histories = options.historyList ?? (options.history === undefined ? [] : [options.history])
  const useSession = <T,>(selector: (value: ConversationSnapshot) => T): T => selector(store.getSnapshot())
  const chatState: ChatStoreState = { selection: null, draft: '', view: null, inspect: null }
  const useStore = <T,>(selector: (value: ChatStoreState) => T): T => selector(chatState)
  const useSessions = <T,>(selector: (value: SessionListState) => T): T => selector({
    ids: histories.map(history => history.summary.id),
    byId: Object.fromEntries(histories.map(history => [history.summary.id, {
      ...history.summary,
      agentPreset: 'tavern',
      blank: false,
      running: false,
    }])),
    current: undefined,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  })
  const selectForSession = vi.fn(async (_sessionId: SessionId, selection: AssetSelection) => ({
    ok: true as const,
    value: {
      selection,
      baseline: { characterSections: [], worldInfoEntries: [], references: [] },
      character: null,
      worldInfo: [],
      characterName: null,
      worldInfoNames: [],
    },
  }))
  const bootstrapJourney = vi.fn(options.bootstrapJourney ?? (async (
    _sessionId: SessionId,
    selection: AssetSelection,
    playerIdentity?: string | null,
  ) => ({
    ok: true as const,
    value: {
      selection: {
        selection,
        baseline: { characterSections: [], worldInfoEntries: [], references: [] },
        character: null,
        worldInfo: [],
        characterName: null,
        worldInfoNames: [],
        playerIdentity: playerIdentity ?? null,
      },
      factProjection: options.bootstrapFactProjection ?? { people: {}, world: [] },
    },
  })))
  const props = {
    sessionId: SID,
    useSession,
    useSessions,
    useStore,
    actions: {} as never,
    useWorkspaces: (() => undefined) as never,
    useProjection: (() => undefined) as never,
    useInput: (() => undefined) as never,
    inputActions: {} as never,
    tavernAssets: {
      listCharacters,
      listWorldInfo: async () => ({ ok: true, value: options.listWorldInfo?.() ?? [] }),
      inspectSession: async () => ({ ok: true, value: options.selection ?? null }),
      inspectSwipe: async () => ({ ok: true, value: { groups: [], issues: [] } }),
      inspectFacts: async () => ({ ok: true, value: options.facts ?? { projection: { people: {}, world: [] }, records: [] } }),
      inspectJourneyAssets: options.inspectJourneyAssets ?? (async () => ({ ok: true, value: options.journeyProjection ?? null })),
      inspectContextActivation: async () => ({ ok: true, value: options.contextActivation ?? null }),
      inspectHistory: options.inspectHistory ?? (async (requestedId?: SessionId) => ({
        ok: true,
        value: histories.find(history => history.summary.id === requestedId)?.entry
          ?? histories[0]?.entry
          ?? { sessionId: SID, character: null, characterName: null, lastContent: null },
      })),
      archiveHistory: options.archiveHistory ?? (async () => ({ ok: true, value: undefined })),
      bootstrapJourney,
      selectForSession,
      importCharacter: options.importCharacter ?? (async () => ({ ok: true, value: CHARACTER })),
      importWorldInfo: options.importWorldInfo ?? (async () => ({ ok: true, value: WORLD_INFO })),
    } as unknown as TavernAssetsRemote,
    chatView: (() => null) as never,
    openSession: options.openSession ?? (() => {}),
    archiveSession: options.archiveSession ?? (async () => {}),
    createSession: () => {},
    openDetails: () => {},
    openFile: () => {},
    loadOlder: () => {},
    loadImage: async () => '',
    inspectCall: () => {},
    chatScroll: { save: () => {}, read: () => null },
    forkAt: () => {},
    fileMentions: () => undefined,
    renderChatNode: (() => null) as never,
    renderSlot: (() => null) as never,
    conversationT: (key: string) => en[key as keyof typeof en] ?? key,
    t: (key: string) => en[key as keyof typeof en] ?? key,
  } satisfies ConvViewProps & PropsStore<ChatStore> & ChatViewInjected & PropsLocale<'tavern'> & {
    tavernAssets: TavernAssetsRemote
    conversationT: ChatViewSlotProps['t']
    chatView: ComponentType<ChatViewSlotProps>
    renderSlot: unknown
    openSession: (sessionId: SessionId) => void
    createSession: () => void
    archiveSession: (sessionId: SessionId) => Promise<void>
  }
  return { props, store, bootstrapJourney, selectForSession }
}

describe('Tavern foundation client plugin', () => {
  it('shows Tavern history cards and opens a selected journey from the history page', async () => {
    setTavernSection('home')
    const openSession = vi.fn()
    const historySelection: TavernSessionSelection = {
      selection: { characterId: CHARACTER.id, worldInfoIds: [] },
      baseline: {
        selection: { characterId: CHARACTER.id, worldInfoIds: [] },
        characterSections: [],
        worldInfoEntries: [],
        references: [],
      },
      character: CHARACTER,
      worldInfo: [],
      characterName: CHARACTER.name,
      worldInfoNames: [],
    }
    const historyEntry: TavernHistoryEntry = {
      sessionId: 'history-session' as SessionId,
      selection: historySelection,
      character: CHARACTER,
      characterName: CHARACTER.name,
      lastContent: 'The last lantern burns beside the harbor gate.',
    }
    const { props } = makeViewProps(async () => ({ ok: true, value: [] }), {
      history: {
        summary: { id: historyEntry.sessionId, displayTitle: 'Harbor night', updatedAt: 1_735_689_600_000 },
        entry: historyEntry,
      },
      openSession,
    })

    render(<TavernView {...props} />)

    // The entrance heading actions include a history anchor button, so the
    // title legitimately appears more than once on the home surface.
    expect((await screen.findAllByText('Journey history')).length).toBeGreaterThan(0)
    expect(screen.getByText('The last lantern burns beside the harbor gate.')).toBeTruthy()
    expect(screen.getByText('Last played')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open journey: Aster' }))
    expect(openSession).toHaveBeenCalledWith(historyEntry.sessionId)
    expect(screen.getByRole('main').getAttribute('data-tavern-mode')).toBe('journey')
    expect(screen.queryByText('Meet someone first. Then enter their world.')).toBeNull()
    expect(screen.getByRole('region', { name: 'Roleplay conversation' })).toBeTruthy()
  })

  it('switches from one history journey to another through the same open target', async () => {
    setTavernSection('home')
    const firstId = 'history-first' as SessionId
    const secondId = 'history-second' as SessionId
    const openSession = vi.fn()
    const historyList = [firstId, secondId].map((sessionId, index) => ({
      summary: { id: sessionId, displayTitle: `Journey ${index + 1}`, updatedAt: 1_735_689_600_000 - index },
      entry: {
        sessionId,
        selection: null,
        character: null,
        characterName: `Character ${index + 1}`,
        lastContent: `History content ${index + 1}`,
      },
    }))
    const { props } = makeViewProps(async () => ({ ok: true, value: [] }), { historyList, openSession })

    render(<TavernView {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open journey: Character 1' }))
    setTavernSection('home')
    fireEvent.click(await screen.findByRole('button', { name: 'Open journey: Character 2' }))

    expect(openSession.mock.calls).toEqual([[firstId], [secondId]])
  })

  it('deletes a history card through the non-destructive session archive operation', async () => {
    setTavernSection('home')
    const archiveHistory = vi.fn(async () => ({ ok: true as const, value: undefined }))
    const openSession = vi.fn()
    const historyEntry: TavernHistoryEntry = {
      sessionId: 'deletable-history' as SessionId,
      selection: null,
      character: null,
      characterName: null,
      lastContent: 'A record to remove from the history view.',
    }
    const { props } = makeViewProps(async () => ({ ok: true, value: [] }), {
      history: {
        summary: { id: historyEntry.sessionId, displayTitle: 'Old journey', updatedAt: 1_735_689_600_000 },
        entry: historyEntry,
      },
      archiveHistory,
      openSession,
    })

    const view = render(<TavernView {...props} />)

    const deleteButton = await screen.findByRole('button', { name: 'Delete journey: Old journey' })
    fireEvent.click(deleteButton)
    await waitFor(() => { expect(archiveHistory).toHaveBeenCalledWith(historyEntry.sessionId) })
    expect(openSession).not.toHaveBeenCalled()
    await waitFor(() => { expect(screen.queryByText('A record to remove from the history view.')).toBeNull() })
    view.rerender(<TavernView {...props} />)
    expect(screen.queryByRole('button', { name: 'Open journey: Old journey' })).toBeNull()
  })

  it('keeps a history card and reports the Remote reason when archive fails', async () => {
    setTavernSection('home')
    const archiveHistory = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'conflict', message: 'session is still running', details: { sessionId: 'busy-history' } },
    }))
    const openSession = vi.fn()
    const historyEntry: TavernHistoryEntry = {
      sessionId: 'busy-history' as SessionId,
      selection: null,
      character: null,
      characterName: null,
      lastContent: 'This journey must remain visible.',
    }
    const { props } = makeViewProps(async () => ({ ok: true, value: [] }), {
      history: {
        summary: { id: historyEntry.sessionId, displayTitle: 'Busy journey', updatedAt: 1_735_689_600_000 },
        entry: historyEntry,
      },
      archiveHistory,
      openSession,
    })

    render(<TavernView {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete journey: Busy journey' }))

    expect((await screen.findByRole('alert')).textContent).toContain('session is still running')
    expect(screen.getByRole('button', { name: 'Open journey: Busy journey' })).toBeTruthy()
    expect(openSession).not.toHaveBeenCalled()
  })

  it('keeps a history card visible when its cold inspection fails', async () => {
    setTavernSection('home')
    const historyEntry: TavernHistoryEntry = {
      sessionId: 'unreadable-history' as SessionId,
      selection: null,
      character: null,
      characterName: null,
      lastContent: null,
    }
    const { props } = makeViewProps(async () => ({ ok: true, value: [] }), {
      history: {
        summary: { id: historyEntry.sessionId, displayTitle: 'Unreadable journey', updatedAt: 1_735_689_600_000 },
        entry: historyEntry,
      },
      inspectHistory: async () => ({ ok: false, error: { message: 'cold read failed' } }),
    })

    render(<TavernView {...props} />)

    expect(await screen.findByRole('button', { name: 'Open journey: Unreadable journey' })).toBeTruthy()
    expect(screen.getByText('Some journeys are temporarily unavailable.')).toBeTruthy()
  })

  it('registers and disposes its conversation view on the real slot registry', async () => {
    const ctx = new Context()
    const slots = new SlotRegistry(ctx)
    const tavernAssets = {}
    const chatView = () => null
    const sessionState = {
      ids: ['standard-blank', 'tavern-blank'] as SessionId[],
      byId: {
        'standard-blank': { id: 'standard-blank', displayTitle: 'Standard', running: false, blank: true, updatedAt: 1 },
        'tavern-blank': { id: 'tavern-blank', displayTitle: 'Tavern', running: false, blank: true, agentPreset: 'tavern', updatedAt: 2 },
      },
      current: 'standard-blank' as SessionId,
      phase: 'ready' as const,
      subagentsByParent: {},
      jobsBySession: {},
      currentAddress: undefined,
    }
    const listeners = new Set<() => void>()
    const open = vi.fn((id: SessionId) => {
      sessionState.current = id
      for (const listener of listeners) listener()
    })
    slots.register({
      name: 'root',
      children: {
        'conversation.view': { kind: 'list', scope: 'session' },
        'tavern': { kind: 'single', scope: 'root' },
      },
    }, (_props: { renderSlot?: unknown }) => null)
    ctx.provide('sessions', {
      binding: () => ({}),
      list: {
        getSnapshot: () => sessionState,
        subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      },
      open,
      create: vi.fn(async () => 'tavern-created' as SessionId),
    } as never)
    ctx.provide('workspaces', {
      list: {
        getSnapshot: () => ({
          items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
          baselinesReady: true, recentWorkspaceId: undefined,
        }),
        subscribe: () => () => {},
      },
    } as never)
    ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
    ctx.provide('remote', {
      $mount: async () => async () => {},
      $on: () => () => {},
    } as never)
    ctx.provide('remote.tavernAssets', tavernAssets as never)
    ctx.provide('conversationEvents', { register: () => () => {} } as never)
    ctx.provide('conversationChatView', {
      store: {} as never,
      component: chatView as never,
      inject: () => ({}) as never,
    } as never)
    ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    ctx.plugin({ inject: [...localeInject], apply: localeApply })
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(open).toHaveBeenCalledWith('tavern-blank')

    const entry = slots.entries('conversation.view')[0]
    expect(entry?.options.id).toBe('tavern')
    expect(entry?.inject).toBeTypeOf('function')
    const injected = entry?.inject as ((sessionId: SessionId, actions: unknown) => {
      tavernAssets: unknown
      chatView: unknown
    })
    expect(injected(SID, {})).toMatchObject({ tavernAssets })
    expect(injected(SID, {}).chatView).toBe(chatView)
    const shell = slots.entries('tavern')[0]
    expect(shell).toBeDefined()
    const openShellSession = (shell?.inject as (() => { openSession: (id: SessionId) => void }))()
    openShellSession.openSession(SID)
    expect(open).toHaveBeenCalledWith(SID)
    await fiber.dispose()
    expect(slots.entries('conversation.view')).toEqual([])
  })

  it('renders the character-first entrance without rewriting the snapshot', async () => {
    const { props, store } = makeViewProps(async () => ({ ok: true, value: [CHARACTER] }))

    render(<TavernView {...props} />)

    expect(screen.getByRole('heading', { name: 'Meet someone first. Then enter their world.' })).toBeTruthy()
    expect(await screen.findByRole('button', { name: /Aster/ })).toBeTruthy()
    expect(screen.getAllByRole('img', { name: 'A rainy tavern scene' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('img', { name: 'Current character portrait' }).length).toBeGreaterThan(0)
    const identityInput = screen.getByPlaceholderText('Give yourself a name or role')
    expect(identityInput).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Begin Journey' })).toHaveProperty('disabled', true)
    fireEvent.change(identityInput, { target: { value: 'The harbor cartographer' } })
    expect((identityInput as HTMLInputElement).value).toBe('The harbor cartographer')
    fireEvent.click(screen.getByRole('button', { name: /Aster/ }))
    expect(screen.getAllByText('A quiet archivist who keeps the last lighthouse lit.').length).toBeGreaterThan(1)
    expect(screen.queryByText('Tavern assets could not be loaded. Try again later.')).toBeNull()
    expect(screen.queryByText('Runtime status')).toBeNull()
    expect(store.getSnapshot()).toBe(snapshot)
    expect(en['entrance.start']).toBe('Begin Journey')
  })

  it('keeps library access secondary to the entrance flow', () => {
    const { props } = makeViewProps()

    render(<TavernView {...props} />)

    expect(screen.getByRole('button', { name: 'Tavern library' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Import JSON or PNG' })).toBeTruthy()
    expect(screen.queryByText('Prompt inspection')).toBeNull()
  })

  it('reports a host loading failure without calling it an import failure', async () => {
    const { props } = makeViewProps(async () => ({ ok: false, error: { message: 'offline' } }))

    render(<TavernView {...props} />)

    expect(await screen.findByText('Tavern assets could not be loaded. Try again later.')).toBeTruthy()
    expect(screen.queryByText('Could not import this JSON or PNG file.')).toBeNull()
  })

  it('shows world people and opens both person and world details', async () => {
    const selection: TavernSessionSelection = {
      selection: { characterId: CHARACTER_WITH_BOOK.id, worldInfoIds: [WORLD_INFO.id] },
      baseline: {
        selection: { characterId: CHARACTER_WITH_BOOK.id, worldInfoIds: [WORLD_INFO.id] },
        characterSections: [],
        worldInfoEntries: [],
        references: [],
      },
      character: CHARACTER_WITH_BOOK,
      worldInfo: [WORLD_INFO],
      characterName: CHARACTER_WITH_BOOK.name,
      worldInfoNames: [WORLD_INFO.name],
    }
    const { props } = makeViewProps(async () => ({ ok: true, value: [CHARACTER_WITH_BOOK] }), {
      listWorldInfo: () => [WORLD_INFO],
      selection,
    })

    render(<TavernView {...props} />)

    expect(screen.queryByText('Character facts')).toBeNull()
    expect(screen.queryByText('World facts')).toBeNull()
    expect(screen.queryByText('Add column')).toBeNull()
    const personButton = await screen.findByRole('button', { name: /Chandra/ })
    fireEvent.click(personButton)
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getAllByRole('heading', { name: 'Chandra' }).length).toBeGreaterThan(0)
    expect(within(dialog).getByRole('button', { name: /YMLv2/ })).toBeTruthy()
    expect(dialog.textContent).not.toContain('Story facts')
    expect(within(dialog).queryByRole('button', { name: /Revoke/ })).toBeNull()

    fireEvent.click(within(dialog).getByRole('button', { name: /YMLv2/ }))
    expect(screen.getByRole('heading', { name: 'YMLv2' })).toBeTruthy()
    const worldDialog = screen.getByRole('dialog')
    expect(worldDialog.textContent).toContain('Name: Chandra')
    expect(worldDialog.textContent).not.toContain('Story facts')
    expect(within(worldDialog).queryByRole('button', { name: 'Edit world content' })).toBeTruthy()
    expect(within(worldDialog).queryByRole('button', { name: /Revoke/ })).toBeNull()
  })

  it('shows current world content and opens the asset editor without opening the world detail', async () => {
    const selection: TavernSessionSelection = {
      selection: { characterId: CHARACTER_WITH_BOOK.id, worldInfoIds: [WORLD_INFO.id] },
      baseline: {
        selection: { characterId: CHARACTER_WITH_BOOK.id, worldInfoIds: [WORLD_INFO.id] },
        characterSections: [],
        worldInfoEntries: [],
        references: [],
      },
      character: CHARACTER_WITH_BOOK,
      worldInfo: [WORLD_INFO],
      characterName: CHARACTER_WITH_BOOK.name,
      worldInfoNames: [WORLD_INFO.name],
    }
    const { props } = makeViewProps(
      async () => ({ ok: true, value: [CHARACTER_WITH_BOOK] }),
      { listWorldInfo: () => [WORLD_INFO], selection },
    )
    render(<TavernView {...props} />)

    expect(await screen.findByText(WORLD_INFO.name)).toBeTruthy()
    const aside = screen.getByRole('complementary')
    expect(screen.queryByText('角色事实')).toBeNull()
    expect(screen.queryByText('世界事实')).toBeNull()
    expect(screen.queryByRole('button', { name: '新增栏目' })).toBeNull()
    expect(within(aside).getAllByText((_, element) => element?.textContent?.includes('Red hair and bronze skin.') ?? false).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Edit world content' }))
    expect(screen.getByRole('dialog', { name: 'Tavern library' })).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: WORLD_INFO.name })).toBeNull()
  })

  it('renders Journey projection fields in Character and world person details', async () => {
    const selection: TavernSessionSelection = {
      selection: { characterId: CHARACTER_WITH_BOOK.id, worldInfoIds: [WORLD_INFO.id] },
      baseline: {
        selection: { characterId: CHARACTER_WITH_BOOK.id, worldInfoIds: [WORLD_INFO.id] },
        characterSections: [],
        worldInfoEntries: [],
        references: [],
      },
      character: CHARACTER_WITH_BOOK,
      worldInfo: [WORLD_INFO],
      characterName: CHARACTER_WITH_BOOK.name,
      worldInfoNames: [WORLD_INFO.name],
    }
    const journeyProjection: TavernJourneyAssetProjection = {
      ...selection,
      characterFields: [{
        id: 'journey:character:role',
        sourceAssetId: CHARACTER_WITH_BOOK.id,
        label: 'Role',
        value: 'Keeper of the lighthouse',
        origin: 'asset',
      }],
      worldFields: [{
        id: 'journey:world:secret',
        sourceAssetId: WORLD_INFO.id,
        sourceEntryId: WORLD_INFO.entries.at(0)?.id ?? ('guilder.chandra' as AssetId),
        label: 'Secret',
        value: 'The lighthouse is a decoy.',
        origin: 'asset',
      }],
      people: [{
        personId: 'person:chandra' as never,
        name: 'Chandra',
        source: {
          assetId: WORLD_INFO.id,
          entryId: WORLD_INFO.entries.at(0)?.id ?? ('guilder.chandra' as AssetId),
        },
        content: WORLD_INFO.entries[0]?.content ?? '',
        fields: [{
          id: 'journey:world:secret',
          sourceAssetId: WORLD_INFO.id,
          sourceEntryId: WORLD_INFO.entries.at(0)?.id ?? ('guilder.chandra' as AssetId),
          label: 'Secret',
          value: 'The lighthouse is a decoy.',
          origin: 'asset',
        }],
        facts: [],
      }],
      facts: { people: {}, world: [] },
    }
    const { props } = makeViewProps(async () => ({ ok: true, value: [CHARACTER_WITH_BOOK] }), {
      listWorldInfo: () => [WORLD_INFO],
      selection,
      journeyProjection,
    })

    render(<TavernView {...props} />)

    fireEvent.click((await screen.findAllByRole('button', { name: /Aster/ }))[0] as HTMLElement)
    expect(screen.getByRole('dialog').textContent).toContain('Keeper of the lighthouse')
    fireEvent.click(screen.getByRole('button', { name: /Chandra/ }))
    expect(screen.getByRole('dialog').textContent).toContain('The lighthouse is a decoy.')
  })

  it('projects labeled Journey facts into dynamic fields and creates new people', async () => {
    const selection: TavernSessionSelection = {
      selection: { characterId: CHARACTER_WITH_BOOK.id, worldInfoIds: [] },
      baseline: {
        selection: { characterId: CHARACTER_WITH_BOOK.id, worldInfoIds: [] },
        characterSections: [],
        worldInfoEntries: [],
        references: [],
      },
      character: CHARACTER_WITH_BOOK,
      worldInfo: [],
      characterName: CHARACTER_WITH_BOOK.name,
      worldInfoNames: [],
    }
    const fact: TavernFactInspection['projection']['world'][number] = {
      factId: 'fact:1:1' as never,
      target: 'world',
      text: 'The player carries the Dragon Heart relic.',
      label: 'Relic',
      source: { kind: 'assistant', assistantSeq: 3 },
      eventSeq: 4,
      assistantSeq: 3,
      turn: 1,
    }
    const personFact: TavernFactInspection['projection']['world'][number] = {
      factId: 'fact:1:2' as never,
      target: 'person',
      personId: 'person:lyra' as never,
      text: 'Lyra secretly serves the player.',
      label: 'Secret',
      source: { kind: 'assistant', assistantSeq: 3 },
      eventSeq: 5,
      assistantSeq: 3,
      turn: 1,
    }
    const { props } = makeViewProps(async () => ({ ok: true, value: [CHARACTER_WITH_BOOK] }), {
      selection,
      facts: { projection: { people: { 'person:lyra': [personFact] }, world: [fact] }, records: [] },
    })

    render(<TavernView {...props} />)

    const personButton = await screen.findByRole('button', { name: /Lyra/ })
    fireEvent.click(personButton)
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByText('Secret:')).toBeNull()
    expect(within(dialog).queryByText('Lyra secretly serves the player.')).toBeNull()
  })

  it('uses the latest Journey Name fact for an existing world person', async () => {
    const selection: TavernSessionSelection = {
      selection: { characterId: CHARACTER_WITH_BOOK.id, worldInfoIds: [WORLD_INFO.id] },
      baseline: {
        selection: { characterId: CHARACTER_WITH_BOOK.id, worldInfoIds: [WORLD_INFO.id] },
        characterSections: [],
        worldInfoEntries: [],
        references: [],
      },
      character: CHARACTER_WITH_BOOK,
      worldInfo: [WORLD_INFO],
      characterName: CHARACTER_WITH_BOOK.name,
      worldInfoNames: [WORLD_INFO.name],
    }
    const nameFact: TavernFactInspection['projection']['world'][number] = {
      factId: 'fact:rename:1' as never,
      target: 'person',
      personId: 'person:chandra' as never,
      text: '梅迪',
      label: 'Name',
      source: { kind: 'assistant', assistantSeq: 7 },
      eventSeq: 8,
      assistantSeq: 7,
      turn: 3,
    }
    const { props } = makeViewProps(async () => ({ ok: true, value: [CHARACTER_WITH_BOOK] }), {
      listWorldInfo: () => [WORLD_INFO],
      selection,
      facts: { projection: { people: { 'person:chandra': [nameFact] }, world: [] }, records: [] },
    })

    render(<TavernView {...props} />)

    const personButton = await screen.findByRole('button', { name: /梅迪/ })
    fireEvent.click(personButton)
    expect(screen.getAllByRole('heading', { name: '梅迪' }).length).toBeGreaterThan(0)
    expect(screen.getByText('Name:')).toBeTruthy()
  })

  it('renders the recorded Journey character snapshot instead of a changed library asset', async () => {
    const libraryCharacter = { ...CHARACTER, description: 'The mutable library description.' }
    const selection: TavernSessionSelection = {
      selection: { characterId: CHARACTER.id, worldInfoIds: [] },
      baseline: {
        selection: { characterId: CHARACTER.id, worldInfoIds: [] },
        characterSections: [],
        worldInfoEntries: [],
        references: [],
      },
      character: CHARACTER,
      worldInfo: [],
      characterName: CHARACTER.name,
      worldInfoNames: [],
    }
    const { props } = makeViewProps(async () => ({ ok: true, value: [libraryCharacter] }), { selection })

    render(<TavernView {...props} />)

    expect(await screen.findByText('A quiet archivist who keeps the last lighthouse lit.')).toBeTruthy()
    expect(screen.queryByText('The mutable library description.')).toBeNull()
  })

  it('uses the Host Journey projection for details after the source library changes', async () => {
    const libraryCharacter = { ...CHARACTER, description: 'The mutable library description.' }
    const selection: TavernSessionSelection = {
      selection: { characterId: CHARACTER.id, worldInfoIds: [] },
      baseline: {
        selection: { characterId: CHARACTER.id, worldInfoIds: [] },
        characterSections: [],
        worldInfoEntries: [],
        references: [],
      },
      character: CHARACTER,
      worldInfo: [],
      characterName: CHARACTER.name,
      worldInfoNames: [],
    }
    const journeyProjection: TavernJourneyAssetProjection = {
      ...selection,
      character: { ...CHARACTER, description: 'The Journey-local character description.' },
      characterName: CHARACTER.name,
      people: [],
      characterFields: [{
        id: 'journey:character:description',
        sourceAssetId: CHARACTER.id,
        label: 'Description',
        value: 'The Journey-local character description.',
        origin: 'asset',
      }],
      worldFields: [],
      facts: { people: {}, world: [] },
    }
    const { props } = makeViewProps(async () => ({ ok: true, value: [libraryCharacter] }), {
      selection,
      journeyProjection,
    })

    render(<TavernView {...props} />)

    const identity = (await screen.findAllByRole('button', { name: /Aster/ }))[0] as HTMLElement
    fireEvent.click(identity)
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('The Journey-local character description.')
    expect(dialog.textContent).not.toContain('The mutable library description.')
  })

  it('provides a mobile people and world entry that opens the same details', async () => {
    const selection: TavernSessionSelection = {
      selection: { characterId: CHARACTER_WITH_BOOK.id, worldInfoIds: [WORLD_INFO.id] },
      baseline: {
        selection: { characterId: CHARACTER_WITH_BOOK.id, worldInfoIds: [WORLD_INFO.id] },
        characterSections: [],
        worldInfoEntries: [],
        references: [],
      },
      character: CHARACTER_WITH_BOOK,
      worldInfo: [WORLD_INFO],
      characterName: CHARACTER_WITH_BOOK.name,
      worldInfoNames: [WORLD_INFO.name],
    }
    const { props } = makeViewProps(async () => ({ ok: true, value: [CHARACTER_WITH_BOOK] }), {
      listWorldInfo: () => [WORLD_INFO],
      selection,
    })

    render(<TavernView {...props} />)

    fireEvent.click(await screen.findByRole('button', { name: 'People and world' }))
    const dialog = screen.getByRole('dialog', { name: 'People and world' })
    expect(within(dialog).getByRole('button', { name: /Chandra/ })).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: /Chandra/ }))
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('Chandra')
    expect(screen.getByRole('dialog').textContent).toContain('Chandra')
  })

  it('keeps an imported World Info in the entrance draft until a character is selected', async () => {
    let listedWorldInfo: readonly WorldInfoAsset[] = []
    const listWorldInfo = vi.fn(() => listedWorldInfo)
    const importWorldInfo = vi.fn(async () => {
      listedWorldInfo = [WORLD_INFO]
      return { ok: true as const, value: WORLD_INFO }
    })
    const { props, bootstrapJourney, selectForSession } = makeViewProps(async () => ({ ok: true, value: [] }), {
      listWorldInfo,
      importWorldInfo,
    })
    const { container } = render(<TavernView {...props} />)
    const input = container.querySelector('input[type="file"]')
    if (!(input instanceof HTMLInputElement)) throw new Error('Tavern file input was not rendered')

    fireEvent.change(input, {
      target: {
        files: [new File([JSON.stringify({ entries: {} })], 'YMLv2.json', { type: 'application/json' })],
      },
    })

    await waitFor(() =>{  expect(importWorldInfo).toHaveBeenCalledOnce() })
    await waitFor(() =>{  expect(listWorldInfo).toHaveBeenCalledTimes(2) })
    await waitFor(() =>{  expect(screen.getAllByText('YMLv2').length).toBeGreaterThan(0) })
    expect(container.querySelector('[data-tavern-mode="entrance"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Begin Journey' })).toHaveProperty('disabled', true)
    expect(bootstrapJourney).not.toHaveBeenCalled()
    expect(selectForSession).not.toHaveBeenCalled()
  })

  it('keeps an imported Character Card in the entrance draft until the journey starts', async () => {
    let listedCharacters: readonly CharacterAsset[] = []
    const listCharacters = vi.fn(async () => ({ ok: true as const, value: listedCharacters }))
    const importCharacter = vi.fn(async () => {
      listedCharacters = [CHARACTER]
      return { ok: true as const, value: CHARACTER }
    })
    const { props, bootstrapJourney, selectForSession } = makeViewProps(listCharacters, { importCharacter })
    const { container } = render(<TavernView {...props} />)
    const input = container.querySelector('input[type="file"]')
    if (!(input instanceof HTMLInputElement)) throw new Error('Tavern file input was not rendered')

    fireEvent.change(input, {
      target: {
        files: [new File([JSON.stringify({ spec: 'chara_card_v2', data: { name: 'Aster' } })], 'Aster.json', { type: 'application/json' })],
      },
    })

    await waitFor(() =>{  expect(importCharacter).toHaveBeenCalledOnce() })
    await waitFor(() =>{  expect(screen.getByRole('button', { name: /Aster/ }).getAttribute('data-selected')).toBe('true') })
    expect(container.querySelector('[data-tavern-mode="entrance"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Begin Journey' })).toHaveProperty('disabled', false)
    expect(bootstrapJourney).not.toHaveBeenCalled()
    expect(selectForSession).not.toHaveBeenCalled()

    fireEvent.change(screen.getByPlaceholderText('Give yourself a name or role'), { target: { value: 'The harbor cartographer' } })
    fireEvent.click(screen.getByRole('button', { name: 'Begin Journey' }))
    await waitFor(() =>{
      expect(bootstrapJourney).toHaveBeenCalledWith(
        SID,
        { characterId: CHARACTER.id, worldInfoIds: [] },
        'The harbor cartographer',
      )
    })
    await waitFor(() => { expect(container.querySelector('[data-tavern-mode="journey"]')).not.toBeNull() })
    expect(selectForSession).not.toHaveBeenCalled()
  })

  it('surfaces a structured bootstrap rejection and unlocks the entrance', async () => {
    let listedCharacters: readonly CharacterAsset[] = []
    const listCharacters = vi.fn(async () => ({ ok: true as const, value: listedCharacters }))
    const importCharacter = vi.fn(async () => {
      listedCharacters = [CHARACTER]
      return { ok: true as const, value: CHARACTER }
    })
    const bootstrapJourney = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'internal', message: 'bootstrap rejected', details: { field: 'result' } },
    }))
    const { props } = makeViewProps(listCharacters, { importCharacter, bootstrapJourney })
    const { container } = render(<TavernView {...props} />)
    const input = container.querySelector('input[type="file"]')
    if (!(input instanceof HTMLInputElement)) throw new Error('Tavern file input was not rendered')

    fireEvent.change(input, {
      target: { files: [new File([JSON.stringify({ spec: 'chara_card_v2', data: { name: 'Aster' } })], 'Aster.json', { type: 'application/json' })] },
    })
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Begin Journey' })).toHaveProperty('disabled', false) })
    fireEvent.click(screen.getByRole('button', { name: 'Begin Journey' }))
    await waitFor(() => { expect(bootstrapJourney).toHaveBeenCalledOnce() })
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Begin Journey' })).toHaveProperty('disabled', false) })
    expect(screen.getByText(/bootstrap rejected/)).toBeTruthy()
    expect(container.querySelector('[data-tavern-mode="entrance"]')).not.toBeNull()
  })

  it.each(['bootstrap', 'inspection'] as const)('times out a pending %s Remote and unlocks the entrance', async (stage) => {
    const pending = new Promise<unknown>(() => {})
    const bootstrapJourney = stage === 'bootstrap'
      ? vi.fn(() => pending)
      : undefined
    const inspectJourneyAssets = stage === 'inspection'
      ? vi.fn(() => pending)
      : undefined
    const { props } = makeViewProps(async () => ({ ok: true as const, value: [CHARACTER] }), {
      ...(bootstrapJourney === undefined ? {} : { bootstrapJourney }),
      ...(inspectJourneyAssets === undefined ? {} : { inspectJourneyAssets }),
    })
    const { container } = render(<TavernView {...props} />)

    fireEvent.click(await screen.findByRole('button', { name: /Aster/ }))
    const start = screen.getByRole('button', { name: 'Begin Journey' })
    expect(start).toHaveProperty('disabled', false)
    vi.useFakeTimers()
    fireEvent.click(start)
    expect(screen.getByRole('button', { name: 'Starting journey…' })).toHaveProperty('disabled', true)

    await act(async () => { await vi.advanceTimersByTimeAsync(5_001) })

    expect(screen.getByRole('button', { name: 'Begin Journey' })).toHaveProperty('disabled', false)
    expect(screen.getByRole('alert').textContent).toContain('timed out')
    expect(container.querySelector('[data-tavern-mode="entrance"]')).not.toBeNull()
  })

})
