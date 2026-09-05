/** Durable Character Card opening greeting projected into the shared Chat flow. */

import type {
  ConversationLocation,
  ConversationNodeContext,
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { TavernGreetingEvent } from '@deepseek-ai/dsh-tavern-host/client'
import type {} from '@deepseek-ai/dsh-tavern-host/client'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { memo } from 'react'
import type { ReactElement } from 'react'
import { portraitFor } from './artwork.ts'
import css from './greeting.module.css'

interface TavernGreetingChatData {
  readonly characterName: string
  readonly text: string
  readonly time: number
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** First greeting selected from a Character Card. */
    'tavern-greeting': TavernGreetingChatData
  }
}

function locationOf(context: ConversationNodeContext): ConversationLocation {
  return context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' }
}

function dataOf(event: TavernGreetingEvent, time: number): TavernGreetingChatData {
  return { characterName: event.characterName, text: event.text, time }
}

/** One-event Definition for a durable Character Card opening greeting. */
export const tavernGreetingDefinition: ConversationNodeDefinition<TavernGreetingChatData> = {
  kind: 'tavern-greeting',
  target: 'chat',
  match: event => event.type === 'tavern/greeting'
    ? { id: String(event.seq), role: 'start' }
    : null,
  start: (_context, match) => {
    if (match.event.type !== 'tavern/greeting') throw new Error('tavern-greeting requires tavern/greeting')
    return dataOf(match.event.data, match.event.time)
  },
  update: context => context.state,
  buildViewNode: (context): ChatConversationViewNode | null => {
    if (context.state === undefined || context.start === undefined) return null
    return {
      key: context.key,
      kind: 'tavern-greeting',
      id: context.id,
      target: 'chat',
      anchorSeq: context.start.event.seq,
      location: locationOf(context),
      visibility: 'visible',
      data: context.state,
    }
  },
}

/** Render the Character Card greeting as an assistant-style row. */
export const TavernGreetingNodeView = memo(function TavernGreetingNodeView({
  node,
}: ChatNodeViewProps<'tavern-greeting'>): ReactElement {
  return (
    <div className={css.row} data-tavern-greeting="">
      <div className={css.avatar} aria-hidden="true">
        <img src={portraitFor(node.data.characterName)} alt="" />
      </div>
      <div className={css.body}>
        <div className={css.name}>{node.data.characterName}</div>
        <div className={css.bubble}>{node.data.text}</div>
      </div>
    </div>
  )
})
