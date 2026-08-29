/** Errors raised while validating or resolving Tavern assets. */

/** Stable error codes exposed by the asset registry. */
export type AssetRegistryErrorCode =
  | 'invalid-id'
  | 'invalid-name'
  | 'invalid-version'
  | 'invalid-source-reference'
  | 'invalid-asset'
  | 'duplicate-id'
  | 'duplicate-entry-id'
  | 'duplicate-selection-id'
  | 'asset-not-found'
  | 'invalid-selection'

/** Error carrying a machine-readable asset registry failure code. */
export class AssetRegistryError extends Error {
  /** Stable classification for callers and tests. */
  readonly code: AssetRegistryErrorCode

  /**
   * @param code - Stable failure classification.
   * @param message - Human-readable diagnostic.
   */
  constructor(code: AssetRegistryErrorCode, message: string) {
    super(message)
    this.name = 'AssetRegistryError'
    this.code = code
  }
}
