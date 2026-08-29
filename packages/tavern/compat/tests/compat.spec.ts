import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  extractCharacterCardJson,
  matchesWorldInfoEntry,
  parseCharacterCard,
  parseCharacterCardPng,
  parseWorldInfo,
  renderTavernMacros,
  selectWorldInfoEntries,
} from '../src/index.ts'

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type)
  const result = new Uint8Array(12 + data.length)
  const view = new DataView(result.buffer)
  view.setUint32(0, data.length)
  result.set(typeBytes, 4)
  result.set(data, 8)
  view.setUint32(8 + data.length, crc32(result.subarray(4, 8 + data.length)))
  return result
}

function pngWithText(keyword: string, value: string, type = 'tEXt', compressed = false): Uint8Array {
  const text = type === 'iTXt'
    ? new Uint8Array([
      ...new TextEncoder().encode(keyword),
      0,
      compressed ? 1 : 0,
      0,
      0,
      0,
      ...new TextEncoder().encode(value),
    ])
    : new TextEncoder().encode(`${keyword}\0${value}`)
  const end = chunk('IEND', new Uint8Array())
  const body = chunk(type, text)
  const result = new Uint8Array(PNG_SIGNATURE.length + body.length + end.length)
  result.set(PNG_SIGNATURE)
  result.set(body, PNG_SIGNATURE.length)
  result.set(end, PNG_SIGNATURE.length + body.length)
  return result
}

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff
  for (const byte of bytes) {
    value ^= byte
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) === 1 ? 0xedb88320 : 0)
  }
  return (value ^ 0xffffffff) >>> 0
}

async function fixture(name: string): Promise<string> {
  return readFile(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8')
}

describe('Character Card compatibility parser', () => {
  it('resolves supported macros and removes double-braced unknown macros', () => {
    expect(renderTavernMacros(
      '{{char}}/{{CHAR}}/{{ user }}/{{unsupported_macro}}/{{{nested}}}',
      { characterName: 'Aria Vale' },
    )).toBe('Aria Vale/Aria Vale/User/{unsupported_macro}/{nested}')
  })

  it('normalizes the V3 data form while retaining raw and unknown fields', async () => {
    const input = await fixture('character-card-v3.json')
    const card = parseCharacterCard(input)

    expect(card.spec).toBe('chara_card_v3')
    expect(card.specVersion).toBe('3.0')
    expect(card.name).toBe('Yes, My Liege')
    expect(card.description).toBe('A kingdom in danger.')
    expect(card.alternateGreetings).toEqual(['The council is assembled.'])
    expect(card.characterBook?.entries[0]?.keys).toEqual(['Florin'])
    expect(card.unknown.top_level_unknown).toBe('preserve me')
    expect(card.dataUnknown.unknown_data_field).toEqual({ keep: true })
    expect(card.characterBook?.entries[0]?.unknown.unknown_entry_field).toBe('preserve me')
    expect(card.raw).toEqual(JSON.parse(input))
    expect(card.rawJson).toBe(input)
  })

  it('accepts legacy top-level character fields when data is absent', () => {
    const card = parseCharacterCard({
      name: 'Legacy',
      description: 'Description',
      first_mes: 'Hello',
      tags: ['legacy'],
      extension_field: 4,
    })

    expect(card.name).toBe('Legacy')
    expect(card.firstMessage).toBe('Hello')
    expect(card.tags).toEqual(['legacy'])
    expect(card.unknown.extension_field).toBe(4)
    expect(card.spec).toBeUndefined()
  })

  it('extracts a Character Card from an uncompressed PNG tEXt chunk', () => {
    const input = JSON.stringify({ spec: 'chara_card_v2', data: { name: 'PNG Card', description: 'Embedded' } })
    const png = pngWithText('chara', base64(input))

    expect(extractCharacterCardJson(png)).toBe(input)
    expect(parseCharacterCardPng(png)).toMatchObject({ name: 'PNG Card', description: 'Embedded', rawJson: input })
  })

  it('extracts an uncompressed PNG iTXt chunk and rejects compressed metadata', () => {
    const input = JSON.stringify({ name: 'iTXt Card' })
    const encoded = base64(input)
    expect(extractCharacterCardJson(pngWithText('chara', encoded, 'iTXt'))).toBe(input)
    expect(() => parseCharacterCardPng(pngWithText('ignored', '', 'tEXt'))).toThrow(/does not contain a supported chara/)
    expect(() => extractCharacterCardJson(pngWithText('chara', encoded, 'iTXt', true))).toThrow(/Compressed Character Card iTXt/)
  })
})

function base64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64')
}

describe('World Info compatibility parser', () => {
  it('normalizes a full YMLv2 numeric-key document with scan and activation controls', () => {
    const entries = Object.fromEntries(Array.from({ length: 29 }, (_, index) => {
      const uid = index + 1
      return [String(uid), {
        uid,
        key: [`entry-${uid}`],
        content: `Entry ${uid}`,
        depth: 4,
        probability: uid === 1 ? 35 : 100,
        useProbability: true,
        group: uid === 26 ? 'royal-court' : '',
        sticky: uid === 26 ? 2 : null,
        cooldown: uid === 26 ? 1 : null,
      }]
    }))
    const world = parseWorldInfo({
      entries,
      scan_depth: 50,
      token_budget: 2000,
    })

    expect(world.entries).toHaveLength(29)
    expect(world.scanDepth).toBe(50)
    expect(world.tokenBudget).toBe(2000)
    expect(world.entries[0]).toMatchObject({
      probability: 35,
      useProbability: true,
      depth: 4,
    })
    expect(world.entries[25]).toMatchObject({
      group: 'royal-court',
      sticky: 2,
      cooldown: 1,
    })
  })

  it('normalizes numeric-key entries in stable numeric order and keeps unknown fields', async () => {
    const input = await fixture('world-info-object.json')
    const world = parseWorldInfo(input)

    expect(world.name).toBe('YMLv2')
    expect(world.entries.map(entry => entry.uid)).toEqual([2, 10])
    expect(world.entries[0]?.constant).toBe(true)
    expect(world.entries[1]?.secondaryKeys).toEqual(['General'])
    expect(world.entries[1]?.unknown.unknown_entry_field).toBe('preserve me')
    expect(world.unknown.unknown_world_field).toBe(true)
    expect(world.raw).toEqual(JSON.parse(input))
    expect(world.rawJson).toBe(input)
  })

  it('accepts array entries and maps common YMLv2 and Tavern aliases', async () => {
    const world = parseWorldInfo(await fixture('world-info-array.json'))
    const entry = world.entries[0]

    expect(entry).toMatchObject({
      uid: 3,
      keys: ['dragon'],
      secondaryKeys: ['fire'],
      enabled: true,
      position: 'after_char',
      insertionOrder: 3,
      probability: 50,
      useRegex: false,
    })
  })

  it('retains numeric legacy insertion positions for the Host adapter', () => {
    const world = parseWorldInfo({
      entries: {
        zero: { uid: 0, key: ['zero'], content: 'zero', position: 0 },
        one: { uid: 1, key: ['one'], content: 'one', position: 1 },
        two: { uid: 2, key: ['two'], content: 'two', position: 2 },
        three: { uid: 3, key: ['three'], content: 'three', position: 3 },
        six: { uid: 6, key: ['six'], content: 'six', position: 6 },
      },
    })

    expect(new Set(world.entries.map(entry => entry.position))).toEqual(new Set([0, 1, 2, 3, 6]))
  })
})

describe('deterministic World Info matching', () => {
  const base = {
    uid: 1,
    id: '1',
    sourceKey: '1',
    keys: ['king'],
    secondaryKeys: [],
    content: 'content',
    enabled: true,
    constant: false,
    selective: false,
    position: 'before_char',
    insertionOrder: 1,
    probability: 100,
    useRegex: false,
    matchWholeWords: false,
    caseSensitive: false,
    useProbability: false,
    raw: {},
    unknown: {},
  } as const

  it('matches substrings by default and whole words when enabled', () => {
    expect(matchesWorldInfoEntry({ ...base }, 'the kingdom')).toBe(true)
    expect(matchesWorldInfoEntry({ ...base, matchWholeWords: true }, 'the kingdom')).toBe(false)
    expect(matchesWorldInfoEntry({ ...base, matchWholeWords: true }, 'the king arrived')).toBe(true)
  })

  it('requires a secondary key for selective entries', () => {
    const entry = { ...base, selective: true, secondaryKeys: ['court'] }
    expect(matchesWorldInfoEntry(entry, 'the king arrived')).toBe(false)
    expect(matchesWorldInfoEntry(entry, 'the king entered the court')).toBe(true)
  })

  it('supports regex entries and throws on invalid regex', () => {
    expect(matchesWorldInfoEntry({ ...base, keys: ['k.ng'], useRegex: true }, 'the king')).toBe(true)
    expect(() => matchesWorldInfoEntry({ ...base, keys: ['['], useRegex: true }, 'text')).toThrow(/invalid regular expression/i)
  })

  it('filters disabled entries and returns stable order without random probability', async () => {
    const world = parseWorldInfo(await fixture('world-info-object.json'))
    const selected = selectWorldInfoEntries(world.entries, 'Florin and Chandra General')
    expect(selected.map(entry => entry.uid)).toEqual([10, 2])
    expect(selectWorldInfoEntries([{ ...base, enabled: false }], 'king')).toEqual([])
  })

  it('applies probability only through an explicit deterministic roll', () => {
    const entry = { ...base, useProbability: true, probability: 25 }
    expect(() => matchesWorldInfoEntry(entry, 'the king')).toThrow(/probabilityRoll/)
    expect(matchesWorldInfoEntry(entry, 'the king', { probabilityRoll: 24.99 })).toBe(true)
    expect(matchesWorldInfoEntry(entry, 'the king', { probabilityRoll: 25 })).toBe(false)
    expect(matchesWorldInfoEntry({ ...entry, probability: 0 }, 'the king', { probabilityRoll: 0 })).toBe(false)
  })
})
