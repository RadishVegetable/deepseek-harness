/** Host-side import and selection facade for Tavern assets. */

import {
  parseCharacterCard,
  parseWorldInfo,
} from '@deepseek-ai/dsh-tavern-compat'
import type { JsonInput } from '@deepseek-ai/dsh-tavern-compat'
import {
  AssetRegistry,
  AssetRegistryError,
  createAssetId,
  serializeCharacterAsset,
  serializeWorldInfoAsset,
} from '@deepseek-ai/dsh-tavern-assets'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-workspace'
import { randomUUID } from 'node:crypto'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type {
  AssetSelection,
  AssetSourceReference,
  CharacterAsset,
  PromptAssetBaseline,
  TavernAsset,
  WorldInfoAsset,
  WorldInfoPosition,
} from '@deepseek-ai/dsh-tavern-assets/types'
import type {
  TavernImportOptions,
  TavernImportResult,
  TavernImportSource,
  TavernSelectionInspection,
  TavernSessionSelection,
  TavernUpdateOptions,
  TavernRegenerateInput,
  TavernRegenerateResult,
  TavernMessageEditInput,
  TavernMessageEditResult,
} from './types.ts'
import { swipeCandidateId, swipeGroupId } from '@deepseek-ai/dsh-tavern-state'
import type { StoryStateAuthority, StoryStateChange, SwipeProjection } from '@deepseek-ai/dsh-tavern-state/types'
import { tavernAssetDomainSpec } from './spec.ts'
import type { TavernAssetRecord } from './spec.ts'
import { installTavernAgent } from './runtime.ts'
import {
  appendTavernGreeting,
  resolveTavernMemory,
  resolveTavernSelection,
  resolveTavernStoryState,
  resolveTavernStoryStateRecords,
  resolveTavernSwipe,
} from './session.ts'

export type * from './types.ts'
export { tavernAssetDomainSpec, tavernAssetRecordSchema } from './spec.ts'
export type { TavernAssetRecord } from './spec.ts'
export { appendTavernGreeting, resolveTavernContextFingerprint, resolveTavernGreeting, resolveTavernMemory, resolveTavernSelection, resolveTavernStoryState, resolveTavernStoryStateRecords, resolveTavernSwipe, resolveTavernSwipeRecords } from './session.ts'
export type { TavernAssetsSelectedEvent, TavernContextActivationEvent } from './session.ts'
export type { TavernGreetingEvent, TavernMemoryEntry, TavernMemoryEvent, TavernMemoryInput, TavernStoryStateEvent, TavernStoryStateInspection, TavernSwipeEvent, TavernSwipeInspection, TavernSwipeSelectionInput, TavernRegenerateInput, TavernRegenerateResult, TavernMessageEditInput, TavernMessageEditResult } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host-owned Tavern asset import and selection service. */
    tavernAssets: TavernAssetService
  }
}

/**
 * Host facade for Tavern asset management.
 *
 * The facade owns parsing and normalization at the host seam while the injected
 * registry owns uniqueness, detached reads, and selection validation. It is
 * deliberately process-local; callers that need restart survival must persist
 * the original input and call the import methods again during startup.
 */
export class TavernAssetHost {
  /** Registry used for all asset reads and selection resolution. */
  readonly registry: AssetRegistry

  /**
   * Create a host facade around an existing registry or a fresh one.
   * @param registry - Registry to use for the host's asset records.
   */
  constructor(registry = new AssetRegistry()) {
    this.registry = registry
  }

  /**
   * List all registered character assets.
   * @returns Detached character snapshots.
   */
  listCharacters(): readonly CharacterAsset[] {
    return this.registry.listCharacters()
  }

  /**
   * List all registered World Info assets.
   * @returns Detached World Info snapshots.
   */
  listWorldInfo(): readonly WorldInfoAsset[] {
    return this.registry.listWorldInfo()
  }

  /**
   * Parse, normalize, and register one Character Card V2/V3 JSON document.
   * @param input - JSON text or parsed Character Card object.
   * @param options - Optional stable ID and source metadata.
   * @returns The registered detached asset and its disposer.
   */
  importCharacter(input: JsonInput, options: TavernImportOptions = {}): TavernImportResult<CharacterAsset> {
    const card = parseCharacterCard(input)
    return this.register({
      kind: 'character',
      id: createAssetId(options.id ?? slugId(card.name)),
      name: card.name,
      version: { format: card.spec ?? 'character-card', revision: 1 },
      sourceReferences: [sourceReference(options.source, 'character-card')],
      sourceData: card.raw,
      description: card.description,
      personality: card.personality,
      scenario: card.scenario,
      firstMessage: card.firstMessage,
      creatorNotes: card.creatorNotes,
      messageExamples: card.messageExamples,
      alternateGreetings: card.alternateGreetings,
      systemPrompt: card.systemPrompt,
      postHistoryInstructions: card.postHistoryInstructions,
      extensions: card.extensions,
    })
  }

  /**
   * Parse and replace an existing Character Card with the same ID.
   * @param input - JSON text or parsed Character Card object.
   * @param options - Existing asset ID and optional source metadata.
   * @returns The replacement snapshot and a disposer that restores the prior snapshot.
   */
  updateCharacter(input: JsonInput, options: TavernUpdateOptions): TavernImportResult<CharacterAsset> {
    const card = parseCharacterCard(input)
    return this.replace<CharacterAsset>({
      kind: 'character',
      id: createAssetId(options.id),
      name: card.name,
      version: { format: card.spec ?? 'character-card', revision: 1 },
      sourceReferences: [sourceReference(options.source, 'character-card')],
      sourceData: card.raw,
      description: card.description,
      personality: card.personality,
      scenario: card.scenario,
      firstMessage: card.firstMessage,
      creatorNotes: card.creatorNotes,
      messageExamples: card.messageExamples,
      alternateGreetings: card.alternateGreetings,
      systemPrompt: card.systemPrompt,
      postHistoryInstructions: card.postHistoryInstructions,
      extensions: card.extensions,
    })
  }

  /**
   * Parse, normalize, and register one standalone World Info JSON document.
   * @param input - JSON text or parsed World Info object.
   * @param options - Optional stable ID and source metadata.
   * @returns The registered detached asset and its disposer.
   */
  importWorldInfo(input: JsonInput, options: TavernImportOptions = {}): TavernImportResult<WorldInfoAsset> {
    const world = parseWorldInfo(input)
    const name = world.name ?? 'World Info'
    return this.register({
      kind: 'world-info',
      id: createAssetId(options.id ?? slugId(name)),
      name,
      version: { format: 'world-info-v2', revision: 1 },
      sourceReferences: [sourceReference(options.source, 'world-info')],
      sourceData: world.raw,
      scanDepth: world.scanDepth,
      tokenBudget: world.tokenBudget,
      recursiveScanning: world.recursiveScanning ?? false,
      entries: world.entries.map((entry, index) => ({
        id: createAssetId(`${options.id ?? slugId(name)}.entry-${entry.id || index + 1}`),
        keys: entry.keys,
        secondaryKeys: entry.secondaryKeys,
        selective: entry.selective ?? false,
        constant: entry.constant ?? false,
        useRegex: entry.useRegex ?? false,
        matchWholeWords: entry.matchWholeWords ?? true,
        caseSensitive: entry.caseSensitive ?? false,
        useProbability: entry.useProbability ?? false,
        content: entry.content,
        enabled: entry.enabled,
        position: normalizePosition(entry.position),
        depth: entry.depth ?? 0,
        order: entry.insertionOrder,
        recursive: world.recursiveScanning ?? false,
        probability: entry.probability,
        group: entry.group ?? null,
        sticky: entry.sticky ?? null,
        cooldown: entry.cooldown ?? null,
        extensions: entry.unknown,
      })),
      extensions: world.extensions,
    })
  }

  /**
   * Parse and replace an existing World Info asset with the same ID.
   * @param input - JSON text or parsed World Info object.
   * @param options - Existing asset ID and optional source metadata.
   * @returns The replacement snapshot and a disposer that restores the prior snapshot.
   */
  updateWorldInfo(input: JsonInput, options: TavernUpdateOptions): TavernImportResult<WorldInfoAsset> {
    const world = parseWorldInfo(input)
    const name = world.name ?? 'World Info'
    return this.replace<WorldInfoAsset>({
      kind: 'world-info',
      id: createAssetId(options.id),
      name,
      version: { format: 'world-info-v2', revision: 1 },
      sourceReferences: [sourceReference(options.source, 'world-info')],
      sourceData: world.raw,
      scanDepth: world.scanDepth,
      tokenBudget: world.tokenBudget,
      recursiveScanning: world.recursiveScanning ?? false,
      entries: world.entries.map((entry, index) => ({
        id: createAssetId(`${options.id}.entry-${entry.id || index + 1}`),
        keys: entry.keys,
        secondaryKeys: entry.secondaryKeys,
        selective: entry.selective ?? false,
        constant: entry.constant ?? false,
        useRegex: entry.useRegex ?? false,
        matchWholeWords: entry.matchWholeWords ?? true,
        caseSensitive: entry.caseSensitive ?? false,
        useProbability: entry.useProbability ?? false,
        content: entry.content,
        enabled: entry.enabled,
        position: normalizePosition(entry.position),
        depth: entry.depth ?? 0,
        order: entry.insertionOrder,
        recursive: world.recursiveScanning ?? false,
        probability: entry.probability,
        group: entry.group ?? null,
        sticky: entry.sticky ?? null,
        cooldown: entry.cooldown ?? null,
        extensions: entry.unknown,
      })),
      extensions: world.extensions,
    })
  }

  /**
   * Resolve a character and ordered World Info selection.
   * @param selection - Asset IDs requested by the caller.
   * @returns A source-tracked prompt baseline.
   */
  select(selection: AssetSelection): PromptAssetBaseline {
    return this.registry.select(selection)
  }

  /**
   * Return the resolved assets alongside the prompt baseline for diagnostics.
   * @param selection - Asset IDs requested by the caller.
   * @returns Detached assets and the exact baseline produced by the registry.
   */
  inspectSelection(selection: AssetSelection): TavernSelectionInspection {
    const baseline = this.select(selection)
    const character = selection.characterId === null ? null : this.registry.getCharacter(selection.characterId)
    if (selection.characterId !== null && character === undefined) {
      throw new AssetRegistryError('asset-not-found', `character asset '${selection.characterId}' was not found`)
    }
    const worldInfo = selection.worldInfoIds.map((id) => {
      const asset = this.registry.getWorldInfo(id)
      if (asset === undefined) throw new AssetRegistryError('asset-not-found', `World Book asset '${id}' was not found`)
      return asset
    })
    return {
      selection: { characterId: selection.characterId, worldInfoIds: [...selection.worldInfoIds] },
      baseline,
      character: character ?? null,
      worldInfo,
    }
  }

  /**
   * Export a registered Character Card as JSON, retaining its source fields.
   * @param id - Character asset ID.
   * @returns A compact JSON Character Card document.
   * @throws {@link AssetRegistryError} when the ID is not a character asset.
   */
  exportCharacter(id: import('@deepseek-ai/dsh-tavern-assets/types').AssetId): string {
    const asset = this.registry.getCharacter(id)
    if (asset === undefined) throw new AssetRegistryError('asset-not-found', `character asset '${id}' was not found`)
    return serializeCharacterAsset(asset)
  }

  /**
   * Export a registered World Info asset as JSON, retaining its source fields.
   * @param id - World Info asset ID.
   * @returns A compact JSON World Info document.
   * @throws {@link AssetRegistryError} when the ID is not a World Info asset.
   */
  exportWorldInfo(id: import('@deepseek-ai/dsh-tavern-assets/types').AssetId): string {
    const asset = this.registry.getWorldInfo(id)
    if (asset === undefined) throw new AssetRegistryError('asset-not-found', `World Book asset '${id}' was not found`)
    return serializeWorldInfoAsset(asset)
  }

  private register<T extends TavernAsset>(asset: T): TavernImportResult<T> {
    return { asset: cloneAsset(asset), dispose: this.registry.register(asset) }
  }

  private replace<T extends TavernAsset>(asset: T): TavernImportResult<T> {
    return { asset: cloneAsset(asset), dispose: this.registry.replace(asset) }
  }
}

/** Host Cordis service exposing Tavern asset operations through Typert Remote. */
export class TavernAssetService extends TypertRemoteService {
  static inject = ['storageDomain']

  /** Host facade used by the Remote methods and startup restore path. */
  readonly host: TavernAssetHost
  private table?: KvTable<import('@deepseek-ai/dsh-tavern-assets/types').AssetId, TavernAssetRecord>
  private mutationChain: Promise<void> = Promise.resolve()

  constructor(ctx: Context) {
    super(ctx, 'tavernAssets')
    this.host = new TavernAssetHost()
    ctx.on('agent/created', ({ agent }) => {
      agent.ctx.effect(() => installTavernAgent(agent), 'tavern.agent-runtime')
    })
  }

  /** Restore the durable asset library before the service accepts Remote calls. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(tavernAssetDomainSpec)
    this.ctx.effect(() => async () => domain.close(), 'tavernAssets.domainClose')
    this.table = domain.table('assets')
    for (const [, record] of this.table.entries()) this.restore(record)
  }

  /**
   * List all imported Character Cards.
   * @returns Detached Character Card snapshots.
   */
  @Remote('listCharacters')
  remoteListCharacters(): readonly CharacterAsset[] {
    return this.host.listCharacters()
  }

  /**
   * List all imported World Info assets.
   * @returns Detached World Info snapshots.
   */
  @Remote('listWorldInfo')
  remoteListWorldInfo(): readonly WorldInfoAsset[] {
    return this.host.listWorldInfo()
  }

  /**
   * Import one Character Card JSON document and return its detached asset.
   * @param input - Character Card JSON text.
   * @param options - Optional stable ID and source metadata.
   * @returns The persisted detached Character Card asset.
   */
  @Remote('importCharacter')
  async remoteImportCharacter(input: string, options?: TavernImportOptions): Promise<CharacterAsset> {
    return this.enqueueMutation(async () => {
      const imported = this.host.importCharacter(input, options)
      try {
        await this.requireTable().put(imported.asset.id, recordOf(imported.asset, options?.source))
      } catch (error) {
        imported.dispose()
        throw error
      }
      return imported.asset
    })
  }

  /**
   * Import one standalone World Info JSON document and return its detached asset.
   * @param input - World Info JSON text.
   * @param options - Optional stable ID and source metadata.
   * @returns The persisted detached World Info asset.
   */
  @Remote('importWorldInfo')
  async remoteImportWorldInfo(input: string, options?: TavernImportOptions): Promise<WorldInfoAsset> {
    return this.enqueueMutation(async () => {
      const imported = this.host.importWorldInfo(input, options)
      try {
        await this.requireTable().put(imported.asset.id, recordOf(imported.asset, options?.source))
      } catch (error) {
        imported.dispose()
        throw error
      }
      return imported.asset
    })
  }

  /**
   * Replace one persisted Character Card under its existing ID.
   * @param input - Character Card JSON text.
   * @param options - Existing asset ID and optional source metadata.
   * @returns The persisted replacement asset.
   */
  @Remote('updateCharacter')
  async remoteUpdateCharacter(input: string, options: TavernUpdateOptions): Promise<CharacterAsset> {
    return this.enqueueMutation(async () => {
      const updated = this.host.updateCharacter(input, options)
      try {
        await this.requireTable().put(updated.asset.id, recordOf(updated.asset, options.source))
      } catch (error) {
        updated.dispose()
        throw error
      }
      return updated.asset
    })
  }

  /**
   * Replace one persisted World Info asset under its existing ID.
   * @param input - World Info JSON text.
   * @param options - Existing asset ID and optional source metadata.
   * @returns The persisted replacement asset.
   */
  @Remote('updateWorldInfo')
  async remoteUpdateWorldInfo(input: string, options: TavernUpdateOptions): Promise<WorldInfoAsset> {
    return this.enqueueMutation(async () => {
      const updated = this.host.updateWorldInfo(input, options)
      try {
        await this.requireTable().put(updated.asset.id, recordOf(updated.asset, options.source))
      } catch (error) {
        updated.dispose()
        throw error
      }
      return updated.asset
    })
  }

  /**
   * Export one persisted Character Card as JSON.
   * @param id - Character asset ID.
   * @returns A compact JSON Character Card document.
   */
  @Remote('exportCharacter')
  remoteExportCharacter(id: import('@deepseek-ai/dsh-tavern-assets/types').AssetId): string {
    return this.host.exportCharacter(id)
  }

  /**
   * Export one persisted World Info asset as JSON.
   * @param id - World Info asset ID.
   * @returns A compact JSON World Info document.
   */
  @Remote('exportWorldInfo')
  remoteExportWorldInfo(id: import('@deepseek-ai/dsh-tavern-assets/types').AssetId): string {
    return this.host.exportWorldInfo(id)
  }

  /**
   * Resolve selected assets into a source-tracked prompt baseline.
   * @param selection - Asset IDs requested by the caller.
   * @returns The selected prompt baseline.
   */
  @Remote('select')
  remoteSelect(selection: AssetSelection): PromptAssetBaseline {
    return this.host.select(selection)
  }

  /**
   * Select assets for a live session and append the complete baseline to its log.
   * @param agent - Session owner receiving the selection event.
   * @param selection - Asset IDs requested for the session.
   * @returns The detached durable session selection.
   */
  @Remote('selectForSession')
  remoteSelectForSession(agent: Agent, selection: AssetSelection): TavernSessionSelection {
    const inspection = this.host.inspectSelection(selection)
    const hasConversation = agent.session.deriveMessages().length > 0
    const data = {
      selection: inspection.selection,
      baseline: inspection.baseline,
      characterName: inspection.character?.name ?? null,
      worldInfoNames: inspection.worldInfo.map(asset => asset.name),
    }
    const selectionEvent = agent.session.append('tavern/assets-selected', data)
    const character = inspection.character
    if (!hasConversation && character !== null) {
      appendTavernGreeting(agent.session, {
        characterId: character.id,
        characterName: character.name,
        text: character.firstMessage,
        selectionSeq: selectionEvent.seq,
      })
    }
    return structuredClone(data)
  }

  /**
   * Read the latest durable asset selection for a live session.
   * @param agent - Session owner whose log is inspected.
   * @returns The latest selection, or null when none is recorded.
   */
  @Remote('inspectSession')
  remoteInspectSession(agent: Agent): TavernSessionSelection | null {
    const selected = resolveTavernSelection(agent.session)
    return selected === undefined ? null : structuredClone(selected)
  }

  /**
   * Replace one direct user message and invalidate its stale continuation.
   * @param agent - Session owner receiving the edit transaction.
   * @param input - Target event sequence and replacement text.
   * @returns The accepted target sequence.
   */
  @Remote('editMessage')
  remoteEditMessage(agent: Agent, input: TavernMessageEditInput): TavernMessageEditResult {
    if (!Number.isSafeInteger(input.targetSeq) || input.targetSeq < 0) {
      throw new Error('Tavern message edit targetSeq must be a non-negative integer')
    }
    const text = input.text.trim()
    if (text.length === 0) throw new Error('Tavern message edit text must not be empty')
    const target = agent.session.events[input.targetSeq]
    if (target?.type !== 'user/message' || target.data.source.kind !== 'user') {
      throw new Error(`Tavern message edit target ${input.targetSeq} is not a direct user message`)
    }
    agent.session.editMessage(input.targetSeq, {
      ...target.data,
      content: [{ type: 'text', text }],
    })
    return { targetSeq: input.targetSeq }
  }

  /**
   * Inspect selected assets and their source-tracked prompt baseline.
   * @param selection - Asset IDs to inspect.
   * @returns Detached assets and the exact baseline produced by the registry.
   */
  @Remote('inspectSelection')
  remoteInspectSelection(selection: AssetSelection): TavernSelectionInspection {
    return this.host.inspectSelection(selection)
  }

  /**
   * List enabled durable memory entries for a session.
   * @param agent - Session owner whose log is inspected.
   * @returns Detached enabled Memory entries in log order.
   */
  @Remote('listMemory')
  remoteListMemory(agent: Agent): readonly import('./types.ts').TavernMemoryEntry[] {
    return resolveTavernMemory(agent.session)
  }

  /**
   * Append or replace one durable memory entry for a session.
   * @param agent - Session owner receiving the Memory event.
   * @param input - Memory text and optional stable fields.
   * @returns The detached Memory entry written to the Session log.
   */
  @Remote('remember')
  remoteRemember(agent: Agent, input: import('./types.ts').TavernMemoryInput): import('./types.ts').TavernMemoryEntry {
    const text = input.text.trim()
    if (text.length === 0) throw new Error('Tavern memory text must not be empty')
    const level = input.level ?? 'persistent'
    if (level !== 'pinned' && level !== 'persistent' && level !== 'scene') throw new Error(`Unknown Tavern memory level '${level}'`)
    const id = input.id?.trim() || `memory-${agent.session.events.length + 1}`
    const memory = { id, text, level, enabled: true, label: input.label ?? null }
    agent.session.append('tavern/memory', { operation: 'upsert', memory })
    return memory
  }

  /**
   * Read canonical story state and its source records for inspection.
   * @param agent - Session owner whose log is inspected.
   * @returns The projected Story State and source records.
   */
  @Remote('inspectStoryState')
  remoteInspectStoryState(agent: Agent): import('./types.ts').TavernStoryStateInspection {
    return {
      projection: resolveTavernStoryState(agent.session),
      records: resolveTavernStoryStateRecords(agent.session),
    }
  }

  /**
   * Read retained assistant candidates for the current session lineage.
   * @param agent - Session owner whose log is inspected.
   * @returns Candidate groups and projection diagnostics.
   */
  @Remote('inspectSwipe')
  remoteInspectSwipe(agent: Agent): import('./types.ts').TavernSwipeInspection {
    return compactSwipe(resolveTavernSwipe(agent.session))
  }

  /**
   * Append a user-authorized current-candidate selection.
   * @param agent - Session owner receiving the selection event.
   * @param input - Candidate group and candidate IDs to select.
   * @returns Candidate groups after the selection is projected.
   */
  @Remote('selectSwipe')
  remoteSelectSwipe(agent: Agent, input: import('./types.ts').TavernSwipeSelectionInput): import('./types.ts').TavernSwipeInspection {
    agent.session.append('tavern/swipe', {
      kind: 'candidate.select',
      branch: String(agent.session.id),
      groupId: swipeGroupId(input.groupId),
      candidateId: swipeCandidateId(input.candidateId),
      authority: { kind: 'user', extensions: {} },
      validity: { status: 'valid', extensions: {} },
    })
    return this.remoteInspectSwipe(agent)
  }

  /**
   * Fork before one completed turn, retain its selected assistant candidate,
   * and run the original user message on the child for a fresh response.
   * The returned child has completed its first turn and passed a persistence
   * barrier, so callers can inspect or reload it immediately.
   * @param agent - Source session owner.
   * @param input - Candidate group and candidate to retain in the child.
   * @returns The child session created for regeneration.
   */
  @Remote('regenerate')
  async remoteRegenerate(agent: Agent, input: TavernRegenerateInput): Promise<TavernRegenerateResult> {
    const groupId = swipeGroupId(input.groupId)
    const candidateId = swipeCandidateId(input.candidateId)
    const projection = resolveTavernSwipe(agent.session)
    const group = projection.state.groups.find(value => value.groupId === groupId)
    const candidate = group?.candidates.find(value => value.candidateId === candidateId)
    if (group === undefined || candidate === undefined) {
      throw new Error(`Tavern swipe candidate '${input.candidateId}' is not available in group '${input.groupId}'`)
    }
    const turn = parseTurnGroup(input.groupId)
    const turnStart = agent.session.events.findIndex(event => event.type === 'turn/start' && event.data.turn === turn)
    const turnEnd = agent.session.events.findIndex((event, index) => index >= turnStart && event.type === 'turn/end' && event.data.turn === turn)
    if (turnStart < 0 || turnEnd < 0) throw new Error(`Tavern swipe group '${input.groupId}' has no completed turn`)
    const userEvent = agent.session.events
      .slice(turnStart, turnEnd + 1)
      .find((event): event is import('@deepseek-ai/dsh-session/types').SessionEvent<'user/message'> =>
        event.type === 'user/message' && event.data.source.kind === 'user')
    if (userEvent === undefined) throw new Error(`Tavern turn ${String(turn)} has no direct user message to regenerate`)

    const presets = this.ctx.get('agentPresets')
    const presetId = presets?.composedPreset(agent.ctx)
    const childId = `session-${randomUUID()}` as import('@deepseek-ai/dsh-session/types').SessionId
    const handle = await agent.ctx.agents.create({
      sessionId: childId,
      seed: agent.session.events.slice(0, turnStart),
      meta: {
        ...(agent.session.header.cwd === undefined ? {} : { cwd: agent.session.header.cwd }),
        parentSession: agent.session.id,
        seedLength: turnStart,
        ...(presetId === undefined ? {} : { agentPreset: presetId }),
      },
      agentOptions: agent.options,
      setup: (childCtx) => {
        if (presets !== undefined) presets.composeFrom(childCtx, agent.ctx)
      },
    })
    try {
      childCopyCandidate(handle.agent.session, groupId, candidate)
      const workspace = this.ctx.get('workspaceRegistry')?.list().find(item => item.sessionIds.includes(agent.session.id))
      if (workspace !== undefined) await workspace.attachSession(childId)
      handle.agent.followup(userEvent.data)
      await handle.agent.whenIdle()
      await handle.agent.ctx.sessions.flush(handle.agent.session)
      return { sessionId: childId }
    } catch (error) {
      await handle.dispose()
      throw error
    }
  }

  /**
   * Append one user-authorized canonical story-state change.
   * @param agent - Session owner receiving the Story State event.
   * @param change - Canonical location or time change to append.
   * @returns Story State after the change is projected.
   */
  @Remote('setStoryState')
  remoteSetStoryState(agent: Agent, change: StoryStateChange): import('./types.ts').TavernStoryStateInspection {
    const authority: StoryStateAuthority = { kind: 'user', extensions: {} }
    agent.session.append('tavern/story-state', {
      branch: String(agent.session.id),
      change,
      authority,
      validity: { status: 'valid', extensions: {} },
    })
    return this.remoteInspectStoryState(agent)
  }

  private restore(record: TavernAssetRecord): void {
    if (record.kind === 'character') {
      this.host.importCharacter(asCompatJson(record.input), { id: record.id, source: record.source })
      return
    }
    this.host.importWorldInfo(asCompatJson(record.input), { id: record.id, source: record.source })
  }

  private requireTable(): KvTable<import('@deepseek-ai/dsh-tavern-assets/types').AssetId, TavernAssetRecord> {
    if (this.table === undefined) throw new Error('tavernAssets: durable asset library is not initialized')
    return this.table
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationChain.then(operation)
    this.mutationChain = result.then(() => undefined, () => undefined)
    return result
  }
}

export default TavernAssetService

function sourceReference(source: TavernImportSource | undefined, kind: string): AssetSourceReference {
  return {
    kind: source?.kind ?? kind,
    locator: source?.locator ?? 'host://inline',
    mediaType: source?.mediaType ?? 'application/json',
    digest: source?.digest ?? null,
  }
}

function slugId(name: string): string {
  const slug = name.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')
  return slug.length === 0 ? 'asset' : slug
}

function normalizePosition(position: string | number | null): WorldInfoPosition {
  if (position === 'before-character' || position === 'after-character'
    || position === 'before-history' || position === 'after-history' || position === 'at-depth') return position
  if (position === 'before_char') return 'before-character'
  if (position === 'after_char') return 'after-character'
  if (position === 'before_an') return 'before-history'
  if (position === 'after_an') return 'after-history'
  if (position === 'at_depth') return 'at-depth'
  // SillyTavern/YMLv2 uses numeric insertion positions in older exports:
  // 0/1 are around the character definition, 2/3 and 4/5 are history-side
  // placements, and 6 is the explicit depth insertion point.
  if (position === 0) return 'before-character'
  if (position === 1) return 'after-character'
  if (position === 2 || position === 4) return 'before-history'
  if (position === 3 || position === 5) return 'after-history'
  if (position === 6) return 'at-depth'
  return 'at-depth'
}

function cloneAsset<T extends TavernAsset>(asset: T): T {
  return structuredClone(asset)
}

function recordOf(asset: TavernAsset, source: TavernImportSource | undefined): TavernAssetRecord {
  return {
    kind: asset.kind,
    id: asset.id,
    input: asset.sourceData,
    source: {
      kind: source?.kind ?? asset.sourceReferences[0]?.kind ?? asset.kind,
      locator: source?.locator ?? asset.sourceReferences[0]?.locator ?? 'host://inline',
      mediaType: source?.mediaType ?? asset.sourceReferences[0]?.mediaType ?? 'application/json',
      digest: source?.digest ?? asset.sourceReferences[0]?.digest ?? null,
    },
  }
}

/** The two packages expose equivalent JSON vocabularies with separate types. */
function asCompatJson(input: import('@deepseek-ai/dsh-tavern-assets/types').JsonObject): JsonInput {
  return input as unknown as JsonInput
}

function compactSwipe(projection: SwipeProjection): import('./types.ts').TavernSwipeInspection {
  return {
    groups: projection.state.groups.map(group => ({
      groupId: group.groupId,
      currentCandidateId: group.currentCandidateId,
      candidates: group.candidates.map(candidate => ({
        candidateId: candidate.candidateId,
        origin: candidate.origin,
        text: assistantCandidateText(candidate.content),
      })),
    })),
    issues: projection.issues.map(issue => ({ code: issue.code, message: issue.message })),
  }
}

function assistantCandidateText(value: unknown): string {
  if (!isRecord(value)) return ''
  const content = value['content']
  if (!Array.isArray(content)) return ''
  return content
    .filter(isRecord)
    .filter(block => block['type'] === 'text' && typeof block['text'] === 'string')
    .map(block => String(block['text']))
    .join('')
}

function parseTurnGroup(groupId: string): number {
  const value = Number(groupId.startsWith('turn:') ? groupId.slice('turn:'.length) : NaN)
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Tavern swipe group '${groupId}' is not turn-addressed`)
  return value
}

function childCopyCandidate(
  session: import('@deepseek-ai/dsh-session').Session,
  groupId: import('@deepseek-ai/dsh-tavern-state/types').SwipeGroupId,
  candidate: import('@deepseek-ai/dsh-tavern-state/types').SwipeAssistantCandidate,
): void {
  session.append('tavern/swipe', {
    kind: 'candidate.add',
    branch: String(session.id),
    groupId,
    candidate: structuredClone(candidate),
    authority: { kind: 'observed', extensions: {} },
    validity: { status: 'valid', extensions: {} },
  })
  session.append('tavern/swipe', {
    kind: 'candidate.select',
    branch: String(session.id),
    groupId,
    candidateId: candidate.candidateId,
    authority: { kind: 'observed', extensions: {} },
    validity: { status: 'valid', extensions: {} },
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
