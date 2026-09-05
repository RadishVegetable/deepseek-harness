import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type {
  ChatSnapshot, ConversationEventInput, ConversationNodeDefinition, ConversationViewDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-runtime/client'
import { registerTavernConversation } from '../src/client/tavern-conversation.ts'

const definitions: ConversationNodeDefinition[] = []
let chatView: ConversationViewDefinition | undefined
registerTavernConversation({
  conversationEvents: {
    register: (definition: ConversationNodeDefinition) => {
      definitions.push(definition)
      return () => {}
    },
  },
  conversationViews: {
    register: (definition: ConversationViewDefinition) => {
      chatView = definition
      return () => {}
    },
  },
} as unknown as Context)

function at(seq: number, type: string, data: unknown, extra: Record<string, unknown> = {}): ConversationEventInput {
  return {
    event: { seq, time: 1_700_000_000_000 + seq, type, data, ...extra } as unknown as ConversationEventInput['event'],
    view: undefined,
  }
}

function createAssembler(): ConversationNodeAssembler {
  if (chatView === undefined) throw new Error('Tavern chat view was not registered')
  return new ConversationNodeAssembler(
    { entries: () => definitions, fallbackEntry: () => undefined },
    { entries: () => [chatView as ConversationViewDefinition] },
  )
}

function assemble(events: readonly ConversationEventInput[]): ChatSnapshot {
  const assembler = createAssembler()
  assembler.replaceWindow(events, false)
  assembler.flush()
  const snapshot = assembler.snapshot('chat') as ChatSnapshot | undefined
  if (snapshot === undefined) throw new Error('Tavern chat snapshot was not built')
  return snapshot
}

function userMessage() {
  return {
    id: 'user-1',
    role: 'user',
    content: [{ type: 'text', text: 'Say hello briefly.' }],
    source: { kind: 'user' },
  }
}

describe('Tavern conversation projection', () => {
  it('projects the accepted prompt and a successful GM message into the Journey transcript', () => {
    const snapshot = assemble([
      at(1, 'user/message', userMessage(), { surfaceOp: 'append' }),
      at(2, 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'text-delta', index: 0, text: 'Hello.' },
      }),
      at(3, 'assistant/message', {
        turn: 1,
        step: 1,
        message: {
          id: 'assistant-1',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello.' }],
          source: { kind: 'model', provider: 'fixture', model: 'fixture' },
        },
      }, { surfaceOp: 'append' }),
      at(4, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ])

    expect(snapshot.legacy.nodes).toMatchObject([
      { kind: 'user', content: [{ type: 'text', text: 'Say hello briefly.' }] },
      { kind: 'assistant', blocks: [{ kind: 'text', text: 'Hello.' }] },
    ])
  })

  it('keeps the prompt and exposes the final error after a retry chain ends', () => {
    const snapshot = assemble([
      at(1, 'user/message', userMessage(), { surfaceOp: 'append' }),
      at(2, 'llm/retry', {
        retryId: 'retry-1',
        turn: 1,
        step: 1,
        provider: 'fixture',
        mode: 'normal',
        policyKey: 'fixture-normal',
        retry: 1,
        maxRetries: 1,
        delayMs: 10,
        failure: { code: 'TRANSPORT', message: 'provider unavailable' },
      }),
      at(3, 'llm/retry-started', { retryId: 'retry-1', turn: 1, step: 1, retry: 1 }),
      at(4, 'turn/end', {
        turn: 1,
        reason: { kind: 'error', error: { code: 'TRANSPORT', message: 'provider unavailable' } },
      }),
    ])

    expect(snapshot.legacy.nodes).toMatchObject([
      { kind: 'user', content: [{ type: 'text', text: 'Say hello briefly.' }] },
      { kind: 'turn-error', message: 'provider unavailable', code: 'TRANSPORT' },
    ])
  })

  it('withdraws a failed partial during retry and exposes the final failure without assembler churn', () => {
    const assembler = createAssembler()
    assembler.replaceWindow([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'user/message', userMessage(), { surfaceOp: 'append' }),
      at(3, 'step/start', { turn: 1, step: 1 }),
      at(4, 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'text-delta', index: 0, text: 'partial' },
      }),
    ], false)
    assembler.flush()
    expect((assembler.snapshot('chat') as ChatSnapshot).legacy.partial?.blocks).toEqual([
      { kind: 'text', text: 'partial' },
    ])

    assembler.append(at(5, 'llm/retry', {
      retryId: 'retry-1',
      turn: 1,
      step: 1,
      provider: 'fixture',
      mode: 'normal',
      policyKey: 'fixture-normal',
      retry: 1,
      maxRetries: 1,
      delayMs: 10,
      failure: { code: 'TRANSPORT', message: 'provider unavailable' },
    }))
    assembler.flush()
    expect((assembler.snapshot('chat') as ChatSnapshot).legacy.partial).toBeNull()

    assembler.append(at(6, 'turn/end', {
      turn: 1,
      reason: { kind: 'error', error: { code: 'TRANSPORT', message: 'provider unavailable' } },
    }))
    assembler.flush()
    expect((assembler.snapshot('chat') as ChatSnapshot).legacy.nodes).toMatchObject([
      { kind: 'user' },
      { kind: 'turn-error', message: 'provider unavailable' },
    ])
  })
})
