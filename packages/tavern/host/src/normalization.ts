/** AI-assisted and deterministic normalization of selected Tavern assets. */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { AssetId } from '@deepseek-ai/dsh-tavern-assets/types'
import { BlockAssembler, createUserMessage, deepFreeze } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, FinishReason, GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { PromptAssetBaseline, PromptWorldInfoEntry } from '@deepseek-ai/dsh-tavern-assets/types'
import { collectCharacterEntries, isRecord, parseJson, parseLabeledLines, slug, suggestedLabels } from '@deepseek-ai/dsh-tavern-shared'
import type { TavernFactEvent, TavernFactKind, TavernJourneySelection } from './types.ts'
import type {} from '@deepseek-ai/dsh-llm'
import { inferFactKind } from './facts.ts'

/** Result of normalizing one resolved Journey source selection. */
export interface TavernNormalizationResult {
  /** Primary normalized facts; this is the Journey memory input. */
  readonly facts: readonly TavernNormalizedFact[]
  /** Whether the accepted fields came from the model or local fallback. */
  readonly origin: 'model' | 'heuristic'
  /** Route used for an accepted model result. */
  readonly route?: { readonly provider: string; readonly model: string }
}

/** One deterministic, source-tracked fact produced during Journey bootstrap. */
export interface TavernNormalizedFact {
  readonly target: 'person' | 'world'
  readonly personId?: string
  readonly label: string
  readonly text: string
  readonly kind: TavernFactKind
  readonly sourceAssetId: string
  readonly sourceEntryId?: string
}

interface NormalizationField {
  readonly id: string
  readonly sourceAssetId: AssetId
  readonly sourceEntryId?: AssetId
  readonly label: string
  readonly value: string
}

/** Result of preparing authored facts before the Journey service appends them. */
export interface TavernJourneyBootstrapResult extends TavernNormalizationResult {
  readonly selection: TavernJourneySelection
  readonly factEvents: readonly TavernFactEvent[]
}

const NORMALIZATION_SYSTEM = [
  'Normalize the supplied Tavern Character Card and World Book content into dynamic display fields.',
  'Return only JSON in the form {"fields":[{"sourceAssetId":"...","sourceEntryId":"...","label":"...","value":"..."}]} .',
  'Use only sourceAssetId and sourceEntryId values supplied in the input. Do not invent facts or rewrite content.',
  'Preserve natural-language values. Labels may be any concise field name needed by the source content.',
  `Suggested character labels: ${suggestedLabels.character.join(', ')}.`,
  `Suggested world labels: ${suggestedLabels.world.join(', ')}.`,
].join('\n')

// Auxiliary normalization must never hold up Journey startup indefinitely.
const NORMALIZATION_TIMEOUT_MS = 1000

/**
 * Normalize the selected Journey and return facts as the primary result.
 * @param agent - Agent whose configured model route owns the optional pass.
 * @param selection - Selected assets and their immutable prompt baseline.
 * @returns Source-tracked authored facts and normalization audit metadata.
 */
export async function normalizeJourney(agent: Agent, selection: TavernJourneySelection): Promise<TavernNormalizationResult> {
  return normalizeBaseline(agent, selection.baseline, selection.character?.name)
}

/**
 * Produce the deterministic normalization used when no model route is available.
 * @param selection - Selected assets and their immutable prompt baseline.
 * @returns Authored facts and derived fields without model calls or mutation.
 */
export function normalizeJourneyDeterministic(selection: TavernJourneySelection): TavernNormalizationResult {
  const worldInfoEntries = uniqueWorldInfoEntries(selection.baseline)
  const fields = fallbackFields(selection.baseline, worldInfoEntries)
  return {
    facts: normalizedFacts(fields, selection.baseline, selection.character?.name, worldInfoEntries),
    origin: 'heuristic',
  }
}

/**
 * Prepare a Journey bootstrap payload, including events ready for Session append.
 * @param agent - Agent owning the Journey branch.
 * @param selection - Selected assets and their immutable prompt baseline.
 * @param options - Optional branch identifier for pure replay and tests.
 * @returns Selection, normalized facts, and authored-asset fact event data.
 */
export async function bootstrapJourney(
  agent: Agent,
  selection: TavernJourneySelection,
  options: { readonly branch?: string } = {},
): Promise<TavernJourneyBootstrapResult> {
  const normalized = await normalizeJourney(agent, selection)
  const branch = options.branch ?? String(agent.session.id)
  const factEvents = normalized.facts.map((fact, index): TavernFactEvent => ({
    branch,
    target: fact.target,
    ...(fact.personId === undefined ? {} : { personId: fact.personId }),
    operation: 'add',
    factId: `fact:asset:${slug(fact.sourceAssetId)}:${slug(fact.sourceEntryId ?? 'asset')}:${index + 1}`,
    label: fact.label,
    text: fact.text,
    authority: 'authored-asset',
    kind: fact.kind,
    sourceAssetId: fact.sourceAssetId,
    ...(fact.sourceEntryId === undefined ? {} : { sourceEntryId: fact.sourceEntryId }),
    accepted: true,
  }))
  return {
    ...normalized,
    selection: structuredClone(selection),
    factEvents,
  }
}

/**
 * Normalize a selected baseline, using the selected agent route only for large source bundles.
 * @param agent - Agent whose configured model route owns the auxiliary call.
 * @param baseline - Immutable Journey baseline to inspect.
 * @returns Validated fields, falling back locally when no route or valid model output exists.
 */
export async function normalizeTavernBaseline(agent: Agent, baseline: PromptAssetBaseline): Promise<TavernNormalizationResult> {
  return normalizeBaseline(agent, baseline)
}

async function normalizeBaseline(
  agent: Agent,
  baseline: PromptAssetBaseline,
  characterName?: string,
): Promise<TavernNormalizationResult> {
  const worldInfoEntries = uniqueWorldInfoEntries(baseline)
  const fallback = fallbackFields(baseline, worldInfoEntries)
  const fallbackFactsResult = normalizedFacts(fallback, baseline, characterName, worldInfoEntries)
  const input = normalizationInput(baseline, worldInfoEntries)
  const route = resolveRoute(agent)
  if (route === undefined) return { facts: fallbackFactsResult, origin: 'heuristic' }
  const raw = await callNormalizer(agent, route, input)
  if (raw === undefined) return { facts: fallbackFactsResult, origin: 'heuristic' }
  const fields = parseModelFields(raw, baseline, worldInfoEntries)
  if (fields === undefined) return { facts: fallbackFactsResult, origin: 'heuristic' }
  return { facts: normalizedFacts(fields, baseline, characterName, worldInfoEntries), origin: 'model', route }
}

function resolveRoute(agent: Agent): { provider: string; model: string } | undefined {
  const configured = agent.session.requestHeader()?.config
  const provider = configured?.provider || agent.options.provider
  const model = configured?.model || agent.options.model
  if (provider === undefined || provider.length === 0 || model === undefined || model.length === 0) return undefined
  return agent.ctx.llm.listProviders().some(candidate => candidate.id === provider)
    ? { provider, model }
    : undefined
}

async function callNormalizer(
  agent: Agent,
  route: { provider: string; model: string },
  input: string,
): Promise<string | undefined> {
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  const collect = (async (): Promise<string | undefined> => {
    const options: GenerateOptions = deepFreeze({
      provider: route.provider,
      model: route.model,
      messages: [createUserMessage({
        content: [{ type: 'text', text: input }],
        source: { kind: 'plugin', plugin: 'dsh-tavern-host' },
      })],
      system: NORMALIZATION_SYSTEM,
      sessionId: agent.session.id,
      signal: controller.signal,
    })
    const assembler = new BlockAssembler()
    try {
      for await (const chunk of agent.ctx.llm.stream(options)) assembler.push(chunk)
    } catch {
      return undefined
    }
    if (finishError(assembler.finish) !== undefined) return undefined
    const blocks = assembler.blocks()
    if (blocks.some(block => block.type !== 'text')) return undefined
    return blocks
      .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
      .map(block => block.text)
      .join('')
  })()
  const deadline = new Promise<undefined>((resolve) => {
    timeout = setTimeout(() => {
      controller.abort()
      resolve(undefined)
    }, NORMALIZATION_TIMEOUT_MS)
  })
  try {
    return await Promise.race([collect, deadline])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

function finishError(finish: FinishReason): Error | undefined {
  switch (finish.kind) {
    case 'error':
    case 'aborted':
      return new Error(finish.failure.message)
    case 'max-tokens':
      return new Error('normalization output was truncated')
    default:
      return undefined
  }
}

function normalizationInput(
  baseline: PromptAssetBaseline,
  worldInfoEntries: readonly PromptWorldInfoEntry[] = uniqueWorldInfoEntries(baseline),
): string {
  const lines = ['Normalize these source fields. Every returned field must cite one source id below.']
  for (const section of baseline.characterSections) {
    lines.push(`[asset=${section.sourceAssetId}] [field=${section.field}] ${section.text}`)
  }
  for (const entry of worldInfoEntries) {
    lines.push(`[asset=${entry.sourceAssetId}] [entry=${entry.id}] ${entry.content}`)
  }
  return lines.join('\n')
}

function fallbackFields(
  baseline: PromptAssetBaseline,
  worldInfoEntries: readonly PromptWorldInfoEntry[] = uniqueWorldInfoEntries(baseline),
): readonly NormalizationField[] {
  const candidates: NormalizationCandidate[] = []
  for (const section of baseline.characterSections) {
    candidates.push({
      sourceAssetId: section.sourceAssetId,
      label: characterFieldLabel(section.field),
      value: section.text,
    })
  }
  for (const entry of worldInfoEntries) {
    const fields = parseLabeledLines(entry.content)
    if (fields.length === 0) {
      candidates.push({ sourceAssetId: entry.sourceAssetId, sourceEntryId: entry.id, label: 'Content', value: entry.content })
    } else {
      for (const field of fields) {
        candidates.push({ sourceAssetId: entry.sourceAssetId, sourceEntryId: entry.id, ...field })
      }
    }
  }
  return assignStableIds(candidates, 'heuristic')
}

function normalizedFacts(
  fields: readonly NormalizationField[],
  baseline: PromptAssetBaseline,
  characterName?: string,
  worldInfoEntries: readonly PromptWorldInfoEntry[] = uniqueWorldInfoEntries(baseline),
): readonly TavernNormalizedFact[] {
  const characterAssetId = baseline.selection.characterId === null ? undefined : String(baseline.selection.characterId)
  const characterEntries = new Map<string, string>()
  for (const entry of worldInfoEntries) {
    const character = collectCharacterEntries([entry])[0]
    if (character !== undefined) characterEntries.set(`${String(entry.sourceAssetId)}:${String(entry.id)}`, character.name)
  }
  return fields.flatMap((field): readonly TavernNormalizedFact[] => {
    const sourceAssetId = String(field.sourceAssetId)
    const sourceEntryId = field.sourceEntryId === undefined ? undefined : String(field.sourceEntryId)
    const entryCharacterName = sourceEntryId === undefined
      ? undefined
      : characterEntries.get(`${sourceAssetId}:${sourceEntryId}`)
    const isCharacterCardField = characterAssetId !== undefined && sourceAssetId === characterAssetId
    const personName = entryCharacterName ?? (isCharacterCardField ? characterName : undefined)
    const label = field.label.trim()
    const text = field.value.trim()
    if (label.length === 0 || text.length === 0) return []
    return [{
      target: personName === undefined ? 'world' : 'person',
      ...(personName === undefined ? {} : { personId: `person:${slug(personName, 'character')}` }),
      label,
      text,
      kind: inferFactKind(label),
      sourceAssetId,
      ...(sourceEntryId === undefined ? {} : { sourceEntryId }),
    }]
  })
}

interface NormalizationCandidate {
  readonly sourceAssetId: AssetId
  readonly sourceEntryId?: AssetId
  readonly label: string
  readonly value: string
}

function parseModelFields(
  raw: string,
  baseline: PromptAssetBaseline,
  worldInfoEntries: readonly PromptWorldInfoEntry[] = uniqueWorldInfoEntries(baseline),
): readonly NormalizationField[] | undefined {
  const value = parseJson(raw)
  if (!isRecord(value) || !Array.isArray(value.fields) || value.fields.length === 0) return undefined
  const allowedAssets = new Set<string>([
    ...baseline.characterSections.map(section => String(section.sourceAssetId)),
    ...worldInfoEntries.map(entry => String(entry.sourceAssetId)),
  ])
  const allowedEntries = new Set(worldInfoEntries.map(entry => sourceEntryKey(entry.sourceAssetId, entry.id)))
  const candidates: NormalizationCandidate[] = []
  for (const item of value.fields) {
    if (!isRecord(item)) return undefined
    const sourceAssetId = stringValue(item.sourceAssetId)
    const sourceEntryId = item.sourceEntryId === undefined ? undefined : stringValue(item.sourceEntryId)
    const label = stringValue(item.label)
    const fieldValue = stringValue(item.value)
    if (sourceAssetId === undefined || label === undefined || fieldValue === undefined) return undefined
    if (!allowedAssets.has(sourceAssetId)) return undefined
    if (sourceEntryId !== undefined && !allowedEntries.has(sourceEntryKey(sourceAssetId, sourceEntryId))) return undefined
    if (sourceEntryId === undefined
      && sourceAssetId !== String(baseline.selection.characterId)
      && worldInfoEntries.some(entry => String(entry.sourceAssetId) === sourceAssetId)) return undefined
    candidates.push({
      sourceAssetId: sourceAssetId as AssetId,
      ...(sourceEntryId === undefined ? {} : { sourceEntryId: sourceEntryId as AssetId }),
      label,
      value: fieldValue,
    })
  }
  return assignStableIds(candidates, 'model')
}

function uniqueWorldInfoEntries(baseline: PromptAssetBaseline): readonly PromptWorldInfoEntry[] {
  const seen = new Set<string>()
  return baseline.worldInfoEntries.filter((entry) => {
    const key = sourceEntryKey(entry.sourceAssetId, entry.id)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function sourceEntryKey(sourceAssetId: AssetId | string, sourceEntryId: AssetId | string): string {
  return `${String(sourceAssetId)}\u0000${String(sourceEntryId)}`
}

function assignStableIds(candidates: readonly NormalizationCandidate[], origin: 'model' | 'heuristic'): readonly NormalizationField[] {
  const occurrences = new Map<string, number>()
  return candidates.flatMap((candidate) => {
    const label = candidate.label.trim()
    const value = candidate.value.trim()
    if (label.length === 0 || value.length === 0) return []
    const key = `${candidate.sourceAssetId}:${candidate.sourceEntryId ?? ''}:${label.toLocaleLowerCase()}`
    const occurrence = occurrences.get(key) ?? 0
    occurrences.set(key, occurrence + 1)
    const base = {
      id: `field:${candidate.sourceAssetId}:${candidate.sourceEntryId ?? 'asset'}:${slug(label, 'field')}:${occurrence + 1}`,
      sourceAssetId: candidate.sourceAssetId,
      label,
      value,
      origin,
    }
    return [candidate.sourceEntryId === undefined ? base : { ...base, sourceEntryId: candidate.sourceEntryId }]
  })
}

function characterFieldLabel(field: string): string {
  return field
    .split('-')
    .map(part => part.length === 0 ? part : `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}
