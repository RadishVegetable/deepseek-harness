/** Tavern-specific compaction policy and summary provider seam. */

import type { MemoryCheckpoint, MemoryConfig } from './types.ts'

/** One relation-only cleanup decision returned by a summary call. */
export interface MemorySummaryCleanup {
  readonly action: 'merge-alias' | 'mark-duplicate'
  readonly evidence: readonly string[]
}

/** Strict summary response accepted from the compaction model. */
export interface MemorySummaryOutput {
  readonly plotSummary: string
  readonly openThreads: readonly { readonly text: string; readonly status: 'open' | 'closed' }[]
  readonly atomCleanup: readonly MemorySummaryCleanup[]
}

/** Result of parsing a relation-only compaction response. */
export type MemorySummaryParseResult =
  | { readonly ok: true; readonly value: MemorySummaryOutput }
  | { readonly ok: false; readonly error: string }

/** Surface turn range selected for one idle compaction attempt. */
export interface MemoryCompactionRange {
  readonly startTurn: number
  readonly endTurn: number
}

/** Summary result supplied by a model-backed or deterministic provider. */
export interface MemorySummaryResult {
  readonly plotSummary: string
  readonly openThreads: readonly string[]
}

/** Provider seam used by the host's native compaction integration. */
export interface TavernMemoryCompactionProvider {
  summarize(transcript: string, signal?: AbortSignal): Promise<MemorySummaryResult>
}

/**
 * Parse the strict summary response without allowing the model to create facts.
 * @param raw - Complete summary response from the compaction model.
 * @returns A validated relation-only summary or a rejection reason.
 */
export function parseMemorySummaryOutput(raw: string): MemorySummaryParseResult {
  const candidate = raw.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '').trim()
  let value: unknown
  try {
    value = JSON.parse(candidate) as unknown
  } catch {
    return { ok: false, error: 'summary output must be valid JSON' }
  }
  if (!isRecord(value) || !hasOnlyKeys(value, ['plotSummary', 'openThreads', 'atomCleanup'])) {
    return { ok: false, error: 'summary output contains unknown fields' }
  }
  const plotSummary = nonEmptyString(value['plotSummary'])
  if (plotSummary === undefined) return { ok: false, error: 'plotSummary must be non-empty' }
  if (!Array.isArray(value['openThreads']) || !Array.isArray(value['atomCleanup'])) {
    return { ok: false, error: 'openThreads and atomCleanup must be arrays' }
  }
  const openThreads: MemorySummaryOutput['openThreads'][number][] = []
  for (const item of value['openThreads']) {
    if (!isRecord(item) || !hasOnlyKeys(item, ['text', 'status'])) return { ok: false, error: 'invalid open thread' }
    const text = nonEmptyString(item['text'])
    const status = item['status']
    if (text === undefined || (status !== 'open' && status !== 'closed')) return { ok: false, error: 'invalid open thread' }
    openThreads.push({ text, status })
  }
  const atomCleanup: MemorySummaryCleanup[] = []
  for (const item of value['atomCleanup']) {
    if (!isRecord(item) || !hasOnlyKeys(item, ['action', 'evidence'])) return { ok: false, error: 'invalid atom cleanup' }
    const action = item['action']
    if (action !== 'merge-alias' && action !== 'mark-duplicate') return { ok: false, error: 'invalid atom cleanup action' }
    if (!Array.isArray(item['evidence']) || item['evidence'].some(entry => typeof entry !== 'string' || entry.trim().length === 0)) {
      return { ok: false, error: 'atom cleanup evidence must contain non-empty ids' }
    }
    atomCleanup.push({ action, evidence: item['evidence'].map(entry => entry.trim()) })
  }
  return { ok: true, value: { plotSummary, openThreads, atomCleanup } }
}

/**
 * Select a whole-turn chunk while retaining the configured editable tail.
 * `turns` must be ordered conversation turn numbers; compressed turns are
 * omitted by the caller so existing checkpoints are never summarized again.
 * @param turns - Candidate uncompressed turns.
 * @param config - Validated memory policy.
 * @returns A chunk range, or `null` when the editable tail must be retained.
 */
export function selectMemoryCompactionRange(
  turns: readonly number[],
  config: MemoryConfig,
): MemoryCompactionRange | null {
  const unique = [...new Set(turns)].sort((left, right) => left - right)
  const eligible = unique.slice(0, Math.max(0, unique.length - config.compaction.retainedTailTurns))
  if (eligible.length < config.compaction.chunkTurns[0]) return null
  const size = Math.min(config.compaction.chunkTurns[1], eligible.length)
  const selected = eligible.slice(-size)
  const startTurn = selected[0]
  const endTurn = selected.at(-1)
  if (startTurn === undefined || endTurn === undefined) return null
  return { startTurn, endTurn }
}

/**
 * Validate and package one compaction summary without changing fact text.
 * @param result - Provider summary and open-thread list.
 * @param range - Shadowed turn range.
 * @param config - Budget source.
 * @param tokenEstimator - Optional deployment token estimator.
 * @returns A checkpoint suitable for the host compaction replacement event.
 */
export function buildMemoryCheckpoint(
  result: MemorySummaryResult,
  range: MemoryCompactionRange,
  config: MemoryConfig,
  tokenEstimator: (text: string) => number = roughTokenEstimate,
): MemoryCheckpoint {
  const plotSummary = result.plotSummary.trim()
  if (plotSummary.length === 0) throw new Error('memory compaction summary must not be empty')
  const openThreads = result.openThreads.map(thread => thread.trim()).filter(Boolean)
  const content = [plotSummary, ...openThreads.map(thread => `- ${thread}`)].join('\n')
  const tokens = tokenEstimator(content)
  if (!Number.isSafeInteger(tokens) || tokens < 0) throw new Error('memory token estimator returned an invalid count')
  if (tokens > config.compaction.checkpointBudgetTokens) {
    throw new Error(`memory checkpoint exceeds ${config.compaction.checkpointBudgetTokens} tokens`)
  }
  return {
    plotSummary,
    openThreads,
    shadowedTurns: { start: range.startTurn, end: range.endTurn },
  }
}

function roughTokenEstimate(text: string): number {
  return Math.ceil(Array.from(text).length / 4)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = new Set(allowed)
  return Object.keys(value).every(key => keys.has(key))
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}
