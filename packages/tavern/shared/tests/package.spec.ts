import { describe, expect, it } from 'vitest'

describe('@deepseek-ai/dsh-tavern-shared package metadata', () => {
  it('has no Cordis, persistence, model, or UI dependency', async () => {
    const packageJson = await import('../package.json', { with: { type: 'json' } })
    expect(packageJson.default.peerDependencies).not.toHaveProperty('@deepseek-ai/cordis')
    expect(Object.hasOwn(packageJson.default, 'dependencies')).toBe(false)
  })
})
