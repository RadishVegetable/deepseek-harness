import { describe, expect, it } from 'vitest'
import {
  createDeterministicEmbeddingProvider,
  DEFAULT_EMBEDDING_PROVIDER,
  DETERMINISTIC_EMBEDDING_DIMENSIONS,
  DETERMINISTIC_EMBEDDING_MODEL,
  DETERMINISTIC_EMBEDDING_VERSION,
  DeterministicEmbeddingProvider,
  embedMemoryText,
} from '../src/index.ts'
import type { EmbeddingProvider } from '../src/types.ts'

describe('Tavern memory deterministic embeddings', () => {
  it('returns stable normalized vectors with model and version metadata', () => {
    const provider = new DeterministicEmbeddingProvider()
    const first = provider.embed('  Gate Open  ')
    const second = provider.embed('gate open')

    expect(provider.model).toBe(DETERMINISTIC_EMBEDDING_MODEL)
    expect(provider.version).toBe(DETERMINISTIC_EMBEDDING_VERSION)
    expect(first).toEqual(second)
    expect(first).toHaveLength(DETERMINISTIC_EMBEDDING_DIMENSIONS)
    expect(first.every(Number.isFinite)).toBe(true)
    expect(Math.hypot(...first)).toBeCloseTo(1)
  })

  it('supports an injected provider and keeps the local fallback offline', () => {
    const injected: EmbeddingProvider = {
      model: 'test-model',
      version: 'test-v1',
      embed: text => [text.length],
    }

    expect(embedMemoryText('abc', injected)).toEqual([3])
    expect(embedMemoryText('abc')).toEqual(DEFAULT_EMBEDDING_PROVIDER.embed('abc'))
    expect(createDeterministicEmbeddingProvider({ dimensions: 3 }).embed('abc')).toHaveLength(3)
  })

  it('rejects invalid provider metadata and dimensions', () => {
    expect(() => new DeterministicEmbeddingProvider({ model: ' ' })).toThrow(/model must be non-empty/iu)
    expect(() => new DeterministicEmbeddingProvider({ version: '' })).toThrow(/version must be non-empty/iu)
    expect(() => new DeterministicEmbeddingProvider({ dimensions: 0 })).toThrow(/dimensions must be .*positive/iu)
  })
})
