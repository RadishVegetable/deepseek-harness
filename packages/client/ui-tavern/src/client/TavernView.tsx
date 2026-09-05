/** Character-first Tavern surface over the durable conversation targets. */

import type {
  ChatStore,
  ChatViewInjected,
  ChatViewSlotProps,
  ConvViewProps,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale, PropsRenderSlots, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { TrajectorySnapshot } from '@deepseek-ai/dsh-client-ui-trajectory/client'
import type { RequestView, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  AssetId,
  AssetSelection,
  CharacterAsset,
  TavernFactEntry,
  TavernFactInspection,
  TavernGmResponseInspection,
  TavernHistoryEntry,
  TavernJourneyAssetProjection,
  TavernJourneyField,
  TavernJourneyPerson,
  TavernSessionSelection,
  TavernSwipeInspection,
  WorldInfoAsset,
} from '@deepseek-ai/dsh-tavern-host/client'
import type { RemoteFailure, RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import {
  IconCheckOutline16,
  IconChevronRightOutline14,
  IconCloseOutline16,
  IconEditOutline16,
  IconEllipsisOutline16,
  IconGlobeOutline14,
  IconListPenOutline16,
  IconPlusOutline16,
  IconSettingsOutline16,
  IconSparkle16,
  IconTrashOutline16,
  IconUserOutline16,
  IconWarningOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { parseCharacterCardPng } from '@deepseek-ai/dsh-tavern-compat'
import { collectCharacterEntries, isRecord, parseLabeledLines, slug } from '@deepseek-ai/dsh-tavern-shared'
import { useEffect, useMemo, useReducer, useRef, useState, type ChangeEvent, type ComponentType, type ReactElement } from 'react'
import type { TavernAssetsRemote, TavernContextActivation } from './index.ts'
// Type-only: loads the model settings slot contract without a runtime import.
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import {
  PromptInspector,
  TavernAssetEditor,
  TavernSwipeEditor,
  ConfirmDeleteButton,
} from './TavernControls.tsx'
import css from './TavernView.module.css'
import { setTavernSection, useTavernSection } from './navigation.ts'
import { portraitFor, TAVERN_SCENE } from './artwork.ts'

const EMPTY_TRAJECTORY: TrajectorySnapshot = {
  eventNodes: [],
  eventLocations: new Map(),
  requests: [],
  callSchemas: new Map(),
  partial: null,
  runningCalls: [],
}

function latestAssistantRequest(snapshot: TrajectorySnapshot): Extract<RequestView, { purpose: 'assistant' }> | undefined {
  return [...snapshot.requests].reverse().find((request): request is Extract<RequestView, { purpose: 'assistant' }> =>
    request.purpose === 'assistant')
}

function latestAssistantOutput(
  snapshot: TrajectorySnapshot,
  request: Extract<RequestView, { purpose: 'assistant' }> | undefined,
): string | undefined {
  const assistantNodes = snapshot.eventNodes.filter(node => node.kind === 'assistant')
  const node = request?.resultSeq === undefined
    ? assistantNodes.at(-1)
    : assistantNodes.find(candidate => candidate.seq === request.resultSeq)
  if (node === undefined) return undefined
  const output = node.blocks
    .filter(block => block.kind === 'text')
    .map(block => block.text)
    .join('\n\n')
  return output.length === 0 ? undefined : output
}

type TavernSettingsSlotProps = Pick<PropsRenderSlots<'tavern.settings.model'>, 'renderSlot'>

type TavernViewProps = ConvViewProps & TavernSettingsSlotProps & PropsStore<ChatStore> & PropsLocale<'tavern'> & ChatViewInjected & {
  tavernAssets: TavernAssetsRemote
  conversationT: ChatViewSlotProps['t']
  chatView: ComponentType<ChatViewSlotProps>
  openSession: (sessionId: SessionId) => void
}

type Drawer = 'library' | 'settings' | 'prompt' | 'character' | 'world' | 'person' | 'details' | null
type LibraryTab = 'assets' | 'facts' | 'swipe'

type FactUndo = {
  readonly factId: string
  readonly text: string
  readonly removed: boolean
}

type TavernUiError = {
  readonly code: string
  readonly message: string
  readonly detail: string
}

class TavernRemoteError extends Error {
  readonly failure: RemoteFailure

  constructor(failure: RemoteFailure) {
    super(failure.message)
    this.name = 'TavernRemoteError'
    this.failure = failure
  }
}

function remoteValue<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw new TavernRemoteError(result.error)
  return result.value
}

const START_TIMEOUT_MS = 5_000

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => { reject(new Error(message)) }, timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function optionalRemoteValue<T>(request: Promise<RemoteResult<T>>): Promise<T | undefined> {
  try {
    return remoteValue(await request)
  } catch {
    return undefined
  }
}

function errorDetail(reason: unknown): string {
  const failure = reason instanceof TavernRemoteError
    ? reason.failure
    : isRecord(reason) && typeof reason.code === 'string' && typeof reason.message === 'string' && isRecord(reason.details)
      ? { code: reason.code, message: reason.message, details: reason.details }
      : undefined
  if (failure !== undefined) {
    const details = !isRecord(failure.details) || Object.keys(failure.details).length === 0
      ? ''
      : ` ${JSON.stringify(failure.details)}`
    return `${failure.code}: ${failure.message}${details}`
  }
  if (reason instanceof Error) return reason.message
  return String(reason)
}

function uiError(reason: unknown, fallbackCode: string, fallbackMessage: string): TavernUiError {
  const failure = reason instanceof TavernRemoteError
    ? reason.failure
    : isRecord(reason) && typeof reason.code === 'string' && typeof reason.message === 'string' && isRecord(reason.details)
      ? { code: reason.code, message: reason.message, details: reason.details }
      : undefined
  return {
    code: failure?.code ?? fallbackCode,
    message: fallbackMessage,
    detail: errorDetail(reason),
  }
}

interface TavernUiState {
  readonly drawer: Drawer
  readonly libraryTab: LibraryTab
  readonly loading: boolean
  readonly saving: boolean
  readonly error: TavernUiError | null
  readonly factInspection: TavernFactInspection | null
  readonly contextActivation: TavernContextActivation | null
  readonly factUndo: FactUndo | null
  readonly characters: readonly CharacterAsset[]
  readonly worldInfoLibrary: readonly WorldInfoAsset[]
  readonly character: CharacterAsset | null
  readonly worldInfos: readonly WorldInfoAsset[]
  readonly sessionSelection: TavernSessionSelection | null
  readonly journeyProjection: TavernJourneyAssetProjection | null
  readonly swipeInspection: TavernSwipeInspection | null
  readonly gmResponseInspection: readonly TavernGmResponseInspection[]
  readonly draftCharacterId: AssetId | null
  readonly draftWorldInfoIds: readonly AssetId[]
  readonly selectionDirty: boolean
  readonly playerIdentity: string
  readonly historyRows: readonly TavernHistoryRow[]
  readonly archivedHistoryIds: readonly SessionId[]
  readonly historyLoading: boolean
  readonly historyError: TavernUiError | null
  readonly historyDeleteError: TavernUiError | null
  readonly deletingHistoryId: SessionId | null
  readonly worldDetail: WorldInfoAsset | null
  readonly personDetail: WorldPerson | null
  readonly toast: string | null
}

type TavernUiAction =
  | { readonly type: 'drawer'; readonly value: Drawer }
  | { readonly type: 'library-tab'; readonly value: LibraryTab }
  | { readonly type: 'loading'; readonly value: boolean }
  | { readonly type: 'saving'; readonly value: boolean }
  | { readonly type: 'error'; readonly value: TavernUiError | null }
  | { readonly type: 'facts'; readonly value: TavernFactInspection | null }
  | { readonly type: 'context-activation'; readonly value: TavernContextActivation | null }
  | { readonly type: 'fact-undo'; readonly value: FactUndo | null }
  | { readonly type: 'characters'; readonly value: readonly CharacterAsset[] }
  | { readonly type: 'world-library'; readonly value: readonly WorldInfoAsset[] }
  | { readonly type: 'character'; readonly value: CharacterAsset | null }
  | { readonly type: 'world-infos'; readonly value: readonly WorldInfoAsset[] }
  | { readonly type: 'session-selection'; readonly value: TavernSessionSelection | null }
  | { readonly type: 'journey-projection'; readonly value: TavernJourneyAssetProjection | null }
  | { readonly type: 'swipe'; readonly value: TavernSwipeInspection | null }
  | { readonly type: 'gm-responses'; readonly value: readonly TavernGmResponseInspection[] }
  | { readonly type: 'draft-character'; readonly value: AssetId | null }
  | { readonly type: 'draft-world-info'; readonly value: readonly AssetId[] }
  | { readonly type: 'selection-dirty'; readonly value: boolean }
  | { readonly type: 'player-identity'; readonly value: string }
  | { readonly type: 'history-rows'; readonly value: readonly TavernHistoryRow[] }
  | { readonly type: 'history-archived'; readonly value: SessionId }
  | { readonly type: 'history-loading'; readonly value: boolean }
  | { readonly type: 'history-error'; readonly value: TavernUiError | null }
  | { readonly type: 'history-delete-error'; readonly value: TavernUiError | null }
  | { readonly type: 'deleting-history'; readonly value: SessionId | null }
  | { readonly type: 'world-detail'; readonly value: WorldInfoAsset | null }
  | { readonly type: 'person-detail'; readonly value: WorldPerson | null }
  | { readonly type: 'toast'; readonly value: string | null }

const INITIAL_TAVERN_UI: TavernUiState = {
  drawer: null,
  libraryTab: 'assets',
  loading: true,
  saving: false,
  error: null,
  factInspection: null,
  contextActivation: null,
  factUndo: null,
  characters: [],
  worldInfoLibrary: [],
  character: null,
  worldInfos: [],
  sessionSelection: null,
  journeyProjection: null,
  swipeInspection: null,
  gmResponseInspection: [],
  draftCharacterId: null,
  draftWorldInfoIds: [],
  selectionDirty: false,
  playerIdentity: '',
  historyRows: [],
  archivedHistoryIds: [],
  historyLoading: false,
  historyError: null,
  historyDeleteError: null,
  deletingHistoryId: null,
  worldDetail: null,
  personDetail: null,
  toast: null,
}

function tavernUiReducer(state: TavernUiState, action: TavernUiAction): TavernUiState {
  switch (action.type) {
    case 'drawer': return { ...state, drawer: action.value }
    case 'library-tab': return { ...state, libraryTab: action.value }
    case 'loading': return { ...state, loading: action.value }
    case 'saving': return { ...state, saving: action.value }
    case 'error': return { ...state, error: action.value }
    case 'facts': return { ...state, factInspection: action.value }
    case 'context-activation': return { ...state, contextActivation: action.value }
    case 'fact-undo': return { ...state, factUndo: action.value }
    case 'characters': return { ...state, characters: action.value }
    case 'world-library': return { ...state, worldInfoLibrary: action.value }
    case 'character': return { ...state, character: action.value }
    case 'world-infos': return { ...state, worldInfos: action.value }
    case 'session-selection': return { ...state, sessionSelection: action.value }
    case 'journey-projection': return { ...state, journeyProjection: action.value }
    case 'swipe': return { ...state, swipeInspection: action.value }
    case 'gm-responses': return { ...state, gmResponseInspection: action.value }
    case 'draft-character': return { ...state, draftCharacterId: action.value }
    case 'draft-world-info': return { ...state, draftWorldInfoIds: action.value }
    case 'selection-dirty': return { ...state, selectionDirty: action.value }
    case 'player-identity': return { ...state, playerIdentity: action.value }
    case 'history-rows': return { ...state, historyRows: action.value }
    case 'history-archived': return {
      ...state,
      historyRows: state.historyRows.filter(row => row.summary.id !== action.value),
      archivedHistoryIds: state.archivedHistoryIds.includes(action.value)
        ? state.archivedHistoryIds
        : [...state.archivedHistoryIds, action.value],
    }
    case 'history-loading': return { ...state, historyLoading: action.value }
    case 'history-error': return { ...state, historyError: action.value }
    case 'history-delete-error': return { ...state, historyDeleteError: action.value }
    case 'deleting-history': return { ...state, deletingHistoryId: action.value }
    case 'world-detail': return { ...state, worldDetail: action.value }
    case 'person-detail': return { ...state, personDetail: action.value }
    case 'toast': return { ...state, toast: action.value }
  }
}

interface WorldPerson {
  readonly name: string
  readonly personId: string
  readonly aliases: readonly string[]
  readonly source: WorldInfoAsset | null
  readonly entryId: AssetId | null
  readonly content: string
  readonly fields: readonly TavernJourneyField[]
  readonly facts: readonly TavernFactEntry[]
}

function requireFactInspection(
  result: RemoteResult<TavernFactInspection> | undefined,
  message: string,
): TavernFactInspection {
  if (result === undefined) throw new Error(message)
  return remoteValue(result)
}

interface TavernHistoryRow {
  readonly summary: { readonly id: SessionId; readonly displayTitle: string; readonly updatedAt: number }
  readonly history: TavernHistoryEntry | null
  readonly error?: TavernUiError
}

/**
 * Render the character-first Tavern surface. Durable transcript and input
 * remain in the shared ChatView and ConversationRoot; this component owns
 * presentation state and Host-backed inspection controls.
 * @param props - conversation slot props and the Tavern locale binding.
 * @returns the Tavern surface for one session.
 */
export function TavernView({
  useSession,
  useSessions,
  t,
  tavernAssets,
  conversationT,
  chatView: ChatView,
  renderSlot,
  openSession,
  ...chatProps
}: TavernViewProps): ReactElement {
  const session = useSession(snapshot => snapshot)
  const sessionList = useSessions(snapshot => snapshot)
  const section = useTavernSection()
  const sessionRefreshKey = useSession(snapshot =>
    `${snapshot.nodes.length}:${snapshot.turnEnds.size}:${snapshot.running ? 'running' : 'idle'}:${snapshot.openState}`)
  const trajectory = useSession(snapshot => snapshot.views.get('trajectory') ?? EMPTY_TRAJECTORY)
  const latest = useMemo(() => latestAssistantRequest(trajectory), [trajectory])
  const latestOutput = useMemo(() => latestAssistantOutput(trajectory, latest), [latest, trajectory])
  const [ui, dispatchUi] = useReducer(tavernUiReducer, INITIAL_TAVERN_UI)
  const setDrawer = (value: Drawer): void => { dispatchUi({ type: 'drawer', value }) }
  const setLibraryTab = (value: LibraryTab): void => { dispatchUi({ type: 'library-tab', value }) }
  const setLoading = (value: boolean): void => { dispatchUi({ type: 'loading', value }) }
  const setSaving = (value: boolean): void => { dispatchUi({ type: 'saving', value }) }
  const setError = (value: TavernUiError | null): void => { dispatchUi({ type: 'error', value }) }
  const setFactInspection = (value: TavernFactInspection | null): void => { dispatchUi({ type: 'facts', value }) }
  const setCharacters = (value: readonly CharacterAsset[]): void => { dispatchUi({ type: 'characters', value }) }
  const setWorldInfoLibrary = (value: readonly WorldInfoAsset[]): void => { dispatchUi({ type: 'world-library', value }) }
  const setCharacter = (value: CharacterAsset | null): void => { dispatchUi({ type: 'character', value }) }
  const setWorldInfos = (value: readonly WorldInfoAsset[]): void => { dispatchUi({ type: 'world-infos', value }) }
  const setSessionSelection = (value: TavernSessionSelection | null): void => { dispatchUi({ type: 'session-selection', value }) }
  const setJourneyProjection = (value: TavernJourneyAssetProjection | null): void => { dispatchUi({ type: 'journey-projection', value }) }
  const setSwipeInspection = (value: TavernSwipeInspection | null): void => { dispatchUi({ type: 'swipe', value }) }
  const setGmResponseInspection = (value: readonly TavernGmResponseInspection[]): void => { dispatchUi({ type: 'gm-responses', value }) }
  const setDraftCharacterId = (value: AssetId | null): void => { dispatchUi({ type: 'draft-character', value }) }
  const setDraftWorldInfoIds = (value: readonly AssetId[]): void => { dispatchUi({ type: 'draft-world-info', value }) }
  const setSelectionDirty = (value: boolean): void => { dispatchUi({ type: 'selection-dirty', value }) }
  const setPlayerIdentity = (value: string): void => { dispatchUi({ type: 'player-identity', value }) }
  const setHistoryRows = (value: readonly TavernHistoryRow[]): void => { dispatchUi({ type: 'history-rows', value }) }
  const setHistoryLoading = (value: boolean): void => { dispatchUi({ type: 'history-loading', value }) }
  const setHistoryError = (value: TavernUiError | null): void => { dispatchUi({ type: 'history-error', value }) }
  const setHistoryDeleteError = (value: TavernUiError | null): void => { dispatchUi({ type: 'history-delete-error', value }) }
  const setDeletingHistoryId = (value: SessionId | null): void => { dispatchUi({ type: 'deleting-history', value }) }
  const {
    characters,
    worldInfoLibrary,
    character,
    worldInfos,
    sessionSelection,
    journeyProjection,
    swipeInspection,
    gmResponseInspection,
    draftCharacterId,
    draftWorldInfoIds,
    selectionDirty,
    playerIdentity,
    historyRows,
    archivedHistoryIds,
    historyLoading,
    historyError,
    historyDeleteError,
    deletingHistoryId,
    worldDetail,
    personDetail,
  } = ui
  const setWorldDetail = (value: WorldInfoAsset | null): void => { dispatchUi({ type: 'world-detail', value }) }
  const setPersonDetail = (value: WorldPerson | null): void => { dispatchUi({ type: 'person-detail', value }) }
  const fileInput = useRef<HTMLInputElement>(null)
  const refreshGeneration = useRef(0)
  const activeSessionId = useRef(session.sessionId)
  activeSessionId.current = session.sessionId

  useEffect(() => {
    if (ui.toast === null) return
    const timer = window.setTimeout(() => { dispatchUi({ type: 'toast', value: null }) }, 3200)
    return () => { window.clearTimeout(timer) }
  }, [ui.toast])

  const historySummaries = useMemo(() => sessionList.ids
    .map(id => sessionList.byId[id])
    .filter((summary): summary is NonNullable<typeof summary> =>
      summary?.agentPreset === 'tavern' && !summary.blank && !archivedHistoryIds.includes(summary.id))
    .sort((left, right) => right.updatedAt - left.updatedAt), [sessionList, archivedHistoryIds])
  const historyKey = useMemo(() => historySummaries
    .map(summary => `${summary.id}:${summary.updatedAt}:${summary.displayTitle}`)
    .join('|'), [historySummaries])

  useEffect(() => {
    let disposed = false
    setHistoryLoading(historySummaries.length > 0)
    setHistoryError(null)
    setHistoryDeleteError(null)
    if (historySummaries.length === 0) {
      setHistoryRows([])
      return () => { disposed = true }
    }
    void Promise.all(historySummaries.map(async (summary): Promise<TavernHistoryRow> => {
      try {
        const result = await tavernAssets.inspectHistory(summary.id)
        return { summary, history: remoteValue(result) }
      } catch (error) {
        return {
          summary,
          history: null,
          error: uiError(error, 'history-load-failed', t('history.loadFailed')),
        }
      }
    })).then((rows) => {
      if (disposed) return
      setHistoryRows(rows)
      setHistoryError(rows.find(row => row.error !== undefined)?.error ?? null)
    }).catch((error: unknown) => {
      if (disposed) return
      setHistoryRows([])
      setHistoryError(uiError(error, 'history-load-failed', t('history.loadFailed')))
    }).finally(() => {
      if (!disposed) setHistoryLoading(false)
    })
    return () => { disposed = true }
  }, [historyKey, tavernAssets])

  async function deleteHistory(sessionId: SessionId): Promise<void> {
    setDeletingHistoryId(sessionId)
    setHistoryDeleteError(null)
    try {
      await remoteValue(await tavernAssets.archiveHistory(sessionId))
      dispatchUi({ type: 'history-archived', value: sessionId })
      dispatchUi({ type: 'toast', value: t('journey.deleted') })
    } catch (error) {
      setHistoryDeleteError(uiError(error, 'history-delete-failed', t('history.deleteFailed')))
    } finally {
      setDeletingHistoryId(null)
    }
  }

  /** Delete a library asset (Character Card or World Info) and refresh. */
  async function removeLibraryAsset(asset: CharacterAsset | WorldInfoAsset): Promise<void> {
    const deleteAssetRemote = tavernAssets.deleteAsset
    if (deleteAssetRemote === undefined) {
      dispatchUi({ type: 'toast', value: t('library.deleteUnavailable') })
      return
    }
    try {
      const result = await deleteAssetRemote(asset.id)
      if (!result.ok || !result.value) throw new Error(result.ok ? 'Asset was not deleted' : result.error.message)
      if (draftCharacterId === asset.id) setDraftCharacterId(null)
      setDraftWorldInfoIds(draftWorldInfoIds.filter(id => id !== asset.id))
      await refreshAssets()
      dispatchUi({ type: 'toast', value: t('editor.deleted') })
    } catch (error) {
      setError(uiError(error, 'asset-delete-failed', t('library.operationFailed')))
    }
  }

  /** Delete the journey the player is currently in and return to the entrance. */
  async function deleteCurrentJourney(): Promise<void> {
    await deleteHistory(session.sessionId)
    setDrawer(null)
    setSessionSelection(null)
    setJourneyProjection(null)
    setCharacter(null)
    setWorldInfos([])
    setFactInspection(null)
    setDraftCharacterId(null)
    setDraftWorldInfoIds([])
    setSelectionDirty(false)
    setTavernSection('home')
  }

  async function refreshAssets(): Promise<{
    characters: readonly CharacterAsset[]
    worldInfoLibrary: readonly WorldInfoAsset[]
  } | undefined> {
    const generation = ++refreshGeneration.current
    const requestSessionId = session.sessionId
    const isCurrent = (): boolean => refreshGeneration.current === generation
      && activeSessionId.current === requestSessionId
    setLoading(true)
    try {
      const [characterResult, worldInfoResult] = await Promise.all([
        tavernAssets.listCharacters(),
        tavernAssets.listWorldInfo(),
      ])
      const availableCharacters = [...remoteValue(characterResult)]
      const availableWorldInfo = [...remoteValue(worldInfoResult)]
      if (!isCurrent()) return { characters: availableCharacters, worldInfoLibrary: availableWorldInfo }
      setCharacters(availableCharacters)
      setWorldInfoLibrary(availableWorldInfo)
      if (sessionSelection === null) {
        const nextCharacterId = draftCharacterId !== null && availableCharacters.some(asset => asset.id === draftCharacterId)
          ? draftCharacterId
          : null
        setDraftCharacterId(nextCharacterId)
        setDraftWorldInfoIds(draftWorldInfoIds.filter(id => availableWorldInfo.some(asset => asset.id === id)))
      }
      setError(null)
      const [selectedValue, swipeValue, factsValue, gmResponsesValue, contextActivationValue] = await Promise.all([
        optionalRemoteValue(tavernAssets.inspectSession(session.sessionId)),
        optionalRemoteValue(tavernAssets.inspectSwipe(session.sessionId)),
        optionalRemoteValue(tavernAssets.inspectFacts(session.sessionId)),
        typeof tavernAssets.inspectGmResponses === 'function'
          ? optionalRemoteValue(tavernAssets.inspectGmResponses(session.sessionId))
          : Promise.resolve(undefined),
        typeof tavernAssets.inspectContextActivation === 'function'
          ? optionalRemoteValue(tavernAssets.inspectContextActivation(session.sessionId))
          : Promise.resolve(undefined),
      ])
      if (!isCurrent()) return { characters: availableCharacters, worldInfoLibrary: availableWorldInfo }
      const projected = selectedValue === null || selectedValue === undefined ? null : await inspectJourneyAssets()
      const nextSelection = selectedValue?.selection ?? { characterId: null, worldInfoIds: [] }
      setSessionSelection(selectedValue ?? null)
      setJourneyProjection(projected)
      setSwipeInspection(swipeValue ?? { groups: [], issues: [] })
      setFactInspection(factsValue ?? { projection: { people: {}, world: [] }, records: [] })
      setGmResponseInspection(gmResponsesValue ?? [])
      dispatchUi({ type: 'context-activation', value: contextActivationValue ?? null })
      setDraftCharacterId(nextSelection.characterId)
      setDraftWorldInfoIds([...nextSelection.worldInfoIds])
      setPlayerIdentity(selectedValue?.playerIdentity ?? '')
      setSelectionDirty(false)
      setCharacter(projected?.character ?? selectedValue?.character ?? null)
      setWorldInfos([...(projected?.worldInfo ?? selectedValue?.worldInfo ?? [])])
      setError(null)
      return { characters: availableCharacters, worldInfoLibrary: availableWorldInfo }
    } catch (error) {
      if (isCurrent()) setError(uiError(error, 'asset-load-failed', t('library.loadFailed')))
      return undefined
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }

  useEffect(() => { void refreshAssets() }, [session.sessionId, sessionRefreshKey, session.blank, tavernAssets])

  async function inspectJourneyAssets(): Promise<TavernJourneyAssetProjection | null> {
    if (typeof tavernAssets.inspectJourneyAssets !== 'function') return null
    return await optionalRemoteValue(tavernAssets.inspectJourneyAssets(session.sessionId)) ?? null
  }

  async function inspectJourneyAssetsRequired(): Promise<TavernJourneyAssetProjection | null> {
    if (typeof tavernAssets.inspectJourneyAssets !== 'function') return null
    return remoteValue(await tavernAssets.inspectJourneyAssets(session.sessionId))
  }

  async function commitSelection(
    selection: AssetSelection,
    availableCharacters: readonly CharacterAsset[] = characters,
  ): Promise<void> {
    refreshGeneration.current += 1
    setSaving(true)
    try {
      const nextRequestedSelection = {
        characterId: selection.characterId,
        worldInfoIds: [...new Set(selection.worldInfoIds)],
      }
      const normalizedPlayerIdentity = playerIdentity.trim()
      const result = await withTimeout(tavernAssets.bootstrapJourney(
        session.sessionId,
        nextRequestedSelection,
        normalizedPlayerIdentity.length === 0 ? null : normalizedPlayerIdentity,
      ), START_TIMEOUT_MS, t('entrance.startTimeout'))
      const bootstrap = remoteValue(result)
      const selectedValue = bootstrap.selection
      const normalizedFacts = bootstrap.factProjection
      const projected = await withTimeout(inspectJourneyAssetsRequired(), START_TIMEOUT_MS, t('entrance.startTimeout'))
      const projectedWithFacts = projected === null
        ? projected
        : { ...projected, facts: normalizedFacts }
      const nextSelection = selectedValue.selection
      setSessionSelection(selectedValue)
      setFactInspection({
        projection: normalizedFacts,
        records: ui.factInspection?.records ?? [],
      })
      setJourneyProjection(projectedWithFacts)
      setDraftCharacterId(nextSelection.characterId)
      setDraftWorldInfoIds([...nextSelection.worldInfoIds])
      setPlayerIdentity(selectedValue.playerIdentity ?? '')
      setSelectionDirty(false)
      const fallbackCharacter = availableCharacters.find(asset => asset.id === nextSelection.characterId) ?? null
      setCharacter(projected?.character ?? selectedValue.character ?? fallbackCharacter)
      setWorldInfos([...(projected?.worldInfo ?? selectedValue.worldInfo)])
      setError(null)
      setTavernSection('story')
    } catch (error) {
      setError(uiError(error, 'journey-bootstrap-failed', t('entrance.startFailed')))
    } finally {
      setSaving(false)
    }
  }

  async function journeyAssetsUpdated(selection: TavernSessionSelection): Promise<void> {
    const projected = await inspectJourneyAssets()
    setSessionSelection(selection)
    setJourneyProjection(projected)
    setCharacter(projected?.character ?? selection.character)
    setWorldInfos([...(projected?.worldInfo ?? selection.worldInfo)])
    setError(null)
  }

  function applyFactInspection(value: TavernFactInspection): void {
    setFactInspection(value)
    if (ui.journeyProjection !== null) {
      setJourneyProjection({ ...ui.journeyProjection, facts: value.projection })
    }
  }

  async function editFact(factId: string, text: string): Promise<void> {
    try {
      const previous = findFactInInspection(ui.factInspection, factId)
      const result = await tavernAssets.editFact(session.sessionId, { factId, text })
      const inspection = remoteValue(result)
      applyFactInspection(inspection)
      dispatchUi({ type: 'fact-undo', value: previous === undefined ? null : { factId, text: previous.text, removed: false } })
      dispatchUi({ type: 'toast', value: t('facts.saved') })
    } catch (error) {
      setError(uiError(error, 'fact-edit-failed', t('library.operationFailed')))
      throw error
    }
  }

  async function removeFact(factId: string): Promise<void> {
    try {
      const previous = findFactInInspection(ui.factInspection, factId)
      const result = await tavernAssets.removeFact(session.sessionId, { factId })
      applyFactInspection(remoteValue(result))
      dispatchUi({ type: 'fact-undo', value: previous === undefined ? null : { factId, text: previous.text, removed: true } })
      dispatchUi({ type: 'toast', value: t('facts.removed') })
    } catch (error) {
      setError(uiError(error, 'fact-remove-failed', t('library.operationFailed')))
    }
  }

  async function resolveConflict(conflictId: string, keep: 'new' | 'old'): Promise<void> {
    const conflict = ui.factInspection?.projection.conflicts?.find(value => value.id === conflictId)
    const resolveConflictRemote = tavernAssets.resolveConflict
    if (resolveConflictRemote === undefined || conflict === undefined) {
      setError(uiError(new Error('Conflict resolution is unavailable'), 'conflict-resolution-unavailable', t('library.operationFailed')))
      return
    }
    try {
      const result = await resolveConflictRemote(session.sessionId, {
        factId: String(conflict.factId),
        keep,
      })
      applyFactInspection(requireFactInspection(result, 'Tavern conflict resolution failed'))
      dispatchUi({ type: 'fact-undo', value: null })
      dispatchUi({ type: 'toast', value: keep === 'new' ? t('facts.keptNew') : t('facts.keptOld') })
    } catch (error) {
      setError(uiError(error, 'conflict-resolution-failed', t('library.operationFailed')))
    }
  }

  async function undoFact(): Promise<void> {
    const undo = ui.factUndo
    if (undo === null) return
    const restoreFactRemote = tavernAssets.restoreFact
    if (undo.removed && restoreFactRemote === undefined) {
      setError(uiError(new Error('Fact restoration is unavailable'), 'fact-restore-unavailable', t('facts.undoUnavailable')))
      dispatchUi({ type: 'toast', value: t('facts.undoUnavailable') })
      return
    }
    try {
      const result = undo.removed
        ? await restoreFactRemote?.(session.sessionId, { factId: undo.factId, text: undo.text })
        : await tavernAssets.editFact(session.sessionId, { factId: undo.factId, text: undo.text })
      applyFactInspection(requireFactInspection(result, 'Tavern fact undo failed'))
      dispatchUi({ type: 'fact-undo', value: null })
      dispatchUi({ type: 'toast', value: t('facts.undone') })
    } catch (error) {
      setError(uiError(error, 'fact-undo-failed', t('library.operationFailed')))
    }
  }

  function selectCharacter(id: string): void {
    setDraftCharacterId(id === '' ? null : id as AssetId)
    setSelectionDirty(true)
  }

  function toggleWorldInfo(id: AssetId, checked: boolean): void {
    setDraftWorldInfoIds(checked
      ? draftWorldInfoIds.includes(id) ? draftWorldInfoIds : [...draftWorldInfoIds, id]
      : draftWorldInfoIds.filter(value => value !== id))
    setSelectionDirty(true)
  }

  function resetSelection(): void {
    const selection = sessionSelection?.selection
    setDraftCharacterId(selection?.characterId ?? null)
    setDraftWorldInfoIds([...(selection?.worldInfoIds ?? [])])
    setSelectionDirty(false)
  }

  function beginJourney(): void {
    if (draftCharacterId === null) return
    void commitSelection({ characterId: draftCharacterId, worldInfoIds: draftWorldInfoIds })
  }

  function openWorldDetail(asset: WorldInfoAsset): void {
    setWorldDetail(asset)
    setDrawer('world')
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file === undefined) return
    try {
      let imported: Awaited<ReturnType<TavernAssetsRemote['importCharacter']>> | Awaited<ReturnType<TavernAssetsRemote['importWorldInfo']>>
      const isPng = file.type === 'image/png' || file.name.toLowerCase().endsWith('.png')
      if (isPng) {
        const card = parseCharacterCardPng(await file.arrayBuffer())
        const input = card.rawJson ?? JSON.stringify(card.raw)
        imported = await tavernAssets.importCharacter(input, { source: { kind: 'upload', locator: file.name, mediaType: file.type || 'image/png' } })
      } else {
        const text = await file.text()
        const parsed: unknown = JSON.parse(text)
        if (isRecord(parsed) && (parsed.spec === 'chara_card_v2' || parsed.spec === 'chara_card_v3' || isRecord(parsed.data))) {
          imported = await tavernAssets.importCharacter(text, { source: { kind: 'upload', locator: file.name, mediaType: file.type || 'application/json' } })
        } else if (isRecord(parsed) && ('entries' in parsed || 'originalData' in parsed)) {
          imported = await tavernAssets.importWorldInfo(text, { source: { kind: 'upload', locator: file.name, mediaType: file.type || 'application/json' } })
        } else {
          throw new Error('unsupported Tavern JSON')
        }
      }
      if (!imported.ok) throw new TavernRemoteError(imported.error)
      const importedAsset = imported.value
      const selectedBeforeRefresh = sessionSelection?.selection
      const refreshed = await refreshAssets()
      const availableCharacters = refreshed?.characters ?? characters
      const importedSelection = {
        characterId: importedAsset.kind === 'character' ? importedAsset.id : selectedBeforeRefresh?.characterId ?? null,
        worldInfoIds: importedAsset.kind === 'world-info'
          ? [...(selectedBeforeRefresh?.worldInfoIds ?? []), importedAsset.id]
          : selectedBeforeRefresh?.worldInfoIds ?? [],
      }
      if (sessionSelection !== null) {
        await commitSelection(importedSelection, availableCharacters)
      } else {
        setDraftCharacterId(importedSelection.characterId)
        setDraftWorldInfoIds([...importedSelection.worldInfoIds])
        setSelectionDirty(true)
      }
      setError(null)
    } catch (error) {
      setError(uiError(error, 'asset-import-failed', t('library.invalid')))
    }
  }

  async function regenerate(groupId: string, candidateId: string): Promise<void> {
    const result = await tavernAssets.regenerate(session.sessionId, { groupId, candidateId })
    openSession(remoteValue(result).sessionId)
  }

  const savedWorldInfoIds = sessionSelection?.selection.worldInfoIds ?? []
  const previewCharacter = characters.find(asset => asset.id === draftCharacterId) ?? character
  const entrance = sessionSelection === null
  const showEntrance = section === 'home' || entrance
  // Mirror the active surface mode onto the document so the shared
  // conversation chrome (the resident composer seat) can react without
  // being re-rendered by Tavern state.
  const surfaceMode = section === 'home' ? 'home' : entrance ? 'entrance' : 'journey'
  useEffect(() => {
    document.documentElement.dataset.tavernMode = surfaceMode
    return () => { delete document.documentElement.dataset.tavernMode }
  }, [surfaceMode])
  const displayedCharacter = showEntrance ? (character ?? previewCharacter) : journeyProjection?.character ?? character
  const displayedWorldInfos = showEntrance ? worldInfos : journeyProjection?.worldInfo ?? worldInfos
  const displayedWorlds = [
    ...(displayedCharacter?.characterBook === null || displayedCharacter?.characterBook === undefined
      ? []
      : [displayedCharacter.characterBook]),
    ...displayedWorldInfos,
  ].filter((asset, index, assets) => assets.findIndex(candidate => candidate.id === asset.id) === index)
  const activeWorld = displayedWorldInfos[0] ?? displayedCharacter?.characterBook ?? null
  const detailCharacter = displayedCharacter
  const activeWorldDetail = worldDetail === null
    ? null
    : displayedWorlds
      .find(asset => asset.id === worldDetail.id) ?? worldDetail
  const activePeople = journeyProjection === null || showEntrance
    ? worldPeople(
      displayedWorlds,
      ui.factInspection?.projection.people,
      t,
    )
    : projectJourneyPeople(journeyProjection, displayedWorlds)
  const detailCharacterFields = showEntrance
    ? undefined
    : journeyProjection?.characterFields
  const detailWorldFields = showEntrance
    ? undefined
    : journeyProjection?.worldFields
  const activePersonDetail = personDetail === null
    ? null
    : activePeople.find(person => person.personId === personDetail.personId) ?? personDetail
  const journeyAsideProps: JourneyAsideProps = {
    character: displayedCharacter,
    worldInfos: displayedWorlds,
    people: activePeople,
    showSources: true,
    t,
    onCharacter: () => { setDrawer('character') },
    onWorld: openWorldDetail,
    onWorldEdit: () => { setDrawer('library'); setLibraryTab('assets') },
    onPerson: (person) => { setPersonDetail(person); setDrawer('person') },
    onTools: (tab) => { setDrawer('library'); setLibraryTab(tab) },
  }
  return (
    <main className={css.root} data-tavern-surface="" data-tavern-mode={surfaceMode}>
      {ui.error !== null && <InlineAlert
        error={ui.error}
        action={ui.error.code === 'asset-load-failed'
          ? <button type="button" className={css.alertAction} onClick={() => { void refreshAssets() }}>{t('shell.retry')}</button>
          : undefined}
      />}
      {showEntrance ? <section className={css.entrance} aria-label={t('entrance.title')}>
        <div className={css.entranceHeading}>
          <div>
            <span className={css.eyebrow}>{t('entrance.kicker')}</span>
            <h1>{t('entrance.title')}</h1>
            <p>{t('entrance.subtitle')}</p>
          </div>
          <div className={css.entranceActions}>
            <button type="button" className={css.secondaryAction} onClick={() => { document.getElementById('tavern-history')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}>
              <IconChevronRightOutline14 />{t('history.title')}
            </button>
            <button type="button" className={css.secondaryAction} onClick={() => { setDrawer('library'); setLibraryTab('assets') }}>
              <IconListPenOutline16 />{t('library.title')}
            </button>
            <button type="button" className={css.secondaryAction} onClick={() => { fileInput.current?.click() }}>
              <IconPlusOutline16 />{t('library.import')}
            </button>
          </div>
        </div>
        <div className={css.entranceHero}>
          <img src={TAVERN_SCENE} alt={t('journey.sceneAlt')} />
          <div className={css.entranceHeroVeil} />
          <div className={css.entranceHeroCopy}>
            <span>{t('entrance.heroLabel')}</span>
            <strong>{t('journey.sceneName')}</strong>
            <p>{t('journey.sceneSummary')}</p>
          </div>
          <img className={css.entranceHeroPortrait} src={portraitFor(previewCharacter?.name ?? '')} alt={t('journey.portraitAlt')} />
        </div>
        <section className={css.setupSection}>
          <div className={css.setupSectionHeading}><span>{t('entrance.characters')}</span><span>{characters.length}</span></div>
          {ui.loading ? (
            <div className={css.characterGrid}><RailSkeleton label={t('library.loading')} /><RailSkeleton label={t('library.loading')} /><RailSkeleton label={t('library.loading')} /></div>
          ) : characters.length === 0 ? (
            <div className={css.emptyCollection}>
              <span className={css.emptyIcon} aria-hidden="true"><IconUserOutline16 /></span>
              <p>{t('library.noCharacter')}</p>
              <button type="button" className={css.textButton} onClick={() => { fileInput.current?.click() }}>{t('library.import')}</button>
            </div>
          ) : (
            <div className={css.characterGrid}>
              {characters.map(asset => <div className={css.characterChoiceWrap} key={asset.id}>
                <CharacterChoice
                  asset={asset}
                  selected={asset.id === draftCharacterId}
                  t={t}
                  onClick={() => { selectCharacter(asset.id) }}
                />
                <ConfirmDeleteButton
                  className={css.choiceDelete}
                  icon={<IconTrashOutline16 />}
                  label={t('editor.delete')}
                  confirmLabel={t('editor.deleteConfirm')}
                  onConfirm={() => { void removeLibraryAsset(asset) }}
                />
              </div>)}
            </div>
          )}
        </section>
        {(previewCharacter !== null || worldInfoLibrary.length > 0) && <div className={css.setupDetails}>
          {previewCharacter !== null && <section className={css.setupPanel}>
            <div className={css.setupPanelHeading}><span>{t('entrance.characterPreview')}</span><span className={css.formatLabel}>{t('asset.characterCard')}</span></div>
            <div className={css.previewIdentity}>
              <span className={css.largeAvatar}><img src={portraitFor(previewCharacter.name)} alt="" /></span>
              <div><h2>{previewCharacter.name}</h2><p>{excerpt(previewCharacter.description || previewCharacter.scenario, 230)}</p></div>
            </div>
            <button type="button" className={css.detailLink} onClick={() => { setDrawer('character') }}>{t('character.details')}<IconChevronRightOutline14 /></button>
            <div className={css.attachedBook}>
              <div className={css.bookHeading}><span><IconGlobeOutline14 />{t('entrance.attachedBook')}</span><span>{previewCharacter.characterBook?.entries.length ?? 0} {t('library.entries')}</span></div>
              {previewCharacter.characterBook === null ? <p className={css.muted}>{t('entrance.noAttachedBook')}</p> : (
                <button type="button" className={css.bookRow} onClick={() => { openWorldDetail(previewCharacter.characterBook as WorldInfoAsset) }}>
                  <span>
                    <strong>{previewCharacter.characterBook.name}</strong>
                    <small>{t('asset.worldInfo')}</small>
                  </span>
                  <IconChevronRightOutline14 />
                </button>
              )}
            </div>
          </section>}
          <section className={css.setupPanel}>
            <div className={css.setupPanelHeading}><span>{t('entrance.independentBooks')}</span><span>{draftWorldInfoIds.length}/{worldInfoLibrary.length}</span></div>
            {worldInfoLibrary.length === 0 ? <p className={css.muted}>{t('library.noWorldInfo')}</p> : <div className={css.setupWorldList}>
              {worldInfoLibrary.map(asset => <label
                className={css.setupWorldItem}
                key={asset.id}
                data-draft={draftWorldInfoIds.includes(asset.id) !== savedWorldInfoIds.includes(asset.id) || undefined}
              >
                <input type="checkbox" checked={draftWorldInfoIds.includes(asset.id)} disabled={ui.saving} onChange={(event) => { toggleWorldInfo(asset.id, event.target.checked) }} />
                <span><strong>{asset.name}</strong><small>{asset.entries.length} {t('library.entries')}</small></span>
                <span className={css.worldItemEnd}>
                  {draftWorldInfoIds.includes(asset.id) && <IconCheckOutline16 />}
                  <ConfirmDeleteButton
                    className={css.worldItemDelete}
                    icon={<IconTrashOutline16 />}
                    label={t('editor.delete')}
                    confirmLabel={t('editor.deleteConfirm')}
                    onConfirm={() => { void removeLibraryAsset(asset) }}
                  />
                </span>
              </label>)}
            </div>}
            <p className={css.setupNote}>{t('entrance.independentBooksNote')}</p>
          </section>
        </div>}
        <section className={css.identityPanel} aria-labelledby="tavern-player-identity">
          <div>
            <h2 id="tavern-player-identity">{t('entrance.playerIdentity')}</h2>
            <p>{t('entrance.playerIdentityHint')}</p>
          </div>
          <label className={css.identityField}>
            <span>{t('entrance.playerIdentity')}</span>
            <input
              value={playerIdentity}
              placeholder={t('entrance.playerIdentityPlaceholder')}
              onChange={(event) => { setPlayerIdentity(event.target.value) }}
            />
          </label>
        </section>
        <div className={css.entranceFooter}>
          <div className={css.selectionState} data-dirty={selectionDirty || undefined}><span className={css.stateDot} aria-hidden="true" /><span>{selectionDirty ? t('selection.unsaved') : t('selection.saved')}</span></div>
          <div className={css.entranceFooterActions}>
            {selectionDirty && <button type="button" className={css.ghostButton} onClick={resetSelection} disabled={ui.saving}>{t('selection.reset')}</button>}
            <button type="button" className={css.startButton} onClick={beginJourney} disabled={ui.saving || draftCharacterId === null} aria-busy={ui.saving}>
              <IconSparkle16 />{ui.saving ? t('entrance.starting') : t('entrance.start')}
            </button>
          </div>
        </div>
      </section> : <section className={css.journey} aria-label={t('conversation.title')}>
        <header className={css.journeyHeader}>
          <button type="button" className={css.identityButton} onClick={() => { setDrawer('character') }}>
            <span className={css.journeyAvatar}><img src={portraitFor(character?.name ?? '')} alt="" /></span>
            <span><small>{t('journey.current')}</small><strong>{character?.name}</strong></span>
          </button>
          <div className={css.journeyWorld} aria-label={t('journey.world')}>
            <IconGlobeOutline14 />
            <span><small>{t('journey.world')}</small><strong>{activeWorld?.name ?? t('journey.noWorld')}</strong></span>
          </div>
          <div className={css.journeyHeaderActions}>
            <span className={css.liveStatus}><span className={css.statusDot} />{t('shell.ready')}</span>
            <button type="button" className={`${css.headerAction} ${css.mobileDetailsAction}`} onClick={() => { setDrawer('details') }}><IconGlobeOutline14 />{t('journey.details')}</button>
            <button type="button" className={css.headerAction} onClick={() => { setDrawer('prompt') }}><IconListPenOutline16 />{t('prompt.title')}</button>
            <button type="button" className={css.iconButton} title={t('journey.settings')} onClick={() => { setDrawer('settings') }}><IconSettingsOutline16 /></button>
          </div>
        </header>
        <div className={css.journeyLayout}>
          <div className={css.storyColumn}>
            <div className={css.sceneBanner}>
              <img src={TAVERN_SCENE} alt={t('journey.sceneAlt')} />
              <div className={css.sceneVeil} />
              <div className={css.sceneCopy}>
                <span>{t('journey.sceneLabel')}</span>
                <strong>{activeWorld?.name ?? t('journey.sceneName')}</strong>
                <p>{t('journey.sceneSummary')}</p>
              </div>
              <div className={css.portraitCard}>
                <img src={portraitFor(displayedCharacter?.name ?? '')} alt={displayedCharacter?.name ?? t('journey.portraitAlt')} />
                <strong>{displayedCharacter?.name ?? t('journey.noCharacter')}</strong>
              </div>
            </div>
            <div className={css.chatStage}>
              <ChatView {...chatProps} useSession={useSession} useSessions={useSessions} t={conversationT} />
            </div>
          </div>
          <JourneyAside {...journeyAsideProps} />
        </div>
      </section>}
      {section === 'home' && <TavernHistory
        rows={historyRows}
        loading={historyLoading}
        error={historyError}
        deleteError={historyDeleteError}
        deletingSessionId={deletingHistoryId}
        t={t}
        onOpen={(sessionId, selection) => {
          setSessionSelection(selection)
          setDraftCharacterId(selection?.selection.characterId ?? null)
          setDraftWorldInfoIds([...(selection?.selection.worldInfoIds ?? [])])
          setCharacter(selection?.character ?? null)
          setWorldInfos([...(selection?.worldInfo ?? [])])
          setJourneyProjection(null)
          setFactInspection(null)
          setGmResponseInspection([])
          setTavernSection('story')
          openSession(sessionId)
        }}
        onDelete={deleteHistory}
      />}
      <input ref={fileInput} className={css.hiddenInput} type="file" accept=".json,.png,application/json,image/png" onChange={(event) => { void importFile(event) }} />

      {ui.toast !== null && <div className={css.toast} role="status">
        <span>{ui.toast}</span>
        {ui.factUndo !== null && <button type="button" className={css.toastAction} onClick={() => { void undoFact() }}>{t('facts.undo')}</button>}
      </div>}

      {ui.drawer !== null && <div className={css.drawerLayer} data-tavern-drawer={ui.drawer}>
        <button type="button" className={css.drawerScrim} aria-label={t('drawer.close')} onClick={() => { setDrawer(null) }} />
        <aside className={css.drawer} role="dialog" aria-modal="true" aria-label={ui.drawer === 'library' ? t('library.title') : ui.drawer === 'settings' ? t('journey.settings') : ui.drawer === 'prompt' ? t('prompt.title') : ui.drawer === 'character' ? t('character.details') : ui.drawer === 'person' ? activePersonDetail?.name ?? t('person.details') : ui.drawer === 'details' ? t('journey.details') : activeWorldDetail?.name ?? t('world.details')}>
          <div className={css.drawerHeader}>
            <div><h2>{ui.drawer === 'library' ? t('library.title') : ui.drawer === 'settings' ? t('journey.settings') : ui.drawer === 'prompt' ? t('prompt.title') : ui.drawer === 'character' ? t('character.details') : ui.drawer === 'person' ? activePersonDetail?.name ?? t('person.details') : ui.drawer === 'details' ? t('journey.details') : activeWorldDetail?.name ?? t('world.details')}</h2></div>
            <button type="button" className={css.closeButton} title={t('drawer.close')} onClick={() => { setDrawer(null) }}><IconCloseOutline16 /></button>
          </div>
          {ui.drawer === 'settings' ? <div className={css.drawerBody}>
            <section className={css.settingsSection}>
              <div className={css.settingsHeading}><span className={css.kicker}>{t('settings.model.kicker')}</span><h3>{t('settings.model.title')}</h3></div>
              <p className={css.settingsDescription}>{t('settings.model.description')}</p>
              <div className={css.settingsModel}>{renderSlot('tavern.settings.model', { locked: false })}</div>
            </section>
            <section className={css.settingsSection}>
              <div className={css.settingsHeading}><span className={css.kicker}>{t('journey.tools')}</span><h3>{t('journey.deleteCurrent')}</h3></div>
              <p className={css.settingsDescription}>{t('journey.deleteCurrentHint')}</p>
              <ConfirmDeleteButton
                className={css.dangerButton}
                icon={<IconTrashOutline16 />}
                label={t('journey.deleteCurrent')}
                confirmLabel={t('journey.deleteCurrentConfirm')}
                disabled={deletingHistoryId !== null}
                onConfirm={() => { void deleteCurrentJourney() }}
              />
            </section>
          </div> : ui.drawer === 'library' ? <>
            <div className={css.drawerTabs} role="tablist">
              <DrawerTab active={ui.libraryTab === 'assets'} onClick={() => { setLibraryTab('assets') }}>{t('editor.title')}</DrawerTab>
              <DrawerTab active={ui.libraryTab === 'facts'} onClick={() => { setLibraryTab('facts') }}>{t('facts.title')}</DrawerTab>
              <DrawerTab active={ui.libraryTab === 'swipe'} onClick={() => { setLibraryTab('swipe') }}>{t('swipe.title')}</DrawerTab>
            </div>
            <div className={css.drawerBody}>
              {ui.libraryTab === 'assets' && <TavernAssetEditor
                characters={characters}
                worldInfoLibrary={showEntrance
                  ? worldInfoLibrary
                  : displayedWorlds}
                character={showEntrance ? previewCharacter : displayedCharacter}
                {...(showEntrance ? {} : { sessionId: session.sessionId })}
                tavernAssets={tavernAssets}
                t={t}
                onJourneyUpdated={journeyAssetsUpdated}
                onAssetsUpdated={async () => { await refreshAssets() }}
                onError={() => { setError({ code: 'asset-editor-failed', message: t('library.operationFailed'), detail: t('library.operationFailed') }) }}
              />}
              {ui.libraryTab === 'facts' && <FactInspection inspection={ui.factInspection} t={t} onEdit={editFact} onRemove={removeFact} onResolve={resolveConflict} onUndo={undoFact} canUndo={ui.factUndo !== null} />}
              {ui.libraryTab === 'swipe' && <TavernSwipeEditor
                sessionId={session.sessionId}
                tavernAssets={tavernAssets}
                inspection={swipeInspection}
                t={t}
                onSelected={setSwipeInspection}
                onError={() => { setError({ code: 'swipe-operation-failed', message: t('library.operationFailed'), detail: t('library.operationFailed') }) }}
                onRegenerate={regenerate}
              />}
            </div>
          </> : ui.drawer === 'prompt' ? <div className={css.drawerBody}><PromptInspector latest={latest} baseline={sessionSelection?.baseline} output={latestOutput} gmResponses={gmResponseInspection} contextActivation={ui.contextActivation} t={t} /></div>
            : ui.drawer === 'details' ? <div className={css.drawerBody}>
              <div className={css.mobileDetails}>
                <JourneyAside {...journeyAsideProps} />
              </div>
            </div>
              : ui.drawer === 'character' && detailCharacter !== null ? (
                <div className={css.drawerBody}>
                  <CharacterDetail
                    character={detailCharacter}
                    fields={detailCharacterFields}
                    t={t}
                    onWorld={openWorldDetail}
                  />
                </div>
              ) : ui.drawer === 'person' && activePersonDetail !== null ? (
                <div className={css.drawerBody}>
                  <WorldPersonDetail person={activePersonDetail} t={t} onWorld={openWorldDetail} />
                </div>
              ) : activeWorldDetail !== null ? (
                <div className={css.drawerBody}>
                  <WorldDetail
                    asset={activeWorldDetail}
                    fields={detailWorldFields}
                    t={t}
                    onEditWorld={() => { setDrawer('library'); setLibraryTab('assets') }}
                  />
                </div>
              ) : null}
        </aside>
      </div>}
    </main>
  )
}

function InlineAlert({ error, action }: { error: TavernUiError; action: ReactElement | undefined }): ReactElement {
  return <div className={css.alert} role="alert" data-kind="error">
    <span>{error.message}</span>
    <small>{error.detail}</small>
    {action}
  </div>
}

function TavernHistory({ rows, loading, error, deleteError, deletingSessionId, t, onOpen, onDelete }: {
  rows: readonly TavernHistoryRow[]
  loading: boolean
  error: TavernUiError | null
  deleteError: TavernUiError | null
  deletingSessionId: SessionId | null
  t: TavernViewProps['t']
  onOpen: (sessionId: SessionId, selection: TavernSessionSelection | null) => void
  onDelete: (sessionId: SessionId) => Promise<void>
}): ReactElement {
  return <section className={css.history} id="tavern-history" aria-label={t('history.title')}>
    <header className={css.historyHeading}>
      <div>
        <h1>{t('history.title')}</h1>
        <p>{t('history.subtitle')}</p>
      </div>
      <span className={css.historyCount}>{rows.length}</span>
    </header>
    {error !== null && <div className={css.historyNotice} role="status"><span>{error.message}</span><small>{error.detail}</small></div>}
    {deleteError !== null && <div className={css.historyNotice} role="alert"><span>{deleteError.message}</span><small>{deleteError.detail}</small></div>}
    {loading ? (
      <div className={css.historyGrid} aria-label={t('history.loading')}>
        <HistorySkeleton />
        <HistorySkeleton />
      </div>
    ) : rows.length === 0 ? (
      <div className={css.historyEmpty}><span className={css.emptyIcon} aria-hidden="true"><IconUserOutline16 /></span><p>{t('history.empty')}</p></div>
    ) : (
      <div className={css.historyGrid}>
        {rows.map((row) => {
          const characterName = row.history?.characterName ?? row.summary.displayTitle
          const deleting = deletingSessionId === row.summary.id
          const open = (): void => { onOpen(row.summary.id, row.history?.selection ?? null) }
          return <article
            className={css.historyCard}
            key={row.summary.id}
            data-session-id={row.summary.id}
            role="button"
            tabIndex={0}
            aria-label={`${t('history.open')}: ${characterName}`}
            onClick={open}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                open()
              }
            }}
          >
            <div className={css.historyOpen}>
              <div className={css.historyIdentity}>
                <span className={css.historyAvatar}><img src={portraitFor(characterName)} alt="" /></span>
                <span className={css.historyIdentityCopy}>
                  <strong>{characterName}</strong>
                  <small>{row.history === null || row.history.character === null
                    ? row.summary.displayTitle
                    : t('asset.characterCard')}</small>
                </span>
                <IconChevronRightOutline14 />
              </div>
              <div className={css.historyLatest}>
                <span>{t('history.latest')}</span>
                <p>{excerpt(row.history?.lastContent ?? t('history.noContent'), 280)}</p>
              </div>
              <div className={css.historyFooter}>
                <span>{t('history.lastPlayed')}</span>
                <time dateTime={new Date(row.summary.updatedAt).toISOString()}>{formatHistoryTime(row.summary.updatedAt)}</time>
              </div>
            </div>
            <button
              type="button"
              className={css.historyDelete}
              title={deleting ? t('history.deleting') : t('history.delete')}
              aria-label={`${t('history.delete')}: ${characterName}`}
              disabled={deleting}
              onClick={(event) => {
                event.stopPropagation()
                void onDelete(row.summary.id)
              }}
            >
              <IconTrashOutline16 />
            </button>
          </article>
        })}
      </div>
    )}
  </section>
}

function HistorySkeleton(): ReactElement {
  return <div className={css.historySkeleton}>
    <span className={css.skeletonAvatar} />
    <span><span className={css.skeletonLine} /><span className={css.skeletonShort} /></span>
    <span className={css.skeletonBlock} />
  </div>
}

function formatHistoryTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(value)
}

function DrawerTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }): ReactElement {
  return <button type="button" role="tab" aria-selected={active} className={active ? css.drawerTabActive : css.drawerTab} onClick={onClick}>{children}</button>
}

function RailSkeleton({ label }: { label: string }): ReactElement {
  return <div className={css.railSkeleton} aria-label={label}>
    <span className={css.skeletonAvatar} />
    <span className={css.skeletonLine} />
    <span className={css.skeletonShort} />
  </div>
}

function CharacterChoice({ asset, selected, t, onClick }: { asset: CharacterAsset; selected: boolean; t: TavernViewProps['t']; onClick: () => void }): ReactElement {
  return <button type="button" className={css.characterChoice} data-selected={selected || undefined} onClick={onClick}>
    <span className={css.choiceAvatar}><img src={portraitFor(asset.name)} alt="" /></span>
    <span className={css.choiceBody}><strong>{asset.name}</strong><small>{excerpt(asset.description || asset.scenario, 150) || t('character.noDescription')}</small><span className={css.choiceMeta}>{t('asset.characterCard')}{asset.characterBook === null ? '' : ` · ${asset.characterBook.entries.length} ${t('library.entries')}`}</span></span>
    {selected && <span className={css.choiceCheck}><IconCheckOutline16 /></span>}
  </button>
}

interface JourneyAsideProps {
  readonly character: CharacterAsset | null
  readonly worldInfos: readonly WorldInfoAsset[]
  readonly people: readonly WorldPerson[]
  readonly t: TavernViewProps['t']
  readonly onCharacter: () => void
  readonly onWorld: (asset: WorldInfoAsset) => void
  readonly onWorldEdit: () => void
  readonly onPerson: (person: WorldPerson) => void
  readonly onTools: (tab: LibraryTab) => void
  readonly showSources?: boolean
}

function JourneyAside({
  character, worldInfos, people, t, onCharacter, onWorld, onWorldEdit, onPerson, onTools,
  showSources = false,
}: JourneyAsideProps): ReactElement {
  return <aside className={css.journeyAside} aria-label={t('journey.chronicle')}>
    <div className={css.asideHeading}><span>{t('journey.chronicle')}</span><button type="button" className={css.iconButton} title={t('character.details')} onClick={onCharacter}><IconEllipsisOutline16 /></button></div>
    {character !== null && <button type="button" className={css.companionCard} onClick={onCharacter}>
      <span className={css.asideAvatar}><img src={portraitFor(character.name)} alt="" /></span>
      <span><strong>{character.name}</strong><small>{excerpt(character.description || character.scenario, 115)}</small></span>
      <IconChevronRightOutline14 />
    </button>}
    {showSources && <div className={css.asideSources}>
      <div className={css.asideSectionHeading}><span><IconUserOutline16 />{t('journey.people')}</span><span>{people.length}</span></div>
      {people.length === 0 ? <p className={css.muted}>{t('journey.noPeople')}</p> : <div className={css.peopleList}>{people.map(person => <button type="button" className={css.personRow} key={person.personId} onClick={() => { onPerson(person) }}><span className={css.personAvatar}><img src={portraitFor(person.name)} alt="" /></span><span><strong>{person.name}</strong><small>{person.source?.name ?? t('person.journeyEntry')}</small></span><IconChevronRightOutline14 /></button>)}</div>}
      <div className={css.asideSectionHeading}><span><IconGlobeOutline14 />{t('journey.world')}</span><span>{worldInfos.length}</span></div>
      {worldInfos.map(asset => <article className={css.asideWorldCard} key={asset.id}>
        <button type="button" className={css.asideWorld} onClick={() => { onWorld(asset) }}>
          <span><strong>{asset.name}</strong><small>{asset.entries.length} {t('library.entries')}</small></span>
          <IconChevronRightOutline14 />
        </button>
        <div className={css.asideWorldContent}>
          {asset.entries.slice(0, 3).map(entry => <p key={entry.id}><strong>{entry.keys.join(', ') || t('world.content')}</strong>{entry.content}</p>)}
        </div>
        <button type="button" className={css.asideWorldEdit} onClick={(event) => { event.stopPropagation(); onWorldEdit() }}>{t('journey.editWorld')}</button>
      </article>)}
      {worldInfos.length === 0 && <p className={css.muted}>{t('journey.noWorld')}</p>}
    </div>}
    <div className={css.asideTools}>
      <button type="button" onClick={() => { onTools('facts') }}><IconListPenOutline16 />{t('journey.audit')}</button>
      <button type="button" onClick={() => { onTools('swipe') }}><IconSparkle16 />{t('journey.swipes')}</button>
    </div>
  </aside>
}

function CharacterDetail({ character, fields, t, onWorld }: {
  character: CharacterAsset
  fields: readonly TavernJourneyField[] | undefined
  t: TavernViewProps['t']
  onWorld: (asset: WorldInfoAsset) => void
}): ReactElement {
  return <div className={css.detailView}>
    <div className={css.detailIdentity}>
      <span className={css.detailAvatar}><img src={portraitFor(character.name)} alt="" /></span>
      <div><h3>{character.name}</h3><p>{t('asset.characterCard')}</p></div>
    </div>
    <DynamicFields
      fields={fields?.filter(field => field.sourceAssetId === character.id && field.sourceEntryId === undefined)}
      fallback={<>
        <DetailText label={t('character.description')} text={character.description} />
        <DetailText label={t('character.personality')} text={character.personality} />
        <DetailText label={t('character.scenario')} text={character.scenario} />
        {character.creatorNotes && <DetailText label={t('character.notes')} text={character.creatorNotes} />}
      </>}
    />
    {character.characterBook !== null && <div className={css.detailBook}><div className={css.sectionLabel}><span>{t('character.book')}</span><span>{character.characterBook.entries.length} {t('library.entries')}</span></div><button type="button" className={css.bookRow} onClick={() => { onWorld(character.characterBook as WorldInfoAsset) }}><span><strong>{character.characterBook.name}</strong><small>{t('asset.worldInfo')}</small></span><IconChevronRightOutline14 /></button></div>}
  </div>
}

function WorldDetail({ asset, fields, t, onEditWorld }: { asset: WorldInfoAsset; fields: readonly TavernJourneyField[] | undefined; t: TavernViewProps['t']; onEditWorld: () => void }): ReactElement {
  return <div className={css.detailView}>
    <p className={css.detailIntro}>{asset.entries.length} {t('world.entries')}</p>
    <div className={css.worldDetailList}>{asset.entries.map(entry => <article className={css.worldDetailEntry} key={entry.id}>
      <div><strong>{entry.keys.join(', ') || t('prompt.constant')}</strong><span>{entry.enabled ? t('world.enabled') : t('world.disabled')}</span></div>
      <DynamicFields
        fields={fields?.filter(field => field.sourceEntryId === entry.id)}
        fallback={<StructuredFields text={entry.content} t={t} />}
      />
    </article>)}</div>
    <button type="button" className={css.asideWorldEdit} onClick={(event) => { event.stopPropagation(); onEditWorld() }}>{t('journey.editWorld')}</button>
  </div>
}

function WorldPersonDetail({ person, t, onWorld }: { person: WorldPerson; t: TavernViewProps['t']; onWorld: (asset: WorldInfoAsset) => void }): ReactElement {
  const sourceFields = person.source === null || person.entryId === null
    ? []
    : sourceJourneyFields(person.source.id, person.entryId, person.content, t('world.content'))
  const sourceLabels = new Set(sourceFields.map(field => field.label.toLocaleLowerCase()))
  const displayFields = [
    ...sourceFields,
    ...person.fields.filter(field => field.origin !== 'fact' && !sourceLabels.has(field.label.toLocaleLowerCase())),
  ]
  return <div className={css.detailView}>
    <div className={css.detailIdentity}><span className={css.detailAvatar}><img src={portraitFor(person.name)} alt="" /></span><div><h3>{person.name}</h3><p>{person.source === null ? t('person.journeyEntry') : t('person.worldEntry')}</p></div></div>
    <DynamicFields
      fields={displayFields}
      fallback={person.source === null ? <p className={css.muted}>{t('person.description')}</p> : <StructuredFields text={person.content} t={t} />}
    />
    {person.source !== null && <div className={css.detailBook}><div className={css.sectionLabel}><span>{t('person.source')}</span></div><button type="button" className={css.bookRow} onClick={() => { onWorld(person.source as WorldInfoAsset) }}><span><strong>{person.source.name}</strong><small>{t('asset.worldInfo')}</small></span><IconChevronRightOutline14 /></button></div>}
  </div>
}

export function FactInspection({ inspection, t, onEdit, onRemove, onResolve, onUndo, canUndo = false }: {
  inspection: TavernFactInspection | null
  t: TavernViewProps['t']
  onEdit: (factId: string, text: string) => Promise<void>
  onRemove: (factId: string) => Promise<void>
  onResolve?: (conflictId: string, keep: 'new' | 'old') => Promise<void>
  onUndo?: () => Promise<void>
  canUndo?: boolean
}): ReactElement {
  const facts = inspection === null ? [] : [...Object.values(inspection.projection.people).flat(), ...inspection.projection.world]
  const conflicts = inspection?.projection.conflicts ?? []
  return <section className={css.detailView}>
    <div className={css.panelHeader}><h2 className={css.heading}>{t('facts.title')}</h2><span className={css.note}>{t('facts.autoOnly')}</span></div>
    {conflicts.map(conflict => <div className={css.conflictBanner} key={conflict.id} role="alert">
      <div className={css.conflictTitle}><IconWarningOutline16 />{t('facts.conflict')}</div>
      <p><del>{conflict.previousText}</del><br /><strong>{conflict.incomingText}</strong></p>
      <div className={css.conflictActions}>
        <button type="button" className={css.keepNewButton} onClick={() => { void (onResolve ?? (async () => {}))(conflict.id, 'new') }}>{t('facts.keepNew')}</button>
        <button type="button" className={css.keepOldButton} onClick={() => { void (onResolve ?? (async () => {}))(conflict.id, 'old') }}>{t('facts.keepOld')}</button>
      </div>
    </div>)}
    {facts.length === 0 ? <p className={css.empty}>{t('facts.empty')}</p> : <FactList facts={facts} t={t} onEdit={onEdit} onRemove={onRemove} />}
    {onUndo !== undefined && canUndo && <button type="button" className={css.undoLink} onClick={() => { void onUndo() }}><IconCloseOutline16 />{t('facts.undo')}</button>}
    <FactAuditRecords records={inspection?.records ?? []} t={t} />
  </section>
}

function FactAuditRecords({ records, t }: {
  records: TavernFactInspection['records']
  t: TavernViewProps['t']
}): ReactElement {
  return <details className={css.auditPanel} open>
    <summary>{t('facts.audit')} ({records.length})</summary>
    {records.length === 0 ? <p className={css.empty}>{t('facts.auditEmpty')}</p> : <div className={css.auditList}>
      {[...records].reverse().map(record => <article className={css.auditRow} key={record.seq} data-accepted={record.data.accepted}>
        <div className={css.auditRowHeader}>
          <strong>{record.data.accepted ? t('facts.accepted') : t('facts.rejected')}</strong>
          <span>#{record.seq}</span>
        </div>
        <div className={css.auditMeta}>
          <span>{factOperationLabel(record.data.operation, t)}</span>
          <span>{factTargetLabel(record.data.target, t)}{record.data.personId === undefined ? '' : ` · ${record.data.personId}`}</span>
          <span>{t('prompt.turn')} {record.data.turn}</span>
          <span>{t('prompt.assistant')} #{record.data.assistantSeq}</span>
        </div>
        {record.data.factId !== undefined && <code className={css.auditId}>{record.data.factId}</code>}
        {record.data.text !== undefined && <p>{record.data.text}</p>}
        {record.data.label !== undefined && <span className={css.auditLabel}>{record.data.label}</span>}
        {record.data.rejection !== undefined && <p className={css.auditRejection}>{record.data.rejection}</p>}
      </article>)}
    </div>}
  </details>
}

function factOperationLabel(operation: TavernFactInspection['records'][number]['data']['operation'], t: TavernViewProps['t']): string {
  switch (operation) {
    case 'add': return t('facts.operationAdd')
    case 'replace': return t('facts.operationReplace')
    case 'remove': return t('facts.operationRemove')
  }
}

function factTargetLabel(target: TavernFactEntry['target'], t: TavernViewProps['t']): string {
  return target === 'person' ? t('facts.targetPeople') : t('facts.targetWorld')
}

function FactList({ facts, t, onEdit, onRemove }: {
  facts: readonly TavernFactEntry[]
  t: TavernViewProps['t']
  onEdit: (factId: string, text: string) => Promise<void>
  onRemove: (factId: string) => Promise<void>
}): ReactElement {
  return <div className={css.memoryList}>
    {facts.map(fact => <FactRow key={fact.factId} fact={fact} t={t} onEdit={onEdit} onRemove={onRemove} />)}
  </div>
}

function FactRow({ fact, t, onEdit, onRemove }: {
  fact: TavernFactEntry
  t: TavernViewProps['t']
  onEdit: (factId: string, text: string) => Promise<void>
  onRemove: (factId: string) => Promise<void>
}): ReactElement {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(fact.text)
  useEffect(() => { setText(fact.text) }, [fact.text])
  async function save(): Promise<void> {
    if (text.trim().length === 0) return
    await onEdit(String(fact.factId), text.trim())
    setEditing(false)
  }
  return <article className={css.memoryRow}>
    {editing ? (
      <textarea
        className={css.compactTextarea}
        value={text}
        autoFocus
        aria-label={`${t('facts.editValue')}: ${fact.text}`}
        onChange={(event) => { setText(event.target.value) }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            setText(fact.text)
            setEditing(false)
          } else if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            void save().catch(() => {})
          }
        }}
      />
    ) : (
      <div className={css.memoryCopy}><strong>{fact.label ?? t('facts.value')}</strong><button type="button" className={css.factValue} onClick={() => { setEditing(true) }} aria-label={t('facts.editValue')}>{fact.text}</button></div>
    )}
    <div className={css.formRow}>
      {editing ? (
        <button
          type="button"
          className={css.subtleButton}
          onClick={() => { void save().catch(() => {}) }}
          disabled={text.trim().length === 0}
        ><IconCheckOutline16 />{t('facts.save')}</button>
      ) : (
        <button type="button" className={css.subtleButton} onClick={() => { setEditing(true) }} title={t('facts.edit')}><IconEditOutline16 />{t('facts.edit')}</button>
      )}
      <button type="button" className={css.subtleButton} onClick={() => { void onRemove(String(fact.factId)) }} title={t('facts.remove')}><IconTrashOutline16 />{t('facts.remove')}</button>
    </div>
  </article>
}

interface DisplayField {
  readonly id: string
  readonly label: string
  readonly value: string
}

function DynamicFields({ fields, fallback }: {
  fields: readonly DisplayField[] | undefined
  fallback: ReactElement
}): ReactElement {
  if (fields === undefined || fields.length === 0) return fallback
  return <div className={css.structuredFields}>
    {fields.map(field => (
      <div className={css.structuredField} key={field.id}>
        <strong>{field.label}: </strong>
        <p>{field.value}</p>
      </div>
    ))}
  </div>
}

function StructuredFields({ text, t }: { text: string; t: TavernViewProps['t'] }): ReactElement {
  const fields = parseLabeledLines(text, t('world.content'))
  return <div className={css.structuredFields}>{fields.map(field => <div className={css.structuredField} key={`${field.label}:${field.value}`}><strong>{field.label}: </strong><p>{field.value}</p></div>)}</div>
}

function factDisplayFields(facts: readonly TavernFactEntry[], fallbackLabel: string): readonly TavernJourneyField[] {
  return facts.map((fact) => {
    return {
      id: `fact:${String(fact.factId)}`,
      label: fact.label ?? fallbackLabel,
      value: fact.text,
      factId: fact.factId,
      origin: 'fact' as const,
    }
  })
}

function sourceJourneyFields(
  sourceAssetId: AssetId,
  sourceEntryId: AssetId,
  text: string,
  fallbackLabel: string,
): readonly TavernJourneyField[] {
  return parseLabeledLines(text, fallbackLabel).map((field, index) => ({
    id: `source:${String(sourceAssetId)}:${String(sourceEntryId)}:${index}`,
    label: field.label,
    value: field.value,
    sourceAssetId,
    sourceEntryId,
    origin: 'asset' as const,
  }))
}

function DetailText({ label, text }: { label: string; text: string }): ReactElement | null {
  return text ? <section className={css.detailText}><h3>{label}</h3><p>{text}</p></section> : null
}

function excerpt(value: string, length: number): string {
  const text = value.trim().replace(/\s+/g, ' ')
  return text.length > length ? `${text.slice(0, length).trim()}...` : text
}

function worldPeople(
  worlds: readonly WorldInfoAsset[],
  factPeople: Readonly<Record<string, readonly TavernFactEntry[]>> | undefined,
  t: TavernViewProps['t'],
): readonly WorldPerson[] {
  const people = new Map<string, WorldPerson>()
  for (const world of worlds) {
    for (const entry of world.entries) {
      const character = collectCharacterEntries([entry])[0]
      if (character === undefined) continue
      const sourceName = character.name
      const personId = `person:${slug(sourceName, 'person')}`
      const facts = factPeople?.[personId] ?? []
      const factName = [...facts].reverse()
        .map(fact => fact.label?.trim().toLocaleLowerCase() === 'name'
          ? fact.text.trim()
          : parseLabeledLines(fact.text, 'Fact').find(field => field.label.trim().toLocaleLowerCase() === 'name')?.value.trim())
        .find(value => value !== undefined && value.length > 0)
      const name = factName ?? sourceName
      const aliases = [...new Set([
        ...entry.keys.map(key => key.trim()),
        ...(sourceName === name ? [] : [sourceName]),
      ].filter(key => key.length > 0 && key !== name))]
      if (!people.has(personId)) {
        people.set(personId, {
          name,
          personId,
          aliases,
          source: world,
          entryId: entry.id,
          content: entry.content,
          fields: overlayJourneyFields(sourceJourneyFields(world.id, entry.id, entry.content, t('world.content')), factDisplayFields(facts, t('facts.value'))),
          facts,
        })
      }
    }
  }
  for (const [personId, facts] of Object.entries(factPeople ?? {})) {
    if (peopleHasId(people, personId)) continue
    const name = [...facts].reverse().map(fact => fact.label?.trim().toLocaleLowerCase() === 'name'
      ? fact.text.trim()
      : parseLabeledLines(fact.text, 'Fact').find(field => field.label.trim().toLocaleLowerCase() === 'name')?.value)
      .find(value => value !== undefined && value.length > 0)
      ?? humanizePersonId(personId)
    people.set(personId, {
      name,
      personId,
      aliases: [],
      source: null,
      entryId: null,
      content: facts.map(fact => fact.text).join('\n'),
      fields: factDisplayFields(facts, t('facts.value')),
      facts,
    })
  }
  return [...people.values()]
}

function projectJourneyPeople(
  projection: TavernJourneyAssetProjection,
  worlds: readonly WorldInfoAsset[],
): readonly WorldPerson[] {
  return projection.people.map((person: TavernJourneyPerson) => {
    const source = person.source === null
      ? null
      : worlds.find(asset => asset.id === person.source?.assetId) ?? null
    return {
      name: person.name,
      personId: person.personId,
      aliases: [],
      source,
      entryId: person.source?.entryId ?? null,
      content: person.content,
      fields: person.fields,
      facts: person.facts,
    }
  })
}

function overlayJourneyFields(
  base: readonly TavernJourneyField[],
  local: readonly TavernJourneyField[],
): readonly TavernJourneyField[] {
  const localLabels = new Set(local.map(field => field.label.toLocaleLowerCase()))
  return [...base.filter(field => !localLabels.has(field.label.toLocaleLowerCase())), ...local]
}

function peopleHasId(people: ReadonlyMap<string, WorldPerson>, personId: string): boolean {
  return [...people.values()].some(person => person.personId === personId)
}

function humanizePersonId(personId: string): string {
  const name = personId.replace(/^person:/, '').replace(/-/g, ' ').trim()
  return name.replace(/\b\w/g, value => value.toUpperCase()) || personId
}

function findFactInInspection(inspection: TavernFactInspection | null, factId: string): TavernFactEntry | undefined {
  if (inspection === null) return undefined
  const people = Object.values(inspection.projection.people).flat()
  return [...people, ...inspection.projection.world].find(fact => String(fact.factId) === factId)
}
