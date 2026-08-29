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
import type { TavernGreetingEvent, TavernMemoryEntry, TavernStoryStateEvent } from './types.ts'

/** Durable selection payload written before a Tavern prompt can change. */
export interface TavernAssetsSelectedEvent {
  readonly selection: AssetSelection
  readonly baseline: PromptAssetBaseline
  readonly characterName: string | null
  readonly worldInfoNames: readonly string[]
}

/** Durable opening greeting selected from a Character Card for one Session. */
/** Durable activation payload written before a matched context snapshot is used. */
export interface TavernContextActivationEvent {
  readonly fingerprint: string
  readonly selection: AssetSelection
  readonly query: string
  readonly observer: Observer
  readonly branch: string
  readonly compiled: CompiledContext<PromptWorldInfoEntry>
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** The character and World Info baseline selected for later turns. */
    'tavern/assets-selected': TavernAssetsSelectedEvent
    /** The World Info compiler decision used for one model-visible snapshot. */
    'tavern/context-activation': TavernContextActivationEvent
    /** A durable memory entry update used by the Tavern context projection. */
    'tavern/memory': import('./types.ts').TavernMemoryEvent
    /** A durable canonical story-state change used by the Tavern context projection. */
    'tavern/story-state': TavernStoryStateEvent
  }
}

/**
 * Read the latest selected Tavern baseline in one session log.
 * @param session - Session event sequence to inspect.
 * @returns The latest selection event, or undefined when none is recorded.
 */
export function resolveTavernSelection(session: Pick<Session, 'events'>): TavernAssetsSelectedEvent | undefined {
  for (let index = session.events.length - 1; index >= 0; index -= 1) {
    const event = session.events[index]
    if (event?.type === 'tavern/assets-selected') return event.data
  }
  return undefined
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
 * Read the latest enabled memory values in event order.
 * @param session - Session event sequence to inspect.
 * @returns Enabled memory entries in their durable insertion order.
 */
export function resolveTavernMemory(session: Pick<Session, 'events'>): readonly TavernMemoryEntry[] {
  const entries = new Map<string, TavernMemoryEntry>()
  for (const event of session.events) {
    if (event.type !== 'tavern/memory') continue
    if (event.data.operation === 'remove') entries.delete(event.data.memory.id)
    else entries.set(event.data.memory.id, event.data.memory)
  }
  return [...entries.values()].filter(entry => entry.enabled).map(entry => structuredClone(entry))
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
  session.append('tavern/swipe', {
    kind: 'candidate.add',
    branch: String(session.id),
    groupId,
    candidate,
    authority: { kind: 'model-candidate', extensions: {} },
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
