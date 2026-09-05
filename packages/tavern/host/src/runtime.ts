/** Per-agent Tavern persona and World Info context projection. */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CompactionEngine } from '@deepseek-ai/dsh-compaction'
import { BlockAssembler, createUserMessage, freezeMessage } from '@deepseek-ai/dsh-llm'
import type { ContextSnapshotSection } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'
import { createHash } from 'node:crypto'
import type { JobHooks } from '@deepseek-ai/dsh-jobs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock, FinishReason, GenerateOptions } from '@deepseek-ai/dsh-llm'
import { joinContextSections, PERSONA_ORDER, PERSONA_SECTION } from '@deepseek-ai/dsh-system-prompt'
import { renderTavernMacros } from '@deepseek-ai/dsh-tavern-compat'
import { compileContext } from '@deepseek-ai/dsh-tavern-context'
import { slug } from '@deepseek-ai/dsh-tavern-shared'
import { compactPublicState, renderCompactPublicState } from '@deepseek-ai/dsh-tavern-state'
import {
  appendMemoryInjectionSnapshot,
  buildMemoryExtractionPrompt,
  createMemoryExtractionId,
  DEFAULT_MEMORY_CONFIG,
  flattenMemoryProjection,
  ingestMemoryExtraction,
  MemoryExtractionScheduler,
  MemoryIndex,
  parseMemoryExtractionOutputStrict,
  projectMemoryFacts,
  renderMemoryInjection,
  resolveMemoryConfig,
} from '@deepseek-ai/dsh-tavern-memory'
import type {
  MemoryFactEvent,
  MemoryFactRecord,
  MemoryConfig,
  MemoryRosterEntry,
} from '@deepseek-ai/dsh-tavern-memory'
import type {
  CompiledContext,
  ContextSourceRecord,
  Observer,
  NormalizedWorldInfoEntry,
} from '@deepseek-ai/dsh-tavern-context/types'
import type {
  PromptAssetBaseline,
  PromptWorldInfoEntry,
} from '@deepseek-ai/dsh-tavern-assets/types'
import {
  appendTavernAssistantCandidate,
  resolveTavernGreeting,
  resolveTavernContextActivation,
  resolveTavernSelection,
  resolveTavernSelectionAt,
  resolveTavernStoryState,
} from './session.ts'
import { applyTavernGmResponse, factIsVisibleInSession, renderHardFactConstraints, resolveTavernFacts, revertFactsFrom } from './facts.ts'
import { parseTavernGmResponse } from './gm-output.ts'
import type {
  TavernJourneySelection,
} from './types.ts'

const SYSTEM_PROMPT_PLUGIN = '@deepseek-ai/dsh-system-prompt'
const TAVERN_CONTEXT_SECTION = 'tavern:world-info'
const TAVERN_MEMORY_SECTION = 'tavern:memory'

declare module '@deepseek-ai/dsh-jobs' {
  interface JobKindMap {
    'memory-extraction': 'memory-extraction'
    'memory-compaction': 'memory-compaction'
  }
}

type SystemPromptSnapshotMessage = UserMessage & {
  readonly source: {
    readonly kind: 'plugin'
    readonly plugin: typeof SYSTEM_PROMPT_PLUGIN
    readonly form: 'snapshot'
    readonly sections: readonly ContextSnapshotSection[]
  }
}

const contextFingerprints = new WeakMap<Session, string>()
const memoryContextFingerprints = new WeakMap<Session, string>()
const handledMessageEdits = new WeakMap<Session, Set<number>>()
const ignoredMessageEditTargets = new WeakMap<Session, Set<number>>()
const memoryExtractionScheduler = new MemoryExtractionScheduler()

const GM_PROTOCOL = [
  'Act as the GM for this story and write the complete continuation as natural prose.',
  'Do not wrap the continuation in JSON and do not emit a separate facts or updates envelope.',
  'Include narration, dialogue, and actions in the continuation. Follow the selected character and world settings.',
  'Durable facts are extracted from this prose by a separate background memory pass; do not explain or announce that pass.',
].join('\n')

/**
 * Install the selected persona and source-tracked World Info projection for one agent.
 * @param agent - Agent receiving the Tavern prompt sections and lifecycle listener.
 * @param resolveSelection - Resolver for the selection visible to this agent.
 * @param memoryConfig - Validated Journey memory scheduling policy.
 * @returns A disposer for all installed effects.
 */
export function installTavernAgent(
  agent: Agent,
  resolveSelection: (session: Session) => TavernJourneySelection | undefined = runtimeSelection,
  memoryConfig: MemoryConfig = DEFAULT_MEMORY_CONFIG,
): () => void {
  const resolvedMemoryConfig = resolveMemoryConfig(memoryConfig)
  seedContextFingerprint(agent.session)
  const disposePersona = agent.ctx.systemPrompt.section({
    name: PERSONA_SECTION,
    order: PERSONA_ORDER,
    complete: true,
    text: () => renderTavernPersona(agent.session, resolveSelection(agent.session)),
  })
  const disposeContext = agent.ctx.systemPrompt.context({
    name: TAVERN_CONTEXT_SECTION,
    order: 100,
    text: () => {
      const selection = resolveSelection(agent.session)
      if (selection === undefined) {
        return ''
      }
      const compiled = compileTavernContext(
        agent.session,
        selection.baseline,
        queryForSession(agent.session, selection.baseline),
        selection.playerIdentity,
      )
      return renderContext(compiled, journeyCharacterName(agent.session, selection))
    },
  })
  const disposeFactSearch = installFactSearchTool(agent)
  const disposeProtocol = agent.ctx.systemPrompt.section({
    name: 'tavern:gm-protocol',
    order: 10,
    text: GM_PROTOCOL,
  })
  const disposePreStep = agent.ctx.on('agent/pre-step', async ({ messages }, next) => {
    const decision = await next()
    const selection = resolveSelection(agent.session)
    if (selection !== undefined && decision.kind === 'enter') {
      const query = queryForSession(agent.session, selection.baseline, messages)
      const compiled = compileTavernContext(
        agent.session,
        selection.baseline,
        query,
        selection.playerIdentity,
      )
      const modelCompiled = compileTavernContext(
        agent.session,
        selection.baseline,
        query,
        selection.playerIdentity,
        { includeJourneyFacts: false },
      )
      const fingerprint = contextFingerprint(selection.selection, query, compiled)
      if (fingerprint !== contextFingerprints.get(agent.session)) {
        contextFingerprints.set(agent.session, fingerprint)
        agent.session.append('tavern/context-activation', {
          selection: selection.selection,
          query,
          observer: observerFor(selection.baseline),
          branch: String(agent.session.id),
          compiled,
        })
      }
      const memorySnapshot = renderJourneyMemory(agent.session)
      if (memorySnapshot.fingerprint !== memoryContextFingerprints.get(agent.session)) {
        memoryContextFingerprints.set(agent.session, memorySnapshot.fingerprint)
        appendMemoryInjectionSnapshot(agent.session, String(agent.session.id), memorySnapshot)
      }
      const text = renderContext(modelCompiled, journeyCharacterName(agent.session, selection))
      if (text.length > 0 || memorySnapshot.content.length > 0) {
        const sections = replaceTavernContextSection(decision.messages, text, memorySnapshot.content)
        return {
          ...decision,
          messages: [
            ...decision.messages.filter(message => !isRuntimeContextMessage(message)),
            createTavernContextMessage(sections),
          ],
        }
      }
      return {
        ...decision,
        messages: clearTavernContextSection(decision.messages),
      }
    }
    return decision
  })
  const disposeFacts = agent.ctx.on('agent/turn-stopping', ({ turn }) => {
    applyLatestGmResponse(agent, turn)
  })
  const disposeSwipe = agent.ctx.on('agent/turn-stopping', ({ turn }) => {
    appendTavernAssistantCandidate(agent.session, turn)
  })
  const disposeExtraction = agent.ctx.on('agent/turn-stopping', ({ turn }) => {
    scheduleMemoryExtraction(agent, turn, resolvedMemoryConfig)
  })
  const disposeCompaction = installCompactionScheduling(agent)
  const disposeMessageEdits = agent.ctx.on('session/event', (session: Session, event: SessionEvent) => {
    if (session !== agent.session || event.type !== 'message/edit') return
    const ignored = ignoredMessageEditTargets.get(session)
    if (ignored?.delete(event.data.targetSeq)) return
    queueMicrotask(() => {
      reconcileTavernMessageEdit(agent, event)
    })
  })
  recoverTavernFacts(agent)
  return () => {
    disposeMessageEdits()
    disposeSwipe()
    disposeFacts()
    disposeExtraction()
    disposeCompaction()
    disposeFactSearch?.()
    disposePreStep()
    disposeContext()
    disposeProtocol()
    disposePersona()
  }
}

function runtimeSelection(session: Session): TavernJourneySelection | undefined {
  const event = resolveTavernSelection(session)
  if (event === undefined) return undefined
  if (event.baseline !== undefined
    && event.character !== undefined
    && event.worldInfo !== undefined
    && event.characterName !== undefined
    && event.worldInfoNames !== undefined) {
    return {
      selection: structuredClone(event.selection),
      baseline: structuredClone(event.baseline),
      character: event.character === null ? null : structuredClone(event.character),
      worldInfo: event.worldInfo.map(asset => structuredClone(asset)),
      characterName: event.characterName,
      worldInfoNames: [...event.worldInfoNames],
      ...(event.playerIdentity === undefined ? {} : { playerIdentity: event.playerIdentity }),
    }
  }
  return {
    selection: structuredClone(event.selection),
    baseline: {
      selection: structuredClone(event.selection),
      references: [],
      characterSections: [],
      worldInfoEntries: [],
    },
    character: null,
    worldInfo: [],
    characterName: event.characterName ?? null,
    worldInfoNames: event.worldInfoNames === undefined ? [] : [...event.worldInfoNames],
    ...(event.playerIdentity === undefined ? {} : { playerIdentity: event.playerIdentity }),
  }
}

/** Parse and persist the completed GM response without issuing another model call. */
function applyLatestGmResponse(agent: Agent, turn: number): void {
  const assistant = [...agent.session.events].reverse().find(event =>
    event.type === 'assistant/message' && event.data.turn === turn)
  if (assistant?.type !== 'assistant/message') return
  applyAssistantGmResponse(agent, assistant)
}

/**
 * Recover fact events for assistant messages written before a runtime reload.
 * @param agent - Agent whose session log may contain unprojected GM responses.
 */
export function recoverTavernFacts(agent: Agent): void {
  for (const event of agent.session.events) {
    if (event.type === 'message/edit' && !isInternalAssistantProjection(agent.session, event)) {
      reconcileTavernMessageEdit(agent, event)
    }
  }
  const appliedAssistantSeqs = new Set(agent.session.events
    .filter(event => event.type === 'tavern/fact')
    .map(event => event.data.assistantSeq))
  const persistedResponses = new Map(agent.session.events
    .filter((event): event is import('@deepseek-ai/dsh-session/types').SessionEvent<'tavern/gm-response'> => event.type === 'tavern/gm-response')
    .map(event => [event.data.assistantSeq, event.data] as const))
  const selectionByAssistantSeq = selectionIndex(agent.session.events)
  for (const event of agent.session.events) {
    if (event.type !== 'assistant/message' || appliedAssistantSeqs.has(event.seq)) continue
    const persisted = persistedResponses.get(event.seq)
    const selection = selectionByAssistantSeq.get(event.seq) ?? null
    if (persisted === undefined) applyAssistantGmResponse(agent, event, selection)
    else applyPersistedAssistantGmResponse(agent, event, persisted.response, selection)
  }
}

function isInternalAssistantProjection(
  session: Session,
  edit: SessionEvent<'message/edit'>,
): boolean {
  const target = session.events[edit.data.targetSeq]
  if (target?.type !== 'assistant/message') return false
  const replacement = session.events.find(event =>
    event.seq > edit.seq
    && event.type === 'assistant/message'
    && event.data.message.id === edit.data.messageId)
  if (replacement?.type !== 'assistant/message') return false
  const response = session.events.find(event =>
    event.type === 'tavern/gm-response'
    && event.data.assistantSeq === target.seq)
  return response?.type === 'tavern/gm-response'
    && messageText(replacement.data.message) === response.data.response.story
}

/**
 * Reconcile the append-only fact stream after a historical message edit.
 * User-message edits invalidate downstream facts; assistant-message edits also
 * parse the replacement response once the paired surface event is present.
 * @param agent - Agent whose session owns the edit and fact stream.
 * @param edit - Durable message edit event to reconcile.
 */
export function reconcileTavernMessageEdit(agent: Agent, edit: SessionEvent<'message/edit'>): void {
  if (!isEditableTavernMessage(agent.session, edit.data.targetSeq)) return
  const handled = handledMessageEdits.get(agent.session) ?? new Set<number>()
  if (handled.has(edit.seq)) return
  handled.add(edit.seq)
  handledMessageEdits.set(agent.session, handled)
  appendFactReverts(agent.session, edit.data.targetSeq)
  const replacement = agent.session.events.find(event =>
    event.seq > edit.seq
    && event.type === 'assistant/message'
    && event.data.message.id === edit.data.messageId)
  if (replacement?.type === 'assistant/message' && messageText(replacement.data.message).trim().length > 0) {
    applyAssistantGmResponse(agent, replacement)
  }
}

/**
 * Revert facts explicitly derived from a deleted assistant message.
 * @param agent - Agent whose session owns the fact stream.
 * @param assistantSeq - Assistant message sequence whose derived facts are reverted.
 * @returns Nothing; append-only invalidation events are added to the session.
 */
export function revertTavernFactsFromMessage(agent: Agent, assistantSeq: number): void {
  appendFactReverts(agent.session, assistantSeq)
}

function isEditableTavernMessage(session: Pick<Session, 'events'>, targetSeq: number): boolean {
  const target = session.events[targetSeq]
  return target?.type === 'assistant/message'
    || (target?.type === 'user/message' && target.data.source.kind === 'user')
}

function appendFactReverts(session: Session, assistantSeq: number): void {
  const branch = String(session.id)
  const records = session.events
    .filter((event): event is SessionEvent<'tavern/fact'> => event.type === 'tavern/fact' && event.data.branch === branch)
    .map(event => ({ seq: event.seq, data: event.data }))
  const latestByFactId = new Map<string, { readonly seq: number; readonly data: import('./types.ts').TavernFactEvent }>()
  for (const record of records) {
    if (record.data.factId !== undefined) latestByFactId.set(record.data.factId, record)
  }
  const appendedFactIds = new Set<string>()
  for (const data of revertFactsFrom(records, assistantSeq, { branch })) {
    if (data.factId === undefined || appendedFactIds.has(data.factId)) continue
    const latest = latestByFactId.get(data.factId)
    if (latest?.data.operation === 'remove') continue
    const event = session.append('tavern/fact', { ...data, branch })
    records.push({ seq: event.seq, data: event.data })
    latestByFactId.set(data.factId, { seq: event.seq, data: event.data })
    appendedFactIds.add(data.factId)
  }
}

function applyAssistantGmResponse(
  agent: Agent,
  assistant: Extract<import('@deepseek-ai/dsh-session/types').SessionEvent, { type: 'assistant/message' }>,
  selectionOverride?: import('./session.ts').TavernAssetsSelectedEvent | null,
): void {
  const raw = messageText(assistant.data.message)
  const parsed = parseTavernGmResponse(raw)
  appendGmResponseEvent(agent.session, assistant.seq, assistant.data.turn, parsed.response)
  const selection = selectionOverride === undefined ? selectionAt(agent.session, assistant.seq) : selectionOverride
  applyTavernGmResponse(agent.session, parsed.response, assistant.seq, assistant.data.turn, selection?.baseline)
  if (parsed.structured && parsed.response.story !== raw) {
    const ignored = ignoredMessageEditTargets.get(agent.session) ?? new Set<number>()
    ignored.add(assistant.seq)
    ignoredMessageEditTargets.set(agent.session, ignored)
    agent.session.editMessage(assistant.seq, freezeMessage({
      ...assistant.data.message,
      content: [{ type: 'text', text: parsed.response.story }],
    }))
  }
}

function applyPersistedAssistantGmResponse(
  agent: Agent,
  assistant: Extract<import('@deepseek-ai/dsh-session/types').SessionEvent, { type: 'assistant/message' }>,
  response: import('./types.ts').TavernGmResponse,
  selectionOverride?: import('./session.ts').TavernAssetsSelectedEvent | null,
): void {
  const selection = selectionOverride === undefined ? selectionAt(agent.session, assistant.seq) : selectionOverride
  applyTavernGmResponse(agent.session, response, assistant.seq, assistant.data.turn, selection?.baseline)
}

function seedContextFingerprint(session: Session): void {
  const activation = resolveTavernContextActivation(session)
  if (activation !== undefined) {
    contextFingerprints.set(session, contextFingerprint(activation.selection, activation.query, activation.compiled))
  }
  const memory = [...session.events].reverse().find(event => event.type === 'tavern/memory-context')
  if (memory?.type === 'tavern/memory-context') memoryContextFingerprints.set(session, memory.data.fingerprint)
}

function contextFingerprint(
  selection: import('@deepseek-ai/dsh-tavern-assets/types').AssetSelection,
  query: string,
  compiled: CompiledContext<PromptWorldInfoEntry>,
): string {
  const serialized = JSON.stringify({
    selection,
    query,
    ledger: compiled.ledger,
    stable: compiled.stablePrefix.map(source => source.key),
    dynamic: compiled.dynamicSuffix.map(source => source.key),
  })
  return createHash('sha256').update(serialized).digest('hex')
}

function selectionIndex(
  events: readonly SessionEvent[],
): Map<number, import('./session.ts').TavernAssetsSelectedEvent | null> {
  const result = new Map<number, import('./session.ts').TavernAssetsSelectedEvent | null>()
  let selected: import('./session.ts').TavernAssetsSelectedEvent | undefined
  for (const event of events) {
    if (event.type === 'tavern/assets-selected') selected = event.data
    else if (event.type === 'tavern/assets-edited' && selected !== undefined) selected = event.data
    else if (event.type === 'assistant/message') result.set(event.seq, selected ?? null)
  }
  return result
}

function appendGmResponseEvent(session: Session, assistantSeq: number, turn: number, response: import('./types.ts').TavernGmResponse): void {
  const sequences = gmResponseSequences(session)
  if (sequences.has(assistantSeq)) return
  session.append('tavern/gm-response', { assistantSeq, turn, response })
  sequences.add(assistantSeq)
}

const gmResponseSequenceCache = new WeakMap<Session, Set<number>>()

function gmResponseSequences(session: Session): Set<number> {
  const cached = gmResponseSequenceCache.get(session)
  if (cached !== undefined) return cached
  const sequences = new Set(session.events
    .filter((event): event is SessionEvent<'tavern/gm-response'> => event.type === 'tavern/gm-response')
    .map(event => event.data.assistantSeq))
  gmResponseSequenceCache.set(session, sequences)
  return sequences
}

/**
 * Render the current Character Card persona and durable opening greeting.
 * @param session - Session whose selected baseline and greeting events are projected.
 * @param selected - Optional selection snapshot to render instead of resolving it.
 * @returns The persona text for the current Tavern selection.
 */
export function renderTavernPersona(session: Session, selected = runtimeSelection(session)): string {
  const selection = selected
  if (selection === undefined) return ''
  const sections = selection.baseline.characterSections.filter(section =>
    section.field !== 'first-message' && section.field !== 'alternate-greeting')
  const title = journeyCharacterName(session, selection)
  const greeting = resolveTavernGreeting(session)
  const legacyGreeting = greeting === undefined && session.deriveMessages().length === 0
    ? selection.baseline.characterSections.find(section => section.field === 'first-message')
    : undefined
  if (sections.length === 0 && greeting === undefined && legacyGreeting === undefined) return ''
  return [
    ...sections.map(section => renderTavernMarkup(section.text, title)),
    ...[greeting?.text ?? legacyGreeting?.text]
      .filter((text): text is string => text !== undefined)
      .map(text => renderTavernMarkup(text, title)),
  ].filter(Boolean).join('\n\n')
}

/**
 * Compile World Info and Journey facts against the current prompt window.
 * @param session - Session whose facts, story state, and selection metadata are projected.
 * @param baseline - Selected immutable Character Card and World Book baseline.
 * @param query - Prompt-window text supplied to World Info matching.
 * @param playerIdentity - Optional player identity included in stable context.
 * @param options - Whether the dynamic Journey fact sources are included.
 * @returns Source-tracked compiled context for the next model request.
 */
export function compileTavernContext(
  session: Session,
  baseline: PromptAssetBaseline,
  query: string,
  playerIdentity?: string | null,
  options: { readonly includeJourneyFacts?: boolean } = {},
): CompiledContext<PromptWorldInfoEntry> {
  const budget = contextBudget(baseline)
  const entries: NormalizedWorldInfoEntry<PromptWorldInfoEntry>[] = baseline.worldInfoEntries.map(entry => ({
    source: sourceFor(session, entry),
    keys: entry.keys,
    secondaryKeys: entry.secondaryKeys,
    selective: entry.selective,
    constant: entry.constant,
    useRegex: entry.useRegex,
    matchWholeWords: entry.matchWholeWords,
    caseSensitive: entry.caseSensitive,
    // Intermediate probability activation is deferred until it has a durable
    // policy. Query-derived pseudo-randomness would make replay misleading.
    useProbability: false,
    probability: 100,
    depth: entry.depth,
    group: entry.group,
    sticky: entry.sticky,
    cooldown: entry.cooldown,
  }))
  return compileContext({
    observer: observerFor(baseline),
    branch: String(session.id),
    sources: [
      ...playerIdentitySource(playerIdentity),
      ...hardFactConstraintSource(session),
      ...(options.includeJourneyFacts === false ? [] : factSources(session)),
      ...storyStateSources(session),
    ],
    worldInfo: {
      text: query,
      entries,
    },
    ...(budget === undefined ? {} : { budget }),
  })
}

/** Schedule automatic compaction before each admitted agent step when a provider is mounted. */
function installCompactionScheduling(agent: Agent): () => void {
  const compaction: CompactionEngine | undefined = agent.ctx.get('compaction')
  if (compaction === undefined) return () => {}
  return agent.ctx.on('agent/pre-step', async ({ signal }, next) => {
    if (!signal.aborted) {
      try {
        await compaction.compactIfNeeded(agent, 'pressure', signal)
      } catch (error: unknown) {
        agent.ctx.logger.warn(`Tavern compaction failed: ${String(error)}`)
      }
    }
    return next()
  })
}

/** Project the player identity into the same prompt source stream as other Journey facts. */
function playerIdentitySource(playerIdentity: string | null | undefined): readonly ContextSourceRecord<PromptWorldInfoEntry>[] {
  const identity = playerIdentity?.trim()
  if (identity === undefined || identity.length === 0) return []
  return [{
    key: 'tavern:player-identity',
    text: `Player identity: ${identity}`,
    stability: 'stable',
    observer: { kind: 'all' },
    visibility: 'public',
    authority: 'public',
    branch: { kind: 'all' },
    validity: { status: 'valid' },
    provenance: { kind: 'tavern-player-identity', id: 'player' },
    priority: 35,
  }]
}

/** Render active Journey facts as source-tracked direct context records. */
function factSources(session: Session): readonly ContextSourceRecord<PromptWorldInfoEntry>[] {
  const projection = resolveTavernFacts(session)
  const people = Object.entries(projection.people).flatMap(([personId, facts]) => facts.map(fact => ({ personId, fact })))
  return [
    ...people.map(({ personId, fact }) => factSource(JSON.stringify(['person', personId, String(fact.factId)]), fact, personId)),
    ...projection.world.map(fact => factSource(JSON.stringify(['world', String(fact.factId)]), fact)),
  ]
}

function factSource(
  key: string,
  fact: import('./types.ts').TavernFactEntry,
  personId?: string,
): ContextSourceRecord<PromptWorldInfoEntry> {
  return {
    key: `tavern-fact:${key}`,
    text: fact.text,
    stability: 'dynamic',
    observer: { kind: 'all' },
    visibility: 'public',
    authority: 'public',
    branch: { kind: 'all' },
    validity: { status: 'valid' },
    provenance: {
      kind: 'tavern-fact',
      id: String(fact.factId),
      eventIds: [String(fact.eventSeq)],
    },
    priority: personId === undefined ? 28 : 29,
  }
}

/** Apply the smallest source World Book token budget to the compiled prompt. */
function contextBudget(baseline: PromptAssetBaseline): { maxTokens: number; tokenEstimator: (text: string) => number } | undefined {
  const budgets = baseline.worldInfoEntries
    .map(entry => entry.tokenBudget)
    .filter((value): value is number => value !== null)
  const maxTokens = budgets.length === 0 ? undefined : Math.min(...budgets)
  return maxTokens === undefined
    ? undefined
    : { maxTokens, tokenEstimator: estimateTavernTokens }
}

/** Render the current folded Journey facts as the separately logged memory section. */
function renderJourneyMemory(session: Session): ReturnType<typeof renderMemoryInjection> {
  const records = memoryFactRecords(session)
  const projection = projectMemoryFacts(records)
  const hardFactIds = flattenMemoryProjection(projection)
    .filter(fact => fact.kind === 'hard')
    .map(fact => String(fact.factId))
  return renderMemoryInjection({ projection, currentFactIds: hardFactIds })
}

/** Convert visible Host fact events into the memory package's generic records. */
function memoryFactRecords(session: Session): readonly MemoryFactRecord[] {
  return session.events
    .filter((event): event is SessionEvent<'tavern/fact'> => event.type === 'tavern/fact')
    .filter(event => factIsVisibleInSession(session, event.seq, event.data.branch))
    .map(event => ({ seq: event.seq, data: event.data as unknown as MemoryFactEvent }))
}

/** Install the read-only `fact_search` tool in an agent scope when tools are loaded. */
function installFactSearchTool(agent: Agent): (() => void) | undefined {
  const tools = agent.ctx.get('tools')
  if (tools === undefined) return undefined
  return tools.register(defineTool({
    name: 'fact_search',
    description: 'Search current Journey memory facts. Results are read-only and scoped to this Journey.',
    parameters: {
      query: { type: 'string', required: true },
      personId: { type: 'string' },
      subjectKey: { type: 'string' },
      limit: { type: 'integer' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          hits: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                factId: { type: 'string' },
                text: { type: 'string' },
                score: { type: 'number' },
                eventSeq: { type: 'integer' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      const records = memoryFactRecords(agent.session)
      const index = new MemoryIndex()
      index.rebuild(String(agent.session.id), records)
      const hits = index.query({
        sessionId: String(agent.session.id),
        text: args.query,
        ...(args.personId === undefined ? {} : { personId: args.personId }),
        ...(args.subjectKey === undefined ? {} : { subjectKey: args.subjectKey }),
        ...(args.limit === undefined ? {} : { limit: args.limit }),
      })
      return {
        hits: hits.map(hit => ({
          factId: hit.row.originId,
          text: hit.row.content,
          score: hit.score,
          eventSeq: hit.row.seq,
        })),
      }
    },
  }))
}

/** Start one non-blocking, session-serialized extraction job after a GM turn. */
function scheduleMemoryExtraction(agent: Agent, turn: number, memoryConfig: MemoryConfig): void {
  if (!memoryConfig.extraction.turnEnd) return
  const jobs = agent.ctx.get('jobs')
  if (jobs === undefined) return
  const selection = runtimeSelection(agent.session)
  const route = resolveMemoryRoute(agent, memoryConfig.extraction.route)
  if (selection === undefined || route === undefined) return
  const currentTurn = memoryTurnText(agent.session, turn)
  if (currentTurn.length === 0) return
  const roster = memoryRoster(agent.session, selection)
  const prompt = buildMemoryExtractionPrompt({
    longRange: memoryLongRange(agent.session, turn, memoryConfig.extraction.midWindowTurns),
    middleTranscript: memoryMiddleTranscript(agent.session, turn, memoryConfig.extraction.midWindowTurns),
    currentTurn,
    roster,
    existingSubjectKeys: [...new Set(flattenMemoryProjection(projectMemoryFacts(memoryFactRecords(agent.session)))
      .map(fact => fact.subjectKey)
      .filter((key): key is string => key !== undefined))].sort(),
  })
  const span = { start: turn, end: turn }
  const extractionId = createMemoryExtractionId(String(agent.session.id), span)
  if (hasCompletedExtraction(agent.session, extractionId)) return
  try {
    jobs.start({
      kind: 'memory-extraction',
      label: `Tavern memory extraction for turn ${String(turn)}`,
      owner: agent,
      run: (): JobHooks => {
        const controller = new AbortController()
        const task = memoryExtractionScheduler.enqueue(
          String(agent.session.id),
          () => runMemoryExtraction(agent, turn, span, extractionId, prompt, roster, route, controller.signal),
        )
        return {
          cancel: reason => controller.abort(reason),
          done: task.then(
            () => ({ status: 'completed' as const }),
            (error: unknown) => ({ status: 'failed' as const, detail: String(error) }),
          ),
        }
      },
    })
  } catch (error: unknown) {
    agent.ctx.logger.warn(`Tavern memory extraction was not scheduled: ${String(error)}`)
  }
}

/** Run the auxiliary extractor and commit its prompt, output, and fact events. */
async function runMemoryExtraction(
  agent: Agent,
  turn: number,
  span: { readonly start: number; readonly end: number },
  extractionId: string,
  prompt: string,
  roster: readonly MemoryRosterEntry[],
  route: { readonly provider: string; readonly model: string },
  signal: AbortSignal,
): Promise<void> {
  agent.session.append('tavern/memory-extraction', {
    phase: 'start',
    branch: String(agent.session.id),
    extractionId,
    span,
    turn,
    provider: route.provider,
    model: route.model,
    prompt,
  })
  let rawOutput: string | undefined
  try {
    const assembler = new BlockAssembler()
    const options: GenerateOptions = {
      provider: route.provider,
      model: route.model,
      messages: [createUserMessage({
        content: [{ type: 'text', text: prompt }],
        source: { kind: 'plugin', plugin: 'dsh-tavern-memory' },
      })],
      sessionId: agent.session.id,
      signal,
    }
    for await (const chunk of agent.ctx.llm.stream(options)) assembler.push(chunk)
    const finishError = memoryFinishError(assembler.finish)
    if (finishError !== undefined) throw finishError
    const blocks = assembler.blocks()
    if (blocks.some(block => block.type !== 'text')) throw new Error('memory extraction returned non-text content')
    rawOutput = blocks
      .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
      .map(block => block.text)
      .join('')
    const parsed = parseMemoryExtractionOutputStrict(rawOutput)
    if (!parsed.ok) throw new Error(parsed.error)
    const existing = memoryFactRecords(agent.session)
    const latestComplete = latestMemoryExtractionCursor(agent.session)
    const result = ingestMemoryExtraction({
      sessionId: String(agent.session.id),
      branch: String(agent.session.id),
      extractionId,
      span,
      atoms: parsed.value.atoms,
      rosterUpdates: parsed.value.rosterUpdates,
      roster,
      existing,
      cursor: latestComplete,
      nextSeq: agent.session.seq,
    })
    for (const event of result.events) {
      agent.session.append('tavern/fact', event as unknown as import('./types.ts').TavernFactEvent)
    }
    agent.session.append('tavern/memory-extraction', {
      phase: 'complete',
      branch: String(agent.session.id),
      extractionId,
      span,
      turn,
      provider: route.provider,
      model: route.model,
      prompt,
      rawOutput,
      cursor: result.cursor,
      rosterUpdates: parsed.value.rosterUpdates,
      accepted: true,
    })
  } catch (error: unknown) {
    agent.session.append('tavern/memory-extraction', {
      phase: 'failed',
      branch: String(agent.session.id),
      extractionId,
      span,
      turn,
      provider: route.provider,
      model: route.model,
      prompt,
      ...(rawOutput === undefined ? {} : { rawOutput }),
      accepted: false,
      error: String(error),
    })
  }
}

/** Resolve the route for an auxiliary memory request. */
function resolveMemoryRoute(agent: Agent, routeOverride?: string): { readonly provider: string; readonly model: string } | undefined {
  const configured = agent.session.requestHeader()?.config
  const override = routeOverride?.trim()
  const separator = override?.indexOf('/') ?? -1
  const provider = separator > 0 ? override?.slice(0, separator) : configured?.provider || agent.options.provider
  const model = separator > 0 ? override?.slice(separator + 1) : configured?.model || agent.options.model
  if (provider === undefined || provider.length === 0 || model === undefined || model.length === 0) return undefined
  return agent.ctx.llm.listProviders().some(candidate => candidate.id === provider)
    ? { provider, model }
    : undefined
}

/** Return the current turn as a compact player/GM transcript. */
function memoryTurnText(session: Session, turn: number): string {
  return memoryTurnGroups(session).find(group => group.turn === turn)?.text ?? ''
}

/** Return completed turns before the current one, with the latest five as middle context. */
function memoryMiddleTranscript(session: Session, turn: number, windowTurns: number): string {
  const turns = memoryTurnGroups(session).filter(group => group.turn < turn)
  return turns.slice(-windowTurns).map(group => group.text).join('\n')
}

/** Return older turns as long-range context for extraction. */
function memoryLongRange(session: Session, turn: number, windowTurns = DEFAULT_MEMORY_CONFIG.extraction.midWindowTurns): string {
  const turns = memoryTurnGroups(session).filter(group => group.turn < turn)
  return turns.slice(0, Math.max(0, turns.length - windowTurns)).map(group => group.text).join('\n')
}

/** Group direct user messages and assistant messages by conversation turn. */
function memoryTurnGroups(session: Session): readonly { readonly turn: number; readonly text: string }[] {
  const grouped = new Map<number, string[]>()
  const shadowed = new Set(session.events
    .filter((event): event is SessionEvent<'message/edit'> => event.type === 'message/edit')
    .flatMap(event => event.data.shadowedSeqs))
  let activeTurn: number | undefined
  for (const event of session.events) {
    if (event.type === 'turn/start') {
      activeTurn = event.data.turn
    } else if (event.type === 'user/message' && event.data.source.kind === 'user' && activeTurn !== undefined) {
      const lines = grouped.get(activeTurn) ?? []
      lines.push(`玩家：${messageText(event.data)}`)
      grouped.set(activeTurn, lines)
    } else if (event.type === 'assistant/message' && !shadowed.has(event.seq)) {
      const lines = grouped.get(event.data.turn) ?? []
      lines.push(`GM：${messageText(event.data.message)}`)
      grouped.set(event.data.turn, lines)
    } else if (event.type === 'turn/end') {
      activeTurn = undefined
    }
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left - right)
    .map(([turn, lines]) => ({ turn, text: lines.filter(line => !line.endsWith('：')).join('\n') }))
}

/** Build a stable roster from selected character identity and active people facts. */
function memoryRoster(session: Session, selection: TavernJourneySelection): readonly MemoryRosterEntry[] {
  const projection = projectMemoryFacts(memoryFactRecords(session))
  const result = new Map<string, MemoryRosterEntry>()
  const selectedName = selection.characterName?.trim()
  if (selectedName !== undefined && selectedName.length > 0) {
    const personId = `person:${slug(selectedName, 'person')}`
    result.set(personId, { personId, displayName: selectedName, aliases: [], subjectKeys: [] })
  }
  for (const [personId, facts] of Object.entries(projection.people)) {
    const prior = result.get(personId)
    const name = facts.find(fact => fact.label?.trim().toLocaleLowerCase() === 'name')?.text
      ?? prior?.displayName
      ?? personId.slice('person:'.length)
    const subjectKeys = [...new Set(facts.map(fact => fact.subjectKey).filter((key): key is string => key !== undefined))].sort()
    result.set(personId, {
      personId,
      displayName: name,
      aliases: prior?.aliases ?? [],
      subjectKeys,
    })
  }
  for (const event of session.events) {
    if (event.type !== 'tavern/memory-extraction' || event.data.phase !== 'complete') continue
    for (const update of event.data.rosterUpdates ?? []) {
      const personId = `person:${update.slug}`
      if (result.has(personId)) continue
      result.set(personId, { personId, displayName: update.displayName, aliases: [], subjectKeys: [] })
    }
  }
  return [...result.values()].sort((left, right) => left.personId.localeCompare(right.personId))
}

/** Return whether this exact extraction span was already committed. */
function hasCompletedExtraction(session: Session, extractionId: string): boolean {
  return session.events.some(event => event.type === 'tavern/memory-extraction'
    && event.data.extractionId === extractionId
    && event.data.phase === 'complete')
}

/** Read the latest committed extraction cursor, or the beginning sentinel. */
function latestMemoryExtractionCursor(session: Session): number {
  return session.events
    .filter((event): event is SessionEvent<'tavern/memory-extraction'> => event.type === 'tavern/memory-extraction')
    .filter(event => event.data.phase === 'complete' && event.data.cursor !== undefined)
    .at(-1)?.data.cursor ?? -1
}

/** Map an auxiliary model finish to a fail-closed extraction error. */
function memoryFinishError(finish: FinishReason): Error | undefined {
  switch (finish.kind) {
    case 'error':
    case 'aborted':
      return new Error(finish.failure.message)
    case 'max-tokens':
      return new Error('memory extraction output was truncated')
    default:
      return undefined
  }
}

/** Estimate prompt tokens deterministically when a World Book supplies a token budget. */
function estimateTavernTokens(text: string): number {
  let units = 0
  for (const character of text) {
    units += /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(character) ? 1 : 0.25
  }
  return Math.ceil(units)
}

/** Render current hard facts as a high-priority model constraint source. */
function hardFactConstraintSource(session: Session): readonly ContextSourceRecord<PromptWorldInfoEntry>[] {
  const text = renderHardFactConstraints(resolveTavernFacts(session))
  if (text.length === 0) return []
  return [{
    key: 'tavern:world-constraints',
    text,
    stability: 'dynamic',
    observer: { kind: 'all' },
    visibility: 'public',
    authority: 'public',
    branch: { kind: 'all' },
    validity: { status: 'valid' },
    provenance: { kind: 'tavern-constraints', id: String(session.id) },
    priority: 100,
  }]
}

/** Render canonical story state as one source-tracked model context record. */
function storyStateSources(session: Session): readonly ContextSourceRecord<PromptWorldInfoEntry>[] {
  const compact = compactPublicState(resolveTavernStoryState(session).state)
  const hasState = compact.location !== null || compact.time !== null
    || compact.inventory.length > 0 || compact.health.length > 0
    || compact.relationships.length > 0 || compact.cultivation.length > 0
    || compact.activeOaths.length > 0
  if (!hasState) return []
  return [{
    key: 'story-state:public',
    text: `Current canonical story state:\n${renderCompactPublicState(compact)}`,
    stability: 'dynamic',
    observer: { kind: 'all' },
    visibility: 'public',
    authority: 'public',
    branch: { kind: 'branch', id: String(session.id) },
    validity: { status: 'valid' },
    provenance: { kind: 'tavern-story-state', id: String(session.id) },
    priority: 25,
  }]
}

/** Convert one normalized World Info entry into a source with inspection provenance. */
function sourceFor(session: Session, entry: PromptWorldInfoEntry): ContextSourceRecord<PromptWorldInfoEntry> {
  return {
    key: `world-info:${entry.sourceAssetId}:${entry.id}`,
    text: entry.content,
    stability: 'dynamic',
    observer: { kind: 'all' },
    visibility: 'public',
    authority: 'public',
    branch: { kind: 'all' },
    validity: entry.enabled ? { status: 'valid' } : { status: 'invalid', reason: 'disabled' },
    provenance: {
      kind: 'world-info',
      id: `${entry.sourceAssetId}:${entry.id}`,
      eventIds: [String(selectionEventSeq(session))],
    },
    priority: entry.order === 0 ? 0 : -entry.order,
  }
}

/** Find the source event that supplied the active baseline. */
function selectionEventSeq(session: Session): number {
  for (let index = session.events.length - 1; index >= 0; index -= 1) {
    const event = session.events[index]
    if (event?.type === 'tavern/assets-selected') return event.seq
  }
  return 0
}

/** Choose the observer represented by a direct Tavern session. */
function observerFor(baseline: PromptAssetBaseline): Observer {
  return baseline.selection.characterId === null
    ? { kind: 'player' }
    : { kind: 'character', id: String(baseline.selection.characterId) }
}

/** Render selected entries as the dynamic runtime context snapshot. */
function renderContext(compiled: CompiledContext<PromptWorldInfoEntry>, characterName: string): string {
  const selected = [...compiled.stablePrefix, ...compiled.dynamicSuffix]
  if (selected.length === 0) return ''
  return selected.map(source => renderTavernMarkup(source.text, characterName)).join('\n\n')
}

/** Create the durable runtime-context message for the current model step. */
function createTavernContextMessage(sections: readonly ContextSnapshotSection[]): UserMessage {
  const text = joinContextSections(sections)
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: SYSTEM_PROMPT_PLUGIN, form: 'snapshot', sections },
  })
}

/** Identify any system-prompt message carried through the agent runtime. */
function isSystemPromptMessage(message: UserMessage): boolean {
  return message.source.kind === 'plugin' && message.source.plugin === SYSTEM_PROMPT_PLUGIN
}

/** Narrow a message to the structured snapshot form used by the runtime projector. */
function isSystemPromptSnapshotMessage(message: UserMessage): message is SystemPromptSnapshotMessage {
  const source = message.source
  return source.kind === 'plugin'
    && source.plugin === SYSTEM_PROMPT_PLUGIN
    && source.form === 'snapshot'
}

/** Replace Tavern's named contribution in a system-prompt runtime snapshot. */
function replaceTavernContextSection(
  messages: readonly UserMessage[],
  text: string,
  memoryText = '',
): ContextSnapshotSection[] {
  const sections: ContextSnapshotSection[] = []
  let replaced = false
  let memoryReplaced = false
  for (const message of messages) {
    if (!isSystemPromptSnapshotMessage(message)) continue
    for (const section of message.source.sections) {
      if (section.name === TAVERN_CONTEXT_SECTION) {
        if (text.length > 0) sections.push({ name: TAVERN_CONTEXT_SECTION, text })
        replaced = true
      } else if (section.name === TAVERN_MEMORY_SECTION) {
        if (memoryText.length > 0) sections.push({ name: TAVERN_MEMORY_SECTION, text: memoryText })
        memoryReplaced = true
      } else {
        sections.push(section)
      }
    }
  }
  if (!replaced && text.length > 0) sections.push({ name: TAVERN_CONTEXT_SECTION, text })
  if (!memoryReplaced && memoryText.length > 0) sections.push({ name: TAVERN_MEMORY_SECTION, text: memoryText })
  return sections
}

/** Remove Tavern's empty context section while retaining other runtime context. */
function clearTavernContextSection(messages: readonly UserMessage[]): UserMessage[] {
  return messages.flatMap((message) => {
    if (!isSystemPromptSnapshotMessage(message)) return [message]
    const sections = message.source.sections.filter(section =>
      section.name !== TAVERN_CONTEXT_SECTION && section.name !== TAVERN_MEMORY_SECTION,
    )
    if (sections.length === message.source.sections.length) return [message]
    return sections.length === 0 ? [] : [createTavernContextMessage(sections)]
  })
}

/** Resolve the selection that was active when one assistant message was written. */
function selectionAt(session: Session, assistantSeq: number): import('./session.ts').TavernAssetsSelectedEvent | undefined {
  return resolveTavernSelectionAt(session, assistantSeq)
}

/** Identify a prior system-prompt context snapshot before replacing it. */
function isRuntimeContextMessage(message: UserMessage): boolean {
  return isSystemPromptMessage(message)
}

/** Resolve Tavern macros before Harness prompt interpolation runs. */
function renderTavernMarkup(text: string, characterName: string): string {
  return renderTavernMacros(text, { characterName })
}

/** Resolve a Journey-local display-name fact over the selected Character Card name. */
function journeyCharacterName(
  session: Pick<Session, 'events'>,
  selection: { readonly characterName: string | null },
): string {
  const sourceName = selection.characterName
  if (sourceName === null || sourceName.trim().length === 0) return 'the selected character'
  const facts = resolveTavernFacts(session).people[`person:${slug(sourceName, 'person')}`] ?? []
  const name = [...facts].reverse()
    .map(fact => fact.label?.trim().toLocaleLowerCase() === 'name'
      ? fact.text.trim()
      : /^\s*Name\s*:\s*(.+?)\s*$/im.exec(fact.text)?.[1]?.trim())
    .find(value => value !== undefined && value.length > 0)
  return name ?? sourceName
}

/** Extract plain text from the current session history. */
function queryForSession(
  session: Session,
  baseline: PromptAssetBaseline,
  pendingMessages: readonly { readonly content: readonly { readonly type: string; readonly text?: string }[] }[] = [],
): string {
  const messages = [...session.deriveMessages(), ...pendingMessages]
  const depths = baseline.worldInfoEntries
    .map(entry => entry.scanDepth)
    .filter((value): value is number => value !== null)
  const scanDepth = depths.length === 0 ? undefined : Math.min(...depths)
  const window = scanDepth === undefined
    ? messages
    : scanDepth <= 0 ? [] : messages.slice(-scanDepth)
  return window.map(messageText).filter(Boolean).join('\n\n')
}

/** Read text blocks without interpreting non-text model content. */
function messageText(message: { readonly content: readonly { readonly type: string; readonly text?: string }[] }): string {
  return message.content
    .filter((block): block is { readonly type: 'text'; readonly text: string } => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
}
