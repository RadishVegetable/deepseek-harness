/** Package-owned invariant companion for the Tavern Host runtime. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tavern-host'

/** Cordis companion plugin name. */
export const name = 'tavern-host-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: Host behavior is a service facade over Tavern session
 * events and agent lifecycle hooks; its relations are exercised through those
 * public seams by the Host tests.
 */
const install: InvariantInstaller = () => {}

/**
 * Register the package-owned invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
