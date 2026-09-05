/** Browser half of the Tavern-owned application root. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import tavernAssetsRemote from '@deepseek-ai/dsh-tavern-host/remote'
import { TavernApp } from './TavernApp.tsx'
import { TavernJourney } from './TavernJourney.tsx'
import { en, NS, zh } from './locales.ts'
import type { TavernAssetsRemote } from './remote.ts'
import { registerTavernConversation } from './tavern-conversation.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** The current Tavern Journey body, owned by the Tavern root. */
    'tavern.journey': {
      kind: 'single'
      scope: 'session-maybe'
      owner: {
        route: 'library' | 'journey'
        journeyId?: SessionId
        /** Called after the Journey archive is durable and the route has changed. */
        onArchiveSuccess?: () => void
        /** Navigate to the Tavern library and clear transient navigation notices. */
        onNavigateToLibrary: () => void
      }
      inject: { tavernAssets: TavernAssetsRemote; sessions: ISessions }
    }
  }
}

/** Services required by the Tavern browser root. */
export const inject = ['slots', 'sessions', 'remote', 'locale', 'conversationEvents', 'conversationViews']

/** Register the single Tavern-owned root and its session-aware Journey child. */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  registerTavernConversation(ctx)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-tavern-app: dictionaries')
  const disposeRemote = await ctx.remote.$mount(tavernAssetsRemote)
  const tavernAssets = ctx.reflect.get('remote.tavernAssets') as TavernAssetsRemote
  const journeyInject = { tavernAssets, sessions: ctx.sessions }
  const disposeRoot = ctx.slots.register({
    name: 'root',
    locale: NS,
    children: { 'tavern.journey': { kind: 'single', scope: 'session-maybe', inject: journeyInject } },
    inject: () => ({ tavernAssets, sessions: ctx.sessions, locale: ctx.locale }),
  }, TavernApp)
  const disposeJourney = ctx.slots.register({ name: 'tavern.journey', locale: NS }, TavernJourney)
  return async () => {
    disposeJourney()
    disposeRoot()
    await disposeRemote()
  }
}

export type { TavernAssetsRemote } from './remote.ts'
export { archiveActiveJourney } from './archive.ts'
