// @vitest-environment jsdom
/** Real client composition and rendered prompt summary for the Tavern view. */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ComponentType } from 'react'
import { EMPTY_CHAT_SNAPSHOT, SlotRegistry, createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ConversationSnapshot, RequestView, SessionId, SessionListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { AssetSelection } from '@deepseek-ai/dsh-tavern-host/client'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as localeApply, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import type { ChatStore, ChatStoreState, ChatViewInjected, ChatViewSlotProps, ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, inject } from '../src/client/index.ts'
import { TavernView } from '../src/client/TavernView.tsx'
import { en } from '../src/client/locales.ts'
import type { TavernAssetsRemote } from '../src/client/index.ts'
import type { TrajectorySnapshot } from '@deepseek-ai/dsh-client-ui-trajectory/client'

const SID = 'tavern-test' as SessionId

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

afterEach(cleanup)

function makeViewProps(listCharacters: () => Promise<unknown> = async () => ({ ok: true, value: [] })) {
  const store = createSnapshotStore(snapshot)
  const useSession = <T,>(selector: (value: ConversationSnapshot) => T): T => selector(store.getSnapshot())
  const chatState: ChatStoreState = { selection: null, draft: '', view: null, inspect: null }
  const useStore = <T,>(selector: (value: ChatStoreState) => T): T => selector(chatState)
  const useSessions = <T,>(selector: (value: SessionListState) => T): T => selector({
    ids: [],
    byId: {},
    current: undefined,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  })
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
      listWorldInfo: async () => ({ ok: true, value: [] }),
      inspectSession: async () => ({ ok: true, value: null }),
      inspectSwipe: async () => ({ ok: true, value: { groups: [], issues: [] } }),
      selectForSession: async (_sessionId: SessionId, selection: AssetSelection) => ({
        ok: true,
        value: {
          selection,
          baseline: { characterSections: [], worldInfoEntries: [], references: [] },
          characterName: null,
          worldInfoNames: [],
        },
      }),
    } as unknown as TavernAssetsRemote,
    chatView: (() => null) as never,
    openSession: () => {},
    openDetails: () => {},
    openFile: () => {},
    loadOlder: () => {},
    loadImage: async () => '',
    inspectCall: () => {},
    chatScroll: { save: () => {}, read: () => null },
    forkAt: () => {},
    fileMentions: () => undefined,
    renderChatNode: (() => null) as never,
    conversationT: (key: string) => en[key as keyof typeof en] ?? key,
    t: (key: string) => en[key as keyof typeof en] ?? key,
  } satisfies ConvViewProps & PropsStore<ChatStore> & ChatViewInjected & PropsLocale<'tavern'> & {
    tavernAssets: TavernAssetsRemote
    conversationT: ChatViewSlotProps['t']
    chatView: ComponentType<ChatViewSlotProps>
    openSession: (sessionId: SessionId) => void
  }
  return { props, store }
}

describe('Tavern foundation client plugin', () => {
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
    expect(document.documentElement.dataset.dshSurface).toBe('tavern')
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
    expect(document.documentElement.dataset.dshSurface).toBeUndefined()
  })

  it('renders the recorded system prompt and cache totals without rewriting the snapshot', async () => {
    const { props, store } = makeViewProps()

    render(<TavernView {...props} />)

    expect(screen.getByText('Runtime status')).toBeTruthy()
    expect(screen.queryByText('Tavern assets could not be loaded. Try again later.')).toBeNull()
    expect(await screen.findByText('12')).toBeTruthy()
    expect(await screen.findByText('3')).toBeTruthy()
    expect(screen.getByText('The kingdom is east of the river.')).toBeTruthy()
    expect(store.getSnapshot()).toBe(snapshot)
    expect(en['prompt.system']).toBe('System prompt')
  })

  it('renders the independent Tavern workspace navigation', () => {
    const { props } = makeViewProps()

    render(<TavernView {...props} />)

    expect(screen.getByRole('tab', { name: 'Roleplay' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Tavern library' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Prompt inspection' })).toBeTruthy()
  })

  it('reports a host loading failure without calling it an import failure', async () => {
    const { props } = makeViewProps(async () => ({ ok: false, error: { message: 'offline' } }))

    render(<TavernView {...props} />)

    expect(await screen.findByText('Tavern assets could not be loaded. Try again later.')).toBeTruthy()
    expect(screen.queryByText('Could not import this JSON or PNG file.')).toBeNull()
  })
})
