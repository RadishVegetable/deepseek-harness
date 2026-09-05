import { describe, expect, it } from 'vitest'
import {
  collectCharacterEntries,
  isJsonValue,
  isRecord,
  parseJson,
  parseLabeledLines,
  slug,
  suggestedLabels,
} from '../src/index.ts'

describe('@deepseek-ai/dsh-tavern-shared', () => {
  it('creates Unicode slugs and applies explicit fallbacks', () => {
    expect(slug('  赤铜骑士 / A-1  ')).toBe('赤铜骑士-a-1')
    expect(slug('', 'person')).toBe('person')
    expect(slug(null, 'location')).toBe('location')
    expect(slug('---', '')).toBe('item')
  })

  it('parses usable labeled lines and makes fallback behavior explicit', () => {
    expect(parseLabeledLines('Name: Chandra\nInvalid\nNote: value: remains')).toEqual([
      { label: 'Name', value: 'Chandra' },
      { label: 'Note', value: 'value: remains' },
    ])
    expect(parseLabeledLines('plain text')).toEqual([])
    expect(parseLabeledLines('plain text', 'Content')).toEqual([{ label: 'Content', value: 'plain text' }])
    expect(parseLabeledLines('', 'Content')).toEqual([])
  })

  it('collects character entries while retaining the original entries', () => {
    const entries = [
      { id: 'one', content: 'Name: Chandra\nType: character' },
      { id: 'two', content: 'Name: Place\nType: location' },
      { id: 'three', content: 'Name: fallback\nType: location' },
    ]
    expect(collectCharacterEntries(entries).map(({ name, entry }) => ({ name, id: entry.id }))).toEqual([
      { name: 'Chandra', id: 'one' },
    ])
    expect(collectCharacterEntries([entries[1]!], () => [
      { label: 'Name', value: 'Medie' },
      { label: 'Type', value: 'character' },
    ])).toEqual([{ name: 'Medie', entry: entries[1] }])
  })

  it('parses JSON and validates records recursively', () => {
    expect(parseJson('```json\n{"story":"hello"}\n```')).toEqual({ story: 'hello' })
    expect(parseJson('not json')).toBeUndefined()
    expect(parseJson('null')).toBeNull()
    expect(isRecord({ value: 1 })).toBe(true)
    expect(isRecord([])).toBe(false)
    expect(isJsonValue({ nested: [1, 'two', null] })).toBe(true)
    expect(isJsonValue({ bad: Number.NaN })).toBe(false)
    expect(isJsonValue(new Date())).toBe(false)
  })

  it('publishes frozen label suggestions for both source kinds', () => {
    expect(suggestedLabels.character).toContain('秘密')
    expect(suggestedLabels.world).toContain('地理')
    expect(Object.isFrozen(suggestedLabels)).toBe(true)
    expect(Object.isFrozen(suggestedLabels.character)).toBe(true)
  })
})
