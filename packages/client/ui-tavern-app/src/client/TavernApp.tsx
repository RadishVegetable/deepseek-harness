/** Tavern's only browser root: navigation, library, history, and settings. */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, ReactNode } from 'react'
import type { PropsLocale, PropsRenderSlots, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { IconArchiveOutline20, IconPlusOutline16, IconSettingsOutline16, IconTrashOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CharacterAsset, TavernHistoryEntry, TavernImportOptions, WorldInfoAsset } from '@deepseek-ai/dsh-tavern-host/client'
import { archiveActiveJourney, isJourneyArchiveInFlight } from './archive.ts'
import { ArchiveDialog } from './ArchiveDialog.tsx'
import { DeleteAssetDialog } from './DeleteAssetDialog.tsx'
import { navigateTavern, useTavernRoute, type TavernRoute } from './navigation.ts'
import { NS } from './locales.ts'
import type { TavernAssetsRemote } from './remote.ts'
import css from './TavernApp.module.css'
import { useTavernDialogFocus } from './useTavernDialogFocus.ts'

/** Props delivered to the root by the built-in slot renderer. */
export type TavernAppProps = PropsRuntime<'root'>
  & PropsRenderSlots<'tavern.journey'>
  & PropsLocale<typeof NS>
  & { readonly tavernAssets: TavernAssetsRemote; readonly sessions: ISessions; readonly locale: LocaleRuntime }

function remoteValue<T>(
  result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly message: string } },
): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback
}

function routeIsJourney(route: TavernRoute): route is Extract<TavernRoute, { name: 'journey' }> {
  return route.name === 'journey'
}

function routeButtonClass(route: TavernRoute, name: 'library' | 'history' | 'settings'): string {
  return (route.name === name ? css.navActive : css.navButton) ?? ''
}

function historyTitle(entry: TavernHistoryEntry, t: TranslateNS<typeof NS>): string {
  return entry.characterName ?? entry.selection?.characterName ?? t('journey.untitled')
}

type AssetImportKind = 'character' | 'world-info'

interface AssetLibrary {
  readonly characters: readonly CharacterAsset[]
  readonly worlds: readonly WorldInfoAsset[]
}

type DeletableAsset = CharacterAsset | WorldInfoAsset

/** Read the authoritative source-asset lists used by both Library and setup. */
async function readAssetLibrary(tavernAssets: TavernAssetsRemote): Promise<AssetLibrary> {
  const [characterResult, worldResult] = await Promise.all([
    tavernAssets.listCharacters(),
    tavernAssets.listWorldInfo(),
  ])
  return {
    characters: remoteValue(characterResult),
    worlds: remoteValue(worldResult),
  }
}

/** Keep a just-imported asset usable if a mocked or eventually consistent list omits it. */
function includeImportedAsset(library: AssetLibrary, imported: CharacterAsset | WorldInfoAsset): AssetLibrary {
  if (imported.kind === 'character') {
    return library.characters.some(asset => asset.id === imported.id)
      ? library
      : { ...library, characters: [imported, ...library.characters] }
  }
  return library.worlds.some(asset => asset.id === imported.id)
    ? library
    : { ...library, worlds: [imported, ...library.worlds] }
}

function requestIsStale(request: object, current: object | null): boolean {
  return current !== request
}

function componentIsUnmounted(mounted: { readonly current: boolean }): boolean {
  return !mounted.current
}

/** Visible JSON import actions for the first-run asset library. */
function AssetImportControls({
  importing,
  onFile,
  t,
}: {
  readonly importing: AssetImportKind | null
  readonly onFile: (kind: AssetImportKind, file: File) => Promise<void>
  readonly t: TranslateNS<typeof NS>
}) {
  const characterInput = useRef<HTMLInputElement>(null)
  const worldInfoInput = useRef<HTMLInputElement>(null)
  const handleChange = (kind: AssetImportKind, event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (file !== undefined) void onFile(kind, file)
  }
  return (
    <div className={css.assetActions} aria-label={t('library.importActions')}>
      <input ref={characterInput} className={css.srOnly} tabIndex={-1} aria-hidden="true" data-asset-kind="character" type="file" accept=".json,application/json" onChange={(event) => { handleChange('character', event) }} />
      <button className={css.secondaryButton} type="button" disabled={importing !== null} onClick={() => { characterInput.current?.click() }}>
        <IconPlusOutline16 aria-hidden="true" />{importing === 'character' ? t('library.importingCharacter') : t('library.importCharacter')}
      </button>
      <input ref={worldInfoInput} className={css.srOnly} tabIndex={-1} aria-hidden="true" data-asset-kind="world-info" type="file" accept=".json,application/json" onChange={(event) => { handleChange('world-info', event) }} />
      <button className={css.secondaryButton} type="button" disabled={importing !== null} onClick={() => { worldInfoInput.current?.click() }}>
        <IconPlusOutline16 aria-hidden="true" />{importing === 'world-info' ? t('library.importingWorld') : t('library.importWorld')}
      </button>
    </div>
  )
}

/** Compact setup dialog for a Character Card and its attached World Books. */
function JourneySetup({
  character,
  worlds,
  onClose,
  onStart,
  t,
}: {
  readonly character: CharacterAsset
  readonly worlds: readonly WorldInfoAsset[]
  readonly onClose: () => void
  readonly onStart: (worldInfoIds: readonly WorldInfoAsset['id'][], playerIdentity: string) => Promise<void>
  readonly t: TranslateNS<typeof NS>
}) {
  const [selectedWorlds, setSelectedWorlds] = useState<readonly WorldInfoAsset['id'][]>([])
  const [playerIdentity, setPlayerIdentity] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialog = useRef<HTMLElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  useTavernDialogFocus(dialog, closeButton, onClose, !busy)
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onStart(selectedWorlds, playerIdentity)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('error.setup'))
    } finally {
      setBusy(false)
    }
  }
  const toggleWorld = (id: WorldInfoAsset['id']): void => {
    setSelectedWorlds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])
  }
  return (
    <div className={css.scrim} role="presentation">
      <section ref={dialog} tabIndex={-1} className={css.dialog} role="dialog" aria-modal="true" aria-labelledby="journey-setup-title">
        <div className={css.dialogHeader}><div><p className={css.eyebrow}>{t('setup.eyebrow')}</p><h2 id="journey-setup-title">{character.name}</h2></div><button ref={closeButton} className={css.closeButton} type="button" aria-label={t('setup.close')} onClick={onClose}>{t('setup.close')}</button></div>
        <p className={css.dialogIntro}>{character.description || t('setup.descriptionFallback')}</p>
        <form onSubmit={event => void submit(event)}>
          <label className={css.fieldLabel} htmlFor="tavern-player-identity">{t('setup.identity')} <span>{t('setup.optional')}</span></label>
          <input id="tavern-player-identity" className={css.input} value={playerIdentity} onChange={(event) =>{  setPlayerIdentity(event.target.value) }} placeholder={t('setup.identityPlaceholder')} />
          <fieldset className={css.fieldset}><legend>{t('setup.worldBooks')} <span>{t('setup.optional')}</span></legend>{worlds.length === 0 ? <p className={css.fieldHint}>{t('setup.noWorldBooks')}</p> : worlds.map(world => <label className={css.checkRow} key={String(world.id)}><input type="checkbox" checked={selectedWorlds.includes(world.id)} onChange={() =>{  toggleWorld(world.id) }} /><span><strong>{world.name}</strong><small>{t('setup.entries', { count: world.entries.length })}</small></span></label>)}</fieldset>
          {error !== null && <p className={css.error} role="alert">{error}</p>}
          <div className={css.dialogActions}><button className={css.secondaryButton} type="button" onClick={onClose}>{t('setup.cancel')}</button><button className={css.primaryButton} type="submit" disabled={busy}>{busy ? t('setup.preparing') : t('setup.begin')}</button></div>
        </form>
      </section>
    </div>
  )
}

/** Tavern-owned root UI. */
export function TavernApp({ useSessions, useWorkspaces, renderSlot, tavernAssets, sessions, locale, t }: TavernAppProps) {
  const sessionList = useSessions(s => s)
  const workspaceList = useWorkspaces(s => s)
  const route = useTavernRoute()
  const [characters, setCharacters] = useState<readonly CharacterAsset[]>([])
  const [worlds, setWorlds] = useState<readonly WorldInfoAsset[]>([])
  const [libraryLoading, setLibraryLoading] = useState(true)
  const [libraryError, setLibraryError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [setupCharacter, setSetupCharacter] = useState<CharacterAsset | null>(null)
  const [archiving, setArchiving] = useState<SessionId | null>(null)
  const [history, setHistory] = useState<ReadonlyMap<SessionId, TavernHistoryEntry | Error>>(new Map())
  const [restoring, setRestoring] = useState<SessionId | null>(null)
  const [optimisticArchived, setOptimisticArchived] = useState<ReadonlySet<SessionId>>(new Set())
  const [optimisticRestored, setOptimisticRestored] = useState<ReadonlySet<SessionId>>(new Set())
  const [warmSurfaces, setWarmSurfaces] = useState(true)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState<SessionId | null>(null)
  const [archiveError, setArchiveError] = useState<string | null>(null)
  const [importing, setImporting] = useState<AssetImportKind | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<DeletableAsset | null>(null)
  const [deletingAssetId, setDeletingAssetId] = useState<DeletableAsset['id'] | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const firstCharacterButton = useRef<HTMLButtonElement>(null)
  const mounted = useRef(false)
  const libraryRequest = useRef<object | null>(null)
  const archiveTransition = useRef<SessionId | null>(null)
  const historyRequest = useRef<object | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    let cancelled = false
    const request = {}
    libraryRequest.current = request
    void readAssetLibrary(tavernAssets).then((library) => {
      if (cancelled || requestIsStale(request, libraryRequest.current)) return
      setCharacters(library.characters)
      setWorlds(library.worlds)
      setLibraryError(null)
      setLibraryLoading(false)
    }).catch((reason: unknown) => {
      if (cancelled || requestIsStale(request, libraryRequest.current)) return
      setLibraryError(errorMessage(reason, t('error.assetLibrary')))
      setLibraryLoading(false)
    })
    return () => { cancelled = true }
  }, [tavernAssets])

  const importAsset = async (kind: AssetImportKind, file: File): Promise<void> => {
    setImporting(kind)
    setImportError(null)
    try {
      const input = await file.text()
      const parsed: unknown = JSON.parse(input)
      if (parsed === null || typeof parsed !== 'object') throw new Error(t('error.invalidJson'))
      const options: TavernImportOptions = {
        source: { kind: 'upload', locator: file.name, mediaType: file.type || 'application/json' },
      }
      const imported = kind === 'character'
        ? await tavernAssets.importCharacter(input, options)
        : await tavernAssets.importWorldInfo(input, options)
      if (!imported.ok) throw new Error(imported.error.message)
      if (componentIsUnmounted(mounted)) return
      const asset = imported.value
      const request = {}
      libraryRequest.current = request
      try {
        const library = includeImportedAsset(await readAssetLibrary(tavernAssets), asset)
        if (componentIsUnmounted(mounted) || requestIsStale(request, libraryRequest.current)) return
        setCharacters(library.characters)
        setWorlds(library.worlds)
        setLibraryError(null)
        setLibraryLoading(false)
      } catch (reason) {
        if (componentIsUnmounted(mounted) || requestIsStale(request, libraryRequest.current)) return
        if (asset.kind === 'character') {
          setCharacters(current => current.some(item => item.id === asset.id) ? current : [asset, ...current])
        } else {
          setWorlds(current => current.some(item => item.id === asset.id) ? current : [asset, ...current])
        }
        setLibraryLoading(false)
        setImportError(t('error.importRefresh', {
          asset: kind === 'character' ? t('library.characterCard') : t('library.worldBook'),
          reason: errorMessage(reason, t('error.unknownRefresh')),
        }))
      }
      setNotice(asset.kind === 'character'
        ? t('notice.characterReady', { name: asset.name })
        : t('notice.worldReady', { name: asset.name }))
    } catch (reason) {
      if (mounted.current) setImportError(errorMessage(reason, t('error.import')))
    } finally {
      if (mounted.current) setImporting(null)
    }
  }

  const allTavernSessions = useMemo(() => sessionList.ids.flatMap((id) => {
    const summary = sessionList.byId[id]
    return summary?.agentPreset === 'tavern' && ! summary.blank ? [summary] : []
  }), [sessionList])
  const archivedIds = workspaceList.archivedSessionIds
  const isArchived = (id: SessionId): boolean => optimisticRestored.has(id)
    ? false
    : optimisticArchived.has(id) || archivedIds.includes(id)
  const activeJourneys = allTavernSessions.filter(summary => !isArchived(summary.id))
  const archivedJourneyIds = useMemo(() => {
    const ids: SessionId[] = []
    const seen = new Set<SessionId>()
    for (const id of [...archivedIds, ...optimisticArchived]) {
      if (optimisticRestored.has(id) || seen.has(id)) continue
      seen.add(id)
      ids.push(id)
    }
    return ids
  }, [archivedIds, optimisticArchived, optimisticRestored])

  useEffect(() => {
    if (route.name !== 'journey') return
    if (sessionList.phase !== 'ready' || workspaceList.phase !== 'ready') return
    if (archiveTransition.current === route.journeyId || archiving === route.journeyId || isJourneyArchiveInFlight(route.journeyId)) return
    const target = sessionList.byId[route.journeyId]
    if (target === undefined || isArchived(route.journeyId)) {
      navigateTavern({ name: 'library' }, true)
      setNotice(t('error.route'))
      return
    }
    if (sessionList.current !== route.journeyId) sessions.open(route.journeyId)
  }, [archivedIds, archiving, optimisticArchived, optimisticRestored, route, sessionList, sessions, workspaceList.phase])

  const navigate = (next: TavernRoute, replace = false): void => {
    setNotice(null)
    navigateTavern(next, replace)
  }

  const startJourney = async (character: CharacterAsset, worldInfoIds: readonly WorldInfoAsset['id'][], playerIdentity: string): Promise<void> => {
    const sessionId = await sessions.create({ agentPreset: 'tavern' })
    sessions.open(sessionId)
    try {
      const result = remoteValue(await tavernAssets.bootstrapJourney(
        sessionId,
        { characterId: character.id, worldInfoIds },
        playerIdentity.trim() || null,
      ))
      if (result.selection.character === null) throw new Error(t('error.attachCharacter'))
      setSetupCharacter(null)
      navigate({ name: 'journey', journeyId: sessionId })
    } catch (error) {
      sessions.clear()
      throw error
    }
  }

  const archive = async (sessionId: SessionId): Promise<void> => {
    archiveTransition.current = sessionId
    setArchiving(sessionId)
    setNotice(null)
    setArchiveError(null)
    try {
      await archiveActiveJourney(sessionId, {
        sessions: { clear: () => { sessions.clear() } },
        archive: id => tavernAssets.archiveHistory(id),
        navigateToLibrary: () => { navigateTavern({ name: 'library' }) },
        currentSessionId: sessionList.current,
      })
      setOptimisticArchived(current => new Set(current).add(sessionId))
      setOptimisticRestored((current) => { const next = new Set(current); next.delete(sessionId); return next })
      setNotice(t('notice.archived'))
      setConfirmArchive(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : t('error.archive')
      setArchiveError(message)
      setNotice(message)
    } finally {
      if (archiveTransition.current === sessionId) archiveTransition.current = null
      setArchiving(null)
    }
  }

  useEffect(() => {
    if (route.name !== 'history') return
    let cancelled = false
    const request = {}
    historyRequest.current = request
    for (const sessionId of archivedJourneyIds) {
      if (history.has(sessionId)) continue
      void tavernAssets.inspectArchivedHistory(sessionId).then((result) => {
        if (cancelled || requestIsStale(request, historyRequest.current)) return
        setHistory(current => new Map(current).set(sessionId, result.ok ? result.value : new Error(result.error.message)))
      }).catch((reason: unknown) => {
        if (cancelled || requestIsStale(request, historyRequest.current)) return
        setHistory(current => new Map(current).set(sessionId, new Error(errorMessage(reason, t('error.history')))))
      })
    }
    return () => {
      cancelled = true
      if (historyRequest.current === request) historyRequest.current = null
    }
  }, [route, archivedJourneyIds, history, tavernAssets])

  const restore = async (sessionId: SessionId): Promise<void> => {
    setRestoring(sessionId)
    try {
      remoteValue(await tavernAssets.restoreHistory(sessionId))
      setOptimisticRestored(current => new Set(current).add(sessionId))
      setOptimisticArchived((current) => { const next = new Set(current); next.delete(sessionId); return next })
      setHistory((current) => {
        if (!current.has(sessionId)) return current
        const next = new Map(current)
        next.delete(sessionId)
        return next
      })
      sessions.open(sessionId)
      navigateTavern({ name: 'journey', journeyId: sessionId })
      setNotice(t('notice.restored'))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('error.restore'))
    } finally {
      setRestoring(null)
    }
  }

  const deleteAsset = async (asset: DeletableAsset): Promise<void> => {
    const type = asset.kind === 'character' ? t('library.characterCard') : t('library.worldBook')
    setDeletingAssetId(asset.id)
    setDeleteError(null)
    try {
      const result = await tavernAssets.deleteAsset(asset.id)
      if (!result.ok) throw new Error(result.error.message)
      if (!result.value) throw new Error(t('error.deleteAssetMissing', { type, name: asset.name }))
      if (componentIsUnmounted(mounted)) return
      if (asset.kind === 'character') setCharacters(current => current.filter(candidate => candidate.id !== asset.id))
      else setWorlds(current => current.filter(candidate => candidate.id !== asset.id))
      setConfirmDelete(null)
      setNotice(t('notice.assetDeleted', { type, name: asset.name }))
    } catch (reason) {
      if (mounted.current) setDeleteError(t('error.deleteAsset', { type, name: asset.name, reason: errorMessage(reason, t('error.deleteAssetUnknown')) }))
    } finally {
      if (mounted.current) setDeletingAssetId(null)
    }
  }

  const renderLibrary = (): ReactNode => (
    <section className={css.library} aria-labelledby="tavern-library-title">
      <div className={css.hero}>
        <p className={css.eyebrow}>{t('library.eyebrow')}</p>
        <h1 id="tavern-library-title">{t('library.title')}</h1>
        <p className={css.heroCopy}>
          {t('library.copy')}
        </p>
        <button className={css.primaryButton} type="button" onClick={() => { if (characters.length === 0) setNotice(t('library.addCharacterFirst')); else { setNotice(t('library.chooseCharacter')); firstCharacterButton.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); firstCharacterButton.current?.focus() } }}><IconPlusOutline16 aria-hidden="true" />{t('library.newJourney')}</button>
        <AssetImportControls importing={importing} onFile={importAsset} t={t} />
        {importing !== null && <p className={css.importStatus} role="status">{t('library.reading', { asset: importing === 'character' ? t('library.characterCard') : t('library.worldBook') })}</p>}
        {importError !== null && <p className={css.error} role="alert">{importError}</p>}
      </div>
      <section className={css.section} aria-labelledby="character-library-title"><div className={css.sectionHeading}><div><p className={css.eyebrow}>{t('library.sourceAssets')}</p><h2 id="character-library-title">{t('library.characterCards')}</h2></div><span className={css.count}>{t('library.available', { count: characters.length })}</span></div>{libraryError !== null ? <p className={css.error} role="alert">{libraryError}</p> : libraryLoading ? <p className={css.loadingState} role="status">{t('library.loading')}</p> : characters.length === 0 ? <p className={css.empty}>{t('library.noCharacters')}</p> : <div className={css.cards}>{characters.map((character, index) => <article className={css.card} key={String(character.id)}><div className={css.avatar} aria-hidden="true">{character.name.slice(0, 1).toUpperCase()}</div><div className={css.cardBody}><h3>{character.name}</h3><p>{character.description || t('library.characterReady')}</p><div className={css.cardActions}><button ref={index === 0 ? firstCharacterButton : undefined} className={css.textButton} type="button" onClick={() =>{  setSetupCharacter(character) }}>{t('library.beginWith', { name: character.name })}</button><button className={`${css.iconButton} ${css.dangerIconButton}`} type="button" title={t('library.deleteAsset', { type: t('library.characterCard'), name: character.name })} aria-label={t('library.deleteAsset', { type: t('library.characterCard'), name: character.name })} disabled={deletingAssetId !== null || importing !== null} onClick={() => { setDeleteError(null); setConfirmDelete(character) }}><IconTrashOutline16 aria-hidden="true" /></button></div></div></article>)}</div>}</section>
      <section className={css.section} aria-labelledby="world-library-title">
        <div className={css.sectionHeading}>
          <div><p className={css.eyebrow}>{t('library.settingScene')}</p><h2 id="world-library-title">{t('library.worldBooks')}</h2></div>
          <span className={css.count}>{t('library.available', { count: worlds.length })}</span>
        </div>
        {libraryError !== null ? <p className={css.error} role="alert">{libraryError}</p> : libraryLoading ? <p className={css.loadingState} role="status">{t('library.loading')}</p> : worlds.length === 0 ? <p className={css.empty}>{t('library.noWorldBooks')}</p> : <div className={css.worldList}>{worlds.map(world => <article className={css.worldCard} key={String(world.id)}><div className={css.worldCardTop}><h3>{world.name}</h3><button className={`${css.iconButton} ${css.dangerIconButton}`} type="button" title={t('library.deleteAsset', { type: t('library.worldBook'), name: world.name })} aria-label={t('library.deleteAsset', { type: t('library.worldBook'), name: world.name })} disabled={deletingAssetId !== null || importing !== null} onClick={() => { setDeleteError(null); setConfirmDelete(world) }}><IconTrashOutline16 aria-hidden="true" /></button></div><p>{t('library.entriesReady', { count: world.entries.length })}</p></article>)}</div>}
      </section>
      <section className={css.section} aria-labelledby="journeys-title"><div className={css.sectionHeading}><div><p className={css.eyebrow}>{t('library.inMotion')}</p><h2 id="journeys-title">{t('library.activeJourneys')}</h2></div><span className={css.count}>{t('library.active', { count: activeJourneys.length })}</span></div>{activeJourneys.length === 0 ? <p className={css.empty}>{t('library.nextJourney')}</p> : <div className={css.journeyList}>{activeJourneys.map(journey => <article className={css.journeyRow} key={journey.id}><button className={css.journeyOpen} type="button" onClick={() =>{  navigate({ name: 'journey', journeyId: journey.id }) }}><span><strong>{journey.displayTitle}</strong><small>{t('library.updated', { date: new Date(journey.updatedAt).toLocaleDateString(locale.getLocale().active) })}</small></span><span aria-hidden="true">{t('library.open')}</span></button><button className={css.iconButton} type="button" aria-label={t('library.archive', { title: journey.displayTitle })} disabled={archiving === journey.id} onClick={() => { setArchiveError(null); setConfirmArchive(journey.id) }}><IconArchiveOutline20 aria-hidden="true" /></button></article>)}</div>}</section>
    </section>
  )

  const renderHistory = (): ReactNode => {
    return <section className={css.page} aria-labelledby="history-title"><div className={css.pageIntro}><p className={css.eyebrow}>{t('history.eyebrow')}</p><h1 id="history-title">{t('history.title')}</h1><p>{t('history.copy')}</p></div>{archivedJourneyIds.length === 0 ? <p className={css.empty}>{t('history.empty')}</p> : <div className={css.historyList}>{archivedJourneyIds.map((sessionId) => { const entry = history.get(sessionId); const fallbackTitle = sessionList.byId[sessionId]?.displayTitle ?? t('history.archivedTitle'); const displayName = entry instanceof Error ? fallbackTitle : entry === undefined ? t('history.loadingTitle') : historyTitle(entry, t); const avatarName = entry instanceof Error ? fallbackTitle : entry?.characterName ?? fallbackTitle; const description = entry instanceof Error ? entry.message : entry === undefined ? t('history.loadingMetadata') : entry.lastContent ?? t('history.available'); const descriptionRole = entry instanceof Error ? 'alert' : entry === undefined ? 'status' : undefined; return <article className={css.historyCard} key={sessionId}><div className={css.historyCardTop}><div className={css.avatarSmall} aria-hidden="true">{avatarName.slice(0, 1).toUpperCase()}</div><div><h2>{displayName}</h2><p className={entry instanceof Error ? css.error : undefined} role={descriptionRole}>{description}</p></div></div><div className={css.historyActions}><button className={css.secondaryButton} type="button" disabled={restoring === sessionId} onClick={() => void restore(sessionId)}>{restoring === sessionId ? t('history.restoring') : t('history.restore')}</button><span className={css.archivedLabel}>{t('history.archived')}</span></div></article> })}</div>}</section>
  }

  const renderSettings = (): ReactNode => <section className={css.page} aria-labelledby="settings-title"><div className={css.pageIntro}><p className={css.eyebrow}>{t('settings.eyebrow')}</p><h1 id="settings-title">{t('settings.title')}</h1><p>{t('settings.copy')}</p></div><div className={css.settingsGrid}><section className={css.settingsCard}><h2>{t('settings.readingMode')}</h2><label className={css.checkRow}><input type="checkbox" checked={warmSurfaces} onChange={(event) =>{  setWarmSurfaces(event.target.checked) }} /><span><strong>{t('settings.warmSurfaces')}</strong><small>{t('settings.warmSurfacesHelp')}</small></span></label><label className={css.checkRow}><input type="checkbox" checked={reducedMotion} onChange={(event) =>{  setReducedMotion(event.target.checked) }} /><span><strong>{t('settings.reducedMotion')}</strong><small>{t('settings.reducedMotionHelp')}</small></span></label><label className={css.fieldLabel} htmlFor="tavern-language">{t('settings.language')}</label><select id="tavern-language" className={css.input} aria-label={t('settings.language.aria')} value={locale.getLocale().active} onChange={(event) => { locale.setLocale(event.target.value) }}><option value="zh">{t('settings.language.chinese')}</option><option value="en">{t('settings.language.english')}</option></select></section><section className={css.settingsCard}><h2>{t('settings.modelRoute')}</h2><label className={css.fieldLabel} htmlFor="tavern-model">{t('settings.modelLabel')}</label><select id="tavern-model" className={css.input} disabled aria-describedby="tavern-model-help"><option>{t('settings.defaultModel')}</option></select><p id="tavern-model-help" className={css.fieldHint}><IconSettingsOutline16 aria-hidden="true" /> {t('settings.modelUnavailable')}</p></section></div></section>

  return (
    <main className={`${css.app} ${warmSurfaces ? '' : css.coolSurfaces} ${reducedMotion ? css.motionReduced : ''}`} data-testid="tavern-app">
      <header className={css.header}><button className={css.brand} type="button" onClick={() =>{  navigate({ name: 'library' }) }}><span className={css.brandMark} aria-hidden="true">T</span><span>Tavern</span></button><nav className={css.nav} aria-label={t('nav.aria')}><button className={routeButtonClass(route, 'library')} type="button" aria-current={route.name === 'library' ? 'page' : undefined} onClick={() =>{  navigate({ name: 'library' }) }}>{t('nav.library')}</button><button className={routeButtonClass(route, 'history')} type="button" aria-current={route.name === 'history' ? 'page' : undefined} onClick={() =>{  navigate({ name: 'history' }) }}>{t('nav.history')}</button><button className={routeButtonClass(route, 'settings')} type="button" aria-current={route.name === 'settings' ? 'page' : undefined} onClick={() =>{  navigate({ name: 'settings' }) }}>{t('nav.settings')}</button></nav><span className={css.connection}>{t('header.ready')}</span></header>
      {notice !== null && <div className={css.notice} role="status">{notice}</div>}
      {route.name === 'library' && renderLibrary()}
      {route.name === 'history' && renderHistory()}
      {route.name === 'settings' && renderSettings()}
      {routeIsJourney(route) && sessionList.byId[route.journeyId] !== undefined && renderSlot('tavern.journey', {
        route: 'journey',
        journeyId: route.journeyId,
        onArchiveSuccess: () => { setNotice(t('notice.archived')) },
        onNavigateToLibrary: () => { navigate({ name: 'library' }) },
      })}
      {setupCharacter !== null && (
        <JourneySetup
          character={setupCharacter}
          worlds={worlds}
          onClose={() => { setSetupCharacter(null) }}
          onStart={(worldInfoIds, playerIdentity) => startJourney(setupCharacter, worldInfoIds, playerIdentity)}
          t={t}
        />
      )}
      {confirmDelete !== null && <DeleteAssetDialog assetName={confirmDelete.name} assetType={confirmDelete.kind === 'character' ? t('library.characterCard') : t('library.worldBook')} busy={deletingAssetId === confirmDelete.id} error={deleteError} onCancel={() => { if (deletingAssetId === null) { setDeleteError(null); setConfirmDelete(null) } }} onConfirm={() => void deleteAsset(confirmDelete)} t={t} />}
      {confirmArchive !== null && <ArchiveDialog title={sessionList.byId[confirmArchive]?.displayTitle ?? t('library.archiveDefaultTitle')} busy={archiving === confirmArchive} error={archiveError} onCancel={() => { if (archiving === null) { setArchiveError(null); setConfirmArchive(null) } }} onConfirm={() => void archive(confirmArchive)} t={t} />}
    </main>
  )
}
