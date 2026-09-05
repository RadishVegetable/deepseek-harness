import { afterEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  InMemoryFactIndex,
  MEMORY_FACT_INDEX_METADATA,
  MEMORY_FACT_INDEX_APPLICATION_ID,
  MEMORY_FACT_INDEX_RECORDS_TABLE,
  MEMORY_FACT_INDEX_SCHEMA,
  MEMORY_FACT_INDEX_SCHEMA_VERSION,
  SqliteFactIndex,
} from '../src/fact-index.ts'
import type { MemoryFactEvent, MemoryFactRecord } from '../src/types.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function temporaryDatabasePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-tavern-memory-fact-index-'))
  temporaryDirectories.push(directory)
  return join(directory, 'facts.db')
}

function record(seq: number, data: Partial<MemoryFactEvent> & Pick<MemoryFactEvent, 'factId' | 'text'>): MemoryFactRecord {
  return {
    seq,
    data: {
      branch: 'main',
      target: 'world',
      operation: 'add',
      authority: 'observed',
      kind: 'soft',
      accepted: true,
      ...data,
    },
  }
}

describe('Tavern memory fact-index seam', () => {
  it('exposes versioned metadata and deterministic session-scoped fallback queries', () => {
    const index = new InMemoryFactIndex()
    index.append('session-1', [
      record(1, { factId: 'f:one', text: 'The gate is closed' }),
      record(2, { factId: 'f:two', text: 'The gate is guarded' }),
    ])
    index.append('session-2', record(1, { factId: 'f:other', text: 'The gate is closed' }))

    expect(index.schema).toBe(MEMORY_FACT_INDEX_SCHEMA)
    expect(index.version).toBe(MEMORY_FACT_INDEX_SCHEMA_VERSION)
    expect(MEMORY_FACT_INDEX_METADATA).toEqual({
      schema: MEMORY_FACT_INDEX_SCHEMA,
      version: MEMORY_FACT_INDEX_SCHEMA_VERSION,
    })
    expect(index.query({ sessionId: 'session-1', text: 'closed' }).map(hit => hit.fact.factId)).toEqual(['f:one'])
    expect(index.query({ sessionId: 'session-1' }).map(hit => hit.fact.factId)).toEqual(['f:two', 'f:one'])
    expect(index.query({ sessionId: 'session-2', text: 'closed' })).toHaveLength(1)
  })

  it('rebuilds one session from records and only returns the active folded fact', () => {
    const index = new InMemoryFactIndex()
    index.append('session-1', record(1, { factId: 'f:old', text: 'The gate is open', subjectKey: 'world:city.gate' }))
    index.rebuild('session-1', [
      record(2, { factId: 'f:new', text: 'The gate is closed', subjectKey: 'world:city.gate' }),
    ])

    expect(index.query({ sessionId: 'session-1' }).map(hit => hit.fact.text)).toEqual(['The gate is closed'])
  })

  it('persists records across reopen and stamps the SQLite schema', async () => {
    const path = await temporaryDatabasePath()
    const index = new SqliteFactIndex({ path, journalMode: 'delete' })
    index.append('session-1', [
      record(1, { factId: 'f:one', text: 'The gate is closed' }),
      record(2, { factId: 'f:two', text: 'The gate is guarded' }),
    ])
    index.close()

    const db = new DatabaseSync(path)
    expect((db.prepare('PRAGMA application_id').get() as { application_id: number }).application_id)
      .toBe(MEMORY_FACT_INDEX_APPLICATION_ID)
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
      .toBe(MEMORY_FACT_INDEX_SCHEMA_VERSION)
    expect(db.prepare(
      `SELECT COUNT(*) AS count FROM ${MEMORY_FACT_INDEX_RECORDS_TABLE}`,
    ).get()).toEqual({ count: 2 })
    db.close()

    const reopened = new SqliteFactIndex(path)
    expect(reopened.query({ sessionId: 'session-1' }).map(hit => hit.fact.factId)).toEqual(['f:two', 'f:one'])
    reopened.close()
  })

  it('rebuilds only the requested persisted session', async () => {
    const path = await temporaryDatabasePath()
    const index = new SqliteFactIndex(path)
    index.append('session-1', record(1, { factId: 'f:old', text: 'The gate is open' }))
    index.append('session-2', record(1, { factId: 'f:other', text: 'The bridge is open' }))
    index.rebuild('session-1', [record(2, { factId: 'f:new', text: 'The gate is closed' })])

    expect(index.query({ sessionId: 'session-1' }).map(hit => hit.fact.text)).toEqual(['The gate is closed'])
    expect(index.query({ sessionId: 'session-2' }).map(hit => hit.fact.text)).toEqual(['The bridge is open'])
    index.close()

    const reopened = new SqliteFactIndex(path)
    expect(reopened.query({ sessionId: 'session-1' }).map(hit => hit.fact.factId)).toEqual(['f:new'])
    reopened.close()
  })

  it('rejects an incompatible stamped SQLite schema', async () => {
    const path = await temporaryDatabasePath()
    const db = new DatabaseSync(path)
    db.exec('PRAGMA user_version = 999')
    db.close()

    expect(() => new SqliteFactIndex(path)).toThrow(/schema version 999.*incompatible/)
  })
})
