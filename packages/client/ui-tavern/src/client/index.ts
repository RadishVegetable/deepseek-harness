/** Browser Tavern foundation plugin: one optional conversation inspection tab. */

import type { Context } from '@deepseek-ai/cordis'
import type { ISessions, SessionId, IWorkspaces } from '@deepseek-ai/dsh-client-runtime/client'
import type { AssetId } from '@deepseek-ai/dsh-tavern-host/client'
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
  TavernFactEditInput,
  TavernFactEntry,
  TavernFactInspection,
  TavernFactRemovalInput,
  TavernGmResponseInspection,
  TavernHistoryEntry,
  TavernBootstrapJourneyResult,
  TavernJourneyAssetProjection,
  TavernMessageEditInput,
  TavernMessageEditResult,
  TavernRegenerateInput,
  TavernRegenerateResult,
  TavernSelectionInspection,
  TavernSectionConfigInput,
  TavernSectionConfigInspection,
  TavernSessionSelection,
  TavernStoryStateInspection,
  TavernSwipeInspection,
  TavernSwipeSelectionInput,
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

/** Measured text usage recorded for one context activation decision. */
export interface TavernContextUsage {
  readonly characters: number
  readonly tokens?: number
}

/** One inclusion or exclusion decision from the Host context compiler. */
export interface TavernContextDecision {
  readonly key: string
  readonly origin: 'source' | 'world-info'
  readonly outcome: 'included' | 'excluded'
  readonly reason:
    | 'included'
    | 'observer'
    | 'visibility'
    | 'authority'
    | 'branch'
    | 'invalid'
    | 'not-matched'
    | 'group'
    | 'duplicate'
    | 'budget-characters'
    | 'budget-tokens'
    | 'budget-both'
  readonly matchKind?: 'primary' | 'secondary'
  readonly matchedKeys?: readonly string[]
  readonly attempted?: TavernContextUsage
  readonly accepted?: TavernContextUsage
  readonly order: number
}

/** Context activation projection returned to the diagnostic Prompt Inspector. */
export interface TavernContextActivation {
  readonly ledger: readonly TavernContextDecision[]
  readonly usage: TavernContextUsage
}

function startTavernSession(sessions: ISessions, workspaces: IWorkspaces): () => void {
  let creating = false
  let disposed = false
  let startupComplete = false
  const reconcile = (): void => {
    if (disposed || creating || startupComplete) return
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
      // Once a usable session is already selected, later list notifications
      // must not participate in user navigation between existing sessions.
      if (state.current !== undefined && current?.blank !== true) startupComplete = true
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
      startupComplete = true
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
  inspectFacts: (sessionId: SessionId) => Promise<RemoteResult<TavernFactInspection>>
  inspectContextActivation: (sessionId: SessionId) => Promise<RemoteResult<TavernContextActivation | null>>
  inspectGmResponses?: (sessionId: SessionId) => Promise<RemoteResult<readonly TavernGmResponseInspection[]>>
  inspectHistory: (sessionId: SessionId) => Promise<RemoteResult<TavernHistoryEntry>>
  archiveHistory: (sessionId: SessionId) => Promise<RemoteResult<void>>
  inspectJourneyAssets?: (sessionId: SessionId) => Promise<RemoteResult<TavernJourneyAssetProjection | null>>
  inspectSectionConfig?: (sessionId: SessionId) => Promise<RemoteResult<TavernSectionConfigInspection>>
  listPersonFacts: (sessionId: SessionId, personId: string) => Promise<RemoteResult<readonly TavernFactEntry[]>>
  listWorldFacts: (sessionId: SessionId) => Promise<RemoteResult<readonly TavernFactEntry[]>>
  editFact: (sessionId: SessionId, input: TavernFactEditInput) => Promise<RemoteResult<TavernFactInspection>>
  removeFact: (sessionId: SessionId, input: TavernFactRemovalInput) => Promise<RemoteResult<TavernFactInspection>>
  resolveConflict?: (sessionId: SessionId, input: { readonly factId: string; readonly keep: 'new' | 'old' }) => Promise<RemoteResult<TavernFactInspection>>
  restoreFact?: (
    sessionId: SessionId,
    input: { readonly factId: string; readonly text: string },
  ) => Promise<RemoteResult<TavernFactInspection>>
  exportCharacter: (id: CharacterAsset['id']) => Promise<RemoteResult<string>>
  exportWorldInfo: (id: WorldInfoAsset['id']) => Promise<RemoteResult<string>>
  importCharacter: (input: string, options?: TavernImportOptions) => Promise<RemoteResult<CharacterAsset>>
  importWorldInfo: (input: string, options?: TavernImportOptions) => Promise<RemoteResult<WorldInfoAsset>>
  updateCharacter?: (input: string, options: { readonly id: string }) => Promise<RemoteResult<CharacterAsset>>
  updateWorldInfo?: (input: string, options: { readonly id: string }) => Promise<RemoteResult<WorldInfoAsset>>
  deleteAsset?: (id: AssetId) => Promise<RemoteResult<boolean>>
  inspectSelection: (selection: AssetSelection) => Promise<RemoteResult<TavernSelectionInspection>>
  inspectSession: (sessionId: SessionId) => Promise<RemoteResult<TavernSessionSelection | null>>
  inspectStoryState: (sessionId: SessionId) => Promise<RemoteResult<TavernStoryStateInspection>>
  inspectSwipe: (sessionId: SessionId) => Promise<RemoteResult<TavernSwipeInspection>>
  listCharacters: () => Promise<RemoteResult<readonly CharacterAsset[]>>
  listWorldInfo: () => Promise<RemoteResult<readonly WorldInfoAsset[]>>
  regenerate: (sessionId: SessionId, input: TavernRegenerateInput) => Promise<RemoteResult<TavernRegenerateResult>>
  select: (selection: AssetSelection) => Promise<RemoteResult<PromptAssetBaseline>>
  bootstrapJourney: (
    sessionId: SessionId,
    selection: AssetSelection,
    playerIdentity?: string | null,
  ) => Promise<RemoteResult<TavernBootstrapJourneyResult>>
  applySectionConfig?: (sessionId: SessionId, input: TavernSectionConfigInput) => Promise<RemoteResult<TavernSectionConfigInspection>>
  selectForSession: (sessionId: SessionId, selection: AssetSelection) => Promise<RemoteResult<TavernSessionSelection>>
  selectSwipe: (sessionId: SessionId, input: TavernSwipeSelectionInput) => Promise<RemoteResult<TavernSwipeInspection>>
  setStoryState: (sessionId: SessionId, change: StoryStateChange) => Promise<RemoteResult<TavernStoryStateInspection>>
  editJourneyCharacter: (sessionId: SessionId, input: string) => Promise<RemoteResult<TavernSessionSelection>>
  editJourneyWorldInfo: (sessionId: SessionId, assetId: WorldInfoAsset['id'], input: string) => Promise<RemoteResult<TavernSessionSelection>>
}

/**
 * Register the Tavern foundation view after the conversation slot exists.
 * @param ctx - browser Cordis context.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(tavernAssetsRemote)
  const tavernAssets = ctx.reflect.get('remote.tavernAssets') as TavernAssetsRemote
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-tavern: dictionaries')
  const t = ctx.locale.bind(NS)
  const conversationT = ctx.locale.bind('conversation')
  const chatView = ctx.conversationChatView
  const sessions = ctx.sessions as unknown as ISessions
  chatView.setDefaultView?.('tavern')
  ctx.effect(() => startTavernSession(sessions, ctx.workspaces), 'ui-tavern: startup session')
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
    } => ({
      openSession: (sessionId) => { sessions.open(sessionId) },
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
    children: {
      'tavern.settings.model': { kind: 'single', scope: 'session' },
    },
    inject: (sessionId: SessionId, actions): ChatViewInjected & {
      tavernAssets: TavernAssetsRemote
      conversationT: ChatViewSlotProps['t']
      chatView: ConversationChatView['component']
      openSession: (sessionId: SessionId) => void
    } => {
      if (sessions.binding(sessionId) === undefined) {
        throw new Error(`ui-tavern: session "${sessionId}" is unavailable`)
      }
      return {
        ...chatView.inject(sessionId, actions),
        tavernAssets,
        conversationT,
        chatView: chatView.component,
        openSession: (nextSessionId) => { sessions.open(nextSessionId) },
      }
    },
  }, TavernView))

  return async () => {
    chatView.setDefaultView?.(undefined)
    await disposeRemote()
  }
}
