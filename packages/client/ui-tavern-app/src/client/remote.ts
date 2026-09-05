/** Typed Host Remote face used by the Tavern-owned browser root. */

import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  AssetId, AssetSelection, CanonicalAssetView, CharacterAsset, TavernAssetCleaningPreview,
  TavernFactEditInput, TavernFactInspection, TavernFactRemovalInput, TavernHistoryEntry,
  TavernJourneyAssetProjection, TavernMemoryInspection, TavernSessionSelection, TavernStoryStateInspection,
  TavernSwipeInspection, TavernSwipeSelectionInput, TavernBootstrapJourneyResult,
  TavernImportOptions, WorldInfoAsset, StoryStateChange,
} from '@deepseek-ai/dsh-tavern-host/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

/** Host commands and projections consumed by the Tavern application. */
export interface TavernAssetsRemote {
  /** List reusable Character Cards for the library. */
  listCharacters(): Promise<RemoteResult<readonly CharacterAsset[]>>
  /** Delete one unreferenced source asset from the library. */
  deleteAsset(id: AssetId): Promise<RemoteResult<boolean>>
  /** Import one Character Card JSON document. */
  importCharacter(input: string, options?: TavernImportOptions): Promise<RemoteResult<CharacterAsset>>
  /** Preview the canonical cleaning candidate without changing the source asset. */
  previewAssetCleaning?(id: AssetId): Promise<RemoteResult<TavernAssetCleaningPreview>>
  /** Persist a user-confirmed canonical cleaning view beside the source asset. */
  confirmAssetCleaning?(id: AssetId, view: CanonicalAssetView): Promise<RemoteResult<TavernAssetCleaningPreview>>
  /** Inspect the last canonical cleaning record without rerunning a model call. */
  inspectAssetCleaning?(id: AssetId): Promise<RemoteResult<TavernAssetCleaningPreview>>
  /** List reusable World Books for the library. */
  listWorldInfo(): Promise<RemoteResult<readonly WorldInfoAsset[]>>
  /** Import one World Book JSON document. */
  importWorldInfo(input: string, options?: TavernImportOptions): Promise<RemoteResult<WorldInfoAsset>>
  /** Inspect the selected Character Card and World Books. */
  inspectSelection(selection: AssetSelection): Promise<RemoteResult<{
    readonly selection: AssetSelection
    readonly character: CharacterAsset | null
    readonly worldInfo: readonly WorldInfoAsset[]
  }>>
  /** Create the durable selection and opening greeting for a Journey. */
  bootstrapJourney(
    sessionId: SessionId,
    selection: AssetSelection,
    playerIdentity?: string | null,
  ): Promise<RemoteResult<TavernBootstrapJourneyResult>>
  /** Inspect one warm or cold Journey selection. */
  inspectSession(sessionId: SessionId): Promise<RemoteResult<TavernSessionSelection | null>>
  /** Inspect the Journey asset and fact projection. */
  inspectJourneyAssets(sessionId: SessionId): Promise<RemoteResult<TavernJourneyAssetProjection | null>>
  /** Inspect automatic facts for the context drawer. */
  inspectFacts(sessionId: SessionId): Promise<RemoteResult<TavernFactInspection>>
  /** Inspect durable plot checkpoints when the Host exposes the memory Remote. */
  inspectMemory?(sessionId: SessionId): Promise<RemoteResult<TavernMemoryInspection>>
  /** Append a user-confirmed replacement for one Journey fact. */
  editFact?(sessionId: SessionId, input: TavernFactEditInput): Promise<RemoteResult<TavernFactInspection>>
  /** Append a user-confirmed revocation for one Journey fact. */
  removeFact?(sessionId: SessionId, input: TavernFactRemovalInput): Promise<RemoteResult<TavernFactInspection>>
  /** Resolve one fact conflict after an explicit user decision. */
  resolveConflict?(sessionId: SessionId, input: { readonly factId: string; readonly keep: 'new' | 'old' }): Promise<RemoteResult<TavernFactInspection>>
  /** Replace the selected Character Card for this Journey. */
  editJourneyCharacter?(sessionId: SessionId, input: string): Promise<RemoteResult<TavernSessionSelection>>
  /** Replace one selected World Book for this Journey. */
  editJourneyWorldInfo?(sessionId: SessionId, assetId: AssetId, input: string): Promise<RemoteResult<TavernSessionSelection>>
  /** Inspect the durable history state for the History page. */
  inspectHistory(sessionId: SessionId): Promise<RemoteResult<TavernHistoryEntry>>
  /** Inspect one archived Journey retained by the History page. */
  inspectArchivedHistory(sessionId: SessionId): Promise<RemoteResult<TavernHistoryEntry>>
  /** Archive one completed or active Journey without deleting its log. */
  archiveHistory(sessionId: SessionId): Promise<RemoteResult<void>>
  /** Restore one archived Journey to its original workspace position. */
  restoreHistory(sessionId: SessionId): Promise<RemoteResult<void>>
  /** Inspect and update the durable Story State drawer. */
  inspectStoryState(sessionId: SessionId): Promise<RemoteResult<TavernStoryStateInspection>>
  setStoryState(sessionId: SessionId, change: StoryStateChange): Promise<RemoteResult<TavernStoryStateInspection>>
  /** Inspect and select retained Swipe candidates. */
  inspectSwipe(sessionId: SessionId): Promise<RemoteResult<TavernSwipeInspection>>
  selectSwipe(sessionId: SessionId, input: TavernSwipeSelectionInput): Promise<RemoteResult<TavernSwipeInspection>>
}
