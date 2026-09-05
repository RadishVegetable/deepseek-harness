/** Parser for the single model response used by the Tavern GM runtime. */

import type { TavernGmResponse } from './types.ts'
import { isJsonValue, isRecord, parseJson } from '@deepseek-ai/dsh-tavern-shared'

/** Parsed response with the original text retained for fallback display. */
export interface ParsedTavernGmResponse {
  readonly response: TavernGmResponse
  readonly structured: boolean
  readonly raw: string
}

/**
 * Parse a JSON or fenced-JSON GM envelope and fall back to the full story text.
 * @param raw - Complete assistant output returned by the GM model.
 * @returns Parsed story, optional updates, and the original assistant output.
 */
export function parseTavernGmResponse(raw: string): ParsedTavernGmResponse {
  const candidates = [raw.trim(), ...fencedJsonCandidates(raw), ...objectCandidates(raw)]
  for (const candidate of candidates) {
    const parsed = parseJson(candidate)
    if (!isRecord(parsed) || typeof parsed['story'] !== 'string') continue
    const updates = parsed['updates']
    if (updates !== undefined && !isJsonValue(updates)) continue
    const response: TavernGmResponse = updates === undefined
      ? { story: parsed['story'] }
      : { story: parsed['story'], updates }
    return {
      response,
      structured: true,
      raw,
    }
  }
  return { response: { story: raw }, structured: false, raw }
}

function fencedJsonCandidates(raw: string): readonly string[] {
  return [...raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)]
    .map(match => match[1]?.trim())
    .filter((value): value is string => value !== undefined && value.length > 0)
}

function objectCandidates(raw: string): readonly string[] {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  return start >= 0 && end > start ? [raw.slice(start, end + 1)] : []
}
