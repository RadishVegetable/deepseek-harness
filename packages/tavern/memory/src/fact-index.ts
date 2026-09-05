/** Persistent and in-memory fact-index adapters for Tavern Journey memory. */

import { closeSync, mkdirSync, openSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { dirname, resolve } from 'node:path'
import type {
  MemoryFactEntry,
  MemoryFactEvent,
  MemoryFactRecord,
  MemoryFactTarget,
  MemorySubjectKeyAlias,
} from './types.ts'
import { flattenMemoryProjection, projectMemoryFacts } from './fold.ts'
import { resolveSubjectKeyAlias } from './keys.ts'

/** Stable schema identifier for serialized fact-index state. */
export const MEMORY_FACT_INDEX_SCHEMA = 'tavern/memory-fact-index' as const

/** Current fact-index schema version; incompatible stores are rejected. */
export const MEMORY_FACT_INDEX_SCHEMA_VERSION = 1 as const

/** Backward-readable name for the current fact-index version. */
export const MEMORY_FACT_INDEX_VERSION = MEMORY_FACT_INDEX_SCHEMA_VERSION

/** SQLite application id used to avoid opening an unrelated database as a fact index. */
export const MEMORY_FACT_INDEX_APPLICATION_ID = 0x4453484d as const

/** Persistent table containing the append-only source records. */
export const MEMORY_FACT_INDEX_RECORDS_TABLE = 'memory_fact_records' as const

/** Persistent table containing the logical schema stamp. */
export const MEMORY_FACT_INDEX_METADATA_TABLE = 'memory_fact_index_metadata' as const

/** Supported SQLite journal modes for the file-backed adapter. */
export type MemoryFactIndexJournalMode = 'wal' | 'delete' | 'truncate' | 'persist'

/** Options for the SQLite fact-index adapter. */
export interface MemoryFactIndexSqliteOptions {
  /** SQLite database path, or `:memory:` for a connection-local SQLite store. */
  readonly path: string
  /** Journal mode for file-backed databases; defaults to `wal`. */
  readonly journalMode?: MemoryFactIndexJournalMode
}

/** Schema metadata a persistent adapter stamps on its stored state. */
export interface MemoryFactIndexMetadata {
  readonly schema: typeof MEMORY_FACT_INDEX_SCHEMA
  readonly version: typeof MEMORY_FACT_INDEX_SCHEMA_VERSION
}

/** Stable schema metadata shared by persistent and in-memory adapters. */
export const MEMORY_FACT_INDEX_METADATA: MemoryFactIndexMetadata = Object.freeze({
  schema: MEMORY_FACT_INDEX_SCHEMA,
  version: MEMORY_FACT_INDEX_SCHEMA_VERSION,
})

/** Query filters for the fact-index seam. */
export interface MemoryFactIndexQuery {
  readonly sessionId: string
  readonly branch?: string
  readonly target?: MemoryFactTarget
  readonly personId?: string
  readonly subjectKey?: string
  /** Subject-key aliases applied while matching the projected view. */
  readonly subjectKeyAliases?: readonly MemorySubjectKeyAlias[]
  readonly text?: string
  readonly limit?: number
}

/** One projected fact returned by a fact-index query. */
export interface MemoryFactIndexHit {
  readonly sessionId: string
  readonly fact: MemoryFactEntry
  readonly score: number
}

/** Storage-independent append/rebuild/query interface for fact indexes. */
export interface MemoryFactIndexProvider {
  readonly schema: typeof MEMORY_FACT_INDEX_SCHEMA
  readonly version: typeof MEMORY_FACT_INDEX_SCHEMA_VERSION
  /** Append source records without mutating records already supplied. */
  append(sessionId: string, records: MemoryFactRecord | readonly MemoryFactRecord[]): void
  /** Replace one session's derived state with a replay from its source records. */
  rebuild(sessionId: string, records: readonly MemoryFactRecord[]): void
  /** Query the deterministic projected view for one session. */
  query(input: MemoryFactIndexQuery): readonly MemoryFactIndexHit[]
  /** Release provider resources; repeated calls are harmless. */
  close(): void
}

/** Deterministic in-memory fallback for the persistent fact-index seam. */
export class MemoryFactIndex implements MemoryFactIndexProvider {
  readonly schema = MEMORY_FACT_INDEX_SCHEMA
  readonly version = MEMORY_FACT_INDEX_SCHEMA_VERSION
  private readonly records = new Map<string, Map<number, MemoryFactRecord>>()

  /**
   * Append one source record or a batch under a session namespace.
   * @param sessionId - Session namespace for the source records.
   * @param input - One record or records in append order.
   * @returns Nothing; records are copied into the fallback.
   */
  append(sessionId: string, input: MemoryFactRecord | readonly MemoryFactRecord[]): void {
    validateSessionId(sessionId)
    const records = this.records.get(sessionId) ?? new Map<number, MemoryFactRecord>()
    const batch = Array.isArray(input) ? input : [input]
    for (const record of batch) {
      validateRecord(record)
      records.set(record.seq, structuredClone(record))
    }
    this.records.set(sessionId, records)
  }

  /**
   * Replace one session's in-memory state with an authoritative replay.
   * @param sessionId - Session namespace to replace.
   * @param records - Append-only source records for that session.
   * @returns Nothing; the session is rebuilt in place.
   */
  rebuild(sessionId: string, records: readonly MemoryFactRecord[]): void {
    validateSessionId(sessionId)
    this.records.delete(sessionId)
    this.append(sessionId, records)
  }

  /**
   * Query active projected facts with deterministic lexical ranking.
   * @param input - Session, optional filters, and result limit.
   * @returns Detached ranked hits; source records remain owned by the index.
   */
  query(input: MemoryFactIndexQuery): readonly MemoryFactIndexHit[] {
    validateSessionId(input.sessionId)
    const source = [...(this.records.get(input.sessionId)?.values() ?? [])]
    return queryFactRecords(input, source)
  }

  /**
   * Release the process-local fallback. It owns no external resource.
   * @returns Nothing.
   */
  close(): void {
    // The in-memory fallback has no external handle to release.
  }
}

/** Alias naming the concrete adapter explicitly as the fallback. */
export { MemoryFactIndex as InMemoryFactIndex }

/**
 * SQLite-backed fact index that persists source records and replays the same
 * projection used by {@link MemoryFactIndex}. The current format rejects
 * incompatible stamped versions; records remain rebuildable from the session
 * log when a future format is introduced.
 */
export class SqliteFactIndex implements MemoryFactIndexProvider {
  readonly schema = MEMORY_FACT_INDEX_SCHEMA
  readonly version = MEMORY_FACT_INDEX_SCHEMA_VERSION
  private readonly db: DatabaseSync
  private closed = false

  /**
   * @param pathOrOptions - SQLite path or adapter options. The default is an
   * in-memory SQLite database.
   * @param journalMode - Journal mode when the first argument is a path.
   */
  constructor(
    pathOrOptions: string | MemoryFactIndexSqliteOptions = ':memory:',
    journalMode: MemoryFactIndexJournalMode = 'wal',
  ) {
    const options = typeof pathOrOptions === 'string'
      ? { path: pathOrOptions, journalMode }
      : { path: pathOrOptions.path, journalMode: pathOrOptions.journalMode ?? journalMode }
    this.db = openFactIndexDatabase(options.path, options.journalMode)
  }

  /**
   * Append one source record or a batch atomically.
   * @param sessionId - Session namespace for the source records.
   * @param input - One record or records in append order.
   * @returns Nothing; records are serialized without changing the inputs.
   */
  append(sessionId: string, input: MemoryFactRecord | readonly MemoryFactRecord[]): void {
    validateSessionId(sessionId)
    const batch = Array.isArray(input) ? input : [input]
    const encoded = batch.map(record => encodeRecord(record))
    if (encoded.length === 0) return
    this.withTransaction(() => {
      this.insertRecords(sessionId, encoded)
    })
  }

  /**
   * Replace one session's persisted state with an authoritative replay.
   * @param sessionId - Session namespace to replace.
   * @param records - Append-only source records for that session.
   * @returns Nothing; deletion and insertion commit as one transaction.
   */
  rebuild(sessionId: string, records: readonly MemoryFactRecord[]): void {
    validateSessionId(sessionId)
    const encoded = records.map(record => encodeRecord(record))
    this.withTransaction(() => {
      const db = this.requireOpen()
      db.prepare(`DELETE FROM ${MEMORY_FACT_INDEX_RECORDS_TABLE} WHERE session_id = ?`).run(sessionId)
      this.insertRecords(sessionId, encoded)
    })
  }

  /**
   * Query a session by replaying its durable source records through the
   * deterministic memory fold.
   * @param input - Session, optional filters, and result limit.
   * @returns Detached ranked hits; SQLite rows remain owned by the adapter.
   */
  query(input: MemoryFactIndexQuery): readonly MemoryFactIndexHit[] {
    validateSessionId(input.sessionId)
    const db = this.requireOpen()
    const rows = db.prepare(
      `SELECT seq, data FROM ${MEMORY_FACT_INDEX_RECORDS_TABLE} WHERE session_id = ? ORDER BY seq ASC`,
    ).all(input.sessionId) as Array<{ readonly seq: number; readonly data: string }>
    const records = rows.map(row => decodeRecord(row.data, row.seq))
    return queryFactRecords(input, records)
  }

  /**
   * Close the SQLite connection. Repeated calls are harmless.
   * @returns Nothing.
   */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.db.close()
  }

  private insertRecords(sessionId: string, records: readonly EncodedRecord[]): void {
    const db = this.requireOpen()
    const insert = db.prepare(`
      INSERT INTO ${MEMORY_FACT_INDEX_RECORDS_TABLE} (
        session_id, seq, branch, target, person_id, operation, fact_id,
        subject_key, text, accepted, data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (session_id, seq) DO UPDATE SET
        branch = excluded.branch,
        target = excluded.target,
        person_id = excluded.person_id,
        operation = excluded.operation,
        fact_id = excluded.fact_id,
        subject_key = excluded.subject_key,
        text = excluded.text,
        accepted = excluded.accepted,
        data = excluded.data
    `)
    for (const record of records) {
      insert.run(
        sessionId,
        record.seq,
        record.data.branch,
        record.data.target,
        record.data.personId ?? null,
        record.data.operation,
        record.data.factId ?? null,
        record.data.subjectKey ?? null,
        record.data.text ?? null,
        record.data.accepted ? 1 : 0,
        record.json,
      )
    }
  }

  private withTransaction(action: () => void): void {
    const db = this.requireOpen()
    db.exec('BEGIN IMMEDIATE')
    try {
      action()
      db.exec('COMMIT')
    } catch (error: unknown) {
      if (db.isTransaction) db.exec('ROLLBACK')
      throw error
    }
  }

  private requireOpen(): DatabaseSync {
    if (this.closed || !this.db.isOpen) throw new Error('fact-index SQLite adapter is closed')
    return this.db
  }
}

interface EncodedRecord {
  readonly seq: number
  readonly data: MemoryFactEvent
  readonly json: string
}

/**
 * Open and initialize the dedicated SQLite medium for the fact index.
 * @param path - Database path or `:memory:`.
 * @param journalMode - Validated SQLite journal mode.
 * @returns An initialized `DatabaseSync` handle.
 */
export function openFactIndexDatabase(path: string, journalMode: MemoryFactIndexJournalMode = 'wal'): DatabaseSync {
  validateJournalMode(journalMode)
  if (path.trim().length === 0) throw new TypeError('fact-index SQLite path must not be empty')
  const actual = path === ':memory:' ? path : resolve(path)
  if (actual !== ':memory:') {
    mkdirSync(dirname(actual), { recursive: true, mode: 0o700 })
    createDatabaseFile(actual)
  }
  const db = new DatabaseSync(actual)
  try {
    configureFactIndexDatabase(db, actual, journalMode)
    return db
  } catch (error: unknown) {
    db.close()
    throw error
  }
}

function createDatabaseFile(path: string): void {
  try {
    const descriptor = openSync(path, 'wx', 0o600)
    closeSync(descriptor)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

function configureFactIndexDatabase(db: DatabaseSync, path: string, journalMode: MemoryFactIndexJournalMode): void {
  const { application_id: applicationId } = db.prepare('PRAGMA application_id').get() as { application_id: number }
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
  const userTables = listUserTables(db)
  if (applicationId !== 0 && applicationId !== MEMORY_FACT_INDEX_APPLICATION_ID) {
    throw new Error(`fact-index database at "${path}" belongs to another application`)
  }
  if (applicationId === 0 && userTables.length > 0) {
    throw new Error(`fact-index database at "${path}" is not an empty or recognized fact index`)
  }
  if (applicationId === MEMORY_FACT_INDEX_APPLICATION_ID) {
    const unknownTables = userTables.filter(name => !FACT_INDEX_TABLES.has(name))
    if (unknownTables.length > 0) {
      throw new Error(`fact-index database at "${path}" has unrecognized user tables: ${unknownTables.join(', ')}`)
    }
  }
  if (version !== 0 && version !== MEMORY_FACT_INDEX_SCHEMA_VERSION) {
    throw new Error(
      `fact-index database at "${path}" has schema version ${version}, incompatible with this build (${MEMORY_FACT_INDEX_SCHEMA_VERSION})`,
    )
  }

  db.exec('PRAGMA foreign_keys = ON')
  db.exec(`PRAGMA journal_mode = ${journalMode.toUpperCase()}`)
  db.exec(`PRAGMA application_id = ${MEMORY_FACT_INDEX_APPLICATION_ID}`)
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${MEMORY_FACT_INDEX_METADATA_TABLE} (
      schema_id TEXT PRIMARY KEY,
      version   INTEGER NOT NULL CHECK (version > 0)
    ) STRICT
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${MEMORY_FACT_INDEX_RECORDS_TABLE} (
      session_id TEXT NOT NULL,
      seq        INTEGER NOT NULL CHECK (seq >= 0),
      branch     TEXT NOT NULL,
      target     TEXT NOT NULL CHECK (target IN ('person', 'world')),
      person_id  TEXT,
      operation  TEXT NOT NULL CHECK (operation IN ('add', 'replace', 'remove')),
      fact_id    TEXT,
      subject_key TEXT,
      text       TEXT,
      accepted   INTEGER NOT NULL CHECK (accepted IN (0, 1)),
      data       TEXT NOT NULL,
      PRIMARY KEY (session_id, seq)
    ) STRICT
  `)
  const metadata = db.prepare(
    `SELECT version FROM ${MEMORY_FACT_INDEX_METADATA_TABLE} WHERE schema_id = ?`,
  ).get(MEMORY_FACT_INDEX_SCHEMA) as { version: number } | undefined
  if (metadata === undefined) {
    db.prepare(
      `INSERT INTO ${MEMORY_FACT_INDEX_METADATA_TABLE} (schema_id, version) VALUES (?, ?)`,
    ).run(MEMORY_FACT_INDEX_SCHEMA, MEMORY_FACT_INDEX_SCHEMA_VERSION)
  } else if (metadata.version !== MEMORY_FACT_INDEX_SCHEMA_VERSION) {
    throw new Error(
      `fact-index database at "${path}" has metadata version ${metadata.version}, incompatible with this build (${MEMORY_FACT_INDEX_SCHEMA_VERSION})`,
    )
  }
  // Stamp fresh or previously unstamped recognized media last, after all DDL.
  if (version === 0) db.exec(`PRAGMA user_version = ${MEMORY_FACT_INDEX_SCHEMA_VERSION}`)
}

function listUserTables(db: DatabaseSync): string[] {
  const rows = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*' ORDER BY name",
  ).all() as Array<{ readonly name: string }>
  return rows.map(row => row.name)
}

const FACT_INDEX_TABLES = new Set<string>([
  MEMORY_FACT_INDEX_METADATA_TABLE,
  MEMORY_FACT_INDEX_RECORDS_TABLE,
])

function queryFactRecords(input: MemoryFactIndexQuery, source: readonly MemoryFactRecord[]): readonly MemoryFactIndexHit[] {
  const limit = input.limit ?? 8
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('fact-index query limit must be positive')
  const projection = projectMemoryFacts(source, {
    ...(input.branch === undefined ? {} : { branch: input.branch }),
    ...(input.subjectKeyAliases === undefined ? {} : { subjectKeyAliases: input.subjectKeyAliases }),
  })
  const subjectKey = input.subjectKey === undefined
    ? undefined
    : resolveSubjectKeyAlias(input.subjectKey, input.subjectKeyAliases)
  if (input.subjectKey !== undefined && subjectKey === undefined) return []
  const bySeq = new Map(source.map(record => [record.seq, record]))
  const queryText = normalizeText(input.text)
  const hits: MemoryFactIndexHit[] = []

  for (const fact of flattenMemoryProjection(projection)) {
    if (input.target !== undefined && fact.target !== input.target) continue
    if (input.personId !== undefined && fact.personId !== input.personId) continue
    if (subjectKey !== undefined && fact.subjectKey !== subjectKey) continue
    const score = queryText === undefined ? 0 : lexicalScore(queryText, fact.text)
    if (queryText !== undefined && score === 0) continue
    if (bySeq.get(fact.eventSeq) === undefined) continue
    hits.push({ sessionId: input.sessionId, fact: structuredClone(fact), score })
  }

  return hits
    .sort((left, right) => right.score - left.score
      || right.fact.eventSeq - left.fact.eventSeq
      || compareStrings(String(left.fact.factId), String(right.fact.factId)))
    .slice(0, limit)
}

function encodeRecord(record: MemoryFactRecord): EncodedRecord {
  validateRecord(record)
  return {
    seq: record.seq,
    data: record.data,
    json: JSON.stringify(record),
  }
}

function decodeRecord(json: string, expectedSeq: number): MemoryFactRecord {
  let value: unknown
  try {
    value = JSON.parse(json) as unknown
  } catch (error: unknown) {
    throw new Error('fact-index stored record contains invalid JSON', { cause: error })
  }
  const seq = isRecordObject(value) ? value.seq : undefined
  if (!isRecordObject(value)
    || typeof seq !== 'number'
    || !Number.isSafeInteger(seq)
    || seq < 0
    || seq !== expectedSeq
    || !isMemoryFactEvent(value.data)) {
    throw new Error('fact-index stored record is malformed')
  }
  return { seq, data: value.data }
}

function validateSessionId(sessionId: string): void {
  if (sessionId.trim().length === 0) throw new TypeError('fact-index sessionId must not be empty')
}

function validateRecord(record: MemoryFactRecord): void {
  if (!Number.isSafeInteger(record.seq) || record.seq < 0) {
    throw new RangeError('fact-index record seq must be a non-negative safe integer')
  }
}

function normalizeText(value: string | undefined): string | undefined {
  const normalized = value?.normalize('NFKC').trim().toLowerCase()
  return normalized === undefined || normalized.length === 0 ? undefined : normalized
}

function lexicalScore(query: string, content: string): number {
  const normalized = normalizeText(content) ?? ''
  if (normalized.includes(query)) return 1
  const terms = query.split(/\s+/u).filter(Boolean)
  return terms.length === 0 ? 0 : terms.filter(term => normalized.includes(term)).length / terms.length
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function validateJournalMode(value: string): asserts value is MemoryFactIndexJournalMode {
  if (!['wal', 'delete', 'truncate', 'persist'].includes(value)) {
    throw new TypeError(`fact-index SQLite journal mode '${value}' is unsupported`)
  }
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMemoryFactEvent(value: unknown): value is MemoryFactEvent {
  if (!isRecordObject(value)
    || typeof value.branch !== 'string'
    || (value.target !== 'person' && value.target !== 'world')
    || (value.operation !== 'add' && value.operation !== 'replace' && value.operation !== 'remove')
    || typeof value.accepted !== 'boolean') return false
  if (value.personId !== undefined && typeof value.personId !== 'string') return false
  if (value.factId !== undefined && typeof value.factId !== 'string') return false
  if (value.text !== undefined && typeof value.text !== 'string') return false
  if (value.label !== undefined && typeof value.label !== 'string') return false
  if (value.authority !== undefined
    && value.authority !== 'model-candidate'
    && value.authority !== 'observed'
    && value.authority !== 'authored-asset'
    && value.authority !== 'user'
    && value.authority !== 'gm') return false
  if (value.kind !== undefined && value.kind !== 'soft' && value.kind !== 'hard') return false
  if (value.subjectKey !== undefined && typeof value.subjectKey !== 'string') return false
  if (value.extractionId !== undefined && typeof value.extractionId !== 'string') return false
  if (value.explicit !== undefined && typeof value.explicit !== 'boolean') return false
  if (value.sourceAssetId !== undefined && typeof value.sourceAssetId !== 'string') return false
  if (value.sourceEntryId !== undefined && typeof value.sourceEntryId !== 'string') return false
  if (value.assistantSeq !== undefined && !Number.isSafeInteger(value.assistantSeq)) return false
  if (value.turn !== undefined && !Number.isSafeInteger(value.turn)) return false
  if (value.idempotencyKey !== undefined && typeof value.idempotencyKey !== 'string') return false
  if (value.replacesFactId !== undefined && typeof value.replacesFactId !== 'string') return false
  if (value.resolvesConflictIds !== undefined
    && (!Array.isArray(value.resolvesConflictIds) || value.resolvesConflictIds.some(id => typeof id !== 'string'))) return false
  if (value.revertedFromSeq !== undefined && !Number.isSafeInteger(value.revertedFromSeq)) return false
  if (value.rejection !== undefined && typeof value.rejection !== 'string') return false
  return true
}
