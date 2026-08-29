import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createAssistantMessage, createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { assembleContextFor } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TavernAssetHost, TavernAssetService } from '../src/index.ts'
import {
  appendTavernGreeting,
  appendTavernAssistantCandidate,
  resolveTavernContextActivation,
  resolveTavernGreeting,
  resolveTavernMemory,
  resolveTavernStoryState,
  resolveTavernSwipe,
} from '../src/session.ts'
import { renderTavernPersona } from '../src/runtime.ts'
import type { AssetId } from '@deepseek-ai/dsh-tavern-assets'
import { sourceEventId, storyEntityId, swipeCandidateId, swipeGroupId } from '@deepseek-ai/dsh-tavern-state'

class TavernTestAdapter extends LlmAdapter {
  constructor(private readonly replies: string[]) { super() }

  override resolveModel(provider: string, model: string) {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    const reply = this.replies[0]
    if (reply === undefined) throw new Error('TavernTestAdapter: script exhausted')
    this.replies.shift()
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: reply }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: reply.length } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const tavernTestRoots: string[] = []

afterEach(async () => {
  for (const root of tavernTestRoots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function persistentTavernHarness(root: string, replies: string[]): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend())
  const domain = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', domain)
  ctx.provide('storageDomain', domain)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  ctx.llm.registerAdapter(['mock'], new TavernTestAdapter(replies))
  await ctx.plugin(TavernAssetService)
  return ctx
}

const character = {
  spec: 'chara_card_v2',
  spec_version: '2.0',
  data: {
    name: 'Aria Vale',
    description: 'A patient archivist.',
    personality: 'Careful and direct.',
    scenario: 'An archive at midnight.',
    first_mes: 'Welcome.',
    system_prompt: 'Remain in character.',
    post_history_instructions: 'Keep answers focused.',
    character_book: {
      name: 'Embedded Book',
      entries: { one: { uid: 1, key: ['archive'], content: 'Treaties are kept here.' } },
    },
  },
}

const world = {
  name: 'Archive Book',
  entries: { one: { uid: 1, key: ['archive'], content: 'The archive is old.', insertion_order: 4 } },
}

describe('TavernAssetHost', () => {
  it('edits a direct user message and removes its stale continuation', () => {
    const session = Session.create(SessionId('remote-edit'))
    const target = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'original question' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text: 'stale answer' }],
        source: { provider: 'test', model: 'test' },
      }),
    }, { surfaceOp: 'append' })
    const agent = { session } as unknown as Agent

    const result = TavernAssetService.prototype.remoteEditMessage.call({}, agent, {
      targetSeq: target.seq,
      text: ' revised question ',
    })

    expect(result).toEqual({ targetSeq: target.seq })
    expect(session.deriveMessages().map(message => message.content[0])).toEqual([
      { type: 'text', text: 'revised question' },
    ])
    expect(session.events.some(event => event.type === 'message/edit')).toBe(true)
    expect(() => TavernAssetService.prototype.remoteEditMessage.call({}, agent, {
      targetSeq: target.seq,
      text: '   ',
    })).toThrow(/must not be empty/)
  })

  it('edits a message folded into a summary and removes the stale summary', () => {
    const session = Session.create(SessionId('remote-edit-summary'))
    const first = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'first question' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const target = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'second question' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const third = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'third question' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'folded summary' }],
      source: { kind: 'plugin', plugin: 'compact' },
    }), {
      surfaceOp: { op: 'replace', start: first.seq, end: third.seq },
      sourceEventSeqs: [first.seq, target.seq, third.seq],
    })
    expect(session.deriveMessages().map(message => message.content[0])).toEqual([
      { type: 'text', text: 'folded summary' },
    ])

    const result = TavernAssetService.prototype.remoteEditMessage.call({}, { session } as unknown as Agent, {
      targetSeq: target.seq,
      text: 'revised question',
    })

    expect(result).toEqual({ targetSeq: target.seq })
    expect(session.deriveMessages().map(message => message.content[0])).toEqual([
      { type: 'text', text: 'first question' },
      { type: 'text', text: 'revised question' },
    ])
    expect(session.deriveMessages().some(message => message.content[0] === third.data.content[0])).toBe(false)
    expect(session.events.some(event => event.type === 'message/edit')).toBe(true)
  })

  it('rejects non-direct messages through the Tavern edit Remote', () => {
    const session = Session.create(SessionId('remote-edit-reject'))
    const injected = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'injected' }],
      source: { kind: 'plugin', plugin: 'test' },
    }), { surfaceOp: 'append' })
    const agent = { session } as unknown as Agent

    expect(() => TavernAssetService.prototype.remoteEditMessage.call({}, agent, {
      targetSeq: injected.seq,
      text: 'changed',
    })).toThrow(/not a direct user message/)
  })

  it('maps numeric legacy World Info positions into prompt insertion positions', () => {
    const host = new TavernAssetHost()
    const imported = host.importWorldInfo({
      entries: { zero: { uid: 0, key: ['zero'], content: 'zero', position: 0 } },
    })

    expect(imported.asset.entries[0]?.position).toBe('before-character')
  })

  it('imports and lists normalized character and World Info assets', () => {
    const host = new TavernAssetHost()
    const importedCharacter = host.importCharacter(character, { source: { kind: 'upload', locator: 'aria.json' } })
    const importedWorld = host.importWorldInfo(world)

    expect(importedCharacter.asset.id).toBe('aria-vale')
    expect(importedCharacter.asset.sourceReferences[0]?.locator).toBe('aria.json')
    expect(host.listCharacters().map(asset => asset.name)).toEqual(['Aria Vale'])
    expect(host.listWorldInfo().map(asset => asset.id)).toEqual([importedWorld.asset.id])
  })

  it('keeps optional Character Card strings present for strict Remote codecs', () => {
    const host = new TavernAssetHost()
    const imported = host.importCharacter({
      spec: 'chara_card_v3',
      data: { name: 'Minimal', first_mes: 'Hello' },
    })

    expect(imported.asset).toMatchObject({ creatorNotes: '', messageExamples: '' })
    expect(host.listCharacters()[0]).toMatchObject({ creatorNotes: '', messageExamples: '' })
  })

  it('selects and inspects the same source-tracked baseline', () => {
    const host = new TavernAssetHost()
    const card = host.importCharacter(character, { id: 'aria' })
    const book = host.importWorldInfo(world, { id: 'archive' })
    const selection = { characterId: card.asset.id, worldInfoIds: [book.asset.id] }
    const inspection = host.inspectSelection(selection)

    expect(host.select(selection)).toEqual(inspection.baseline)
    expect(inspection.character?.id).toBe('aria')
    expect(inspection.worldInfo.map(asset => asset.id)).toEqual(['archive'])
    expect(inspection.baseline.references).toHaveLength(2)
  })

  it('does not register embedded character books implicitly and disposes imports', () => {
    const host = new TavernAssetHost()
    const imported = host.importCharacter(character)
    expect(host.listWorldInfo()).toEqual([])
    imported.dispose()
    expect(host.listCharacters()).toEqual([])
  })

  it('uses explicit IDs to make repeated names unambiguous', () => {
    const host = new TavernAssetHost()
    const first = host.importWorldInfo(world, { id: 'archive-a' })
    const second = host.importWorldInfo(world, { id: 'archive-b' })
    expect([first.asset.id, second.asset.id]).toEqual(['archive-a', 'archive-b'])
    expect(() => host.select({ characterId: null, worldInfoIds: ['archive-a', 'missing'] as AssetId[] }))
      .toThrow(/was not found/)
  })

  it('replaces and exports an asset without losing the stable ID', () => {
    const host = new TavernAssetHost()
    host.importCharacter(character, { id: 'aria' })
    const updated = host.updateCharacter({
      ...character,
      data: { ...character.data, name: 'Aria Updated', description: 'A revised archivist.' },
    }, { id: 'aria' })

    expect(updated.asset.id).toBe('aria')
    expect(host.registry.getCharacter('aria' as AssetId)?.name).toBe('Aria Updated')
    expect(JSON.parse(host.exportCharacter('aria' as AssetId)).data.name).toBe('Aria Updated')
  })

  it('records one opening greeting for an empty session and replays it into the persona', () => {
    const host = new TavernAssetHost()
    const card = host.importCharacter(character, { id: 'aria' }).asset
    const session = Session.create(SessionId('greeting-empty'))
    session.append('tavern/assets-selected', {
      selection: { characterId: card.id, worldInfoIds: [] },
      baseline: host.select({ characterId: card.id, worldInfoIds: [] }),
      characterName: card.name,
      worldInfoNames: [],
    })

    const greeting = { characterId: card.id, characterName: card.name, text: card.firstMessage, selectionSeq: 0 }
    const event = appendTavernGreeting(session, greeting)
    expect(event?.type).toBe('tavern/greeting')
    expect(resolveTavernGreeting(session)).toEqual(greeting)
    expect(appendTavernGreeting(session, greeting)).toBeUndefined()
    expect(renderTavernPersona(session)).toContain('opening-greeting:\nWelcome.')
    expect(renderTavernPersona(session)).not.toContain('first-message:')
  })

  it('resolves Tavern macros without leaking them into Harness prompt variables', () => {
    const host = new TavernAssetHost()
    const card = host.importCharacter({
      spec: 'chara_card_v3',
      data: {
        name: 'Macro Card',
        description: 'Example {{char}} with {{user}} and {{unsupported_macro}}.',
        first_mes: 'Welcome, {{user}}.',
        mes_example: '{{char}}: Hello, {{user}}.',
      },
    }, { id: 'macro-card' }).asset
    const session = Session.create(SessionId('macro-card-session'))
    session.append('tavern/assets-selected', {
      selection: { characterId: card.id, worldInfoIds: [] },
      baseline: host.select({ characterId: card.id, worldInfoIds: [] }),
      characterName: card.name,
      worldInfoNames: [],
    })

    const persona = renderTavernPersona(session)
    expect(persona).toContain('Example Macro Card with User and {unsupported_macro}.')
    expect(persona).not.toContain('{{')
    expect(persona).not.toContain('}}')
  })

  it('resolves Character Card macros before the live AgentLoop prompt renderer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tavern-macro-live-'))
    tavernTestRoots.push(root)
    const ctx = await persistentTavernHarness(root, ['Live response'])
    const handle = await ctx.agents.create({
      sessionId: SessionId('macro-live-session'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const card = ctx.tavernAssets.host.importCharacter({
      spec: 'chara_card_v3',
      data: {
        name: 'Live Macro Card',
        description: 'The character is {{ char }} and the player is {{user}}.',
        first_mes: 'Welcome, {{user}}.',
      },
    }, { id: 'live-macro-card' }).asset

    ctx.tavernAssets.remoteSelectForSession(handle.agent, {
      characterId: card.id,
      worldInfoIds: [],
    })
    const rendered = renderPrompt(await ctx.systemPrompt.assemble(assembleContextFor(handle.agent)))

    expect(rendered).toContain('The character is Live Macro Card and the player is User.')
    expect(rendered).not.toContain('{{char}}')
    expect(rendered).not.toContain('{{user}}')

    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'Continue the scene.' }],
      source: { kind: 'user' },
    }))
    await handle.agent.whenIdle()
    const turnEnd = handle.agent.session.events.findLast(event => event.type === 'turn/end')
    expect(turnEnd?.type === 'turn/end' && turnEnd.data.reason.kind).toBe('completed')
    await ctx.fiber.dispose()
  })

  it('matches World Info against the current first-turn message', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tavern-world-live-'))
    tavernTestRoots.push(root)
    const ctx = await persistentTavernHarness(root, ['World response'])
    const handle = await ctx.agents.create({
      sessionId: SessionId('world-live-session'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const card = ctx.tavernAssets.host.importCharacter(character, { id: 'world-live-card' }).asset
    const book = ctx.tavernAssets.host.importWorldInfo(world, { id: 'world-live-book' }).asset

    ctx.tavernAssets.remoteSelectForSession(handle.agent, {
      characterId: card.id,
      worldInfoIds: [book.id],
    })
    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'The archive door opens.' }],
      source: { kind: 'user' },
    }))
    await handle.agent.whenIdle()

    const activation = resolveTavernContextActivation(handle.agent.session)
    expect(activation?.query).toContain('archive')
    expect([...activation?.compiled.dynamicSuffix ?? []].map(source => source.text)).toContain('The archive is old.')
    const runtimeContext = handle.agent.session.events.find(event =>
      event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && event.data.source.plugin === '@deepseek-ai/dsh-system-prompt')
    expect(runtimeContext?.type === 'user/message'
      && runtimeContext.data.content.some(block => block.type === 'text' && block.text.includes('The archive is old.'))).toBe(true)
    await ctx.fiber.dispose()
  })

  it('does not add an opening greeting after conversation content exists', () => {
    const host = new TavernAssetHost()
    const card = host.importCharacter(character, { id: 'aria' }).asset
    const session = Session.create(SessionId('greeting-active'))
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'The archive door opens.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    expect(appendTavernGreeting(session, {
      characterId: card.id,
      characterName: card.name,
      text: card.firstMessage,
      selectionSeq: 1,
    })).toBeUndefined()
    expect(resolveTavernGreeting(session)).toBeUndefined()
    expect(renderTavernPersona(session)).not.toContain('opening-greeting:')
  })

  it('replays memory and story-state events into their durable projections', () => {
    const session = Session.create(SessionId('state-session'))
    session.append('tavern/memory', {
      operation: 'upsert',
      memory: { id: 'oath', text: 'The oath is binding.', level: 'pinned', enabled: true, label: null },
    })
    session.append('tavern/story-state', {
      branch: String(session.id),
      change: {
        kind: 'location.set',
        location: { id: storyEntityId('harbor'), name: 'South Harbor', extensions: {} },
        extensions: {},
      },
      authority: { kind: 'user', extensions: {} },
      validity: { status: 'valid', extensions: {} },
    })

    expect(resolveTavernMemory(session)).toEqual([{
      id: 'oath', text: 'The oath is binding.', level: 'pinned', enabled: true, label: null,
    }])
    expect(resolveTavernStoryState(session).state.location?.name).toBe('South Harbor')
  })

  it('retains one selected assistant candidate per completed turn', () => {
    const session = Session.create(SessionId('swipe-session'))
    session.append('turn/start', { turn: 1 })
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text: 'The archive door opens.' }],
        source: { provider: 'test', model: 'test' },
      }),
    }, { surfaceOp: 'append' })

    appendTavernAssistantCandidate(session, 1)
    appendTavernAssistantCandidate(session, 1)

    const projection = resolveTavernSwipe(session)
    expect(projection.issues).toEqual([])
    expect(projection.state.groups[0]?.candidates).toHaveLength(1)
    expect(projection.state.groups[0]?.currentCandidateId).toBe(
      projection.state.groups[0]?.candidates[0]?.candidateId,
    )
    expect(session.events.filter(event => event.type === 'tavern/swipe')).toHaveLength(2)
  })

  it('projects parent candidates and child swipe candidates through seed lineage', () => {
    const parent = Session.create(SessionId('swipe-parent'))
    parent.append('turn/start', { turn: 1 })
    parent.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text: 'Parent answer.' }],
        source: { provider: 'test', model: 'test' },
      }),
    }, { surfaceOp: 'append' })
    appendTavernAssistantCandidate(parent, 1)

    const child = Session.create(SessionId('swipe-child'), parent.events, {
      ...parent.header,
      id: SessionId('swipe-child'),
      parentSession: parent.id,
      seedLength: parent.events.length,
    })
    child.append('assistant/message', {
      turn: 1,
      step: 2,
      message: createAssistantMessage({
        content: [{ type: 'text', text: 'Child alternative.' }],
        source: { provider: 'test', model: 'test' },
      }),
    }, { surfaceOp: 'append' })
    appendTavernAssistantCandidate(child, 1)

    const group = resolveTavernSwipe(child).state.groups[0]
    expect(group?.candidates.map(candidate => candidate.origin)).toEqual(['initial', 'swipe'])
    expect(group?.candidates[0]?.content).toMatchObject({
      role: 'assistant', content: [{ type: 'text', text: 'Parent answer.' }],
    })
    expect(group?.candidates[1]?.content).toMatchObject({
      role: 'assistant', content: [{ type: 'text', text: 'Child alternative.' }],
    })
    expect(group?.currentCandidateId).toBe(group?.candidates[1]?.candidateId)
  })

  it('marks a candidate as regenerate only after the child branch copied one', () => {
    const parent = Session.create(SessionId('regenerate-parent'))
    parent.append('turn/start', { turn: 1 })
    parent.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Try another answer.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    parent.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text: 'Original answer.' }],
        source: { provider: 'test', model: 'test' },
      }),
    }, { surfaceOp: 'append' })
    appendTavernAssistantCandidate(parent, 1)

    const child = Session.create(SessionId('regenerate-child'), [], {
      ...parent.header,
      id: SessionId('regenerate-child'),
      parentSession: parent.id,
      seedLength: 0,
    })
    child.append('turn/start', { turn: 1 })
    child.append('tavern/swipe', {
      kind: 'candidate.add',
      branch: String(child.id),
      groupId: swipeGroupId('turn:1'),
      candidate: {
        candidateId: swipeCandidateId('copied-candidate'),
        assistantEventId: sourceEventId('parent-candidate'),
        origin: 'initial',
        content: {},
        extensions: {},
      },
      authority: { kind: 'observed', extensions: {} },
      validity: { status: 'valid', extensions: {} },
    })
    child.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text: 'Regenerated answer.' }],
        source: { provider: 'test', model: 'test' },
      }),
    }, { surfaceOp: 'append' })

    appendTavernAssistantCandidate(child, 1)

    expect(resolveTavernSwipe(child).state.groups[0]?.candidates.at(-1)?.origin).toBe('regenerate')
  })

  it('regenerates from the selected candidate into a child session', async () => {
    const parent = Session.create(SessionId('remote-regenerate-parent'))
    parent.append('turn/start', { turn: 1 })
    parent.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Please try again.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    parent.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text: 'The first answer.' }],
        source: { provider: 'test', model: 'test' },
      }),
    }, { surfaceOp: 'append' })
    parent.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    appendTavernAssistantCandidate(parent, 1)
    const group = resolveTavernSwipe(parent).state.groups[0]
    const candidateId = group?.currentCandidateId
    if (candidateId === null || candidateId === undefined) throw new Error('test setup did not create a selected candidate')

    let childSession: Session | undefined
    const create = vi.fn(async (options: CreateAgentOptions): Promise<AgentHandle> => {
      childSession = Session.create(options.sessionId, options.seed, {
        ...parent.header,
        id: options.sessionId,
        parentSession: parent.id,
        seedLength: options.seed?.length ?? 0,
      })
      const childAgent = {
        session: childSession,
        ctx: { sessions: { flush: async () => true } },
        whenIdle: async () => {},
        followup(message: Parameters<Agent['followup']>[0]) {
          childSession?.append('user/message', message, { surfaceOp: 'append' })
        },
      } as unknown as Agent
      return { agent: childAgent, dispose: async () => {} }
    })
    const parentAgent = {
      id: parent.id,
      options: {} as Agent['options'],
      session: parent,
      ctx: { agents: { create } },
    } as unknown as Agent
    const service = { ctx: { get: () => undefined } } as unknown as TavernAssetService

    const result = await TavernAssetService.prototype.remoteRegenerate.call(service, parentAgent, {
      groupId: 'turn:1',
      candidateId,
    })

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      meta: expect.objectContaining({ parentSession: parent.id }),
    }))
    expect(result.sessionId).toBe(childSession?.id)
    expect(childSession?.events.some(event => event.type === 'user/message' && event.data.source.kind === 'user')).toBe(true)
    const regenerated = resolveTavernSwipe(childSession!).state.groups[0]?.candidates
    expect(regenerated?.[0]?.candidateId).toBe(candidateId)
    expect(regenerated?.[0]?.origin).toBe('initial')
  })

  it('waits for a regenerated child candidate before returning a reloadable session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tavern-regenerate-'))
    tavernTestRoots.push(root)
    const ctx = await persistentTavernHarness(root, ['The first answer.', 'The regenerated answer.'])
    const parentHandle = await ctx.agents.create({
      sessionId: SessionId('remote-regenerate-live-parent'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })

    parentHandle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'Please try again.' }],
      source: { kind: 'user' },
    }))
    await parentHandle.agent.whenIdle()
    await ctx.sessions.flush(parentHandle.agent.session)

    const parentGroup = resolveTavernSwipe(parentHandle.agent.session).state.groups[0]
    const candidateId = parentGroup?.currentCandidateId
    if (candidateId === null || candidateId === undefined) throw new Error('test setup did not create a selected candidate')

    const result = await ctx.tavernAssets.remoteRegenerate(parentHandle.agent, {
      groupId: 'turn:1',
      candidateId,
    })
    const child = ctx.agents.get(result.sessionId)
    if (child === undefined) throw new Error('regenerate did not publish its child agent')

    expect(child.session.header.parentSession).toBe(parentHandle.agent.session.id)
    expect(child.session.events.some(event => event.type === 'user/message'
      && event.data.content.some(block => block.type === 'text' && block.text === 'Please try again.'))).toBe(true)
    expect(child.status).toBe('idle')
    const childSwipe = ctx.tavernAssets.remoteInspectSwipe(child)
    expect(childSwipe.groups[0]?.candidates.map(candidate => candidate.origin))
      .toEqual(['initial', 'regenerate'])
    expect(childSwipe.groups[0]?.candidates.map(candidate => candidate.text))
      .toEqual(['The first answer.', 'The regenerated answer.'])
    const stored = await ctx.sessionPersistence.inspect(result.sessionId)
    expect(stored.events.filter(event => event.type === 'tavern/swipe')).toHaveLength(4)

    await ctx.fiber.dispose()

    const restarted = await persistentTavernHarness(root, [])
    const reloaded = await restarted.agents.resume({
      resumeSessionId: result.sessionId,
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const reloadedSwipe = restarted.tavernAssets.remoteInspectSwipe(reloaded.agent)
    expect(reloadedSwipe.groups[0]?.candidates.map(candidate => candidate.origin))
      .toEqual(['initial', 'regenerate'])
    expect(reloadedSwipe.groups[0]?.candidates.map(candidate => candidate.text))
      .toEqual(['The first answer.', 'The regenerated answer.'])
    await restarted.fiber.dispose()
  })
})
