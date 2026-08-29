/** Durable storage declaration for the Tavern asset library. */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { AssetId, JsonObject } from '@deepseek-ai/dsh-tavern-assets'
import type { TavernImportSource } from './types.ts'

const jsonValueSchema = z.unknown().refine(isJsonValue, {
  message: 'Tavern asset source data must be JSON-compatible',
})

const jsonObjectSchema = z.record(z.string(), jsonValueSchema).transform(value => value as JsonObject)

const sourceSchema = z.object({
  kind: z.string().min(1),
  locator: z.string().min(1),
  mediaType: z.string().nullable().optional(),
  digest: z.string().nullable().optional(),
}).transform(value => value as TavernImportSource)

/** One source record sufficient to reconstruct a normalized asset. */
export const tavernAssetRecordSchema = z.object({
  kind: z.union([z.literal('character'), z.literal('world-info')]),
  id: z.string().min(1).transform(value => value as AssetId),
  input: jsonObjectSchema,
  source: sourceSchema,
})

/** Persisted Tavern asset record inferred from the durable schema. */
export type TavernAssetRecord = z.infer<typeof tavernAssetRecordSchema>

/** One durable Tavern asset library, keyed by stable asset id. */
export const tavernAssetDomainSpec = defineDomain({
  name: 'tavern_assets',
  version: 0,
  tables: {
    assets: domainTable<AssetId, TavernAssetRecord>(tavernAssetRecordSchema),
  },
})

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  if (typeof value !== 'object') return false
  return Object.values(value).every(isJsonValue)
}
