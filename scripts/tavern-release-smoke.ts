/**
 * Keyless release smoke for the shipped Tavern Web composition.
 *
 * This script deliberately starts the built CLI with plain Node. It checks
 * the browser boot manifest, crosses the built HTTP RPC route, and captures a
 * model request against a local SSE server so Tavern macro expansion is
 * verified without a real API key or network call.
 * Set `DSH_TAVERN_CHARACTER_JSON` and `DSH_TAVERN_WORLD_INFO_JSON` to run the
 * same checks against external Character Card and World Info JSON fixtures.
 */

import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const builtBin = join(root, 'apps/cli/lib/bin.js')
const webDist = join(root, 'apps/web/dist/index.html')
const tavernHost = join(root, 'packages/tavern/host/lib/index.js')
const tavernRemote = join(root, 'packages/tavern/host/lib/typert.remote-client.js')
const tavernClient = join(root, 'packages/client/ui-tavern/lib/client.js')
const tavernPatch = join(root, 'packages/bundle/tavern/cordis.patch.yml')
const tavernPreset = join(root, 'apps/cli/config/agent-presets/tavern/agent.cordis.yml')
const tavernPresetMetadata = join(root, 'apps/cli/config/agent-presets/tavern/preset.yml')

const fixtureCharacterPath = process.env.DSH_TAVERN_CHARACTER_JSON
const fixtureWorldInfoPath = process.env.DSH_TAVERN_WORLD_INFO_JSON
const fixtureMode = fixtureCharacterPath !== undefined || fixtureWorldInfoPath !== undefined
const characterId = fixtureCharacterPath === undefined ? 'release-macro-card' : 'fixture-character'
const worldInfoId = fixtureWorldInfoPath === undefined ? undefined : 'fixture-world-info'
const sessionId = fixtureMode ? `session-tavern-fixture-${String(process.pid)}` : 'session-tavern-release-smoke'

interface RunningWeb {
  readonly child: ChildProcessByStdio<null, Readable, Readable>
  readonly baseUrl: string
  readonly output: () => { readonly stdout: string; readonly stderr: string }
  readonly completion: Promise<ExitResult>
}

interface ExitResult {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
}

interface MockLlm {
  readonly baseUrl: string
  readonly requests: unknown[]
  readonly close: () => Promise<void>
}

interface SwipeCandidate {
  readonly candidateId: string
  readonly origin: 'initial' | 'swipe' | 'regenerate'
  readonly text: string
}

interface SwipeGroup {
  readonly groupId: string
  readonly currentCandidateId: string | null
  readonly candidates: readonly SwipeCandidate[]
}

interface SwipeInspection {
  readonly groups: readonly SwipeGroup[]
  readonly issues: readonly { readonly code: string; readonly message: string }[]
}

interface HistoryEntry {
  readonly event: unknown
}

interface SessionHistory {
  readonly events: readonly HistoryEntry[]
  readonly hasMore: boolean
}

interface SessionSummary {
  readonly sessionId: string
  readonly running: boolean
  readonly blank: boolean
  readonly parentSessionId?: string
}

interface SessionList {
  readonly items: readonly SessionSummary[]
}

interface RawSwipeCandidate {
  readonly candidateId: string
  readonly origin: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Tavern release smoke: ${label} must be an object`)
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

async function listen(server: ReturnType<typeof createServer>): Promise<number> {
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', () => { resolveListen() })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Tavern release smoke: mock server has no TCP address')
  return address.port
}

async function startMockLlm(): Promise<MockLlm> {
  const requests: unknown[] = []
  const server = createServer((request, response) => {
    void respondToMockRequest(request, response, requests)
  })
  const sockets = new Set<Socket>()
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  const port = await listen(server)
  server.unref()
  return {
    baseUrl: `http://127.0.0.1:${String(port)}`,
    requests,
    close: () => {
      server.closeAllConnections()
      for (const socket of sockets) socket.destroy()
      try {
        server.close()
      } catch (error: unknown) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ERR_SERVER_NOT_RUNNING')) throw error
      }
      return Promise.resolve()
    },
  }
}

async function respondToMockRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requests: unknown[],
): Promise<void> {
  if (request.method !== 'POST' || request.url !== '/chat/completions') {
    response.writeHead(404).end()
    return
  }
  try {
    requests.push(await readJson(request))
    const tavernRequestNumber = requests.filter(isCharacterModelRequest).length
    const reply = [
      'SMOKE_FIRST',
      'SMOKE_SECOND',
      'SMOKE_REGENERATED',
    ][tavernRequestNumber - 1] ?? 'SMOKE_EXTRA'
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'close',
    })
    response.write('data: {"choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}\n\n')
    response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: reply }, finish_reason: null }] })}\n\n`)
    response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: reply.length } })}\n\n`)
    response.end('data: [DONE]\n\n')
  } catch (error) {
    response.writeHead(400, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: { message: String(error) } }))
  }
}

function isCharacterModelRequest(value: unknown): boolean {
  if (!isRecord(value) || !isUnknownArray(value.messages)) return false
  // The first prompt is the only content-generation request in this smoke;
  // the title plugin may issue a second, unrelated completion immediately
  // afterward. Identify the former by excluding the title prompt rather than
  // depending on a particular imported card's name or description prefix.
  return value.messages.some((message) => {
    if (!isRecord(message) || message.role !== 'system' || typeof message.content !== 'string') return false
    return !message.content.includes('Create a concise title for an AI coding-assistant session.')
  })
}

function startWeb(home: string, llm: MockLlm): Promise<RunningWeb> {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    DEEPSEEK_API_KEY: 'dsh-tavern-release-smoke-key',
    DEEPSEEK_BASE_URL: llm.baseUrl,
    DSH_HOME: home,
  }
  delete environment.NODE_OPTIONS
  delete environment.NODE_NO_WARNINGS
  const child = spawn(process.execPath, [
    builtBin,
    'web',
    '--patch',
    tavernPatch,
    '--host',
    '127.0.0.1',
    '--port',
    '0',
  ], {
    cwd: root,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  let closed: ExitResult | undefined
  let resolveCompletion: (result: ExitResult) => void = () => {}
  const completion = new Promise<ExitResult>((resolve) => { resolveCompletion = resolve })
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => { stdout += chunk })
  child.stderr.on('data', (chunk: string) => { stderr += chunk })
  child.on('exit', (code, signal) => {
    closed = { code, signal }
    resolveCompletion(closed)
  })

  return new Promise<RunningWeb>((resolveReady, rejectReady) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      rejectReady(new Error(`Tavern release smoke: built Web CLI did not start within 60s\nstdout:\n${stdout}\nstderr:\n${stderr}`))
    }, 60_000)
    const settle = (port: number): void => {
      clearTimeout(timer)
      resolveReady({
        child,
        baseUrl: `http://127.0.0.1:${String(port)}`,
        output: () => ({ stdout, stderr }),
        completion,
      })
    }
    child.stdout.on('data', () => {
      const match = /dsh web: http:\/\/127\.0\.0\.1:(\d+)/u.exec(stdout)
      const portText = match?.[1]
      if (portText !== undefined) settle(Number.parseInt(portText, 10))
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      rejectReady(error)
    })
    child.on('exit', (code, signal) => {
      if (closed === undefined || closed.code !== code || closed.signal !== signal) return
      clearTimeout(timer)
      rejectReady(new Error(`Tavern release smoke: built Web CLI exited before startup (code ${String(code)}, signal ${String(signal)})\nstdout:\n${stdout}\nstderr:\n${stderr}`))
    })
  })
}

async function stopWeb(web: RunningWeb): Promise<void> {
  web.child.kill('SIGTERM')
  let result = await waitForExit(web.completion, 5_000)
  let forced = false
  if (result === undefined) {
    forced = true
    if (process.platform === 'win32' && web.child.pid !== undefined) {
      await forceKillTree(web.child.pid)
      return
    } else {
      web.child.kill('SIGKILL')
    }
    result = await waitForExit(web.completion, 5_000)
  }
  if (result === undefined) {
    throw new Error('Tavern release smoke: built Web CLI did not terminate after cleanup')
  }
  if (result.code !== 0 || result.signal !== null) {
    if (process.platform === 'win32' && (forced || result.signal === 'SIGTERM')) return
    const output = web.output()
    throw new Error(`Tavern release smoke: built Web CLI did not exit cleanly (code ${String(result.code)}, signal ${String(result.signal)})\nstdout:\n${output.stdout}\nstderr:\n${output.stderr}`)
  }
}

async function waitForExit(completion: Promise<ExitResult>, timeoutMs: number): Promise<ExitResult | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<undefined>((resolveTimeout) => {
    timer = setTimeout(() => { resolveTimeout(undefined) }, timeoutMs)
  })
  const result = await Promise.race([completion, timeout])
  if (timer !== undefined) clearTimeout(timer)
  return result
}

async function forceKillTree(pid: number): Promise<void> {
  await new Promise<void>((resolveKill, rejectKill) => {
    const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    killer.once('error', rejectKill)
    killer.once('exit', () => { resolveKill() })
  })
}

async function callRpc<T>(baseUrl: string, method: string, payload: unknown): Promise<T> {
  const rpcId = `tavern-release-smoke-${method}-${String(Date.now())}-${String(Math.random())}`
  const response = await fetch(`${baseUrl}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
  })
  const body = await response.json() as unknown
  if (!response.ok) throw new Error(`Tavern release smoke: ${method} returned HTTP ${String(response.status)}: ${JSON.stringify(body)}`)
  assertRecord(body, `${method} response`)
  if (body.type !== 'server-response' || body.rpcId !== rpcId) {
    throw new Error(`Tavern release smoke: ${method} returned an invalid RPC envelope: ${JSON.stringify(body)}`)
  }
  assertRecord(body.result, `${method} result`)
  if (body.result.ok !== true) {
    const error = isRecord(body.result.error) && typeof body.result.error.message === 'string'
      ? body.result.error.message
      : JSON.stringify(body.result.error)
    throw new Error(`Tavern release smoke: ${method} failed: ${error}`)
  }
  return body.result.value as T
}

async function callRemote<T>(baseUrl: string, method: string, args: Record<string, unknown>): Promise<T> {
  return callRpc<T>(baseUrl, method, { args })
}

async function waitForModelRequest(requests: readonly unknown[], afterIndex: number): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const request = requests.slice(afterIndex).find(isCharacterModelRequest)
    if (isRecord(request)) return request
    await new Promise<void>(resolveWait => setTimeout(resolveWait, 100))
  }
  const summaries = requests.slice(afterIndex).map((request) => {
    if (!isRecord(request) || !isUnknownArray(request.messages)) return typeof request
    return request.messages.map((message) => {
      if (!isRecord(message)) return typeof message
      return `${String(message.role)}:${typeof message.content === 'string' ? message.content.slice(0, 160) : '[non-text]'}`
    }).join(' | ')
  })
  throw new Error(`Tavern release smoke: no Tavern model request arrived within 30s; captured ${String(requests.length)} request(s): ${summaries.join(' || ')}`)
}

async function waitForSwipeCandidate(
  baseUrl: string,
  sessionId: string,
  groupId: string,
  minimumCandidates: number,
): Promise<SwipeInspection> {
  const deadline = Date.now() + 30_000
  let latest: SwipeInspection | undefined
  while (Date.now() < deadline) {
    latest = await callRemote<SwipeInspection>(baseUrl, 'tavernAssets/inspectSwipe', { agentId: sessionId })
    const group = latest.groups.find(candidate => candidate.groupId === groupId)
    if (latest.issues.length === 0
      && group !== undefined
      && group.candidates.length >= minimumCandidates
      && group.candidates.every(candidate => candidate.text.length > 0)) {
      return latest
    }
    await new Promise<void>(resolveWait => setTimeout(resolveWait, 100))
  }
  throw new Error(`Tavern release smoke: ${groupId} did not reach ${String(minimumCandidates)} completed candidate(s): ${JSON.stringify(latest)}`)
}

function requireSwipeGroup(inspection: SwipeInspection, groupId: string): SwipeGroup {
  const group = inspection.groups.find(candidate => candidate.groupId === groupId)
  if (group === undefined) throw new Error(`Tavern release smoke: missing swipe group ${groupId}: ${JSON.stringify(inspection)}`)
  return group
}

function assertCompletedReply(history: SessionHistory, label: string): void {
  const events = history.events.map(entry => entry.event)
  if (!events.some(event => isRecord(event) && event.type === 'turn/end')) {
    throw new Error(`Tavern release smoke: ${label} has no completed turn`)
  }
  const assistant = events.find(event => isRecord(event) && event.type === 'assistant/message')
  if (!isRecord(assistant)) {
    throw new Error(`Tavern release smoke: ${label} has no assistant reply`)
  }
  const data = assistant.data
  const message = isRecord(data) ? data.message : undefined
  const content = isRecord(message) ? message.content : undefined
  if (!isUnknownArray(content) || !content.some(block =>
    isRecord(block) && block.type === 'text' && typeof block.text === 'string' && block.text.length > 0)) {
    throw new Error(`Tavern release smoke: ${label} assistant reply has no text content`)
  }
}

function assertFixtureContext(history: SessionHistory, worldInfoId: string): void {
  const activation = history.events
    .map(entry => entry.event)
    .find(event => isRecord(event) && event.type === 'tavern/context-activation')
  if (!isRecord(activation) || !isRecord(activation.data)) {
    throw new Error('Tavern release smoke: fixture turn did not record a context activation')
  }
  const compiled = activation.data.compiled
  if (!isRecord(compiled)) throw new Error('Tavern release smoke: context activation has no compiled context')
  const selected = [compiled.stablePrefix, compiled.dynamicSuffix]
    .flatMap(value => isUnknownArray(value) ? value : [])
  if (!selected.some(source => isRecord(source)
    && isRecord(source.provenance)
    && typeof source.provenance.id === 'string'
    && source.provenance.id.startsWith(`${worldInfoId}:`))) {
    const provenance = selected
      .filter(isRecord)
      .map(source => isRecord(source.provenance) ? source.provenance.id : undefined)
      .filter((value): value is string => typeof value === 'string')
    const query = typeof activation.data.query === 'string' ? activation.data.query : JSON.stringify(activation.data.query)
    throw new Error(`Tavern release smoke: fixture World Info ${worldInfoId} was not activated; query=${query}; selected=${provenance.join(',')}`)
  }
}

function rawSwipeCandidates(history: SessionHistory): readonly RawSwipeCandidate[] {
  const candidates: RawSwipeCandidate[] = []
  for (const entry of history.events) {
    const event = entry.event
    if (!isRecord(event) || event.type !== 'tavern/swipe' || !isRecord(event.data) || event.data.kind !== 'candidate.add') continue
    const candidate = event.data.candidate
    if (!isRecord(candidate) || typeof candidate.candidateId !== 'string' || typeof candidate.origin !== 'string') continue
    candidates.push({ candidateId: candidate.candidateId, origin: candidate.origin })
  }
  return candidates
}

async function waitForChildHistory(baseUrl: string, childId: string): Promise<SessionHistory> {
  const deadline = Date.now() + 30_000
  let latest: SessionHistory | undefined
  while (Date.now() < deadline) {
    latest = await callRpc<SessionHistory>(baseUrl, 'session.history', { sessionId: childId })
    const candidates = rawSwipeCandidates(latest)
    if (candidates.length >= 2) {
      assertCompletedReply(latest, 'regenerated child')
      return latest
    }
    await new Promise<void>(resolveWait => setTimeout(resolveWait, 100))
  }
  throw new Error(`Tavern release smoke: child history did not contain two candidates: ${JSON.stringify(latest)}`)
}

async function assertTavernWeb(web: RunningWeb): Promise<void> {
  const page = await fetch(`${web.baseUrl}/`)
  const html = await page.text()
  if (!page.ok) throw new Error(`Tavern release smoke: Web home returned HTTP ${String(page.status)}`)
  if (!html.includes('window.__DSH_BOOT__')) throw new Error('Tavern release smoke: running Web host has no boot manifest')
  if (!html.includes('@deepseek-ai/dsh-client-ui-tavern')) {
    throw new Error('Tavern release smoke: running Web boot manifest does not include the Tavern client bundle')
  }
}

function systemPromptOf(request: Record<string, unknown>): string {
  if (!isUnknownArray(request.messages)) throw new Error('Tavern release smoke: model request has no messages')
  const system = request.messages.find(message => isRecord(message) && message.role === 'system')
  if (!isRecord(system) || typeof system.content !== 'string') {
    throw new Error('Tavern release smoke: model request has no system prompt')
  }
  return system.content
}

function assertReleaseArtifacts(): void {
  for (const path of [
    builtBin,
    webDist,
    tavernHost,
    tavernRemote,
    tavernClient,
    tavernPatch,
    tavernPreset,
    tavernPresetMetadata,
  ]) {
    if (!existsSync(path)) throw new Error(`Tavern release smoke: missing release artifact ${resolve(path)}`)
  }
}

async function main(): Promise<void> {
  assertReleaseArtifacts()

  const home = await mkdtemp(join(tmpdir(), 'dsh-tavern-release-'))
  const llm = await startMockLlm()
  let web: RunningWeb | undefined
  try {
    const characterInput = fixtureCharacterPath === undefined
      ? JSON.stringify({
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: {
          name: 'Release Macro Card',
          description: 'Example {{char}} with {{user}} and {{unsupported_macro}}.',
          personality: 'Careful and direct.',
          scenario: '',
          first_mes: 'Welcome, {{user}}.',
          mes_example: '{{char}}: Hello, {{user}}.',
          creator_notes: '',
          system_prompt: '',
          post_history_instructions: '',
          alternate_greetings: [],
          tags: [],
          creator: '',
          character_version: '1.0',
        },
      })
      : await readFile(fixtureCharacterPath, 'utf8')
    const worldInfoInput = fixtureWorldInfoPath === undefined
      ? undefined
      : await readFile(fixtureWorldInfoPath, 'utf8')
    web = await startWeb(home, llm)
    await assertTavernWeb(web)
    const created = await callRpc<{ sessionId: string; agentPreset?: string }>(web.baseUrl, 'session.create', {
      sessionId,
      agentPreset: 'tavern',
    })
    if (created.sessionId !== sessionId || created.agentPreset !== 'tavern') {
      throw new Error(`Tavern release smoke: session.create did not select Tavern: ${JSON.stringify(created)}`)
    }

    const imported = await callRemote<{ id: string; name: string }>(web.baseUrl, 'tavernAssets/importCharacter', {
      input: characterInput,
      options: { id: characterId, ...(fixtureMode ? { source: { kind: 'fixture', locator: fixtureCharacterPath ?? 'inline' } } : {}) },
    })
    if (imported.id !== characterId) throw new Error(`Tavern release smoke: imported character id mismatch: ${JSON.stringify(imported)}`)
    let importedWorld: { id: string; entries: readonly unknown[] } | undefined
    if (worldInfoInput !== undefined && worldInfoId !== undefined) {
      importedWorld = await callRemote<{ id: string; entries: readonly unknown[] }>(web.baseUrl, 'tavernAssets/importWorldInfo', {
        input: worldInfoInput,
        options: { id: worldInfoId, source: { kind: 'fixture', locator: fixtureWorldInfoPath ?? 'inline' } },
      })
      if (importedWorld.id !== worldInfoId || importedWorld.entries.length === 0) {
        throw new Error(`Tavern release smoke: fixture World Info import failed: ${JSON.stringify(importedWorld)}`)
      }
    }

    await callRemote(web.baseUrl, 'tavernAssets/selectForSession', {
      agentId: sessionId,
      selection: { characterId, worldInfoIds: worldInfoId === undefined ? [] : [worldInfoId] },
    })
    const firstRequestIndex = llm.requests.length
    await callRpc(web.baseUrl, 'session.prompt', {
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: fixtureMode ? 'Chandra' : 'release smoke' }],
    })
    const prompt = systemPromptOf(await waitForModelRequest(llm.requests, firstRequestIndex))
    if (!prompt.includes(imported.name)) throw new Error('Tavern release smoke: Character Card did not reach the system prompt')
    if (!fixtureMode && !prompt.includes('Example Release Macro Card with User and {unsupported_macro}.')) {
      throw new Error(`Tavern release smoke: macro compatibility failed; system prompt was:\n${prompt}`)
    }
    if (prompt.includes('{{char}}') || prompt.includes('{{user}}')) {
      throw new Error(`Tavern release smoke: unresolved supported macro remained in system prompt:\n${prompt}`)
    }
    const firstHistory = await callRpc<SessionHistory>(web.baseUrl, 'session.history', { sessionId })
    assertCompletedReply(firstHistory, 'first turn')
    if (worldInfoId !== undefined) assertFixtureContext(firstHistory, worldInfoId)
    if (fixtureMode) {
      const exported = JSON.parse(await callRemote<string>(web.baseUrl, 'tavernAssets/exportCharacter', { id: characterId })) as Record<string, unknown>
      const exportedData = isRecord(exported.data) ? exported.data : exported
      if (exportedData.name !== imported.name) throw new Error('Tavern release smoke: fixture Character Card export lost its name')
      if (worldInfoId !== undefined) {
        const exportedWorld = JSON.parse(await callRemote<string>(web.baseUrl, 'tavernAssets/exportWorldInfo', { id: worldInfoId })) as Record<string, unknown>
        if (exportedWorld.entries === undefined) throw new Error('Tavern release smoke: fixture World Info export lost its entries')
      }
    }
    const firstSwipe = await waitForSwipeCandidate(web.baseUrl, sessionId, 'turn:1', 1)
    const firstGroup = requireSwipeGroup(firstSwipe, 'turn:1')
    const firstCandidateId = firstGroup.currentCandidateId
    if (firstCandidateId === null) throw new Error(`Tavern release smoke: turn:1 has no selected candidate: ${JSON.stringify(firstGroup)}`)

    const secondRequestIndex = llm.requests.length
    await callRpc(web.baseUrl, 'session.prompt', {
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: 'release smoke second round' }],
    })
    await waitForModelRequest(llm.requests, secondRequestIndex)
    const parentSwipe = await waitForSwipeCandidate(web.baseUrl, sessionId, 'turn:2', 1)
    const secondGroup = requireSwipeGroup(parentSwipe, 'turn:2')
    if (secondGroup.currentCandidateId === null) {
      throw new Error(`Tavern release smoke: turn:2 has no selected candidate: ${JSON.stringify(secondGroup)}`)
    }
    if (parentSwipe.groups.length < 2) {
      throw new Error(`Tavern release smoke: two prompt rounds did not produce two swipe groups: ${JSON.stringify(parentSwipe)}`)
    }
    const selectedParentSwipe = await callRemote<SwipeInspection>(web.baseUrl, 'tavernAssets/selectSwipe', {
      agentId: sessionId,
      input: { groupId: 'turn:2', candidateId: secondGroup.currentCandidateId },
    })
    const selectedParentGroup = requireSwipeGroup(selectedParentSwipe, 'turn:2')
    if (selectedParentGroup.currentCandidateId !== secondGroup.currentCandidateId) {
      throw new Error(`Tavern release smoke: selectSwipe did not select the parent candidate: ${JSON.stringify(selectedParentSwipe)}`)
    }

    const regenerated = await callRemote<{ sessionId: string }>(web.baseUrl, 'tavernAssets/regenerate', {
      agentId: sessionId,
      input: { groupId: 'turn:1', candidateId: firstCandidateId },
    })
    if (regenerated.sessionId === sessionId || regenerated.sessionId.length === 0) {
      throw new Error(`Tavern release smoke: regenerate returned an invalid child session: ${JSON.stringify(regenerated)}`)
    }
    const childId = regenerated.sessionId
    const childHistory = await waitForChildHistory(web.baseUrl, childId)
    const childCandidates = rawSwipeCandidates(childHistory)
    const childCandidateIds = new Set(childCandidates.map(candidate => candidate.candidateId))
    if (childCandidateIds.size < 2
      || !childCandidates.some(candidate => candidate.origin === 'initial')
      || !childCandidates.some(candidate => candidate.origin === 'regenerate')) {
      throw new Error(`Tavern release smoke: child history did not contain initial and regenerated candidates: ${JSON.stringify(childHistory)}`)
    }

    await stopWeb(web)
    web = undefined
    web = await startWeb(home, llm)
    await assertTavernWeb(web)
    const restoredCharacters = await callRemote<readonly { readonly id: string }[]>(web.baseUrl, 'tavernAssets/listCharacters', {})
    if (!restoredCharacters.some(character => character.id === characterId)) {
      throw new Error(`Tavern release smoke: Character Card was not restored from DSH_HOME: ${JSON.stringify(restoredCharacters)}`)
    }
    const restoredSelection = await callRemote<{ readonly selection: { readonly characterId: string | null } } | null>(
      web.baseUrl,
      'tavernAssets/inspectSession',
      { sessionId },
    )
    if (restoredSelection?.selection.characterId !== characterId) {
      throw new Error(`Tavern release smoke: selected Character Card was not restored: ${JSON.stringify(restoredSelection)}`)
    }
    const restoredSessions = await callRpc<SessionList>(web.baseUrl, 'session.list', {})
    const restoredChild = restoredSessions.items.find(item => item.sessionId === childId)
    if (restoredChild === undefined || restoredChild.parentSessionId !== sessionId || restoredChild.blank || restoredChild.running) {
      throw new Error(`Tavern release smoke: child session summary was not restored: ${JSON.stringify(restoredSessions)}`)
    }
    const restoredHistory = await callRpc<SessionHistory>(web.baseUrl, 'session.history', { sessionId: childId })
    assertCompletedReply(restoredHistory, 'restored regenerated child')
    const restoredChildCandidates = rawSwipeCandidates(restoredHistory)
    const restoredChildCandidateIds = new Set(restoredChildCandidates.map(candidate => candidate.candidateId))
    if (restoredChildCandidateIds.size < 2
      || [...childCandidateIds].some(candidateId => !restoredChildCandidateIds.has(candidateId))) {
      throw new Error(`Tavern release smoke: child swipe candidates were not restored: ${JSON.stringify(restoredHistory)}`)
    }
    const restoredParentSwipe = await callRemote<SwipeInspection>(web.baseUrl, 'tavernAssets/inspectSwipe', { agentId: sessionId })
    const restoredParentGroup = requireSwipeGroup(restoredParentSwipe, 'turn:2')
    if (restoredParentGroup.currentCandidateId !== secondGroup.currentCandidateId) {
      throw new Error(`Tavern release smoke: parent selectSwipe state was not restored: ${JSON.stringify(restoredParentSwipe)}`)
    }
    console.log('Tavern release smoke: built Web, two-round conversation, Swipe RPCs, regenerate child, and DSH_HOME recovery passed.')
  } finally {
    if (web !== undefined) {
      try {
        await stopWeb(web)
      } catch (error) {
        console.error(error instanceof Error ? error.message : error)
        process.exitCode = 1
      }
    }
    await llm.close()
    await rm(home, { recursive: true, force: true })
  }
}

await main()
