/** Tavern memory compaction provider mounted by the Host service. */

import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  CompactionEngine,
  CompactionId,
  ManualCompactionError,
  compactCheckpointSource,
  isCompactCheckpointSource,
  toolPairingBalancedAfter,
  toolPairingBalancedBefore,
} from '@deepseek-ai/dsh-compaction'
import type {
  CompactionAgentContext,
  CompactionResult,
  CompactionTrigger,
  ManualCompactAgentContext,
} from '@deepseek-ai/dsh-compaction'
import type { CommandId } from '@deepseek-ai/dsh-commands/brand'
import {
  BlockAssembler,
  createUserMessage,
} from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import {
  buildMemoryCheckpoint,
  buildMemorySummaryPrompt,
  parseMemorySummaryOutput,
  resolveMemoryConfig,
  selectMemoryCompactionRange,
} from '@deepseek-ai/dsh-tavern-memory'
import type {
  MemoryConfig,
  MemoryConfigInput,
  MemoryFactEvent,
  MemorySummaryResult,
  TavernMemoryCompactionProvider,
} from '@deepseek-ai/dsh-tavern-memory'

/** Configuration accepted by the Host-owned compaction provider. */
export interface TavernCompactionConfig {
  readonly memory?: MemoryConfigInput
  /** Automatic scheduling is enabled by the Host runtime by default. */
  readonly auto?: boolean
}

/** Optional test or deployment provider for relation-safe memory summaries. */
export interface TavernCompactionSummaryProvider extends TavernMemoryCompactionProvider {}

interface SummaryCall {
  readonly result: MemorySummaryResult
  readonly rawOutput?: ContentBlock[]
  readonly llmStreamCall?: true
  readonly usage?: import('@deepseek-ai/dsh-llm').TokenUsage
  readonly provider: string
  readonly model: string
  readonly maxTokens?: number
}

interface SurfaceTurnGroup {
  readonly turn: number
  readonly seqs: readonly number[]
}

interface PreparedRegion {
  readonly start: number
  readonly end: number
  readonly shadowedSeqs: readonly number[]
  readonly transcript: string
  readonly facts: readonly MemoryFactEvent[]
}

/**
 * Find the current whole-turn surface span selected by Tavern's chunk and
 * retained-tail policy.
 * @param session - Session whose visible surface is considered.
 * @param config - Validated memory policy.
 * @returns An inclusive surface sequence span, or `null` when no safe chunk is ready.
 */
export function selectTavernCompactionRange(
  session: Session,
  config: MemoryConfig,
): { readonly start: number; readonly end: number } | null {
  const groups = completedTurnGroups(session)
  const range = selectMemoryCompactionRange(groups.map(group => group.turn), config)
  if (range === null) return null
  const selected = groups.filter(group => group.turn >= range.startTurn && group.turn <= range.endTurn)
  const start = selected[0]?.seqs[0]
  const end = selected.at(-1)?.seqs.at(-1)
  if (start === undefined || end === undefined) return null
  const nodes = session.surface.nodes
  const startIndex = nodes.indexOf(start)
  const endIndex = nodes.indexOf(end)
  if (startIndex < 0 || endIndex < startIndex) return null
  const selectedTurns = new Set(selected.map(group => group.turn))
  const events = session.events
  for (const seq of nodes.slice(startIndex, endIndex + 1)) {
    const event = eventBySeq(events, seq)
    if (event === undefined || isCompactionCheckpoint(event)) return null
    const turn = turnAtSeq(events, seq)
    if (turn === undefined || !selectedTurns.has(turn)) return null
  }
  return { start, end }
}

/**
 * Host-native `ctx.compaction` implementation for Tavern memory summaries.
 * It keeps facts in the append-only memory ledger and replaces only the
 * selected narrative surface span with a bounded user checkpoint.
 */
export class TavernCompactionEngine extends CompactionEngine {
  static inject = ['llm', 'sessions']

  static Config = z.object({ memory: z.any(), auto: z.boolean() })

  /** Validated memory and compaction policy. */
  readonly memoryConfig: MemoryConfig
  private readonly summaryProvider: TavernCompactionSummaryProvider | undefined

  /**
   * @param ctx - Context carrying the LLM and session services.
   * @param config - Memory policy or Host compaction configuration.
   * @param summaryProvider - Optional provider seam for deterministic callers.
   */
  constructor(
    ctx: Context,
    config: TavernCompactionConfig = {},
    summaryProvider?: TavernCompactionSummaryProvider,
  ) {
    super(ctx)
    this.memoryConfig = resolveMemoryConfig(config.memory)
    this.summaryProvider = summaryProvider
  }

  /**
   * Compact the latest eligible whole-turn chunk at a turn boundary.
   * @param agent - Agent session being reduced.
   * @param _trigger - Pressure source retained for the shared service seam.
   * @param signal - Cancellation signal forwarded to the summary call.
   * @returns The committed result, or `null` when the retained tail is not exceeded.
   */
  override async compactIfNeeded(
    agent: CompactionAgentContext,
    _trigger: CompactionTrigger,
    signal: AbortSignal,
  ): Promise<CompactionResult | null> {
    signal.throwIfAborted()
    const range = selectTavernCompactionRange(agent.session, this.memoryConfig)
    return range === null ? null : this.compactRegion(range.start, range.end, agent, signal)
  }

  /**
   * Compact one useful history chunk while the agent is idle.
   * @param agent - Idle agent whose session is being reduced.
   * @param signal - Manual cancellation signal.
   * @param sourceCommandId - Optional command identity for the durable bracket.
   * @returns The committed result, or `null` when no safe chunk is available.
   */
  override compactNow(
    agent: ManualCompactAgentContext,
    signal: AbortSignal,
    sourceCommandId?: CommandId,
  ): Promise<CompactionResult | null> {
    signal.throwIfAborted()
    try {
      return agent.runMaintenance(async (agentSignal) => {
        const operationSignal = AbortSignal.any([agentSignal, signal])
        operationSignal.throwIfAborted()
        const range = selectTavernCompactionRange(agent.session, this.memoryConfig)
        if (range === null) return null
        const result = await this.compactRegionWithCommand(range.start, range.end, agent, operationSignal, sourceCommandId)
        try {
          await this.ctx.sessions.flush(agent.session)
        } catch (error: unknown) {
          throw new ManualCompactionError('persistence', 'Tavern compaction durability checkpoint failed', { cause: error })
        }
        return result
      })
    } catch (error: unknown) {
      if (error instanceof ManualCompactionError) throw error
      throw new ManualCompactionError('busy', 'Tavern compaction could not reserve the idle agent', { cause: error })
    }
  }

  /**
   * Replace an explicit surface span with one model-generated memory checkpoint.
   * @param start - First surface-node sequence, inclusive.
   * @param end - Last surface-node sequence, inclusive.
   * @param agent - Session and route owner.
   * @param signal - Optional cancellation signal.
   * @returns The committed compaction lifecycle and shadowed range.
   */
  override async compactRegion(
    start: number,
    end: number,
    agent: CompactionAgentContext,
    signal?: AbortSignal,
  ): Promise<CompactionResult> {
    return this.compactRegionWithCommand(start, end, agent, signal)
  }

  private async compactRegionWithCommand(
    start: number,
    end: number,
    agent: CompactionAgentContext,
    signal?: AbortSignal,
    sourceCommandId?: CommandId,
  ): Promise<CompactionResult> {
    const session = agent.session
    const prepared = prepareRegion(session, start, end)
    assertCompactionInactive(session.events)
    signal?.throwIfAborted()
    const owner = currentOpenTurn(session)
    const compactionId = CompactionId(randomUUID())
    const lifecycle = {
      compactionId,
      turn: owner,
      ...(sourceCommandId === undefined ? {} : { sourceCommandId }),
    }
    const startEvent = session.append('compaction/start', lifecycle)
    let closed = false
    try {
      const summaryCall = await this.summarize(prepared, agent, signal)
      signal?.throwIfAborted()
      assertRegionStable(session, prepared)
      const checkpoint = buildMemoryCheckpoint(
        summaryCall.result,
        turnRangeForRegion(session, prepared),
        this.memoryConfig,
      )
      const checkpointText = renderCheckpoint(checkpoint)
      const shadowedTokenCount = roughTokenEstimate(prepared.transcript)
      const checkpointTokenCount = roughTokenEstimate(checkpointText)
      if (checkpointTokenCount >= shadowedTokenCount) {
        throw new Error(`Tavern compaction summary is not smaller (${checkpointTokenCount} >= ${shadowedTokenCount})`)
      }
      const summary = [{ type: 'text', text: checkpointText } satisfies ContentBlock]
      const summaryBase: Omit<SessionEvent<'compaction/summary'>['data'], 'rawOutput' | 'llmStreamCall'> = {
        compactionId,
        ...(sourceCommandId === undefined ? {} : { sourceCommandId }),
        summary,
        shadowedRange: { start, end },
        shadowedSeqs: [...prepared.shadowedSeqs],
        shadowedTokenCount,
        provider: summaryCall.provider,
        model: summaryCall.model,
        ...(summaryCall.maxTokens === undefined ? {} : { maxTokens: summaryCall.maxTokens }),
        ...(summaryCall.usage === undefined ? {} : { usage: summaryCall.usage }),
      }
      const summaryEvent = summaryCall.rawOutput === undefined
        ? session.append('compaction/summary', summaryBase)
        : summaryCall.llmStreamCall === true
          ? session.append('compaction/summary', {
            ...summaryBase,
            rawOutput: summaryCall.rawOutput,
            llmStreamCall: true,
          })
          : session.append('compaction/summary', {
            ...summaryBase,
            rawOutput: summaryCall.rawOutput,
          })
      const cleanupSeqs: number[] = []
      for (const cleanup of summaryCall.cleanup) {
        cleanupSeqs.push(session.append('tavern/memory-cleanup', {
          branch: String(session.id),
          compactionId,
          action: cleanup.action,
          evidence: [...cleanup.evidence],
        }).seq)
      }
      const checkpointMessage = createUserMessage({
        content: summary,
        source: compactCheckpointSource(compactionId, sourceCommandId),
      })
      session.append('user/message', checkpointMessage, {
        surfaceOp: { op: 'replace', start, end },
        sourceEventSeqs: [startEvent.seq, summaryEvent.seq, ...cleanupSeqs, ...prepared.shadowedSeqs],
      })
      const endEvent = session.append('compaction/end', lifecycle)
      closed = true
      return {
        compactionId,
        ...(sourceCommandId === undefined ? {} : { sourceCommandId }),
        startSeq: startEvent.seq,
        summarySeq: summaryEvent.seq,
        endSeq: endEvent.seq,
        summary,
        shadowedRange: { start, end },
        shadowedSeqs: [...prepared.shadowedSeqs],
        shadowedTokenCount,
      }
    } catch (error: unknown) {
      if (!closed) {
        try {
          session.append('compaction/end', {
            ...lifecycle,
            error: error instanceof Error ? error.message : String(error),
          })
          closed = true
        } catch {
          // The original summary or commit failure is the useful diagnostic;
          // the unmatched start remains visible to the compaction lock fold.
        }
      }
      throw error
    }
  }

  private async summarize(
    prepared: PreparedRegion,
    agent: CompactionAgentContext,
    signal?: AbortSignal,
  ): Promise<SummaryCall & { readonly cleanup: readonly { action: 'merge-alias' | 'mark-duplicate'; evidence: readonly string[] }[] }> {
    if (this.summaryProvider !== undefined) {
      const result = await this.summaryProvider.summarize(prepared.transcript, signal)
      return {
        result,
        cleanup: [],
        provider: 'tavern-memory-provider',
        model: 'custom',
      }
    }
    const route = resolveSummaryRoute(agent, this.memoryConfig)
    if (!this.ctx.llm.listProviders().some(provider => provider.id === route.provider)) {
      throw new Error(`Tavern compaction provider '${route.provider}' is unavailable`)
    }
    const prompt = buildMemorySummaryPrompt(prepared.transcript, prepared.facts.map((fact, index) => ({
      op: fact.operation,
      target: fact.target,
      ...(fact.personId === undefined ? {} : { personId: fact.personId }),
      ...(fact.subjectKey === undefined ? {} : { subjectKey: fact.subjectKey }),
      ...(fact.label === undefined ? {} : { label: fact.label }),
      ...(fact.text === undefined ? {} : { text: fact.text }),
      ...(fact.factId === undefined ? {} : { factId: fact.factId }),
      ...(fact.replacesFactId === undefined ? {} : { replacesFactId: fact.replacesFactId }),
      ...(fact.kind === undefined ? {} : { kind: fact.kind }),
      explicit: fact.explicit ?? false,
      anchorTurn: fact.turn ?? index,
    })))
    const assembler = new BlockAssembler()
    const options: GenerateOptions = {
      provider: route.provider,
      model: route.model,
      messages: [createUserMessage({
        content: [{ type: 'text', text: prompt }],
        source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-tavern-host/compaction' },
      })],
      maxTokens: this.memoryConfig.compaction.checkpointBudgetTokens,
      purpose: 'compaction',
      sessionId: agent.session.id,
      ...(signal === undefined ? {} : { signal }),
    }
    for await (const chunk of this.ctx.llm.stream(options)) assembler.push(chunk)
    const finish = assembler.finish
    if (finish.kind === 'error' || finish.kind === 'aborted' || finish.kind === 'max-tokens') {
      throw new Error(finish.kind === 'max-tokens' ? 'Tavern compaction summary was truncated' : finish.failure.message)
    }
    const rawOutput = assembler.blocks()
    if (rawOutput.some(block => block.type !== 'text')) throw new Error('Tavern compaction summary must be text-only')
    const rawText = rawOutput
      .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
      .map(block => block.text)
      .join('')
    const parsed = parseMemorySummaryOutput(rawText)
    if (!parsed.ok) throw new Error(parsed.error)
    return {
      result: {
        plotSummary: parsed.value.plotSummary,
        openThreads: parsed.value.openThreads.filter(thread => thread.status === 'open').map(thread => thread.text),
      },
      cleanup: parsed.value.atomCleanup,
      rawOutput,
      llmStreamCall: true,
      ...(assembler.usage === undefined ? {} : { usage: assembler.usage }),
      provider: route.provider,
      model: route.model,
      maxTokens: this.memoryConfig.compaction.checkpointBudgetTokens,
    }
  }
}

function prepareRegion(session: Session, start: number, end: number): PreparedRegion {
  const nodes = session.surface.nodes
  const startIndex = nodes.indexOf(start)
  const endIndex = nodes.indexOf(end)
  if (startIndex < 0 || endIndex < 0) throw new Error('Tavern compaction range is not on the current surface')
  if (startIndex > endIndex) throw new Error('Tavern compaction range is reversed')
  if (!toolPairingBalancedBefore(session, start) || !toolPairingBalancedAfter(session, end)) {
    throw new Error('Tavern compaction range splits an incomplete tool pair')
  }
  const shadowedSeqs = nodes.slice(startIndex, endIndex + 1)
  const messages = shadowedSeqs
    .map((seq) => {
      const event = eventBySeq(session.events, seq)
      return event === undefined ? null : session.deriveEventMessage(event)
    })
    .filter((message): message is Message => message !== null)
  if (messages.length === 0) throw new Error('Tavern compaction range has no model-visible messages')
  const transcript = messages.map(message => `${message.role}: ${messageText(message)}`).join('\n')
  const facts = session.events
    .filter((event): event is SessionEvent<'tavern/fact'> => event.type === 'tavern/fact')
    .filter(event =>
      event.data.accepted
      && event.data.turn !== undefined
      && event.data.turn >= (eventTurn(eventBySeq(session.events, start)) ?? 0),
    )
    .map(event => event.data)
  return { start, end, shadowedSeqs, transcript, facts }
}

function assertRegionStable(session: Session, prepared: PreparedRegion): void {
  const nodes = session.surface.nodes
  const startIndex = nodes.indexOf(prepared.start)
  const endIndex = nodes.indexOf(prepared.end)
  if (startIndex < 0 || endIndex < startIndex
    || nodes.slice(startIndex, endIndex + 1).some((seq, index) => seq !== prepared.shadowedSeqs[index])) {
    throw new Error('Tavern compaction surface changed while summarizing')
  }
}

function turnRangeForRegion(session: Session, prepared: PreparedRegion): { startTurn: number; endTurn: number } {
  const turns = prepared.shadowedSeqs
    .map(seq => eventTurn(eventBySeq(session.events, seq)))
    .filter((turn): turn is number => turn !== undefined)
  const startTurn = turns[0]
  const endTurn = turns.at(-1)
  if (startTurn === undefined || endTurn === undefined) throw new Error('Tavern compaction range has no turn metadata')
  return { startTurn, endTurn }
}

function completedTurnGroups(session: Session): readonly SurfaceTurnGroup[] {
  const completed = new Set<number>()
  const groups = new Map<number, number[]>()
  let openTurn: number | undefined
  const surface = new Set(session.surface.nodes)
  for (const event of session.events) {
    if (event.type === 'turn/start') openTurn = event.data.turn
    if (event.type === 'turn/end') completed.add(event.data.turn)
    if (!surface.has(event.seq) || isCompactionCheckpoint(event)) {
      if (event.type === 'turn/end') openTurn = undefined
      continue
    }
    const turn = eventTurn(event) ?? openTurn
    if (turn !== undefined && (event.type === 'user/message' || event.type === 'assistant/message' || event.type === 'tool/result')) {
      const list = groups.get(turn) ?? []
      list.push(event.seq)
      groups.set(turn, list)
    }
    if (event.type === 'turn/end') openTurn = undefined
  }
  return [...groups.entries()]
    .filter(([turn, seqs]) => completed.has(turn) && seqs.length > 0)
    .sort(([left], [right]) => left - right)
    .map(([turn, seqs]) => ({ turn, seqs: [...seqs].sort((left, right) => left - right) }))
}

function currentOpenTurn(session: Session): number | null {
  let open: number | null = null
  for (const event of session.events) {
    if (event.type === 'turn/start') open = event.data.turn
    if (event.type === 'turn/end') open = null
  }
  return open
}

function eventTurn(event: SessionEvent | undefined): number | undefined {
  if (event === undefined) return undefined
  if (event.type === 'assistant/message' || event.type === 'tool/result'
    || event.type === 'step/start' || event.type === 'step/end' || event.type === 'tool/call') return event.data.turn
  return undefined
}

function eventBySeq(events: readonly SessionEvent[], seq: number): SessionEvent | undefined {
  return events.find(event => event.seq === seq)
}

function turnAtSeq(events: readonly SessionEvent[], seq: number): number | undefined {
  let openTurn: number | undefined
  for (const event of events) {
    if (event.type === 'turn/start') openTurn = event.data.turn
    if (event.seq === seq) return eventTurn(event) ?? openTurn
    if (event.type === 'turn/end') openTurn = undefined
  }
  return undefined
}

function isCompactionCheckpoint(event: SessionEvent): boolean {
  if (event.type !== 'user/message') return false
  return isCompactCheckpointSource(event.data.source)
}

function messageText(message: Message): string {
  return message.content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
}

function renderCheckpoint(checkpoint: { plotSummary: string; openThreads: readonly string[] }): string {
  return [
    '【前情提要】',
    checkpoint.plotSummary,
    ...(checkpoint.openThreads.length === 0 ? [] : ['【未决伏笔】', ...checkpoint.openThreads.map(thread => `- ${thread}`)]),
  ].join('\n')
}

function resolveSummaryRoute(
  agent: CompactionAgentContext,
  config: MemoryConfig,
): { provider: string; model: string } {
  const configured = config.compaction.summaryRoute
  if (configured !== undefined) return parseRoute(configured)
  const request = agent.session.requestHeader()?.config
  const provider = request?.provider ?? agent.options.provider
  const model = request?.model ?? agent.options.model
  if (provider === undefined || provider.length === 0 || model === undefined || model.length === 0) {
    throw new Error('Tavern compaction requires compaction.summaryRoute or an active model route')
  }
  return { provider, model }
}

function parseRoute(route: string): { provider: string; model: string } {
  const match = /^([^/\s]+)\/([^/\s]+)$/u.exec(route.trim())
  if (match === null || match[1] === undefined || match[2] === undefined) throw new Error('Tavern compaction route must use provider/model')
  return { provider: match[1], model: match[2] }
}

function assertCompactionInactive(events: readonly SessionEvent[]): void {
  let open: SessionEvent<'compaction/start'> | undefined
  for (const event of events) {
    if (event.type === 'compaction/start') open = event
    if (event.type === 'compaction/end' && open !== undefined && event.data.compactionId === open.data.compactionId) open = undefined
  }
  if (open !== undefined) throw new ManualCompactionError('busy', 'Tavern compaction is already in progress')
}

function roughTokenEstimate(text: string): number {
  return Math.ceil(Array.from(text).length / 4)
}
