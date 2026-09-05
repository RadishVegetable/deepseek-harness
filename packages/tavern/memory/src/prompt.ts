/** Prompt construction and strict parsing for the Journey extraction seam. */

import { isRecord } from '@deepseek-ai/dsh-tavern-shared'
import type {
  MemoryExtractionAtom,
  MemoryExtractionBatch,
  MemoryExtractionParseResult,
  MemoryExtractionPromptInput,
  MemoryRosterEntry,
  MemoryRosterUpdate,
} from './types.ts'
import { normalizeSubjectKey } from './keys.ts'

/** Stable output rules shared by extraction callers and prompt tests. */
export const MEMORY_EXTRACTION_RULES = Object.freeze([
  '区分剧情内行动、文风或节奏指令、以及对设定的显式修改；只有设定修改或稳定状态才记录。',
  '一条原子只描述一个维度；复合描述必须拆成多个原子。',
  '叙事推断使用 explicit=false；玩家明确修改或直陈使用 explicit=true。',
  '无法确定实体、维度或事实是否持久时不要记录。',
  '不要改写历史文本；只返回事实关系和原子文本。',
])

/** JSON-schema-like description sent with a structured extraction request. */
export const MEMORY_EXTRACTION_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['atoms'],
  properties: {
    atoms: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['op', 'target', 'explicit', 'anchorTurn'],
        properties: {
          op: { enum: ['add', 'replace', 'remove'] },
          target: { enum: ['person', 'world'] },
          personId: { type: 'string' },
          subjectKey: { type: 'string' },
          label: { type: 'string' },
          text: { type: 'string' },
          factId: { type: 'string' },
          replacesFactId: { type: 'string' },
          kind: { enum: ['soft', 'hard'] },
          explicit: { type: 'boolean' },
          anchorTurn: { type: 'integer', minimum: 1 },
        },
      },
    },
    rosterUpdates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['action', 'slug', 'displayName'],
      },
    },
  },
} as const)

/**
 * Render the fixed five-section extraction prompt.
 * @param input - Long-range, middle-range, current-turn, and roster context.
 * @returns A deterministic prompt suitable for one structured LLM call.
 */
export function buildMemoryExtractionPrompt(input: MemoryExtractionPromptInput): string {
  const roster = input.roster.length === 0
    ? '（暂无已知人物）'
    : input.roster.map(entry => formatRosterEntry(entry)).join('\n')
  const keys = input.existingSubjectKeys?.length === 0 || input.existingSubjectKeys === undefined
    ? '（暂无现有结构键；拿不准时留空）'
    : input.existingSubjectKeys.join('\n')
  return [
    '[长程背景]',
    input.longRange.trim(),
    '[中程转写]',
    input.middleTranscript.trim(),
    '[当前回合]',
    input.currentTurn.trim(),
    '[花名册与键清单]',
    roster,
    '现有结构键：',
    keys,
    '[输出格式说明]',
    JSON.stringify(MEMORY_EXTRACTION_SCHEMA),
    ...MEMORY_EXTRACTION_RULES.map((rule, index) => `${index + 1}. ${rule}`),
  ].join('\n')
}

/**
 * Alias named after the prompt's rendering role.
 * @param input - Prompt sections and Journey roster.
 * @returns The deterministic extraction prompt.
 */
export function renderMemoryExtractionPrompt(input: MemoryExtractionPromptInput): string {
  return buildMemoryExtractionPrompt(input)
}

/**
 * Parse a model response as the strict extraction batch. Fenced JSON is
 * accepted; any malformed batch is discarded so its caller can retry without
 * advancing the extraction cursor.
 * @param raw - Complete text returned by the extraction model.
 * @returns A validated batch, or `undefined` when the whole response is invalid.
 */
export function parseMemoryExtractionOutput(raw: string): MemoryExtractionBatch | undefined {
  const result = parseMemoryExtractionOutputStrict(raw)
  return result.ok ? result.value : undefined
}

/**
 * Parse and validate the complete extraction response at the model boundary.
 * Unknown fields and invalid atom semantics reject the whole batch, which lets
 * the caller retry without moving its extraction cursor.
 * @param raw - Complete text returned by the extraction model.
 * @returns A strict parse result with an actionable error when rejected.
 */
export function parseMemoryExtractionOutputStrict(raw: string): MemoryExtractionParseResult {
  const value = parseStructuredJson(raw)
  if (!isRecord(value)) return { ok: false, error: 'extraction output must be a JSON object' }
  if (!hasOnlyKeys(value, ['atoms', 'rosterUpdates']) || !Array.isArray(value['atoms'])) {
    return { ok: false, error: 'extraction output must contain only atoms and rosterUpdates, with atoms as an array' }
  }
  const atoms: MemoryExtractionAtom[] = []
  for (const [index, item] of value['atoms'].entries()) {
    const parsed = parseAtom(item)
    if (!parsed.ok) return { ok: false, error: `atom ${index + 1}: ${parsed.error}` }
    atoms.push(parsed.value)
  }
  const rosterUpdates = parseRosterUpdates(value['rosterUpdates'])
  if (rosterUpdates === undefined) return { ok: false, error: 'rosterUpdates must be an array of add entries' }
  return { ok: true, value: { atoms, rosterUpdates } }
}

/** Short alias for callers that use the extraction seam name. */
export const parseExtractionOutput = parseMemoryExtractionOutputStrict

function parseAtom(value: unknown):
  | { readonly ok: true; readonly value: MemoryExtractionAtom }
  | { readonly ok: false; readonly error: string } {
  if (!isRecord(value)) return { ok: false, error: 'must be an object' }
  const allowed = ['op', 'target', 'personId', 'subjectKey', 'label', 'text', 'factId', 'replacesFactId', 'kind', 'explicit', 'anchorTurn']
  if (!hasOnlyKeys(value, allowed)) return { ok: false, error: 'contains an unknown field' }
  const op = value['op']
  const target = value['target']
  const explicit = value['explicit']
  const anchorTurn = value['anchorTurn']
  if ((op !== 'add' && op !== 'replace' && op !== 'remove')
    || (target !== 'person' && target !== 'world')
    || typeof explicit !== 'boolean'
    || typeof anchorTurn !== 'number'
    || !Number.isSafeInteger(anchorTurn)
    || anchorTurn < 1) {
    return { ok: false, error: 'op, target, explicit, or anchorTurn is invalid' }
  }
  for (const key of ['personId', 'subjectKey', 'label', 'text', 'factId', 'replacesFactId']) {
    if (value[key] !== undefined && typeof value[key] !== 'string') return { ok: false, error: `${key} must be a string` }
  }
  const personId = optionalString(value['personId'])
  if (target === 'person'
    && (personId === undefined || !/^person:[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(personId))) {
    return { ok: false, error: 'personId must use person:<slug>' }
  }
  if (target === 'world' && personId !== undefined) return { ok: false, error: 'world atoms cannot contain personId' }
  const text = optionalString(value['text'])
  const factId = optionalString(value['factId'])
  const replacesFactId = optionalString(value['replacesFactId'])
  if (op === 'add' && (factId !== undefined || replacesFactId !== undefined)) {
    return { ok: false, error: 'add atoms cannot reference an existing fact' }
  }
  if (op === 'replace' && factId === undefined) return { ok: false, error: 'replace requires factId' }
  if (op === 'remove' && factId === undefined) return { ok: false, error: 'remove requires factId' }
  if (op === 'remove' && (text !== undefined || replacesFactId !== undefined)) {
    return { ok: false, error: 'remove cannot contain text or replacesFactId' }
  }
  if (op !== 'remove' && text === undefined) return { ok: false, error: `${op} requires non-empty text` }
  const subjectKey = optionalString(value['subjectKey'])
  if (subjectKey !== undefined && normalizeSubjectKey(subjectKey) === undefined) {
    return { ok: false, error: 'subjectKey is invalid' }
  }
  if (subjectKey !== undefined) {
    const normalized = normalizeSubjectKey(subjectKey)
    const domain = normalized?.slice(0, normalized.indexOf('.'))
    if (target === 'world' && !domain?.startsWith('world:')) return { ok: false, error: 'world subjectKey must use world:<slug>' }
    if (target === 'person' && domain !== personId) return { ok: false, error: 'person subjectKey must match personId' }
  }
  const label = optionalString(value['label'])
  const kind = value['kind']
  if (kind !== undefined && kind !== 'soft' && kind !== 'hard') return { ok: false, error: 'kind must be soft or hard' }
  return {
    ok: true,
    value: {
      op,
      target,
      ...(personId === undefined ? {} : { personId }),
      ...(subjectKey === undefined ? {} : { subjectKey: normalizeSubjectKey(subjectKey) as string }),
      ...(label === undefined ? {} : { label }),
      ...(text === undefined ? {} : { text }),
      ...(factId === undefined ? {} : { factId }),
      ...(replacesFactId === undefined ? {} : { replacesFactId }),
      ...(kind === undefined ? {} : { kind }),
      explicit,
      anchorTurn,
    },
  }
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed)
  return Object.keys(value).every(key => allowedKeys.has(key))
}

function parseStructuredJson(raw: string): unknown {
  const trimmed = raw.trim()
  const candidate = trimmed.startsWith('```')
    ? trimmed.replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '').trim()
    : trimmed
  try {
    return JSON.parse(candidate) as unknown
  } catch {
    return undefined
  }
}

/**
 * Render the summary-only call used by the compaction provider seam.
 * @param transcript - Source transcript for the compacted range.
 * @param facts - Atoms already extracted from that range.
 * @returns A deterministic relation-only summary prompt.
 */
export function buildMemorySummaryPrompt(
  transcript: string,
  facts: readonly MemoryExtractionAtom[],
): string {
  return [
    '[待整理转写]',
    transcript.trim(),
    '[本区间已提取原子]',
    JSON.stringify(facts),
    '[输出格式说明]',
    '{"plotSummary":"1-3 段剧情梗概","openThreads":[{"text":"未决伏笔","status":"open|closed"}],"atomCleanup":[{"action":"merge-alias|mark-duplicate","evidence":["factId"]}]}',
    '只输出 JSON。只给出原子之间的关系，不生成替代事实文本。',
  ].join('\n')
}

function formatRosterEntry(entry: MemoryRosterEntry): string {
  const aliases = entry.aliases.length === 0 ? '' : `（别名：${entry.aliases.join('、')}）`
  const keys = entry.subjectKeys.length === 0 ? '无' : entry.subjectKeys.join('、')
  return `${entry.personId} ${entry.displayName}${aliases}；键：${keys}`
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function parseRosterUpdates(value: unknown): readonly MemoryRosterUpdate[] | undefined {
  if (value === undefined) return []
  if (!Array.isArray(value)) return undefined
  const result: MemoryRosterUpdate[] = []
  for (const item of value) {
    if (!isRecord(item) || item['action'] !== 'add') return undefined
    if ((item['slug'] !== undefined && typeof item['slug'] !== 'string')
      || (item['displayName'] !== undefined && typeof item['displayName'] !== 'string')) return undefined
    const slug = optionalString(item['slug'])
    const displayName = optionalString(item['displayName'])
    if (slug === undefined || displayName === undefined || !/^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(slug)) return undefined
    result.push({ action: 'add', slug, displayName })
  }
  return result
}

/**
 * Normalize a model key at the schema edge while preserving invalid keys for fallback.
 * @param value - Candidate structure key.
 * @returns A normalized subject key, or `undefined` when invalid.
 */
export function parsedSubjectKey(value: string | undefined): string | undefined {
  return normalizeSubjectKey(value)
}
