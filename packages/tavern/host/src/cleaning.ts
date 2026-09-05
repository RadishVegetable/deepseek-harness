/** Model-assisted canonical views for imported Tavern assets. */

import { Context } from '@deepseek-ai/cordis'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions } from '@deepseek-ai/dsh-llm'
import { cleanTavernAsset } from '@deepseek-ai/dsh-tavern-memory'
import type { CanonicalAssetView } from '@deepseek-ai/dsh-tavern-memory'
import { isRecord } from '@deepseek-ai/dsh-tavern-shared'
import type { TavernAsset } from '@deepseek-ai/dsh-tavern-assets/types'
import type {
  TavernAssetCleaningRecord,
  TavernAssetCleaningRoute,
} from './types.ts'

/** A model-backed cleaner that returns a source-tracked canonical asset view. */
export interface TavernAssetCleaner {
  /**
   * Clean one already parsed asset.
   * @param asset - Normalized asset whose original source remains authoritative.
   * @param signal - Optional cancellation signal for the model request.
   * @returns A validated canonical view.
   */
  clean(asset: TavernAsset, signal?: AbortSignal): Promise<CanonicalAssetView>
}

/**
 * Resolve a model route string into its two request fields.
 * @param route - Provider/model route.
 * @returns Detached provider and model names.
 * @throws when the route is not in provider/model form.
 */
export function parseCleaningRoute(route: string): TavernAssetCleaningRoute {
  const match = /^([^/\s]+)\/([^/\s]+)$/u.exec(route.trim())
  if (match === null || match[1] === undefined || match[2] === undefined) {
    throw new Error('Tavern asset cleaner route must use provider/model')
  }
  return { provider: match[1], model: match[2] }
}

/**
 * Build the deterministic model prompt used by the optional asset cleaner.
 * @param asset - Normalized source asset.
 * @returns A complete prompt whose output is limited to the canonical-view JSON.
 */
export function buildAssetCleaningPrompt(asset: TavernAsset): string {
  return [
    '整理下面的 Tavern 资产，输出一个可替换的规范视图。原始资产仍是权威来源。',
    '必须保留可追溯的 sourceEntryId；把主角、NPC 和世界设定分开；不要创造原文没有的事实。',
    '只输出 JSON，不要 Markdown。字段必须是：',
    '{"assetId":string,"kind":"character"|"world-info",',
    '"characterFields":[{"label":string,"value":string,"sourceEntryId"?:string}],',
    '"protagonistFields":[{"label":string,"value":string,"sourceEntryId"?:string}],',
    '"worldEntries":[{"theme":string,"text":string,"suggestedKeys":string[],"sourceEntryId":string,"role":"npc"|"world"|"protagonist"}],',
    '"openingPrompt"?:string,"greeting"?:string,',
    '"noise":[{"sourceEntryId":string,"reason":"duplicate"|"unclassifiable"|"stale"}],"uncleaned":false}',
    `原始规范化资产：${JSON.stringify(asset)}`,
  ].join('\n')
}

/**
 * Parse and validate a model-produced canonical view against its source asset.
 * @param value - Parsed model JSON or a view nested under `view`.
 * @param asset - Source asset that constrains identity and kind.
 * @returns A detached canonical view with `uncleaned: false`.
 * @throws when the model output is not a safe canonical view.
 */
export function validateCanonicalAssetView(value: unknown, asset: TavernAsset): CanonicalAssetView {
  const candidate = isRecord(value) && 'view' in value ? value['view'] : value
  if (!isRecord(candidate)) throw new Error('canonical asset view must be an object')
  const assetId = nonEmptyString(candidate['assetId'])
  const kind = candidate['kind']
  if (kind !== 'character' && kind !== 'world-info') {
    throw new Error('canonical asset view kind is invalid')
  }
  if (assetId !== String(asset.id) || kind !== asset.kind) {
    throw new Error('canonical asset view identity does not match its source asset')
  }
  const characterFields = parseCharacterFields(candidate['characterFields'])
  const protagonistFields = parseCharacterFields(candidate['protagonistFields'])
  const worldEntries = parseWorldEntries(candidate['worldEntries'])
  const noise = parseNoise(candidate['noise'])
  const sourceEntryIds = new Set(sourceEntryIdsFor(asset))
  for (const field of [...characterFields, ...protagonistFields]) {
    if (field.sourceEntryId !== undefined && !sourceEntryIds.has(field.sourceEntryId)) {
      throw new Error(`canonical field references unknown source entry '${field.sourceEntryId}'`)
    }
  }
  for (const entry of worldEntries) {
    if (!sourceEntryIds.has(entry.sourceEntryId)) {
      throw new Error(`canonical world entry references unknown source entry '${entry.sourceEntryId}'`)
    }
  }
  for (const item of noise) {
    if (!sourceEntryIds.has(item.sourceEntryId)) {
      throw new Error(`canonical noise references unknown source entry '${item.sourceEntryId}'`)
    }
  }
  const openingPrompt = optionalString(candidate['openingPrompt'])
  const greeting = optionalString(candidate['greeting'])
  return {
    assetId,
    kind,
    characterFields,
    protagonistFields,
    worldEntries,
    ...(openingPrompt === undefined ? {} : { openingPrompt }),
    ...(greeting === undefined ? {} : { greeting }),
    noise,
    uncleaned: false,
  }
}

/**
 * Run an optional model cleaner and fail back to the source-tracked heuristic.
 * @param ctx - Context carrying the LLM service.
 * @param asset - Parsed normalized asset.
 * @param route - Optional provider/model route.
 * @param signal - Optional cancellation signal.
 * @returns Durable cleaner status and canonical view.
 */
export async function resolveAssetCleaning(
  ctx: Context,
  asset: TavernAsset,
  route: TavernAssetCleaningRoute | undefined,
  signal?: AbortSignal,
): Promise<TavernAssetCleaningRecord> {
  const fallback = cleanTavernAsset(asset)
  if (route === undefined) return { status: 'fallback', origin: 'heuristic', view: fallback }
  try {
    const view = await cleanAssetWithModel(ctx, asset, route, signal)
    return { status: 'model', origin: 'model', view, route }
  } catch (error: unknown) {
    return {
      status: 'fallback',
      origin: 'heuristic',
      view: fallback,
      route,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function cleanAssetWithModel(
  ctx: Context,
  asset: TavernAsset,
  route: TavernAssetCleaningRoute,
  signal?: AbortSignal,
): Promise<CanonicalAssetView> {
  const assembler = new BlockAssembler()
  const options: GenerateOptions = {
    provider: route.provider,
    model: route.model,
    messages: [createUserMessage({
      content: [{ type: 'text', text: buildAssetCleaningPrompt(asset) }],
      source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-tavern-host/cleaner' },
    })],
    purpose: 'session-title',
    ...(signal === undefined ? {} : { signal }),
  }
  for await (const chunk of ctx.llm.stream(options)) assembler.push(chunk)
  const finish = assembler.finish
  if (finish.kind === 'error' || finish.kind === 'aborted') {
    throw new Error(finish.failure.message)
  }
  const text = assembler.blocks()
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
    .trim()
  if (text.length === 0) throw new Error('asset cleaner returned no text')
  let value: unknown
  try {
    value = JSON.parse(stripCodeFence(text)) as unknown
  } catch {
    throw new Error('asset cleaner output must be valid JSON')
  }
  return validateCanonicalAssetView(value, asset)
}

function stripCodeFence(value: string): string {
  return value.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '').trim()
}

function sourceEntryIdsFor(asset: TavernAsset): readonly string[] {
  if (asset.kind === 'character') {
    return asset.characterBook === null
      ? []
      : asset.characterBook.entries.map(entry => String(entry.id))
  }
  return asset.entries.map(entry => String(entry.id))
}

function parseCharacterFields(value: unknown): CanonicalAssetView['characterFields'] {
  if (!Array.isArray(value)) throw new Error('canonical character fields must be an array')
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`canonical character field ${index} must be an object`)
    const label = nonEmptyString(item['label'])
    const fieldValue = nonEmptyString(item['value'])
    const sourceEntryId = optionalString(item['sourceEntryId'])
    if (label === undefined || fieldValue === undefined) throw new Error(`canonical character field ${index} is incomplete`)
    return {
      label,
      value: fieldValue,
      ...(sourceEntryId === undefined ? {} : { sourceEntryId }),
    }
  })
}

function parseWorldEntries(value: unknown): CanonicalAssetView['worldEntries'] {
  if (!Array.isArray(value)) throw new Error('canonical world entries must be an array')
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`canonical world entry ${index} must be an object`)
    const theme = nonEmptyString(item['theme'])
    const text = nonEmptyString(item['text'])
    const sourceEntryId = nonEmptyString(item['sourceEntryId'])
    const role = item['role']
    const suggestedKeys = item['suggestedKeys']
    if (theme === undefined || text === undefined || sourceEntryId === undefined
      || (role !== 'npc' && role !== 'world' && role !== 'protagonist')
      || !Array.isArray(suggestedKeys)
      || suggestedKeys.some(key => typeof key !== 'string' || key.trim().length === 0)) {
      throw new Error(`canonical world entry ${index} is incomplete`)
    }
    return {
      theme,
      text,
      sourceEntryId,
      role,
      suggestedKeys: suggestedKeys.map(key => key.trim()),
    }
  })
}

function parseNoise(value: unknown): CanonicalAssetView['noise'] {
  if (!Array.isArray(value)) throw new Error('canonical noise must be an array')
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`canonical noise ${index} must be an object`)
    const sourceEntryId = nonEmptyString(item['sourceEntryId'])
    const reason = item['reason']
    if (sourceEntryId === undefined || (reason !== 'duplicate' && reason !== 'unclassifiable' && reason !== 'stale')) {
      throw new Error(`canonical noise ${index} is incomplete`)
    }
    return { sourceEntryId, reason }
  })
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function optionalString(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : nonEmptyString(value)
}
