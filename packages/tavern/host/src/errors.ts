/** Structured failures exposed by Tavern Host Remote operations. */

import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Stable archive-history failure categories. */
export type TavernHistoryArchiveErrorCode =
  | 'history-archive-unavailable'
  | 'history-already-archived'
  | 'history-not-found'

/** Machine-readable failure raised by history archive and inspection operations. */
export class TavernHistoryArchiveError extends Error {
  /** Stable failure category for the Remote caller. */
  readonly code: TavernHistoryArchiveErrorCode
  /** Session identity involved in the failed operation. */
  readonly details: { readonly sessionId: SessionId }

  /**
   * @param code - Stable archive failure category.
   * @param sessionId - Session identity involved in the failure.
   * @param message - Human-readable failure detail.
   */
  constructor(code: TavernHistoryArchiveErrorCode, sessionId: SessionId, message: string) {
    super(message)
    this.name = 'TavernHistoryArchiveError'
    this.code = code
    this.details = { sessionId }
  }
}
