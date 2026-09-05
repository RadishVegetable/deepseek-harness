/** Unified Journey context drawer for characters, world information, and memory entries. */

import { useRef, useState, type FormEvent, type ReactElement } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  TavernFactConflict,
  TavernFactEntry,
  TavernFactInspection,
  TavernJourneyAssetProjection,
  TavernJourneyField,
  TavernMemoryInspection,
} from '@deepseek-ai/dsh-tavern-host/client'
import { IconCloseOutline16, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { NS } from './locales.ts'
import type { TavernAssetsRemote } from './remote.ts'
import css from './TavernMemoryPanel.module.css'
import { useTavernDialogFocus } from './useTavernDialogFocus.ts'

export type ContextView = 'characters' | 'world' | 'memory'

type TavernMemoryPanelProps = {
  readonly projection: TavernJourneyAssetProjection | null
  readonly facts: TavernFactInspection | null
  readonly factsLoading?: boolean
  readonly factsError?: string | null
  readonly memoryInspection?: TavernMemoryInspection | null
  readonly memoryLoading?: boolean
  readonly memoryError?: string | null
  readonly onClose: () => void
  readonly view?: ContextView
  readonly onViewChange?: (view: ContextView) => void
  readonly sessionId?: SessionId
  readonly tavernAssets?: TavernAssetsRemote
  readonly onFactsChanged?: (inspection: TavernFactInspection) => void
  readonly t: TranslateNS<typeof NS>
}

type PendingFactMutation =
  | { readonly kind: 'edit'; readonly fact: TavernFactEntry; readonly text: string }
  | { readonly kind: 'remove'; readonly fact: TavernFactEntry }
  | { readonly kind: 'conflict'; readonly conflict: TavernFactConflict; readonly keep: 'new' | 'old' }

function factProjection(
  projection: TavernJourneyAssetProjection | null,
  facts: TavernFactInspection | null,
): TavernFactInspection['projection'] | null {
  return facts?.projection ?? projection?.facts ?? null
}

function currentFacts(projection: TavernJourneyAssetProjection | null, facts: TavernFactInspection | null): readonly TavernFactEntry[] {
  const value = factProjection(projection, facts)
  if (value === null) return []
  return [...Object.values(value.people).flat(), ...value.world].filter(fact => fact.authority !== 'authored-asset')
}

function currentConflicts(
  projection: TavernJourneyAssetProjection | null,
  facts: TavernFactInspection | null,
): readonly TavernFactConflict[] {
  return factProjection(projection, facts)?.conflicts ?? []
}

function factLabel(fact: TavernFactEntry, t: TavernMemoryPanelProps['t']): string {
  return fact.label?.trim() || t('memory.fact')
}

function sourceLabel(fact: TavernFactEntry, t: TavernMemoryPanelProps['t']): string {
  switch (fact.source.kind) {
    case 'asset': return fact.source.entryId === undefined ? t('memory.sourceAsset') : t('memory.sourceEntry')
    case 'assistant': return t('memory.sourceAssistant', { seq: fact.source.assistantSeq })
    case 'user': return t('memory.sourceUser')
    case 'system': return t('memory.sourceSystem')
  }
}

function FieldList({ fields, empty }: { readonly fields: readonly TavernJourneyField[]; readonly empty: string }): ReactElement {
  return fields.length === 0
    ? <p className={css.empty}>{empty}</p>
    : <ul className={css.fieldList}>
      {fields.map(field => <li className={css.field} key={field.id}>
        <span className={css.fieldLabel}>{field.label}</span>
        <span className={css.fieldValue}>{field.value}</span>
      </li>)}
    </ul>
}

type DisplayPerson = {
  readonly personId: string
  readonly name: string
  readonly fields: readonly TavernJourneyField[]
  readonly facts: readonly TavernFactEntry[]
  readonly sources: readonly string[]
}

function appendUnique<T>(items: readonly T[], additions: readonly T[], key: (item: T) => string): readonly T[] {
  const result = [...items]
  const seen = new Set(result.map(key))
  for (const addition of additions) {
    const value = key(addition)
    if (seen.has(value)) continue
    seen.add(value)
    result.push(addition)
  }
  return result
}

function displayPeople(
  projection: TavernJourneyAssetProjection | null,
  facts: TavernFactInspection | null,
  t: TavernMemoryPanelProps['t'],
): readonly DisplayPerson[] {
  if (projection === null) return []
  const byId = new Map<string, DisplayPerson>()
  const active = factProjection(projection, facts)
  const add = (person: DisplayPerson): void => {
    const existing = byId.get(person.personId)
    if (existing === undefined) {
      byId.set(person.personId, person)
      return
    }
    byId.set(person.personId, {
      ...existing,
      name: person.name || existing.name,
      fields: appendUnique(existing.fields, person.fields, field => field.id),
      facts: appendUnique(existing.facts, person.facts, fact => String(fact.factId)),
      sources: appendUnique(existing.sources, person.sources, value => value),
    })
  }

  const primary = projection.character
  if (primary !== null && primary !== undefined) {
    const sourcePerson = projection.people.find(person => person.name === primary.name)
    const personId = sourcePerson === undefined ? `character:${String(primary.id ?? primary.name)}` : String(sourcePerson.personId)
    const primaryFacts = active?.people[personId] ?? sourcePerson?.facts ?? []
    const profileFields: readonly TavernJourneyField[] = [
      ...[
        ['description', t('memory.characterDescription'), primary.description],
        ['personality', t('memory.characterPersonality'), primary.personality],
        ['scenario', t('memory.characterScenario'), primary.scenario],
      ].flatMap(([id, label, value]) => typeof value === 'string' && value.trim().length > 0
        ? [{ id: `character:${String(primary.id)}:${id}`, label: String(label), value, sourceAssetId: primary.id, origin: 'asset' as const }]
        : []),
    ]
    add({
      personId,
      name: primary.name,
      fields: appendUnique(profileFields, projection.characterFields, field => field.id),
      facts: primaryFacts,
      sources: [String(primary.id)],
    })
  }
  for (const person of projection.people) {
    add({
      personId: String(person.personId),
      name: person.name,
      fields: person.fields,
      facts: person.facts,
      sources: person.source === null ? [] : [`${String(person.source.assetId)} / ${String(person.source.entryId)}`],
    })
  }
  return [...byId.values()]
}

type DisplayWorld = {
  readonly id: string
  readonly name: string
  readonly entries: readonly { readonly id: string; readonly content: string }[]
}

const WORLD_FIELD_LABELS = new Set([
  'continent', 'country', 'culture', 'custom', 'economy', 'faction', 'geography',
  'history', 'language', 'location', 'magic', 'place', 'politics', 'region',
  'religion', 'rule', 'setting', 'summary', 'technology', 'world',
])

function normalizedFieldLabel(label: string): string {
  return label.trim().toLocaleLowerCase().replace(/[\s_-]+/g, '')
}

function worldFields(fields: readonly TavernJourneyField[]): readonly TavernJourneyField[] {
  return fields.filter(field => WORLD_FIELD_LABELS.has(normalizedFieldLabel(field.label)))
}

function isLikelyCharacterEntry(content: string): boolean {
  const labels = new Set<string>()
  for (const match of content.matchAll(/^\s*([^:\n]{1,40}):/gim)) {
    labels.add(normalizedFieldLabel(match[1] ?? ''))
  }
  if (labels.has('type') || labels.has('role')) {
    const type = content.match(/^\s*(?:type|role)\s*:\s*([^\n]+)/im)?.[1]?.trim().toLocaleLowerCase()
    if (type === 'character' || type === 'npc' || type === 'protagonist') return true
  }
  return labels.has('appearance') && (labels.has('personality') || labels.has('clothing'))
    || labels.has('aka') && labels.has('appearance')
    || labels.has('personality') && labels.has('description')
}

function selectedWorlds(projection: TavernJourneyAssetProjection | null): readonly DisplayWorld[] {
  if (projection === null) return []
  const assets = [
    ...(projection.character?.characterBook === null || projection.character?.characterBook === undefined
      ? []
      : [projection.character.characterBook]),
    ...(projection.worldInfo ?? []),
  ]
  const personEntries = new Set(projection.people.map(person => person.source === null ? null : `${String(person.source.assetId)}\u0000${String(person.source.entryId)}`))
  const seenEntries = new Set<string>()
  const result: DisplayWorld[] = []
  for (const asset of assets) {
    const isCharacterBook = projection.character?.characterBook?.id === asset.id
    const canonical = isCharacterBook
      ? projection.canonical?.character
      : projection.canonical?.worldInfo.find(view => view.assetId === String(asset.id))
    const sourceEntries = canonical !== undefined && !canonical.uncleaned
      ? canonical.worldEntries.filter(entry => entry.role === 'world').map(entry => ({ id: String(entry.sourceEntryId), content: entry.text }))
      : asset.entries.filter((entry) => {
        const sourceKey = `${String(asset.id)}\u0000${String(entry.id)}`
        if (personEntries.has(sourceKey)) return false
        return !isLikelyCharacterEntry(entry.content)
      }).map(entry => ({ id: String(entry.id), content: entry.content }))
    const entries = sourceEntries.filter((entry) => {
      const fingerprint = worldInfoEntryFingerprint(entry.content)
      if (seenEntries.has(fingerprint)) return false
      seenEntries.add(fingerprint)
      return true
    })
    if (entries.length === 0 && asset.entries.length > 0) continue
    result.push({ id: String(asset.id), name: asset.name, entries })
  }
  return result
}

function worldInfoEntryFingerprint(content: string): string {
  return content.replace(/\r\n?/g, '\n').trim()
}

function sourceList(sources: readonly string[], t: TavernMemoryPanelProps['t']): ReactElement | null {
  return sources.length === 0 ? null : <p className={css.meta}>{t('memory.source')}: {sources.join(' · ')}</p>
}

function CharacterView({ projection, facts, t }: { readonly projection: TavernJourneyAssetProjection | null; readonly facts: TavernFactInspection | null; readonly t: TavernMemoryPanelProps['t'] }): ReactElement {
  const people = displayPeople(projection, facts, t)
  return <div id="tavern-context-panel-characters" className={css.view} role="tabpanel" aria-labelledby="tavern-context-characters" tabIndex={-1}>
    <section className={css.section}>
      <div className={css.sectionHeading}><div><p className={css.sectionKicker}>{t('memory.character')}</p><h3 className={css.sectionTitle}>{t('memory.charactersTitle')}</h3></div><span className={css.sectionCount}>{people.length}</span></div>
      {people.length === 0
        ? <p className={css.empty}>{t('memory.noPeople')}</p>
        : <div className={css.characterList}>{people.map(person => <details className={css.characterItem} key={person.personId}>
          <summary className={css.characterSummary}><span><strong>{person.name}</strong><small>{person.personId}</small></span><span className={css.tag}>{t('memory.openProvenance', { label: person.name })}</span></summary>
          <div className={css.characterBody}>
            {sourceList(person.sources, t)}
            <FieldList fields={person.fields} empty={t('memory.noCharacterFields')} />
            {person.facts.length > 0 && <div className={css.inlineFacts}>
              {person.facts.map(fact => <p className={css.factText} key={String(fact.factId)}>
                <strong>{factLabel(fact, t)}</strong>{fact.text}
              </p>)}
            </div>}
          </div>
        </details>)}</div>}
    </section>
  </div>
}

function WorldView({ projection, t }: { readonly projection: TavernJourneyAssetProjection | null; readonly t: TavernMemoryPanelProps['t'] }): ReactElement {
  const worlds = selectedWorlds(projection)
  const fields = worldFields(projection?.worldFields ?? [])
  return <div id="tavern-context-panel-world" className={css.view} role="tabpanel" aria-labelledby="tavern-context-world" tabIndex={-1}>
    <section className={css.section}>
      <div className={css.sectionHeading}><div><p className={css.sectionKicker}>{t('memory.world')}</p><h3 className={css.sectionTitle}>{t('memory.worldOverview')}</h3></div><span className={css.sectionCount}>{worlds.length}</span></div>
      <FieldList fields={fields} empty={t('memory.noWorldFields')} />
      {worlds.length === 0 && <p className={css.empty}>{t('memory.noWorld')}</p>}
      <div className={css.worldList}>{worlds.map(world => <details className={css.worldItem} key={String(world.id)}>
        <summary className={css.characterSummary}><span><strong>{world.name}</strong><small>{t('memory.entriesCount', { count: world.entries.length })}</small></span><span className={css.tag}>{world.id}</span></summary>
        <div className={css.worldEntries}>{world.entries.length === 0 ? <p className={css.empty}>{t('memory.noWorldEntries')}</p> : world.entries.map(entry => <article className={css.worldEntry} key={String(entry.id)}><p className={css.fieldLabel}>{t('memory.worldEntry')} · {String(entry.id)}</p><MarkdownText text={entry.content} /></article>)}</div>
      </details>)}</div>
    </section>
  </div>
}

function CapabilityState({ title, body }: { readonly title: string; readonly body: string }): ReactElement {
  return <div className={css.capability} role="status"><strong>{title}</strong><p>{body}</p></div>
}

function FactItem({
  fact,
  selected,
  editing,
  draft,
  canEdit,
  canRemove,
  onSelect,
  onBeginEdit,
  onDraftChange,
  onCancelEdit,
  onRequestEdit,
  onRequestRemove,
  t,
}: {
  readonly fact: TavernFactEntry
  readonly selected: boolean
  readonly editing: boolean
  readonly draft: string
  readonly canEdit: boolean
  readonly canRemove: boolean
  readonly onSelect: () => void
  readonly onBeginEdit: () => void
  readonly onDraftChange: (value: string) => void
  readonly onCancelEdit: () => void
  readonly onRequestEdit: () => void
  readonly onRequestRemove: () => void
  readonly t: TavernMemoryPanelProps['t']
}): ReactElement {
  const factId = String(fact.factId)
  return <li className={css.factItem}>
    <button className={`${css.factButton} ${selected ? css.factSelected : ''}`} type="button" aria-expanded={selected} onClick={onSelect}><span className={css.factLabel}>{factLabel(fact, t)}</span><span className={css.factText}>{fact.text}</span><span className={css.meta}>{sourceLabel(fact, t)} · {t('memory.event')} {fact.eventSeq}</span></button>
    {(canEdit || canRemove) && <div className={css.actionRow}>{canEdit && !editing && <button className={css.actionButton} type="button" onClick={onBeginEdit}>{t('memory.editFact')}</button>}{canRemove && !editing && <button className={css.dangerAction} type="button" onClick={onRequestRemove}>{t('memory.removeFact')}</button>}</div>}
    {editing && <form className={css.editForm} onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (draft.trim().length > 0) onRequestEdit() }}><label className={css.fieldLabel} htmlFor={`memory-fact-${factId}`}>{t('memory.editFactLabel')}</label><textarea id={`memory-fact-${factId}`} className={css.editTextarea} value={draft} onChange={(event) => { onDraftChange(event.target.value) }} rows={4} /><div className={css.actionRow}><button className={css.primaryButton} type="submit" disabled={draft.trim().length === 0}>{t('memory.reviewFactChange')}</button><button className={css.secondaryButton} type="button" onClick={onCancelEdit}>{t('memory.cancelEdit')}</button></div></form>}
    {selected && !editing && <div className={css.provenance}><h3 className={css.provenanceTitle}>{t('memory.provenance')}</h3><blockquote>{fact.text}</blockquote><dl className={css.details}><dt>{t('memory.source')}</dt><dd>{sourceLabel(fact, t)}</dd><dt>{t('memory.branch')}</dt><dd>{fact.branch ?? t('memory.branchUnavailable')}</dd><dt>{t('memory.event')}</dt><dd>{fact.eventSeq}</dd>{fact.turn !== undefined && <><dt>{t('memory.turn')}</dt><dd>{fact.turn}</dd></>}</dl></div>}
  </li>
}

function PlotCheckpoint({ checkpoint, t }: { readonly checkpoint: TavernMemoryInspection['checkpoints'][number]; readonly t: TavernMemoryPanelProps['t'] }): ReactElement {
  const shadowedTurns = checkpoint.shadowedTurns.start === checkpoint.shadowedTurns.end ? t('memory.turnValue', { turn: checkpoint.shadowedTurns.start }) : `${t('memory.turnValue', { turn: checkpoint.shadowedTurns.start })}–${t('memory.turnValue', { turn: checkpoint.shadowedTurns.end })}`
  const openThreads = checkpoint.openThreads.length === 0 ? t('memory.noOpenThreads') : checkpoint.openThreads.join(', ')
  return <li className={css.checkpoint}><div className={css.rowHeading}><h3>{checkpoint.plotSummary}</h3><span className={`${css.tag} ${css.tagAccent}`}>{String(checkpoint.compactionId)}</span></div><div className={css.meta}><span>{t('memory.summarySeq')}: {checkpoint.summarySeq}</span><span>{t('memory.checkpointSeq')}: {checkpoint.checkpointSeq}</span></div><p>{t('memory.openThreads', { threads: openThreads })}</p><p>{t('memory.shadowedTurns', { turns: shadowedTurns })}</p></li>
}

function MemoryView({
  projection,
  facts,
  factsLoading,
  factsError,
  memoryInspection,
  memoryLoading,
  memoryError,
  selectedFactId,
  editingFactId,
  factDraft,
  canEdit,
  canRemove,
  canResolve,
  onSelectFact,
  onBeginEdit,
  onDraftChange,
  onCancelEdit,
  onRequestEdit,
  onRequestRemove,
  onRequestConflict,
  t,
}: {
  readonly projection: TavernJourneyAssetProjection | null
  readonly facts: TavernFactInspection | null
  readonly factsLoading: boolean
  readonly factsError: string | null
  readonly memoryInspection: TavernMemoryInspection | null
  readonly memoryLoading: boolean
  readonly memoryError: string | null
  readonly selectedFactId: string | null
  readonly editingFactId: string | null
  readonly factDraft: string
  readonly canEdit: boolean
  readonly canRemove: boolean
  readonly canResolve: boolean
  readonly onSelectFact: (fact: TavernFactEntry) => void
  readonly onBeginEdit: (fact: TavernFactEntry) => void
  readonly onDraftChange: (value: string) => void
  readonly onCancelEdit: () => void
  readonly onRequestEdit: (fact: TavernFactEntry) => void
  readonly onRequestRemove: (fact: TavernFactEntry) => void
  readonly onRequestConflict: (conflict: TavernFactConflict, keep: 'new' | 'old') => void
  readonly t: TavernMemoryPanelProps['t']
}): ReactElement {
  const factsList = currentFacts(projection, facts)
  const conflicts = currentConflicts(projection, facts)
  const memoryContent = factsError !== null ? <p className={css.error} role="alert">{factsError}</p> : factsLoading && facts === null ? <p className={css.empty} role="status">{t('memory.factsLoading')}</p> : factsList.length === 0 ? <p className={css.empty}>{t('memory.noMemoryEntries')}</p> : <ul className={css.factList}>{factsList.map(fact => <FactItem key={String(fact.factId)} fact={fact} selected={selectedFactId === String(fact.factId)} editing={editingFactId === String(fact.factId)} draft={factDraft} canEdit={canEdit} canRemove={canRemove} onSelect={() => { onSelectFact(fact) }} onBeginEdit={() => { onBeginEdit(fact) }} onDraftChange={onDraftChange} onCancelEdit={onCancelEdit} onRequestEdit={() => { onRequestEdit(fact) }} onRequestRemove={() => { onRequestRemove(fact) }} t={t} />)}</ul>
  return <div id="tavern-context-panel-memory" className={css.view} role="tabpanel" aria-labelledby="tavern-context-memory" tabIndex={-1}>
    <section className={css.section}><div className={css.sectionHeading}><div><p className={css.sectionKicker}>{t('memory.memoryView')}</p><h3 className={css.sectionTitle}>{t('memory.memoryEntries')}</h3></div><span className={css.sectionCount}>{factsList.length}</span></div>{memoryContent}{conflicts.length > 0 && <div className={css.conflictList}><p className={css.sectionKicker}>{t('memory.conflicts')}</p>{conflicts.map(conflict => <div className={css.conflict} key={conflict.id}><div className={css.rowHeading}><strong>{conflict.label}</strong><span className={`${css.tag} ${css.tagWarn}`}>{t('memory.conflict')}</span></div><p>{t('memory.previousValue', { value: conflict.previousText })}</p><p>{t('memory.incomingValue', { value: conflict.incomingText })}</p>{canResolve && <div className={css.actionRow}><button className={css.actionButton} type="button" onClick={() => { onRequestConflict(conflict, 'new') }}>{t('memory.keepNew')}</button><button className={css.actionButton} type="button" onClick={() => { onRequestConflict(conflict, 'old') }}>{t('memory.keepOld')}</button></div>}</div>)}</div>}{!canEdit && !canRemove && <CapabilityState title={t('memory.factCapabilityTitle')} body={t('memory.factCapability')} />}</section>
    <section className={css.section}><div className={css.sectionHeading}><div><p className={css.sectionKicker}>{t('memory.plot')}</p><h3 className={css.sectionTitle}>{t('memory.plotTitle')}</h3></div><span className={css.sectionCount}>{memoryInspection?.checkpoints.length ?? 0}</span></div>{memoryError !== null ? <p className={css.error} role="alert">{memoryError}</p> : memoryLoading ? <p className={css.empty} role="status">{t('memory.plotLoading')}</p> : memoryInspection === null ? <p className={css.empty}>{t('memory.plotNotLoaded')}</p> : memoryInspection.checkpoints.length === 0 ? <p className={css.empty}>{t('memory.noCheckpoints')}</p> : <ul className={css.checkpointList}>{memoryInspection.checkpoints.map(checkpoint => <PlotCheckpoint key={String(checkpoint.compactionId)} checkpoint={checkpoint} t={t} />)}</ul>}</section>
  </div>
}

function ImpactDialog({ pending, busy, error, onCancel, onConfirm, t }: { readonly pending: PendingFactMutation; readonly busy: boolean; readonly error: string | null; readonly onCancel: () => void; readonly onConfirm: () => void; readonly t: TavernMemoryPanelProps['t'] }): ReactElement {
  const dialogRef = useRef<HTMLElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  useTavernDialogFocus(dialogRef, cancelRef, onCancel, !busy)
  const description = pending.kind === 'edit' ? t('memory.impactEdit', { previous: pending.fact.text, next: pending.text }) : pending.kind === 'remove' ? t('memory.impactRemove', { value: pending.fact.text }) : t('memory.impactConflict', { label: pending.conflict.label, keep: pending.keep === 'new' ? pending.conflict.incomingText : pending.conflict.previousText })
  const confirmLabel = pending.kind === 'remove' ? t('memory.confirmRemove') : t('memory.impactConfirm')
  return <div className={css.dialogScrim} role="presentation"><section ref={dialogRef} tabIndex={-1} className={css.impactDialog} role="dialog" aria-modal="true" aria-labelledby="memory-impact-title" aria-describedby="memory-impact-copy"><p className={css.eyebrow}>{t('memory.impactEyebrow')}</p><h2 id="memory-impact-title">{t('memory.impactTitle')}</h2><p id="memory-impact-copy" className={css.dialogCopy}>{description}</p>{error !== null && <p className={css.error} role="alert">{error}</p>}<div className={css.dialogActions}><button ref={cancelRef} className={css.secondaryButton} type="button" disabled={busy} onClick={onCancel}>{t('memory.impactCancel')}</button><button className={pending.kind === 'remove' ? css.dangerButton : css.primaryButton} type="button" disabled={busy} onClick={onConfirm}>{busy ? t('memory.saving') : confirmLabel}</button></div></section></div>
}

/** Render the unified Journey context drawer and guarded memory actions. */
export function TavernMemoryPanel({
  projection,
  facts,
  factsLoading = false,
  factsError = null,
  memoryInspection = null,
  memoryLoading = false,
  memoryError = null,
  onClose,
  view,
  onViewChange,
  sessionId,
  tavernAssets,
  onFactsChanged,
  t,
}: TavernMemoryPanelProps): ReactElement {
  const [uncontrolledView, setUncontrolledView] = useState<ContextView>('characters')
  const [selectedFactId, setSelectedFactId] = useState<string | null>(null)
  const [editingFactId, setEditingFactId] = useState<string | null>(null)
  const [factDraft, setFactDraft] = useState('')
  const [pending, setPending] = useState<PendingFactMutation | null>(null)
  const [factBusy, setFactBusy] = useState(false)
  const [factError, setFactError] = useState<string | null>(null)
  const [localFacts, setLocalFacts] = useState<TavernFactInspection | null>(null)
  const displayedFacts = localFacts ?? facts
  const canEdit = sessionId !== undefined && tavernAssets?.editFact !== undefined
  const canRemove = sessionId !== undefined && tavernAssets?.removeFact !== undefined
  const canResolve = sessionId !== undefined && tavernAssets?.resolveConflict !== undefined
  const currentView = view ?? uncontrolledView
  const panelRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  useTavernDialogFocus(panelRef, closeRef, onClose, factBusy === false, pending === null)

  async function executeFactMutation(): Promise<void> {
    const action = pending
    if (action === null || sessionId === undefined) return
    setFactBusy(true)
    setFactError(null)
    try {
      let next: TavernFactInspection | null = null
      if (action.kind === 'edit') {
        if (tavernAssets?.editFact === undefined) { setFactError(t('memory.factCapability')); return }
        const result = await tavernAssets.editFact(sessionId, { factId: String(action.fact.factId), text: action.text })
        if (!result.ok) { setFactError(result.error.message); return }
        next = result.value
      } else if (action.kind === 'remove') {
        if (tavernAssets?.removeFact === undefined) { setFactError(t('memory.factCapability')); return }
        const result = await tavernAssets.removeFact(sessionId, { factId: String(action.fact.factId) })
        if (!result.ok) { setFactError(result.error.message); return }
        next = result.value
      } else {
        if (tavernAssets?.resolveConflict === undefined) { setFactError(t('memory.factCapability')); return }
        const result = await tavernAssets.resolveConflict(sessionId, { factId: String(action.conflict.factId), keep: action.keep })
        if (!result.ok) { setFactError(result.error.message); return }
        next = result.value
      }
      if (next !== null) {
        setLocalFacts(next)
        onFactsChanged?.(next)
        setPending(null)
        setEditingFactId(null)
        setSelectedFactId(null)
      }
    } catch {
      setFactError(t('memory.operationFailed'))
    } finally {
      setFactBusy(false)
    }
  }

  function beginEdit(fact: TavernFactEntry): void {
    setSelectedFactId(String(fact.factId))
    setEditingFactId(String(fact.factId))
    setFactDraft(fact.text)
    setFactError(null)
  }
  function reviewEdit(fact: TavernFactEntry): void { const text = factDraft.trim(); if (text.length === 0) return; setPending({ kind: 'edit', fact, text }); setEditingFactId(null); setFactError(null) }
  function closeImpact(): void { if (factBusy) return; setPending(null); setFactError(null) }

  return <>
    <aside ref={panelRef} id="tavern-context-drawer" tabIndex={-1} className={css.panel} role="dialog" aria-modal="true" aria-labelledby="tavern-memory-title" aria-describedby="tavern-memory-description" aria-busy={factBusy}>
      <header className={css.header}><div><p className={css.eyebrow}>{t('memory.eyebrow')}</p><h2 id="tavern-memory-title" className={css.title}>{t('memory.title')}</h2><p id="tavern-memory-description" className={css.description}>{t('memory.description')}</p></div><button ref={closeRef} className={css.closeButton} type="button" aria-label={t('memory.close')} onClick={onClose}><IconCloseOutline16 aria-hidden="true" /></button></header>
      <nav className={css.tabs} aria-label={t('memory.views')} role="tablist">
        <button id="tavern-context-characters" className={`${css.tab} ${currentView === 'characters' ? css.tabActive : ''}`} type="button" role="tab" aria-selected={currentView === 'characters'} aria-controls="tavern-context-panel-characters" onClick={() => { setUncontrolledView('characters'); onViewChange?.('characters') }}>{t('memory.charactersView')}</button>
        <button id="tavern-context-world" className={`${css.tab} ${currentView === 'world' ? css.tabActive : ''}`} type="button" role="tab" aria-selected={currentView === 'world'} aria-controls="tavern-context-panel-world" onClick={() => { setUncontrolledView('world'); onViewChange?.('world') }}>{t('memory.worldView')}</button>
        <button id="tavern-context-memory" className={`${css.tab} ${currentView === 'memory' ? css.tabActive : ''}`} type="button" role="tab" aria-selected={currentView === 'memory'} aria-controls="tavern-context-panel-memory" onClick={() => { setUncontrolledView('memory'); onViewChange?.('memory') }}>{t('memory.memoryView')}</button>
      </nav>
      {currentView === 'characters' && <CharacterView projection={projection} facts={displayedFacts} t={t} />}
      {currentView === 'world' && <WorldView projection={projection} t={t} />}
      {currentView === 'memory' && <MemoryView projection={projection} facts={displayedFacts} factsLoading={factsLoading} factsError={factsError} memoryInspection={memoryInspection} memoryLoading={memoryLoading} memoryError={memoryError} selectedFactId={selectedFactId} editingFactId={editingFactId} factDraft={factDraft} canEdit={canEdit} canRemove={canRemove} canResolve={canResolve} onSelectFact={(fact) => { setSelectedFactId(selectedFactId === String(fact.factId) ? null : String(fact.factId)) }} onBeginEdit={beginEdit} onDraftChange={setFactDraft} onCancelEdit={() => { setEditingFactId(null) }} onRequestEdit={reviewEdit} onRequestRemove={(fact) => { setPending({ kind: 'remove', fact }); setFactError(null) }} onRequestConflict={(conflict, keep) => { setPending({ kind: 'conflict', conflict, keep }); setFactError(null) }} t={t} />}
    </aside>
    {pending !== null && <ImpactDialog
      pending={pending}
      busy={factBusy}
      error={factError}
      onCancel={closeImpact}
      onConfirm={() => { void executeFactMutation() }}
      t={t}
    />}
  </>
}
