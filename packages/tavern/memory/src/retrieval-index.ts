/** Derived per-session retrieval index for Tavern Journey facts. */

import type {
  MemoryFactRecord,
  MemoryIndexHit,
  MemoryIndexQuery,
  MemoryIndexRow,
  MemoryIndexProvider,
  MemoryProjectionOptions,
} from './types.ts'
import { flattenMemoryProjection, projectMemoryFacts } from './fold.ts'
import { createSubjectKeyAliasResolver, resolveSubjectKeyAlias } from './keys.ts'

/**
 * In-memory index seam used by the v1 brute-force retriever. It can be
 * reconstructed from the session log at any time and never owns fact text.
 */
export class MemoryIndex implements MemoryIndexProvider {
  private readonly rows = new Map<string, MemoryIndexRow>()

  /**
   * @param defaultLimit - Configured result limit for queries without one.
   */
  constructor(private readonly defaultLimit = 8) {
    if (!Number.isSafeInteger(defaultLimit) || defaultLimit < 1) throw new RangeError('defaultLimit must be positive')
  }

  /**
   * Replace this derived index with rows replayed from one fact log.
   * @param sessionId - Session namespace for the derived rows.
   * @param records - Authoritative fact records.
   * @param options - Projection visibility options.
   * @returns Nothing; the index is rebuilt in place.
   */
  rebuild(sessionId: string, records: readonly MemoryFactRecord[], options: MemoryProjectionOptions = {}): void {
    const projection = projectMemoryFacts(records, options)
    const projectedFacts = flattenMemoryProjection(projection)
    const active = new Set(projectedFacts.map(fact => `${String(fact.factId)}\u0000${fact.eventSeq}`))
    const projectedByRecord = new Map(projectedFacts.map(fact => [`${String(fact.factId)}\u0000${fact.eventSeq}`, fact]))
    const resolveSubjectKey = createSubjectKeyAliasResolver(options.subjectKeyAliases ?? [])
    for (const key of [...this.rows.keys()]) {
      if (this.rows.get(key)?.sessionId === sessionId) this.rows.delete(key)
    }
    for (const record of records) {
      const data = record.data
      if (!data.accepted || data.factId === undefined || data.text === undefined) continue
      const fact = projectedByRecord.get(`${String(data.factId)}\u0000${record.seq}`)
      const subjectKey = fact?.subjectKey ?? resolveSubjectKey(data.subjectKey)
      this.upsert({
        sessionId,
        seq: record.seq,
        kind: 'fact',
        originId: String(data.factId),
        ...(subjectKey === undefined ? {} : { subjectKey }),
        ...(data.personId === undefined ? {} : { personId: data.personId }),
        content: data.text,
        active: active.has(`${String(data.factId)}\u0000${record.seq}`),
      })
    }
  }

  /**
   * Insert or replace one derived row after the authoritative log advances.
   * @param row - Derived row to store.
   * @returns Nothing; the row is stored in place.
   */
  upsert(row: MemoryIndexRow): void {
    validateRow(row)
    this.rows.set(rowKey(row), structuredClone(row))
  }

  /**
   * Insert a batch of derived rows in input order.
   * @param rows - Derived rows to store.
   * @returns Nothing; rows are stored in place.
   */
  upsertMany(rows: readonly MemoryIndexRow[]): void {
    for (const row of rows) this.upsert(row)
  }

  /**
   * Mark one derived row inactive without removing its audit identity.
   * @param sessionId - Session namespace of the row.
   * @param seq - Source event sequence.
   * @param kind - Derived row kind.
   * @param originId - Source identity of the row.
   * @returns Nothing; an existing row is tombstoned in place.
   */
  tombstone(sessionId: string, seq: number, kind: MemoryIndexRow['kind'], originId: string): void {
    const key = rowKey({ sessionId, seq, kind, originId })
    const current = this.rows.get(key)
    if (current !== undefined) this.rows.set(key, { ...current, active: false })
  }

  /**
   * Query active rows with exact key/person filters and optional cosine score.
   * @param input - Session, filter, and ranking request.
   * @returns Ranked active index hits.
   */
  query(input: MemoryIndexQuery): readonly MemoryIndexHit[] {
    const limit = input.limit ?? this.defaultLimit
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('query limit must be positive')
    if (input.sessionId.trim().length === 0) throw new TypeError('query sessionId must not be empty')
    validateEmbedding(input.embedding, 'query embedding')
    const queryText = normalizeSearchText(input.text)
    const subjectKey = input.subjectKey === undefined
      ? undefined
      : resolveSubjectKeyAlias(input.subjectKey, input.subjectKeyAliases)
    if (input.subjectKey !== undefined && subjectKey === undefined) return []
    const hits: MemoryIndexHit[] = []
    for (const row of this.rows.values()) {
      if (!row.active || row.sessionId !== input.sessionId) continue
      if (subjectKey !== undefined && row.subjectKey !== subjectKey) continue
      if (input.personId !== undefined && row.personId !== input.personId) continue
      const scored = scoreMemoryIndexRow(
        queryText,
        input.embedding,
        row,
        input.embeddingModel ?? input.model,
        input.embeddingVersion ?? input.version,
      )
      if (!matchesHybridQuery(queryText, input.embedding, scored)) continue
      hits.push({
        row: structuredClone(row),
        score: scored.score,
        lexicalScore: scored.lexical,
        cosineScore: scored.cosine,
      })
    }
    return rankMemoryIndexHits(hits, limit)
  }

  /**
   * Alias for callers that use search terminology.
   * @param input - Session, filter, and ranking request.
   * @returns Ranked active index hits.
   */
  search(input: MemoryIndexQuery): readonly MemoryIndexHit[] {
    return this.query(input)
  }

  /**
   * Return detached rows for diagnostics and invariant checks.
   * @param sessionId - Optional session filter.
   * @returns Detached derived rows.
   */
  list(sessionId?: string): readonly MemoryIndexRow[] {
    return [...this.rows.values()]
      .filter(row => sessionId === undefined || row.sessionId === sessionId)
      .map(row => structuredClone(row))
  }

  /**
   * Release resources held by the in-memory provider.
   *
   * The in-memory implementation owns no external handle, so this is a
   * no-op. It keeps the provider seam lifecycle-compatible with SQLite.
   * @returns Nothing.
   */
  close(): void {
    // There is no resource to release for the process-local provider.
  }
}

function rowKey(row: Pick<MemoryIndexRow, 'sessionId' | 'seq' | 'kind' | 'originId'>): string {
  return `${row.sessionId}\u0000${row.seq}\u0000${row.kind}\u0000${row.originId}`
}

function validateRow(row: MemoryIndexRow): void {
  if (row.sessionId.trim().length === 0 || row.originId.trim().length === 0 || row.content.trim().length === 0) {
    throw new TypeError('memory index rows require sessionId, originId, and content')
  }
  if (!Number.isSafeInteger(row.seq) || row.seq < 0) throw new RangeError('memory index seq must be non-negative')
  if (row.embedding !== undefined && row.embedding.some(value => !Number.isFinite(value))) throw new TypeError('memory index embeddings must be finite')
}

/**
 * Compute the lexical component used by the hybrid retriever.
 *
 * An exact normalized phrase scores one. Otherwise the score is the fraction
 * of whitespace-delimited query terms found in the normalized content. This
 * deliberately remains a small deterministic fallback for short Journey
 * indexes; it does not claim tokenizer or language-model semantics.
 * @param query - Non-empty normalized query text.
 * @param content - Indexed content.
 * @returns A score in the range [0, 1].
 */
export function lexicalScore(query: string, content: string): number {
  const normalized = normalizeSearchText(content) ?? ''
  if (normalized.includes(query)) return 1
  const terms = query.split(/\s+/u).filter(Boolean)
  if (terms.length === 0) return 0
  return terms.filter(term => normalized.includes(term)).length / terms.length
}

/** One row's independent lexical and vector retrieval components. */
export interface MemoryHybridScore {
  /** Lexical phrase/term score in the range [0, 1]. */
  readonly lexical: number
  /** Cosine score, or zero when no compatible vector is available. */
  readonly cosine: number
  /** Union score used for ranking: the stronger component wins. */
  readonly score: number
}

/**
 * Combine lexical and cosine components for one hybrid retrieval score.
 *
 * The stronger positive component wins: lexical matches form a guaranteed
 * retrieval path, while a compatible vector can contribute a semantic hit
 * even when its wording does not overlap. Negative cosine similarity cannot
 * turn a candidate into a hit.
 * @param lexical - Lexical score in the range [0, 1].
 * @param cosine - Cosine similarity in the range [-1, 1].
 * @returns The deterministic hybrid score.
 */
export function combineMemoryHybridScore(lexical: number, cosine: number): number {
  return Math.max(lexical, Math.max(0, cosine))
}

/**
 * Score one row for a lexical-plus-cosine query.
 *
 * The max operation is intentional: hybrid activation is a union. Exact
 * keywords remain a guaranteed hit, while a semantically close embedding can
 * add a hit whose wording does not overlap. A missing or model-mismatched
 * vector affects only the cosine component and never disables lexical search.
 * @param queryText - Normalized query text, when supplied.
 * @param queryEmbedding - Query vector, when supplied.
 * @param row - Candidate derived row.
 * @param embeddingModel - Optional model label required for vector scoring.
 * @param embeddingVersion - Optional version label used to match the row before vector scoring.
 * @returns Independent components and their union ranking score.
 */
export function scoreMemoryIndexRow(
  queryText: string | undefined,
  queryEmbedding: readonly number[] | undefined,
  row: Pick<MemoryIndexRow, 'content' | 'embedding' | 'embeddingModel' | 'embeddingVersion' | 'model' | 'version'>,
  embeddingModel?: string,
  embeddingVersion?: string,
): MemoryHybridScore {
  const lexical = queryText === undefined ? 0 : lexicalScore(queryText, row.content)
  const rowModel = row.embeddingModel ?? row.model
  const rowVersion = row.embeddingVersion ?? row.version
  const modelMatches = embeddingModel === undefined || rowModel === undefined || rowModel === embeddingModel
  const versionMatches = embeddingVersion === undefined || rowVersion === undefined || rowVersion === embeddingVersion
  const cosine = queryEmbedding === undefined || row.embedding === undefined || !modelMatches || !versionMatches
    ? 0
    : cosineSimilarity(queryEmbedding, row.embedding)
  return { lexical, cosine, score: combineMemoryHybridScore(lexical, cosine) }
}

/**
 * Retrieve at most the configured prefetch count from a derived index.
 * An explicit query limit can further reduce the result, but cannot bypass
 * the prefetch cap used before prompt injection.
 * @param provider - Derived index provider used for the query.
 * @param input - Session and retrieval filters.
 * @param prefetchTopK - Maximum number of unique ranked hits to return.
 * @returns Ranked hits bounded by `prefetchTopK`.
 */
export function prefetchMemoryIndex(
  provider: Pick<MemoryIndexProvider, 'query'>,
  input: MemoryIndexQuery,
  prefetchTopK: number,
): readonly MemoryIndexHit[] {
  if (!Number.isSafeInteger(prefetchTopK) || prefetchTopK < 1) {
    throw new RangeError('prefetchTopK must be positive')
  }
  const limit = Math.min(input.limit ?? prefetchTopK, prefetchTopK)
  return provider.query({ ...input, limit })
}

/**
 * Sort scored hits without mutating the caller's collection.
 * @param hits - Candidate hits with independent hybrid components attached.
 * @param limit - Optional positive result limit.
 * @returns Hits ordered by hybrid score, newest sequence, then origin id.
 */
export function rankMemoryIndexHits(
  hits: readonly MemoryIndexHit[],
  limit?: number,
): readonly MemoryIndexHit[] {
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) {
    throw new RangeError('memory index rank limit must be positive')
  }
  const ranked = [...hits].sort((left, right) => right.score - left.score
    || right.row.seq - left.row.seq
    || compareStrings(left.row.originId, right.row.originId))
  return limit === undefined ? ranked : ranked.slice(0, limit)
}

function matchesHybridQuery(
  queryText: string | undefined,
  queryEmbedding: readonly number[] | undefined,
  score: MemoryHybridScore,
): boolean {
  if (queryText === undefined && queryEmbedding === undefined) return true
  return score.lexical > 0 || score.cosine > 0
}

function normalizeSearchText(value: string | undefined): string | undefined {
  const normalized = value?.normalize('NFKC').trim()
  return normalized === undefined || normalized.length === 0 ? undefined : normalized.toLocaleLowerCase()
}

function validateEmbedding(value: readonly number[] | undefined, name: string): void {
  if (value !== undefined && value.some(component => !Number.isFinite(component))) {
    throw new TypeError(`${name} must contain finite numbers`)
  }
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * Compute cosine similarity for two finite vectors.
 * @param left - First finite vector.
 * @param right - Second finite vector.
 * @returns Cosine similarity, or zero for incompatible vectors.
 */
export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length || left.length === 0) return 0
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0
    const rightValue = right[index] ?? 0
    dot += leftValue * rightValue
    leftNorm += leftValue * leftValue
    rightNorm += rightValue * rightValue
  }
  return leftNorm === 0 || rightNorm === 0 ? 0 : dot / Math.sqrt(leftNorm * rightNorm)
}
