/** Tavern Journey memory extraction, projection, retrieval, and injection. */

export { MemoryExtractionId, MemoryExtractionSpanId } from './brand.ts'

export { buildMemoryCheckpoint, parseMemorySummaryOutput, selectMemoryCompactionRange } from './compaction.ts'
export type { MemoryCompactionRange, MemorySummaryCleanup, MemorySummaryOutput, MemorySummaryParseResult, MemorySummaryResult, TavernMemoryCompactionProvider } from './compaction.ts'
export { cleanTavernAsset } from './clean.ts'
export type { CanonicalAssetView, CanonicalCharacterField, CanonicalWorldEntry } from './clean.ts'
export { DEFAULT_MEMORY_CONFIG, MemoryConfigError, resolveMemoryConfig } from './config.ts'
export type { MemoryConfigInput } from './config.ts'
export {
  createDeterministicEmbeddingProvider,
  DEFAULT_EMBEDDING_PROVIDER,
  DETERMINISTIC_EMBEDDING_DIMENSIONS,
  DETERMINISTIC_EMBEDDING_MODEL,
  DETERMINISTIC_EMBEDDING_VERSION,
  DeterministicEmbeddingProvider,
  embedMemoryText,
} from './embedding.ts'
export type { DeterministicEmbeddingOptions } from './embedding.ts'
export { createMemoryExtractionId, ingestMemoryBatch, ingestMemoryExtraction, memoryExtractionIdempotencyKey, MemoryExtractionIngestor, MemoryExtractionScheduler, validateMemoryExtractionBatch } from './extractor.ts'
export { compareFactFreshness, flattenMemoryProjection, isMemoryFactVisible, projectMemoryFacts } from './fold.ts'
export type { MemoryFactFreshnessCandidate, MemoryFactFreshnessDecision } from './fold.ts'
export {
  combineMemoryHybridScore,
  cosineSimilarity,
  lexicalScore,
  MemoryIndex,
  MemoryIndex as BruteForceMemoryIndex,
  rankMemoryIndexHits,
  scoreMemoryIndexRow,
} from './retrieval-index.ts'
export type { MemoryHybridScore } from './retrieval-index.ts'
export { appendMemoryInjectionSnapshot, renderMemoryContext, renderMemoryInjection, stableFingerprint } from './inject.ts'
export {
  buildMemoryExtractionPrompt,
  buildMemorySummaryPrompt,
  MEMORY_EXTRACTION_RULES,
  MEMORY_EXTRACTION_SCHEMA,
  parseExtractionOutput,
  parseMemoryExtractionOutput,
  parseMemoryExtractionOutputStrict,
  parsedSubjectKey,
  renderMemoryExtractionPrompt,
} from './prompt.ts'
export {
  deriveSubjectKeyCatalog,
  deriveSubjectKeys,
  isSubjectKey,
  normalizeSubjectKey,
  resolveSubjectKey,
  splitCompositeFact,
  subjectDimension,
  subjectKeyAlias,
} from './keys.ts'
export type * from './types.ts'
