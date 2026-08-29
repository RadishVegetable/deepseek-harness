/** Package-owned invariant companion for the Cordis-free Tavern compatibility package. */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tavern-compat'

/** Cordis companion plugin name. */
export const name = 'tavern-compat-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package owns pure parsing and matching functions;
 * their accepted formats and normalized values are checked by package tests.
 */
const install: InvariantInstaller = () => {}

/**
 * Register the package-owned invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
