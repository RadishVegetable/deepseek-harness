import { useSyncExternalStore } from 'react'

/** Top-level page shown by the Tavern surface. */
export type TavernSection = 'home' | 'story'

let section: TavernSection = 'home'
const listeners = new Set<() => void>()

/** Read and subscribe to the shared Tavern top-level page selection.
 * @returns The current top-level Tavern page.
 */
export function useTavernSection(): TavernSection {
  return useSyncExternalStore(subscribe, getSection, getSection)
}

/** Change the shared Tavern top-level page selection.
 * @param next - Page to show at the Tavern root.
 */
export function setTavernSection(next: TavernSection): void {
  if (section === next) return
  section = next
  for (const listener of listeners) listener()
}

function getSection(): TavernSection {
  return section
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
