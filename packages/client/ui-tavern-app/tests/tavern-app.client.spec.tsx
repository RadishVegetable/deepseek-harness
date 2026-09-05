// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { CharacterAsset, WorldInfoAsset } from '@deepseek-ai/dsh-tavern-host/client'
import type { ConversationSnapshot, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { en, zh, type TavernAppKey } from '../src/client/locales.ts'
import type { TavernAppProps } from '../src/client/TavernApp.tsx'
import { TavernApp } from '../src/client/TavernApp.tsx'
import { TavernJourney } from '../src/client/TavernJourney.tsx'
import { navigateTavern } from '../src/client/navigation.ts'

afterEach(() => {
  cleanup()
  navigateTavern({ name: 'library' }, true)
  activeLocale = 'en'
  locale.setLocale.mockClear()
})

const character = {
  kind: 'character',
  id: 'test-character',
  name: 'Aster',
  version: { format: 'test', revision: 1 },
  sourceReferences: [],
  sourceData: {},
  description: 'A careful archivist.',
  personality: '',
  scenario: '',
  firstMessage: '',
  creatorNotes: '',
  messageExamples: '',
  alternateGreetings: [],
  systemPrompt: '',
  postHistoryInstructions: '',
  characterBook: null,
  extensions: {},
} as unknown as CharacterAsset

const worldInfo = {
  kind: 'world-info',
  id: 'test-world',
  name: 'The Archive',
  version: { format: 'test', revision: 1 },
  sourceReferences: [],
  sourceData: {},
  scanDepth: null,
  tokenBudget: null,
  recursiveScanning: false,
  entries: [],
  extensions: {},
} as unknown as WorldInfoAsset

interface AppOptions {
  readonly listCharacters?: () => Promise<unknown>
  readonly listWorldInfo?: () => Promise<unknown>
  readonly importCharacter?: (input: string, options?: unknown) => Promise<unknown>
  readonly importWorldInfo?: (input: string, options?: unknown) => Promise<unknown>
  readonly deleteAsset?: (id: string) => Promise<unknown>
}

let activeLocale: 'en' | 'zh' = 'en'

const translate = ((key: TavernAppKey, params?: Record<string, unknown>): string => {
  let value = (activeLocale === 'en' ? en : zh)[key]
  for (const [name, replacement] of Object.entries(params ?? {})) value = value.replaceAll(`{${name}}`, String(replacement))
  return value
}) as TavernAppProps['t']

const locale = {
  getLocale: () => ({ active: activeLocale, locales: [], revision: 0 }),
  setLocale: vi.fn((id: string) => { activeLocale = id as 'en' | 'zh' }),
}

function renderApp({
  listCharacters = async () => ({ ok: true, value: [character] }),
  listWorldInfo = async () => ({ ok: true, value: [] }),
  importCharacter = async () => ({ ok: true, value: character }),
  importWorldInfo = async () => ({ ok: true, value: worldInfo }),
  deleteAsset = async () => ({ ok: true, value: true }),
}: AppOptions = {}) {
  const sessionList = {
    ids: [],
    byId: {},
    current: undefined,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
  const workspaceList = { archivedSessionIds: [], phase: 'ready' }
  const tavernAssets = {
    listCharacters,
    listWorldInfo,
    importCharacter,
    importWorldInfo,
    deleteAsset,
  }
  const props = {
    useSessions: <T,>(selector: (value: typeof sessionList) => T): T => selector(sessionList),
    useWorkspaces: <T,>(selector: (value: typeof workspaceList) => T): T => selector(workspaceList),
    renderSlot: () => null,
    tavernAssets,
    sessions: {},
    locale,
    t: translate,
  } as unknown as TavernAppProps

  return render(<TavernApp {...props} />)
}

function renderArchiveApp({
  inspectArchivedHistory = vi.fn(async () => ({
    ok: true as const,
    value: {
      sessionId: 'journey-archive' as SessionId,
      selection: null,
      characterName: 'Aster',
      lastContent: 'The archived opening.',
    },
  })),
}: {
  readonly inspectArchivedHistory?: () => Promise<unknown>
} = {}) {
  const journeyId = 'journey-archive' as SessionId
  const currentSession: SessionId | undefined = journeyId
  const summary = {
    id: journeyId,
    displayTitle: 'Aster Journey',
    agentPreset: 'tavern',
    blank: false,
    updatedAt: 1,
  }
  const sessionList: {
    ids: SessionId[]
    byId: Record<string, typeof summary>
    current: SessionId | undefined
    phase: string
    subagentsByParent: Record<string, never>
    jobsBySession: Record<string, never>
    currentAddress: undefined
  } = {
    ids: [journeyId],
    byId: { [journeyId]: summary },
    current: currentSession,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
  const workspaceList: { archivedSessionIds: SessionId[]; phase: string } = { archivedSessionIds: [], phase: 'ready' }
  const tavernAssets = {
    listCharacters: async () => ({ ok: true as const, value: [character] }),
    listWorldInfo: async () => ({ ok: true as const, value: [] as WorldInfoAsset[] }),
    archiveHistory: vi.fn(async () => {
      workspaceList.archivedSessionIds = [journeyId]
      sessionList.ids = []
      Reflect.deleteProperty(sessionList.byId, journeyId)
      sessionList.current = undefined
      return { ok: true as const, value: undefined }
    }),
    inspectArchivedHistory,
    restoreHistory: vi.fn(async () => {
      workspaceList.archivedSessionIds = []
      sessionList.ids = [journeyId]
      sessionList.byId[journeyId] = summary
      return { ok: true as const, value: undefined }
    }),
  }
  const sessions = {
    clear: vi.fn(() => {
      sessionList.current = undefined
    }),
    open: vi.fn((sessionId: typeof journeyId) => {
      sessionList.current = sessionId
    }),
  }
  const props = {
    useSessions: <T,>(selector: (value: typeof sessionList) => T): T => selector(sessionList),
    useWorkspaces: <T,>(selector: (value: typeof workspaceList) => T): T => selector(workspaceList),
    renderSlot: () => <section aria-label="Tavern transcript">Tavern transcript</section>,
    tavernAssets,
    sessions,
    locale,
    t: translate,
  } as unknown as TavernAppProps

  navigateTavern({ name: 'library' }, true)
  render(<TavernApp {...props} />)
  return { journeyId, tavernAssets, workspaceList }
}

describe('Tavern journey setup dialog', () => {
  it('renders Journey copy from the locale seat after switching to Chinese', async () => {
    const sessionId = 'journey-locale' as SessionId
    const snapshot = {
      sessionId,
      nodes: [],
      partial: null,
      running: false,
      removed: false,
      openState: 'open',
      openError: null,
      lastAgentError: null,
      promptError: null,
    } as unknown as ConversationSnapshot
    const session = { prompt: vi.fn(), cancel: vi.fn() }
    const props = {
      sessionId,
      useSession: <T,>(selector: (value: ConversationSnapshot) => T): T => selector(snapshot),
      route: 'journey',
      onNavigateToLibrary: vi.fn(),
      tavernAssets: { inspectJourneyAssets: async () => ({ ok: true as const, value: null }) },
      sessions: { binding: () => ({ sessionId, session }) },
      t: translate,
    } as unknown as Parameters<typeof TavernJourney>[0]

    activeLocale = 'en'
    const view = render(<TavernJourney {...props} />)
    expect(await screen.findByText('ACTIVE JOURNEY')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy()

    activeLocale = 'zh'
    view.rerender(<TavernJourney {...props} />)
    expect(await screen.findByText('进行中的 JOURNEY')).toBeTruthy()
    expect(screen.getByRole('button', { name: '发送' })).toBeTruthy()
    expect(screen.queryByText('ACTIVE JOURNEY')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
  })

  it('renders the durable Character Card greeting before conversation messages', async () => {
    const sessionId = 'journey-greeting' as SessionId
    const snapshot = {
      sessionId,
      nodes: [],
      partial: null,
      running: false,
      removed: false,
      openState: 'open',
      openError: null,
      lastAgentError: null,
      promptError: null,
    } as unknown as ConversationSnapshot
    const session = { prompt: vi.fn(), cancel: vi.fn() }
    const props = {
      sessionId,
      useSession: <T,>(selector: (value: ConversationSnapshot) => T): T => selector(snapshot),
      route: 'journey',
      onNavigateToLibrary: vi.fn(),
      tavernAssets: {
        inspectJourneyAssets: async () => ({
          ok: true as const,
          value: {
            character: { name: 'Aster', scenario: '' },
            characterName: 'Aster',
            worldInfo: [],
            openingGreeting: {
              characterId: 'test-character',
              characterName: 'Aster',
              text: 'The archive door opens before you knock.',
              selectionSeq: 0,
            },
          },
        }),
      },
      sessions: { binding: () => ({ sessionId, session }) },
      t: translate,
    } as unknown as Parameters<typeof TavernJourney>[0]

    render(<TavernJourney {...props} />)

    expect(await screen.findByText('The archive door opens before you knock.')).toBeTruthy()
    expect(screen.queryByText('Nothing has been written here yet.')).toBeNull()
  })

  it('renders Journey messages as Markdown', () => {
    const sessionId = 'journey-markdown' as SessionId
    const snapshot = {
      sessionId,
      nodes: [{
        kind: 'assistant',
        seq: 1,
        time: 1,
        blocks: [{ kind: 'text', text: '# The archive\n\n- A brass key\n- **A sealed door**' }],
      }],
      partial: null,
      running: false,
      removed: false,
      openState: 'open',
      openError: null,
      lastAgentError: null,
      promptError: null,
    } as unknown as ConversationSnapshot
    const session = { prompt: vi.fn(), cancel: vi.fn() }
    const props = {
      sessionId,
      useSession: <T,>(selector: (value: ConversationSnapshot) => T): T => selector(snapshot),
      route: 'journey',
      onNavigateToLibrary: vi.fn(),
      tavernAssets: { inspectJourneyAssets: async () => ({ ok: true as const, value: null }) },
      sessions: { binding: () => ({ sessionId, session }) },
      t: translate,
    } as unknown as Parameters<typeof TavernJourney>[0]

    render(<TavernJourney {...props} />)

    expect(screen.getByRole('heading', { name: 'The archive' })).toBeTruthy()
    expect(screen.getByText('A brass key')).toBeTruthy()
    expect(screen.getByText('A sealed door').tagName).toBe('STRONG')
  })

  it('writes the selected locale and restores it when the settings route is revisited', async () => {
    renderApp()
    navigateTavern({ name: 'settings' }, true)

    const language = await screen.findByLabelText('Choose the Tavern interface language')
    expect(language).toHaveProperty('value', 'en')
    fireEvent.change(language, { target: { value: 'zh' } })
    expect(locale.setLocale).toHaveBeenCalledWith('zh')

    navigateTavern({ name: 'library' })
    navigateTavern({ name: 'settings' })
    expect(await screen.findByRole('heading', { name: '布置这间房间。' })).toBeTruthy()
    expect(screen.getByLabelText('选择 Tavern 界面语言')).toHaveProperty('value', 'zh')
    expect(screen.getByRole('button', { name: '图书馆' })).toBeTruthy()
  })

  it('keeps an accepted user message visible and makes a terminal GM failure actionable', async () => {
    const sessionId = 'journey-failed-turn' as SessionId
    const prompt = vi.fn(async () => ({ ok: true as const, value: { accepted: true as const } }))
    const snapshot = {
      sessionId,
      nodes: [
        {
          kind: 'user',
          seq: 2,
          time: 2,
          content: [{ type: 'text', text: 'Say hello briefly.' }],
          source: { kind: 'user' },
        },
        {
          kind: 'turn-error',
          seq: 5,
          time: 5,
          turn: 1,
          step: 0,
          message: 'The GM could not respond.',
          code: 'provider-error',
        },
      ],
      partial: null,
      running: false,
      removed: false,
      openState: 'open',
      openError: null,
      lastAgentError: null,
      promptError: null,
    } as unknown as ConversationSnapshot
    const session = { prompt, cancel: vi.fn() }
    const props = {
      sessionId,
      useSession: <T,>(selector: (value: ConversationSnapshot) => T): T => selector(snapshot),
      route: 'journey',
      journeyId: sessionId,
      onNavigateToLibrary: vi.fn(),
      tavernAssets: { inspectJourneyAssets: async () => ({ ok: true as const, value: null }) },
      sessions: { binding: () => ({ sessionId, session }) },
      t: translate,
    } as unknown as Parameters<typeof TavernJourney>[0]

    render(<TavernJourney {...props} />)

    expect(screen.getByText('Say hello briefly.')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('The GM could not respond.')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => {
      expect(prompt).toHaveBeenCalledWith([{ type: 'text', text: 'Say hello briefly.' }], 'queue')
    })
  })

  it('focuses the dialog, traps Tab, and closes on Escape without starting', async () => {
    renderApp()
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Begin with Aster' })).toBeTruthy() })

    fireEvent.click(screen.getByRole('button', { name: 'Begin with Aster' }))
    const close = screen.getByRole('button', { name: 'Close setup' })
    expect(document.activeElement).toBe(close)

    screen.getByRole('button', { name: 'Library' }).focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(document.activeElement).toBe(close)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('button', { name: 'Close setup' })).toBeNull()
  })

  it('shows a visible library error when asset loading rejects', async () => {
    renderApp({ listCharacters: async () => { throw new Error('asset transport failed') } })

    expect((await screen.findAllByRole('alert')).map(element => element.textContent)).toEqual([
      'asset transport failed',
      'asset transport failed',
    ])
    expect(screen.queryByText('Loading asset library...')).toBeNull()
  })

  it('clears an invalid-route notice before explicit library and Journey navigation', async () => {
    const { journeyId } = renderArchiveApp()
    const invalidNotice = 'That Journey is no longer available. Returning to the library.'

    navigateTavern({ name: 'journey', journeyId: 'missing-journey' as SessionId }, true)
    expect(await screen.findByText(invalidNotice)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Library' }))
    expect(screen.queryByText(invalidNotice)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Aster JourneyUpdated/ }))
    expect(await screen.findByLabelText('Tavern transcript')).toBeTruthy()
    expect(screen.queryByText(invalidNotice)).toBeNull()
    expect(window.location.hash).toBe(`#journey/${journeyId}`)
  })

  it('keeps both import actions reachable from an empty library without a generic composer', async () => {
    const view = renderApp({
      listCharacters: async () => ({ ok: true, value: [] }),
      listWorldInfo: async () => ({ ok: true, value: [] }),
    })

    expect(await screen.findByRole('button', { name: 'Import Character Card' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Import World Book' })).toBeTruthy()
    const characterInput = view.container.querySelector('input[data-asset-kind="character"]')
    if (!(characterInput instanceof HTMLInputElement)) throw new Error('character file input is missing')
    expect(characterInput.getAttribute('aria-hidden')).toBe('true')
    expect(characterInput.tabIndex).toBe(-1)
    expect(screen.queryByRole('button', { name: 'Choose File' })).toBeNull()
    const chooseCharacter = vi.spyOn(characterInput, 'click')
    fireEvent.click(screen.getByRole('button', { name: 'Import Character Card' }))
    expect(chooseCharacter).toHaveBeenCalledOnce()
    expect(screen.queryByLabelText('Speak to the GM')).toBeNull()
  })

  it('imports a Character Card JSON file and updates the Library list', async () => {
    const importCharacter = vi.fn(async () => ({ ok: true as const, value: character }))
    const view = renderApp({
      listCharacters: async () => ({ ok: true, value: [] }),
      importCharacter,
    })
    await screen.findByRole('button', { name: 'Import Character Card' })

    const input = view.container.querySelector('input[data-asset-kind="character"]')
    if (!(input instanceof HTMLInputElement)) throw new Error('character file input is missing')
    fireEvent.change(input, { target: { files: [new File(['{}'], 'aster.json', { type: 'application/json' })] } })

    await waitFor(() => { expect(importCharacter).toHaveBeenCalledOnce() })
    expect(importCharacter).toHaveBeenCalledWith('{}', {
      source: { kind: 'upload', locator: 'aster.json', mediaType: 'application/json' },
    })
    expect(await screen.findByText('Aster')).toBeTruthy()
  })

  it('refreshes both typed asset lists after a successful import', async () => {
    let characterListCalls = 0
    const listCharacters = vi.fn(async () => {
      characterListCalls += 1
      return { ok: true as const, value: characterListCalls === 1 ? [] : [character] }
    })
    const listWorldInfo = vi.fn(async () => ({ ok: true as const, value: [] }))
    const view = renderApp({ listCharacters, listWorldInfo })
    await screen.findByRole('button', { name: 'Import Character Card' })

    const input = view.container.querySelector('input[data-asset-kind="character"]')
    if (!(input instanceof HTMLInputElement)) throw new Error('character file input is missing')
    fireEvent.change(input, { target: { files: [new File(['{}'], 'aster.json', { type: 'application/json' })] } })

    expect(await screen.findByText('Aster')).toBeTruthy()
    expect(listCharacters).toHaveBeenCalledTimes(2)
    expect(listWorldInfo).toHaveBeenCalledTimes(2)
  })

  it('shows World Book import errors and permits a retry', async () => {
    const importWorldInfo = vi.fn()
      .mockResolvedValueOnce({ ok: false as const, error: { message: 'World Book JSON is invalid' } })
      .mockResolvedValueOnce({ ok: true as const, value: worldInfo })
    const view = renderApp({
      listCharacters: async () => ({ ok: true, value: [character] }),
      importWorldInfo,
    })
    await screen.findByRole('button', { name: 'Import World Book' })

    const input = view.container.querySelector('input[data-asset-kind="world-info"]')
    if (!(input instanceof HTMLInputElement)) throw new Error('World Book file input is missing')
    const file = () => new File(['{}'], 'archive.json', { type: 'application/json' })
    fireEvent.change(input, { target: { files: [file()] } })
    expect((await screen.findByRole('alert')).textContent).toContain('World Book JSON is invalid')

    fireEvent.change(input, { target: { files: [file()] } })
    expect(await screen.findByText('The Archive')).toBeTruthy()
    expect(importWorldInfo).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('button', { name: 'Begin with Aster' }))
    expect(screen.getByRole('checkbox', { name: /The Archive/ })).toBeTruthy()
  })

  it('does not call a Remote when file selection is cancelled and reports invalid JSON', async () => {
    const importCharacter = vi.fn(async () => ({ ok: true as const, value: character }))
    const view = renderApp({
      listCharacters: async () => ({ ok: true, value: [] }),
      importCharacter,
    })
    await screen.findByRole('button', { name: 'Import Character Card' })

    const input = view.container.querySelector('input[data-asset-kind="character"]')
    if (!(input instanceof HTMLInputElement)) throw new Error('character file input is missing')
    fireEvent.change(input, { target: { files: [] } })
    expect(importCharacter).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { files: [new File(['not-json'], 'broken.json', { type: 'application/json' })] } })
    expect((await screen.findByRole('alert')).textContent).toContain('Unexpected token')
    expect(importCharacter).not.toHaveBeenCalled()
  })

  it('confirms Character Card deletion, updates the list immediately, and announces success', async () => {
    let resolveDelete: ((value: unknown) => void) | undefined
    const deleteAsset = vi.fn(() => new Promise<unknown>((resolve) => { resolveDelete = resolve }))
    renderApp({ deleteAsset })
    const deleteButton = await screen.findByRole('button', { name: 'Delete Character Card “Aster”' })

    fireEvent.click(deleteButton)
    expect(deleteAsset).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog').textContent).toContain('Character Card “Aster”')
    fireEvent.click(screen.getByRole('button', { name: 'Delete asset' }))
    expect(screen.getByRole('button', { name: 'Deleting...' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Keep asset' }).hasAttribute('disabled')).toBe(true)

    await waitFor(() => { expect(deleteAsset).toHaveBeenCalledWith(character.id) })
    resolveDelete?.({ ok: true, value: true })
    await waitFor(() => { expect(screen.queryByRole('heading', { name: 'Aster' })).toBeNull() })
    expect(screen.getByRole('status').textContent).toContain('Character Card “Aster” was deleted.')
  })

  it('cancels World Book deletion without calling the Remote', async () => {
    const deleteAsset = vi.fn(async () => ({ ok: true as const, value: true as const }))
    renderApp({ listWorldInfo: async () => ({ ok: true as const, value: [worldInfo] }), deleteAsset })
    fireEvent.click(await screen.findByRole('button', { name: 'Delete World Book “The Archive”' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep asset' }))

    expect(deleteAsset).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'The Archive' })).toBeTruthy()
  })

  it('keeps a failed deletion open with the raw Host error and a recovery action', async () => {
    const deleteAsset = vi.fn(async () => ({ ok: false as const, error: { message: 'storage-failure: permission denied' } }))
    renderApp({ deleteAsset })
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Character Card “Aster”' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete asset' }))

    expect((await screen.findByRole('alert')).textContent).toContain('storage-failure: permission denied')
    expect(screen.getByRole('heading', { name: 'Aster' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Keep asset' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Keep asset' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders the delete confirmation copy in Chinese', async () => {
    renderApp()
    navigateTavern({ name: 'settings' }, true)
    fireEvent.change(await screen.findByLabelText('Choose the Tavern interface language'), { target: { value: 'zh' } })
    navigateTavern({ name: 'library' })

    fireEvent.click(await screen.findByRole('button', { name: '删除角色卡“Aster”' }))
    expect(screen.getByRole('heading', { name: '删除这项资产？' })).toBeTruthy()
    expect(screen.getByRole('dialog').textContent).toContain('角色卡“Aster”将从 Tavern 资产库中删除')
    expect(screen.getByRole('button', { name: '保留资产' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '删除资产' })).toBeTruthy()
  })

  it('archives a Journey, keeps the success notice, lists it in History, and restores it', async () => {
    const { journeyId, tavernAssets } = renderArchiveApp()

    await screen.findByRole('button', { name: 'Archive Aster Journey' })
    fireEvent.click(screen.getByRole('button', { name: 'Archive Aster Journey' }))
    fireEvent.click(screen.getByRole('button', { name: 'Archive Journey' }))

    expect(await screen.findByText('Journey archived. Its transcript remains available in History.')).toBeTruthy()
    expect(screen.queryByLabelText('Speak to the GM')).toBeNull()
    expect(screen.queryByText('That Journey is no longer available. Returning to the library.')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'History' }))
    expect(await screen.findByText('Aster')).toBeTruthy()
    expect(tavernAssets.inspectArchivedHistory).toHaveBeenCalledWith(journeyId)
    expect(await screen.findByText('The archived opening.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Restore and open' }))
    expect(await screen.findByLabelText('Tavern transcript')).toBeTruthy()
    expect(window.location.hash).toBe('#journey/journey-archive')
  })

  it('does not let a stale History inspection populate a later visit', async () => {
    let resolveHistory: ((value: unknown) => void) | undefined
    const inspectArchivedHistory = vi.fn(() => new Promise<unknown>((resolve) => { resolveHistory = resolve }))
    const { journeyId, workspaceList } = renderArchiveApp({ inspectArchivedHistory })
    workspaceList.archivedSessionIds = [journeyId]

    navigateTavern({ name: 'history' })
    expect(await screen.findByText('Loading Journey...')).toBeTruthy()
    expect(inspectArchivedHistory).toHaveBeenCalledOnce()

    navigateTavern({ name: 'settings' })
    resolveHistory?.({
      ok: true,
      value: { sessionId: journeyId, selection: null, characterName: 'Stale', lastContent: 'Stale transcript.' },
    })

    navigateTavern({ name: 'history' })
    expect(await screen.findByText('Loading Journey...')).toBeTruthy()
    expect(inspectArchivedHistory).toHaveBeenCalledTimes(2)
  })
})
