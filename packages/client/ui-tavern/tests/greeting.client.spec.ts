import { describe, expect, it } from 'vitest'
import type { ConversationEventInput, ConversationNodeContext } from '@deepseek-ai/dsh-client-runtime/client'
import { tavernGreetingDefinition } from '../src/client/greeting.tsx'

function input(): ConversationEventInput {
  return {
    event: {
      type: 'tavern/greeting',
      seq: 4,
      time: 1_700_000_000_004,
      data: {
        characterId: 'aria',
        characterName: 'Aria Vale',
        text: 'Welcome to the archive.',
        selectionSeq: 3,
      },
    } as never,
    view: undefined,
  }
}

describe('Tavern greeting conversation Definition', () => {
  it('projects one durable greeting into a Chat node without creating a second message path', () => {
    const event = input().event
    const match = tavernGreetingDefinition.match(event)
    expect(match).toEqual({ id: '4', role: 'start' })
    if (match === null) throw new Error('greeting event did not match')

    const location = { kind: 'unresolved' as const }
    const fullMatch = { event, view: undefined, role: match.role, location }
    const state = tavernGreetingDefinition.start(
      {} as never,
      fullMatch,
      { previous: () => undefined },
    )
    const context = {
      key: '15:tavern-greeting4',
      kind: 'tavern-greeting',
      id: '4',
      matches: [fullMatch],
      start: fullMatch,
      state,
      current: new Map(),
    } as unknown as ConversationNodeContext<typeof state>
    const node = tavernGreetingDefinition.buildViewNode?.(context)

    expect(node).toMatchObject({
      kind: 'tavern-greeting',
      anchorSeq: 4,
      data: { characterName: 'Aria Vale', text: 'Welcome to the archive.' },
    })
  })

  it('ignores unrelated events', () => {
    expect(tavernGreetingDefinition.match({
      type: 'turn/start',
      seq: 1,
      time: 1,
      data: {} as never,
    })).toBeNull()
  })
})
