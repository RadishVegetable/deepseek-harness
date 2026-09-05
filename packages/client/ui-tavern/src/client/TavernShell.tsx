/** Root-level Tavern chrome for the dedicated roleplay profile. */

import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconCheckOutline16,
  IconLoadingOutline16,
  IconRefreshOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { useMemo } from 'react'
import './design-tokens.module.css'
import css from './TavernShell.module.css'
import { setTavernSection, useTavernSection } from './navigation.ts'

type TavernShellProps = PropsRuntime<'tavern'> & PropsLocale<'tavern'>

/** Render the small Tavern navigation above the shared Conversation surface. */
export function TavernShell({ useSessions, useWorkspaces, t }: TavernShellProps) {
  const sessionList = useSessions(snapshot => snapshot)
  const workspaces = useWorkspaces(snapshot => snapshot)
  const sessions = useMemo(() => sessionList.ids
    .map(id => sessionList.byId[id])
    .filter((summary): summary is NonNullable<typeof summary> => summary?.agentPreset === 'tavern'), [sessionList])
  const current = sessions.find(session => session.id === sessionList.current)?.id ?? sessions[0]?.id ?? ''
  const currentSession = current === '' ? undefined : sessionList.byId[current]
  const pending = sessionList.phase !== 'ready' || workspaces.phase !== 'ready'
  const status = pending ? 'pending' : currentSession?.running === true ? 'running' : 'ready'
  const section = useTavernSection()

  return (
    <header className={`${css.root} tavernLegacyRoot`} data-tavern-shell="" data-tavern-status={status}>
      <div className={css.brandCluster}>
        <div className={css.brand}>
          <span className={css.mark} aria-hidden="true">T</span>
          <strong>{t('shell.brand')}</strong>
        </div>
        <span className={css.divider} aria-hidden="true" />
        <span className={css.mode}>{t('workspace.direct')}</span>
      </div>
      <nav className={css.navigation} aria-label={t('navigation.title')}>
        <button
          type="button"
          className={section === 'home' ? css.navActive : css.navButton}
          aria-current={section === 'home' ? 'page' : undefined}
          onClick={() => { setTavernSection('home') }}
        >{t('navigation.home')}</button>
        <button
          type="button"
          className={section === 'story' ? css.navActive : css.navButton}
          aria-current={section === 'story' ? 'page' : undefined}
          onClick={() => { setTavernSection('story') }}
        >{t('navigation.story')}</button>
      </nav>
      <div className={css.actions}>
        <div className={css.connection} role="status" aria-live="polite">
          <span className={css.statusDot} aria-hidden="true" />
          <span>{pending ? t('shell.starting') : t('shell.ready')}</span>
        </div>
        {pending && <span className={css.loadingIcon} aria-hidden="true"><IconLoadingOutline16 /></span>}
        {!pending && sessions.length === 0 && <span className={css.loadingIcon} aria-hidden="true"><IconRefreshOutline16 /></span>}
        {currentSession !== undefined && !currentSession.blank && <span className={css.readyIcon} aria-hidden="true"><IconCheckOutline16 /></span>}
      </div>
    </header>
  )
}
