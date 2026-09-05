/** Host-side projection of Journey plot checkpoints from the Session log. */

import { CompactionId, isCompactCheckpointSource } from '@deepseek-ai/dsh-compaction'
import type { CompactionId as CompactionIdType } from '@deepseek-ai/dsh-compaction'
import { isReplacementSurfaceEvent } from '@deepseek-ai/dsh-session'
import type { MessageSource } from '@deepseek-ai/dsh-llm/message'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { TavernMemoryCheckpoint, TavernMemoryInspection } from './types.ts'

const CHECKPOINT_HEADER = '【前情提要】'
const OPEN_THREADS_HEADER = '【未决伏笔】'

interface ParsedCheckpointText {
  readonly plotSummary: string
  readonly openThreads: readonly string[]
}

interface CheckpointSource {
  readonly compactionId: CompactionIdType
  readonly sourceCommandId?: string
}

/**
 * Rebuild the Journey plot checkpoint list from durable compaction records.
 * Ordinary transcript messages are never an input to this projection.
 * @param session - Journey Session whose append-only log is inspected.
 * @returns Checkpoints that have a complete, matching summary/checkpoint pair.
 */
export function projectTavernMemory(session: Session): TavernMemoryInspection {
  const summaries = session.events.filter(
    (event): event is SessionEvent<'compaction/summary'> => event.type === 'compaction/summary',
  )
  if (summaries.length === 0) return { checkpoints: [] }

  const checkpointsByCompaction = new Map<string, SessionEvent<'user/message'>[]>()
  for (const event of session.events) {
    if (event.type !== 'user/message' || !isReplacementSurfaceEvent(event)) continue
    if (!isCompactCheckpointSource(event.data.source)) continue
    const source = readCheckpointSource(event.data.source)
    if (source === undefined) continue
    const existing = checkpointsByCompaction.get(String(source.compactionId)) ?? []
    existing.push(event)
    checkpointsByCompaction.set(String(source.compactionId), existing)
  }

  const checkpoints: TavernMemoryCheckpoint[] = []
  const seenCompactionIds = new Set<string>()
  for (const summary of summaries) {
    const compactionId = readCompactionId(summary.data.compactionId)
    if (compactionId === undefined) return { checkpoints: [] }
    const compactionKey = String(compactionId)
    if (seenCompactionIds.has(compactionKey)) return { checkpoints: [] }
    seenCompactionIds.add(compactionKey)

    const candidates = (checkpointsByCompaction.get(compactionKey) ?? [])
      .filter(event => event.seq > summary.seq)
    if (candidates.length !== 1) return { checkpoints: [] }
    const checkpoint = candidates[0]
    if (checkpoint === undefined) return { checkpoints: [] }
    const projection = projectCheckpoint(session, summary, checkpoint, compactionId)
    if (projection === undefined) return { checkpoints: [] }
    checkpoints.push(projection)
  }
  return { checkpoints }
}

function projectCheckpoint(
  session: Session,
  summary: SessionEvent<'compaction/summary'>,
  checkpoint: SessionEvent<'user/message'>,
  compactionId: CompactionIdType,
): TavernMemoryCheckpoint | undefined {
  const checkpointSource = readCheckpointSource(checkpoint.data.source)
  if (checkpointSource === undefined || checkpointSource.compactionId !== compactionId) return undefined
  const summaryCommandId = summary.data.sourceCommandId
  if (summaryCommandId !== undefined && typeof summaryCommandId !== 'string') return undefined
  if (checkpointSource.sourceCommandId !== summaryCommandId) return undefined

  const summaryText = textContent(summary.data.summary)
  const checkpointText = textContent(checkpoint.data.content)
  if (summaryText === undefined || checkpointText === undefined || summaryText !== checkpointText) return undefined
  const parsed = parseCheckpointText(summaryText)
  if (parsed === undefined) return undefined
  const shadowedSeqs = readShadowedSeqs(summary)
  if (shadowedSeqs === undefined) return undefined
  const shadowedTurns = resolveShadowedTurns(session, shadowedSeqs, summary.seq)
  if (shadowedTurns === undefined) return undefined

  return {
    compactionId,
    summarySeq: summary.seq,
    checkpointSeq: checkpoint.seq,
    plotSummary: parsed.plotSummary,
    openThreads: [...parsed.openThreads],
    shadowedTurns,
  }
}

function readCheckpointSource(source: MessageSource): CheckpointSource | undefined {
  if (!isCompactCheckpointSource(source) || source.kind !== 'plugin') return undefined
  if (!('compactionId' in source)) return undefined
  const rawCompactionId = source.compactionId
  if (typeof rawCompactionId !== 'string' || rawCompactionId.length === 0) return undefined
  const rawSourceCommandId = 'sourceCommandId' in source ? source.sourceCommandId : undefined
  if (rawSourceCommandId !== undefined
    && (typeof rawSourceCommandId !== 'string' || rawSourceCommandId.length === 0)) return undefined
  return {
    compactionId: CompactionId(rawCompactionId),
    ...(rawSourceCommandId === undefined ? {} : { sourceCommandId: rawSourceCommandId }),
  }
}

function readCompactionId(value: unknown): CompactionIdType | undefined {
  return typeof value === 'string' && value.length > 0 ? CompactionId(value) : undefined
}

function textContent(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length !== 1) return undefined
  const block = value[0]
  if (!isRecord(block) || block.type !== 'text' || typeof block.text !== 'string') return undefined
  return block.text
}

/**
 * Parse only the frame written by the Tavern compaction provider. The paired
 * event checks above are intentional: a matching-looking transcript line is
 * not a plot checkpoint.
 */
function parseCheckpointText(text: string): ParsedCheckpointText | undefined {
  const lines = text.split('\n')
  if (lines[0] !== CHECKPOINT_HEADER) return undefined
  const threadHeaders = lines.reduce<number[]>((indexes, line, index) => {
    if (line === OPEN_THREADS_HEADER) indexes.push(index)
    return indexes
  }, [])
  if (threadHeaders.length > 1) return undefined
  const threadHeader = threadHeaders[0]
  const plotEnd = threadHeader ?? lines.length
  const plotSummary = lines.slice(1, plotEnd).join('\n').trim()
  if (plotSummary.length === 0) return undefined
  if (threadHeader === undefined) return { plotSummary, openThreads: [] }

  const threadLines = lines.slice(threadHeader + 1)
  if (threadLines.length === 0) return undefined
  const openThreads: string[] = []
  for (const line of threadLines) {
    if (!line.startsWith('- ')) return undefined
    const thread = line.slice(2).trim()
    if (thread.length === 0) return undefined
    openThreads.push(thread)
  }
  return { plotSummary, openThreads }
}

function readShadowedSeqs(summary: SessionEvent<'compaction/summary'>): readonly number[] | undefined {
  const rawSeqs: unknown = summary.data.shadowedSeqs
  if (!Array.isArray(rawSeqs) || rawSeqs.length === 0) return undefined
  if (rawSeqs.some(seq => !isSequence(seq))) return undefined
  if (new Set(rawSeqs).size !== rawSeqs.length) return undefined
  const first = rawSeqs[0]
  const last = rawSeqs.at(-1)
  const range: unknown = summary.data.shadowedRange
  if (!isRecord(range) || range.start !== first || range.end !== last) return undefined
  return rawSeqs
}

function resolveShadowedTurns(
  session: Session,
  shadowedSeqs: readonly number[],
  summarySeq: number,
): { readonly start: number; readonly end: number } | undefined {
  const wanted = new Set(shadowedSeqs)
  const turns = new Map<number, number>()
  let openTurn: number | undefined
  for (const event of session.events) {
    if (event.type === 'turn/start') openTurn = event.data.turn
    if (wanted.has(event.seq)) {
      if (event.seq >= summarySeq) return undefined
      const turn = eventTurn(event) ?? (event.type === 'user/message' ? openTurn : undefined)
      if (turn === undefined || !isTurn(turn)) return undefined
      turns.set(event.seq, turn)
    }
    if (event.type === 'turn/end') openTurn = undefined
  }
  if (turns.size !== wanted.size) return undefined
  const orderedTurns = shadowedSeqs.map(seq => turns.get(seq))
  if (orderedTurns.some((turn): turn is undefined => turn === undefined)) return undefined
  for (let index = 1; index < orderedTurns.length; index += 1) {
    const previous = orderedTurns[index - 1]
    const current = orderedTurns[index]
    if (previous === undefined || current === undefined || current < previous) return undefined
  }
  const start = orderedTurns[0]
  const end = orderedTurns.at(-1)
  if (start === undefined || end === undefined) return undefined
  return { start, end }
}

function eventTurn(event: SessionEvent): number | undefined {
  if (event.type === 'assistant/message' || event.type === 'tool/result') return event.data.turn
  return undefined
}

function isSequence(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isTurn(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
