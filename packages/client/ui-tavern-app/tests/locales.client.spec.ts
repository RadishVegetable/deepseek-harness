import { describe, expect, it } from 'vitest'
import { en, NS, zh } from '../src/client/locales.ts'

describe('Tavern locale dictionaries', () => {
  it('keep the English and Chinese dictionaries balanced', () => {
    expect(NS).toBe('tavern.app')
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('cover the language selector and core navigation copy', () => {
    expect(zh['settings.language.aria']).toBe('选择 Tavern 界面语言')
    expect(en['settings.language.aria']).toBe('Choose the Tavern interface language')
    expect(zh['nav.library']).toBe('图书馆')
    expect(en['nav.library']).toBe('Library')
    expect(zh['library.deleteAsset']).toBe('删除{type}“{name}”')
    expect(en['library.deleteAsset']).toBe('Delete {type} “{name}”')
    expect(zh['assetDelete.confirm']).toBe('删除资产')
    expect(en['assetDelete.confirm']).toBe('Delete asset')
  })
})
