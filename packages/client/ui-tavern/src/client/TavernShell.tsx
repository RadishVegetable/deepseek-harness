/** Root-level Tavern chrome for the dedicated roleplay profile. */

import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconCheckOutline16,
  IconChevronDownOutline14,
  IconLoadingOutline16,
  IconPlusOutline16,
  IconRefreshOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { useMemo } from 'react'
import css from './TavernShell.module.css'

type TavernShellProps = PropsRuntime<'tavern'> & PropsLocale<'tavern'> & {
  openSession: (sessionId: SessionId) => void
  createSession: () => void
}

/** Render Tavern navigation above the shared Conversation surface. */
export function TavernShell({ useSessions, useWorkspaces, t, openSession, createSession }: TavernShellProps) {
  const sessionList = useSessions(snapshot => snapshot)
  const workspaces = useWorkspaces(snapshot => snapshot)
  const sessions = useMemo(() => sessionList.ids
    .map(id => sessionList.byId[id])
    .filter((summary): summary is NonNullable<typeof summary> => summary?.agentPreset === 'tavern'), [sessionList])
  const current = sessions.find(session => session.id === sessionList.current)?.id ?? sessions[0]?.id ?? ''
  const currentSession = current === '' ? undefined : sessionList.byId[current]
  const pending = sessionList.phase !== 'ready' || workspaces.phase !== 'ready'
  const status = pending ? 'pending' : currentSession?.running === true ? 'running' : 'ready'

  return (
    <header className={css.root} data-tavern-shell="" data-tavern-status={status}>
      <div className={css.brandCluster}>
        <div className={css.brand}>
          <span className={css.mark} aria-hidden="true">T</span>
          <strong>TAVERN</strong>
        </div>
        <span className={css.divider} aria-hidden="true" />
        <span className={css.mode}>{t('workspace.direct')}</span>
      </div>
      <div className={css.actions}>
        <div className={css.connection} role="status" aria-live="polite">
          <span className={css.statusDot} aria-hidden="true" />
          <span>{pending ? t('shell.starting') : t('shell.ready')}</span>
        </div>
        <label className={css.sessionPicker}>
          <span className={css.sessionLabel}>{t('status.session')}</span>
          <select
            className={css.select}
            value={current}
            aria-label={t('status.session')}
            onChange={(event) => { openSession(event.target.value as SessionId) }}
            disabled={sessions.length === 0}
          >
            {sessions.length === 0 && <option value="">{t('shell.noSession')}</option>}
            {sessions.map(session => <option key={session.id} value={session.id}>{session.displayTitle}</option>)}
          </select>
          <span className={css.selectIcon} aria-hidden="true"><IconChevronDownOutline14 /></span>
        </label>
        <button
          type="button"
          className={css.newButton}
          title={t('shell.newSession')}
          onClick={createSession}
          disabled={workspaces.phase !== 'ready'}
        >
          <span aria-hidden="true"><IconPlusOutline16 /></span>
          <span>{t('shell.newSession')}</span>
        </button>
        {pending && <span className={css.loadingIcon} aria-hidden="true"><IconLoadingOutline16 /></span>}
        {!pending && sessions.length === 0 && <span className={css.loadingIcon} aria-hidden="true"><IconRefreshOutline16 /></span>}
        {currentSession !== undefined && !currentSession.blank && <span className={css.readyIcon} aria-hidden="true"><IconCheckOutline16 /></span>}
      </div>
    </header>
  )
}
