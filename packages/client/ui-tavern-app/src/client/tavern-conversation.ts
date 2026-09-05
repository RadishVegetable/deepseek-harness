import type { Context } from '@deepseek-ai/cordis'
import type {
  AssistantBlock, AssistantMessageNode, ChatConversationViewNode, ChatLocationNodeIndex,
  ChatNodeStore, ChatSnapshot, ConversationLocation, ConversationMatch, ConversationNodeContext,
  ConversationNodeDefinition, ConversationViewBuilder, ConversationViewDefinition,
  ConversationTimelineSnapshot, PartialAssistant, TurnErrorNode, UserMessageNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  displayFailureMessage, emptyAssistantBlock, isAppendSurfaceEvent, toAssistantBlock,
  toAssistantBlocks,
} from '@deepseek-ai/dsh-client-runtime/client'

type TavernEvent = Parameters<ConversationNodeDefinition['match']>[0]

interface TavernViewNode extends ChatConversationViewNode {
  readonly data: TavernNodeData
}

interface TavernPartial {
  readonly kind: 'partial'
  readonly turn: number
  readonly step: number
  readonly blocks: readonly AssistantBlock[]
}

type TavernNodeData = UserMessageNode | AssistantMessageNode | TurnErrorNode | TavernPartial

function locationOf(context: ConversationNodeContext): ConversationLocation {
  return context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' }
}

function viewNode(
  context: ConversationNodeContext,
  kind: string,
  anchorSeq: number,
  data: TavernNodeData,
): TavernViewNode {
  return {
    key: context.key,
    kind,
    id: context.id,
    target: 'chat',
    anchorSeq,
    location: locationOf(context),
    visibility: 'visible',
    data,
  }
}

function hiddenViewNode(
  context: ConversationNodeContext,
  kind: string,
  anchorSeq: number,
  data: TavernNodeData,
): TavernViewNode {
  return { ...viewNode(context, kind, anchorSeq, data), visibility: 'hidden' }
}

const userMessageDefinition: ConversationNodeDefinition<UserMessageNode> = {
  kind: 'tavern-user-message',
  target: 'chat',
  match: event => event.type === 'user/message'
    && isAppendSurfaceEvent(event)
    && event.data.source.kind === 'user'
    ? { id: String(event.data.id), role: 'start' }
    : null,
  start: (_context, match) => {
    if (match.event.type !== 'user/message') throw new Error('tavern-user-message start requires user/message')
    return {
      kind: 'user',
      seq: match.event.seq,
      time: match.event.time,
      content: match.event.data.content,
      source: match.event.data.source,
    }
  },
  update: context => context.state,
  buildViewNode: (context) => {
    if (context.state === undefined) return null
    return viewNode(context, 'tavern-user', context.state.seq, context.state)
  },
}

interface AssistantState {
  readonly turn: number
  readonly step: number
  readonly blocks: readonly (AssistantBlock | undefined)[]
  readonly final: ConversationMatch | undefined
}

function compactBlocks(blocks: readonly (AssistantBlock | undefined)[]): AssistantBlock[] {
  return blocks.filter((block): block is AssistantBlock => block !== undefined)
}

function hasVisibleContent(blocks: readonly AssistantBlock[]): boolean {
  return blocks.some(block => (block.kind === 'text' || block.kind === 'reasoning')
    ? block.text.trim() !== ''
    : block.kind !== 'tool-call')
}

function updateAssistantChunk(state: AssistantState, match: ConversationMatch): AssistantState {
  if (match.event.type !== 'assistant/chunk') return state
  const blocks = [...state.blocks]
  const chunk = match.event.data.chunk
  switch (chunk.type) {
    case 'block-start':
      blocks[chunk.index] = emptyAssistantBlock(chunk.blockType)
      break
    case 'text-delta': {
      const previous = blocks[chunk.index]
      blocks[chunk.index] = {
        kind: 'text',
        text: (previous?.kind === 'text' ? previous.text : '') + chunk.text,
      }
      break
    }
    case 'reasoning-delta': {
      const previous = blocks[chunk.index]
      blocks[chunk.index] = {
        kind: 'reasoning',
        text: (previous?.kind === 'reasoning' ? previous.text : '') + chunk.text,
      }
      break
    }
    case 'block-end':
      blocks[chunk.index] = toAssistantBlock(chunk.block)
      break
    case 'tool-call-delta': {
      const previous = blocks[chunk.index]
      const base = previous?.kind === 'tool-call'
        ? previous
        : { kind: 'tool-call' as const, callId: '', name: '', argsRaw: '' }
      blocks[chunk.index] = {
        kind: 'tool-call',
        callId: base.callId || String(chunk.id),
        name: chunk.name ?? base.name,
        argsRaw: base.argsRaw + chunk.argumentsDelta,
      }
      break
    }
    case 'usage':
    case 'finish':
      break
    default:
      return state
  }
  return { ...state, blocks }
}

function finalAssistant(state: AssistantState): AssistantMessageNode | undefined {
  if (state.final?.event.type !== 'assistant/message') return undefined
  const event = state.final.event
  return {
    kind: 'assistant',
    seq: event.seq,
    messageId: event.data.message.id,
    time: event.time,
    turn: state.turn,
    step: state.step,
    blocks: toAssistantBlocks(event.data.message.content),
    usage: event.data.usage,
  }
}

function fallbackAssistantState(context: ConversationNodeContext<AssistantState>): AssistantState | undefined {
  let state: AssistantState | undefined
  for (const match of context.matches) {
    if (match.event.type === 'assistant/chunk') {
      state ??= {
        turn: match.event.data.turn,
        step: match.event.data.step,
        blocks: [],
        final: undefined,
      }
      state = updateAssistantChunk(state, match)
      continue
    }
    if (match.event.type === 'assistant/message') {
      state ??= {
        turn: match.event.data.turn,
        step: match.event.data.step,
        blocks: [],
        final: undefined,
      }
      state = {
        ...state,
        blocks: toAssistantBlocks(match.event.data.message.content),
        final: match,
      }
      continue
    }
    if (match.event.type === 'llm/retry' && state !== undefined) {
      state = { ...state, blocks: [], final: undefined }
    }
  }
  return state
}

const assistantDefinition: ConversationNodeDefinition<AssistantState> = {
  kind: 'tavern-assistant-step',
  target: 'chat',
  match: (event) => {
    if (event.type === 'step/start') return { id: `${event.data.turn}:${event.data.step}`, role: 'start' }
    if (event.type === 'assistant/chunk'
      || (event.type === 'assistant/message' && isAppendSurfaceEvent(event))) {
      return { id: `${event.data.turn}:${event.data.step}`, role: 'update' }
    }
    if (event.type === 'llm/retry') return { id: `${event.data.turn}:${event.data.step}`, role: 'update' }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'step/start') throw new Error('tavern-assistant-step start requires step/start')
    return { turn: match.event.data.turn, step: match.event.data.step, blocks: [], final: undefined }
  },
  update: (context, match) => {
    if (match.event.type === 'assistant/chunk') return updateAssistantChunk(context.state, match)
    if (match.event.type === 'assistant/message') {
      return { ...context.state, final: match, blocks: toAssistantBlocks(match.event.data.message.content) }
    }
    if (match.event.type === 'llm/retry') return { ...context.state, blocks: [], final: undefined }
    return context.state
  },
  buildViewNode: (context) => {
    const state = context.state ?? fallbackAssistantState(context)
    if (state === undefined) return null
    const final = finalAssistant(state)
    if (final !== undefined) return viewNode(context, 'tavern-assistant', final.seq, final)
    const blocks = compactBlocks(state.blocks)
    if (!hasVisibleContent(blocks)) {
      const current = context.current.get('chat')
      if (current === undefined || current === null) return null
      const hidden: TavernPartial = { kind: 'partial', turn: state.turn, step: state.step, blocks: [] }
      return hiddenViewNode(context, 'tavern-partial', context.matches[0]?.event.seq ?? 0, hidden)
    }
    const partial: TavernPartial = { kind: 'partial', turn: state.turn, step: state.step, blocks }
    return viewNode(context, 'tavern-partial', context.matches[0]?.event.seq ?? 0, partial)
  },
}

interface TurnErrorState {
  readonly turn: number
  readonly hidden: boolean
  readonly failure?: TurnErrorNode
}

function failureFrom(match: ConversationMatch): TurnErrorNode | undefined {
  if (match.event.type !== 'turn/end' || match.event.data.reason.kind !== 'error') return undefined
  const failure = match.event.data.reason.error
  return {
    kind: 'turn-error',
    seq: match.event.seq,
    time: match.event.time,
    turn: match.event.data.turn,
    step: 0,
    message: displayFailureMessage(failure),
    code: failure.code,
  }
}

function fallbackTurnErrorState(context: ConversationNodeContext<TurnErrorState>): TurnErrorState | undefined {
  let state: TurnErrorState | undefined
  for (const match of context.matches) {
    const failure = failureFrom(match)
    if (failure !== undefined && match.event.type === 'turn/end') {
      state = { turn: match.event.data.turn, hidden: false, failure }
      continue
    }
    const turn = retryTurn(match.event)
    if (turn !== undefined) {
      state = state === undefined
        ? { turn, hidden: true }
        : state.turn === turn ? { ...state, hidden: true } : state
    }
  }
  return state
}

function retryTurn(event: TavernEvent): number | undefined {
  return event.type === 'llm/retry' || event.type === 'llm/retry-started' ? event.data.turn : undefined
}

const turnErrorDefinition: ConversationNodeDefinition<TurnErrorState> = {
  kind: 'tavern-turn-error',
  target: 'chat',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    const failure = event.type === 'turn/end' && event.data.reason.kind === 'error'
    const retry = retryTurn(event)
    return failure || retry !== undefined
      ? { id: String(failure ? event.data.turn : retry), role: 'update' }
      : null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('tavern-turn-error start requires turn/start')
    return { turn: match.event.data.turn, hidden: false }
  },
  update: (context, match) => {
    const failure = failureFrom(match)
    if (failure !== undefined) return { ...context.state, hidden: false, failure }
    return retryTurn(match.event) === context.state.turn ? { ...context.state, hidden: true } : context.state
  },
  buildViewNode: (context) => {
    const state = context.state ?? fallbackTurnErrorState(context)
    if (state === undefined || state.failure === undefined) return null
    const failure = state.failure
    if (state.hidden) {
      const current = context.current.get('chat')
      return current === undefined || current === null
        ? null
        : hiddenViewNode(context, 'tavern-turn-error', failure.seq, failure)
    }
    return viewNode(context, 'tavern-turn-error', failure.seq, failure)
  },
}

class TavernChatSnapshotBuilder implements ConversationViewBuilder<TavernViewNode, ChatSnapshot> {
  private readonly byKey = new Map<string, TavernViewNode>()

  readonly empty: ChatSnapshot = this.snapshot({ turnOrder: [], turns: new Map() })

  replace(input: { readonly nodes: readonly TavernViewNode[]; readonly timeline: ConversationTimelineSnapshot }): ChatSnapshot {
    this.byKey.clear()
    for (const node of input.nodes) this.byKey.set(node.key, node)
    return this.snapshot(input.timeline)
  }

  apply(input: { readonly upserts: readonly TavernViewNode[]; readonly timeline: ConversationTimelineSnapshot }): ChatSnapshot {
    for (const node of input.upserts) this.byKey.set(node.key, node)
    return this.snapshot(input.timeline)
  }

  private snapshot(timeline: ConversationTimelineSnapshot): ChatSnapshot {
    const ordered = [...this.byKey.values()]
      .filter(node => node.visibility === 'visible')
      .sort((left, right) => left.anchorSeq - right.anchorSeq || left.key.localeCompare(right.key))
    const nodes: ConversationNodeData[] = []
    let partial: PartialAssistant | null = null
    for (const node of ordered) {
      if (node.data.kind === 'partial') {
        partial = node.data
      } else {
        nodes.push(node.data)
      }
    }
    const store: ChatNodeStore = {
      get: key => this.byKey.get(key),
      values: () => [...this.byKey.values()],
    }
    const locations: ChatLocationNodeIndex = { getTurn: () => [], getStep: () => [] }
    return {
      order: ordered.map(node => node.key),
      nodes: store,
      locations,
      timeline,
      legacy: { nodes, turnTimings: new Map(), turnEnds: new Map(), partial, runningCalls: [] },
    }
  }
}

type ConversationNodeData = Exclude<TavernNodeData, TavernPartial>

const chatViewDefinition: ConversationViewDefinition<TavernViewNode, ChatSnapshot> = {
  target: 'chat',
  create: () => new TavernChatSnapshotBuilder(),
}

/**
 * Register the Tavern transcript projection without mounting the generic conversation UI.
 * @param ctx - client context owning the Tavern conversation registries.
 */
export function registerTavernConversation(ctx: Context): void {
  ctx.conversationEvents.register(userMessageDefinition)
  ctx.conversationEvents.register(assistantDefinition)
  ctx.conversationEvents.register(turnErrorDefinition)
  ctx.conversationViews.register(chatViewDefinition)
}
