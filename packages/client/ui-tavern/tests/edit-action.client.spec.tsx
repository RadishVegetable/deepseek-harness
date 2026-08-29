// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { TavernAssetsRemote } from '../src/client/index.ts'
import { TavernEditAction } from '../src/client/TavernEditAction.tsx'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function translate(key: string): string {
  return en[key as keyof typeof en] ?? key
}

describe('TavernEditAction', () => {
  it('saves edited text through the Tavern Remote and closes the editor', async () => {
    const editMessage = vi.fn(async (_sessionId: SessionId, _input: { targetSeq: number; text: string }) => ({
      ok: true as const,
      value: { targetSeq: 7 },
    }))

    render(<TavernEditAction
      seq={7}
      text="Original question"
      sessionId={'edit-session' as SessionId}
      tavernAssets={{ editMessage } as unknown as TavernAssetsRemote}
      t={translate}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Message text' }), {
      target: { value: 'Revised question' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save edit' }))

    await waitFor(() => {
      expect(editMessage).toHaveBeenCalledWith('edit-session', {
        targetSeq: 7,
        text: 'Revised question',
      })
    })
    await waitFor(() => {
      expect(screen.queryByRole('textbox', { name: 'Message text' })).toBeNull()
    })
  })

  it('keeps the editor open and shows an error when the Remote rejects', async () => {
    const editMessage = vi.fn(async () => ({
      ok: false as const,
      error: { message: 'offline' },
    }))

    render(<TavernEditAction
      seq={7}
      text="Original question"
      sessionId={'edit-session' as SessionId}
      tavernAssets={{ editMessage } as unknown as TavernAssetsRemote}
      t={translate}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save edit' }))

    expect((await screen.findByRole('status')).textContent).toBe('Edit failed')
    expect(screen.getByRole('textbox', { name: 'Message text' })).toBeTruthy()
  })
})
