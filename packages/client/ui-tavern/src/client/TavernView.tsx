/** Three-column Tavern workbench over the durable conversation targets. */

import type {
  ChatStore,
  ChatViewInjected,
  ChatViewSlotProps,
  ConvViewProps,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { TrajectorySnapshot } from '@deepseek-ai/dsh-client-ui-trajectory/client'
import type { ConversationSnapshot, RequestView, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  AssetId,
  AssetSelection,
  CharacterAsset,
  TavernSessionSelection,
  TavernSwipeInspection,
  WorldInfoAsset,
} from '@deepseek-ai/dsh-tavern-host/client'
import {
  IconCheckOutline16,
  IconCloseOutline16,
  IconInspectOutline12,
  IconListPenOutline16,
  IconPlusOutline16,
  IconSparkle16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { parseCharacterCardPng } from '@deepseek-ai/dsh-tavern-compat'
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ComponentType, type ReactElement } from 'react'
import type { TavernAssetsRemote } from './index.ts'
import {
  PromptInspector,
  TavernAssetEditor,
  TavernMemoryEditor,
  TavernStoryStateEditor,
  TavernSwipeEditor,
} from './TavernControls.tsx'
import css from './TavernView.module.css'

const EMPTY_TRAJECTORY: TrajectorySnapshot = {
  eventNodes: [],
  eventLocations: new Map(),
  requests: [],
  callSchemas: new Map(),
  partial: null,
  runningCalls: [],
}

function usageOf(requests: readonly RequestView[]): { cacheRead: number; cacheWrite: number } {
  let cacheRead = 0
  let cacheWrite = 0
  for (const request of requests) {
    const usage = request.usage
    if (!isRecord(usage)) continue
    const read = usage.cacheReadTokens
    const write = usage.cacheWriteTokens
    if (typeof read === 'number') cacheRead += read
    if (typeof write === 'number') cacheWrite += write
  }
  return { cacheRead, cacheWrite }
}

function latestAssistantRequest(snapshot: TrajectorySnapshot): Extract<RequestView, { purpose: 'assistant' }> | undefined {
  return [...snapshot.requests].reverse().find((request): request is Extract<RequestView, { purpose: 'assistant' }> =>
    request.purpose === 'assistant')
}

type TavernViewProps = ConvViewProps & PropsStore<ChatStore> & PropsLocale<'tavern'> & ChatViewInjected & {
  tavernAssets: TavernAssetsRemote
  conversationT: ChatViewSlotProps['t']
  chatView: ComponentType<ChatViewSlotProps>
  openSession: (sessionId: SessionId) => void
}

type Drawer = 'library' | 'prompt' | null
type LibraryTab = 'assets' | 'memory' | 'state' | 'swipe'

/**
 * Render the dedicated Tavern workbench. Durable transcript and input remain
 * in the shared ChatView and ConversationRoot; this component owns only
 * presentation state and Host-backed inspection controls.
 * @param props - conversation slot props and the Tavern locale binding.
 * @returns the Tavern workbench for one session.
 */
export function TavernView({
  useSession, useSessions, t, tavernAssets, conversationT, chatView: ChatView, openSession, ...chatProps
}: TavernViewProps): ReactElement {
  const session = useSession(snapshot => snapshot)
  const sessionRefreshKey = useSession(snapshot =>
    `${snapshot.nodes.length}:${snapshot.turnEnds.size}:${snapshot.running ? 'running' : 'idle'}:${snapshot.openState}`)
  const trajectory = useSession(snapshot => snapshot.views.get('trajectory') ?? EMPTY_TRAJECTORY)
  const latest = useMemo(() => latestAssistantRequest(trajectory), [trajectory])
  const usage = useMemo(() => usageOf(trajectory.requests), [trajectory.requests])
  const toolCount = latest?.prompt?.tools.length ?? 0
  const [characters, setCharacters] = useState<CharacterAsset[]>([])
  const [worldInfoLibrary, setWorldInfoLibrary] = useState<WorldInfoAsset[]>([])
  const [character, setCharacter] = useState<CharacterAsset | null>(null)
  const [worldInfos, setWorldInfos] = useState<WorldInfoAsset[]>([])
  const [sessionSelection, setSessionSelection] = useState<TavernSessionSelection | null>(null)
  const [swipeInspection, setSwipeInspection] = useState<TavernSwipeInspection | null>(null)
  const [draftCharacterId, setDraftCharacterId] = useState<AssetId | null>(null)
  const [draftWorldInfoIds, setDraftWorldInfoIds] = useState<AssetId[]>([])
  const [selectionDirty, setSelectionDirty] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [operationError, setOperationError] = useState(false)
  const [importError, setImportError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [drawer, setDrawer] = useState<Drawer>(null)
  const [libraryTab, setLibraryTab] = useState<LibraryTab>('assets')
  const fileInput = useRef<HTMLInputElement>(null)
  const refreshGeneration = useRef(0)

  async function refreshAssets(): Promise<{
    characters: readonly CharacterAsset[]
    worldInfoLibrary: readonly WorldInfoAsset[]
  } | undefined> {
    const generation = ++refreshGeneration.current
    const isCurrent = (): boolean => refreshGeneration.current === generation
    setLoading(true)
    try {
      const [characterResult, worldInfoResult] = await Promise.all([
        tavernAssets.listCharacters(),
        tavernAssets.listWorldInfo(),
      ])
      if (!characterResult.ok || !worldInfoResult.ok) throw new Error('Tavern asset listing failed')
      const availableCharacters = [...characterResult.value]
      const availableWorldInfo = [...worldInfoResult.value]
      if (!isCurrent()) return { characters: availableCharacters, worldInfoLibrary: availableWorldInfo }
      setCharacters(availableCharacters)
      setWorldInfoLibrary(availableWorldInfo)
      setLoadError(false)
      try {
        const [selected, swipe] = await Promise.all([
          tavernAssets.inspectSession(session.sessionId),
          tavernAssets.inspectSwipe(session.sessionId),
        ])
        if (!selected.ok) throw new Error(selected.error.message)
        if (!swipe.ok) throw new Error(swipe.error.message)
        if (!isCurrent()) return { characters: availableCharacters, worldInfoLibrary: availableWorldInfo }
        const selectedValue = selected.value
        const nextSelection = selectedValue?.selection ?? { characterId: null, worldInfoIds: [] }
        setSessionSelection(selectedValue)
        setSwipeInspection(swipe.value)
        setDraftCharacterId(nextSelection.characterId)
        setDraftWorldInfoIds([...nextSelection.worldInfoIds])
        setSelectionDirty(false)
        setCharacter(selectedValue === null
          ? null
          : availableCharacters.find(asset => asset.id === selectedValue.selection.characterId) ?? null)
        const selectedIds = new Set(nextSelection.worldInfoIds)
        setWorldInfos(availableWorldInfo.filter(asset => selectedIds.has(asset.id)))
        setOperationError(false)
      } catch {
        // Blank sessions can briefly lack their Host agent while the session
        // list settles. Keep the library usable and retry with the next update.
        if (isCurrent()) {
          setSessionSelection(null)
          setDraftCharacterId(null)
          setDraftWorldInfoIds([])
          setSelectionDirty(false)
          setCharacter(null)
          setWorldInfos([])
        }
      }
      return { characters: availableCharacters, worldInfoLibrary: availableWorldInfo }
    } catch {
      if (isCurrent()) setLoadError(true)
      return undefined
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }

  useEffect(() => { void refreshAssets() }, [session.sessionId, sessionRefreshKey, session.blank, tavernAssets])

  async function commitSelection(
    selection: AssetSelection,
    availableCharacters: readonly CharacterAsset[] = characters,
    availableWorldInfo: readonly WorldInfoAsset[] = worldInfoLibrary,
  ): Promise<void> {
    setSaving(true)
    try {
      const result = await tavernAssets.selectForSession(session.sessionId, {
        characterId: selection.characterId,
        worldInfoIds: [...new Set(selection.worldInfoIds)],
      })
      if (!result.ok) throw new Error(result.error.message)
      const selectedValue = result.value
      const nextSelection = selectedValue.selection
      setSessionSelection(selectedValue)
      setDraftCharacterId(nextSelection.characterId)
      setDraftWorldInfoIds([...nextSelection.worldInfoIds])
      setSelectionDirty(false)
      setCharacter(availableCharacters.find(asset => asset.id === nextSelection.characterId) ?? null)
      const selectedIds = new Set(nextSelection.worldInfoIds)
      setWorldInfos(availableWorldInfo.filter(asset => selectedIds.has(asset.id)))
      setOperationError(false)
    } catch {
      setOperationError(true)
    } finally {
      setSaving(false)
    }
  }

  async function characterUpdated(asset: CharacterAsset): Promise<void> {
    const nextCharacters = characters.map(current => current.id === asset.id ? asset : current)
    setCharacters(nextCharacters)
    setCharacter(asset)
    if (sessionSelection !== null) await commitSelection(sessionSelection.selection, nextCharacters)
  }

  async function worldInfoUpdated(asset: WorldInfoAsset): Promise<void> {
    const nextWorldInfo = worldInfoLibrary.map(current => current.id === asset.id ? asset : current)
    setWorldInfoLibrary(nextWorldInfo)
    setWorldInfos(current => current.map(selected => selected.id === asset.id ? asset : selected))
    if (sessionSelection !== null) await commitSelection(sessionSelection.selection, characters, nextWorldInfo)
  }

  function selectCharacter(id: string): void {
    setDraftCharacterId(id === '' ? null : id as AssetId)
    setSelectionDirty(true)
  }

  function toggleWorldInfo(id: AssetId, checked: boolean): void {
    setDraftWorldInfoIds(current => checked
      ? current.includes(id) ? current : [...current, id]
      : current.filter(value => value !== id))
    setSelectionDirty(true)
  }

  function resetSelection(): void {
    const selection = sessionSelection?.selection
    setDraftCharacterId(selection?.characterId ?? null)
    setDraftWorldInfoIds([...(selection?.worldInfoIds ?? [])])
    setSelectionDirty(false)
  }

  function applySelection(): void {
    void commitSelection({ characterId: draftCharacterId, worldInfoIds: draftWorldInfoIds })
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
      if (!imported.ok) throw new Error(imported.error.message)
      const selectedBeforeRefresh = sessionSelection?.selection
      const refreshed = await refreshAssets()
      const availableCharacters = refreshed?.characters ?? characters
      const availableWorldInfo = refreshed?.worldInfoLibrary ?? worldInfoLibrary
      await commitSelection({
        characterId: imported.value.kind === 'character' ? imported.value.id : selectedBeforeRefresh?.characterId ?? null,
        worldInfoIds: imported.value.kind === 'world-info'
          ? [...(selectedBeforeRefresh?.worldInfoIds ?? []), imported.value.id]
          : selectedBeforeRefresh?.worldInfoIds ?? [],
      }, availableCharacters, availableWorldInfo)
      setImportError(false)
    } catch {
      setImportError(true)
    }
  }

  async function regenerate(groupId: string, candidateId: string): Promise<void> {
    const result = await tavernAssets.regenerate(session.sessionId, { groupId, candidateId })
    if (!result.ok) throw new Error(result.error.message)
    openSession(result.value.sessionId)
  }

  const savedWorldInfoIds = sessionSelection?.selection.worldInfoIds ?? []
  const baselineEntryCount = sessionSelection?.baseline.worldInfoEntries.length ?? 0

  return (
    <main className={css.root} data-tavern-workbench="">
      {(loadError || operationError || importError) && <InlineAlert
        kind="error"
        text={loadError ? t('library.loadFailed') : importError ? t('library.invalid') : t('library.operationFailed')}
        action={loadError ? <button type="button" className={css.alertAction} onClick={() => { void refreshAssets() }}>{t('shell.retry')}</button> : undefined}
      />}
      <div className={css.workbench}>
        <aside className={css.rail} aria-label={t('workspace.character')}>
          <div className={css.railHeader}>
            <span className={css.kicker}>{t('workspace.character')}</span>
            <span className={css.railCount}>{characters.length}</span>
          </div>
          {loading ? <RailSkeleton /> : character === null ? (
            <div className={css.characterEmpty}>
              <span className={css.emptyMark} aria-hidden="true"><IconSparkle16 /></span>
              <strong>{t('workspace.noCharacter')}</strong>
              <button type="button" className={css.textButton} onClick={() => { setDrawer('library'); setLibraryTab('assets') }}>
                {t('library.import')}
              </button>
            </div>
          ) : (
            <div className={css.characterCard}>
              <div className={css.avatar} aria-hidden="true">{character.name.slice(0, 1).toUpperCase()}</div>
              <div className={css.characterCopy}>
                <strong>{character.name}</strong>
                <span>{character.version.format}</span>
              </div>
              <span className={css.liveDot} aria-label={t('shell.ready')} />
            </div>
          )}
          <label className={css.characterSelect}>
            <span>{t('library.characterSelect')}</span>
            <select
              className={css.select}
              value={draftCharacterId ?? ''}
              disabled={loading || saving}
              onChange={(event) => { selectCharacter(event.target.value) }}
            >
              <option value="">{t('library.none')}</option>
              {characters.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
            </select>
          </label>

          <div className={css.sectionNav} role="tablist" aria-label={t('workspace.title')}>
            <button type="button" role="tab" aria-label={t('workspace.recent')} aria-selected={drawer === null} className={drawer === null ? css.navActive : css.navButton} onClick={() => { setDrawer(null) }}>
              <span>{t('workspace.recent')}</span><span className={css.navHint}>{session.nodes.length}</span>
            </button>
            <button type="button" role="tab" aria-label={t('library.title')} aria-selected={drawer === 'library'} className={drawer === 'library' ? css.navActive : css.navButton} onClick={() => { setDrawer('library'); setLibraryTab('assets') }}>
              <span>{t('library.title')}</span><span className={css.navHint}>{worldInfoLibrary.length + characters.length}</span>
            </button>
            <button type="button" role="tab" aria-selected={drawer === 'prompt'} className={drawer === 'prompt' ? css.navActive : css.navButton} onClick={() => { setDrawer('prompt') }}>
              <span>{t('prompt.title')}</span><span className={css.navHint}><IconInspectOutline12 /></span>
            </button>
          </div>

          <div className={css.railSection}>
            <div className={css.sectionLabel}>
              <span>{t('library.worldInfo')}</span>
              <span className={css.sectionMeta}>{draftWorldInfoIds.length}/{worldInfoLibrary.length}</span>
            </div>
            {loading ? <div className={css.worldSkeleton}><span /><span /><span /></div> : worldInfoLibrary.length === 0 ? (
              <p className={css.muted}>{t('library.noWorldInfo')}</p>
            ) : (
              <div className={css.worldList}>
                {worldInfoLibrary.map((asset) => {
                  const checked = draftWorldInfoIds.includes(asset.id)
                  const saved = savedWorldInfoIds.includes(asset.id)
                  return <label className={css.worldItem} key={asset.id} data-draft={checked !== saved || undefined}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={saving}
                      onChange={(event) => { toggleWorldInfo(asset.id, event.target.checked) }}
                    />
                    <span className={css.worldText}><strong>{asset.name}</strong><small>{asset.entries.length} {t('library.entries')}</small></span>
                    {checked && <span className={css.checkMark} aria-hidden="true"><IconCheckOutline16 /></span>}
                  </label>
                })}
              </div>
            )}
          </div>

          <div className={css.railFooter}>
            <div className={css.selectionState} data-dirty={selectionDirty || undefined}>
              <span className={css.stateDot} aria-hidden="true" />
              <span>{selectionDirty ? t('selection.unsaved') : t('selection.saved')}</span>
            </div>
            {selectionDirty && <div className={css.selectionActions}>
              <button type="button" className={css.ghostButton} onClick={resetSelection} disabled={saving}>{t('selection.reset')}</button>
              <button type="button" className={css.applyButton} onClick={applySelection} disabled={saving}>
                <span aria-hidden="true"><IconCheckOutline16 /></span>{t('selection.apply')}
              </button>
            </div>}
            <button type="button" className={css.importButton} onClick={() => { setDrawer('library'); setLibraryTab('assets'); fileInput.current?.click() }}>
              <span aria-hidden="true"><IconPlusOutline16 /></span>{t('library.import')}
            </button>
            <input
              ref={fileInput}
              className={css.hiddenInput}
              type="file"
              accept=".json,.png,application/json,image/png"
              onChange={(event) => { void importFile(event) }}
            />
          </div>
        </aside>

        <section className={css.stage} aria-label={t('conversation.title')}>
          <div className={css.stageHeader}>
            <div>
              <span className={css.kicker}>{t('workspace.recent')}</span>
              <h1>{character?.name ?? t('workspace.title')}</h1>
            </div>
            <div className={css.stageMeta}>
              <span className={css.statusBadge}><span className={css.statusDot} />{t('workspace.direct')}</span>
              <span>{session.nodes.length} {t('status.messages')}</span>
            </div>
          </div>
          {character === null ? <div className={css.blankStage}>
            <div className={css.blankLine} />
            <span className={css.emptyMark} aria-hidden="true"><IconSparkle16 /></span>
            <h2>{t('workspace.noCharacter')}</h2>
            <p>{t('library.notSelected')}</p>
            <button type="button" className={css.primaryButton} onClick={() => { setDrawer('library'); setLibraryTab('assets') }}>
              <span aria-hidden="true"><IconListPenOutline16 /></span>{t('library.title')}
            </button>
          </div> : <div className={css.greetingStrip}>
            <div className={css.greetingAvatar} aria-hidden="true">{character.name.slice(0, 1).toUpperCase()}</div>
            <div className={css.greetingCopy}><span>{t('workspace.greeting')}</span><p>{character.firstMessage || t('workspace.noMessages')}</p></div>
            <span className={css.greetingTag}>{character.version.format}</span>
          </div>}
          <div className={css.chatStage}>
            <ChatView {...chatProps} useSession={useSession} useSessions={useSessions} t={conversationT} />
          </div>
        </section>

        <ContextRail
          character={character}
          worldInfos={worldInfos}
          baselineEntryCount={baselineEntryCount}
          latest={latest}
          usage={usage}
          toolCount={toolCount}
          session={session}
          t={t}
          onPrompt={() => { setDrawer('prompt') }}
        />
      </div>

      {drawer !== null && <div className={css.drawerLayer}>
        <div className={css.drawerScrim} aria-hidden="true" />
        <aside className={css.drawer} role="dialog" aria-modal="true" aria-label={drawer === 'library' ? t('library.title') : t('prompt.title')}>
          <div className={css.drawerHeader}>
            <div><span className={css.kicker}>TAVERN</span><h2>{drawer === 'library' ? t('library.title') : t('prompt.title')}</h2></div>
            <button type="button" className={css.closeButton} title={t('drawer.close')} onClick={() => { setDrawer(null) }}><IconCloseOutline16 /></button>
          </div>
          {drawer === 'library' ? <>
            <div className={css.drawerTabs} role="tablist">
              <DrawerTab active={libraryTab === 'assets'} onClick={() => { setLibraryTab('assets') }}>{t('editor.title')}</DrawerTab>
              <DrawerTab active={libraryTab === 'memory'} onClick={() => { setLibraryTab('memory') }}>{t('memory.title')}</DrawerTab>
              <DrawerTab active={libraryTab === 'state'} onClick={() => { setLibraryTab('state') }}>{t('story.title')}</DrawerTab>
              <DrawerTab active={libraryTab === 'swipe'} onClick={() => { setLibraryTab('swipe') }}>{t('swipe.title')}</DrawerTab>
            </div>
            <div className={css.drawerBody}>
              {libraryTab === 'assets' && <TavernAssetEditor
                characters={characters}
                worldInfoLibrary={worldInfoLibrary}
                character={character}
                tavernAssets={tavernAssets}
                t={t}
                onCharacterUpdated={characterUpdated}
                onWorldInfoUpdated={worldInfoUpdated}
                onError={() => { setOperationError(true) }}
              />}
              {libraryTab === 'memory' && <TavernMemoryEditor
                sessionId={session.sessionId}
                tavernAssets={tavernAssets}
                t={t}
                onError={() => { setOperationError(true) }}
              />}
              {libraryTab === 'state' && <TavernStoryStateEditor
                sessionId={session.sessionId}
                tavernAssets={tavernAssets}
                t={t}
                onError={() => { setOperationError(true) }}
              />}
              {libraryTab === 'swipe' && <TavernSwipeEditor
                sessionId={session.sessionId}
                tavernAssets={tavernAssets}
                inspection={swipeInspection}
                t={t}
                onSelected={setSwipeInspection}
                onError={() => { setOperationError(true) }}
                onRegenerate={regenerate}
              />}
            </div>
          </> : <div className={css.drawerBody}><PromptInspector latest={latest} baseline={sessionSelection?.baseline} t={t} /></div>}
        </aside>
      </div>}
    </main>
  )
}

function InlineAlert({ kind, text, action }: { kind: 'error'; text: string; action: ReactElement | undefined }): ReactElement {
  return <div className={css.alert} role="alert" data-kind={kind}><span>{text}</span>{action}</div>
}

function DrawerTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }): ReactElement {
  return <button type="button" role="tab" aria-selected={active} className={active ? css.drawerTabActive : css.drawerTab} onClick={onClick}>{children}</button>
}

interface ContextRailProps {
  readonly character: CharacterAsset | null
  readonly worldInfos: readonly WorldInfoAsset[]
  readonly baselineEntryCount: number
  readonly latest: Extract<RequestView, { purpose: 'assistant' }> | undefined
  readonly usage: { cacheRead: number; cacheWrite: number }
  readonly toolCount: number
  readonly session: ConversationSnapshot
  readonly t: TavernViewProps['t']
  readonly onPrompt: () => void
}

function ContextRail({
  character, worldInfos, baselineEntryCount, latest, usage, toolCount, session, t, onPrompt,
}: ContextRailProps): ReactElement {
  const system = latest?.prompt?.system ?? ''
  const summary = system.length > 180 ? `${system.slice(0, 180)}...` : system
  return <aside className={css.context} aria-label={t('context.title')}>
    <div className={css.contextHeader}><span className={css.kicker}>{t('context.title')}</span><button type="button" className={css.iconButton} title={t('prompt.title')} onClick={onPrompt}><IconInspectOutline12 /></button></div>
    <div className={css.contextSection}>
      <div className={css.sectionLabel}><span>{t('context.assets')}</span><span className={css.sectionMeta}>{character === null ? 0 : 1} + {worldInfos.length}</span></div>
      {character === null ? <p className={css.muted}>{t('context.noCharacter')}</p> : <div className={css.contextCharacter}><span className={css.contextAvatar} aria-hidden="true">{character.name.slice(0, 1).toUpperCase()}</span><div><strong>{character.name}</strong><span>{character.version.format}</span></div></div>}
      <div className={css.contextList}>
        {worldInfos.map(asset => (
          <div className={css.contextItem} key={asset.id}>
            <span className={css.contextItemDot} />
            <span>{asset.name}</span>
            <small>{asset.entries.length}</small>
          </div>
        ))}
        {worldInfos.length === 0 && <p className={css.muted}>{t('context.noWorldInfo')}</p>}
      </div>
      <div className={css.baselineNote}><span>{t('context.baselineEntries')}</span><strong>{baselineEntryCount}</strong></div>
    </div>
    <div className={css.contextSection}>
      <div className={css.sectionLabel}><span>{t('context.runtime')}</span><span className={css.statusBadge}><span className={css.statusDot} />{t('shell.ready')}</span></div>
      <div className={css.statList}>
        <Stat label={t('status.messages')} value={String(session.nodes.length)} />
        <Stat label={t('status.requests')} value={String(latest === undefined ? 0 : 1)} />
        <Stat label={t('status.tools')} value={String(toolCount)} />
        <Stat label={t('status.cacheRead')} value={String(usage.cacheRead)} />
        <Stat label={t('status.cacheWrite')} value={String(usage.cacheWrite)} />
      </div>
    </div>
    <div className={css.promptPeek}>
      <div className={css.sectionLabel}><span>{t('context.lastRequest')}</span><span>{latest === undefined ? '-' : `#${latest.turn}`}</span></div>
      {latest === undefined ? <p className={css.muted}>{t('context.noRequest')}</p> : <p>{summary || t('prompt.empty')}</p>}
      <button type="button" className={css.inspectButton} onClick={onPrompt}><span aria-hidden="true"><IconInspectOutline12 /></span>{t('prompt.title')}</button>
    </div>
  </aside>
}

function Stat({ label, value }: { label: string; value: string }): ReactElement {
  return <div className={css.stat}><span>{label}</span><strong>{value}</strong></div>
}

function RailSkeleton(): ReactElement {
  return <div className={css.railSkeleton} aria-label="Loading"><span className={css.skeletonAvatar} /><span className={css.skeletonLine} /><span className={css.skeletonShort} /></div>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
