import { describe, expect, it } from 'vitest'

describe('@deepseek-ai/dsh-tavern-context package metadata', () => {
  it('keeps the package Cordis-free at the manifest level', async () => {
    const packageJson = await import('../package.json', { with: { type: 'json' } })
    expect(packageJson.default.peerDependencies).not.toHaveProperty('@deepseek-ai/cordis')
    expect(packageJson.default.devDependencies).not.toHaveProperty('@deepseek-ai/cordis')
  })
})
