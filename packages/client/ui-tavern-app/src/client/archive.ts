/** User-visible archive orchestration for the Tavern root. */

import type { ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

/** Dependencies required to archive the route's active Journey. */
export interface ArchiveActiveJourneyDeps {
  readonly sessions: Pick<ISessions, 'clear'>
  readonly archive: (sessionId: SessionId) => Promise<RemoteResult<void>>
  readonly navigateToLibrary: () => void
  /** Current session id, used to avoid clearing another open Journey. */
  readonly currentSessionId: SessionId | undefined
}

const inFlightArchives = new Set<SessionId>()

/** Return whether a Journey archive is still coordinating its route transition.
 *
 * @param sessionId - Journey id to inspect.
 * @returns Whether the archive request has not completed its callbacks.
 */
export function isJourneyArchiveInFlight(sessionId: SessionId): boolean {
  return inFlightArchives.has(sessionId)
}

/**
 * Archive the active Journey and leave the current-session state empty only
 * after the Host confirms durable success. Navigation happens before clearing
 * the current session so the root cannot treat the intentional transition as
 * an invalid Journey route. A failed request preserves the active route and
 * transcript because neither callback runs before success.
 * Archiving a non-current Journey leaves the current session and route alone.
 * @param sessionId - Journey selected by the Tavern route.
 * @param deps - session clear, archive transport, and route transition.
 * @returns a rejected promise when the Host rejects the archive.
 */
export async function archiveActiveJourney(
  sessionId: SessionId,
  deps: ArchiveActiveJourneyDeps,
): Promise<void> {
  inFlightArchives.add(sessionId)
  try {
    const result = await deps.archive(sessionId)
    if (!result.ok) throw new Error(result.error.message)
    if (deps.currentSessionId !== sessionId) return
    deps.navigateToLibrary()
    deps.sessions.clear()
  } finally {
    inFlightArchives.delete(sessionId)
  }
}
