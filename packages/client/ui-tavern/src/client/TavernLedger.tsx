/** Dynamic Journey ledger projection and its lightweight presentation controls. */

import { slug } from '@deepseek-ai/dsh-tavern-shared'
import { IconListPenOutline16, IconTrashOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactElement } from 'react'
import type {
  TavernFactEntry,
  TavernFactProjection,
  TavernJourneyField,
} from '@deepseek-ai/dsh-tavern-host/client'
import type { TavernKey } from './locales.ts'
import css from './TavernLedger.module.css'

export type LedgerScope = 'character' | 'world'

export interface LedgerConflict {
  readonly id: string
  readonly newText: string
  readonly previousText: string
  readonly reason?: string
}

export interface LedgerItem {
  readonly id: string
  readonly key: string
  readonly value: string
  readonly source: string
  readonly fact: TavernFactEntry | undefined
  readonly conflict: LedgerConflict | undefined
}

export interface LedgerSection {
  readonly id: string
  readonly name: string
  readonly items: readonly LedgerItem[]
  readonly conflict: LedgerConflict | undefined
}

export interface LedgerProjection {
  readonly character: readonly LedgerSection[]
  readonly world: readonly LedgerSection[]
}

/** Actions and view-local layout state shared by Journey ledger hosts. */
export interface TavernLedgerActions {
  readonly onEdit: (factId: string, text: string) => Promise<void>
  readonly onRemove: (factId: string) => Promise<void>
  readonly onResolveConflict?: (factId: string, keep: 'new' | 'old', fallbackText: string) => Promise<void>
  readonly sectionNames: Readonly<Record<string, string>>
  readonly hiddenSections: ReadonlySet<string>
  readonly sectionOrder: Readonly<Record<LedgerScope, readonly string[]>>
  readonly onRenameSection: (scope: LedgerScope, sectionId: string, name: string) => void
  readonly onDeleteSection: (scope: LedgerScope, sectionId: string) => void
  readonly onRestoreSection?: () => void
  readonly onReorderSections: (scope: LedgerScope, sourceId: string, targetId: string) => void
  readonly editableSections?: boolean
}

interface LedgerProps extends TavernLedgerActions {
  readonly characterFields: readonly TavernJourneyField[] | undefined
  readonly worldFields: readonly TavernJourneyField[] | undefined
  readonly facts: TavernFactProjection | undefined
  readonly t: (key: TavernKey) => string
}

function sourceItems(fields: readonly TavernJourneyField[], facts: readonly TavernFactEntry[]): readonly LedgerItem[] {
  const byId = new Map(facts.map(fact => [String(fact.factId), fact]))
  return fields.map(field => ({
    id: field.id,
    key: field.label,
    value: field.value,
    source: field.origin === 'fact' ? '审计记录' : field.sourceEntryId === undefined ? '角色卡' : '世界书',
    fact: field.factId === undefined ? undefined : byId.get(String(field.factId)),
    conflict: undefined,
  }))
}

function toSections(items: readonly LedgerItem[], scope: LedgerScope): readonly LedgerSection[] {
  const grouped = new Map<string, LedgerItem[]>()
  for (const item of items) {
    const key = item.key.trim() || '未命名'
    const current = grouped.get(key) ?? []
    current.push(item)
    grouped.set(key, current)
  }
  return [...grouped.entries()].map(([name, groupedItems]) => ({
    id: `${scope}:${slug(name, 'section')}`,
    name,
    items: groupedItems,
    conflict: groupedItems.find(item => item.conflict !== undefined)?.conflict,
  }))
}

/** Build dynamic columns from the authoritative projection, without a fixed label list. */
export function projectLedger(
  characterFields: readonly TavernJourneyField[] | undefined,
  worldFields: readonly TavernJourneyField[] | undefined,
  facts: TavernFactProjection | undefined,
  _t: (key: TavernKey) => string,
): LedgerProjection {
  const factEntries = facts === undefined ? [] : [...Object.values(facts.people).flat(), ...facts.world]
  return {
    character: toSections(sourceItems(characterFields ?? [], factEntries), 'character'),
    world: toSections(sourceItems(worldFields ?? [], factEntries), 'world'),
  }
}

function orderedSections(
  sections: readonly LedgerSection[],
  order: readonly string[],
  names: Readonly<Record<string, string>>,
  hidden: ReadonlySet<string>,
): readonly LedgerSection[] {
  if (order.length === 0) return sections.filter(section => !hidden.has(section.id))
  const byId = new Map(sections.map(section => [section.id, section]))
  const result: LedgerSection[] = []
  for (const id of order) {
    const section = byId.get(id)
    if (section !== undefined && !hidden.has(id)) {
      result.push({ ...section, name: names[id] ?? section.name })
      byId.delete(id)
    } else if (section === undefined && names[id] !== undefined && !hidden.has(id)) {
      result.push({ id, name: names[id], items: [], conflict: undefined })
    }
  }
  return result
}

/** Render both dynamic ledger scopes in parallel. */
export function TavernLedger({
  characterFields, worldFields, t, onEdit, onRemove, onResolveConflict,
  facts,
  sectionNames, hiddenSections, sectionOrder, onRenameSection, onDeleteSection,
  onRestoreSection, onReorderSections,
  editableSections = true,
}: LedgerProps): ReactElement {
  const projection = useMemo(() => projectLedger(characterFields, worldFields, facts, t), [characterFields, worldFields, facts, t])
  const characterSections = orderedSections(projection.character, sectionOrder.character, sectionNames, hiddenSections)
  const worldSections = orderedSections(projection.world, sectionOrder.world, sectionNames, hiddenSections)
  const [dragging, setDragging] = useState<{ scope: LedgerScope; id: string } | null>(null)

  const columns: readonly [LedgerScope, readonly LedgerSection[]][] = [
    ['character', characterSections] as const,
    ['world', worldSections] as const,
  ].filter((entry): entry is [LedgerScope, readonly LedgerSection[]] => entry[1].length > 0)
  const columnProps = (scope: LedgerScope, sections: readonly LedgerSection[]): LedgerColumnProps => ({
    scope,
    sections,
    editableSections,
    t,
    dragging,
    onEdit,
    onRemove,
    ...(onResolveConflict === undefined ? {} : { onResolveConflict }),
    onRename: onRenameSection,
    onDelete: onDeleteSection,
    onDragStart: (id) => { setDragging({ scope, id }) },
    onDragEnd: () => { setDragging(null) },
    onDrop: (id) => {
      if (dragging?.scope === scope) onReorderSections(scope, dragging.id, id)
      setDragging(null)
    },
  })

  return <section className={css.panel} aria-label={t('journey.ledger')}>
    <div className={css.panelHeader}>
      <div>
        <h2 className={css.panelTitle}>{t('journey.ledger')}</h2>
      </div>
      <IconListPenOutline16 aria-hidden="true" />
    </div>
    <div className={css.columns}>
      {columns.map(([scope, sections]) => <LedgerColumn key={scope} {...columnProps(scope, sections)} />)}
    </div>
    {editableSections && onRestoreSection !== undefined && <button type="button" className={css.button} onClick={onRestoreSection}>{t('journey.undo')}</button>}
  </section>
}

interface LedgerSectionActions {
  readonly scope: LedgerScope
  readonly t: (key: TavernKey) => string
  readonly onEdit: TavernLedgerActions['onEdit']
  readonly onRemove: TavernLedgerActions['onRemove']
  readonly onResolveConflict?: TavernLedgerActions['onResolveConflict']
  readonly onRename: TavernLedgerActions['onRenameSection']
  readonly onDelete: TavernLedgerActions['onDeleteSection']
  readonly onDragStart: (id: string) => void
  readonly onDragEnd: () => void
  readonly onDrop: (id: string) => void
  readonly editableSections: boolean
}

interface LedgerColumnProps extends LedgerSectionActions {
  readonly sections: readonly LedgerSection[]
  readonly dragging: { scope: LedgerScope; id: string } | null
}

function LedgerColumn({
  scope, sections, t, dragging,
  onEdit, onRemove, onResolveConflict, onRename, onDelete, onDragStart, onDragEnd, onDrop, editableSections,
}: LedgerColumnProps): ReactElement {
  return <section className={css.column} data-ledger-scope={scope}>
    <div className={css.sectionList}>
      {sections.map(section => <LedgerSectionCard
        key={section.id}
        scope={scope}
        section={section}
        t={t}
        dragging={dragging?.id === section.id}
        editableSections={editableSections}
        onEdit={onEdit}
        onRemove={onRemove}
        {...(onResolveConflict === undefined ? {} : { onResolveConflict })}
        onRename={onRename}
        onDelete={onDelete}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDrop={onDrop}
      />)}
    </div>
  </section>
}

interface SectionCardProps extends LedgerSectionActions {
  readonly section: LedgerSection
  readonly dragging: boolean
  readonly editableSections: boolean
}

function LedgerSectionCard({
  scope, section, t, dragging, onEdit, onRemove, onResolveConflict, onRename, onDelete,
  onDragStart, onDragEnd, onDrop, editableSections,
}: SectionCardProps): ReactElement {
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(section.name)
  const conflictItem = section.items.find(item => item.conflict !== undefined && item.fact !== undefined)
  const conflict = section.conflict

  function submitRename(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const next = name.trim()
    if (next.length === 0) return
    onRename(scope, section.id, next)
    setRenaming(false)
  }

  return <article
    className={css.section}
    data-conflict={conflict === undefined ? undefined : 'true'}
    data-dragging={dragging ? 'true' : undefined}
    draggable={editableSections}
    onDragStart={() => { onDragStart(section.id) }}
    onDragEnd={onDragEnd}
    onDragOver={(event) => { event.preventDefault() }}
    onDrop={() => { onDrop(section.id) }}
  >
    <header className={css.sectionHeader}>
      <div className={css.sectionHeading}>
        <button type="button" className={css.dragHandle} title={t('journey.reorderSection')} aria-label={t('journey.reorderSection')}>⋮⋮</button>
        {renaming ? <form onSubmit={submitRename}><input className={css.renameInput} aria-label={t('journey.sectionName')} value={name} autoFocus onChange={(event) => { setName(event.target.value) }} onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => { if (event.key === 'Escape') { event.preventDefault(); setRenaming(false) } }} /></form> : <h4 className={css.sectionTitle}>{section.name}</h4>}
        <span className={css.sectionCount}>{section.items.length}</span>
      </div>
      {editableSections && <div className={css.sectionActions}>
        <button type="button" className={css.sectionButton} title={t('journey.renameSection')} aria-label={`${t('journey.renameSection')}: ${section.name}`} onClick={() => { setName(section.name); setRenaming(true) }}>✎</button>
        <button type="button" className={css.sectionButton} title={t('journey.deleteSection')} aria-label={`${t('journey.deleteSection')}: ${section.name}`} onClick={() => { onDelete(scope, section.id) }}><IconTrashOutline16 /></button>
      </div>}
    </header>
    <div className={css.items}>
      {section.items.map(item => <LedgerItemRow
        key={item.id}
        item={item}
        t={t}
        onEdit={onEdit}
        onRemove={onRemove}
      />)}
    </div>
    {conflict !== undefined && conflictItem?.fact !== undefined && <div className={css.conflict} role="alert">
      <strong>{t('journey.conflict')}</strong>
      <span>{t('journey.conflictChanged')}: <span className={css.conflictValue}>{conflict.newText}</span></span>
      <br />
      <span>{t('journey.conflictRecorded')}: <span className={css.conflictValue}>{conflict.previousText}</span></span>
      {conflict.reason !== undefined && <><br /><span>{conflict.reason}</span></>}
      <div className={css.conflictActions}>
        <button type="button" className={css.conflictKeep} onClick={() => { void onResolveConflict?.(conflict.id, 'new', conflict.newText) }}>{t('journey.keepNew')}</button>
        <button type="button" className={css.conflictDrop} onClick={() => { void onResolveConflict?.(conflict.id, 'old', conflict.previousText) }}>{t('journey.dropNew')}</button>
      </div>
    </div>}
  </article>
}

function LedgerItemRow({ item, t, onEdit, onRemove }: {
  readonly item: LedgerItem
  readonly t: (key: TavernKey) => string
  readonly onEdit: (factId: string, text: string) => Promise<void>
  readonly onRemove: (factId: string) => Promise<void>
}): ReactElement {
  const fact = item.fact
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(item.value)
  const [saving, setSaving] = useState(false)
  const skipBlurSave = useRef(false)

  async function save(): Promise<void> {
    if (fact === undefined || draft.trim().length === 0 || saving) return
    setSaving(true)
    try {
      await onEdit(String(fact.factId), draft.trim())
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  function cancel(): void {
    skipBlurSave.current = true
    setDraft(item.value)
    setEditing(false)
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      cancel()
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      skipBlurSave.current = true
      void save()
    }
  }

  return <div className={css.itemRow} data-fact-id={fact === undefined ? undefined : String(fact.factId)}>
    <div className={css.itemCopy}>
      <span className={css.itemKey}>{item.key}</span>
      {editing ? <textarea
        className={css.renameInput}
        aria-label={t('facts.editInput')}
        value={draft}
        autoFocus
        disabled={saving}
        onChange={(event) => { setDraft(event.target.value) }}
        onKeyDown={keyDown}
        onBlur={() => {
          if (skipBlurSave.current) {
            skipBlurSave.current = false
            return
          }
          void save()
        }}
      /> : <p className={css.itemValue}>{item.value}</p>}
      <span className={css.itemSource}>{item.source}</span>
    </div>
    {fact !== undefined && <>
      <button type="button" className={css.itemButton} title={editing ? t('facts.save') : t('facts.edit')} aria-label={`${editing ? t('facts.save') : t('facts.edit')}: ${item.key}`} onClick={() => { if (editing) void save(); else setEditing(true) }}>{editing ? '✓' : '✎'}</button>
      <button type="button" className={css.itemButton} title={t('facts.remove')} aria-label={`${t('facts.remove')}: ${item.key}`} onClick={() => { void onRemove(String(fact.factId)) }}><IconTrashOutline16 /></button>
    </>}
  </div>
}
