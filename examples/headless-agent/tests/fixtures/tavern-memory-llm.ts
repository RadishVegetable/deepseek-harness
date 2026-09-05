/** Deterministic LLM adapter for the assembled Tavern memory snapshot. */

import type { Context } from '@deepseek-ai/cordis'
import {
  LlmAdapter,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

const EXTRACTION = JSON.stringify({
  atoms: [{
    op: 'add',
    target: 'world',
    subjectKey: 'world:archive.door',
    text: 'The archive door is open.',
    explicit: false,
    anchorTurn: 1,
  }],
  rosterUpdates: [],
})

const COMPACTION = JSON.stringify({
  plotSummary: 'The archive door is open.',
  openThreads: [{ text: 'The Journey continues through the archive.', status: 'open' }],
  atomCleanup: [],
})

/** One model response chosen from the source of the assembled request. */
function replyFor(options: GenerateOptions): string {
  const request = JSON.stringify(options.messages)
  if (request.includes('dsh-tavern-memory')) return EXTRACTION
  if (request.includes('@deepseek-ai/dsh-tavern-host/compaction')) return COMPACTION
  if (request.includes('TAVERN_MEMORY_TARGET')) return 'TAVERN MEMORY COMPACTION RECOVERED'
  if (request.includes('TAVERN_PRELUDE_DOOR')) {
    return 'The archivist opens the archive door and records its brass hinges, moonlit lock, dust-covered threshold, and the quiet passage beyond. The opened door becomes a durable landmark for the Journey through the midnight archive.'
  }
  if (request.includes('TAVERN_PRELUDE_HALL')) {
    return 'The archivist crosses the archive hall, following the blue lamps toward the sealed reading room while keeping the opened door as a landmark.'
  }
  return 'TAVERN SNAPSHOT RESPONSE'
}

class TavernMemoryAdapter extends LlmAdapter {
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      context: { contextWindow: 128000 },
    })
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const text = replyFor(options)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 9, outputTokens: text.length } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'tavern-memory-llm'
export const inject = ['llm']

/** Register the deterministic route used by the real Tavern composition. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['tavern-mock'], new TavernMemoryAdapter())
}
