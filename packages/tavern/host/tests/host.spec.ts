import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId, createAssistantMessage, createToolResultMessage, createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
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
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { selectTavernCompactionRange, TavernAssetHost, TavernAssetService, TavernCompactionEngine } from '../src/index.ts'
import { resolveMemoryConfig } from '@deepseek-ai/dsh-tavern-memory'
import type { TavernGmResponse } from '../src/types.ts'
import {
  appendTavernGreeting,
  appendTavernAssistantCandidate,
  resolveTavernContextActivation,
  resolveTavernGreeting,
  resolveTavernSelection,
  resolveTavernJourneyAssets,
  resolveTavernSectionConfig,
  resolveTavernStoryState,
  resolveTavernSwipe,
} from '../src/session.ts'
import {
  appendTavernFactEdit,
  appendTavernFactRemoval,
  applyTavernGmResponse,
  parseTavernGmUpdates,
  resolveTavernFacts,
} from '../src/facts.ts'
import { parseTavernGmResponse } from '../src/gm-output.ts'
import { renderTavernPersona } from '../src/runtime.ts'
import type { AssetId } from '@deepseek-ai/dsh-tavern-assets'
import { sourceEventId, storyEntityId, swipeCandidateId, swipeGroupId } from '@deepseek-ai/dsh-tavern-state'

class TavernTestAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private readonly replies: string[]) { super() }

  override resolveModel(provider: string, model: string) {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
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

async function persistentTavernHarness(
  root: string,
  replies: string[],
  adapter = new TavernTestAdapter(replies),
  storagePool = new MemoryMediaPool(),
): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(storagePool))
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
  ctx.llm.registerAdapter(['mock'], adapter)
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

function appendCompactionTestTurn(
  session: Session,
  turn: number,
  userText: string,
  assistantText: string,
  withToolPair = false,
): { readonly start: number; readonly end: number } {
  session.append('turn/start', { turn })
  const user = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: userText }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('step/start', { turn, step: 1 })
  if (withToolPair) {
    const callId = CallId(`compaction-test-call-${turn}`)
    session.append('assistant/message', {
      turn,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'tool-call', id: callId, name: 'lookup', arguments: '{}' }],
        source: { provider: 'test', model: 'test' },
      }),
    }, { surfaceOp: 'append' })
    session.append('tool/result', {
      turn,
      step: 1,
      message: createToolResultMessage({
        callId,
        content: [{ type: 'text', text: 'lookup result' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
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
  return { start: user.seq, end: assistant.seq }
}

function messageText(message: ReturnType<Session['deriveMessages']>[number]): string {
  return message.content
    .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
}

describe('TavernAssetHost', () => {
  it('replays section configuration events into a durable projection', () => {
    const session = Session.create(SessionId('section-config-replay'))
    session.append('tavern/section-config', {
      branch: String(session.id),
      scope: 'character',
      sectionId: 'character:identity',
      operation: 'rename',
      name: '身份',
    })
    session.append('tavern/section-config', {
      branch: String(session.id),
      scope: 'character',
      sectionId: 'character:identity',
      operation: 'remove',
    })

    expect(resolveTavernSectionConfig(session)).toEqual({
      character: {
        names: { 'character:identity': '身份' },
        hidden: ['character:identity'],
        order: [],
      },
      world: { names: {}, hidden: [], order: [] },
    })
  })

  it('appends and inspects section configuration through the Host Remote', () => {
    const session = Session.create(SessionId('section-config-remote'))
    const agent = { session } as unknown as Agent
    const service = {} as TavernAssetService

    const result = TavernAssetService.prototype.remoteApplySectionConfig.call(service, agent, {
      scope: 'world',
      operation: 'add',
      name: '地点',
    })

    expect(result.projection.world.names).toEqual({ 'world:custom-1': '地点' })
    expect(session.events.at(-1)?.type).toBe('tavern/section-config')
    expect(TavernAssetService.prototype.remoteInspectSectionConfig.call(service, agent)).toEqual(result)
  })

  it('does not append a duplicate section event when the same Remote command is retried', () => {
    const session = Session.create(SessionId('section-config-idempotent'))
    const agent = { session } as unknown as Agent
    const service = {} as TavernAssetService
    const input = {
      scope: 'world' as const,
      operation: 'add' as const,
      sectionId: 'world:custom-1',
      name: '地点',
    }

    const first = TavernAssetService.prototype.remoteApplySectionConfig.call(service, agent, input)
    const eventCount = session.events.length
    const repeated = TavernAssetService.prototype.remoteApplySectionConfig.call(service, agent, input)

    expect(repeated).toEqual(first)
    expect(session.events).toHaveLength(eventCount)
  })

  it('restores section configuration after Session persistence reload', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tavern-section-config-reload-'))
    tavernTestRoots.push(root)
    const ctx = await persistentTavernHarness(root, [])
    const handle = await ctx.agents.create({
      sessionId: SessionId('section-config-reload'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    ctx.tavernAssets.remoteApplySectionConfig(handle.agent, {
      scope: 'character',
      operation: 'add',
      name: '人物',
    })
    await ctx.sessions.flush(handle.agent.session)
    await ctx.fiber.dispose()

    const restarted = await persistentTavernHarness(root, [])
    const reloaded = await restarted.agents.resume({
      resumeSessionId: SessionId('section-config-reload'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    expect(restarted.tavernAssets.remoteInspectSectionConfig(reloaded.agent).projection.character.names)
      .toEqual({ 'character:custom-1': '人物' })
    await restarted.fiber.dispose()
  })

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

  it('rejects updates for assets that are not already registered', () => {
    const host = new TavernAssetHost()

    expect(() => host.updateCharacter(character, { id: 'missing-character' })).toThrow(
      expect.objectContaining({ code: 'asset-not-found' }),
    )
    expect(() => host.updateWorldInfo(world, { id: 'missing-world' })).toThrow(
      expect.objectContaining({ code: 'asset-not-found' }),
    )
    expect(host.listCharacters()).toEqual([])
    expect(host.listWorldInfo()).toEqual([])
  })

  it('keeps an embedded character book attached and projects it without registering it globally', () => {
    const host = new TavernAssetHost()
    const card = host.importCharacter(character, { id: 'aria-attached-book' }).asset

    expect(card.characterBook?.name).toBe('Aria Vale Character Book')
    expect(card.characterBook?.entries[0]?.content).toBe('Treaties are kept here.')
    expect(host.listWorldInfo()).toEqual([])
    expect(host.select({ characterId: card.id, worldInfoIds: [] }).worldInfoEntries.map(entry => entry.content))
      .toEqual(['Treaties are kept here.'])
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
    expect(inspection.baseline.references).toHaveLength(3)
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

  it('parses a Journey copy without mutating the source library', () => {
    const host = new TavernAssetHost()
    const original = host.importCharacter(character, { id: 'aria' }).asset
    const source = original.sourceReferences[0]
    const updated = host.parseCharacter({
      ...character,
      data: { ...character.data, name: 'Aria Updated', description: 'A revised archivist.' },
    }, { id: 'aria', ...(source === undefined ? {} : { source }) })

    expect(updated.id).toBe('aria')
    expect(host.registry.getCharacter('aria' as AssetId)?.name).toBe('Aria Vale')
    expect(host.registry.getCharacter('aria' as AssetId)?.description).toBe('A patient archivist.')
    expect(host.registry.getCharacter('aria' as AssetId)?.sourceData).toEqual(character)
  })

  it('records one opening greeting for an empty session and replays it into the persona', () => {
    const host = new TavernAssetHost()
    const card = host.importCharacter(character, { id: 'aria' }).asset
    const session = Session.create(SessionId('greeting-empty'))
    session.append('tavern/assets-selected', {
      selection: { characterId: card.id, worldInfoIds: [] },
      baseline: host.select({ characterId: card.id, worldInfoIds: [] }),
      character: card,
      worldInfo: [],
      characterName: card.name,
      worldInfoNames: [],
    })

    const greeting = { characterId: card.id, characterName: card.name, text: card.firstMessage, selectionSeq: 0 }
    const event = appendTavernGreeting(session, greeting)
    expect(event?.type).toBe('tavern/greeting')
    expect(resolveTavernGreeting(session)).toEqual(greeting)
    expect(appendTavernGreeting(session, greeting)).toBeUndefined()
    expect(renderTavernPersona(session)).toContain('Welcome.')
    expect(renderTavernPersona(session)).not.toContain('opening-greeting:')
    expect(renderTavernPersona(session)).not.toContain('You are roleplaying')
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
      character: card,
      worldInfo: [],
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
    const ctx = await persistentTavernHarness(root, [
      '{"fields":[{"sourceAssetId":"live-macro-card","label":"Role","value":"Archivist"}]}',
      'Live response',
    ])
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

    await ctx.tavernAssets.remoteSelectForSession(handle.agent, {
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

  it('persists player identity, injects it into the GM prompt, and normalizes selection entrypoints', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tavern-player-identity-'))
    tavernTestRoots.push(root)
    const adapter = new TavernTestAdapter([
      '{"fields":[{"sourceAssetId":"identity-card","label":"Role","value":"Archivist"}]}',
      'The archive door opens.',
    ])
    const ctx = await persistentTavernHarness(root, [], adapter)
    const handle = await ctx.agents.create({
      sessionId: SessionId('player-identity-session'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const card = ctx.tavernAssets.host.importCharacter({
      spec: 'chara_card_v2',
      data: { name: 'Identity Card', description: 'A quiet archivist.' },
    }, { id: 'identity-card' }).asset

    const first = await ctx.tavernAssets.remoteBootstrapJourney(handle.agent, {
      characterId: card.id,
      worldInfoIds: [],
    }, '  档案馆旅人  ')
    const eventCount = handle.agent.session.events.length
    expect(first.selection.playerIdentity).toBe('档案馆旅人')
    expect(resolveTavernSelection(handle.agent.session)?.playerIdentity).toBe('档案馆旅人')

    const repeated = await ctx.tavernAssets.remoteBootstrapJourney(handle.agent, {
      characterId: card.id,
      worldInfoIds: [],
    })
    expect(repeated.selection.playerIdentity).toBe('档案馆旅人')
    expect(handle.agent.session.events.length).toBe(eventCount)
    expect(handle.agent.session.events.findLast(event => event.type === 'tavern/assets-normalized')?.data)
      .not.toHaveProperty('structuredFields')

    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: '继续。' }],
      source: { kind: 'user' },
    }))
    await handle.agent.whenIdle()
    expect(JSON.stringify(adapter.requests.at(-1)?.messages)).toContain('Player identity: 档案馆旅人')

    const selectHandle = await ctx.agents.create({ sessionId: SessionId('select-normalizes-session') })
    await ctx.tavernAssets.remoteSelectForSession(selectHandle.agent, {
      characterId: card.id,
      worldInfoIds: [],
    })
    expect(selectHandle.agent.session.events.some(event => event.type === 'tavern/assets-normalized')).toBe(true)
    expect(selectHandle.agent.session.events.some(event => event.type === 'tavern/fact')).toBe(true)
    await ctx.fiber.dispose()
  })

  it('inspects a complete persisted selection without requiring a live Agent', async () => {
    const cardHost = new TavernAssetHost()
    const card = cardHost.importCharacter(character, { id: 'persisted-inspect-card' }).asset
    const session = Session.create(SessionId('persisted-inspect-session'))
    const selection = {
      characterId: card.id,
      worldInfoIds: [],
    }
    session.append('tavern/assets-selected', {
      selection,
      baseline: cardHost.select(selection),
      character: card,
      worldInfo: [],
      characterName: card.name,
      worldInfoNames: [],
    })
    for (let index = 0; index < 60; index += 1) session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `message ${index}` }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    const service = {
      ctx: {
        get: () => undefined,
        sessionPersistence: {
          inspect: async () => ({ meta: session.header, events: session.events }),
        },
      },
    } as unknown as TavernAssetService

    await expect(TavernAssetService.prototype.remoteInspectSession.call(service, session.id)).resolves.toMatchObject({
      selection,
      character: { id: card.id, name: card.name },
    })
  })

  it('recovers display fields from the asset library for legacy selections', async () => {
    const cardHost = new TavernAssetHost()
    const card = cardHost.importCharacter(character, { id: 'legacy-inspect-card' }).asset
    const session = Session.create(SessionId('legacy-inspect-session'))
    const selection = { characterId: card.id, worldInfoIds: [] }
    session.append('tavern/assets-selected', {
      selection,
      baseline: cardHost.select(selection),
    } as never)

    const service = {
      host: cardHost,
      ctx: {
        get: () => undefined,
        sessionPersistence: {
          inspect: async () => ({ meta: session.header, events: session.events }),
        },
      },
    } as unknown as TavernAssetService

    await expect(TavernAssetService.prototype.remoteInspectSession.call(service, session.id)).resolves.toMatchObject({
      selection,
      character: { id: card.id, name: card.name },
      characterName: card.name,
      worldInfo: [],
      worldInfoNames: [],
    })
    await expect(TavernAssetService.prototype.remoteInspectHistory.call(service, session.id)).resolves.toMatchObject({
      sessionId: session.id,
      character: { id: card.id, name: card.name },
      characterName: card.name,
    })
  })

  it('uses the latest assistant message for a cold history preview', async () => {
    const session = Session.create(SessionId('history-preview'))
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '梅迪，你改成中文名字梅迪吧' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'runtime context that is not story content' }],
      source: { kind: 'plugin', plugin: 'test' },
    }), { surfaceOp: 'append' })
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text: '梅迪抬起头，接受了这个新名字。' }],
        source: { provider: 'test', model: 'test' },
      }),
    }, { surfaceOp: 'append' })
    const service = {
      ctx: {
        get: () => undefined,
        sessionPersistence: {
          inspect: async () => ({ meta: session.header, events: session.events }),
        },
      },
      host: new TavernAssetHost(),
    } as unknown as TavernAssetService

    await expect(TavernAssetService.prototype.remoteInspectHistory.call(service, session.id)).resolves.toMatchObject({
      lastContent: '梅迪抬起头，接受了这个新名字。',
    })
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

    await ctx.tavernAssets.remoteSelectForSession(handle.agent, {
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

  it('parses structured GM output and falls back to complete free text', () => {
    const structured = parseTavernGmResponse('```json\n{"story":"A complete scene.","updates":{"world":[{"op":"add","text":"The gate is open."}]}}\n```')
    expect(structured.structured).toBe(true)
    expect(structured.response).toEqual({
      story: 'A complete scene.',
      updates: { world: [{ op: 'add', text: 'The gate is open.' }] },
    })

    const freeText = parseTavernGmResponse('The gate opens, and the bells begin to ring.')
    expect(freeText.structured).toBe(false)
    expect(freeText.response).toEqual({ story: 'The gate opens, and the bells begin to ring.' })
  })

  it('parses Journey-local update candidates without trusting the model payload', () => {
    expect(parseTavernGmUpdates({
      people: { 'person:medie': [{ op: 'add', label: 'Name', text: 'Medie' }] },
      world: [{ op: 'add', label: 'Milestone', text: 'The second kingdom was defeated.' }],
    })).toEqual({
      operations: [
        { target: 'world', operation: { op: 'add', label: 'Milestone', text: 'The second kingdom was defeated.' } },
        { target: 'people', personId: 'person:medie', operation: { op: 'add', label: 'Name', text: 'Medie' } },
      ],
    })
    expect(parseTavernGmUpdates({ world: { invalid: true } }).rejection).toBeUndefined()
    expect(parseTavernGmUpdates({ unsupported: [] }).rejection).toContain('unknown field')
  })

  it('keeps story visible and records malformed update payloads as rejected', () => {
    const session = Session.create(SessionId('facts-malformed'))
    const response: TavernGmResponse = {
      story: 'The gate opens despite the malformed ledger entry.',
      updates: { world: { invalid: true } },
    }

    const applied = applyTavernGmResponse(session, response, 11, 1, undefined)

    expect(applied.response.story).toBe('The gate opens despite the malformed ledger entry.')
    expect(resolveTavernFacts(session).world).toEqual([])
    expect(applied.factEvents).toHaveLength(1)
    expect(applied.factEvents[0]?.data).toMatchObject({
      accepted: false,
      rejection: 'updates entry must be an array of valid operations',
      assistantSeq: 11,
      turn: 1,
    })
  })

  it('does not create a fact audit event for a story-only response', () => {
    const session = Session.create(SessionId('facts-story-only'))

    const applied = applyTavernGmResponse(session, {
      story: 'The gate opens without changing the ledger.',
    }, 12, 1, undefined)

    expect(applied.response.story).toBe('The gate opens without changing the ledger.')
    expect(applied.factEvents).toEqual([])
    expect(session.events.filter(event => event.type === 'tavern/fact')).toEqual([])
  })

  it('projects add, replace, and remove facts without erasing their audit events', () => {
    const session = Session.create(SessionId('facts-replay'))
    const baseline = new TavernAssetHost().select({ characterId: null, worldInfoIds: [] })
    const added = applyTavernGmResponse(session, {
      story: 'The secretary arrives.',
      updates: { world: [{ op: 'add', label: 'Role', text: 'The secretary serves the player.' }] },
    }, 12, 1, baseline)
    const factId = resolveTavernFacts(session).world[0]?.factId
    if (factId === undefined) throw new Error('fact was not added')
    expect(resolveTavernFacts(session).world[0]?.label).toBe('Role')

    applyTavernGmResponse(session, {
      story: 'The secretary explains the arrangement.',
      updates: { world: [{ op: 'replace', factId, text: 'The secretary is permanently assigned to the player.' }] },
    }, 13, 2, baseline)
    expect(resolveTavernFacts(session).world.map(fact => fact.text)).toEqual([
      'The secretary is permanently assigned to the player.',
    ])
    expect(resolveTavernFacts(session).world[0]?.label).toBe('Role')
    applyTavernGmResponse(session, {
      story: 'The arrangement ends.',
      updates: { world: [{ op: 'remove', factId }] },
    }, 14, 3, baseline)
    expect(resolveTavernFacts(session).world).toEqual([])
    expect(added.factEvents).toHaveLength(1)
    expect(session.events.filter(event => event.type === 'tavern/fact')).toHaveLength(3)
  })

  it('does not duplicate facts when the same assistant response is applied again', () => {
    const session = Session.create(SessionId('facts-idempotent'))
    const response: TavernGmResponse = {
      story: 'The secretary arrives.',
      updates: { world: [{ op: 'add', text: 'The secretary serves the player.' }] },
    }

    const first = applyTavernGmResponse(session, response, 18, 1, undefined)
    const second = applyTavernGmResponse(session, response, 18, 1, undefined)

    expect(resolveTavernFacts(session).world).toHaveLength(1)
    expect(session.events.filter(event => event.type === 'tavern/fact')).toHaveLength(1)
    expect(second.factEvents).toEqual(first.factEvents)
  })

  it('edits and removes facts through append-only user events', () => {
    const session = Session.create(SessionId('facts-user-edits'))
    applyTavernGmResponse(session, {
      story: 'A fact is established.',
      updates: { world: [{ op: 'add', text: 'The archive belongs to the player.' }] },
    }, 19, 1, undefined)
    const factId = resolveTavernFacts(session).world[0]?.factId
    if (factId === undefined) throw new Error('fact was not added')

    appendTavernFactEdit(session, { factId, text: 'The archive is entrusted to the player.' })
    expect(resolveTavernFacts(session).world[0]?.text).toBe('The archive is entrusted to the player.')
    appendTavernFactRemoval(session, factId)

    expect(resolveTavernFacts(session).world).toEqual([])
    expect(session.events.filter(event => event.type === 'tavern/fact')).toHaveLength(3)
  })

  it('accepts identified people and lets a Journey gain a new person', () => {
    const host = new TavernAssetHost()
    const card = host.importCharacter({ spec: 'chara_card_v2', data: { name: 'Anchor' } }, { id: 'anchor' }).asset
    const book = host.importWorldInfo({
      name: 'People',
      entries: { medie: { uid: 1, key: ['Medie'], content: 'Name: Medie\nType: character\nIdentity: secretary' } },
    }, { id: 'people' }).asset
    const session = Session.create(SessionId('person-facts'))
    const baseline = host.select({ characterId: card.id, worldInfoIds: [book.id] })
    const characterSource = host.exportCharacter(card.id)
    const worldSource = host.exportWorldInfo(book.id)

    applyTavernGmResponse(session, {
      story: 'Medie takes notes.',
      updates: { people: { 'person:medie': [{ op: 'add', text: 'Medie is the player\'s fixed secretary.' }] } },
    }, 21, 1, baseline)
    expect(resolveTavernFacts(session).people['person:medie']?.[0]?.text)
      .toBe("Medie is the player's fixed secretary.")

    const factId = resolveTavernFacts(session).people['person:medie']?.[0]?.factId
    if (factId === undefined) throw new Error('person fact was not added')
    applyTavernGmResponse(session, {
      story: 'The world ledger is challenged.',
      updates: { world: [{ op: 'replace', factId, text: 'This cross-collection replacement must be rejected.' }] },
    }, 22, 2, baseline)
    expect(resolveTavernFacts(session).world).toEqual([])
    expect(session.events.findLast(event => event.type === 'tavern/fact')?.type === 'tavern/fact'
      && session.events.findLast(event => event.type === 'tavern/fact')?.data.rejection)
      .toContain('another fact collection')

    applyTavernGmResponse(session, {
      story: 'A stranger enters.',
      updates: { people: { 'person:unknown': [{ op: 'add', text: 'A stranger is present.' }] } },
    }, 23, 3, baseline)
    expect(resolveTavernFacts(session).people['person:unknown']?.[0]?.text).toBe('A stranger is present.')
    expect(session.events.findLast(event => event.type === 'tavern/fact')?.type === 'tavern/fact'
      && session.events.findLast(event => event.type === 'tavern/fact')?.data.accepted).toBe(true)

    applyTavernGmResponse(session, {
      story: 'A prototype-like name is rejected.',
      updates: { people: { ['person:__proto__']: [{ op: 'add', text: 'Must not enter the projection.' }] } },
    }, 24, 4, baseline)
    expect(Object.getPrototypeOf(resolveTavernFacts(session).people)).toBe(Object.prototype)
    expect(resolveTavernFacts(session).people['person:__proto__']).toBeUndefined()
    expect(session.events.findLast(event => event.type === 'tavern/fact')?.type === 'tavern/fact'
      && session.events.findLast(event => event.type === 'tavern/fact')?.data.rejection).toContain('personId')
    expect(host.exportCharacter(card.id)).toBe(characterSource)
    expect(host.exportWorldInfo(book.id)).toBe(worldSource)
  })

  it('projects labeled GM facts over source people and adds Journey-only people and columns', () => {
    const host = new TavernAssetHost()
    const card = host.importCharacter({
      spec: 'chara_card_v2', data: { name: 'Anchor', description: 'A story anchor.' },
    }, { id: 'projection-card' }).asset
    const book = host.importWorldInfo({
      name: 'People',
      entries: { medie: { uid: 1, key: ['Medie'], content: 'Name: Medie\nType: character\nRole: secretary' } },
    }, { id: 'projection-book' }).asset
    const selection = { characterId: card.id, worldInfoIds: [book.id] }
    const journeySelection = {
      selection,
      baseline: host.select(selection),
      character: card,
      worldInfo: [book],
      characterName: card.name,
      worldInfoNames: [book.name],
    }
    const sourceCard = host.exportCharacter(card.id)
    const sourceBook = host.exportWorldInfo(book.id)
    const session = Session.create(SessionId('asset-fact-projection'))
    session.append('tavern/assets-selected', journeySelection)

    applyTavernGmResponse(session, {
      story: 'Medie takes a new name and a new person joins the court.',
      updates: {
        people: {
          'person:medie': [
            { op: 'add', label: 'Name', text: '梅迪' },
            { op: 'add', label: 'Secret', text: '梅迪 keeps a private royal seal.' },
          ],
          'person:lyra': [
            { op: 'add', label: 'Name', text: 'Lyra' },
            { op: 'add', label: 'Affiliation', text: 'Lyra serves the second kingdom.' },
          ],
        },
        world: [{ op: 'add', label: 'Milestone', text: 'The second kingdom was defeated.' }],
      },
    }, 41, 1, journeySelection.baseline)

    const projection = resolveTavernJourneyAssets(session)
    const medie = projection?.people.find(person => person.personId === 'person:medie')
    const lyra = projection?.people.find(person => person.personId === 'person:lyra')
    expect(medie).toMatchObject({ name: '梅迪', source: { assetId: book.id } })
    expect(medie?.fields.map(field => field.label)).toEqual(['Name', 'Secret'])
    expect(lyra).toMatchObject({ name: 'Lyra', source: null })
    expect(lyra?.fields.map(field => field.label)).toEqual(['Name', 'Affiliation'])
    expect(projection?.worldFields.map(field => field.label)).toContain('Milestone')
    expect(projection?.facts.world[0]?.text).toBe('The second kingdom was defeated.')

    const nameFact = medie?.facts.find(fact => fact.label === 'Name')?.factId
    if (nameFact === undefined) throw new Error('name fact was not projected')
    applyTavernGmResponse(session, {
      story: 'The renamed secretary signs the ledger.',
      updates: { people: { 'person:medie': [{ op: 'replace', factId: nameFact, label: 'Name', text: '梅迪二世' }] } },
    }, 42, 2, journeySelection.baseline)
    expect(resolveTavernJourneyAssets(session)?.people.find(person => person.personId === 'person:medie')?.name).toBe('梅迪二世')
    for (const fact of lyra?.facts ?? []) appendTavernFactRemoval(session, String(fact.factId))
    expect(resolveTavernJourneyAssets(session)?.people.some(person => person.personId === 'person:lyra')).toBe(false)
    expect(host.exportCharacter(card.id)).toBe(sourceCard)
    expect(host.exportWorldInfo(book.id)).toBe(sourceBook)
  })

  it('does not project legacy baseline structured fields as dynamic Journey facts', () => {
    const host = new TavernAssetHost()
    const book = host.importWorldInfo({
      name: 'Legacy Fields',
      entries: { one: { uid: 1, key: ['archive'], content: 'Type: character\nName: Medie' } },
    }, { id: 'legacy-fields-book' }).asset
    const selection = { characterId: null, worldInfoIds: [book.id] }
    const baseline = Object.assign(host.select(selection), {
      structuredFields: [{ label: 'Legacy', value: 'Must not project' }],
    })
    const session = Session.create(SessionId('legacy-fields-projection'))
    session.append('tavern/assets-selected', {
      selection,
      baseline,
      character: null,
      worldInfo: [book],
      characterName: null,
      worldInfoNames: [book.name],
    })

    const projection = resolveTavernJourneyAssets(session)

    expect(projection?.worldFields).toEqual([])
    expect(projection?.people[0]?.fields).toEqual([])
  })

  it('projects only the facts visible at a historical sequence', () => {
    const selection = {
      characterId: null,
      worldInfoIds: [],
    }
    const host = new TavernAssetHost()
    const journeySelection = {
      selection,
      baseline: host.select(selection),
      character: null,
      worldInfo: [],
      characterName: null,
      worldInfoNames: [],
    }
    const session = Session.create(SessionId('asset-fact-history'))
    const selected = session.append('tavern/assets-selected', journeySelection)
    const added = applyTavernGmResponse(session, {
      story: 'A new fact is recorded.',
      updates: { world: [{ op: 'add', label: 'Status', text: 'The gate is open.' }] },
    }, 51, 1, journeySelection.baseline)
    const factEvent = added.factEvents[0]
    if (factEvent === undefined) throw new Error('fact event was not added')
    expect(resolveTavernJourneyAssets(session, selected.seq)?.facts.world).toEqual([])
    expect(resolveTavernJourneyAssets(session, factEvent.seq)?.worldFields.map(field => field.label)).toEqual(['Status'])
  })

  it('keeps facts isolated between Journey sessions and discarded branch prefixes', () => {
    const baseline = new TavernAssetHost().select({ characterId: null, worldInfoIds: [] })
    const parent = Session.create(SessionId('facts-parent'))
    const added = applyTavernGmResponse(parent, {
      story: 'A fact is established.',
      updates: { world: [{ op: 'add', text: 'Only this Journey knows the fact.' }] },
    }, 31, 1, baseline)
    const factEvent = added.factEvents[0]
    if (factEvent === undefined) throw new Error('fact event was not added')
    const discardedBranch = Session.create(SessionId('facts-discarded'), parent.events.slice(0, factEvent.seq), {
      ...parent.header,
      id: SessionId('facts-discarded'),
      parentSession: parent.id,
      seedLength: factEvent.seq,
    })
    const independent = Session.create(SessionId('facts-independent'))
    expect(resolveTavernFacts(discardedBranch).world).toEqual([])
    expect(resolveTavernFacts(independent).world).toEqual([])
    expect(resolveTavernFacts(parent).world[0]?.text).toBe('Only this Journey knows the fact.')
  })

  it('keeps the selected prompt baseline stable when the global asset is updated', () => {
    const host = new TavernAssetHost()
    const card = host.importCharacter(character, { id: 'frozen-card' }).asset
    const session = Session.create(SessionId('frozen-baseline'))
    session.append('tavern/assets-selected', {
      selection: { characterId: card.id, worldInfoIds: [] },
      baseline: host.select({ characterId: card.id, worldInfoIds: [] }),
      character: card,
      worldInfo: [],
      characterName: card.name,
      worldInfoNames: [],
    })

    const source = card.sourceReferences[0]
    const edited = host.parseCharacter({ ...character, data: { ...character.data, name: 'Updated Card', description: 'Changed source.' } }, { id: card.id, ...(source === undefined ? {} : { source }) })

    expect(renderTavernPersona(session)).toContain('A patient archivist.')
    expect(renderTavernPersona(session)).not.toContain('Changed source.')
    expect(edited.description).toBe('Changed source.')
  })

  it('keeps a Journey-local asset edit after reload without changing the source library', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tavern-journey-assets-'))
    tavernTestRoots.push(root)
    const storagePool = new MemoryMediaPool()
    const ctx = await persistentTavernHarness(root, [], new TavernTestAdapter([]), storagePool)
    const handle = await ctx.agents.create({
      sessionId: SessionId('journey-assets-session'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const card = await ctx.tavernAssets.remoteImportCharacter(JSON.stringify(character), { id: 'journey-assets-card' })
    const source = ctx.tavernAssets.host.exportCharacter(card.id)
    await ctx.tavernAssets.remoteSelectForSession(handle.agent, { characterId: card.id, worldInfoIds: [] })
    const selectedEvent = handle.agent.session.events.findLast(event => event.type === 'tavern/assets-selected')
    const selectedData = selectedEvent?.type === 'tavern/assets-selected' ? selectedEvent.data : undefined
    expect(selectedData).toEqual({
      selection: { characterId: card.id, worldInfoIds: [] },
      playerIdentity: null,
    })

    const edited = ctx.tavernAssets.remoteEditJourneyCharacter(handle.agent, JSON.stringify({
      ...character,
      data: { ...character.data, name: 'Journey Aria', description: 'A Journey-only description.' },
    }))

    expect(edited.character?.name).toBe('Journey Aria')
    expect(ctx.tavernAssets.host.exportCharacter(card.id)).toBe(source)
    const editedEvent = handle.agent.session.events.findLast(event => event.type === 'tavern/assets-edited')
    expect(editedEvent?.type === 'tavern/assets-edited' ? editedEvent.data : undefined).not.toHaveProperty('baseline')
    expect(editedEvent?.type === 'tavern/assets-edited' ? editedEvent.data : undefined).not.toHaveProperty('character')
    expect(editedEvent?.type === 'tavern/assets-edited' ? editedEvent.data : undefined).not.toHaveProperty('worldInfo')
    expect(handle.agent.session.events.some(event => event.type === 'tavern/fact' && event.data.authority === 'user')).toBe(true)
    expect(ctx.tavernAssets.remoteInspectJourneyAssets(handle.agent)).toMatchObject({
      character: { name: 'Journey Aria' },
      openingGreeting: { text: 'Welcome.' },
    })
    await handle.agent.ctx.sessions.flush(handle.agent.session)
    await ctx.fiber.dispose()

    const restarted = await persistentTavernHarness(root, [], new TavernTestAdapter([]), storagePool)
    const reloaded = await restarted.agents.resume({
      resumeSessionId: SessionId('journey-assets-session'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    expect(restarted.tavernAssets.remoteInspectJourneyAssets(reloaded.agent)).toMatchObject({
      character: { name: 'Journey Aria' },
      openingGreeting: { text: 'Welcome.' },
    })
    await restarted.fiber.dispose()
  })

  it('runs one model call and recalls accepted facts on the next input', async () => {
    const adapter = new TavernTestAdapter([
      '{"fields":[{"sourceAssetId":"facts-live-card","label":"Role","value":"Anchor"}]}',
      '{"story":"The secretary bows.","updates":{"people":{"person:medie":[{"op":"add","text":"Medie is the player\'s fixed secretary."}]}}}',
      'The secretary records the next request.',
    ])
    const root = await mkdtemp(join(tmpdir(), 'dsh-tavern-facts-live-'))
    tavernTestRoots.push(root)
    const ctx = await persistentTavernHarness(root, [], adapter)
    const handle = await ctx.agents.create({
      sessionId: SessionId('facts-live-session'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const card = ctx.tavernAssets.host.importCharacter({
      spec: 'chara_card_v2', data: { name: 'Anchor', description: 'A story anchor.' },
    }, { id: 'facts-live-card' }).asset
    const book = ctx.tavernAssets.host.importWorldInfo({
      name: 'People',
      entries: { medie: { uid: 1, key: ['Medie'], content: 'Name: Medie\nType: character' } },
    }, { id: 'facts-live-book' }).asset
    await ctx.tavernAssets.remoteSelectForSession(handle.agent, { characterId: card.id, worldInfoIds: [book.id] })

    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Please continue.' }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    expect(adapter.requests).toHaveLength(2)
    expect(handle.agent.session.deriveMessages().at(-1)?.content).toEqual([{ type: 'text', text: 'The secretary bows.' }])
    expect(resolveTavernFacts(handle.agent.session).people['person:medie']?.[0]?.text)
      .toBe("Medie is the player's fixed secretary.")

    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'What do they do next?' }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    expect(adapter.requests).toHaveLength(3)
    expect(JSON.stringify(adapter.requests[2]?.messages)).toContain("Medie is the player's fixed secretary.")
    await ctx.fiber.dispose()
  })

  it('runs turn-end memory extraction as a logged background job', async () => {
    const adapter = new TavernTestAdapter([
      '{"fields":[]}',
      'The archive door opens for the player.',
      '{"atoms":[{"op":"add","target":"world","subjectKey":"world:archive.door","text":"The archive door is open.","explicit":false,"anchorTurn":1}],"rosterUpdates":[]}',
      'The archive door remains open.',
    ])
    const root = await mkdtemp(join(tmpdir(), 'dsh-tavern-memory-runtime-'))
    tavernTestRoots.push(root)
    const ctx = await persistentTavernHarness(root, [], adapter)
    await ctx.plugin(LocalJobRegistry)
    ctx.jobs.attachController('memory-test')
    const handle = await ctx.agents.create({
      sessionId: SessionId('memory-runtime-session'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const card = ctx.tavernAssets.host.importCharacter({
      spec: 'chara_card_v2', data: { name: 'Archivist', description: 'A careful archivist.' },
    }, { id: 'memory-runtime-card' }).asset
    await ctx.tavernAssets.remoteSelectForSession(handle.agent, { characterId: card.id, worldInfoIds: [] })

    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Open the archive door.' }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    await vi.waitFor(() => {
      expect(handle.agent.session.events.some(event => event.type === 'tavern/memory-extraction' && event.data.phase === 'complete')).toBe(true)
    })

    const extraction = handle.agent.session.events.findLast(event => event.type === 'tavern/memory-extraction')
    expect(extraction?.type === 'tavern/memory-extraction' ? extraction.data.prompt : '').toContain('[当前回合]')
    expect(extraction?.type === 'tavern/memory-extraction' ? extraction.data.rawOutput : '').toContain('world:archive.door')
    expect(resolveTavernFacts(handle.agent.session).world.map(fact => fact.text)).toContain('The archive door is open.')
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'What is beyond it?' }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    expect(JSON.stringify(adapter.requests.at(-2)?.messages)).toContain('The archive door is open.')
    expect(handle.agent.session.events.some(event => event.type === 'tavern/memory-context' && event.data.content.includes('The archive door is open.'))).toBe(true)
    await ctx.fiber.dispose()
  })

  it('clears a recalled fact from later requests after its removal', async () => {
    const adapter = new TavernTestAdapter([
      '{"fields":[{"sourceAssetId":"facts-clear-card","label":"Role","value":"Anchor"}]}',
      '{"story":"The gate opens.","updates":{"world":[{"op":"add","text":"The gate is open."}]}}',
      'The secretary enters.',
      'The room is quiet.',
    ])
    const root = await mkdtemp(join(tmpdir(), 'dsh-tavern-facts-clear-'))
    tavernTestRoots.push(root)
    const ctx = await persistentTavernHarness(root, [], adapter)
    const handle = await ctx.agents.create({
      sessionId: SessionId('facts-clear-session'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const card = ctx.tavernAssets.host.importCharacter({
      spec: 'chara_card_v2', data: { name: 'Anchor', description: 'A story anchor.' },
    }, { id: 'facts-clear-card' }).asset
    await ctx.tavernAssets.remoteSelectForSession(handle.agent, { characterId: card.id, worldInfoIds: [] })

    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Open the gate.' }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    const factId = resolveTavernFacts(handle.agent.session).world[0]?.factId
    if (factId === undefined) throw new Error('fact was not added')

    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Continue inside.' }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    expect(JSON.stringify(adapter.requests[2]?.messages)).toContain('The gate is open.')

    appendTavernFactRemoval(handle.agent.session, factId)
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Look around.' }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()

    expect(adapter.requests).toHaveLength(4)
    const latestRuntimeContext = [...adapter.requests[3]?.messages ?? []].reverse().find(message =>
      message.source.kind === 'plugin' && message.source.plugin === '@deepseek-ai/dsh-system-prompt')
    expect(latestRuntimeContext?.content[0]).toMatchObject({ type: 'text' })
    expect(JSON.stringify(latestRuntimeContext?.content)).not.toContain('The gate is open.')
    await ctx.fiber.dispose()
  })

  it('replays facts after reload without writing a duplicate on retry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tavern-facts-reload-'))
    tavernTestRoots.push(root)
    const reply = '{"story":"The gate opens.","updates":{"world":[{"op":"add","text":"The gate is open."}]}}'
    const ctx = await persistentTavernHarness(root, [reply])
    const handle = await ctx.agents.create({
      sessionId: SessionId('facts-reload-session'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })

    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'Open the gate.' }],
      source: { kind: 'user' },
    }))
    await handle.agent.whenIdle()
    await handle.agent.ctx.sessions.flush(handle.agent.session)
    expect(resolveTavernFacts(handle.agent.session).world.map(fact => fact.text)).toEqual(['The gate is open.'])
    await ctx.fiber.dispose()

    const restarted = await persistentTavernHarness(root, [])
    const reloaded = await restarted.agents.resume({
      resumeSessionId: SessionId('facts-reload-session'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const assistant = [...reloaded.agent.session.events].reverse().find(event =>
      event.type === 'assistant/message' && event.data.turn === 1)
    if (assistant?.type !== 'assistant/message') throw new Error('reloaded assistant response was not found')
    const selection = reloaded.agent.session.events.findLast(event => event.type === 'tavern/assets-selected')
    applyTavernGmResponse(reloaded.agent.session, parseTavernGmResponse(reply).response, assistant.seq, 1, selection?.type === 'tavern/assets-selected' ? selection.data.baseline : undefined)

    expect(resolveTavernFacts(reloaded.agent.session).world.map(fact => fact.text)).toEqual(['The gate is open.'])
    expect(reloaded.agent.session.events.filter(event => event.type === 'tavern/fact')).toHaveLength(1)
    await restarted.fiber.dispose()
  })

  it('bootstraps a large Journey bundle into authored facts and keeps source assets unchanged', async () => {
    const adapter = new TavernTestAdapter([
      '{"fields":[{"sourceAssetId":"normalize-card","label":"Role","value":"Archivist"},{"sourceAssetId":"normalize-book","sourceEntryId":"normalize-book.entry-1","label":"Secret","value":"The archive has a sealed lower level."}]}',
    ])
    const root = await mkdtemp(join(tmpdir(), 'dsh-tavern-normalize-'))
    tavernTestRoots.push(root)
    const ctx = await persistentTavernHarness(root, [], adapter)
    const handle = await ctx.agents.create({
      sessionId: SessionId('normalize-session'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const description = 'A patient archivist with a long source biography. '.repeat(70)
    const card = ctx.tavernAssets.host.importCharacter({
      spec: 'chara_card_v2', data: { name: 'Normalizer', description },
    }, { id: 'normalize-card' }).asset
    const book = ctx.tavernAssets.host.importWorldInfo({
      name: 'Normalizer Book',
      entries: { entry: { uid: 1, key: ['archive'], content: `Name: Medie\nType: character\n${'History: The lower archive is sealed. '.repeat(50)}` } },
    }, { id: 'normalize-book' }).asset
    const sourceCard = ctx.tavernAssets.host.exportCharacter(card.id)
    const sourceBook = ctx.tavernAssets.host.exportWorldInfo(book.id)

    const normalized = await ctx.tavernAssets.remoteBootstrapJourney(handle.agent, {
      characterId: card.id,
      worldInfoIds: [book.id],
    })

    expect(adapter.requests).toHaveLength(1)
    const facts = [
      ...Object.values(normalized.factProjection.people).flat(),
      ...normalized.factProjection.world,
    ]
    expect(facts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceAssetId: card.id,
        label: 'Role',
        text: 'Archivist',
        authority: 'authored-asset',
      }),
      expect.objectContaining({
        sourceAssetId: book.id,
        sourceEntryId: 'normalize-book.entry-1',
        label: 'Secret',
        text: 'The archive has a sealed lower level.',
        authority: 'authored-asset',
      }),
    ]))
    expect(facts.every(fact => fact.authority === 'authored-asset')).toBe(true)
    expect(ctx.tavernAssets.host.exportCharacter(card.id)).toBe(sourceCard)
    expect(ctx.tavernAssets.host.exportWorldInfo(book.id)).toBe(sourceBook)
    await handle.agent.ctx.sessions.flush(handle.agent.session)
    await ctx.fiber.dispose()

    const restarted = await persistentTavernHarness(root, [], new TavernTestAdapter([]))
    const reloaded = await restarted.agents.resume({
      resumeSessionId: SessionId('normalize-session'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const reloadedFacts = resolveTavernFacts(reloaded.agent.session)
    expect([...Object.values(reloadedFacts.people).flat(), ...reloadedFacts.world]).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceAssetId: card.id, label: 'Role', text: 'Archivist' }),
      expect.objectContaining({ sourceAssetId: book.id, sourceEntryId: 'normalize-book.entry-1', label: 'Secret' }),
    ]))
    await restarted.fiber.dispose()
  })

  it('falls back to authored facts when normalization output is malformed', async () => {
    const adapter = new TavernTestAdapter(['{"fields":[{"sourceAssetId":"unknown","label":"Role","value":"Invented"}]}'])
    const root = await mkdtemp(join(tmpdir(), 'dsh-tavern-normalize-fallback-'))
    tavernTestRoots.push(root)
    const ctx = await persistentTavernHarness(root, [], adapter)
    const handle = await ctx.agents.create({
      sessionId: SessionId('normalize-fallback-session'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const card = ctx.tavernAssets.host.importCharacter({
      spec: 'chara_card_v2', data: { name: 'Fallback', description: 'A source biography. '.repeat(140) },
    }, { id: 'fallback-card' }).asset
    const normalized = await ctx.tavernAssets.remoteBootstrapJourney(handle.agent, {
      characterId: card.id,
      worldInfoIds: [],
    })

    const facts = [...Object.values(normalized.factProjection.people).flat(), ...normalized.factProjection.world]
    expect(facts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceAssetId: card.id,
        label: 'Description',
        authority: 'authored-asset',
      }),
    ]))
    expect(facts.some(fact => fact.sourceAssetId === 'unknown')).toBe(false)
    expect(adapter.requests).toHaveLength(1)
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

  it('replays story-state events into their durable projection', () => {
    const session = Session.create(SessionId('state-session'))
    session.append('turn/start', { turn: 1 })
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

    const createOptions = create.mock.calls[0]?.[0]
    expect(createOptions?.meta).toMatchObject({ parentSession: parent.id })
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

  it('keeps cleaning previews unconfirmed and persists the confirmed canonical view', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tavern-cleaning-lifecycle-'))
    tavernTestRoots.push(root)
    const storagePool = new MemoryMediaPool()
    const ctx = await persistentTavernHarness(root, [], new TavernTestAdapter([]), storagePool)
    const card = await ctx.tavernAssets.remoteImportCharacter(JSON.stringify(character), { id: 'cleaning-lifecycle-card' })

    const beforePreview = ctx.tavernAssets.remoteInspectAssetCleaning(card.id)
    const preview = await ctx.tavernAssets.remotePreviewAssetCleaning(card.id)
    expect(preview.record.status).toBe('fallback')
    expect(preview.confirmed).toBe(false)
    expect(preview.record).toEqual(beforePreview.record)
    expect(ctx.tavernAssets.remoteInspectAssetCleaning(card.id)).toEqual(beforePreview)

    const confirmedView = { ...preview.record.view, greeting: 'Confirmed archive greeting.' }
    const confirmed = await ctx.tavernAssets.remoteConfirmAssetCleaning(card.id, confirmedView)
    expect(confirmed).toMatchObject({
      asset: { id: card.id },
      record: { status: 'confirmed', view: confirmedView },
      confirmed: true,
    })
    expect(ctx.tavernAssets.remoteInspectAssetCleaning(card.id)).toEqual(confirmed)
    await ctx.fiber.dispose()

    const restarted = await persistentTavernHarness(root, [], new TavernTestAdapter([]), storagePool)
    expect(restarted.tavernAssets.remoteInspectAssetCleaning(card.id)).toEqual(confirmed)
    await restarted.fiber.dispose()
  })

  it('selects a safe whole-turn compaction range and retains the newest turn', () => {
    const session = Session.create(SessionId('compaction-range-selection'))
    const first = appendCompactionTestTurn(
      session,
      1,
      'The party entered the archive before the storm.',
      'The archive keeper unlocked the outer gate.',
    )
    const second = appendCompactionTestTurn(
      session,
      2,
      'Search the sealed cabinet for the missing ledger.',
      'The missing ledger was found beneath the cabinet floor.',
      true,
    )
    const third = appendCompactionTestTurn(
      session,
      3,
      'Keep the ledger ready for the next exchange.',
      'The ledger remains ready beside the open gate.',
    )
    session.append('turn/start', { turn: 4 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'An unfinished turn must not be selected.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    const config = resolveMemoryConfig({
      compaction: { chunkTurns: [2, 2], retainedTailTurns: 1 },
      edit: { windowTurns: 1, marginTurns: 0 },
    })
    const range = selectTavernCompactionRange(session, config)

    expect(range).toEqual({ start: first.start, end: second.end })
    expect(range?.end).not.toBe(third.end)
    const startIndex = session.surface.nodes.indexOf(range?.start ?? -1)
    const endIndex = session.surface.nodes.indexOf(range?.end ?? -1)
    expect(session.surface.nodes.slice(startIndex, endIndex + 1)).toHaveLength(6)
  })

  it('commits a summary-provider compaction lifecycle and replaces only its surface span', async () => {
    const session = Session.create(SessionId('compaction-success-lifecycle'))
    const first = appendCompactionTestTurn(
      session,
      1,
      'The party crossed the rain-soaked archive courtyard and reached the locked vault.',
      'The keeper opened the vault and revealed a cabinet of forgotten maps.',
    )
    appendCompactionTestTurn(
      session,
      2,
      'Keep the maps ready for the next exchange.',
      'The maps remain spread beside the open vault.',
    )
    const beforeNodes = [...session.surface.nodes]
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
      const summaryEvent = session.events.find(event => event.seq === result.summarySeq)
      const checkpoint = session.events.find(event => event.type === 'user/message' && event.seq > result.summarySeq && event.seq < result.endSeq)
      const endEvent = session.events.find(event => event.seq === result.endSeq)

      expect(summaryProvider.summarize).toHaveBeenCalledOnce()
      expect(session.events.slice(result.startSeq, result.endSeq + 1).map(event => event.type)).toEqual([
        'compaction/start',
        'compaction/summary',
        'user/message',
        'compaction/end',
      ])
      expect(summaryEvent?.type).toBe('compaction/summary')
      if (summaryEvent?.type !== 'compaction/summary') throw new Error('compaction summary event was not committed')
      expect(summaryEvent.data).toMatchObject({ provider: 'tavern-memory-provider', model: 'custom' })
      expect(summaryEvent.data).not.toHaveProperty('rawOutput')
      expect(checkpoint?.type).toBe('user/message')
      if (checkpoint?.type !== 'user/message') throw new Error('compaction checkpoint was not committed')
      expect(checkpoint.data.source).toMatchObject({ kind: 'plugin', plugin: 'compact', compactionId: result.compactionId })
      expect(endEvent?.type).toBe('compaction/end')
      expect(session.surface.nodes).toEqual([checkpoint.seq, ...beforeNodes.slice(2)])
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

  it('closes a failed compaction with an error without changing the surface', async () => {
    const session = Session.create(SessionId('compaction-failure-lifecycle'))
    const first = appendCompactionTestTurn(
      session,
      1,
      'The party crossed the long archive corridor before dawn.',
      'The keeper pointed toward a locked cabinet at the corridor end.',
    )
    appendCompactionTestTurn(
      session,
      2,
      'Leave the cabinet untouched for now.',
      'The cabinet remains sealed beside the corridor.',
    )
    const beforeNodes = [...session.surface.nodes]
    const beforeMessages = session.deriveMessages().map(messageText)
    const summaryProvider = {
      summarize: vi.fn(async () => {
        throw new Error('summary provider failed')
      }),
    }
    const context = new Context()
    const engine = new TavernCompactionEngine(context, {}, summaryProvider)

    try {
      await expect(engine.compactRegion(first.start, first.end, { session, options: {} })).rejects.toThrow('summary provider failed')
      const lifecycle = session.events.filter(event => event.type === 'compaction/start' || event.type === 'compaction/end')
      const endEvent = lifecycle.at(-1)

      expect(lifecycle.map(event => event.type)).toEqual(['compaction/start', 'compaction/end'])
      expect(endEvent?.type).toBe('compaction/end')
      if (endEvent?.type !== 'compaction/end') throw new Error('failed compaction end event was not committed')
      expect(endEvent.data.error).toBe('summary provider failed')
      expect(session.events.some(event => event.type === 'compaction/summary')).toBe(false)
      expect(session.surface.nodes).toEqual(beforeNodes)
      expect(session.deriveMessages().map(messageText)).toEqual(beforeMessages)
    } finally {
      await context.fiber.dispose()
    }
  })
})
