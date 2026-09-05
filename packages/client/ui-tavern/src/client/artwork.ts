/** Static artwork used by the character-first Tavern surface. */

const SECRETARY_PORTRAIT = '/tavern-ui/assets/portrait-secretary.png'
const SECT_SISTER_PORTRAIT = '/tavern-ui/assets/portrait-sect-sister.png'

/** Real scene artwork published with the Web application. */
export const TAVERN_SCENE = '/tavern-ui/assets/scene-tavern.png'

/**
 * Select a real portrait deterministically for a projected character.
 * @param name - Character name used as the stable selection input.
 * @returns Public URL for one Tavern portrait.
 */
export function portraitFor(name: string): string {
  const value = name.trim()
  let hash = 0
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (codePoint !== undefined) hash = (hash * 31 + codePoint) % 2
  }
  return hash === 0 ? SECRETARY_PORTRAIT : SECT_SISTER_PORTRAIT
}
