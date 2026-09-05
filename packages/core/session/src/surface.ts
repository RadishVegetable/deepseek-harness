/**
 * Surface layer on top of the session event log: an ordered view of events
 * that produce LLM messages. The append-only log remains the source of truth.
 *
 * Browser-safe: web clients consume this subpath export, so it must stay free
 * of `node:` imports (they break the vite bundle).
 *
 * @module @deepseek-ai/dsh-session/surface
 */

import type { Message } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SurfaceEvent, SurfaceEventType, SurfaceIntent, SurfaceOp } from './types.ts'

/** Runtime counterpart of the message-producing event union. */
const SURFACE_EVENT_TYPES = new Set<string>([
  'user/message',
  'assistant/message',
  'tool/result',
])

/**
 * Whether an event type can join the model-visible surface.
 * @param type - event type to test.
 * @returns true for one of the three message-producing event types.
 */
export function isSurfaceEligibleType(type: string): boolean {
  return SURFACE_EVENT_TYPES.has(type)
}

/**
 * Narrow an event to a surface-eligible event carrying its required marker.
 * @param event - event to test.
 * @returns true when both the type and marker identify a surface event.
 */
export function isSurfaceEvent(event: SessionEvent): event is SurfaceEvent {
  if (!SURFACE_EVENT_TYPES.has(event.type)) return false
  return (event as SessionEvent<SurfaceEventType>).surfaceOp !== undefined
}

/**
 * Narrow an event to an append-origin surface event: one that entered the
 * surface at its own log position and was never itself a replacement copy.
 *
 * The model-visible surface deliberately shadows replaced ranges, so it is the
 * wrong source for a human transcript — a landed replacement would erase
 * conversation the user already saw. Append-origin events are that transcript's
 * durable source material; replacement copies stay model-only.
 * @param event - event to test.
 * @returns true when the event appended to the surface tail.
 */
export function isAppendSurfaceEvent(
  event: SessionEvent,
): event is SurfaceEvent & { surfaceOp: 'append' } {
  return isSurfaceEvent(event) && event.surfaceOp === 'append'
}

/**
 * Narrow an event to a surface replacement: a node that shadowed an existing
 * surface range instead of appending to the tail. The counterpart of
 * {@link isAppendSurfaceEvent} over the two {@link SurfaceOp} variants.
 * @param event - event to test.
 * @returns true when the event replaced a surface range.
 */
export function isReplacementSurfaceEvent(
  event: SessionEvent,
): event is SurfaceEvent & { surfaceOp: Extract<SurfaceOp, { op: 'replace' }> } {
  if (!isSurfaceEvent(event)) return false
  const { surfaceOp } = event
  return typeof surfaceOp === 'object'
}

/**
 * Project a single event into the LLM message it derives to, or null when it
 * produces none — a non-surface event (chunk, boundary, log-only record) or an
 * empty-content assistant/message (which exists only to host usage). This is
 * THE per-node projection rule: `Session.deriveMessages` folds it over the
 * live surface, external reconstructors and pure projections fold the same
 * function over a log prefix's surface to rebuild the exact messages any
 * request was built from. The returned message is the already frozen message
 * nested in the event wrapper and shared by delivery, durable history, and
 * model requests.
 * @param event - the event to project.
 * @returns the derived message, or null when the event produces none.
 */
export function deriveEventMessage(event: SessionEvent): Message | null {
  // Intentionally non-exhaustive: only message-producing events derive
  // history; turn/step boundaries, chunks, usage, and errors are trace/replay
  // data.
  switch (event.type) {
    // Ordinary prompts and injected context project in user role: the event's
    // model-facing content stays verbatim. Do NOT re-add per-type framing
    // (e.g. `<context>`) here: framing is caller-owned — a producer bakes it
    // into `content`, as agent-instructions does with `<system-reminder>` — or,
    // if reintroduced, must be driven by the event `meta` map and a dedicated
    // renderer, keeping this projection a verbatim pass-through. See the
    // deferred design note in
    // ../../../../.agents/notes/implemented/simplification/2026-07-20-unwrap-injected-content-envelopes.md
    case 'user/message': {
      return event.data
    }
    case 'assistant/message': {
      // Skip an empty-content assistant/message: it exists only to host a
      // max-tokens step's usage and must not inject a content-less assistant
      // turn into the provider transcript.
      if (event.data.message.content.length === 0) return null
      return event.data.message
    }
    case 'tool/result': {
      return event.data.message
    }
    default:
      // A non-surface event (boundary, chunk, log-only record) projects to
      // no message. Merge-extensible union: no assertNever here.
      return null
  }
}

/** One replacement operation observed while folding a session surface. */
export interface SurfaceFoldReplacement {
  /** Seq of the event that replaced the prior surface range. */
  seq: number
  /** Declared inclusive start seq of the replaced surface range. */
  start: number
  /** Declared inclusive end seq of the replaced surface range. */
  end: number
  /** Actual surface entries removed by the operation, in surface order. */
  shadowedSeqs: number[]
}

/** Complete result of replaying the surface operations in a session log. */
export interface SurfaceFoldResult {
  /** Current surface event sequences in model-visible order. */
  nodes: number[]
  /** Replacement operations in event order. */
  replacements: SurfaceFoldReplacement[]
}

/** Readonly live projection of the message-producing session events. */
export interface SessionSurface {
  /** Current surface event sequences in model-visible order. */
  readonly nodes: readonly number[]
  /** Monotonic count of committed positional replacements. */
  readonly replaceGeneration: number
}

/** Canonical metadata for the two log entries that make up a message edit. */
export interface SurfaceEditIntent {
  /** Original message event sequence selected by the caller. */
  readonly targetSeq: number
  /** Stable message identity retained by the replacement. */
  readonly messageId: string
  /** Role of the replacement message event. */
  readonly role: 'user' | 'assistant'
  /** Nodes invalidated by the edit transaction. */
  readonly shadowedSeqs: readonly number[]
  /** Standard surface metadata for the replacement message. */
  readonly surfaceIntent: SurfaceIntent
}

/** Mutable state shared by complete and incremental folds. */
interface SurfaceFoldState {
  nodes: number[]
  replaceGeneration: number
  /** Earlier current nodes restored when a replacement is invalidated. */
  replacementChildren: Map<number, number[]>
  /** An edit transaction awaiting its adjacent replacement message. */
  pendingEdit: SurfaceEditPlan | undefined
}

/** A validated replacement transition that has not mutated fold state yet. */
interface SurfaceReplacePlan extends SurfaceFoldReplacement {
  kind: 'replace'
  startIdx: number
  endIdx: number
}

/** One historical edit that restores a folded range and truncates its tail. */
interface SurfaceEditPlan {
  kind: 'edit'
  seq: number
  targetSeq: number
  messageId: string
  role: 'user' | 'assistant'
  containerStart: number
  prefixNodes: number[]
  shadowedSeqs: number[]
}

/** A standard replacement carrying the second half of an edit transaction. */
interface SurfaceEditReplacementPlan extends SurfaceFoldReplacement {
  kind: 'edit-replace'
  startIdx: number
  endIdx: number
  targetSeq: number
  prefixNodes: number[]
}

/** One validated surface transition that has not mutated fold state yet. */
type SurfacePlan =
  | { kind: 'append'; seq: number }
  | SurfaceReplacePlan
  | SurfaceEditPlan
  | SurfaceEditReplacementPlan

/** Create an empty surface fold state. */
function createFoldState(): SurfaceFoldState {
  return {
    nodes: [],
    replaceGeneration: 0,
    replacementChildren: new Map(),
    pendingEdit: undefined,
  }
}

/** Whether a runtime value is a non-negative safe event sequence. */
function isEventSeq(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** Whether a runtime value is the exact positional-replacement shape. */
function isReplaceOp(value: object): value is Extract<SurfaceOp, { op: 'replace' }> {
  const op = value as Record<string, unknown>
  return Object.keys(op).length === 3
    && Object.hasOwn(op, 'op')
    && Object.hasOwn(op, 'start')
    && Object.hasOwn(op, 'end')
    && op['op'] === 'replace'
    && isEventSeq(op['start'])
    && isEventSeq(op['end'])
}

/** Validate event-local surface eligibility and return its operation. */
function surfaceOpOf(event: SessionEvent): SurfaceOp | undefined {
  const raw = event as SessionEvent & { surfaceOp?: unknown; sourceEventSeqs?: unknown }
  if (!isSurfaceEligibleType(event.type)) {
    if (raw.surfaceOp !== undefined) {
      throw new Error(`session event "${event.type}" is not surface-eligible and cannot carry surfaceOp`)
    }
    if (raw.sourceEventSeqs !== undefined) {
      throw new Error(`session event "${event.type}" is not surface-eligible and cannot carry sourceEventSeqs`)
    }
    return
  }
  const op = raw.surfaceOp
  if (op === undefined) {
    throw new Error(`session event "${event.type}" is surface-eligible and requires a surfaceOp marker`)
  }
  if (op === 'append') return op
  if (op === null || typeof op !== 'object' || Array.isArray(op)) {
    throw new Error(`session event "${event.type}" carries an invalid surfaceOp`)
  }
  if (!isReplaceOp(op)) {
    throw new Error(`session event "${event.type}" carries an invalid replace surfaceOp`)
  }
  return op
}

/** Validate cited source-event seqs against prior log entries and the replacement range. */
function assertProvenance(
  event: SessionEvent,
  shadowedSeqs: readonly number[],
): void {
  const raw = (event as SessionEvent & { sourceEventSeqs?: unknown }).sourceEventSeqs
  const sources = new Set<number>()
  if (raw !== undefined) {
    if (!Array.isArray(raw)) {
      throw new Error(`sourceEventSeqs on event at seq ${event.seq} must be an array when present`)
    }
    if (raw.length === 0 && event.type !== 'assistant/message') {
      throw new Error('sourceEventSeqs must not be empty except on assistant/message')
    }
    let nonEarlierSource: number | undefined
    for (const source of raw) {
      if (!isEventSeq(source)) {
        throw new Error(`session event "${event.type}" sourceEventSeqs must densely contain non-negative safe integers`)
      }
      sources.add(source)
      if (nonEarlierSource === undefined && source >= event.seq) nonEarlierSource = source
    }
    if (sources.size !== raw.length) {
      throw new Error('sourceEventSeqs must not contain duplicates')
    }
    if (nonEarlierSource !== undefined) {
      throw new Error(`sourceEventSeqs must reference earlier events: ${nonEarlierSource} >= current seq ${event.seq}`)
    }
  }
  const missing = shadowedSeqs.filter(seq => !sources.has(seq))
  if (missing.length > 0) {
    throw new Error(`surface replace: sourceEventSeqs must include every shadowed surface node; missing ${missing.join(', ')}`)
  }
}

/** Locate one replacement range without mutating the current fold state. */
function replacementRange(
  state: SurfaceFoldState,
  op: Extract<SurfaceOp, { op: 'replace' }>,
): Pick<SurfaceReplacePlan, 'startIdx' | 'endIdx' | 'shadowedSeqs'> {
  const startIdx = state.nodes.indexOf(op.start)
  if (startIdx === -1) {
    throw new Error(`surface replace: start seq ${op.start} not found in surface`)
  }
  const endIdx = state.nodes.indexOf(op.end)
  if (endIdx === -1) {
    throw new Error(`surface replace: end seq ${op.end} not found in surface`)
  }
  if (startIdx > endIdx) {
    throw new Error(`surface replace: start seq ${op.start} (index ${startIdx}) is after end seq ${op.end} (index ${endIdx})`)
  }
  return {
    startIdx,
    endIdx,
    shadowedSeqs: state.nodes.slice(startIdx, endIdx + 1),
  }
}

/** Expand only the replacement path that contains one hidden target. */
function expandNodeForTarget(
  state: SurfaceFoldState,
  node: number,
  targetSeq: number,
): { nodes: number[]; targetIndex: number | undefined } {
  if (node === targetSeq) return { nodes: [node], targetIndex: 0 }
  const children = state.replacementChildren.get(node)
  if (children === undefined) return { nodes: [node], targetIndex: undefined }
  const nodes: number[] = []
  let targetIndex: number | undefined
  for (const child of children) {
    const expanded = expandNodeForTarget(state, child, targetSeq)
    if (targetIndex === undefined && expanded.targetIndex !== undefined) {
      targetIndex = nodes.length + expanded.targetIndex
    }
    nodes.push(...expanded.nodes)
  }
  return { nodes, targetIndex }
}

/** Plan one edit against the current surface and its replacement ancestry. */
function editSurfaceLayout(
  state: SurfaceFoldState,
  targetSeq: number,
): { targetIndex: number; containerStart: number; prefixNodes: number[]; shadowedSeqs: number[] } {
  const rebuilt: number[] = []
  let targetIndex: number | undefined
  let containerIndex = -1
  for (const [nodeIndex, node] of state.nodes.entries()) {
    const expanded = expandNodeForTarget(state, node, targetSeq)
    if (targetIndex === undefined && expanded.targetIndex !== undefined) {
      containerIndex = nodeIndex
      targetIndex = rebuilt.length + expanded.targetIndex
    }
    rebuilt.push(...expanded.nodes)
  }
  if (targetIndex === undefined || containerIndex < 0) {
    throw new Error(`message/edit target seq ${targetSeq} is not in the current surface or a folded range`)
  }
  const containerStart = state.nodes[containerIndex]
  if (containerStart === undefined) {
    throw new Error(`message/edit target seq ${targetSeq} has no containing surface node`)
  }
  const currentRemoved = state.nodes.slice(containerIndex)
  const shadowedSeqs = [...new Set([
    targetSeq,
    ...currentRemoved,
    ...rebuilt.slice(targetIndex + 1),
  ])]
  return {
    targetIndex,
    containerStart,
    prefixNodes: rebuilt.slice(0, targetIndex),
    shadowedSeqs,
  }
}

/** Plan the log-only first half of one historical message edit. */
function planMessageEdit(
  state: SurfaceFoldState,
  edit: SessionEvent<'message/edit'>,
  expectedSeq: number,
  events: readonly SessionEvent[],
  baseSeq: number,
): SurfaceEditPlan {
  if (state.pendingEdit !== undefined) {
    throw new Error(`message/edit at seq ${edit.seq} arrived before the previous edit was replaced`)
  }
  const target = events[edit.data.targetSeq - baseSeq]
  if (target === undefined || target.seq !== edit.data.targetSeq || target.seq >= expectedSeq) {
    throw new Error(`message/edit target seq ${edit.data.targetSeq} is not an earlier event`)
  }
  const targetMessage = deriveEventMessage(target)
  if (targetMessage === null || (targetMessage.role !== 'user' && targetMessage.role !== 'assistant')) {
    throw new Error(`message/edit target seq ${edit.data.targetSeq} is not an editable message`)
  }
  if (edit.data.messageId !== targetMessage.id) {
    throw new Error(`message/edit target seq ${edit.data.targetSeq} must retain its message identity and role`)
  }

  const layout = editSurfaceLayout(state, edit.data.targetSeq)
  const { prefixNodes, shadowedSeqs } = layout
  if (edit.data.shadowedSeqs.length !== shadowedSeqs.length
    || edit.data.shadowedSeqs.some((seq, index) => seq !== shadowedSeqs[index])) {
    throw new Error(`message/edit target seq ${edit.data.targetSeq} has stale shadowedSeqs`)
  }
  return {
    kind: 'edit',
    seq: edit.seq,
    targetSeq: edit.data.targetSeq,
    messageId: targetMessage.id,
    role: targetMessage.role,
    containerStart: layout.containerStart,
    prefixNodes,
    shadowedSeqs,
  }
}

/** Plan the standard message replacement paired with a pending edit marker. */
function planEditedReplacement(
  state: SurfaceFoldState,
  event: SurfaceEvent,
  op: Extract<SurfaceOp, { op: 'replace' }>,
): SurfaceEditReplacementPlan {
  const pending = state.pendingEdit
  if (pending === undefined) throw new Error('internal surface error: missing pending edit')
  const replacementMessage = event.type === 'user/message' ? event.data : event.data.message
  if (event.type !== `${pending.role}/message` || replacementMessage.id !== pending.messageId) {
    throw new Error(`message/edit at seq ${pending.seq} must be followed by a ${pending.role}/message replacement with id ${pending.messageId}`)
  }
  if (op.start !== pending.containerStart || op.end !== pending.containerStart) {
    throw new Error(`message/edit target seq ${pending.targetSeq} has an invalid replacement range`)
  }
  const range = replacementRange(state, op)
  assertProvenance(event, pending.shadowedSeqs)
  return {
    kind: 'edit-replace',
    seq: event.seq,
    start: op.start,
    end: op.end,
    startIdx: range.startIdx,
    endIdx: range.endIdx,
    targetSeq: pending.targetSeq,
    prefixNodes: pending.prefixNodes,
    shadowedSeqs: range.shadowedSeqs,
  }
}

/**
 * Deep structural equality over the session-event JSON value domain
 * (null/boolean/number/string, arrays, plain objects). Replaces
 * `node:util`'s isDeepStrictEqual to keep this module browser-safe.
 */
function isDeepEqualJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, i) => isDeepEqualJson(item, b[i]))
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  const aKeys = Object.keys(a)
  const bRecord = b as Record<string, unknown>
  if (aKeys.length !== Object.keys(b).length) return false
  return aKeys.every(key => Object.hasOwn(b, key) && isDeepEqualJson((a as Record<string, unknown>)[key], bRecord[key]))
}

/** Restrict a tool-result replacement to one current result's content. */
function assertToolResultRewrite(
  event: SessionEvent,
  shadowedSeqs: readonly number[],
  events: readonly SessionEvent[],
  baseSeq: number,
): void {
  if (event.type !== 'tool/result') return
  if (shadowedSeqs.length !== 1) {
    throw new Error('tool/result surface replacement must rewrite exactly one current node')
  }
  for (const originalSeq of shadowedSeqs) {
    const original = events[originalSeq - baseSeq]
    if (original?.type !== 'tool/result') {
      throw new Error('tool/result surface replacement must target a current tool/result')
    }
    const originalRest = { ...original.data } as Record<string, unknown>
    const replacementRest = { ...event.data } as Record<string, unknown>
    const originalResult = original.data.message.content[0]
    const replacementResult = event.data.message.content[0]
    originalRest['message'] = {
      ...original.data.message,
      content: [{ ...originalResult, content: null }],
    }
    replacementRest['message'] = {
      ...event.data.message,
      content: [{ ...replacementResult, content: null }],
    }
    if (!isDeepEqualJson(originalRest, replacementRest)) {
      throw new Error('tool/result surface replacement may change only content')
    }
  }
}

/** Validate one event at its replay boundary and prepare its atomic fold transition. */
function planSurfaceEvent(
  state: SurfaceFoldState,
  event: SessionEvent,
  expectedSeq: number,
  events: readonly SessionEvent[],
  baseSeq: number,
): SurfacePlan | undefined {
  if (event.seq !== expectedSeq) {
    throw new Error(`session event seq ${event.seq} is not contiguous; expected ${expectedSeq}`)
  }
  const surfaceOp = surfaceOpOf(event)
  if (event.type === 'message/edit') {
    if (surfaceOp !== undefined) throw new Error('message/edit cannot carry surface metadata')
    return planMessageEdit(state, event, expectedSeq, events, baseSeq)
  }
  if (state.pendingEdit !== undefined) {
    if (surfaceOp === undefined || surfaceOp === 'append') {
      throw new Error(`message/edit at seq ${state.pendingEdit.seq} must be followed by its replacement message`)
    }
    if (event.type !== 'user/message' && event.type !== 'assistant/message') {
      throw new Error(`message/edit at seq ${state.pendingEdit.seq} must be followed by a user/message or assistant/message`)
    }
    return planEditedReplacement(state, event as SurfaceEvent, surfaceOp)
  }
  if (surfaceOp === undefined) return
  if (surfaceOp === 'append') {
    assertProvenance(event, [])
    return { kind: 'append', seq: event.seq }
  }
  const range = replacementRange(state, surfaceOp)
  assertProvenance(event, range.shadowedSeqs)
  assertToolResultRewrite(event, range.shadowedSeqs, events, baseSeq)
  return {
    kind: 'replace',
    seq: event.seq,
    start: surfaceOp.start,
    end: surfaceOp.end,
    ...range,
  }
}

/** Apply one event and return replacement metadata only when one occurred. */
function applySurfaceEvent(
  state: SurfaceFoldState,
  event: SessionEvent,
  expectedSeq: number,
  events: readonly SessionEvent[],
  baseSeq: number,
): SurfaceFoldReplacement | undefined {
  const plan = planSurfaceEvent(state, event, expectedSeq, events, baseSeq)
  return applySurfacePlan(state, plan)
}

/** Commit one previously validated surface transition. */
function applySurfacePlan(
  state: SurfaceFoldState,
  plan: SurfacePlan | undefined,
): SurfaceFoldReplacement | undefined {
  if (plan?.kind === 'append') {
    state.nodes.push(plan.seq)
  } else if (plan?.kind === 'replace') {
    state.nodes.splice(plan.startIdx, plan.endIdx - plan.startIdx + 1, plan.seq)
    state.replaceGeneration += 1
    state.replacementChildren.set(plan.seq, [...plan.shadowedSeqs])
  } else if (plan?.kind === 'edit') {
    state.pendingEdit = plan
  } else if (plan?.kind === 'edit-replace') {
    state.nodes = [...plan.prefixNodes, plan.seq]
    state.replaceGeneration += 1
    // The prefix remains as independent current nodes. Keeping it in the
    // replacement ancestry as well would expand it twice on a later edit.
    state.replacementChildren.set(plan.seq, [plan.targetSeq])
    state.pendingEdit = undefined
  }
  if (plan?.kind !== 'replace' && plan?.kind !== 'edit-replace') return
  return {
    seq: plan.seq,
    start: plan.start,
    end: plan.end,
    shadowedSeqs: plan.shadowedSeqs,
  }
}

/**
 * Replay a complete session log through the canonical surface fold.
 * @param events - session events in contiguous seq order.
 * @returns detached current sequences and replacement history.
 * @throws when an event violates surface metadata, source-event references, range, or tool-result rewrite rules.
 */
export function foldSurface(events: readonly SessionEvent[]): SurfaceFoldResult {
  const state = createFoldState()
  const replacements: SurfaceFoldReplacement[] = []
  for (const [index, event] of events.entries()) {
    const replacement = applySurfaceEvent(state, event, index, events, 0)
    if (replacement !== undefined) replacements.push(replacement)
  }
  if (state.pendingEdit !== undefined) {
    throw new Error(`message/edit at seq ${state.pendingEdit.seq} has no replacement message`)
  }
  return { nodes: [...state.nodes], replacements }
}

/** Incremental ordered surface view and append-boundary validator. */
export class SurfaceManager implements SessionSurface {
  /** Shared transition state; replacement history is not retained. */
  private _state = createFoldState()
  /** Last processed absolute seq. */
  private _lastProcessedSeq: number
  /** Candidate already validated by `validateNext`, pending exact log admission. */
  private _pendingPlan: { event: SessionEvent; expectedSeq: number; plan: SurfacePlan | undefined } | undefined

  /**
   * @param log - Contiguous complete log or loaded event window.
   * @param baseSeq - Absolute sequence of the window's first event.
   */
  constructor(
    private log: readonly SessionEvent[],
    private readonly baseSeq = 0,
  ) {
    this._lastProcessedSeq = baseSeq - 1
  }

  /**
   * Validate the next candidate without mutating the committed surface.
   * @param event - candidate event that has not entered the log yet.
   */
  validateNext(event: SessionEvent): void {
    if (this._lastProcessedSeq < this.baseSeq + this.log.length - 1) this._processDelta()
    const expectedSeq = this.baseSeq + this.log.length
    this._pendingPlan = {
      event,
      expectedSeq,
      plan: planSurfaceEvent(this._state, event, expectedSeq, this.log, this.baseSeq),
    }
  }

  /** Monotonic count of folded positional replacements. */
  get replaceGeneration(): number {
    if (this._lastProcessedSeq < this.baseSeq + this.log.length - 1) this._processDelta()
    if (this._state.pendingEdit !== undefined) {
      throw new Error(`message/edit at seq ${this._state.pendingEdit.seq} has no replacement message`)
    }
    return this._state.replaceGeneration
  }

  /** Surface event sequences in model-visible order. */
  get nodes(): readonly number[] {
    if (this._lastProcessedSeq < this.baseSeq + this.log.length - 1) this._processDelta()
    if (this._state.pendingEdit !== undefined) {
      throw new Error(`message/edit at seq ${this._state.pendingEdit.seq} has no replacement message`)
    }
    return this._state.nodes
  }

  /**
   * Build the canonical metadata for both entries in one historical edit.
   * @param targetSeq - earlier message event being edited.
   * @returns transaction data and the standard replacement intent.
   */
  editIntent(targetSeq: number): SurfaceEditIntent {
    if (this._lastProcessedSeq < this.baseSeq + this.log.length - 1) this._processDelta()
    if (this._state.pendingEdit !== undefined) {
      throw new Error(`message/edit at seq ${this._state.pendingEdit.seq} has no replacement message`)
    }
    const target = this.log[targetSeq - this.baseSeq]
    const targetMessage = target === undefined ? null : deriveEventMessage(target)
    if (targetMessage === null || (targetMessage.role !== 'user' && targetMessage.role !== 'assistant')) {
      throw new Error(`message/edit target seq ${targetSeq} is not an editable message`)
    }
    const layout = editSurfaceLayout(this._state, targetSeq)
    return {
      targetSeq,
      messageId: targetMessage.id,
      role: targetMessage.role,
      shadowedSeqs: layout.shadowedSeqs,
      surfaceIntent: {
        surfaceOp: { op: 'replace', start: layout.containerStart, end: layout.containerStart },
        sourceEventSeqs: layout.shadowedSeqs,
      },
    }
  }

  /** Fold events appended since the previous access. */
  private _processDelta(): void {
    const tailSeq = this.baseSeq + this.log.length - 1
    for (let seq = this._lastProcessedSeq + 1; seq <= tailSeq; seq++) {
      const index = seq - this.baseSeq
      // oxlint-disable-next-line typescript/no-non-null-assertion -- bounded by the loop condition
      const event = this.log[index]!
      const pending = this._pendingPlan
      if (pending?.event === event && pending.expectedSeq === seq) {
        applySurfacePlan(this._state, pending.plan)
      } else {
        applySurfaceEvent(this._state, event, seq, this.log, this.baseSeq)
      }
      if (pending !== undefined && pending.expectedSeq <= seq) this._pendingPlan = undefined
      this._lastProcessedSeq = seq
    }
  }
}
