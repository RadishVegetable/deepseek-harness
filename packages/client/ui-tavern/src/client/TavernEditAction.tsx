import { useState, type ReactElement } from 'react'
import { IconCheckOutline16, IconCloseOutline16, IconEditOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { UserActionOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { TavernAssetsRemote } from './index.ts'
import css from './TavernEditAction.module.css'

/** Compact inline editor for one direct Tavern user message. */
export function TavernEditAction({ seq, text, sessionId, tavernAssets, t }: UserActionOwnerProps & PropsLocale<'tavern'> & {
  sessionId: SessionId
  tavernAssets: TavernAssetsRemote
}): ReactElement {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(text)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)

  const begin = (): void => {
    setDraft(text)
    setError(false)
    setEditing(true)
  }
  const cancel = (): void => {
    if (busy) return
    setError(false)
    setEditing(false)
  }
  const save = (): void => {
    const next = draft.trim()
    if (next.length === 0 || busy) return
    setBusy(true)
    setError(false)
    void tavernAssets.editMessage(sessionId, { targetSeq: seq, text: next }).then((result) => {
      if (!result.ok) {
        setError(true)
        return
      }
      setEditing(false)
    }).catch(() => {
      setError(true)
    }).finally(() => {
      setBusy(false)
    })
  }

  if (!editing) {
    return (
      <Tooltip label={t('message.edit')} side="bottom">
        <button type="button" className={css.action} aria-label={t('message.edit')} onClick={begin}>
          <IconEditOutline16 />
        </button>
      </Tooltip>
    )
  }

  return (
    <span className={css.editor} data-tavern-message-editor>
      <textarea
        className={css.input}
        aria-label={t('message.editInput')}
        value={draft}
        rows={2}
        disabled={busy}
        onChange={(event) => { setDraft(event.target.value) }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') cancel()
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) save()
        }}
      />
      <span className={css.buttons}>
        <Tooltip label={t('message.editSave')} side="bottom">
          <button type="button" className={css.action} aria-label={t('message.editSave')} disabled={busy || draft.trim().length === 0} onClick={save}>
            <IconCheckOutline16 />
          </button>
        </Tooltip>
        <Tooltip label={t('message.editCancel')} side="bottom">
          <button type="button" className={css.action} aria-label={t('message.editCancel')} disabled={busy} onClick={cancel}>
            <IconCloseOutline16 />
          </button>
        </Tooltip>
      </span>
      {error && <span className={css.error} role="status">{t('message.editFailed')}</span>}
    </span>
  )
}
