/** Durable storage declaration for the Tavern asset library. */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { isJsonValue } from '@deepseek-ai/dsh-tavern-shared'
import type { AssetId, JsonObject } from '@deepseek-ai/dsh-tavern-assets'
import type { TavernAssetCleaningRecord, TavernImportSource } from './types.ts'

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

const canonicalCharacterFieldSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
  sourceEntryId: z.string().min(1).optional(),
})

const canonicalWorldEntrySchema = z.object({
  theme: z.string().min(1),
  text: z.string().min(1),
  suggestedKeys: z.array(z.string().min(1)),
  sourceEntryId: z.string().min(1),
  role: z.union([z.literal('npc'), z.literal('world'), z.literal('protagonist')]),
})

const canonicalNoiseSchema = z.object({
  sourceEntryId: z.string().min(1),
  reason: z.union([z.literal('duplicate'), z.literal('unclassifiable'), z.literal('stale')]),
})

const canonicalViewSchema = z.object({
  assetId: z.string().min(1),
  kind: z.union([z.literal('character'), z.literal('world-info')]),
  characterFields: z.array(canonicalCharacterFieldSchema),
  protagonistFields: z.array(canonicalCharacterFieldSchema),
  worldEntries: z.array(canonicalWorldEntrySchema),
  openingPrompt: z.string().min(1).optional(),
  greeting: z.string().min(1).optional(),
  noise: z.array(canonicalNoiseSchema),
  uncleaned: z.boolean(),
})

const cleaningRecordSchema = z.object({
  status: z.union([z.literal('fallback'), z.literal('model'), z.literal('confirmed')]),
  origin: z.union([z.literal('heuristic'), z.literal('model')]),
  view: canonicalViewSchema,
  route: z.object({ provider: z.string().min(1), model: z.string().min(1) }).optional(),
  error: z.string().optional(),
}).transform(value => value as TavernAssetCleaningRecord)

/** One source record sufficient to reconstruct a normalized asset. */
export const tavernAssetRecordSchema = z.object({
  kind: z.union([z.literal('character'), z.literal('world-info')]),
  id: z.string().min(1).transform(value => value as AssetId),
  input: jsonObjectSchema,
  source: sourceSchema,
  cleaning: cleaningRecordSchema.optional(),
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
