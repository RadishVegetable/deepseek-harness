/** Package-owned invariant companion for the Cordis-free Tavern context package. */

const PACKAGE_NAME = '@deepseek-ai/dsh-tavern-context'

interface InvariantContext {
  readonly invariants: {
    register(packageName: string, install: () => void): () => void
  }
}

/** Companion plugin name used by the package invariant loader. */
export const name = 'tavern-context-invariant'

/** Required service key for the structural invariant companion. */
export const inject = ['invariants'] as const

/**
 * No runtime invariant: this pure package owns no event stream or mutable
 * runtime data; its filtering algebra is enforced by public-interface tests.
 */
const install = (): void => {}

/**
 * Register the package-owned invariant companion.
 * @param ctx - context-like object exposing the invariant registry.
 * @returns the registry disposer after setup.
 */
export const apply = (ctx: InvariantContext): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
