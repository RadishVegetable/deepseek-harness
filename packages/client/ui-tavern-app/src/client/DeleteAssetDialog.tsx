import { useRef } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import css from './TavernApp.module.css'
import { useTavernDialogFocus } from './useTavernDialogFocus.ts'

/** Confirmation surface for deleting one reusable Tavern source asset. */
export function DeleteAssetDialog({
  assetName,
  assetType,
  busy,
  error,
  onCancel,
  onConfirm,
  t,
}: {
  readonly assetName: string
  readonly assetType: string
  readonly busy: boolean
  readonly error: string | null
  readonly onCancel: () => void
  readonly onConfirm: () => void
  readonly t: TranslateNS<typeof NS>
}) {
  const cancelButton = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLElement>(null)

  useTavernDialogFocus(dialog, cancelButton, onCancel, !busy)

  return <div className={css.scrim} role="presentation"><section ref={dialog} tabIndex={-1} className={css.dialog} role="dialog" aria-modal="true" aria-labelledby="asset-delete-dialog-title" aria-describedby="asset-delete-dialog-copy"><p className={css.eyebrow}>{t('assetDelete.eyebrow')}</p><h2 id="asset-delete-dialog-title">{t('assetDelete.title')}</h2><p id="asset-delete-dialog-copy" className={css.dialogIntro}>{t('assetDelete.description', { type: assetType, name: assetName })}</p>{error !== null && <p className={css.error} role="alert">{error}</p>}<div className={css.dialogActions}><button ref={cancelButton} className={css.secondaryButton} type="button" disabled={busy} onClick={onCancel}>{t('assetDelete.cancel')}</button><button className={css.dangerButton} type="button" disabled={busy} onClick={onConfirm}>{busy ? t('assetDelete.deleting') : t('assetDelete.confirm')}</button></div></section></div>
}
