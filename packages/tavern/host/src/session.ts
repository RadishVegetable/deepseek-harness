/** Session-log events and replay helpers owned by the Tavern Host. */

import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { AssetSelection, PromptAssetBaseline, PromptWorldInfoEntry } from '@deepseek-ai/dsh-tavern-assets/types'
import type { CompiledContext, Observer } from '@deepseek-ai/dsh-tavern-context/types'
import {
  projectSwipeState,
  projectStoryState,
  swipeCandidateId,
  swipeGroupId,
  sourceEventId,
  storyBranchId,
} from '@deepseek-ai/dsh-tavern-state'
import type {
  JsonValue,
  StoryStateChangeRecord,
  StoryStateProjection,
  StoryBranchId,
  SwipeProjection,
  SwipeRecord,
} from '@deepseek-ai/dsh-tavern-state/types'
import { projectTavernJourneyAssets, resolveTavernFacts } from './facts.ts'
import type {
  TavernAssetsEditedEvent,
  TavernJourneySelection,
  TavernGreetingEvent,
  TavernJourneyAssetProjection,
  TavernSectionConfigEvent,
  TavernSectionConfigInput,
  TavernSectionConfigInspection,
  TavernSectionConfigProjection,
  TavernStoryStateEvent,
} from './types.ts'

/** Durable asset references written before a Tavern prompt can change. */
export interface TavernAssetsSelectedEvent {
  readonly selection: AssetSelection
  /**
   * Legacy source snapshot fields are accepted only when replaying old logs.
   * New selection events never persist these fields.
   */
  readonly baseline?: PromptAssetBaseline
  readonly character?: import('@deepseek-ai/dsh-tavern-assets/types').CharacterAsset | null
  readonly worldInfo?: readonly import('@deepseek-ai/dsh-tavern-assets/types').WorldInfoAsset[]
  readonly characterName?: string | null
  readonly worldInfoNames?: readonly string[]
  /** Player identity supplied at Journey startup, when present. */
  readonly playerIdentity?: string | null
}

/** Minimal selection event shared by the selected and edited event variants. */
export type TavernSelectionEvent = TavernAssetsSelectedEvent | TavernAssetsEditedEvent

/** Durable opening greeting selected from a Character Card for one Session. */
/** Durable activation payload written before a matched context snapshot is used. */
export interface TavernContextActivationEvent {
  /**
   * Legacy persisted fingerprint. New activations keep this only in memory;
   * the field remains optional so old logs can still be inspected.
   */
  readonly fingerprint?: string
  readonly selection: AssetSelection
  readonly query: string
  readonly observer: Observer
  readonly branch: string
  readonly compiled: CompiledContext<PromptWorldInfoEntry>
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Asset references selected for later turns; source data is resolved by Host. */
    'tavern/assets-selected': TavernAssetsSelectedEvent
    /** Metadata for a Journey asset-selection edit. */
    'tavern/assets-edited': TavernAssetsEditedEvent
    /** The World Info compiler decision used for one model-visible snapshot. */
    'tavern/context-activation': TavernContextActivationEvent
    /** A durable canonical story-state change used by the Tavern context projection. */
    'tavern/story-state': TavernStoryStateEvent
  }
}

/**
 * Read the latest selected Tavern asset references in one session log.
 * @param session - Session event sequence to inspect.
 * @returns The latest selection event, or undefined when none is recorded.
 */
export function resolveTavernSelection(session: Pick<Session, 'events'>): TavernSelectionEvent | undefined {
  return resolveTavernSelectionAt(session)
}

/**
 * Read the selected asset references and any later edit metadata visible at a log sequence.
 * @param session - Session event sequence to inspect.
 * @param maxSeq - Inclusive sequence limit, or the end of the current log.
 * @returns The latest selected source references or edit metadata, or undefined.
 */
export function resolveTavernSelectionAt(session: Pick<Session, 'events'>, maxSeq = Number.MAX_SAFE_INTEGER): TavernSelectionEvent | undefined {
  let selected: TavernSelectionEvent | undefined
  let selectedSeq = Number.MAX_SAFE_INTEGER
  let edited: TavernSelectionEvent | undefined
  let editedSeq = -1
  for (let index = session.events.length - 1; index >= 0; index -= 1) {
    const event = session.events[index]
    if (event === undefined || event.seq > maxSeq) continue
    if (event.type === 'tavern/assets-edited' && edited === undefined) {
      edited = event.data
      editedSeq = event.seq
    }
    if (event.type === 'tavern/assets-selected') {
      selected = event.data
      selectedSeq = event.seq
      break
    }
  }
  const current = edited !== undefined && editedSeq > selectedSeq ? edited : selected
  return current
}

/**
 * Resolve a Journey's current source assets with the latest local fact overlay.
 * @param session - Session event sequence to inspect.
 * @param maxSeq - Inclusive sequence limit used for branch and historical replay.
 * @returns The latest Journey detail projection, or undefined before asset selection.
 */
export function resolveTavernJourneyAssets(session: Pick<Session, 'events'>, maxSeq = Number.MAX_SAFE_INTEGER): TavernJourneyAssetProjection | undefined {
  const selection = resolveTavernSelectionAt(session, maxSeq)
  if (selection === undefined) return undefined
  return projectTavernJourneyAssets(selectionProjection(selection), resolveTavernFacts(session, maxSeq))
}

function selectionProjection(event: TavernSelectionEvent): TavernJourneySelection {
  const character = event.character ?? null
  const worldInfo = event.worldInfo === undefined ? [] : [...event.worldInfo]
  return {
    selection: structuredClone(event.selection),
    baseline: event.baseline === undefined ? emptyPromptBaseline(event.selection) : structuredClone(event.baseline),
    character: character === null ? null : structuredClone(character),
    worldInfo: worldInfo.map(asset => structuredClone(asset)),
    characterName: event.characterName ?? character?.name ?? null,
    worldInfoNames: event.worldInfoNames === undefined ? worldInfo.map(asset => asset.name) : [...event.worldInfoNames],
    ...(event.playerIdentity === undefined ? {} : { playerIdentity: event.playerIdentity }),
  }
}

function emptyPromptBaseline(selection: AssetSelection): PromptAssetBaseline {
  return {
    selection: structuredClone(selection),
    references: [],
    characterSections: [],
    worldInfoEntries: [],
  }
}

/**
 * Rebuild dynamic ledger configuration from the current Session branch.
 * @param session - Session event sequence to inspect.
 * @returns Section configuration folded from append-only events.
 */
export function resolveTavernSectionConfig(session: Pick<Session, 'id' | 'events'>): TavernSectionConfigProjection {
  const state: Record<'character' | 'world', { names: Record<string, string>; hidden: Set<string>; order: string[] }> = {
    character: { names: {}, hidden: new Set(), order: [] },
    world: { names: {}, hidden: new Set(), order: [] },
  }
  const branch = String(session.id)
  for (const event of session.events) {
    if (event.type !== 'tavern/section-config' || event.data.branch !== branch) continue
    const current = state[event.data.scope]
    const sectionId = event.data.sectionId
    switch (event.data.operation) {
      case 'add':
        if (event.data.name !== undefined) current.names[sectionId] = event.data.name
        current.hidden.delete(sectionId)
        if (!current.order.includes(sectionId)) current.order.push(sectionId)
        break
      case 'rename':
        if (event.data.name !== undefined) current.names[sectionId] = event.data.name
        break
      case 'remove':
        current.hidden.add(sectionId)
        break
      case 'restore':
        current.hidden.delete(sectionId)
        break
      case 'reorder':
        if (event.data.order !== undefined) {
          current.order = [...new Set(event.data.order)]
        }
        break
    }
  }
  return {
    character: {
      names: { ...state.character.names },
      hidden: [...state.character.hidden],
      order: [...state.character.order],
    },
    world: {
      names: { ...state.world.names },
      hidden: [...state.world.hidden],
      order: [...state.world.order],
    },
  }
}

function nextSectionId(session: Pick<Session, 'events'>, scope: TavernSectionConfigInput['scope']): string {
  const used = new Set<string>()
  for (const event of session.events) {
    if (event.type === 'tavern/section-config' && event.data.scope === scope) used.add(event.data.sectionId)
  }
  let index = 1
  while (used.has(`${scope}:custom-${index}`)) index += 1
  return `${scope}:custom-${index}`
}

function requiredSectionName(input: TavernSectionConfigInput): string {
  const name = input.name?.trim()
  if (name === undefined || name.length === 0) throw new Error(`Tavern section ${input.operation} requires a name`)
  return name
}

function requiredSectionId(input: TavernSectionConfigInput, session: Pick<Session, 'events'>): string {
  const sectionId = input.sectionId?.trim()
  if (input.operation === 'add') return sectionId === undefined || sectionId.length === 0 ? nextSectionId(session, input.scope) : sectionId
  if (sectionId === undefined || sectionId.length === 0) throw new Error(`Tavern section ${input.operation} requires a sectionId`)
  return sectionId
}

/**
 * Validate and append one dynamic ledger configuration event.
 * @param session - Live Session receiving the event.
 * @param input - Requested section operation.
 * @returns The appended event and its replayed inspection.
 */
export function appendTavernSectionConfig(session: Session, input: TavernSectionConfigInput): TavernSectionConfigInspection {
  const sectionId = requiredSectionId(input, session)
  const name = input.operation === 'add' || input.operation === 'rename' ? requiredSectionName(input) : undefined
  const order = input.operation === 'reorder' ? input.order?.filter(id => id.trim().length > 0) : undefined
  if (input.operation === 'reorder' && (order === undefined || order.length === 0)) {
    throw new Error('Tavern section reorder requires a non-empty order')
  }
  if (order !== undefined && new Set(order).size !== order.length) throw new Error('Tavern section order contains duplicate ids')
  if (input.operation === 'reorder' && order !== undefined && !order.includes(sectionId)) {
    throw new Error('Tavern section reorder must include sectionId')
  }
  const data: TavernSectionConfigEvent = {
    branch: String(session.id),
    scope: input.scope,
    sectionId,
    operation: input.operation,
    ...(name === undefined ? {} : { name }),
    ...(order === undefined ? {} : { order: [...order] }),
  }
  if (sectionConfigAlreadyApplied(session, data)) return inspectTavernSectionConfig(session)
  session.append('tavern/section-config', data)
  return inspectTavernSectionConfig(session)
}

function sectionConfigAlreadyApplied(
  session: Pick<Session, 'id' | 'events'>,
  event: TavernSectionConfigEvent,
): boolean {
  const current = resolveTavernSectionConfig(session)[event.scope]
  const hidden = current.hidden.includes(event.sectionId)
  switch (event.operation) {
    case 'add':
      return current.order.includes(event.sectionId)
        && !hidden
        && current.names[event.sectionId] === event.name
    case 'rename':
      return current.names[event.sectionId] === event.name
    case 'remove':
      return hidden
    case 'restore':
      return !hidden
    case 'reorder':
      return event.order !== undefined
        && event.order.length === current.order.length
        && event.order.every((sectionId, index) => sectionId === current.order[index])
  }
}

/**
 * Inspect section configuration and the source events used to build it.
 * @param session - Session event sequence to inspect.
 * @returns Current section configuration and audit records.
 */
export function inspectTavernSectionConfig(session: Pick<Session, 'id' | 'events'>): TavernSectionConfigInspection {
  return {
    projection: resolveTavernSectionConfig(session),
    records: session.events
      .filter((event): event is SessionEvent<'tavern/section-config'> => event.type === 'tavern/section-config')
      .map(event => ({ seq: event.seq, data: structuredClone(event.data) })),
  }
}

/**
 * Read the first durable Tavern greeting in one session log.
 * @param session - Session event sequence to inspect.
 * @returns The first greeting, or undefined when no greeting is recorded.
 */
export function resolveTavernGreeting(session: Pick<Session, 'events'>): TavernGreetingEvent | undefined {
  for (const event of session.events) {
    if (event.type === 'tavern/greeting') return event.data
  }
  return undefined
}

/**
 * Append one Character Card greeting only for an empty session without a prior greeting.
 * @param session - live session receiving the durable event.
 * @param greeting - detached Character Card greeting facts.
 * @returns the appended event, or undefined when the session already has conversation content.
 */
export function appendTavernGreeting(session: Session, greeting: TavernGreetingEvent): SessionEvent<'tavern/greeting'> | undefined {
  if (session.deriveMessages().length > 0 || resolveTavernGreeting(session) !== undefined) return undefined
  if (greeting.text.trim().length === 0) return undefined
  return session.append('tavern/greeting', greeting)
}

/**
 * Read the latest context activation fingerprint in one session log.
 * @param session - Session event sequence to inspect.
 * @returns The latest fingerprint, or undefined when none is recorded.
 */
export function resolveTavernContextFingerprint(session: Pick<Session, 'events'>): string | undefined {
  for (let index = session.events.length - 1; index >= 0; index -= 1) {
    const event: SessionEvent | undefined = session.events[index]
    if (event?.type === 'tavern/context-activation') return event.data.fingerprint
  }
  return undefined
}

/**
 * Read the latest source-tracked context snapshot for one Tavern session.
 * @param session - Session event sequence to inspect.
 * @returns The latest activation payload, or undefined when no turn has compiled context.
 */
export function resolveTavernContextActivation(session: Pick<Session, 'events'>): TavernContextActivationEvent | undefined {
  for (let index = session.events.length - 1; index >= 0; index -= 1) {
    const event = session.events[index]
    if (event?.type === 'tavern/context-activation') return event.data
  }
  return undefined
}

/**
 * Rebuild canonical story-state records from the session log.
 * @param session - Session event sequence to inspect.
 * @returns Story-state records in session-log order.
 */
export function resolveTavernStoryStateRecords(session: Pick<Session, 'id' | 'events'>): readonly StoryStateChangeRecord[] {
  return session.events
    .filter((event): event is SessionEvent<'tavern/story-state'> => event.type === 'tavern/story-state')
    .map(event => ({
      sourceEventId: sourceEventId(`${String(session.id)}:${event.seq}`),
      branchId: storyBranchId(event.data.branch),
      sequence: event.seq,
      validity: structuredClone(event.data.validity),
      authority: structuredClone(event.data.authority),
      change: structuredClone(event.data.change),
      extensions: {},
    }))
}

/**
 * Rebuild durable swipe records from the current session log.
 * @param session - Session event sequence to inspect.
 * @returns Swipe records in session-log order.
 */
export function resolveTavernSwipeRecords(session: Pick<Session, 'id' | 'events'>): readonly SwipeRecord[] {
  return session.events
    .filter((event): event is SessionEvent<'tavern/swipe'> => event.type === 'tavern/swipe')
    .map((event) => {
      const common = {
        sourceEventId: sourceEventId(`${String(session.id)}:${event.seq}`),
        branchId: storyBranchId(event.data.branch),
        sequence: event.seq,
        validity: structuredClone(event.data.validity),
        authority: structuredClone(event.data.authority),
        extensions: {},
      }
      return event.data.kind === 'candidate.add'
        ? { ...common, kind: 'candidate.add' as const, groupId: swipeGroupId(event.data.groupId), candidate: structuredClone(event.data.candidate) }
        : { ...common, kind: 'candidate.select' as const, groupId: swipeGroupId(event.data.groupId), candidateId: swipeCandidateId(event.data.candidateId) }
    })
}

/**
 * Project swipe records over every branch represented by the session seed.
 * @param session - Session event sequence to inspect.
 * @returns Current swipe state and projection diagnostics.
 */
export function resolveTavernSwipe(session: Pick<Session, 'id' | 'events'>): SwipeProjection {
  const branchId = storyBranchId(String(session.id))
  const records = resolveTavernSwipeRecords(session)
  return projectSwipeState(records, { branchId, branchLineage: branchLineage(records.map(record => record.branchId), branchId) })
}

/**
 * Append the initial durable candidate for a completed assistant turn.
 * @param session - Live session receiving the candidate events.
 * @param turn - Completed assistant turn to record.
 */
export function appendTavernAssistantCandidate(session: Session, turn: number): void {
  const assistant = [...session.events].reverse().find(event =>
    event.type === 'assistant/message' && event.data.turn === turn)
  if (assistant === undefined || assistant.type !== 'assistant/message') return
  const assistantEventId = sourceEventId(`${String(session.id)}:${assistant.seq}`)
  const existing = resolveTavernSwipeRecords(session).some(record =>
    record.kind === 'candidate.add' && record.candidate.assistantEventId === assistantEventId)
  if (existing) return
  const groupId = swipeGroupId(`turn:${turn}`)
  const hasCurrentBranchCandidate = resolveTavernSwipeRecords(session).some(record =>
    record.kind === 'candidate.add'
    && record.branchId === storyBranchId(String(session.id))
    && record.groupId === groupId)
  const candidate = {
    candidateId: swipeCandidateId(`${String(session.id)}:${assistant.seq}:initial`),
    assistantEventId,
    origin: hasCurrentBranchCandidate
      ? 'regenerate' as const
      : session.header.parentSession === undefined ? 'initial' as const : 'swipe' as const,
    content: assistant.data.message as unknown as JsonValue,
    extensions: {},
  }
  appendTavernSwipeCandidate(session, groupId, candidate, 'model-candidate')
}

/**
 * Append one candidate and select it for a Tavern swipe group.
 * @param session - Live session receiving the candidate and selection events.
 * @param groupId - Swipe group that owns the candidate.
 * @param candidate - Assistant candidate to append and select.
 * @param addAuthority - Authority recorded for the candidate-add event.
 */
export function appendTavernSwipeCandidate(
  session: Session,
  groupId: import('@deepseek-ai/dsh-tavern-state/types').SwipeGroupId,
  candidate: import('@deepseek-ai/dsh-tavern-state/types').SwipeAssistantCandidate,
  addAuthority: 'model-candidate' | 'observed' = 'observed',
): void {
  session.append('tavern/swipe', {
    kind: 'candidate.add',
    branch: String(session.id),
    groupId,
    candidate: structuredClone(candidate),
    authority: { kind: addAuthority, extensions: {} },
    validity: { status: 'valid', extensions: {} },
  })
  session.append('tavern/swipe', {
    kind: 'candidate.select',
    branch: String(session.id),
    groupId,
    candidateId: candidate.candidateId,
    authority: { kind: 'observed', extensions: {} },
    validity: { status: 'valid', extensions: {} },
  })
}

/**
 * Project canonical story state for the current Tavern session branch.
 * @param session - Session event sequence to inspect.
 * @returns Current story state and projection diagnostics.
 */
export function resolveTavernStoryState(session: Pick<Session, 'id' | 'events'>): StoryStateProjection {
  const branchId = storyBranchId(String(session.id))
  const records = resolveTavernStoryStateRecords(session)
  return projectStoryState(records, { branchId, branchLineage: branchLineage(records.map(record => record.branchId), branchId) })
}

function branchLineage(branches: readonly StoryBranchId[], current: StoryBranchId): readonly StoryBranchId[] {
  return [...new Set([...branches, current])]
}
