/** Browser Tavern foundation plugin: one optional conversation inspection tab. */

import type { Context } from '@deepseek-ai/cordis'
import type { ISessions, SessionId, IWorkspaces } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {
  ChatViewInjected,
  ChatViewSlotProps,
  ConversationChatView,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-trajectory/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {
  AssetSelection,
  CharacterAsset,
  PromptAssetBaseline,
  StoryStateChange,
  TavernImportOptions,
  TavernMemoryEntry,
  TavernMemoryInput,
  TavernMessageEditInput,
  TavernMessageEditResult,
  TavernRegenerateInput,
  TavernRegenerateResult,
  TavernSelectionInspection,
  TavernSessionSelection,
  TavernStoryStateInspection,
  TavernSwipeInspection,
  TavernSwipeSelectionInput,
  TavernUpdateOptions,
  WorldInfoAsset,
} from '@deepseek-ai/dsh-tavern-host/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { createElement } from 'react'
import { tavernAssetsRemote } from './remote.ts'
import { en, NS, zh } from './locales.ts'
import { TavernGreetingNodeView, tavernGreetingDefinition } from './greeting.tsx'
import { TavernView } from './TavernView.tsx'
import { TavernShell } from './TavernShell.tsx'
import { TavernEditAction } from './TavernEditAction.tsx'

/** Services required by the optional conversation view and locale registry. */
export const inject = ['slots', 'sessions', 'workspaces', 'locale', 'remote', 'conversationChatView', 'conversationEvents']

const SURFACE_CHANGE_EVENT = 'dsh:surface-change'

function mountTavernSurface(): () => void {
  const root = document.documentElement
  const previous = root.dataset.dshSurface
  root.dataset.dshSurface = 'tavern'
  window.dispatchEvent(new Event(SURFACE_CHANGE_EVENT))
  return () => {
    if (previous === undefined) delete root.dataset.dshSurface
    else root.dataset.dshSurface = previous
    window.dispatchEvent(new Event(SURFACE_CHANGE_EVENT))
  }
}

function startTavernSession(sessions: ISessions, workspaces: IWorkspaces): () => void {
  let creating = false
  let disposed = false
  const reconcile = (): void => {
    if (disposed || creating) return
    const state = sessions.list.getSnapshot()
    const workspaceState = workspaces.list.getSnapshot()
    if (state.phase !== 'ready' || workspaceState.phase !== 'ready') return
    const existing = state.ids
      .map(id => state.byId[id])
      .find(summary => summary?.agentPreset === 'tavern')
    if (existing !== undefined) {
      const current = state.current === undefined ? undefined : state.byId[state.current]
      if (state.current !== existing.id && (state.current === undefined || current?.blank === true)) {
        sessions.open(existing.id)
      }
      return
    }
    if (state.current !== undefined && state.byId[state.current]?.blank !== true) return
    const existingWorkspace = workspaceState.items.find(item => item.workspaceId === workspaceState.recentWorkspaceId)
      ?? workspaceState.items[0]
    creating = true
    const workspace = existingWorkspace === undefined
      ? workspaces.create({ path: '.' })
      : Promise.resolve(existingWorkspace)
    void workspace.then(target => workspaces.connectWorkspace(target.workspaceId)).then((sessionId) => {
      const latest = sessions.list.getSnapshot()
      const current = latest.current === undefined ? undefined : latest.byId[latest.current]
      if (!disposed && (latest.current === undefined || current?.blank === true)) sessions.open(sessionId)
    }).finally(() => { creating = false })
  }
  const disposeSessions = sessions.list.subscribe(reconcile)
  const disposeWorkspaces = workspaces.list.subscribe(reconcile)
  reconcile()
  return () => {
    disposed = true
    disposeSessions()
    disposeWorkspaces()
  }
}

/** Typed direct Remote namespace mounted by this optional UI package. */
export type TavernAssetsRemote = {
  editMessage: (sessionId: SessionId, input: TavernMessageEditInput) => Promise<RemoteResult<TavernMessageEditResult>>
  exportCharacter: (id: CharacterAsset['id']) => Promise<RemoteResult<string>>
  exportWorldInfo: (id: WorldInfoAsset['id']) => Promise<RemoteResult<string>>
  importCharacter: (input: string, options?: TavernImportOptions) => Promise<RemoteResult<CharacterAsset>>
  importWorldInfo: (input: string, options?: TavernImportOptions) => Promise<RemoteResult<WorldInfoAsset>>
  inspectSelection: (selection: AssetSelection) => Promise<RemoteResult<TavernSelectionInspection>>
  inspectSession: (sessionId: SessionId) => Promise<RemoteResult<TavernSessionSelection | null>>
  inspectStoryState: (sessionId: SessionId) => Promise<RemoteResult<TavernStoryStateInspection>>
  inspectSwipe: (sessionId: SessionId) => Promise<RemoteResult<TavernSwipeInspection>>
  listCharacters: () => Promise<RemoteResult<readonly CharacterAsset[]>>
  listMemory: (sessionId: SessionId) => Promise<RemoteResult<readonly TavernMemoryEntry[]>>
  listWorldInfo: () => Promise<RemoteResult<readonly WorldInfoAsset[]>>
  regenerate: (sessionId: SessionId, input: TavernRegenerateInput) => Promise<RemoteResult<TavernRegenerateResult>>
  remember: (sessionId: SessionId, input: TavernMemoryInput) => Promise<RemoteResult<TavernMemoryEntry>>
  select: (selection: AssetSelection) => Promise<RemoteResult<PromptAssetBaseline>>
  selectForSession: (sessionId: SessionId, selection: AssetSelection) => Promise<RemoteResult<TavernSessionSelection>>
  selectSwipe: (sessionId: SessionId, input: TavernSwipeSelectionInput) => Promise<RemoteResult<TavernSwipeInspection>>
  setStoryState: (sessionId: SessionId, change: StoryStateChange) => Promise<RemoteResult<TavernStoryStateInspection>>
  updateCharacter: (input: string, options: TavernUpdateOptions) => Promise<RemoteResult<CharacterAsset>>
  updateWorldInfo: (input: string, options: TavernUpdateOptions) => Promise<RemoteResult<WorldInfoAsset>>
}

/**
 * Register the Tavern foundation view after the conversation slot exists.
 * @param ctx - browser Cordis context.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposeSurface = mountTavernSurface()
  const disposeRemote = await ctx.remote.$mount(tavernAssetsRemote)
  const tavernAssets = ctx.reflect.get('remote.tavernAssets') as TavernAssetsRemote
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-tavern: dictionaries')
  const t = ctx.locale.bind(NS)
  const conversationT = ctx.locale.bind('conversation')
  const chatView = ctx.conversationChatView
  chatView.setDefaultView?.('tavern')
  ctx.effect(() => startTavernSession(ctx.sessions, ctx.workspaces), 'ui-tavern: startup session')
  ctx.conversationEvents.register(tavernGreetingDefinition)
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'tavern-greeting',
    locale: 'conversation',
  }, TavernGreetingNodeView))
  ctx.slots.inject('conversation.chat.user-actions', () => ctx.slots.register({
    name: 'conversation.chat.user-actions',
    id: 'tavern-edit-message',
    locale: NS,
  }, (props: Omit<Parameters<typeof TavernEditAction>[0], 'tavernAssets'>) => createElement(
    TavernEditAction,
    { ...props, tavernAssets },
  )))
  ctx.slots.inject('tavern', () => ctx.slots.register({
    name: 'tavern',
    locale: NS,
    inject: (): {
      openSession: (sessionId: SessionId) => void
      createSession: () => void
    } => ({
      openSession: (sessionId) => { ctx.sessions.open(sessionId) },
      createSession: () => { ctx.workspaces.startSession() },
    }),
  }, TavernShell))
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'tavern',
    order: 20,
    renderWhenBlank: true,
    locale: NS,
    label: () => t('view.tavern'),
    store: chatView.store,
    inject: (sessionId: SessionId, actions): ChatViewInjected & {
      tavernAssets: TavernAssetsRemote
      conversationT: ChatViewSlotProps['t']
      chatView: ConversationChatView['component']
      openSession: (sessionId: SessionId) => void
    } => {
      if (ctx.sessions.binding(sessionId) === undefined) {
        throw new Error(`ui-tavern: session "${sessionId}" is unavailable`)
      }
      return {
        ...chatView.inject(sessionId, actions),
        tavernAssets,
        conversationT,
        chatView: chatView.component,
        openSession: (nextSessionId) => { ctx.sessions.open(nextSessionId) },
      }
    },
  }, TavernView))

  return async () => {
    disposeSurface()
    chatView.setDefaultView?.(undefined)
    await disposeRemote()
  }
}
