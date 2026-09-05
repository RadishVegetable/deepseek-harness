import { describe, expect, it } from 'vitest'
import { CompactionId, compactCheckpointSource } from '@deepseek-ai/dsh-compaction'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { TavernMemoryInspection } from '../src/client.ts'
import { TavernAssetService } from '../src/index.ts'

function inspect(session: Session): TavernMemoryInspection {
  const result = TavernAssetService.prototype.remoteInspectMemory.call({}, { session } as unknown as Agent)
  return result
}

describe('Tavern memory checkpoint Remote', () => {
  it('returns an empty list when no checkpoint is paired with the summary', () => {
    const session = Session.create(SessionId('memory-no-checkpoint'))
    const transcript = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '【前情提要】\nA transcript line is not a checkpoint.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('compaction/summary', {
      compactionId: CompactionId('missing-checkpoint'),
      summary: [{ type: 'text', text: '【前情提要】\nA transcript line is not a checkpoint.' }],
      shadowedRange: { start: transcript.seq, end: transcript.seq },
      shadowedSeqs: [transcript.seq],
      shadowedTokenCount: 1,
      provider: 'test',
      model: 'test',
    })

    expect(inspect(session)).toEqual({ checkpoints: [] })
  })

  it('rebuilds one plot checkpoint from the matching summary and source message', () => {
    const session = Session.create(SessionId('memory-valid-checkpoint'))
    session.append('turn/start', { turn: 1 })
    const user = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Enter the archive.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('step/start', { turn: 1, step: 1 })
    const assistant = session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text: 'The archive door opens.' }],
        source: { provider: 'test', model: 'test' },
      }),
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    const compactionId = CompactionId('valid-checkpoint')
    session.append('compaction/start', { compactionId, turn: null })
    const checkpointText = '【前情提要】\nThe party reached the archive.\n【未决伏笔】\n- Who hid the key?'
    const summary = session.append('compaction/summary', {
      compactionId,
      summary: [{ type: 'text', text: checkpointText }],
      shadowedRange: { start: user.seq, end: assistant.seq },
      shadowedSeqs: [user.seq, assistant.seq],
      shadowedTokenCount: 5,
      provider: 'test',
      model: 'test',
    })
    const checkpoint = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: checkpointText }],
      source: compactCheckpointSource(compactionId),
    }), {
      surfaceOp: { op: 'replace', start: user.seq, end: assistant.seq },
      sourceEventSeqs: [summary.seq, user.seq, assistant.seq],
    })
    session.append('compaction/end', { compactionId, turn: null })

    expect(inspect(session)).toEqual({
      checkpoints: [{
        compactionId,
        summarySeq: summary.seq,
        checkpointSeq: checkpoint.seq,
        plotSummary: 'The party reached the archive.',
        openThreads: ['Who hid the key?'],
        shadowedTurns: { start: 1, end: 1 },
      }],
    })
  })
})
