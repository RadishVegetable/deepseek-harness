// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { ArchiveDialog } from '../src/client/ArchiveDialog.tsx'
import { en, NS, type TavernAppKey } from '../src/client/locales.ts'

afterEach(() => { cleanup() })

const t = ((key: TavernAppKey) => en[key]) as TranslateNS<typeof NS>

describe('Tavern archive confirmation', () => {
  it('closes on Escape without confirming the archive', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()

    render(<ArchiveDialog title="Aster" busy={false} error={null} onCancel={onCancel} onConfirm={onConfirm} t={t} />)
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onCancel).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('keeps both actions disabled while the archive request is pending', () => {
    render(<ArchiveDialog title="Aster" busy error={null} onCancel={vi.fn()} onConfirm={vi.fn()} t={t} />)

    expect(screen.getByRole('button', { name: 'Keep Journey' }).getAttribute('disabled')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Archiving...' }).getAttribute('disabled')).not.toBeNull()
  })
})
