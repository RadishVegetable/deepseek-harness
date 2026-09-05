/** Validated configuration for the Tavern Journey memory capability. */

import type { MemoryConfig } from './types.ts'

/** Partial configuration accepted by a Cordis config adapter. */
export interface MemoryConfigInput {
  readonly extraction?: {
    readonly turnEnd?: boolean
    readonly midWindowTurns?: number
    readonly route?: string
  }
  readonly compaction?: {
    readonly chunkTurns?: readonly [number, number]
    readonly retainedTailTurns?: number
    readonly checkpointBudgetTokens?: number
    readonly summaryRoute?: string
  }
  readonly edit?: { readonly windowTurns?: number; readonly marginTurns?: number }
  readonly injection?: { readonly activePeople?: number; readonly activeFacts?: number; readonly prefetchTopK?: number }
  readonly retrieval?: { readonly embeddingModel?: string; readonly mode?: 'brute' | 'ann'; readonly wiVectorActivation?: boolean }
}

/** Stable defaults; deployments may replace every deployment-varying value. */
export const DEFAULT_MEMORY_CONFIG: MemoryConfig = Object.freeze({
  extraction: Object.freeze({ turnEnd: true, midWindowTurns: 5 }),
  compaction: Object.freeze({ chunkTurns: [8, 12] as const, retainedTailTurns: 14, checkpointBudgetTokens: 400 }),
  edit: Object.freeze({ windowTurns: 10, marginTurns: 2 }),
  injection: Object.freeze({ activePeople: 5, activeFacts: 10, prefetchTopK: 8 }),
  retrieval: Object.freeze({ mode: 'brute' as const, wiVectorActivation: true }),
})

/** Configuration error raised before a memory provider is mounted. */
export class MemoryConfigError extends Error {
  override readonly name = 'MemoryConfigError'
}

/**
 * Resolve defaults and reject invalid memory policy before runtime startup.
 * @param input - Optional deployment configuration.
 * @returns A detached complete policy.
 * @throws {@link MemoryConfigError} when a numeric policy or retention relation is invalid.
 */
export function resolveMemoryConfig(input: MemoryConfigInput = {}): MemoryConfig {
  const extraction = {
    turnEnd: input.extraction?.turnEnd ?? DEFAULT_MEMORY_CONFIG.extraction.turnEnd,
    midWindowTurns: input.extraction?.midWindowTurns ?? DEFAULT_MEMORY_CONFIG.extraction.midWindowTurns,
    ...(input.extraction?.route === undefined ? {} : { route: input.extraction.route }),
  }
  const configuredChunk = input.compaction?.chunkTurns ?? DEFAULT_MEMORY_CONFIG.compaction.chunkTurns
  const compaction = {
    chunkTurns: [configuredChunk[0], configuredChunk[1]] as [number, number],
    retainedTailTurns: input.compaction?.retainedTailTurns ?? DEFAULT_MEMORY_CONFIG.compaction.retainedTailTurns,
    checkpointBudgetTokens: input.compaction?.checkpointBudgetTokens ?? DEFAULT_MEMORY_CONFIG.compaction.checkpointBudgetTokens,
    ...(input.compaction?.summaryRoute === undefined ? {} : { summaryRoute: input.compaction.summaryRoute }),
  }
  const edit = {
    windowTurns: input.edit?.windowTurns ?? DEFAULT_MEMORY_CONFIG.edit.windowTurns,
    marginTurns: input.edit?.marginTurns ?? DEFAULT_MEMORY_CONFIG.edit.marginTurns,
  }
  const injection = {
    activePeople: input.injection?.activePeople ?? DEFAULT_MEMORY_CONFIG.injection.activePeople,
    activeFacts: input.injection?.activeFacts ?? DEFAULT_MEMORY_CONFIG.injection.activeFacts,
    prefetchTopK: input.injection?.prefetchTopK ?? DEFAULT_MEMORY_CONFIG.injection.prefetchTopK,
  }
  const retrieval = {
    ...(input.retrieval?.embeddingModel === undefined ? {} : { embeddingModel: input.retrieval.embeddingModel }),
    mode: input.retrieval?.mode ?? DEFAULT_MEMORY_CONFIG.retrieval.mode,
    wiVectorActivation: input.retrieval?.wiVectorActivation ?? DEFAULT_MEMORY_CONFIG.retrieval.wiVectorActivation,
  }
  validatePositive('extraction.midWindowTurns', extraction.midWindowTurns)
  validateRoute('extraction.route', extraction.route)
  validateChunk(compaction.chunkTurns)
  validateNonNegative('compaction.retainedTailTurns', compaction.retainedTailTurns)
  validatePositive('compaction.checkpointBudgetTokens', compaction.checkpointBudgetTokens)
  validateRoute('compaction.summaryRoute', compaction.summaryRoute)
  validatePositive('edit.windowTurns', edit.windowTurns)
  validateNonNegative('edit.marginTurns', edit.marginTurns)
  if (compaction.retainedTailTurns < edit.windowTurns + edit.marginTurns) {
    throw new MemoryConfigError('compaction.retainedTailTurns must be at least edit.windowTurns + marginTurns')
  }
  validatePositive('injection.activePeople', injection.activePeople)
  validatePositive('injection.activeFacts', injection.activeFacts)
  validatePositive('injection.prefetchTopK', injection.prefetchTopK)
  if (retrieval.embeddingModel !== undefined && retrieval.embeddingModel.trim().length === 0) {
    throw new MemoryConfigError('retrieval.embeddingModel must be non-empty when configured')
  }
  return structuredClone({ extraction, compaction, edit, injection, retrieval })
}

function validatePositive(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new MemoryConfigError(`${name} must be a positive safe integer`)
}

function validateNonNegative(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new MemoryConfigError(`${name} must be a non-negative safe integer`)
}

function validateChunk(chunk: readonly [number, number]): void {
  validatePositive('compaction.chunkTurns.min', chunk[0])
  validatePositive('compaction.chunkTurns.max', chunk[1])
  if (chunk[0] > chunk[1]) throw new MemoryConfigError('compaction.chunkTurns must be ordered')
}

function validateRoute(name: string, value: string | undefined): void {
  if (value === undefined) return
  if (!/^[^/\s]+\/[^/\s]+$/u.test(value.trim())) {
    throw new MemoryConfigError(`${name} must use provider/model`)
  }
}
