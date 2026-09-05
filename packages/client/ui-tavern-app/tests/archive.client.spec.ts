import { describe, expect, it, vi } from 'vitest'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { archiveActiveJourney, isJourneyArchiveInFlight } from '../src/client/archive.ts'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'

const sessionId = 'session-active' as SessionId

describe('Tavern active Journey archive', () => {
  it('clears the current session and returns to the Tavern library after durable success', async () => {
    const clear = vi.fn()
    const navigateToLibrary = vi.fn()
    const archive = vi.fn(async () => ({ ok: true as const, value: undefined }))
    const order: string[] = []
    clear.mockImplementation(() => { order.push('clear') })
    navigateToLibrary.mockImplementation(() => { order.push('navigate') })

    await archiveActiveJourney(sessionId, { sessions: { clear }, archive, navigateToLibrary, currentSessionId: sessionId })

    expect(archive).toHaveBeenCalledWith(sessionId)
    expect(clear).toHaveBeenCalledOnce()
    expect(navigateToLibrary).toHaveBeenCalledOnce()
    expect(order).toEqual(['navigate', 'clear'])
  })

  it('keeps the active Journey mounted when archive fails', async () => {
    const clear = vi.fn()
    const navigateToLibrary = vi.fn()
    const archive = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'history-archive-unavailable', message: 'WorkspaceRegistry is unavailable', details: {} },
    }))

    await expect(archiveActiveJourney(sessionId, { sessions: { clear }, archive, navigateToLibrary, currentSessionId: sessionId })).rejects.toThrow('WorkspaceRegistry is unavailable')
    expect(clear).not.toHaveBeenCalled()
    expect(navigateToLibrary).not.toHaveBeenCalled()
  })

  it('marks the route transition while the Host archive is pending', async () => {
    let release: ((result: RemoteResult<void>) => void) | undefined
    const archive = vi.fn(() => new Promise<RemoteResult<void>>((resolve) => { release = resolve }))
    const pending = archiveActiveJourney(sessionId, {
      sessions: { clear: vi.fn() },
      archive,
      navigateToLibrary: vi.fn(),
      currentSessionId: sessionId,
    })

    expect(isJourneyArchiveInFlight(sessionId)).toBe(true)
    release?.({ ok: true, value: undefined })
    await pending
    expect(isJourneyArchiveInFlight(sessionId)).toBe(false)
  })

  it('does not clear or navigate when archiving a non-current Journey', async () => {
    const clear = vi.fn()
    const navigateToLibrary = vi.fn()
    const archive = vi.fn(async () => ({ ok: true as const, value: undefined }))

    await archiveActiveJourney('session-other' as SessionId, {
      sessions: { clear },
      archive,
      navigateToLibrary,
      currentSessionId: sessionId,
    })

    expect(archive).toHaveBeenCalledWith('session-other')
    expect(clear).not.toHaveBeenCalled()
    expect(navigateToLibrary).not.toHaveBeenCalled()
  })
})
