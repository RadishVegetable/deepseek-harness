/** Dependency-free text embeddings for derived Tavern memory data. */

import type { EmbeddingProvider } from './types.ts'

/** Stable model label for the local deterministic fallback. */
export const DETERMINISTIC_EMBEDDING_MODEL = 'deterministic'

/** Stable vector-format version for the local deterministic fallback. */
export const DETERMINISTIC_EMBEDDING_VERSION = 'v1'

/** Default vector width used by the local deterministic fallback. */
export const DETERMINISTIC_EMBEDDING_DIMENSIONS = 64

/** Options for a deterministic provider instance. */
export interface DeterministicEmbeddingOptions {
  /** Vector width; changing it produces a different vector format. */
  readonly dimensions?: number
  /** Model label stored beside vectors produced by the instance. */
  readonly model?: string
  /** Vector-format version stored beside vectors produced by the instance. */
  readonly version?: string
}

/**
 * Stable local embedding provider for offline operation and tests.
 *
 * It hashes normalized word and character-bigram features into a fixed-width
 * vector and L2-normalizes the result. It has no network or model-runtime
 * dependency; callers can replace it with any {@link EmbeddingProvider}.
 */
export class DeterministicEmbeddingProvider implements EmbeddingProvider {
  /** Model label written beside each generated vector. */
  readonly model: string
  /** Vector-format version written beside each generated vector. */
  readonly version: string
  /** Number of components in each generated vector. */
  readonly dimensions: number

  /**
   * @param options - Optional labels and vector width for this provider.
   * @throws {@link TypeError} when a label is empty.
   * @throws {@link RangeError} when the vector width is not a positive safe integer.
   */
  constructor(options: DeterministicEmbeddingOptions = {}) {
    this.model = nonEmptyLabel(options.model ?? DETERMINISTIC_EMBEDDING_MODEL, 'embedding model')
    this.version = nonEmptyLabel(options.version ?? DETERMINISTIC_EMBEDDING_VERSION, 'embedding version')
    this.dimensions = positiveDimensions(options.dimensions ?? DETERMINISTIC_EMBEDDING_DIMENSIONS)
  }

  /**
   * Embed text without I/O or mutable provider state.
   * @param text - Text to normalize and vectorize.
   * @returns A new L2-normalized vector, or a zero vector for empty text.
   */
  embed(text: string): readonly number[] {
    const normalized = normalizeEmbeddingText(text)
    const vector = Array<number>(this.dimensions).fill(0)
    if (normalized.length === 0) return vector

    const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? []
    if (words.length === 0) addFeature(vector, normalized, 1)
    for (const word of words) {
      addFeature(vector, `w:${word}`, 1)
      const characters = Array.from(word)
      for (let index = 0; index + 1 < characters.length; index += 1) {
        addFeature(vector, `b:${characters[index]}${characters[index + 1]}`, 0.5)
      }
    }

    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
    return norm === 0 ? vector : vector.map(value => value / norm)
  }
}

/** Default offline provider used when a caller does not inject another one. */
export const DEFAULT_EMBEDDING_PROVIDER: EmbeddingProvider = new DeterministicEmbeddingProvider()

/**
 * Create an independently labeled deterministic provider.
 * @param options - Optional labels and vector width.
 * @returns A deterministic embedding provider.
 */
export function createDeterministicEmbeddingProvider(
  options: DeterministicEmbeddingOptions = {},
): DeterministicEmbeddingProvider {
  return new DeterministicEmbeddingProvider(options)
}

/**
 * Embed text through an injected provider, using the deterministic provider by default.
 * @param text - Text to vectorize.
 * @param provider - Optional replacement embedding provider.
 * @returns The provider-produced vector.
 */
export function embedMemoryText(text: string, provider: EmbeddingProvider = DEFAULT_EMBEDDING_PROVIDER): readonly number[] {
  return provider.embed(text)
}

function normalizeEmbeddingText(text: string): string {
  return text.normalize('NFKC').trim().toLowerCase()
}

function addFeature(vector: number[], feature: string, weight: number): void {
  const hash = hashFeature(feature)
  const index = hash % vector.length
  vector[index] = (vector[index] ?? 0) + ((hash & 0x80000000) === 0 ? weight : -weight)
}

function hashFeature(value: string): number {
  let hash = 2166136261
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function nonEmptyLabel(value: string, name: string): string {
  const normalized = value.trim()
  if (normalized.length === 0) throw new TypeError(`${name} must be non-empty`)
  return normalized
}

function positiveDimensions(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError('embedding dimensions must be a positive safe integer')
  return value
}
