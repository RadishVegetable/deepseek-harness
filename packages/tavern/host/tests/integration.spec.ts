import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createAssistantMessage, createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { WebRoute, WebServer } from '@deepseek-ai/dsh-host-webserver'
import { apply as applyConnection, inject as connectionInject } from '@deepseek-ai/dsh-client-connection'
import { serverResponseSchema } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry'
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { TYPERT } from '../lib/typert.host.js'
import { TavernAssetService } from '../src/index.ts'
import type { CharacterAsset } from '@deepseek-ai/dsh-tavern-assets/types'
import { revertTavernFactsFromMessage } from '../src/runtime.ts'

class IntegrationAdapter extends LlmAdapter {
  constructor(private readonly replies: string[], private readonly hang = false) { super() }

  override resolveModel(provider: string, model: string) {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (this.hang) await new Promise<never>(() => {})
    const reply = this.replies.shift()
    if (reply === undefined) throw new Error('integration adapter: scripted replies exhausted')
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: reply }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: reply.length } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function harness(
  replies: string[] = [],
  hang = false,
  existingRoot?: string,
  storagePool = new MemoryMediaPool(),
  withWorkspace = false,
  withGateway = false,
): Promise<{ ctx: Context; adapter: IntegrationAdapter; root: string; routes: WebRoute[] }> {
  const root = existingRoot ?? await mkdtemp(join(tmpdir(), 'dsh-tavern-integration-'))
  roots.push(root)
  const ctx = new Context()
  const routes: WebRoute[] = []
  if (withGateway) {
    ctx.provide('webServer', fakeWebServer(routes))
    await ctx.plugin({ inject: [...connectionInject], apply: applyConnection })
    await ctx.plugin(TypertRegistry)
    await ctx.plugin(TypertGatewayService)
  }
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
  if (withWorkspace) await ctx.plugin(WorkspaceRegistry)
  const adapter = new IntegrationAdapter(replies, hang)
  ctx.llm.registerAdapter(['mock'], adapter)
  await ctx.plugin(TavernAssetService)
  return { ctx, adapter, root, routes }
}

function fakeWebServer(routes: WebRoute[]): Pick<WebServer, 'register' | 'tapIndex' | 'port'> {
  return {
    register(route) {
      routes.push(route)
      return () => {
        const index = routes.indexOf(route)
        if (index >= 0) routes.splice(index, 1)
      }
    },
    tapIndex: () => () => {},
    port: 0,
  }
}

async function serveRoute(route: WebRoute): Promise<{ readonly origin: string; close(): Promise<void> }> {
  const server = createServer((request, response) => { void route.handler(request, response) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  return {
    origin: `http://127.0.0.1:${String(address.port)}`,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error))),
  }
}

function card(id: string) {
  return {
    spec: 'chara_card_v2',
    data: {
      name: '梅迪',
      description: '一名谨慎的档案员。',
      first_mes: '',
      extensions: { id },
    },
  }
}

function book() {
  return {
    name: '旧档案馆',
    entries: [{
      id: 'keeper',
      keys: ['档案馆'],
      content: 'Type: character\nName: 伊恩\nRole: 看守人',
      enabled: true,
      position: 'at-depth',
    }, {
      id: 'archive-rule',
      keys: ['档案馆'],
      content: '规则: 夜间只能从北门进入。',
      enabled: true,
      position: 'at-depth',
    }],
  }
}

function parseBootstrapResult(value: unknown): unknown {
  return parseRemoteResult('bootstrapJourney', value)
}

function parseRemoteResult(method: string, value: unknown): unknown {
  if (typeof TYPERT !== 'object' || TYPERT === null) throw new Error('Host Typert contribution is not an object')
  const invocations = readProperty(TYPERT, 'invocations')
  if (!isUnknownArray(invocations)) throw new Error('Host Typert invocations are unavailable')
  const invocation = invocations.find(candidate =>
    typeof candidate === 'object'
    && candidate !== null
    && readProperty(candidate, 'id') === `@deepseek-ai/dsh-tavern-host#tavernAssets/${method}`)
  if (invocation === undefined || typeof invocation !== 'object' || invocation === null) {
    throw new Error('bootstrapJourney descriptor is unavailable')
  }
  const result = readProperty(invocation, 'result')
  if (typeof result !== 'object' || result === null) throw new Error('bootstrapJourney result codec is unavailable')
  const schema = readProperty(result, 'schema')
  if (!isParser(schema)) throw new Error('bootstrapJourney result schema is unavailable')
  return schema.parse(value)
}

function readProperty(value: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value as unknown
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value)
}

function isParser(value: unknown): value is { parse(input: unknown): unknown } {
  if (typeof value !== 'object' || value === null) return false
  return typeof (Object.getOwnPropertyDescriptor(value, 'parse')?.value as unknown) === 'function'
}

function assertProtocolJsonValue(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return
    throw new Error('protocol value contains a non-finite number')
  }
  if (typeof value !== 'object') throw new Error(`protocol value contains ${typeof value}`)
  if (ancestors.has(value)) throw new Error('protocol value contains a cycle')
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined) throw new Error('protocol array contains undefined')
        assertProtocolJsonValue(item, ancestors)
      }
      return
    }
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) throw new Error(`protocol field '${key}' is undefined`)
      assertProtocolJsonValue(item, ancestors)
    }
  } finally {
    ancestors.delete(value)
  }
}

describe('Tavern Host integration', () => {
  it('finishes bootstrap with deterministic facts when the auxiliary normalizer does not return', async () => {
    const { ctx } = await harness([], true)
    let flush: ReturnType<typeof vi.spyOn> | undefined
    try {
      const handle = await ctx.agents.create({
        sessionId: SessionId('integration-bootstrap-timeout'),
        agentOptions: { provider: 'mock', model: 'mock' },
      })
      const character = ctx.tavernAssets.host.importCharacter(card('timeout-card'), { id: 'timeout-card' }).asset
      flush = vi.spyOn(handle.agent.ctx.sessions, 'flush')
      const result = await Promise.race([
        ctx.tavernAssets.remoteBootstrapJourney(handle.agent, { characterId: character.id, worldInfoIds: [] }),
        new Promise<never>((_, reject) => {
          setTimeout(() => { reject(new Error('bootstrap timeout')) }, 1500)
        }),
      ])

      expect(flush).toHaveBeenCalledWith(handle.agent.session)
      expect(result.selection.character?.id).toBe(character.id)
      expect(result.factProjection.people).toEqual(expect.any(Object))
      expect([...handle.agent.session.events].some(event => event.type === 'tavern/assets-normalized')).toBe(true)
      expect(parseBootstrapResult(result)).toBeTruthy()
      expect(parseBootstrapResult(JSON.parse(JSON.stringify(result)))).toMatchObject({
        selection: { selection: { characterId: character.id, worldInfoIds: [] } },
        factProjection: { people: expect.any(Object), world: expect.any(Array) },
      })
    } finally {
      flush?.mockRestore()
      await ctx.fiber.dispose()
    }
  })

  it('settles with a persistence error when the session barrier does not return', async () => {
    const { ctx } = await harness()
    let flush: ReturnType<typeof vi.spyOn> | undefined
    try {
      const handle = await ctx.agents.create({ sessionId: SessionId('integration-bootstrap-persistence-timeout') })
      const character = ctx.tavernAssets.host.importCharacter(card('persistence-timeout-card'), { id: 'persistence-timeout-card' }).asset
      flush = vi.spyOn(handle.agent.ctx.sessions, 'flush')
        .mockImplementation(() => new Promise<boolean>(() => {}))

      await expect(ctx.tavernAssets.remoteBootstrapJourney(handle.agent, {
        characterId: character.id,
        worldInfoIds: [],
      })).rejects.toThrow(/persistence barrier timed out/)
    } finally {
      flush?.mockRestore()
      await ctx.fiber.dispose()
    }
  })

  it('rechecks the persistence barrier on an idempotent bootstrap retry', async () => {
    const { ctx } = await harness()
    try {
      const handle = await ctx.agents.create({ sessionId: SessionId('integration-bootstrap-retry') })
      const character = ctx.tavernAssets.host.importCharacter(card('retry-card'), { id: 'retry-card' }).asset
      const flush = vi.spyOn(handle.agent.ctx.sessions, 'flush')
        .mockRejectedValueOnce(new Error('temporary persistence failure'))
        .mockResolvedValue(true)

      await expect(ctx.tavernAssets.remoteBootstrapJourney(handle.agent, {
        characterId: character.id,
        worldInfoIds: [],
      })).rejects.toThrow('temporary persistence failure')

      const result = await Promise.race([
        ctx.tavernAssets.remoteBootstrapJourney(handle.agent, {
          characterId: character.id,
          worldInfoIds: [],
        }),
        new Promise<never>((_, reject) => {
          setTimeout(() => { reject(new Error('bootstrap retry timeout')) }, 1500)
        }),
      ])

      expect(flush).toHaveBeenCalledTimes(2)
      expect(result.selection.character?.id).toBe(character.id)
      expect(handle.agent.session.events.filter(event => event.type === 'tavern/fact')).not.toHaveLength(0)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('keeps inspectFacts result wire-valid before and after bootstrap', async () => {
    const { ctx } = await harness()
    try {
      const handle = await ctx.agents.create({ sessionId: SessionId('integration-facts-wire') })
      expect(() => parseRemoteResult('inspectFacts', ctx.tavernAssets.remoteInspectFacts(handle.agent))).not.toThrow()
      const character = ctx.tavernAssets.host.importCharacter(card('facts-wire-card'), { id: 'facts-wire-card' }).asset
      await ctx.tavernAssets.remoteBootstrapJourney(handle.agent, { characterId: character.id, worldInfoIds: [] })
      expect(() => parseRemoteResult('inspectFacts', ctx.tavernAssets.remoteInspectFacts(handle.agent))).not.toThrow()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('returns bootstrapJourney through the real HTTP Remote envelope as a value', async () => {
    const { ctx, routes } = await harness([], false, undefined, new MemoryMediaPool(), false, true)
    let server: Awaited<ReturnType<typeof serveRoute>> | undefined
    try {
      const handle = await ctx.agents.create({ sessionId: SessionId('integration-http-bootstrap') })
      const character = ctx.tavernAssets.host.importCharacter(card('http-bootstrap-card'), { id: 'http-bootstrap-card' }).asset
      ctx.typert.register(TYPERT as TypertContribution)
      server = await serveRoute(routes[0]!)

      const response = await fetch(`${server.origin}/api/tavernAssets/bootstrapJourney`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'client-request',
          rpcId: 'tavern-http-bootstrap',
          method: 'tavernAssets/bootstrapJourney',
          payload: {
            args: {
              agentId: handle.agent.id,
              selection: { characterId: character.id, worldInfoIds: [] },
            },
          },
        }),
      })
      const envelope = serverResponseSchema.parse(await response.json())
      expect(envelope.result.ok).toBe(true)
      if (!envelope.result.ok) throw new Error(envelope.result.error?.message ?? 'bootstrapJourney returned an RPC failure')
      const result = parseBootstrapResult(envelope.result.value)
      expect(result).toMatchObject({
        selection: { selection: { characterId: character.id, worldInfoIds: [] } },
        factProjection: { people: expect.any(Object), world: expect.any(Array) },
      })
    } finally {
      if (server !== undefined) await server.close()
      await ctx.fiber.dispose()
    }
  })

  it('returns a JSON-safe bootstrap result when World Info omits optional fields', async () => {
    const { ctx } = await harness()
    try {
      const handle = await ctx.agents.create({ sessionId: SessionId('integration-bootstrap-json-safe') })
      const character = ctx.tavernAssets.host.importCharacter(card('json-safe-card'), { id: 'json-safe-card' }).asset
      const world = ctx.tavernAssets.host.importWorldInfo({
        name: '省略字段世界书',
        entries: [{
          id: 'minimal-entry',
          keys: ['档案馆'],
          content: '这里是一条最小世界书事实。',
          enabled: true,
          position: 'at-depth',
        }],
      }, { id: 'json-safe-book' }).asset

      const result = await ctx.tavernAssets.remoteBootstrapJourney(handle.agent, {
        characterId: character.id,
        worldInfoIds: [world.id],
      })

      expect(() => assertProtocolJsonValue(result)).not.toThrow()
      expect(() => parseBootstrapResult(result)).not.toThrow()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('persists source asset updates and deletion through the registry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tavern-assets-persistence-'))
    const storagePool = new MemoryMediaPool()
    let assetId: CharacterAsset['id'] | undefined
    const first = await harness([], false, root, storagePool)
    try {
      const imported = await first.ctx.tavernAssets.remoteImportCharacter(JSON.stringify(card('persistent-card')), { id: 'persistent-card' })
      assetId = imported.id
      const updated = await first.ctx.tavernAssets.remoteUpdateCharacter(JSON.stringify({
        ...card('persistent-card'),
        data: { ...card('persistent-card').data, name: '已修改角色' },
      }), { id: imported.id })
      expect(updated.name).toBe('已修改角色')
      expect(first.ctx.tavernAssets.host.listCharacters()[0]?.name).toBe('已修改角色')
    } finally {
      await first.ctx.fiber.dispose()
    }

    if (assetId === undefined) throw new Error('asset import did not return an id')
    const second = await harness([], false, root, storagePool, false, true)
    try {
      expect(second.ctx.tavernAssets.host.listCharacters().map(asset => asset.id)).toContain('persistent-card')
      second.ctx.typert.register(TYPERT as TypertContribution)
      await expect(second.ctx.typertGateway.invoke({
        namespace: 'tavernAssets',
        method: 'deleteAsset',
        args: { id: assetId },
      })).resolves.toBe(true)
      expect(second.ctx.tavernAssets.host.listCharacters()).toEqual([])
    } finally {
      await second.ctx.fiber.dispose()
    }

    const third = await harness([], false, root, storagePool)
    try {
      expect(third.ctx.tavernAssets.host.listCharacters()).toEqual([])
    } finally {
      await third.ctx.fiber.dispose()
    }
  })

  it('allows deleting an asset referenced by an archived Journey', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tavern-asset-reference-'))
    const storagePool = new MemoryMediaPool()
    const first = await harness([], false, root, storagePool, true)
    let assetId: CharacterAsset['id'] | undefined
    try {
      const character = await first.ctx.tavernAssets.remoteImportCharacter(JSON.stringify(card('referenced-card')), {
        id: 'referenced-card',
      })
      const imported = await first.ctx.tavernAssets.remoteImportWorldInfo(JSON.stringify(book()), { id: 'referenced-book' })
      assetId = imported.id
      const sessionId = SessionId('asset-reference-session')
      const handle = await first.ctx.agents.create({ sessionId, meta: { cwd: root } })
      await first.ctx.tavernAssets.remoteBootstrapJourney(handle.agent, { characterId: character.id, worldInfoIds: [imported.id] })
      const workspace = await first.ctx.workspaceRegistry.create(root)
      await workspace.attachSession(sessionId)
      await first.ctx.tavernAssets.remoteArchiveHistory(sessionId)
      await expect(first.ctx.tavernAssets.remoteDeleteAsset(imported.id)).resolves.toBe(true)
      expect(first.ctx.tavernAssets.host.listWorldInfo()).toEqual([])
    } finally {
      await first.ctx.fiber.dispose()
    }

    if (assetId === undefined) throw new Error('asset import did not return an id')
    const second = await harness([], false, root, storagePool, false, true)
    try {
      second.ctx.typert.register(TYPERT as TypertContribution)
      expect(second.ctx.tavernAssets.host.listWorldInfo().map(asset => asset.id)).not.toContain(assetId)
    } finally {
      await second.ctx.fiber.dispose()
    }
  })

  it('allows the same Character Card content to be reimported after deletion', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-tavern-asset-reimport-'))
    const storagePool = new MemoryMediaPool()
    const input = JSON.stringify(card('reimport-card'))
    let assetId: CharacterAsset['id'] | undefined
    const first = await harness([], false, root, storagePool)
    try {
      const imported = await first.ctx.tavernAssets.remoteImportCharacter(input)
      assetId = imported.id
      await expect(first.ctx.tavernAssets.remoteDeleteAsset(imported.id)).resolves.toBe(true)
      expect(first.ctx.tavernAssets.host.listCharacters()).toEqual([])
      const reimported = await first.ctx.tavernAssets.remoteImportCharacter(input)
      expect(reimported.id).toBe(imported.id)
      expect(first.ctx.tavernAssets.host.listCharacters().map(asset => asset.id)).toEqual([imported.id])
    } finally {
      await first.ctx.fiber.dispose()
    }

    const reopened = await harness([], false, root, storagePool)
    try {
      if (assetId === undefined) throw new Error('asset import did not return an id')
      expect(reopened.ctx.tavernAssets.host.listCharacters().map(asset => asset.id)).toEqual([assetId])
    } finally {
      await reopened.ctx.fiber.dispose()
    }
  })

  it('archives history through the existing WorkspaceRegistry seam', async () => {
    const archiveSession = vi.fn(async (_sessionId: SessionId) => {})
    const service = {
      ctx: {
        get: (name: string) => name === 'workspaceRegistry'
          ? { archiveSession, archivedSessionIds: [] }
          : undefined,
      },
      enqueueMutation: <T>(operation: () => Promise<T>): Promise<T> => operation(),
    } as unknown as TavernAssetService

    await TavernAssetService.prototype.remoteArchiveHistory.call(service, SessionId('history-to-archive'))

    expect(archiveSession).toHaveBeenCalledWith(SessionId('history-to-archive'))
  })

  it('removes an archived history session from the real workspace history projection', async () => {
    const storagePool = new MemoryMediaPool()
    const { ctx, root } = await harness([], false, undefined, storagePool, true)
    try {
      const sessionId = SessionId('history-real-archive')
      const workspace = await ctx.workspaceRegistry.create(root)
      const handle = await ctx.agents.create({ sessionId, meta: { cwd: root } })
      await ctx.sessions.flush(handle.agent.session)
      await workspace.attachSession(sessionId)

      const historyIds = (): SessionId[] => ctx.workspaceRegistry.list().flatMap(item => item.sessionIds)
      expect(historyIds()).toContain(sessionId)

      await ctx.tavernAssets.remoteArchiveHistory(sessionId)
      expect(ctx.workspaceRegistry.archivedSessionIds).toContain(sessionId)
      expect(historyIds().filter(id => !ctx.workspaceRegistry.archivedSessionIds.includes(id))).not.toContain(sessionId)

      await expect(ctx.tavernAssets.remoteInspectHistory(sessionId)).rejects.toMatchObject({
        code: 'history-already-archived',
        details: { sessionId },
      })
      await expect(ctx.tavernAssets.remoteInspectSession(sessionId)).rejects.toMatchObject({
        code: 'history-already-archived',
        details: { sessionId },
      })
      await expect(ctx.tavernAssets.remoteArchiveHistory(sessionId)).rejects.toMatchObject({
        code: 'history-already-archived',
        details: { sessionId },
      })
      await expect(ctx.tavernAssets.remoteInspectArchivedHistory(sessionId)).resolves.toMatchObject({ sessionId })
      const unknown = SessionId('history-unknown')
      await expect(ctx.tavernAssets.remoteArchiveHistory(unknown)).rejects.toMatchObject({
        code: 'history-not-found',
        details: { sessionId: unknown },
      })

      await ctx.tavernAssets.remoteRestoreHistory(sessionId)
      expect(ctx.workspaceRegistry.archivedSessionIds).not.toContain(sessionId)
      await expect(ctx.tavernAssets.remoteInspectSession(sessionId)).resolves.toBeNull()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('bootstraps authored facts with source anchors and exposes the context ledger', async () => {
    const { ctx } = await harness()
    try {
      const handle = await ctx.agents.create({ sessionId: SessionId('integration-bootstrap') })
      const character = ctx.tavernAssets.host.importCharacter(card('integration-card'), { id: 'integration-card' }).asset
      const world = ctx.tavernAssets.host.importWorldInfo(book(), { id: 'integration-book' }).asset

      const result = await ctx.tavernAssets.remoteBootstrapJourney(handle.agent, {
        characterId: character.id,
        worldInfoIds: [world.id],
      })
      const eventCountAfterBootstrap = handle.agent.session.events.length
      await ctx.tavernAssets.remoteNormalizeForSession(handle.agent)
      expect(handle.agent.session.events.length).toBe(eventCountAfterBootstrap)
      await ctx.tavernAssets.remoteBootstrapJourney(handle.agent, {
        characterId: character.id,
        worldInfoIds: [world.id],
      })
      expect(handle.agent.session.events.length).toBe(eventCountAfterBootstrap)
      const records = handle.agent.session.events
        .filter(event => event.type === 'tavern/fact')
        .map(event => event.data)

      expect(records.length).toBeGreaterThan(0)
      expect(records.every(record => record.authority === 'authored-asset')).toBe(true)
      expect(records.some(record => record.sourceAssetId === String(character.id))).toBe(true)
      expect(records.some(record => record.sourceAssetId === String(world.id) && record.sourceEntryId?.includes('keeper'))).toBe(true)
      expect(result.factProjection.people['person:梅迪']?.length).toBeGreaterThan(0)

      const projection = ctx.tavernAssets.remoteInspectFactProjection(handle.agent)
      expect(projection.world.length).toBeGreaterThan(0)
      const compiled = ctx.tavernAssets.remoteInspectContextActivation(handle.agent)
      expect(compiled).not.toBeNull()
      expect(compiled?.ledger.length).toBeGreaterThan(0)
      expect(handle.agent.session.events.some(event => event.type === 'tavern/assets-normalized')).toBe(true)
      const selectedEvent = handle.agent.session.events.findLast(event => event.type === 'tavern/assets-selected')
      expect(selectedEvent?.type === 'tavern/assets-selected' ? selectedEvent.data : undefined)
        .not.toHaveProperty('baseline')
      expect(selectedEvent?.type === 'tavern/assets-selected' ? selectedEvent.data : undefined)
        .not.toHaveProperty('character')
      expect(selectedEvent?.type === 'tavern/assets-selected' ? selectedEvent.data : undefined)
        .not.toHaveProperty('worldInfo')
      const normalizedEvent = handle.agent.session.events.findLast(event => event.type === 'tavern/assets-normalized')
      expect(normalizedEvent?.data).not.toHaveProperty('structuredFields')
      expect(normalizedEvent?.data).not.toHaveProperty('fingerprint')
      expect(() => parseBootstrapResult(result)).not.toThrow()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('edits a fact and deletes a message through append-only audit events', async () => {
    const { ctx } = await harness()
    try {
      const handle = await ctx.agents.create({ sessionId: SessionId('integration-audit') })
      const character = ctx.tavernAssets.host.importCharacter(card('audit-card'), { id: 'audit-card' }).asset
      await ctx.tavernAssets.remoteBootstrapJourney(handle.agent, { characterId: character.id, worldInfoIds: [] })
      const original = ctx.tavernAssets.remoteInspectFactProjection(handle.agent).people['person:梅迪']?.[0]
      if (original === undefined) throw new Error('bootstrap fact was not projected')

      const edited = ctx.tavernAssets.remoteEditFact(handle.agent, { factId: String(original.factId), text: '一名勇敢的档案员。' })
      expect(edited.projection.people['person:梅迪']?.[0]?.text).toBe('一名勇敢的档案员。')
      expect(edited.records.some(record => record.data.authority === 'user' && record.data.operation === 'replace')).toBe(true)

      handle.agent.session.append('turn/start', { turn: 1 })
      handle.agent.session.append('step/start', { turn: 1, step: 1 })
      const assistant = handle.agent.session.append('assistant/message', {
        turn: 1,
        step: 1,
        message: createAssistantMessage({ content: [{ type: 'text', text: '场景继续。' }], source: { provider: 'mock', model: 'mock' } }),
      }, { surfaceOp: 'append' })
      handle.agent.session.append('tavern/fact', {
        branch: String(handle.agent.session.id),
        target: 'world',
        operation: 'add',
        factId: 'fact:delete-me',
        text: '这条事实来自待删除回复。',
        authority: 'gm',
        kind: 'soft',
        assistantSeq: assistant.seq,
        accepted: true,
      })
      handle.agent.session.append('tavern/fact', {
        branch: String(handle.agent.session.id),
        target: 'world',
        operation: 'add',
        factId: 'fact:delete-later',
        text: '这条事实来自更晚的回复。',
        authority: 'gm',
        kind: 'soft',
        assistantSeq: assistant.seq + 1,
        accepted: true,
      })

      const deleted = ctx.tavernAssets.remoteDeleteMessage(handle.agent, { targetSeq: assistant.seq })
      expect(deleted.targetSeq).toBe(assistant.seq)
      const audit = ctx.tavernAssets.remoteInspectFacts(handle.agent)
      expect(audit.projection.world.some(fact => fact.factId === 'fact:delete-me')).toBe(false)
      expect(audit.projection.world.some(fact => fact.factId === 'fact:delete-later')).toBe(false)
      expect(audit.records.some(record => record.data.revertedFromSeq === assistant.seq)).toBe(true)
      expect(audit.records.filter(record => record.data.factId === 'fact:delete-me')).toHaveLength(2)
      expect(audit.records.filter(record => record.data.factId === 'fact:delete-later')).toHaveLength(2)

      revertTavernFactsFromMessage(handle.agent, assistant.seq)
      const repeated = ctx.tavernAssets.remoteInspectFacts(handle.agent)
      expect(repeated.records.filter(record => record.data.operation === 'remove')).toHaveLength(2)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('resolves a hard conflict without hiding either source event', async () => {
    const { ctx } = await harness()
    try {
      const handle = await ctx.agents.create({ sessionId: SessionId('integration-conflict') })
      const session = handle.agent.session
      session.append('tavern/fact', {
        branch: String(session.id), target: 'world', operation: 'add', factId: 'fact:old',
        label: '地点', text: '北门', authority: 'authored-asset', kind: 'hard', accepted: true,
      })
      session.append('tavern/fact', {
        branch: String(session.id), target: 'world', operation: 'replace', factId: 'fact:old',
        label: '地点', text: '南门', authority: 'gm', kind: 'hard', accepted: true,
      })
      const before = ctx.tavernAssets.remoteInspectFactProjection(handle.agent)
      const conflict = before.conflicts?.[0]
      if (conflict === undefined) throw new Error('hard conflict was not projected')
      expect(String(conflict.factId)).not.toBe(String(conflict.previousFactId))

      const after = ctx.tavernAssets.remoteResolveConflict(handle.agent, { factId: String(conflict.factId), keep: 'new' })
      expect(after.projection.conflicts).toEqual([])
      expect(after.projection.world.map(fact => fact.text)).toEqual(['南门'])
      expect(after.records).toHaveLength(3)
      expect(after.records.at(-1)?.data).toMatchObject({ operation: 'remove', authority: 'user', factId: 'fact:old' })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('keeps parent facts out of a regenerated child branch', async () => {
    const { ctx } = await harness([
      '{"fields":[{"sourceAssetId":"regenerate-card","label":"Role","value":"Anchor"}]}',
      '{"story":"第一回合。","updates":{"world":[{"op":"add","factId":"fact:previous","text":"上一回合事实。"}]}}',
      '{"story":"旧回复。","updates":{"world":[{"op":"add","factId":"fact:parent-current","text":"当前回合父事实。"}]}}',
      '{"story":"新回复。","updates":{"world":[{"op":"add","factId":"fact:child","text":"子分支新事实。"}]}}',
    ])
    try {
      const parent = await ctx.agents.create({
        sessionId: SessionId('integration-regenerate-parent'),
        agentOptions: { provider: 'mock', model: 'mock' },
      })
      const character = ctx.tavernAssets.host.importCharacter(card('regenerate-card'), { id: 'regenerate-card' }).asset
      await ctx.tavernAssets.remoteSelectForSession(parent.agent, { characterId: character.id, worldInfoIds: [] })
      parent.agent.followup(createUserMessage({ content: [{ type: 'text', text: '第一回合。' }], source: { kind: 'user' } }))
      await parent.agent.whenIdle()
      parent.agent.followup(createUserMessage({ content: [{ type: 'text', text: '开始第二回合。' }], source: { kind: 'user' } }))
      await parent.agent.whenIdle()
      const group = ctx.tavernAssets.remoteInspectSwipe(parent.agent).groups.find(value => value.groupId === 'turn:2')
      if (group?.currentCandidateId === null || group === undefined) throw new Error('parent candidate was not projected')

      const childResult = await ctx.tavernAssets.remoteRegenerate(parent.agent, {
        groupId: group.groupId,
        candidateId: group.currentCandidateId,
      })
      const child = ctx.agents.get(SessionId(childResult.sessionId))
      if (child === undefined) throw new Error('regenerated child was not published')
      const parentFacts = ctx.tavernAssets.remoteInspectFactProjection(parent.agent)
      const childFacts = ctx.tavernAssets.remoteInspectFactProjection(child)
      expect(parentFacts.world.map(fact => fact.text)).toEqual(expect.arrayContaining(['上一回合事实。', '当前回合父事实。']))
      expect(parentFacts.world.map(fact => fact.text)).not.toContain('子分支新事实。')
      expect(childFacts.world.map(fact => fact.text)).toContain('上一回合事实。')
      expect(childFacts.world.map(fact => fact.text)).not.toContain('当前回合父事实。')
      expect(childFacts.world.map(fact => fact.text)).toContain('子分支新事实。')
      await child.ctx.fiber.dispose()
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
