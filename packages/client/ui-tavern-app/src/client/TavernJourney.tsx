/** Session-aware transcript, composer, and Journey context panels. */

import { useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import { IconArchiveOutline20, IconChevronLeftOutline14, IconCloseOutline16, IconSendOutline16, IconStopFill16, IconUserOutline16, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TavernFactInspection, TavernJourneyAssetProjection, TavernMemoryInspection, TavernSwipeInspection } from '@deepseek-ai/dsh-tavern-host/client'
import { archiveActiveJourney } from './archive.ts'
import { ArchiveDialog } from './ArchiveDialog.tsx'
import { NS } from './locales.ts'
import { TavernMemoryPanel, type ContextView } from './TavernMemoryPanel.tsx'
import type { TavernAssetsRemote } from './remote.ts'
import css from './TavernApp.module.css'
import { useTavernDialogFocus } from './useTavernDialogFocus.ts'

type JourneyProps = PropsRuntime<'tavern.journey'> & PropsLocale<typeof NS> & { readonly tavernAssets: TavernAssetsRemote; readonly sessions: ISessions }
type Drawer = ContextView | 'swipe' | null

function messageText(content: readonly { type: string; text?: string }[]): string {
  return content.filter(part => part.type === 'text').map(part => part.text ?? '').join('')
}

function projectionTitle(projection: TavernJourneyAssetProjection | null, t: TranslateNS<typeof NS>): string {
  return projection?.character?.name ?? projection?.characterName ?? t('journey.untitled')
}

/** Drawer for alternate assistant responses. Journey context is rendered by TavernMemoryPanel. */
function JourneyDrawer({
  swipe,
  swipeBusy,
  drawerError,
  onClose,
  onSwipe,
  t,
}: {
  readonly swipe: TavernSwipeInspection | null
  readonly swipeBusy: boolean
  readonly drawerError: string | null
  readonly onClose: () => void
  readonly onSwipe: (groupId: string, candidateId: string) => void
  readonly t: TranslateNS<typeof NS>
}) {
  const drawerRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  useTavernDialogFocus(drawerRef, closeRef, onClose, true)
  return <aside ref={drawerRef} id="tavern-swipe-drawer" tabIndex={-1} className={css.drawer} role="dialog" aria-modal="true" aria-labelledby="tavern-swipe-title">
    <div className={css.drawerHeader}>
      <div><p className={css.eyebrow}>{t('drawer.eyebrow')}</p><h2 id="tavern-swipe-title">{t('journey.swipe')}</h2></div>
      <button ref={closeRef} className={css.closeButton} type="button" aria-label={t('drawer.close')} onClick={onClose}><IconCloseOutline16 aria-hidden="true" /></button>
    </div>
    {drawerError !== null
      ? <p className={css.error} role="alert">{drawerError}</p>
      : <div className={css.drawerBody}>
        {swipe === null
          ? <p className={css.muted}>{t('drawer.swipeLoading')}</p>
          : swipe.groups.length === 0
            ? <p className={css.muted}>{t('drawer.noCandidates')}</p>
            : swipe.groups.map(group => <div className={css.swipeGroup} key={group.groupId}>
              <h3>{t('drawer.responseChoices')}</h3>
              {group.candidates.map(candidate => <button className={candidate.candidateId === group.currentCandidateId ? css.candidateActive : css.candidate} key={candidate.candidateId} type="button" disabled={swipeBusy} onClick={() => { onSwipe(group.groupId, candidate.candidateId) }}>
                <span><MarkdownText text={candidate.text} /></span>
                <small>{swipeBusy ? t('drawer.selecting') : candidate.candidateId === group.currentCandidateId ? t('drawer.selected') : t('drawer.useResponse')}</small>
              </button>)}
            </div>)}
      </div>}
  </aside>
}

/** Render the active Journey from the runtime session snapshot. */
export function TavernJourney({
  sessionId,
  useSession,
  route,
  onNavigateToLibrary,
  onArchiveSuccess,
  tavernAssets,
  sessions,
  t,
}: JourneyProps) {
  const snapshot = useSession(s => s)
  const session = sessionId === undefined ? undefined : sessions.binding(sessionId)?.session
  const [draft, setDraft] = useState('')
  const [drawer, setDrawer] = useState<Drawer>(null)
  const [projection, setProjection] = useState<TavernJourneyAssetProjection | null>(null)
  const [facts, setFacts] = useState<TavernFactInspection | null>(null)
  const [factsLoading, setFactsLoading] = useState(false)
  const [factsError, setFactsError] = useState<string | null>(null)
  const [memoryInspection, setMemoryInspection] = useState<TavernMemoryInspection | null>(null)
  const [memoryLoading, setMemoryLoading] = useState(false)
  const [memoryError, setMemoryError] = useState<string | null>(null)
  const [swipe, setSwipe] = useState<TavernSwipeInspection | null>(null)
  const [loadingDrawer, setLoadingDrawer] = useState(false)
  const [drawerError, setDrawerError] = useState<string | null>(null)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [swipeBusy, setSwipeBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!confirmArchive) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      if (!archiving) setConfirmArchive(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [archiving, confirmArchive])

  useEffect(() => {
    if (sessionId === undefined) return
    let cancelled = false
    void tavernAssets.inspectJourneyAssets(sessionId).then((result) => {
      if (cancelled) return
      if (result.ok) setProjection(result.value)
      else setError(result.error.message)
    }).catch((reason: unknown) => {
      if (cancelled) return
      setError(reason instanceof Error ? reason.message : t('error.assets'))
    })
    return () => { cancelled = true }
  }, [sessionId, tavernAssets, t])

  useEffect(() => {
    setFacts(null)
    setFactsLoading(false)
    setFactsError(null)
    setMemoryInspection(null)
    setMemoryLoading(false)
    setMemoryError(null)
    setSwipe(null)
  }, [sessionId])

  useEffect(() => {
    if (drawer !== 'characters' && drawer !== 'world' && drawer !== 'memory' || sessionId === undefined) return
    let cancelled = false
    setFactsLoading(true)
    setFactsError(null)
    void tavernAssets.inspectFacts(sessionId).then((result) => {
      if (cancelled) return
      if (result.ok) setFacts(result.value)
      else setFactsError(result.error.message)
    }).catch((reason: unknown) => {
      if (cancelled) return
      setFactsError(reason instanceof Error ? reason.message : t('error.context'))
    }).finally(() => { if (!cancelled) setFactsLoading(false) })
    return () => { cancelled = true }
  }, [drawer, sessionId, tavernAssets, t])

  useEffect(() => {
    if (drawer !== 'characters' && drawer !== 'world' && drawer !== 'memory' || sessionId === undefined) return
    const remote = tavernAssets.inspectMemory
    if (remote === undefined) {
      setMemoryLoading(false)
      setMemoryInspection(null)
      return
    }
    let cancelled = false
    setMemoryLoading(true)
    setMemoryError(null)
    void remote(sessionId).then((result) => {
      if (cancelled) return
      if (result.ok) setMemoryInspection(result.value)
      else setMemoryError(result.error.message)
    }).catch((reason: unknown) => {
      if (cancelled) return
      setMemoryError(reason instanceof Error ? reason.message : t('error.context'))
    }).finally(() => { if (!cancelled) setMemoryLoading(false) })
    return () => { cancelled = true }
  }, [drawer, sessionId, tavernAssets, t])

  useEffect(() => {
    if (drawer !== 'swipe' || sessionId === undefined) return
    let cancelled = false
    setLoadingDrawer(true)
    setDrawerError(null)
    void tavernAssets.inspectSwipe(sessionId).then((result) => {
      if (cancelled) return
      if (result.ok) setSwipe(result.value)
      else { setDrawerError(result.error.message); setError(result.error.message) }
    }).catch((reason: unknown) => {
      if (cancelled) return
      const message = reason instanceof Error ? reason.message : t('error.context')
      setDrawerError(message)
      setError(message)
    }).finally(() => { if (!cancelled) setLoadingDrawer(false) })
    return () => { cancelled = true }
  }, [drawer, sessionId, tavernAssets, t])

  if (route !== 'journey' || sessionId === undefined || snapshot === undefined
    || snapshot.sessionId !== sessionId || session === undefined) {
    return <section className={css.loadingState} aria-live="polite">{t('journey.loading')}</section>
  }

  const prompt = async (text: string): Promise<boolean> => {
    try {
      const result = await session.prompt([{ type: 'text', text }], 'queue')
      if (!result.ok) setError(result.error.message)
      return result.ok
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : t('error.send'))
      return false
    }
  }

  const send = async (): Promise<void> => {
    const text = draft.trim()
    if (text.length === 0 || snapshot.running || snapshot.removed || snapshot.openState !== 'open') return
    setError(null)
    if (await prompt(text)) setDraft('')
  }

  const retry = async (text: string): Promise<void> => {
    if (retrying || snapshot.running || snapshot.removed || snapshot.openState !== 'open') return
    setRetrying(true)
    setError(null)
    await prompt(text)
    setRetrying(false)
  }

  const openSwipe = (): void => { setDrawer('swipe'); setDrawerError(null); setError(null) }
  const openContext = (): void => { setDrawer('characters'); setDrawerError(null); setFactsError(null); setMemoryError(null); setError(null) }
  const archive = async (): Promise<void> => {
    setArchiving(true)
    setError(null)
    try {
      await archiveActiveJourney(sessionId, {
        sessions: { clear: () => { sessions.clear() } },
        archive: id => tavernAssets.archiveHistory(id),
        navigateToLibrary: onNavigateToLibrary,
        currentSessionId: sessionId,
      })
      onArchiveSuccess?.()
      setConfirmArchive(false)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : t('error.archive'))
    } finally {
      setArchiving(false)
    }
  }
  const selectSwipe = async (groupId: string, candidateId: string): Promise<void> => {
    if (swipeBusy) return
    setSwipeBusy(true)
    setError(null)
    try {
      const result = await tavernAssets.selectSwipe(sessionId, { groupId, candidateId })
      if (result.ok) setSwipe(result.value)
      else setError(result.error.message)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : t('error.swipe'))
    } finally {
      setSwipeBusy(false)
    }
  }

  const hasTurnError = snapshot.nodes.some(node => node.kind === 'turn-error')
  const openingGreeting = projection?.openingGreeting
  const latestUserText = (beforeIndex: number): string | null => {
    for (let index = beforeIndex - 1; index >= 0; index--) {
      const node = snapshot.nodes[index]
      if (node?.kind === 'user' || node?.kind === 'steering') return messageText(node.content)
    }
    return null
  }

  const updateFacts = (inspection: TavernFactInspection): void => {
    setFacts(inspection)
    setProjection(current => current === null ? current : { ...current, facts: inspection.projection })
  }

  return <section className={css.journey} aria-labelledby="journey-title">
    <header className={css.journeyHeader}>
      <div><button className={css.backButton} type="button" onClick={onNavigateToLibrary}><IconChevronLeftOutline14 aria-hidden="true" />{t('journey.backLibrary')}</button><p className={css.eyebrow}>{t('journey.eyebrow')}</p><h1 id="journey-title">{projectionTitle(projection, t)}</h1><p className={css.subtitle}>{projection?.character?.scenario || t('journey.openingFallback')}</p></div>
      <div className={css.journeyStatus}><span className={css.livePill}><span className={css.connectionDot} aria-hidden="true" />{snapshot.running ? t('journey.writing') : t('journey.ready')}</span><button className={css.iconButton} type="button" aria-label={t('journey.archive')} disabled={archiving} onClick={() => { setError(null); setConfirmArchive(true) }}><IconArchiveOutline20 aria-hidden="true" /></button></div>
    </header>
    <div className={css.toolbar} aria-label={t('journey.tools')}>
      <button className={css.toolButton} type="button" aria-haspopup="dialog" aria-expanded={drawer === 'characters' || drawer === 'world' || drawer === 'memory'} aria-controls="tavern-context-drawer" onClick={openContext}><IconUserOutline16 aria-hidden="true" />{t('journey.context')}</button>
      <button className={css.toolButton} type="button" aria-haspopup="dialog" aria-expanded={drawer === 'swipe'} aria-controls="tavern-swipe-drawer" onClick={openSwipe}>{t('journey.swipe')}</button>
    </div>
    <div className={css.transcript} aria-live="polite">
      {snapshot.openState === 'loading' && <p className={css.loadingState}>{t('journey.transcriptLoading')}</p>}
      {snapshot.openState === 'error' && <p className={css.error} role="alert">{snapshot.openError?.message ?? t('journey.transcriptError')}</p>}
      {openingGreeting !== undefined && <article className={css.gmMessage} data-opening-greeting="true"><span className={css.messageRole}>{t('journey.gm')}</span><MarkdownText text={openingGreeting.text} /></article>}
      {snapshot.nodes.length === 0 && snapshot.openState === 'open' && openingGreeting === undefined && <p className={css.empty}>{t('journey.openingEmpty')}</p>}
      {snapshot.nodes.map((node, index) => {
        if (node.kind === 'user' || node.kind === 'steering') return <div className={css.userMessage} key={node.seq}><span className={css.messageRole}>{t('journey.you')}</span><MarkdownText text={messageText(node.content)} /></div>
        if (node.kind === 'assistant') return <article className={css.gmMessage} key={node.seq}><span className={css.messageRole}>{t('journey.gm')}</span>{node.blocks.filter(block => block.kind === 'text').map((block, blockIndex) => <MarkdownText key={`${node.seq}-${blockIndex}`} text={block.text} />)}</article>
        if (node.kind === 'turn-error') {
          const text = latestUserText(index)
          return <div className={css.failure} key={node.seq}><p className={css.error} role="alert">{node.message}</p>{text !== null && text.trim() !== '' && <button className={css.secondaryButton} type="button" disabled={retrying || snapshot.running} onClick={() => void retry(text)}>{retrying ? t('journey.retrying') : t('journey.tryAgain')}</button>}</div>
        }
        return null
      })}
      {!hasTurnError && snapshot.lastAgentError !== null && <p className={css.error} role="alert">{snapshot.lastAgentError}</p>}
      {snapshot.partial !== null && <article className={css.gmMessage}><span className={css.messageRole}>{t('journey.gm')}</span>{snapshot.partial.blocks.filter(block => block.kind === 'text').map((block, index) => <MarkdownText key={index} text={block.text} streaming />)}<span className={css.typing}>{t('journey.writing')}...</span></article>}
    </div>
    {error !== null && <p className={css.error} role="alert">{error}</p>}
    <form className={css.composer} onSubmit={(event) => { event.preventDefault(); void send() }}><label className={css.srOnly} htmlFor="tavern-composer">{t('journey.composerLabel')}</label><textarea id="tavern-composer" value={draft} onChange={(event) => { setDraft(event.target.value) }} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} placeholder={t('journey.placeholder')} disabled={snapshot.running || snapshot.removed || snapshot.openState !== 'open'} rows={2} /><div className={css.composerFooter}><span className={css.hint}>{t('journey.composerHint')}</span>{snapshot.running ? <button className={css.secondaryButton} type="button" onClick={() => void session.cancel()}><IconStopFill16 aria-hidden="true" />{t('journey.stop')}</button> : <button className={css.primaryButton} type="submit" disabled={draft.trim().length === 0 || snapshot.removed || snapshot.openState !== 'open'}><IconSendOutline16 aria-hidden="true" />{t('journey.send')}</button>}</div></form>
    {drawer !== null && <div className={css.drawerBackdrop} role="presentation" aria-hidden="true" onClick={() => { setDrawer(null) }} />}
    {drawer === 'swipe' && <><JourneyDrawer swipe={swipe} swipeBusy={swipeBusy} drawerError={drawerError} onClose={() => { setDrawer(null) }} onSwipe={(groupId, candidateId) => { void selectSwipe(groupId, candidateId) }} t={t} />{loadingDrawer && <span className={css.drawerLoading} role="status">{t('journey.contextLoading')}</span>}</>}
    {drawer !== null && drawer !== 'swipe' && <TavernMemoryPanel
      view={drawer}
      onViewChange={setDrawer}
      projection={projection}
      facts={facts}
      factsLoading={factsLoading}
      factsError={factsError}
      memoryInspection={memoryInspection}
      memoryLoading={memoryLoading}
      memoryError={memoryError}
      sessionId={sessionId}
      tavernAssets={tavernAssets}
      onFactsChanged={updateFacts}
      onClose={() => { setDrawer(null) }}
      t={t}
    />}
    {confirmArchive && <ArchiveDialog
      title={projectionTitle(projection, t)}
      busy={archiving}
      error={error}
      onCancel={() => { if (!archiving) setConfirmArchive(false) }}
      onConfirm={() => void archive()}
      t={t}
    />}
  </section>
}
