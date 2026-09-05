/** Package-owned invariant companion for the Tavern memory helpers. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { stableFingerprint } from './inject.ts'
import type {} from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-tavern-memory'

/** Cordis companion plugin name. */
export const name = 'tavern-memory-invariant'
/** Service required by the invariant companion. */
export const inject = ['invariants']

/** Validate one durable memory injection snapshot before consumers use it. */
function validateSnapshot(event: SessionEvent<'tavern/memory-context'>, fail: InvariantFailure): void {
  const { data } = event
  if (data.branch.trim().length === 0) fail('tavern/memory-context branch must be non-empty')
  const expectedContent = [data.staticText, data.dynamicText].filter(value => value.length > 0).join('\n\n')
  if (data.content !== expectedContent) fail('tavern/memory-context content must equal its static and dynamic sections')
  if (data.fingerprint !== stableFingerprint(data.content)) fail('tavern/memory-context fingerprint does not match content')
  let previous = -1
  const seen = new Set<number>()
  for (const seq of data.factSeqs) {
    if (!Number.isSafeInteger(seq) || seq < 0 || seq <= previous || seen.has(seq)) {
      fail('tavern/memory-context factSeqs must be sorted unique non-negative integers')
    }
    previous = seq
    seen.add(seq)
  }
}

/** Install the model-visible memory snapshot checks. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const validate = (_session: Session, event: SessionEvent): void => {
    if (event.type === 'tavern/memory-context') validateSnapshot(event, fail)
  }
  for (const session of ctx.sessions.list()) {
    for (const event of session.events) validate(session, event)
  }
  ctx.on('session/event', validate, { global: true })
}, { inject: ['sessions'] })

/** Register the package invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
