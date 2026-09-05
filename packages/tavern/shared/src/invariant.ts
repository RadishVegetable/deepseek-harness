/** Package-owned invariant companion for the Cordis-free Tavern shared package. */

const PACKAGE_NAME = '@deepseek-ai/dsh-tavern-shared'

interface InvariantContext {
  readonly invariants: {
    register(packageName: string, install: () => void): () => void
  }
}

/** Companion plugin name used by the package invariant loader. */
export const name = 'tavern-shared-invariant'

/** Required service key for the structural invariant companion. */
export const inject = ['invariants'] as const

/**
 * No runtime invariant: this package owns pure value functions and has no event stream or mutable runtime data.
 */
const install = (): void => {}

/**
 * Register the package-owned invariant companion.
 * @param ctx - Context-like object exposing the invariant registry.
 * @returns The registry disposer after setup.
 */
export const apply = (ctx: InvariantContext): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
