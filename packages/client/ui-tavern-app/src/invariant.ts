/** Package-owned invariant companion for the Tavern browser root. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-tavern-app'

/** Cordis companion plugin name. */
export const name = 'client-ui-tavern-app-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this browser-only React root owns transient view state and
 * disposable registry contributions, but emits no authoritative event stream or owns
 * any cross-plugin mutable data relation. Session projections and Tavern asset
 * mutations belong to the injected runtime and host services, leaving no package-owned
 * runtime relationship for the invariant registry to observe.
 */
const install: InvariantInstaller = () => {}

/** Register the package invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
