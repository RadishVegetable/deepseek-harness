/**
 * Source-checkout launcher for the dedicated Tavern Web profile.
 *
 * `pnpm run <script> -- <args...>` leaves the npm separator in argv on some
 * pnpm versions. Remove that one separator before handing the remaining Web
 * arguments to the normal dsh launcher.
 * @module run-tavern
 */

import { applyTavernOpenCodeEnvironment, loadTavernOpenCodeConfig } from './opencode-tavern-config.ts'

applyTavernOpenCodeEnvironment(loadTavernOpenCodeConfig())

const forwarded = process.argv.slice(2)
if (forwarded[0] === '--') forwarded.shift()

process.argv.splice(
  2,
  process.argv.length - 2,
  'web',
  '--patch',
  'packages/bundle/tavern/cordis.patch.yml',
  '--patch',
  'packages/bundle/tavern/opencode.cordis.patch.yml',
  ...forwarded,
)

await import('../apps/cli/src/bin.ts')
