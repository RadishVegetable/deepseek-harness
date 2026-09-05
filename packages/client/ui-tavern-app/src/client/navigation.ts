/** Browser route state owned by the Tavern application root. */

import { useSyncExternalStore } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'

/** Pages supported by the Tavern shell. */
export type TavernRoute =
  | { readonly name: 'library' }
  | { readonly name: 'history' }
  | { readonly name: 'settings' }
  | { readonly name: 'journey'; readonly journeyId: SessionId }

let route: TavernRoute = readRoute()
const listeners = new Set<() => void>()
let browserListenerInstalled = false

function readRoute(): TavernRoute {
  if (typeof window === 'undefined') return { name: 'library' }
  const value = window.location.hash.slice(1)
  if (value === 'history') return { name: 'history' }
  if (value === 'settings') return { name: 'settings' }
  if (value.startsWith('journey/')) {
    let journeyId: string
    try {
      journeyId = decodeURIComponent(value.slice('journey/'.length))
    } catch {
      return { name: 'library' }
    }
    if (journeyId.length > 0) return { name: 'journey', journeyId: journeyId as SessionId }
  }
  return { name: 'library' }
}

function hashFor(next: TavernRoute): string {
  switch (next.name) {
    case 'library': return '#library'
    case 'history': return '#history'
    case 'settings': return '#settings'
    case 'journey': return `#journey/${encodeURIComponent(next.journeyId)}`
  }
}

function emit(): void {
  for (const listener of listeners) listener()
}

function installBrowserListener(): void {
  if (browserListenerInstalled || typeof window === 'undefined') return
  browserListenerInstalled = true
  window.addEventListener('popstate', () => {
    route = readRoute()
    emit()
  })
}

installBrowserListener()

/** Read and subscribe to the current Tavern route.
 *
 * @returns The current route snapshot.
 */
export function useTavernRoute(): TavernRoute {
  return useSyncExternalStore(subscribe, () => route, () => ({ name: 'library' }))
}

/** Navigate the Tavern root without coupling it to another UI shell.
 *
 * @param next The route to publish.
 * @param replace Whether to replace the current browser history entry.
 */
export function navigateTavern(next: TavernRoute, replace = false): void {
  route = next
  if (typeof window !== 'undefined') {
    const method = replace ? 'replaceState' : 'pushState'
    window.history[method]({}, '', hashFor(next))
  }
  emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
