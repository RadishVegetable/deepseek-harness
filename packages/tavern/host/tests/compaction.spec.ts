import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId, createAssistantMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CompactionId, compactCheckpointSource } from '@deepseek-ai/dsh-compaction'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { resolveMemoryConfig } from '@deepseek-ai/dsh-tavern-memory'
import { TavernAssetService, TavernCompactionEngine, selectTavernCompactionRange } from '../src/index.ts'

interface CompactionTurn {
  readonly start: number
  readonly end: number
  readonly toolCall?: number
  readonly toolResult?: number
}

function appendCompactionTurn(
  session: Session,
  turn: number,
  userText: string,
  assistantText: string,
  withToolPair = false,
): CompactionTurn {
  session.append('turn/start', { turn })
  const user = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: userText }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('step/start', { turn, step: 1 })

  let toolCall: number | undefined
  let toolResult: number | undefined
  if (withToolPair) {
    const callId = CallId(`compaction-spec-call-${turn}`)
    toolCall = session.append('assistant/message', {
      turn,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'tool-call', id: callId, name: 'lookup', arguments: '{}' }],
        source: { provider: 'test', model: 'test' },
      }),
    }, { surfaceOp: 'append' }).seq
    toolResult = session.append('tool/result', {
      turn,
      step: 1,
      message: createToolResultMessage({
        callId,
        content: [{ type: 'text', text: 'lookup result' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' }).seq
  }

  const assistant = session.append('assistant/message', {
    turn,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'text', text: assistantText }],
      source: { provider: 'test', model: 'test' },
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })

  return {
    start: user.seq,
    end: assistant.seq,
    ...(toolCall === undefined || toolResult === undefined ? {} : { toolCall, toolResult }),
  }
}

function messageText(message: ReturnType<Session['deriveMessages']>[number]): string {
  return message.content
    .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
}

describe('Tavern compaction', () => {
  it('selects complete turns while retaining the newest turn', () => {
    const session = Session.create(SessionId('compaction-spec-range'))
    const first = appendCompactionTurn(
      session,
      1,
      'The party entered the archive before the storm.',
      'The archive keeper unlocked the outer gate.',
    )
    const second = appendCompactionTurn(
      session,
      2,
      'Search the sealed cabinet for the missing ledger.',
      'The missing ledger was found beneath the cabinet floor.',
      true,
    )
    const third = appendCompactionTurn(
      session,
      3,
      'Keep the ledger ready for the next exchange.',
      'The ledger remains ready beside the open gate.',
    )

    const config = resolveMemoryConfig({
      compaction: { chunkTurns: [2, 2], retainedTailTurns: 1 },
      edit: { windowTurns: 1, marginTurns: 0 },
    })
    const range = selectTavernCompactionRange(session, config)

    expect(range).toEqual({ start: first.start, end: second.end })
    expect(range?.end).not.toBe(third.end)
    const startIndex = session.surface.nodes.indexOf(range?.start ?? -1)
    const endIndex = session.surface.nodes.indexOf(range?.end ?? -1)
    expect(session.surface.nodes.slice(startIndex, endIndex + 1)).toEqual([
      first.start,
      first.end,
      second.start,
      second.toolCall,
      second.toolResult,
      second.end,
    ])
  })

  it('returns no range when a candidate span contains a prior checkpoint', () => {
    const session = Session.create(SessionId('compaction-spec-unsafe-selection'))
    appendCompactionTurn(session, 1, 'The party crossed the courtyard.', 'The keeper opened the vault.')
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '【前情提要】\nAn earlier checkpoint.' }],
      source: compactCheckpointSource(CompactionId('previous-compaction')),
    }), { surfaceOp: 'append' })
    appendCompactionTurn(session, 2, 'Search the vault for the map.', 'The map was found.')
    appendCompactionTurn(session, 3, 'Keep the map ready.', 'The map remains on the table.')

    const config = resolveMemoryConfig({
      compaction: { chunkTurns: [2, 2], retainedTailTurns: 1 },
      edit: { windowTurns: 1, marginTurns: 0 },
    })

    expect(selectTavernCompactionRange(session, config)).toBeNull()
  })

  it('rejects a range that splits an incomplete tool pair before summarizing', async () => {
    const session = Session.create(SessionId('compaction-spec-unsafe-tool-range'))
    const turn = appendCompactionTurn(
      session,
      1,
      'Ask the archive index about the sealed vault.',
      'The index returned the vault location.',
      true,
    )
    if (turn.toolCall === undefined) throw new Error('tool call was not appended')

    const summaryProvider = { summarize: vi.fn(async () => ({ plotSummary: 'unused', openThreads: [] })) }
    const context = new Context()
    const engine = new TavernCompactionEngine(context, {}, summaryProvider)

    try {
      await expect(engine.compactRegion(turn.toolCall, turn.toolCall, {
        session,
        options: { provider: 'test', model: 'test' },
      })).rejects.toThrow('splits an incomplete tool pair')
      expect(summaryProvider.summarize).not.toHaveBeenCalled()
      expect(session.events.some(event => event.type === 'compaction/start')).toBe(false)
    } finally {
      await context.fiber.dispose()
    }
  })

  it('commits the complete summary-provider lifecycle and replaces the selected surface', async () => {
    const session = Session.create(SessionId('compaction-spec-success'))
    const first = appendCompactionTurn(
      session,
      1,
      'The party crossed the rain-soaked archive courtyard and reached the locked vault.',
      'The keeper opened the vault and revealed a cabinet of forgotten maps.',
    )
    const second = appendCompactionTurn(
      session,
      2,
      'Keep the maps ready for the next exchange.',
      'The maps remain spread beside the open vault.',
    )
    const beforeSurface = [...session.surface.nodes]
    const summaryProvider = {
      summarize: vi.fn(async (transcript: string) => {
        expect(transcript).toContain('The party crossed the rain-soaked archive courtyard')
        expect(transcript).toContain('The keeper opened the vault')
        return { plotSummary: 'The party reached the archive vault.', openThreads: ['Find the oldest map.'] }
      }),
    }
    const context = new Context()
    const engine = new TavernCompactionEngine(context, {
      memory: {
        compaction: { chunkTurns: [1, 1], retainedTailTurns: 1 },
        edit: { windowTurns: 1, marginTurns: 0 },
      },
    }, summaryProvider)

    try {
      const agent = { session, options: { provider: 'test', model: 'test' } }
      const result = await engine.compactRegion(first.start, first.end, agent)
      const lifecycle = session.events.filter(event => event.seq >= result.startSeq && event.seq <= result.endSeq)
      const summaryEvent = lifecycle.find(event => event.type === 'compaction/summary')
      const checkpoint = lifecycle.find(event => event.type === 'user/message')
      const endEvent = lifecycle.find(event => event.type === 'compaction/end')

      expect(summaryProvider.summarize).toHaveBeenCalledOnce()
      expect(lifecycle.map(event => event.type)).toEqual([
        'compaction/start',
        'compaction/summary',
        'user/message',
        'compaction/end',
      ])
      expect(summaryEvent?.type).toBe('compaction/summary')
      if (summaryEvent?.type !== 'compaction/summary') throw new Error('summary event was not committed')
      expect(summaryEvent.data).toMatchObject({
        compactionId: result.compactionId,
        shadowedRange: { start: first.start, end: first.end },
        shadowedSeqs: beforeSurface.slice(0, 2),
        provider: 'tavern-memory-provider',
        model: 'custom',
      })
      expect(summaryEvent.data).not.toHaveProperty('rawOutput')

      expect(checkpoint?.type).toBe('user/message')
      if (checkpoint?.type !== 'user/message') throw new Error('checkpoint replacement was not committed')
      expect(checkpoint.data.source).toMatchObject({
        kind: 'plugin',
        plugin: 'compact',
        compactionId: result.compactionId,
      })
      expect(checkpoint.surfaceOp).toEqual({ op: 'replace', start: first.start, end: first.end })
      expect(checkpoint.sourceEventSeqs).toEqual([result.startSeq, result.summarySeq, ...result.shadowedSeqs])

      expect(endEvent?.type).toBe('compaction/end')
      if (endEvent?.type !== 'compaction/end') throw new Error('compaction end event was not committed')
      expect(endEvent.data).toMatchObject({ compactionId: result.compactionId, turn: null })
      expect(session.surface.nodes).toEqual([checkpoint.seq, second.start, second.end])
      expect(session.deriveMessages().map(messageText)).toEqual([
        '【前情提要】\nThe party reached the archive vault.\n【未决伏笔】\n- Find the oldest map.',
        'Keep the maps ready for the next exchange.',
        'The maps remain spread beside the open vault.',
      ])
      expect(TavernAssetService.prototype.remoteInspectMemory.call({}, agent as unknown as Agent)).toMatchObject({
        checkpoints: [{
          compactionId: result.compactionId,
          summarySeq: result.summarySeq,
          checkpointSeq: checkpoint.seq,
          plotSummary: 'The party reached the archive vault.',
          openThreads: ['Find the oldest map.'],
          shadowedTurns: { start: 1, end: 1 },
        }],
      })
    } finally {
      await context.fiber.dispose()
    }
  })
})
