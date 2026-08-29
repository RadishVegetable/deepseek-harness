/** Resolve Tavern template macros without exposing them to Harness interpolation. */

/** Names available to Tavern Character Card and World Info text. */
export interface TavernMacroContext {
  /** Character name used for the `char` macro. */
  readonly characterName: string
  /** User name used for the `user` macro; defaults to `User`. */
  readonly userName?: string
}

const TAVERN_MACRO = /\{\{([\s\S]*?)\}\}/g

/**
 * Resolve supported Tavern macros and downgrade other complete macros to
 * single-braced authored text before Harness prompt interpolation.
 * @param text - Character Card or World Info text.
 * @param context - Names available to supported Tavern macros.
 * @returns Text with no complete double-braced macro references.
 */
export function renderTavernMacros(text: string, context: TavernMacroContext): string {
  const userName = context.userName ?? 'User'
  const resolved = text.replace(TAVERN_MACRO, (_reference, rawName: string) => {
    const name = rawName.trim().toLowerCase()
    if (name === 'char') return context.characterName
    if (name === 'user') return userName
    return `{${rawName.replaceAll('{', '').replaceAll('}', '')}}`
  })
  return resolved.replaceAll('{{', '{').replaceAll('}}', '}')
}
