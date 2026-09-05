import { useRef } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import css from './TavernApp.module.css'
import { useTavernDialogFocus } from './useTavernDialogFocus.ts'

/** Confirmation surface for the reversible Journey archive action. */
export function ArchiveDialog({
  title,
  busy,
  error,
  onCancel,
  onConfirm,
  t,
}: {
  readonly title: string
  readonly busy: boolean
  readonly error: string | null
  readonly onCancel: () => void
  readonly onConfirm: () => void
  readonly t: TranslateNS<typeof NS>
}) {
  const cancelButton = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLElement>(null)

  useTavernDialogFocus(dialog, cancelButton, onCancel, !busy)

  return <div className={css.scrim} role="presentation"><section ref={dialog} tabIndex={-1} className={css.dialog} role="dialog" aria-modal="true" aria-labelledby="archive-dialog-title" aria-describedby="archive-dialog-copy"><p className={css.eyebrow}>{t('archive.eyebrow')}</p><h2 id="archive-dialog-title">{t('archive.title')}</h2><p id="archive-dialog-copy" className={css.dialogIntro}>{t('archive.description', { title })}</p>{error !== null && <p className={css.error} role="alert">{error}</p>}<div className={css.dialogActions}><button ref={cancelButton} className={css.secondaryButton} type="button" disabled={busy} onClick={onCancel}>{t('archive.keep')}</button><button className={css.primaryButton} type="button" disabled={busy} onClick={onConfirm}>{busy ? t('archive.archiving') : t('archive.confirm')}</button></div></section></div>
}
