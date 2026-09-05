/** Client-side editors and inspection panels for secondary Tavern tools. */

import type {
  AssetId,
  CharacterAsset,
  PromptAssetBaseline,
  StoryState,
  StoryStateChange,
  TavernSessionSelection,
  TavernGmResponseInspection,
  TavernStoryStateInspection,
  TavernSwipeInspection,
  TavernSwipeSelectionInput,
  WorldInfoAsset,
} from '@deepseek-ai/dsh-tavern-host/client'
import type { RequestView, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { TavernAssetsRemote, TavernContextActivation, TavernContextDecision } from './index.ts'
import type { TavernKey } from './locales.ts'
import { slug } from '@deepseek-ai/dsh-tavern-shared'
import { IconTrashOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { useEffect, useMemo, useState, type ChangeEvent, type ReactElement } from 'react'
import css from './TavernView.module.css'

type Translate = (key: TavernKey) => string

/**
 * Two-step inline confirm for destructive actions: the first click arms the
 * button (label swaps to the confirm copy, auto-disarms after a short delay),
 * the second click fires. Replaces `window.confirm`, which is silently
 * suppressed in some embedded webviews and left delete buttons feeling dead.
 */
export function ConfirmDeleteButton({
  label, confirmLabel, className, icon, disabled, onConfirm,
}: {
  readonly label: string
  readonly confirmLabel: string
  readonly className: string | undefined
  readonly icon?: ReactElement
  readonly disabled?: boolean
  readonly onConfirm: () => void
}): React.ReactElement {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const timer = window.setTimeout(() => { setArmed(false) }, 4000)
    return () => { window.clearTimeout(timer) }
  }, [armed])
  return <button
    type="button"
    className={className}
    data-armed={armed || undefined}
    disabled={disabled}
    onClick={(event) => {
      // preventDefault keeps the click from toggling a surrounding <label>.
      event.preventDefault()
      event.stopPropagation()
      if (armed) {
        setArmed(false)
        onConfirm()
      } else {
        setArmed(true)
      }
    }}
  >
    {icon}
    <span>{armed ? confirmLabel : label}</span>
  </button>
}

interface AssetEditorProps {
  readonly characters: readonly CharacterAsset[]
  readonly worldInfoLibrary: readonly WorldInfoAsset[]
  readonly character: CharacterAsset | null
  readonly sessionId?: SessionId
  readonly tavernAssets: TavernAssetsRemote
  readonly t: Translate
  readonly onJourneyUpdated?: (selection: TavernSessionSelection) => Promise<void>
  readonly onAssetsUpdated?: () => Promise<void>
  readonly onError: () => void
}

/** Edit the retained source JSON for the selected Character Card or World Info. */
export function TavernAssetEditor({
  characters, worldInfoLibrary, character, tavernAssets, t,
  sessionId, onJourneyUpdated, onAssetsUpdated, onError,
}: AssetEditorProps): React.ReactElement {
  const [characterId, setCharacterId] = useState<AssetId | ''>(character?.id ?? characters[0]?.id ?? '')
  const selectedCharacter = sessionId === undefined
    ? characters.find(asset => asset.id === characterId) ?? character
    : character
  const [worldInfoId, setWorldInfoId] = useState<AssetId | ''>('')
  const worldInfo = worldInfoLibrary.find(asset => asset.id === worldInfoId) ?? null
  const [characterDraft, setCharacterDraft] = useState('')
  const [worldDraft, setWorldDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')

  useEffect(() => {
    setCharacterId(character?.id ?? (characters[0]?.id ?? ''))
    setCharacterDraft(character === null ? '' : JSON.stringify(character.sourceData, null, 2))
  }, [character])

  useEffect(() => {
    if (characterId !== '' && characters.some(asset => asset.id === characterId)) return
    setCharacterId(characters[0]?.id ?? '')
  }, [characterId, characters])

  useEffect(() => {
    if (worldInfoId !== '' && worldInfoLibrary.some(asset => asset.id === worldInfoId)) return
    setWorldInfoId(worldInfoLibrary[0]?.id ?? '')
  }, [worldInfoId, worldInfoLibrary])

  useEffect(() => {
    setWorldDraft(worldInfo === null ? '' : JSON.stringify(worldInfo.sourceData, null, 2))
  }, [worldInfo])

  async function updateCharacter(): Promise<void> {
    if (selectedCharacter === null) return
    setSaving(true)
    try {
      if (sessionId === undefined) {
        if (tavernAssets.updateCharacter === undefined) throw new Error('Character asset update is unavailable')
        const result = await tavernAssets.updateCharacter(characterDraft, { id: String(selectedCharacter.id) })
        if (!result.ok) throw new Error(result.error.message)
        await onAssetsUpdated?.()
      } else {
        const result = await tavernAssets.editJourneyCharacter(sessionId, characterDraft)
        if (!result.ok) throw new Error(result.error.message)
        await onJourneyUpdated?.(result.value)
      }
      setStatus(t('editor.saved'))
    } catch {
      setStatus(t('editor.invalid'))
      onError()
    } finally {
      setSaving(false)
    }
  }

  async function updateWorldInfo(): Promise<void> {
    if (worldInfo === null) return
    setSaving(true)
    try {
      if (sessionId === undefined) {
        if (tavernAssets.updateWorldInfo === undefined) throw new Error(t('editor.invalid'))
        const result = await tavernAssets.updateWorldInfo(worldDraft, { id: String(worldInfo.id) })
        if (!result.ok) throw new Error(result.error.message)
        await onAssetsUpdated?.()
      } else {
        const result = await tavernAssets.editJourneyWorldInfo(sessionId, worldInfo.id, worldDraft)
        if (!result.ok) throw new Error(result.error.message)
        await onJourneyUpdated?.(result.value)
      }
      setStatus(t('editor.saved'))
    } catch {
      setStatus(t('editor.invalid'))
      onError()
    } finally {
      setSaving(false)
    }
  }

  async function deleteLibraryAsset(asset: CharacterAsset | WorldInfoAsset): Promise<void> {
    const deleteAssetRemote = tavernAssets.deleteAsset
    if (sessionId !== undefined || deleteAssetRemote === undefined) return
    setSaving(true)
    try {
      const result = await deleteAssetRemote(asset.id)
      if (!result.ok || !result.value) throw new Error(result.ok ? 'Asset was not deleted' : result.error.message)
      await onAssetsUpdated?.()
      setStatus(t('editor.deleted'))
    } catch {
      setStatus(t('editor.invalid'))
      onError()
    } finally {
      setSaving(false)
    }
  }

  async function exportAsset(asset: CharacterAsset | WorldInfoAsset): Promise<void> {
    try {
      if (sessionId === undefined) {
        const result = asset.kind === 'character'
          ? await tavernAssets.exportCharacter(asset.id)
          : await tavernAssets.exportWorldInfo(asset.id)
        if (!result.ok) throw new Error(result.error.message)
        downloadJson(`${safeFilename(asset.name)}.json`, result.value)
      } else {
        downloadJson(`${safeFilename(asset.name)}.json`, JSON.stringify(asset.sourceData, null, 2))
      }
      setStatus(t('editor.exported'))
    } catch {
      setStatus(t('editor.invalid'))
      onError()
    }
  }

  return <section className={css.section}>
    <div className={css.panelHeader}>
      <h2 className={css.heading}>{t('editor.title')}</h2>
      <span className={css.note}>{status}</span>
    </div>
    <div className={css.editorGrid}>
      <div className={css.editorPanel}>
        <div className={css.panelHeader}>
          <h3 className={css.subheading}>{t('library.character')}</h3>
          {selectedCharacter !== null && <div className={css.formRow}>
            <button type="button" className={css.subtleButton} onClick={() => { void exportAsset(selectedCharacter) }} disabled={saving}>{t('editor.export')}</button>
            {sessionId === undefined && tavernAssets.deleteAsset !== undefined && <ConfirmDeleteButton
              className={css.subtleButton}
              icon={<IconTrashOutline16 />}
              label={t('editor.delete')}
              confirmLabel={t('editor.deleteConfirm')}
              disabled={saving}
              onConfirm={() => { void deleteLibraryAsset(selectedCharacter) }}
            />}
          </div>}
        </div>
        {characters.length > 0 && <label className={css.field}>
          <span>{t('editor.characterSelect')}</span>
          <select
            className={css.select}
            value={selectedCharacter?.id ?? ''}
            onChange={(event) => {
              const next = characters.find(asset => asset.id === event.target.value)
              setCharacterId(next?.id ?? '')
              setCharacterDraft(next === undefined ? '' : JSON.stringify(next.sourceData, null, 2))
            }}
            disabled={saving || sessionId !== undefined}
          >
            <option value="">{t('editor.noCharacter')}</option>
            {characters.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
          </select>
        </label>}
        {selectedCharacter === null ? <p className={css.empty}>{t('editor.noCharacter')}</p> : <>
          <label className={css.field}>
            <span>{t('editor.sourceJson')}</span>
            <textarea
              className={css.editorTextarea}
              value={characterDraft}
              readOnly={false}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => { setCharacterDraft(event.target.value) }}
            />
          </label>
          <button type="button" className={css.importButton} onClick={() => { void updateCharacter() }} disabled={saving}>{t('editor.save')}</button>
        </>}
      </div>
      <div className={css.editorPanel}>
        <div className={css.panelHeader}>
          <h3 className={css.subheading}>{t('library.worldInfo')}</h3>
          {worldInfo !== null && <div className={css.formRow}>
            <button type="button" className={css.subtleButton} onClick={() => { void exportAsset(worldInfo) }} disabled={saving}>{t('editor.export')}</button>
            {sessionId === undefined && tavernAssets.deleteAsset !== undefined && <ConfirmDeleteButton
              className={css.subtleButton}
              icon={<IconTrashOutline16 />}
              label={t('editor.delete')}
              confirmLabel={t('editor.deleteConfirm')}
              disabled={saving}
              onConfirm={() => { void deleteLibraryAsset(worldInfo) }}
            />}
          </div>}
        </div>
        <label className={css.field}>
          <span>{t('editor.worldSelect')}</span>
          <select
            className={css.select}
            value={worldInfoId}
            onChange={(event) => { setWorldInfoId(event.target.value as AssetId) }}
            disabled={saving}
          >
            <option value="">{t('editor.noWorldInfo')}</option>
            {worldInfoLibrary.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
          </select>
        </label>
        {worldInfo === null ? <p className={css.empty}>{t('editor.noWorldInfo')}</p> : <>
          <label className={css.field}>
            <span>{t('editor.sourceJson')}</span>
            <textarea
              className={css.editorTextarea}
              value={worldDraft}
              readOnly={false}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => { setWorldDraft(event.target.value) }}
            />
          </label>
          <button type="button" className={css.importButton} onClick={() => { void updateWorldInfo() }} disabled={saving}>{t('editor.save')}</button>
        </>}
      </div>
    </div>
    {characters.length === 0 && worldInfoLibrary.length === 0 && <p className={css.empty}>{t('editor.noAssets')}</p>}
  </section>
}

interface StoryStateEditorProps {
  readonly sessionId: SessionId
  readonly tavernAssets: TavernAssetsRemote
  readonly t: Translate
  readonly onError: () => void
}

type StoryLocationValue = NonNullable<StoryState['location']>
type StoryTimeValue = NonNullable<StoryState['time']>

/** Edit the first two canonical story-state fields, location and time. */
export function TavernStoryStateEditor({ sessionId, tavernAssets, t, onError }: StoryStateEditorProps): React.ReactElement {
  const [inspection, setInspection] = useState<TavernStoryStateInspection | null>(null)
  const [locationId, setLocationId] = useState('')
  const [locationName, setLocationName] = useState('')
  const [locationDescription, setLocationDescription] = useState('')
  const [timeValue, setTimeValue] = useState('')
  const [calendar, setCalendar] = useState('')
  const [timezone, setTimezone] = useState('')
  const [saving, setSaving] = useState(false)

  async function refresh(): Promise<void> {
    try {
      const result = await tavernAssets.inspectStoryState(sessionId)
      if (!result.ok) throw new Error(result.error.message)
      setInspection(result.value)
      const { location, time } = result.value.projection.state
      setLocationId(location?.id ?? '')
      setLocationName(location?.name ?? '')
      setLocationDescription(location?.description ?? '')
      setTimeValue(time?.value ?? '')
      setCalendar(time?.calendar ?? '')
      setTimezone(time?.timezone ?? '')
    } catch {
      onError()
    }
  }

  useEffect(() => { void refresh() }, [sessionId, tavernAssets])

  async function setState(change: StoryStateChange): Promise<void> {
    setSaving(true)
    try {
      const result = await tavernAssets.setStoryState(sessionId, change)
      if (!result.ok) throw new Error(result.error.message)
      setInspection(result.value)
    } catch {
      onError()
    } finally {
      setSaving(false)
    }
  }

  function saveLocation(): void {
    const name = locationName.trim()
    if (name.length === 0) return
    const id = locationId.trim() || slug(name, 'location')
    const location: StoryLocationValue = {
      id: id as StoryLocationValue['id'],
      name,
      extensions: {},
      ...(locationDescription.trim() ? { description: locationDescription.trim() } : {}),
    }
    void setState({ kind: 'location.set', location, extensions: {} })
  }

  function saveTime(): void {
    const value = timeValue.trim()
    if (value.length === 0) return
    const time: StoryTimeValue = {
      value,
      extensions: {},
      ...(calendar.trim() ? { calendar: calendar.trim() } : {}),
      ...(timezone.trim() ? { timezone: timezone.trim() } : {}),
    }
    void setState({ kind: 'time.set', time, extensions: {} })
  }

  const state = inspection?.projection.state
  return <section className={css.section}>
    <div className={css.panelHeader}>
      <h2 className={css.heading}>{t('story.title')}</h2>
      <span className={css.note}>{state?.branchId ?? ''}</span>
    </div>
    <div className={css.editorGrid}>
      <div className={css.editorPanel}>
        <h3 className={css.subheading}>{t('story.location')}</h3>
        <label className={css.field}><span>{t('story.id')}</span><input className={css.input} value={locationId} onChange={(event) => { setLocationId(event.target.value) }} /></label>
        <label className={css.field}><span>{t('story.name')}</span><input className={css.input} value={locationName} onChange={(event) => { setLocationName(event.target.value) }} /></label>
        <label className={css.field}><span>{t('story.description')}</span><textarea className={css.compactTextarea} value={locationDescription} onChange={(event) => { setLocationDescription(event.target.value) }} /></label>
        <button type="button" className={css.importButton} onClick={saveLocation} disabled={saving || locationName.trim().length === 0}>{t('story.save')}</button>
      </div>
      <div className={css.editorPanel}>
        <h3 className={css.subheading}>{t('story.time')}</h3>
        <label className={css.field}><span>{t('story.value')}</span><input className={css.input} value={timeValue} onChange={(event) => { setTimeValue(event.target.value) }} /></label>
        <div className={css.formRow}>
          <label className={css.field}><span>{t('story.calendar')}</span><input className={css.input} value={calendar} onChange={(event) => { setCalendar(event.target.value) }} /></label>
          <label className={css.field}><span>{t('story.timezone')}</span><input className={css.input} value={timezone} onChange={(event) => { setTimezone(event.target.value) }} /></label>
        </div>
        <button type="button" className={css.importButton} onClick={saveTime} disabled={saving || timeValue.trim().length === 0}>{t('story.save')}</button>
      </div>
    </div>
    {inspection?.projection.issues.length !== 0 && <p className={css.note}>
      {t('story.issues')}: {inspection?.projection.issues.length}
    </p>}
  </section>
}

interface SwipeEditorProps {
  readonly sessionId: SessionId
  readonly tavernAssets: TavernAssetsRemote
  readonly inspection: TavernSwipeInspection | null
  readonly t: Translate
  readonly onSelected: (inspection: TavernSwipeInspection) => void
  readonly onError: () => void
  /** Start regeneration for a candidate group when the host/session path is available. */
  readonly onRegenerate?: (groupId: string, candidateId: string) => Promise<void> | void
}

/** Show durable assistant candidates and persist the user's current choice. */
export function TavernSwipeEditor({
  sessionId, tavernAssets, inspection, t, onSelected, onError, onRegenerate,
}: SwipeEditorProps): React.ReactElement {
  const groups = inspection?.groups ?? []
  const [saving, setSaving] = useState(false)
  const [regeneratingGroupId, setRegeneratingGroupId] = useState<string | null>(null)

  async function select(input: TavernSwipeSelectionInput): Promise<void> {
    setSaving(true)
    try {
      const result = await tavernAssets.selectSwipe(sessionId, input)
      if (!result.ok) throw new Error(result.error.message)
      onSelected(result.value)
    } catch {
      onError()
    } finally {
      setSaving(false)
    }
  }

  function selectRelative(group: TavernSwipeInspection['groups'][number], offset: -1 | 1): void {
    const currentIndex = group.candidates.findIndex(candidate => candidate.candidateId === group.currentCandidateId)
    const targetIndex = currentIndex === -1
      ? offset === 1 ? 0 : group.candidates.length - 1
      : currentIndex + offset
    const target = group.candidates[targetIndex]
    if (target === undefined) return
    void select({ groupId: group.groupId, candidateId: target.candidateId })
  }

  async function regenerate(groupId: string, candidateId: string): Promise<void> {
    if (onRegenerate === undefined) return
    setRegeneratingGroupId(groupId)
    try {
      await onRegenerate(groupId, candidateId)
    } catch {
      onError()
    } finally {
      setRegeneratingGroupId(null)
    }
  }

  return <section className={css.section}>
    <div className={css.panelHeader}><h2 className={css.heading}>{t('swipe.title')}</h2><span className={css.note}>{t('swipe.note')}</span></div>
    {groups.length === 0 ? <p className={css.empty}>{t('swipe.empty')}</p> : <div className={css.memoryList}>
      {groups.map((group) => {
        const currentIndex = group.candidates.findIndex(candidate => candidate.candidateId === group.currentCandidateId)
        const hasPrevious = currentIndex > 0
        const hasNext = currentIndex === -1 ? group.candidates.length > 0 : currentIndex < group.candidates.length - 1
        return <div className={css.memoryRow} key={group.groupId}>
          <div className={css.memoryCopy}>
            <strong>{group.groupId}</strong>
            <span>{group.candidates.length} {t('swipe.candidates')}</span>
            <div>
              <button
                type="button"
                className={css.subtleButton}
                aria-label={`${t('swipe.previous')} ${group.groupId}`}
                title={t('swipe.previous')}
                disabled={saving || regeneratingGroupId !== null || !hasPrevious}
                onClick={() => { selectRelative(group, -1) }}
              >&lt;</button>{' '}
              <button
                type="button"
                className={css.subtleButton}
                aria-label={`${t('swipe.next')} ${group.groupId}`}
                title={t('swipe.next')}
                disabled={saving || regeneratingGroupId !== null || !hasNext}
                onClick={() => { selectRelative(group, 1) }}
              >&gt;</button>{' '}
              <button
                type="button"
                className={css.subtleButton}
                aria-label={`${t('swipe.regenerate')} ${group.groupId}`}
                title={t('swipe.regenerate')}
                disabled={saving || regeneratingGroupId !== null || onRegenerate === undefined}
                onClick={() => {
                  const candidateId = group.currentCandidateId ?? group.candidates.at(-1)?.candidateId
                  if (candidateId !== undefined) void regenerate(group.groupId, candidateId)
                }}
              >{t('swipe.regenerate')}</button>
            </div>
          </div>
          <div className={css.swipeCandidates}>
            {group.candidates.map(candidate => <button
              type="button"
              key={candidate.candidateId}
              className={candidate.candidateId === group.currentCandidateId ? css.swipeCandidateActive : css.subtleButton}
              disabled={saving || candidate.candidateId === group.currentCandidateId}
              aria-pressed={candidate.candidateId === group.currentCandidateId}
              onClick={() => { void select({ groupId: group.groupId, candidateId: candidate.candidateId }) }}
            >
              <span>{candidate.origin}</span>
              <strong>{candidate.text || t('swipe.emptyCandidate')}</strong>
            </button>)}
          </div>
        </div>
      })}
    </div>}
  </section>
}

interface PromptInspectorProps {
  readonly latest: Extract<RequestView, { purpose: 'assistant' }> | undefined
  readonly baseline: PromptAssetBaseline | undefined
  /** Assistant text projected from the matching Trajectory node, when available. */
  readonly output?: string | undefined
  /** Parsed GM envelopes retained by the Host for response and update auditing. */
  readonly gmResponses?: readonly TavernGmResponseInspection[]
  /** Latest Host context activation ledger, retained for diagnostics only. */
  readonly contextActivation?: TavernContextActivation | null
  readonly t: Translate
}

function requestStatusLabel(status: Extract<RequestView, { purpose: 'assistant' }>['status'], t: Translate): string {
  switch (status) {
    case 'running': return t('prompt.statusRunning')
    case 'complete': return t('prompt.statusComplete')
    case 'error': return t('prompt.statusError')
  }
}

function formatInspectorValue(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

const CONTEXT_REASON_KEYS: Record<TavernContextDecision['reason'], TavernKey> = {
  included: 'prompt.reasonIncluded',
  observer: 'prompt.reasonObserver',
  visibility: 'prompt.reasonVisibility',
  authority: 'prompt.reasonAuthority',
  branch: 'prompt.reasonBranch',
  invalid: 'prompt.reasonInvalid',
  'not-matched': 'prompt.reasonNotMatched',
  group: 'prompt.reasonGroup',
  duplicate: 'prompt.reasonDuplicate',
  'budget-characters': 'prompt.reasonBudgetCharacters',
  'budget-tokens': 'prompt.reasonBudgetTokens',
  'budget-both': 'prompt.reasonBudgetBoth',
}

function contextReasonLabel(reason: TavernContextDecision['reason'], t: Translate): string {
  return t(CONTEXT_REASON_KEYS[reason])
}

function contextUsageLabel(usage: TavernContextActivation['usage'] | undefined, t: Translate): string {
  if (usage === undefined) return t('prompt.noUsage')
  const tokens = usage.tokens === undefined ? '' : ` · ${t('prompt.tokens')} ${usage.tokens}`
  return `${t('prompt.characters')} ${usage.characters}${tokens}`
}

function ContextLedgerPanel({ activation, t }: {
  activation: TavernContextActivation | null | undefined
  t: Translate
}): React.ReactElement {
  const ledger = activation?.ledger ?? []
  return <details className={css.inspectorPanel} open>
    <summary>{t('prompt.activation')} ({ledger.length})</summary>
    {activation === null || activation === undefined || ledger.length === 0
      ? <p className={css.empty}>{t('prompt.noActivation')}</p>
      : <div className={css.inspectorOutput}>
        <div className={css.requestMeta}><strong>{t('prompt.ledgerUsage')}</strong><span>{contextUsageLabel(activation.usage, t)}</span></div>
        <div className={css.inspectorList}>{ledger.map(decision => <article className={css.sourceRow} key={`${decision.order}:${decision.key}`} data-ledger-outcome={decision.outcome}>
          <div className={css.requestMeta}>
            <strong>{decision.outcome === 'included' ? t('prompt.included') : t('prompt.excluded')}</strong>
            <span>#{decision.order}</span>
          </div>
          <code className={css.auditId}>{decision.key}</code>
          <p><strong>{t('prompt.reason')}: </strong>{contextReasonLabel(decision.reason, t)}</p>
          {decision.matchedKeys !== undefined && decision.matchedKeys.length > 0 && <p><strong>{t('prompt.matchedKeys')}: </strong>{decision.matchedKeys.join(', ')}</p>}
          <div className={css.requestMeta}>
            <span>{t('prompt.attempted')}: {contextUsageLabel(decision.attempted, t)}</span>
            <span>{t('prompt.accepted')}: {contextUsageLabel(decision.accepted, t)}</span>
          </div>
        </article>)}</div>
      </div>}
  </details>
}

/** Show model-visible prompt sections with asset source identifiers. */
export function PromptInspector({
  latest,
  baseline,
  output,
  gmResponses = [],
  contextActivation,
  t,
}: PromptInspectorProps): React.ReactElement {
  const references = baseline?.references ?? []
  const worldEntries = baseline?.worldInfoEntries ?? []
  const characterSections = baseline?.characterSections ?? []
  const tools = latest?.prompt?.tools ?? []
  const system = latest?.prompt?.system ?? ''
  const requestConfig = latest?.prompt?.config ?? latest?.requestConfig
  const parsedResponse = latest?.resultSeq === undefined
    ? undefined
    : gmResponses.find(response => response.assistantSeq === latest.resultSeq)
  const sourceSummary = useMemo(() => references.map(reference => `${reference.kind === 'character' ? t('asset.characterCard') : t('asset.worldInfo')}: ${reference.assetId}`), [references, t])

  return <section className={css.section}>
    <div className={css.panelHeader}>
      <h2 className={css.heading}>{t('prompt.title')}</h2>
      <span className={css.note}>{latest === undefined ? t('prompt.empty') : t('prompt.latest')}</span>
    </div>
    {latest === undefined ? <p className={css.empty}>{t('prompt.empty')}</p> : <div className={css.inspectorGrid}>
      <div className={`${css.inspectorPanel} ${css.inspectorPanelWide}`}>
        <h3 className={css.inspectorHeading}>{t('prompt.request')}</h3>
        <dl className={css.inspectorFacts}>
          <div className={css.inspectorFact}><dt>{t('prompt.turn')}</dt><dd>{latest.turn}</dd></div>
          <div className={css.inspectorFact}><dt>{t('prompt.step')}</dt><dd>{latest.step}</dd></div>
          <div className={css.inspectorFact}><dt>{t('prompt.start')}</dt><dd>#{latest.startSeq}</dd></div>
          <div className={css.inspectorFact}><dt>{t('prompt.status')}</dt><dd>{requestStatusLabel(latest.status, t)}</dd></div>
          <div className={css.inspectorFact}><dt>{t('prompt.provider')}</dt><dd>{latest.provenance?.provider ?? requestConfig?.provider ?? t('prompt.unknown')}</dd></div>
          <div className={css.inspectorFact}><dt>{t('prompt.model')}</dt><dd>{latest.provenance?.model ?? requestConfig?.model ?? t('prompt.unknown')}</dd></div>
          <div className={css.inspectorFact}><dt>{t('prompt.result')}</dt><dd>{latest.resultSeq === undefined ? t('prompt.noResult') : `#${latest.resultSeq}`}</dd></div>
        </dl>
        {latest.error !== undefined && <div className={css.inspectorError}><strong>{t('prompt.error')}</strong><p>{latest.error}</p></div>}
      </div>
      <details className={css.inspectorPanel} open><summary>{t('prompt.system')}</summary><pre className={css.prompt}>{system || t('prompt.noPrompt')}</pre></details>
      <details className={css.inspectorPanel} open><summary>{t('prompt.tools')} ({tools.length})</summary>
        {tools.length === 0 ? <p className={css.empty}>{t('prompt.noTools')}</p> : <div className={css.inspectorList}>{tools.map(tool => <details key={tool.name}><summary>{tool.name}</summary><p>{tool.description}</p><pre className={css.prompt}>{JSON.stringify(tool.parameters, null, 2)}</pre></details>)}</div>}
      </details>
      <details className={css.inspectorPanel} open><summary>{t('prompt.output')}</summary>
        <div className={css.inspectorOutput}>
          {output === undefined || output.trim().length === 0
            ? <p>{t('prompt.outputUnavailable')}</p>
            : <><p>{t('prompt.outputRecorded')}</p><pre className={css.prompt}>{output}</pre></>}
          {latest.resultSeq !== undefined && <p className={css.inspectorResult}><strong>{t('prompt.resultRecorded')}</strong> #{latest.resultSeq}</p>}
          {latest.usage !== undefined && <><strong>{t('prompt.usage')}</strong><pre className={css.prompt}>{formatInspectorValue(latest.usage)}</pre></>}
          {latest.usage === undefined && <p className={css.empty}>{t('prompt.noUsage')}</p>}
        </div>
      </details>
      <details className={css.inspectorPanel} open><summary>{t('prompt.gmResponse')}</summary>
        {parsedResponse === undefined ? <p className={css.empty}>{t('prompt.noGmResponse')}</p> : <div className={css.inspectorOutput}>
          <div className={css.requestMeta}>
            <span>{t('prompt.gmEvent')} #{parsedResponse.eventSeq}</span>
            <span>{t('prompt.assistant')} #{parsedResponse.assistantSeq}</span>
            <span>{t('prompt.turn')} {parsedResponse.turn}</span>
          </div>
          <strong>{t('prompt.parsedStory')}</strong>
          <pre className={css.prompt}>{parsedResponse.response.story}</pre>
          <strong>{t('prompt.parsedUpdates')}</strong>
          {parsedResponse.response.updates === undefined
            ? <p className={css.empty}>{t('prompt.noUpdates')}</p>
            : <pre className={css.prompt}>{formatInspectorValue(parsedResponse.response.updates)}</pre>}
        </div>}
      </details>
      <details className={css.inspectorPanel} open><summary>{t('prompt.worldInfo')} ({worldEntries.length})</summary>
        {worldEntries.length === 0 ? <p className={css.empty}>{t('prompt.noWorldInfo')}</p> : <div className={css.inspectorList}>{worldEntries.map(entry => <div className={css.sourceRow} key={`${entry.sourceAssetId}:${entry.id}`}>
          <strong>{entry.sourceAssetId}</strong>
          <span>{entry.id}</span>
          <span>{entry.keys.join(', ') || t('prompt.constant')}</span>
          <p>{entry.content}</p>
        </div>)}</div>}
      </details>
      <details className={css.inspectorPanel} open><summary>{t('prompt.sources')} ({references.length})</summary>
        {sourceSummary.length === 0 ? <p className={css.empty}>{t('prompt.noSources')}</p> : <ul className={css.sourceList}>{sourceSummary.map(source => <li key={source}>{source}</li>)}</ul>}
        {characterSections.length > 0 && <div className={css.sourceList}>
          {characterSections.map(section => <div className={css.sourceRow} key={section.id}>
            <strong>{section.sourceAssetId}</strong>
            <span>{section.field}</span>
          </div>)}
        </div>}
      </details>
    </div>}
    <ContextLedgerPanel activation={contextActivation} t={t} />
  </section>
}

function safeFilename(value: string): string {
  const result = value.trim().replace(/[^a-z0-9._-]+/gi, '-')
  return result.length === 0 ? 'tavern-asset' : result
}

function downloadJson(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' })
  const createObjectUrl = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : `data:application/json,${encodeURIComponent(text)}`
  const anchor = document.createElement('a')
  anchor.href = createObjectUrl
  anchor.download = filename
  anchor.click()
  if (createObjectUrl.startsWith('blob:') && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(createObjectUrl)
}
