/** Client-side editors and inspection panels for the Tavern workbench. */

import type {
  AssetId,
  CharacterAsset,
  PromptAssetBaseline,
  StoryState,
  StoryStateChange,
  TavernMemoryEntry,
  TavernMemoryInput,
  TavernStoryStateInspection,
  TavernSwipeInspection,
  TavernSwipeSelectionInput,
  WorldInfoAsset,
} from '@deepseek-ai/dsh-tavern-host/client'
import type { RequestView, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { TavernAssetsRemote } from './index.ts'
import type { TavernKey } from './locales.ts'
import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import css from './TavernView.module.css'

type Translate = (key: TavernKey) => string

interface AssetEditorProps {
  readonly characters: readonly CharacterAsset[]
  readonly worldInfoLibrary: readonly WorldInfoAsset[]
  readonly character: CharacterAsset | null
  readonly tavernAssets: TavernAssetsRemote
  readonly t: Translate
  readonly onCharacterUpdated: (asset: CharacterAsset) => Promise<void>
  readonly onWorldInfoUpdated: (asset: WorldInfoAsset) => Promise<void>
  readonly onError: () => void
}

/** Edit the retained source JSON for the selected Character Card or World Info. */
export function TavernAssetEditor({
  characters, worldInfoLibrary, character, tavernAssets, t,
  onCharacterUpdated, onWorldInfoUpdated, onError,
}: AssetEditorProps): React.ReactElement {
  const [worldInfoId, setWorldInfoId] = useState<AssetId | ''>('')
  const worldInfo = worldInfoLibrary.find(asset => asset.id === worldInfoId) ?? null
  const [characterDraft, setCharacterDraft] = useState('')
  const [worldDraft, setWorldDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')

  useEffect(() => {
    setCharacterDraft(character === null ? '' : JSON.stringify(character.sourceData, null, 2))
  }, [character])

  useEffect(() => {
    if (worldInfoId !== '' && worldInfoLibrary.some(asset => asset.id === worldInfoId)) return
    setWorldInfoId(worldInfoLibrary[0]?.id ?? '')
  }, [worldInfoId, worldInfoLibrary])

  useEffect(() => {
    setWorldDraft(worldInfo === null ? '' : JSON.stringify(worldInfo.sourceData, null, 2))
  }, [worldInfo])

  async function updateCharacter(): Promise<void> {
    if (character === null) return
    setSaving(true)
    try {
      const result = await tavernAssets.updateCharacter(characterDraft, { id: character.id })
      if (!result.ok) throw new Error(result.error.message)
      await onCharacterUpdated(result.value)
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
      const result = await tavernAssets.updateWorldInfo(worldDraft, { id: worldInfo.id })
      if (!result.ok) throw new Error(result.error.message)
      await onWorldInfoUpdated(result.value)
      setStatus(t('editor.saved'))
    } catch {
      setStatus(t('editor.invalid'))
      onError()
    } finally {
      setSaving(false)
    }
  }

  async function exportAsset(asset: CharacterAsset | WorldInfoAsset): Promise<void> {
    try {
      const result = asset.kind === 'character'
        ? await tavernAssets.exportCharacter(asset.id)
        : await tavernAssets.exportWorldInfo(asset.id)
      if (!result.ok) throw new Error(result.error.message)
      downloadJson(`${safeFilename(asset.name)}.json`, result.value)
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
          {character !== null && <button
            type="button"
            className={css.subtleButton}
            onClick={() => { void exportAsset(character) }}
            disabled={saving}
          >{t('editor.export')}</button>}
        </div>
        {character === null ? <p className={css.empty}>{t('editor.noCharacter')}</p> : <>
          <label className={css.field}>
            <span>{t('editor.sourceJson')}</span>
            <textarea
              className={css.editorTextarea}
              value={characterDraft}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => { setCharacterDraft(event.target.value) }}
            />
          </label>
          <button type="button" className={css.importButton} onClick={() => { void updateCharacter() }} disabled={saving}>{t('editor.save')}</button>
        </>}
      </div>
      <div className={css.editorPanel}>
        <div className={css.panelHeader}>
          <h3 className={css.subheading}>{t('library.worldInfo')}</h3>
          {worldInfo !== null && <button
            type="button"
            className={css.subtleButton}
            onClick={() => { void exportAsset(worldInfo) }}
            disabled={saving}
          >{t('editor.export')}</button>}
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

interface MemoryEditorProps {
  readonly sessionId: SessionId
  readonly tavernAssets: TavernAssetsRemote
  readonly t: Translate
  readonly onError: () => void
}

type MemoryDraft = { id: string; text: string; level: TavernMemoryEntry['level']; label: string }

const EMPTY_MEMORY: MemoryDraft = { id: '', text: '', level: 'persistent', label: '' }

/** Load and edit durable session memories through the Tavern Remote. */
export function TavernMemoryEditor({ sessionId, tavernAssets, t, onError }: MemoryEditorProps): React.ReactElement {
  const [memories, setMemories] = useState<readonly TavernMemoryEntry[]>([])
  const [draft, setDraft] = useState<MemoryDraft>(EMPTY_MEMORY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  async function refresh(): Promise<void> {
    setLoading(true)
    try {
      const result = await tavernAssets.listMemory(sessionId)
      if (!result.ok) throw new Error(result.error.message)
      setMemories(result.value)
    } catch {
      onError()
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [sessionId, tavernAssets])

  async function remember(input: TavernMemoryInput, reset: boolean): Promise<void> {
    if (input.text.trim().length === 0) return
    setSaving(true)
    try {
      const result = await tavernAssets.remember(sessionId, input)
      if (!result.ok) throw new Error(result.error.message)
      setMemories((current) => {
        const index = current.findIndex(memory => memory.id === result.value.id)
        if (index === -1) return [...current, result.value]
        return current.map((memory, candidate) => candidate === index ? result.value : memory)
      })
      if (reset) setDraft(EMPTY_MEMORY)
    } catch {
      onError()
    } finally {
      setSaving(false)
    }
  }

  function submitMemory(): void {
    const input: TavernMemoryInput = {
      text: draft.text,
      level: draft.level,
      label: draft.label || null,
      ...(draft.id ? { id: draft.id } : {}),
    }
    void remember(input, true)
  }

  return <section className={css.section}>
    <div className={css.panelHeader}>
      <h2 className={css.heading}>{t('memory.title')}</h2>
      {loading && <span className={css.note}>{t('memory.loading')}</span>}
    </div>
    <div className={css.memoryForm}>
      <label className={css.field}><span>{t('memory.text')}</span><textarea
        className={css.compactTextarea}
        value={draft.text}
        onChange={(event) => { setDraft({ ...draft, text: event.target.value }) }}
      /></label>
      <div className={css.formRow}>
        <label className={css.field}><span>{t('memory.level')}</span><select
          className={css.select}
          value={draft.level}
          onChange={(event) => { setDraft({ ...draft, level: event.target.value as MemoryDraft['level'] }) }}
        >
          <option value="pinned">pinned</option><option value="persistent">persistent</option><option value="scene">scene</option>
        </select></label>
        <label className={css.field}><span>{t('memory.label')}</span><input
          className={css.input}
          value={draft.label}
          onChange={(event) => { setDraft({ ...draft, label: event.target.value }) }}
        /></label>
      </div>
      <button type="button" className={css.importButton} onClick={submitMemory} disabled={saving || draft.text.trim().length === 0}>{draft.id ? t('memory.update') : t('memory.add')}</button>
    </div>
    <div className={css.memoryList}>
      {memories.map(memory => <div className={css.memoryRow} key={memory.id}>
        <div className={css.memoryCopy}><strong>{memory.label || memory.id}</strong><span>{memory.level}</span><p>{memory.text}</p></div>
        <button type="button" className={css.subtleButton} onClick={() => { setDraft({ id: memory.id, text: memory.text, level: memory.level, label: memory.label ?? '' }) }}>{t('memory.edit')}</button>
      </div>)}
      {!loading && memories.length === 0 && <p className={css.empty}>{t('memory.empty')}</p>}
    </div>
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
    const id = locationId.trim() || slug(name)
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
  readonly t: Translate
}

/** Show model-visible prompt sections with asset source identifiers. */
export function PromptInspector({ latest, baseline, t }: PromptInspectorProps): React.ReactElement {
  const references = baseline?.references ?? []
  const worldEntries = baseline?.worldInfoEntries ?? []
  const characterSections = baseline?.characterSections ?? []
  const tools = latest?.prompt?.tools ?? []
  const system = latest?.prompt?.system ?? ''
  const sourceSummary = useMemo(() => references.map(reference => `${reference.kind}: ${reference.assetId} (${reference.version.format})`), [references])

  return <section className={css.section}>
    <div className={css.panelHeader}>
      <h2 className={css.heading}>{t('prompt.title')}</h2>
      <span className={css.note}>{latest === undefined ? t('prompt.empty') : t('prompt.latest')}</span>
    </div>
    {latest === undefined ? <p className={css.empty}>{t('prompt.empty')}</p> : <div className={css.inspectorGrid}>
      <details className={css.inspectorPanel} open><summary>{t('prompt.system')}</summary><pre className={css.prompt}>{system || t('prompt.empty')}</pre></details>
      <details className={css.inspectorPanel} open><summary>{t('prompt.tools')} ({tools.length})</summary>
        {tools.length === 0 ? <p className={css.empty}>{t('prompt.noTools')}</p> : <div className={css.inspectorList}>{tools.map(tool => <details key={tool.name}><summary>{tool.name}</summary><p>{tool.description}</p><pre className={css.prompt}>{JSON.stringify(tool.parameters, null, 2)}</pre></details>)}</div>}
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

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'location'
}
