/** Host-side import and selection facade for Tavern assets. */

import {
  parseCharacterCard,
  parseWorldInfo,
} from '@deepseek-ai/dsh-tavern-compat'
import type { JsonInput, NormalizedCharacterCard, NormalizedWorldInfo } from '@deepseek-ai/dsh-tavern-compat'
import {
  AssetRegistry,
  AssetRegistryError,
  createAssetId,
  projectPromptAssetBaseline,
  serializeCharacterAsset,
  serializeWorldInfoAsset,
} from '@deepseek-ai/dsh-tavern-assets'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-workspace'
import { randomUUID } from 'node:crypto'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type {
  AssetSelection,
  AssetSourceReference,
  AssetId,
  CharacterAsset,
  PromptAssetBaseline,
  PromptWorldInfoEntry,
  TavernAsset,
  WorldInfoAsset,
  WorldInfoPosition,
} from '@deepseek-ai/dsh-tavern-assets/types'
import type { CompiledContext } from '@deepseek-ai/dsh-tavern-context/types'
import { cleanTavernAsset, resolveMemoryConfig } from '@deepseek-ai/dsh-tavern-memory'
import type { MemoryConfigInput } from '@deepseek-ai/dsh-tavern-memory'
import { collectCharacterEntries, isRecord, parseLabeledLines, slug } from '@deepseek-ai/dsh-tavern-shared'
import type {
  TavernImportOptions,
  TavernImportResult,
  TavernImportSource,
  TavernUpdateOptions,
  TavernSelectionInspection,
  TavernSessionSelection,
  TavernRegenerateInput,
  TavernRegenerateResult,
  TavernMessageEditInput,
  TavernMessageEditResult,
  TavernFactEditInput,
  TavernFactRemovalInput,
  TavernFactInspection,
  TavernGmResponseInspection,
  TavernAssetsEditedEvent,
  TavernHistoryEntry,
  TavernJourneyAssetProjection,
  TavernFactEntry,
  TavernFactEvent,
  TavernFactProjection,
  TavernBootstrapJourneyResult,
  TavernSectionConfigInput,
  TavernSectionConfigInspection,
  TavernAssetCleaningPreview,
  TavernAssetCleaningRecord,
  TavernAssetCleaningRoute,
  TavernMemoryInspection,
} from './types.ts'
import type { CanonicalAssetView } from './client.ts'
import { swipeCandidateId, swipeGroupId } from '@deepseek-ai/dsh-tavern-state'
import type { StoryStateAuthority, StoryStateChange, SwipeProjection } from '@deepseek-ai/dsh-tavern-state/types'
import { tavernAssetDomainSpec } from './spec.ts'
import type { TavernAssetRecord } from './spec.ts'
import { compileTavernContext, installTavernAgent, reconcileTavernMessageEdit } from './runtime.ts'
import { bootstrapJourney } from './normalization.ts'
import { TavernHistoryArchiveError } from './errors.ts'
import {
  appendTavernGreeting,
  appendTavernSectionConfig,
  inspectTavernSectionConfig,
  appendTavernSwipeCandidate,
  resolveTavernContextActivation,
  resolveTavernGreeting,
  resolveTavernSelection,
  resolveTavernStoryState,
  resolveTavernStoryStateRecords,
  resolveTavernSwipe,
} from './session.ts'
import type { TavernSelectionEvent } from './session.ts'
import {
  queryTavernPersonFacts,
  queryTavernWorldFacts,
  projectTavernJourneyAssets,
  resolveTavernFacts,
} from './facts.ts'
import { parseCleaningRoute, resolveAssetCleaning, validateCanonicalAssetView } from './cleaning.ts'
import { TavernCompactionEngine } from './compaction.ts'
import { projectTavernMemory } from './memory.ts'

const TAVERN_PERSISTENCE_BARRIER_TIMEOUT_MS = 1_000

/** Optional Host configuration for the Journey memory runtime. */
export interface TavernAssetConfig {
  /** Tavern Journey memory policy. */
  readonly memory?: MemoryConfigInput
  /** Optional route for model-assisted canonical asset cleaning. */
  readonly cleaner?: {
    /** Whether model-assisted canonical asset cleaning is enabled. */
    readonly enabled?: boolean
    /** Provider/model route for model-assisted canonical asset cleaning. */
    readonly route?: string
  }
  /** Whether the host should mount its native `ctx.compaction` provider. */
  readonly compaction?: {
    /** Whether to mount the Host-native compaction provider. */
    readonly enabled?: boolean
  }
}

export { parseTavernGmResponse } from './gm-output.ts'
export {
  appendTavernFactEdit,
  appendTavernFactRemoval,
  detectConflicts,
  factIsVisibleInSession,
  isTavernFactVisibleInSession,
  parseTavernGmUpdates,
  projectTavernJourneyAssets,
  queryTavernPersonFacts,
  queryTavernWorldFacts,
  resolveFactProjection,
  resolveTavernFacts,
} from './facts.ts'

export type * from './types.ts'
export { tavernAssetDomainSpec, tavernAssetRecordSchema } from './spec.ts'
export type { TavernAssetRecord } from './spec.ts'
export { appendTavernGreeting, resolveTavernContextFingerprint, resolveTavernGreeting, resolveTavernSelection, resolveTavernSelectionAt, resolveTavernStoryState, resolveTavernStoryStateRecords, resolveTavernSwipe, resolveTavernSwipeRecords } from './session.ts'
export { appendTavernSectionConfig, inspectTavernSectionConfig, resolveTavernSectionConfig } from './session.ts'
export type { TavernAssetsSelectedEvent, TavernContextActivationEvent } from './session.ts'
export { TavernHistoryArchiveError } from './errors.ts'
export type { TavernHistoryArchiveErrorCode } from './errors.ts'
export { buildAssetCleaningPrompt, parseCleaningRoute, resolveAssetCleaning, validateCanonicalAssetView } from './cleaning.ts'
export type { TavernAssetCleaner } from './cleaning.ts'
export { TavernCompactionEngine, selectTavernCompactionRange } from './compaction.ts'
export { projectTavernMemory } from './memory.ts'
export type { TavernAssetsEditedEvent, TavernAssetsNormalizedEvent, TavernFactEditInput, TavernFactEntry, TavernFactEvent, TavernFactInspection, TavernFactOperation, TavernFactProjection, TavernFactRemovalInput, TavernGmResponse, TavernGmResponseInspection, TavernGmUpdates, TavernGreetingEvent, TavernHistoryEntry, TavernJourneyAssetProjection, TavernJourneyField, TavernJourneyPerson, TavernJourneySelection, TavernMemoryCheckpoint, TavernMemoryInspection, TavernStoryStateEvent, TavernStoryStateInspection, TavernSwipeEvent, TavernSwipeInspection, TavernSwipeSelectionInput, TavernRegenerateInput, TavernRegenerateResult, TavernMessageEditInput, TavernMessageEditResult } from './types.ts'

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
  /** Canonical views keyed by source asset ID; source JSON remains in the registry. */
  private readonly cleaningRecords = new Map<string, TavernAssetCleaningRecord>()

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
   * Resolve one registered asset by ID.
   * @param id - Asset identifier.
   * @returns A detached asset, or `undefined` when absent.
   */
  getAsset(id: AssetId): TavernAsset | undefined {
    return this.registry.getCharacter(id) ?? this.registry.getWorldInfo(id)
  }

  /**
   * Read the current canonical cleaning record for one source asset.
   * @param id - Asset identifier.
   * @returns A detached cleaning record, or `undefined` when absent.
   */
  getCleaningRecord(id: AssetId): TavernAssetCleaningRecord | undefined {
    const record = this.cleaningRecords.get(String(id))
    return record === undefined ? undefined : structuredClone(record)
  }

  /**
   * Return the canonical view for a registered asset, falling back to the
   * deterministic source projection when no durable cleaner record exists.
   * @param id - Asset identifier.
   * @returns A detached canonical view, or `undefined` when the asset is absent.
   */
  getCanonicalView(id: AssetId): CanonicalAssetView | undefined {
    const asset = this.getAsset(id)
    if (asset === undefined) return undefined
    return structuredClone(this.cleaningRecords.get(String(id))?.view ?? cleanTavernAsset(asset))
  }

  /**
   * Store a validated canonical view beside its original source asset.
   * @param id - Asset identifier.
   * @param record - Cleaner status and canonical view.
   * @returns Nothing.
   * @throws when the record does not match the registered asset.
   */
  setCleaningRecord(id: AssetId, record: TavernAssetCleaningRecord): void {
    const asset = this.getAsset(id)
    if (asset === undefined) throw new AssetRegistryError('asset-not-found', `asset '${id}' was not found`)
    const view = validateCanonicalAssetView(record.view, asset)
    this.cleaningRecords.set(String(id), {
      ...structuredClone(record),
      view,
    })
  }

  /**
   * Confirm a caller-edited canonical view without changing the original asset.
   * @param id - Asset identifier.
   * @param view - User-confirmed canonical view.
   * @returns The durable confirmed record.
   */
  confirmCleaning(id: AssetId, view: CanonicalAssetView): TavernAssetCleaningRecord {
    const asset = this.getAsset(id)
    if (asset === undefined) throw new AssetRegistryError('asset-not-found', `asset '${id}' was not found`)
    const validated = validateCanonicalAssetView(view, asset)
    const previous = this.cleaningRecords.get(String(id))
    const record: TavernAssetCleaningRecord = {
      status: 'confirmed',
      origin: previous?.origin ?? 'heuristic',
      view: { ...validated, uncleaned: false },
      ...(previous?.route === undefined ? {} : { route: previous.route }),
    }
    this.cleaningRecords.set(String(id), structuredClone(record))
    return structuredClone(record)
  }

  /**
   * Parse, normalize, and register one Character Card V2/V3 JSON document.
   * @param input - JSON text or parsed Character Card object.
   * @param options - Optional stable ID and source metadata.
   * @returns The registered detached asset and its disposer.
   */
  importCharacter(input: JsonInput, options: TavernImportOptions = {}): TavernImportResult<CharacterAsset> {
    const card = parseCharacterCard(input)
    const id = createAssetId(options.id ?? slug(card.name, 'asset'))
    return this.register(createCharacterAsset(
      card,
      id,
      sourceReference(options.source, 'character-card'),
    ))
  }

  /**
   * Parse one Character Card without registering it in the source library.
   * @param input - JSON text or parsed Character Card object.
   * @param options - Stable ID and source metadata for the detached copy.
   * @returns A detached normalized Character Card snapshot.
   */
  parseCharacter(input: JsonInput, options: TavernImportOptions): CharacterAsset {
    const card = parseCharacterCard(input)
    const id = createAssetId(options.id ?? slug(card.name, 'asset'))
    return createCharacterAsset(card, id, sourceReference(options.source, 'character-card'))
  }

  /**
   * Parse and replace one persisted Character Card under its existing ID.
   * @param input - Character Card JSON text or parsed data.
   * @param options - Existing asset ID and optional source metadata.
   * @returns The replacement snapshot and a rollback disposer.
   */
  updateCharacter(input: JsonInput, options: TavernUpdateOptions): TavernImportResult<CharacterAsset> {
    const id = createAssetId(options.id)
    if (this.registry.getCharacter(id) === undefined) {
      throw new AssetRegistryError('asset-not-found', `character asset '${id}' was not found`)
    }
    const asset = this.parseCharacter(input, options)
    return this.replace(asset)
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
    return this.register(normalizedWorldInfoAsset(
      world,
      createAssetId(options.id ?? slug(name, 'asset')),
      name,
      sourceReference(options.source, 'world-info'),
    ))
  }

  /**
   * Parse one World Info document without registering it in the source library.
   * @param input - JSON text or parsed World Info object.
   * @param options - Stable ID and source metadata for the detached copy.
   * @returns A detached normalized World Info snapshot.
   */
  parseWorldInfo(input: JsonInput, options: TavernImportOptions): WorldInfoAsset {
    const world = parseWorldInfo(input)
    const name = world.name ?? 'World Info'
    return normalizedWorldInfoAsset(
      world,
      createAssetId(options.id ?? slug(name, 'asset')),
      name,
      sourceReference(options.source, 'world-info'),
    )
  }

  /**
   * Parse and replace one persisted World Book under its existing ID.
   * @param input - World Info JSON text or parsed data.
   * @param options - Existing asset ID and optional source metadata.
   * @returns The replacement snapshot and a rollback disposer.
   */
  updateWorldInfo(input: JsonInput, options: TavernUpdateOptions): TavernImportResult<WorldInfoAsset> {
    const id = createAssetId(options.id)
    if (this.registry.getWorldInfo(id) === undefined) {
      throw new AssetRegistryError('asset-not-found', `World Book asset '${id}' was not found`)
    }
    const asset = this.parseWorldInfo(input, options)
    return this.replace(asset)
  }

  /**
   * Remove one asset from the source registry.
   * @param id - Asset identifier to remove.
   * @returns A detached removed asset, or `undefined` when absent.
   */
  removeAsset(id: import('@deepseek-ai/dsh-tavern-assets/types').AssetId): TavernAsset | undefined {
    const removed = this.registry.remove(id)
    if (removed !== undefined) this.cleaningRecords.delete(String(id))
    return removed
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
    const disposeRegistry = this.registry.register(asset)
    this.cleaningRecords.set(String(asset.id), fallbackCleaningRecord(asset))
    return {
      asset: cloneAsset(asset),
      dispose: () => {
        disposeRegistry()
        this.cleaningRecords.delete(String(asset.id))
      },
    }
  }

  private replace<T extends TavernAsset>(asset: T): TavernImportResult<T> {
    const previous = this.cleaningRecords.get(String(asset.id))
    const disposeRegistry = this.registry.replace(asset)
    this.cleaningRecords.set(String(asset.id), fallbackCleaningRecord(asset))
    return {
      asset: cloneAsset(asset),
      dispose: () => {
        disposeRegistry()
        if (previous === undefined) this.cleaningRecords.delete(String(asset.id))
        else this.cleaningRecords.set(String(asset.id), structuredClone(previous))
      },
    }
  }

}

/** Host Cordis service exposing Tavern asset operations through Typert Remote. */
export class TavernAssetService extends TypertRemoteService {
  static inject = ['storageDomain', 'sessionPersistence']
  // MemoryConfig owns nested defaults and validation; keeping this payload
  // opaque prevents Schemastery from manufacturing null tuple members for
  // omitted nested fields before resolveMemoryConfig sees the input.
  static Config = z.object({ memory: z.any(), cleaner: z.any(), compaction: z.any() })

  /** Host facade used by the Remote methods and startup restore path. */
  readonly host: TavernAssetHost
  /** Validated memory policy passed to every Journey runtime. */
  readonly memoryConfig: ReturnType<typeof resolveMemoryConfig>
  /** Optional model route used to replace the deterministic cleaning view. */
  readonly cleanerRoute: TavernAssetCleaningRoute | undefined
  /** Host compaction mounting policy. */
  readonly compactionEnabled: boolean
  private table?: KvTable<import('@deepseek-ai/dsh-tavern-assets/types').AssetId, TavernAssetRecord>
  private mutationChain: Promise<void> = Promise.resolve()
  private readonly normalizationTasks = new WeakMap<Session, Promise<TavernSessionSelection | null>>()

  constructor(ctx: Context, config: TavernAssetConfig = {}) {
    super(ctx, 'tavernAssets')
    this.host = new TavernAssetHost()
    this.memoryConfig = resolveMemoryConfig(config.memory)
    this.cleanerRoute = config.cleaner?.enabled === false || config.cleaner?.route === undefined
      ? undefined
      : parseCleaningRoute(config.cleaner.route)
    this.compactionEnabled = config.compaction?.enabled !== false
    ctx.on('agent/created', ({ agent }) => {
      agent.ctx.effect(() => installTavernAgent(
        agent,
        () => restoreTavernSelection(this.host, resolveTavernSelection(agent.session), agent.session, true),
        this.memoryConfig,
      ), 'tavern.agent-runtime')
    })
  }

  /** Restore the durable asset library before the service accepts Remote calls. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(tavernAssetDomainSpec)
    this.ctx.effect(() => async () => domain.close(), 'tavernAssets.domainClose')
    this.table = domain.table('assets')
    for (const [, record] of this.table.entries()) this.restore(record)
    if (this.compactionEnabled && this.ctx.get('compaction') === undefined) {
      await this.ctx.plugin(TavernCompactionEngine, { memory: this.memoryConfig })
    }
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
        const cleaning = await resolveAssetCleaning(this.ctx, imported.asset, this.cleanerRoute)
        this.host.setCleaningRecord(imported.asset.id, cleaning)
        await this.requireTable().put(imported.asset.id, recordOf(imported.asset, options?.source, cleaning))
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
        const cleaning = await resolveAssetCleaning(this.ctx, imported.asset, this.cleanerRoute)
        this.host.setCleaningRecord(imported.asset.id, cleaning)
        await this.requireTable().put(imported.asset.id, recordOf(imported.asset, options?.source, cleaning))
      } catch (error) {
        imported.dispose()
        throw error
      }
      return imported.asset
    })
  }

  /**
   * Replace one Character Card in the durable source registry.
   * @param input - Character Card JSON text.
   * @param options - Existing asset ID and optional source metadata.
   * @returns The persisted replacement asset.
   */
  @Remote('updateCharacter')
  async remoteUpdateCharacter(input: string, options: TavernUpdateOptions): Promise<CharacterAsset> {
    return this.enqueueMutation(async () => {
      const updated = this.host.updateCharacter(input, options)
      try {
        const cleaning = await resolveAssetCleaning(this.ctx, updated.asset, this.cleanerRoute)
        this.host.setCleaningRecord(updated.asset.id, cleaning)
        await this.requireTable().put(updated.asset.id, recordOf(updated.asset, options.source, cleaning))
      } catch (error) {
        updated.dispose()
        throw error
      }
      return updated.asset
    })
  }

  /**
   * Replace one World Book in the durable source registry.
   * @param input - World Info JSON text.
   * @param options - Existing asset ID and optional source metadata.
   * @returns The persisted replacement asset.
   */
  @Remote('updateWorldInfo')
  async remoteUpdateWorldInfo(input: string, options: TavernUpdateOptions): Promise<WorldInfoAsset> {
    return this.enqueueMutation(async () => {
      const updated = this.host.updateWorldInfo(input, options)
      try {
        const cleaning = await resolveAssetCleaning(this.ctx, updated.asset, this.cleanerRoute)
        this.host.setCleaningRecord(updated.asset.id, cleaning)
        await this.requireTable().put(updated.asset.id, recordOf(updated.asset, options.source, cleaning))
      } catch (error) {
        updated.dispose()
        throw error
      }
      return updated.asset
    })
  }

  /**
   * Delete one source asset from the durable registry.
   * @param id - Asset identifier to delete.
   * @returns `true` when the durable record was removed.
   * @remarks Existing Journey selections keep their IDs and resolve against the current source registry. Re-import the
   * same ID to restore a Journey that references a deleted asset.
   */
  @Remote('deleteAsset')
  async remoteDeleteAsset(id: import('@deepseek-ai/dsh-tavern-assets/types').AssetId): Promise<boolean> {
    return this.enqueueMutation(async () => {
      const previousCleaning = this.host.getCleaningRecord(id)
      const removed = this.host.removeAsset(id)
      try {
        const deleted = await this.requireTable().delete(id)
        if (!deleted) {
          if (removed !== undefined) this.restoreHostAsset(removed, previousCleaning)
          return false
        }
        return true
      } catch (error) {
        if (removed !== undefined) this.restoreHostAsset(removed, previousCleaning)
        throw error
      }
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
   * Select assets for a live session and append only their references to its log.
   * @param agent - Session owner receiving the selection event.
   * @param selection - Asset IDs requested for the session.
   * @param playerIdentity - Optional player-facing identity retained by the Journey.
   * @returns The detached source selection resolved from the asset registry.
   */
  @Remote('selectForSession')
  async remoteSelectForSession(
    agent: Agent,
    selection: AssetSelection,
    playerIdentity?: string | null,
  ): Promise<TavernSessionSelection> {
    const current = resolveTavernSelection(agent.session)
    const identity = playerIdentity === undefined ? current?.playerIdentity ?? null : playerIdentity
    const result = await this.bootstrapJourneyForSession(agent, selection, identity)
    return structuredClone(result.selection)
  }

  /**
   * Start a Journey and materialize its authored assets as source-tracked facts.
   *
   * The normalized fields returned by the optional model pass are used only to
   * construct append-only `tavern/fact` events. The `assets-normalized` event
   * records route metadata, while the fact stream remains the Journey memory
   * source of truth.
   * @param agent - Session owner receiving the selection and authored facts.
   * @param selection - Character Card and optional World Book selection.
   * @param playerIdentity - Optional player-facing identity retained by the Journey.
   * @returns The selected source projection and its current fact projection.
   */
  @Remote('bootstrapJourney')
  async remoteBootstrapJourney(
    agent: Agent,
    selection: AssetSelection,
    playerIdentity?: string | null,
  ): Promise<TavernBootstrapJourneyResult> {
    if (selection.characterId === null) throw new Error('Tavern Journey requires a Character Card')
    return this.bootstrapJourneyForSession(agent, selection, playerIdentity)
  }

  private async bootstrapJourneyForSession(
    agent: Agent,
    selection: AssetSelection,
    playerIdentity?: string | null,
  ): Promise<TavernBootstrapJourneyResult> {
    if (selection.characterId === null) throw new Error('Tavern Journey requires a Character Card')
    const currentIdentity = resolveTavernSelection(agent.session)?.playerIdentity
    const normalizedIdentity = playerIdentity === undefined
      ? currentIdentity ?? null
      : normalizePlayerIdentity(playerIdentity)
    const current = resolveTavernSelection(agent.session)
    const currentVersion = current === undefined ? -1 : latestTavernSelectionEventSeq(agent.session)
    if (current !== undefined
      && sameSelection(current.selection, selection)
      && (current.playerIdentity ?? null) === normalizedIdentity
      && hasNormalizationAfter(agent.session, currentVersion)) {
      const restored = restoreTavernSelection(this.host, current, agent.session)
      if (restored === undefined) throw new Error('Tavern Journey selection disappeared during bootstrap')
      await flushTavernSession(agent)
      return {
        selection: restored,
        factProjection: structuredClone(resolveTavernFacts(agent.session)),
      }
    }
    const inspection = this.host.inspectSelection(selection)
    const sourceSelection = selectionData(inspection, normalizedIdentity)
    const selectionEvent = agent.session.append('tavern/assets-selected', {
      selection: structuredClone(selection),
      playerIdentity: normalizedIdentity,
    })
    if (inspection.character !== null && agent.session.deriveMessages().length === 0) {
      appendTavernGreeting(agent.session, {
        characterId: inspection.character.id,
        characterName: inspection.character.name,
        text: inspection.character.firstMessage,
        selectionSeq: selectionEvent.seq,
      })
    }

    const normalized = await bootstrapJourney(agent, sourceSelection)
    for (const fact of normalized.factEvents) agent.session.append('tavern/fact', fact)
    agent.session.append('tavern/assets-normalized', {
      origin: normalized.origin,
      ...(normalized.route === undefined ? {} : { route: normalized.route }),
    })
    await flushTavernSession(agent)
    const selected = restoreTavernSelection(this.host, resolveTavernSelection(agent.session), agent.session)
    if (selected === undefined) throw new Error('Tavern Journey selection disappeared during bootstrap')
    return {
      selection: structuredClone(selected),
      factProjection: structuredClone(resolveTavernFacts(agent.session)),
    }
  }

  /**
   * Replace the Character Card copy inside the current Journey only.
   * @param agent - Session owner receiving the append-only asset event.
   * @param input - Character Card JSON for the current Journey selection.
   * @returns The updated Journey selection.
   */
  @Remote('editJourneyCharacter')
  remoteEditJourneyCharacter(agent: Agent, input: string): TavernSessionSelection {
    const selected = requireJourneySelection(agent.session, this.host)
    if (selected.character === null) throw new Error('Tavern Journey has no selected Character Card')
    const source = selected.character.sourceReferences[0]
    const character = this.host.parseCharacter(input, {
      id: selected.character.id,
      ...(source === undefined ? {} : { source }),
    })
    return appendJourneyAssetEdit(agent.session, selected, character, selected.worldInfo, 'character', character.id)
  }

  /**
   * Replace a World Book copy inside the current Journey only.
   * @param agent - Session owner receiving the append-only asset event.
   * @param assetId - Selected standalone or embedded World Book ID.
   * @param input - World Info JSON for the current Journey selection.
   * @returns The updated Journey selection.
   */
  @Remote('editJourneyWorldInfo')
  remoteEditJourneyWorldInfo(agent: Agent, assetId: import('@deepseek-ai/dsh-tavern-assets/types').AssetId, input: string): TavernSessionSelection {
    const selected = requireJourneySelection(agent.session, this.host)
    const current = selected.worldInfo.find(asset => asset.id === assetId)
    const embedded = selected.character?.characterBook?.id === assetId ? selected.character.characterBook : undefined
    if (current === undefined && embedded === undefined) throw new Error(`Tavern Journey World Book '${assetId}' was not found`)
    const source = (current ?? embedded)?.sourceReferences[0]
    const updated = this.host.parseWorldInfo(input, {
      id: assetId,
      ...(source === undefined ? {} : { source }),
    })
    const worldInfo = current === undefined
      ? [...selected.worldInfo]
      : selected.worldInfo.map(asset => asset.id === assetId ? updated : asset)
    const character = embedded === undefined || selected.character === null
      ? selected.character
      : { ...selected.character, characterBook: updated }
    return appendJourneyAssetEdit(agent.session, selected, character, worldInfo, 'world-info', assetId)
  }

  /**
   * Normalize the selected Journey assets once and append authored fact events.
   * @param agent - Session owner receiving the normalization event.
   * @returns The current selected Journey, or null when nothing is selected.
   */
  @Remote('normalizeForSession')
  async remoteNormalizeForSession(agent: Agent): Promise<TavernSessionSelection | null> {
    const selectedEvent = resolveTavernSelection(agent.session)
    const selected = restoreTavernSelection(this.host, selectedEvent, agent.session)
    if (selected === undefined) return null
    const selectionVersion = latestTavernSelectionEventSeq(agent.session)
    if (hasNormalizationAfter(agent.session, selectionVersion)) return structuredClone(selected)
    const pending = this.normalizationTasks.get(agent.session)
    if (pending !== undefined) return structuredClone(await pending)
    if (selectedEvent === undefined) return null
    const task = this.normalizeSession(agent, selectedEvent)
    this.normalizationTasks.set(agent.session, task)
    try {
      return structuredClone(await task)
    } finally {
      if (this.normalizationTasks.get(agent.session) === task) this.normalizationTasks.delete(agent.session)
    }
  }

  private async normalizeSession(agent: Agent, selected: TavernSelectionEvent): Promise<TavernSessionSelection | null> {
    const selectionVersion = latestTavernSelectionEventSeq(agent.session)
    const sourceSelection = restoreTavernSelection(this.host, selected, agent.session)
    if (sourceSelection === undefined) return null
    const normalized = await bootstrapJourney(agent, sourceSelection, { branch: String(agent.session.id) })
    const latest = restoreTavernSelection(this.host, resolveTavernSelection(agent.session), agent.session)
    if (latest === undefined
      || !sameSelection(selected.selection, latest.selection)
      || latestTavernSelectionEventSeq(agent.session) !== selectionVersion) {
      return latest === undefined ? null : structuredClone(latest)
    }
    if (hasNormalizationAfter(agent.session, selectionVersion)) return structuredClone(latest)
    for (const fact of normalized.factEvents) agent.session.append('tavern/fact', fact)
    agent.session.append('tavern/assets-normalized', {
      origin: normalized.origin,
      ...(normalized.route === undefined ? {} : { route: normalized.route }),
    })
    await flushTavernSession(agent)
    return structuredClone(latest)
  }

  /**
   * Read the latest durable asset selection for a session.
   * @param sessionId - Session whose complete durable log is inspected.
   * @returns The latest selection, or null when none is recorded.
   */
  @Remote('inspectSession')
  async remoteInspectSession(sessionId: SessionId): Promise<TavernSessionSelection | null> {
    assertHistoryReadable(this.ctx, sessionId)
    const inspected = await this.ctx.sessionPersistence.inspect(sessionId)
    const selected = restoreTavernSelection(this.host, resolveTavernSelection(inspected), inspected)
    return selected === undefined ? null : structuredClone(selected)
  }

  /**
   * Read a cold Tavern session for the history page without starting its Agent.
   * @param sessionId - Durable Tavern session to summarize.
   * @returns The resolved Journey character data and latest textual content.
   */
  @Remote('inspectHistory')
  async remoteInspectHistory(sessionId: SessionId): Promise<TavernHistoryEntry> {
    assertHistoryReadable(this.ctx, sessionId)
    const inspected = await this.ctx.sessionPersistence.inspect(sessionId)
    const selected = restoreTavernSelection(this.host, resolveTavernSelection(inspected), inspected)
    return {
      sessionId,
      selection: selected === undefined ? null : structuredClone(selected),
      character: selected?.character === null || selected?.character === undefined ? null : structuredClone(selected.character),
      characterName: selected?.characterName ?? null,
      lastContent: latestSessionText(inspected.events),
    }
  }

  /**
   * Read an archived Tavern Journey for the History page. Archived entries
   * intentionally use a separate Remote from active-history inspection:
   * active grouping surfaces continue to reject archived sessions while the
   * Tavern archive retains a read-and-restore path.
   * @param sessionId - Archived Tavern session to inspect.
   * @returns The resolved Journey character data and latest text.
   */
  @Remote('inspectArchivedHistory')
  async remoteInspectArchivedHistory(sessionId: SessionId): Promise<TavernHistoryEntry> {
    const workspace = this.ctx.get('workspaceRegistry')
    if (workspace === undefined || !workspace.archivedSessionIds.includes(sessionId)) {
      throw new TavernHistoryArchiveError(
        'history-not-found',
        sessionId,
        `Tavern history session '${sessionId}' is not archived`,
      )
    }
    const inspected = await this.ctx.sessionPersistence.inspect(sessionId)
    const selected = restoreTavernSelection(this.host, resolveTavernSelection(inspected), inspected)
    return {
      sessionId,
      selection: selected === undefined ? null : structuredClone(selected),
      character: selected?.character === null || selected?.character === undefined ? null : structuredClone(selected.character),
      characterName: selected?.characterName ?? null,
      lastContent: latestSessionText(inspected.events),
    }
  }

  /**
   * Archive one history session through the workspace's durable registry.
   * @param sessionId - Session identifier to hide from workspace projections.
   * @returns Resolution after the archive state is durable.
   */
  @Remote('archiveHistory')
  async remoteArchiveHistory(sessionId: SessionId): Promise<void> {
    await this.enqueueMutation(async () => {
      const workspace = this.ctx.get('workspaceRegistry')
      if (workspace === undefined) {
        throw new TavernHistoryArchiveError(
          'history-archive-unavailable',
          sessionId,
          'Tavern history archive requires WorkspaceRegistry',
        )
      }
      if (workspace.archivedSessionIds.includes(sessionId)) {
        throw new TavernHistoryArchiveError(
          'history-already-archived',
          sessionId,
          `Tavern history session '${sessionId}' is already archived`,
        )
      }
      try {
        await workspace.archiveSession(sessionId)
      } catch (error) {
        if (error instanceof Error && error.name === 'WorkspaceUnknownSessionError') {
          throw new TavernHistoryArchiveError(
            'history-not-found',
            sessionId,
            error.message,
          )
        }
        throw error
      }
    })
  }

  /**
   * Restore one archived history session to its workspace projections.
   * @param sessionId - Session identifier to restore.
   * @returns Resolution after the archive set is durable.
   */
  @Remote('restoreHistory')
  async remoteRestoreHistory(sessionId: SessionId): Promise<void> {
    await this.enqueueMutation(async () => {
      const workspace = this.ctx.get('workspaceRegistry')
      if (workspace === undefined) {
        throw new TavernHistoryArchiveError(
          'history-archive-unavailable',
          sessionId,
          'Tavern history restore requires WorkspaceRegistry',
        )
      }
      await workspace.unarchiveSession(sessionId)
    })
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
    if ((target?.type === 'user/message' && target.data.source.kind !== 'user')
      || (target?.type !== 'user/message' && target?.type !== 'assistant/message')) {
      throw new Error(`Tavern message edit target ${input.targetSeq} is not a direct user message`)
    }
    const edit = target.type === 'user/message'
      ? agent.session.editMessage(input.targetSeq, {
        ...target.data,
        content: [{ type: 'text', text }],
      })
      : agent.session.editMessage(input.targetSeq, {
        ...target.data.message,
        content: [{ type: 'text', text }],
      })
    reconcileTavernMessageEdit(agent, edit)
    return { targetSeq: input.targetSeq }
  }

  /**
   * Delete a message through the current Session surface API and invalidate
   * facts derived from the deleted message and later assistant responses.
   *
   * Session currently exposes historical edits, but no physical delete
   * operation. An empty replacement is therefore the smallest replayable
   * adapter; the original message and its fact audit remain durable.
   * @param agent - Session owner receiving the deletion edit.
   * @param input - Message event sequence to hide.
   * @returns The deleted target sequence.
   */
  @Remote('deleteMessage')
  remoteDeleteMessage(agent: Agent, input: Pick<TavernMessageEditInput, 'targetSeq'>): TavernMessageEditResult {
    if (!Number.isSafeInteger(input.targetSeq) || input.targetSeq < 0) {
      throw new Error('Tavern message delete targetSeq must be a non-negative integer')
    }
    const target = agent.session.events[input.targetSeq]
    if (target?.type !== 'user/message' && target?.type !== 'assistant/message') {
      throw new Error(`Tavern message delete target ${input.targetSeq} is not a message`)
    }
    const edit = target.type === 'user/message'
      ? agent.session.editMessage(input.targetSeq, { ...target.data, content: [] })
      : agent.session.editMessage(input.targetSeq, { ...target.data.message, content: [] })
    reconcileTavernMessageEdit(agent, edit)
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
   * Preview the current canonical view, optionally replacing the fallback with
   * one model-cleaned view. The source asset is never changed by this Remote.
   * @param id - Asset identifier.
   * @returns The source asset and canonical cleaning record.
   */
  @Remote('previewAssetCleaning')
  async remotePreviewAssetCleaning(id: AssetId): Promise<TavernAssetCleaningPreview> {
    const asset = this.host.getAsset(id)
    if (asset === undefined) throw new AssetRegistryError('asset-not-found', `asset '${id}' was not found`)
    const existing = this.host.getCleaningRecord(id)
    const record = this.cleanerRoute === undefined && existing !== undefined
      ? existing
      : await resolveAssetCleaning(this.ctx, asset, this.cleanerRoute)
    return {
      asset: cloneAsset(asset),
      record,
      confirmed: record.status === 'confirmed',
    }
  }

  /**
   * Persist a caller-confirmed canonical view beside its original asset.
   * @param id - Asset identifier.
   * @param view - Canonical view edited or accepted by the caller.
   * @returns The confirmed preview.
   */
  @Remote('confirmAssetCleaning')
  async remoteConfirmAssetCleaning(id: AssetId, view: CanonicalAssetView): Promise<TavernAssetCleaningPreview> {
    return this.enqueueMutation(async () => {
      const asset = this.host.getAsset(id)
      if (asset === undefined) throw new AssetRegistryError('asset-not-found', `asset '${id}' was not found`)
      const record = this.host.confirmCleaning(id, view)
      await this.requireTable().put(id, recordOf(asset, undefined, record))
      return { asset: cloneAsset(asset), record, confirmed: true }
    })
  }

  /**
   * Inspect the canonical cleaning record without rerunning a model call.
   * @param id - Asset identifier.
   * @returns The current cleaning preview.
   */
  @Remote('inspectAssetCleaning')
  remoteInspectAssetCleaning(id: AssetId): TavernAssetCleaningPreview {
    const asset = this.host.getAsset(id)
    if (asset === undefined) throw new AssetRegistryError('asset-not-found', `asset '${id}' was not found`)
    const record = this.host.getCleaningRecord(id) ?? fallbackCleaningRecord(asset)
    return { asset: cloneAsset(asset), record, confirmed: record.status === 'confirmed' }
  }

  /**
   * Inspect the current Journey-local automatic fact projection and its audit records.
   * @param agent - Session owner whose fact log is inspected.
   * @returns Active facts and accepted or rejected operations in log order.
   */
  @Remote('inspectFacts')
  remoteInspectFacts(agent: Agent): TavernFactInspection {
    return {
      projection: resolveTavernFacts(agent.session),
      records: agent.session.events
        .filter((event): event is import('@deepseek-ai/dsh-session/types').SessionEvent<'tavern/fact'> => event.type === 'tavern/fact')
        .map(event => ({ seq: event.seq, data: structuredClone(event.data) })),
    }
  }

  /**
   * Rebuild plot checkpoints from the Journey's durable compaction records.
   * Ordinary transcript text is never inspected as a fallback. Missing or
   * incomplete summary/checkpoint pairs return an empty checkpoint list.
   * @param agent - Session owner whose compaction history is inspected.
   * @returns A detached list of safely reconstructed plot checkpoints.
   */
  @Remote('inspectMemory')
  remoteInspectMemory(agent: Agent): TavernMemoryInspection {
    return structuredClone(projectTavernMemory(agent.session))
  }

  /**
   * Append one user-owned dynamic ledger section operation.
   * @param agent - Session owner receiving the configuration event.
   * @param input - Section operation and its values.
   * @returns The replayed section configuration inspection.
   */
  @Remote('applySectionConfig')
  remoteApplySectionConfig(agent: Agent, input: TavernSectionConfigInput): TavernSectionConfigInspection {
    return appendTavernSectionConfig(agent.session, input)
  }

  /**
   * Inspect dynamic ledger configuration reconstructed from the Session log.
   * @param agent - Session owner whose configuration is inspected.
   * @returns The current configuration and its source events.
   */
  @Remote('inspectSectionConfig')
  remoteInspectSectionConfig(agent: Agent): TavernSectionConfigInspection {
    return inspectTavernSectionConfig(agent.session)
  }

  /**
   * Read only the active fact projection used by dynamic Journey columns.
   * @param agent - Session owner whose fact stream is projected.
   * @returns Active facts grouped by people and world scope.
   */
  @Remote('inspectFactProjection')
  remoteInspectFactProjection(agent: Agent): TavernFactProjection {
    return structuredClone(resolveTavernFacts(agent.session))
  }

  /**
   * Inspect the latest compiled Tavern context, including every ledger
   * inclusion and exclusion decision.
   * @param agent - Session owner whose context is inspected.
   * @returns The last durable compilation, a current compilation, or null before selection.
   */
  @Remote('inspectContextActivation')
  remoteInspectContextActivation(agent: Agent): CompiledContext<PromptWorldInfoEntry> | null {
    const activation = resolveTavernContextActivation(agent.session)
    if (activation !== undefined) return structuredClone(activation.compiled)
    const selection = restoreTavernSelection(this.host, resolveTavernSelection(agent.session), agent.session)
    if (selection === undefined) return null
    return structuredClone(compileTavernContext(agent.session, selection.baseline, '', selection.playerIdentity))
  }

  /**
   * Inspect parsed GM response envelopes retained for one Journey.
   * @param agent - Session owner whose parsed model responses are inspected.
   * @returns Parsed responses with the assistant and durable event sequences.
   */
  @Remote('inspectGmResponses')
  remoteInspectGmResponses(agent: Agent): readonly TavernGmResponseInspection[] {
    return agent.session.events
      .filter((event): event is SessionEvent<'tavern/gm-response'> => event.type === 'tavern/gm-response')
      .map(event => ({ eventSeq: event.seq, ...structuredClone(event.data) }))
  }

  /**
   * Read the current Journey detail projection with local facts overlaid.
   * @param agent - Session owner whose resolved Journey asset projection is read.
   * @returns The latest Journey asset/person/field projection, or null before selection.
   */
  @Remote('inspectJourneyAssets')
  remoteInspectJourneyAssets(agent: Agent): TavernJourneyAssetProjection | null {
    const selected = restoreTavernSelection(this.host, resolveTavernSelection(agent.session), agent.session)
    const projection = selected === undefined
      ? undefined
      : projectTavernJourneyAssets(selected, resolveTavernFacts(agent.session))
    if (projection === undefined) return null
    const openingGreeting = resolveTavernGreeting(agent.session)
    return structuredClone(openingGreeting === undefined ? projection : { ...projection, openingGreeting })
  }

  /**
   * Read current facts for one explicitly identified Journey person.
   * @param agent - Session owner whose fact projection is queried.
   * @param personId - Stable Journey person identifier.
   * @returns Active person facts.
   */
  @Remote('listPersonFacts')
  remoteListPersonFacts(agent: Agent, personId: string): readonly import('./types.ts').TavernFactEntry[] {
    return queryTavernPersonFacts(agent.session, personId)
  }

  /**
   * Read current world facts for a Journey.
   * @param agent - Session owner whose fact projection is queried.
   * @returns Active world facts.
   */
  @Remote('listWorldFacts')
  remoteListWorldFacts(agent: Agent): readonly import('./types.ts').TavernFactEntry[] {
    return queryTavernWorldFacts(agent.session)
  }

  /**
   * Correct an existing automatic fact through an append-only replacement event.
   * @param agent - Session owner receiving the correction.
   * @param input - Existing fact ID and replacement text.
   * @returns The updated fact projection.
   */
  @Remote('editFact')
  remoteEditFact(agent: Agent, input: TavernFactEditInput): TavernFactInspection {
    appendUserFactEdit(agent.session, input)
    return this.remoteInspectFacts(agent)
  }

  /**
   * Revoke an existing automatic fact without removing its source event.
   * @param agent - Session owner receiving the revocation.
   * @param input - Existing fact ID.
   * @returns The updated fact projection.
   */
  @Remote('removeFact')
  remoteRemoveFact(agent: Agent, input: TavernFactRemovalInput): TavernFactInspection {
    appendUserFactRemoval(agent.session, input.factId)
    return this.remoteInspectFacts(agent)
  }

  /**
   * Resolve one hard-fact conflict by appending a user-authorized remove event
   * for the rejected side. The conflict and rejected source remain auditable.
   * @param agent - Session owner receiving the decision.
   * @param input - Conflict fact identifier and whether the incoming or prior value wins.
   * @returns The fact inspection after the decision.
   */
  @Remote('resolveConflict')
  remoteResolveConflict(
    agent: Agent,
    input: { readonly factId: string; readonly keep: 'new' | 'old' },
  ): TavernFactInspection {
    const projection = resolveTavernFacts(agent.session)
    const conflict = (projection.conflicts ?? []).find(value =>
      String(value.factId) === input.factId || String(value.previousFactId) === input.factId)
    if (conflict === undefined) throw new Error(`Tavern fact conflict for '${input.factId}' was not found`)
    const keepId = input.keep === 'new' ? String(conflict.factId) : String(conflict.previousFactId)
    const removeId = keepId === String(conflict.factId) ? String(conflict.previousFactId) : String(conflict.factId)
    const losing = findActiveFact(projection, removeId)
    if (losing === undefined) throw new Error(`Tavern conflict fact '${removeId}' is not active`)
    agent.session.append('tavern/fact', {
      branch: String(agent.session.id),
      target: losing.target,
      ...(losing.personId === undefined ? {} : { personId: losing.personId }),
      operation: 'remove',
      factId: losing.factId,
      authority: 'user',
      kind: losing.kind ?? 'soft',
      ...(losing.subjectKey === undefined ? {} : { subjectKey: losing.subjectKey }),
      explicit: true,
      ...(losing.sourceAssetId === undefined ? {} : { sourceAssetId: losing.sourceAssetId }),
      ...(losing.sourceEntryId === undefined ? {} : { sourceEntryId: losing.sourceEntryId }),
      ...(losing.assistantSeq === undefined ? {} : { assistantSeq: losing.assistantSeq }),
      ...(losing.turn === undefined ? {} : { turn: losing.turn }),
      resolvesConflictIds: [conflict.id],
      accepted: true,
    })
    return this.remoteInspectFacts(agent)
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
      if (record.cleaning !== undefined) this.host.setCleaningRecord(record.id, record.cleaning)
      return
    }
    this.host.importWorldInfo(asCompatJson(record.input), { id: record.id, source: record.source })
    if (record.cleaning !== undefined) this.host.setCleaningRecord(record.id, record.cleaning)
  }

  private restoreHostAsset(asset: TavernAsset, cleaning: TavernAssetCleaningRecord | undefined): void {
    this.host.registry.replace(asset)
    if (cleaning === undefined) this.host.setCleaningRecord(asset.id, fallbackCleaningRecord(asset))
    else this.host.setCleaningRecord(asset.id, cleaning)
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

function assertHistoryReadable(ctx: Context, sessionId: SessionId): void {
  const workspace = ctx.get('workspaceRegistry')
  if (workspace?.archivedSessionIds.includes(sessionId) === true) {
    throw new TavernHistoryArchiveError(
      'history-already-archived',
      sessionId,
      `Tavern history session '${sessionId}' is archived`,
    )
  }
}

function selectionData(inspection: TavernSelectionInspection, playerIdentity: string | null = null): TavernSessionSelection {
  return {
    selection: inspection.selection,
    baseline: inspection.baseline,
    character: inspection.character,
    worldInfo: inspection.worldInfo,
    characterName: inspection.character?.name ?? null,
    worldInfoNames: inspection.worldInfo.map(asset => asset.name),
    playerIdentity,
  }
}

function normalizePlayerIdentity(playerIdentity: string | null): string | null {
  const normalized = playerIdentity?.trim() ?? ''
  return normalized.length === 0 ? null : normalized
}

function sameSelection(left: AssetSelection, right: AssetSelection): boolean {
  return left.characterId === right.characterId
    && left.worldInfoIds.length === right.worldInfoIds.length
    && left.worldInfoIds.every((id, index) => id === right.worldInfoIds[index])
}

function latestTavernSelectionEventSeq(session: Pick<Session, 'events'>): number {
  let latest = -1
  for (const event of session.events) {
    if (event.type === 'tavern/assets-selected' || event.type === 'tavern/assets-edited') {
      latest = Math.max(latest, event.seq)
    }
  }
  return latest
}

function hasNormalizationAfter(session: Pick<Session, 'events'>, selectionSeq: number): boolean {
  return session.events.some(event => event.type === 'tavern/assets-normalized' && event.seq > selectionSeq)
}

function requireJourneySelection(session: Pick<Session, 'events'>, host: TavernAssetHost): TavernSessionSelection {
  const selected = resolveTavernSelection(session)
  if (selected === undefined) throw new Error('Tavern Journey has no selected assets')
  const restored = restoreTavernSelection(host, selected, session)
  if (restored === undefined) throw new Error('Tavern Journey has no selected assets')
  return restored
}

/**
 * Resolve a minimal selection event into the current detached source assets.
 * Legacy events may still carry a complete snapshot; it is used only to serve
 * old cold-session responses and is never used by the fact projector.
 * @param host - Registry facade used for legacy display recovery.
 * @param selected - Selection event or detached selection replayed from a log.
 * @returns A wire-complete detached selection, or undefined when absent.
 */
function restoreTavernSelection(
  host: TavernAssetHost,
  selected: TavernSelectionEvent | TavernSessionSelection | undefined,
  session?: Pick<Session, 'events'>,
  includeCanonical = false,
): TavernSessionSelection | undefined {
  if (selected === undefined) return undefined
  let restored: TavernSessionSelection
  if (hasLegacySelectionSnapshot(selected)) {
    restored = structuredClone(selected)
  } else {
    const inspected = host.inspectSelection(selected.selection)
    restored = selectionData(inspected, selected.playerIdentity ?? null)
  }
  const withFacts = session === undefined ? restored : applyFactSelectionOverrides(restored, session)
  if (!includeCanonical) return withFacts
  const character = withFacts.character === null ? undefined : host.getCanonicalView(withFacts.character.id)
  const worldInfo = withFacts.worldInfo
    .map(asset => host.getCanonicalView(asset.id))
    .filter((view): view is CanonicalAssetView => view !== undefined)
  if (character === undefined && worldInfo.length === 0) return withFacts
  return {
    ...withFacts,
    canonical: {
      ...(character === undefined ? {} : { character }),
      worldInfo,
    },
  }
}

function hasLegacySelectionSnapshot(
  selected: TavernSelectionEvent | TavernSessionSelection,
): selected is TavernSessionSelection {
  return selected.baseline !== undefined
    && selected.character !== undefined
    && selected.worldInfo !== undefined
    && selected.characterName !== undefined
    && selected.worldInfoNames !== undefined
}

function appendJourneyAssetEdit(
  session: Session,
  selected: TavernSessionSelection,
  character: CharacterAsset | null,
  worldInfo: readonly WorldInfoAsset[],
  editedKind: TavernAssetsEditedEvent['editedKind'],
  editedAssetId: import('@deepseek-ai/dsh-tavern-assets/types').AssetId,
): TavernSessionSelection {
  const selection = structuredClone(selected.selection)
  const baseline = projectPromptAssetBaseline(selection, character, worldInfo)
  appendJourneyEditFacts(session, selected, character, worldInfo)
  const data: TavernAssetsEditedEvent = {
    selection,
    ...(selected.playerIdentity === undefined ? {} : { playerIdentity: selected.playerIdentity }),
    editedKind,
    editedAssetId,
  }
  session.append('tavern/assets-edited', data)
  return {
    selection,
    baseline,
    character: character === null ? null : cloneAsset(character),
    worldInfo: worldInfo.map(cloneAsset),
    characterName: character?.name ?? null,
    worldInfoNames: worldInfo.map(asset => asset.name),
    ...(selected.playerIdentity === undefined ? {} : { playerIdentity: selected.playerIdentity }),
  }
}

function applyFactSelectionOverrides(
  selected: TavernSessionSelection,
  session: Pick<Session, 'events'>,
): TavernSessionSelection {
  if (selected.character === null) return selected
  const personId = `person:${slug(selected.character.name, 'person')}`
  const facts = resolveTavernFacts(session).people[personId] ?? []
  const name = [...facts].reverse()
    .map(fact => fact.label?.trim().toLocaleLowerCase() === 'name'
      ? fact.text.trim()
      : /^\s*Name\s*:\s*(.+?)\s*$/im.exec(fact.text)?.[1]?.trim())
    .find(value => value !== undefined && value.length > 0)
  if (name === undefined || name === selected.character.name) return selected
  return {
    ...selected,
    character: { ...structuredClone(selected.character), name },
    characterName: name,
  }
}

function appendJourneyEditFacts(
  session: Session,
  selected: TavernSessionSelection,
  character: CharacterAsset | null,
  worldInfo: readonly WorldInfoAsset[],
): void {
  if (selected.character !== null && character !== null) {
    const personId = `person:${slug(selected.character.name, 'person')}`
    const fields: readonly [string, string, string][] = [
      ['Name', selected.character.name, character.name],
      ['Description', selected.character.description, character.description],
      ['Personality', selected.character.personality, character.personality],
      ['Scenario', selected.character.scenario, character.scenario],
      ['Creator notes', selected.character.creatorNotes, character.creatorNotes],
      ['System prompt', selected.character.systemPrompt, character.systemPrompt],
      ['Post-history instructions', selected.character.postHistoryInstructions, character.postHistoryInstructions],
    ]
    for (const [label, previous, next] of fields) {
      if (previous === next || next.trim().length === 0) continue
      appendJourneyEditFact(session, {
        target: 'person',
        personId,
        label,
        text: next,
        sourceAssetId: String(character.id),
      })
    }
  }
  const previousWorld = new Map(selected.worldInfo.map(asset => [String(asset.id), asset]))
  for (const world of worldInfo) {
    const previous = previousWorld.get(String(world.id))
    if (previous === undefined) continue
    for (const entry of world.entries) {
      const oldEntry = previous.entries.find(candidate => candidate.id === entry.id)
      if (oldEntry?.content === entry.content) continue
      const labeled = parseLabeledLines(entry.content)
      const characterEntry = collectCharacterEntries([entry])[0]
      const personId = characterEntry === undefined ? undefined : `person:${slug(characterEntry.name, 'person')}`
      if (labeled.length === 0) {
        appendJourneyEditFact(session, {
          target: personId === undefined ? 'world' : 'person',
          ...(personId === undefined ? {} : { personId }),
          label: 'Content',
          text: entry.content,
          sourceAssetId: String(world.id),
          sourceEntryId: String(entry.id),
        })
      } else {
        for (const field of labeled) {
          appendJourneyEditFact(session, {
            target: personId === undefined ? 'world' : 'person',
            ...(personId === undefined ? {} : { personId }),
            label: field.label,
            text: field.value,
            sourceAssetId: String(world.id),
            sourceEntryId: String(entry.id),
          })
        }
      }
    }
  }
}

function appendJourneyEditFact(
  session: Session,
  input: {
    readonly target: 'person' | 'world'
    readonly personId?: string
    readonly label: string
    readonly text: string
    readonly sourceAssetId: string
    readonly sourceEntryId?: string
  },
): void {
  session.append('tavern/fact', {
    branch: String(session.id),
    target: input.target,
    ...(input.personId === undefined ? {} : { personId: input.personId }),
    operation: 'add',
    factId: `fact:journey-edit:${slug(input.sourceAssetId)}:${slug(input.label)}:${session.events.length + 1}`,
    label: input.label,
    text: input.text,
    authority: 'user',
    kind: 'soft',
    explicit: true,
    sourceAssetId: input.sourceAssetId,
    ...(input.sourceEntryId === undefined ? {} : { sourceEntryId: input.sourceEntryId }),
    accepted: true,
  })
}

function appendUserFactEdit(session: Session, input: TavernFactEditInput): void {
  const current = findActiveFact(resolveTavernFacts(session), input.factId)
  if (current === undefined) throw new Error(`Tavern fact '${input.factId}' was not found`)
  const text = input.text.trim()
  if (text.length === 0) throw new Error('Tavern fact text must not be empty')
  appendUserFactEvent(session, current, 'replace', text)
}

function appendUserFactRemoval(session: Session, factId: string): void {
  const current = findActiveFact(resolveTavernFacts(session), factId)
  if (current === undefined) throw new Error(`Tavern fact '${factId}' was not found`)
  appendUserFactEvent(session, current, 'remove')
}

function appendUserFactEvent(
  session: Session,
  current: TavernFactEntry,
  operation: 'replace' | 'remove',
  text?: string,
): void {
  const event: TavernFactEvent = {
    branch: String(session.id),
    target: current.target,
    ...(current.personId === undefined ? {} : { personId: current.personId }),
    operation,
    factId: current.factId,
    ...(text === undefined ? {} : { text }),
    ...(current.label === undefined ? {} : { label: current.label }),
    authority: 'user',
    kind: current.kind ?? 'soft',
    ...(current.subjectKey === undefined ? {} : { subjectKey: current.subjectKey }),
    explicit: true,
    ...(current.sourceAssetId === undefined ? {} : { sourceAssetId: current.sourceAssetId }),
    ...(current.sourceEntryId === undefined ? {} : { sourceEntryId: current.sourceEntryId }),
    ...(current.assistantSeq === undefined ? {} : { assistantSeq: current.assistantSeq }),
    ...(current.turn === undefined ? {} : { turn: current.turn }),
    ...(current.conflicts === undefined || current.conflicts.length === 0
      ? {}
      : { resolvesConflictIds: current.conflicts.map(conflict => conflict.id) }),
    accepted: true,
  }
  session.append('tavern/fact', event)
}

function findActiveFact(projection: TavernFactProjection, factId: string): TavernFactEntry | undefined {
  for (const facts of Object.values(projection.people)) {
    const found = facts.find(fact => String(fact.factId) === factId)
    if (found !== undefined) return found
  }
  return projection.world.find(fact => String(fact.factId) === factId)
}

function sourceReference(source: TavernImportSource | undefined, kind: string): AssetSourceReference {
  return {
    kind: source?.kind ?? kind,
    locator: source?.locator ?? 'host://inline',
    mediaType: source?.mediaType ?? 'application/json',
    digest: source?.digest ?? null,
  }
}

/** Build one detached Character Card asset from a parsed compatibility value. */
function createCharacterAsset(
  card: NormalizedCharacterCard,
  id: import('@deepseek-ai/dsh-tavern-assets/types').AssetId,
  source: AssetSourceReference,
): CharacterAsset {
  return {
    kind: 'character',
    id,
    name: card.name,
    version: { format: card.spec ?? 'character-card', revision: 1 },
    sourceReferences: [source],
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
    characterBook: card.characterBook === null
      ? null
      : normalizedWorldInfoAsset(
        card.characterBook,
        createAssetId(`${id}.character-book`),
        `${card.name} Character Book`,
        { kind: 'character-book', locator: `${id}/character_book`, mediaType: 'application/json', digest: null },
      ),
    extensions: card.extensions,
  }
}

/** Convert parsed World Info into an asset owned by a library or Character Card. */
function normalizedWorldInfoAsset(
  world: NormalizedWorldInfo,
  id: import('@deepseek-ai/dsh-tavern-assets/types').AssetId,
  name: string,
  source: AssetSourceReference,
): WorldInfoAsset {
  return {
    kind: 'world-info',
    id,
    name,
    version: { format: world.sourceKind === 'character-book' ? 'character-book' : 'world-info-v2', revision: 1 },
    sourceReferences: [source],
    sourceData: world.raw,
    scanDepth: world.scanDepth,
    tokenBudget: world.tokenBudget,
    recursiveScanning: world.recursiveScanning ?? false,
    entries: world.entries.map((entry, index) => ({
      id: createAssetId(`${id}.entry-${entry.id || index + 1}`),
      keys: entry.keys,
      secondaryKeys: entry.secondaryKeys,
      selective: entry.selective,
      constant: entry.constant,
      useRegex: entry.useRegex,
      matchWholeWords: entry.matchWholeWords,
      caseSensitive: entry.caseSensitive,
      useProbability: entry.useProbability,
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
  }
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

function latestSessionText(events: readonly SessionEvent[]): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined) continue
    const value = event.type === 'assistant/message' || event.type === 'tool/result'
      ? messageText(event.data.message)
      : event.type === 'user/message' && event.data.source.kind === 'user'
        ? messageText(event.data)
        : null
    if (value !== null && value.trim().length > 0) return value.trim()
  }
  return null
}

function messageText(value: unknown): string | null {
  if (!isRecord(value) || !Array.isArray(value['content'])) return null
  const text = value['content']
    .filter(isRecord)
    .filter(block => block['type'] === 'text' && typeof block['text'] === 'string')
    .map(block => String(block['text']))
    .join('')
  return text.length === 0 ? null : text
}

/** Wait for the session event write-behind queue before completing a Journey Remote. */
async function flushTavernSession(agent: Agent): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('Tavern session persistence barrier timed out'))
    }, TAVERN_PERSISTENCE_BARRIER_TIMEOUT_MS)
  })
  try {
    await Promise.race([agent.ctx.sessions.flush(agent.session), deadline])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function recordOf(
  asset: TavernAsset,
  source: TavernImportSource | undefined,
  cleaning?: TavernAssetCleaningRecord,
): TavernAssetRecord {
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
    ...(cleaning === undefined ? {} : { cleaning: structuredClone(cleaning) }),
  }
}

function fallbackCleaningRecord(asset: TavernAsset): TavernAssetCleaningRecord {
  return {
    status: 'fallback',
    origin: 'heuristic',
    view: cleanTavernAsset(asset),
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
  appendTavernSwipeCandidate(session, groupId, candidate)
}
