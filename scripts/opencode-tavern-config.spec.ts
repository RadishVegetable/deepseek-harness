import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  applyTavernOpenCodeEnvironment,
  loadTavernOpenCodeConfig,
  TAVERN_OPENCODE_ENV,
} from './opencode-tavern-config.ts'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('Tavern OpenCode config', () => {
  it('loads JSONC, resolves an environment key, and selects the configured model', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-tavern-opencode-'))
    temporaryDirectories.push(directory)
    const filename = join(directory, 'opencode.jsonc')
    writeFileSync(filename, `{
      // The project may use ordinary JSONC comments and trailing commas.
      "model": "local-provider/second-model",
      "provider": {
        "local-provider": {
          "name": "Local OpenCode",
          "npm": "@ai-sdk/openai-compatible",
          "options": {
            "baseURL": "http://127.0.0.1:9000/v1",
            "apiKey": { "env": "LOCAL_OPENCODE_KEY" },
            "headers": { "x-workspace": "test" },
          },
          "models": {
            "first-model": { "name": "First" },
            "second-model": { "name": "Second", "limit": { "context": 1000, "output": 200 } },
          },
        },
      },
    }`)

    const result = loadTavernOpenCodeConfig({
      configPath: filename,
      env: { LOCAL_OPENCODE_KEY: 'test-key' },
    })

    expect(result).toEqual({
      sourceProvider: 'local-provider',
      displayName: 'Local OpenCode',
      api: 'openai-completions',
      baseURL: 'http://127.0.0.1:9000/v1',
      apiKey: 'test-key',
      headers: { 'x-workspace': 'test' },
      model: { id: 'second-model', name: 'Second', contextWindow: 1000, maxTokens: 200 },
    })
  })

  it('uses OpenCode managed Zen authentication for the Zen endpoint', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-tavern-opencode-'))
    temporaryDirectories.push(directory)
    const configDirectory = join(directory, 'config', 'opencode')
    const authDirectory = join(directory, '.local', 'share', 'opencode')
    mkdirSync(configDirectory, { recursive: true })
    mkdirSync(authDirectory, { recursive: true })
    writeFileSync(join(configDirectory, 'opencode.jsonc'), `{
      "provider": {
        "tdai-memory": {
          "options": {
            "baseURL": "https://opencode.ai/zen/go/v1",
            "apiKey": "stale-provider-key"
          },
          "models": { "deepseek-v4-flash": { "name": "DeepSeek V4 Flash" } }
        }
      }
    }`)
    writeFileSync(join(authDirectory, 'auth.json'), JSON.stringify({ 'opencode-go': { type: 'api', key: 'managed-zen-key' } }))

    const result = loadTavernOpenCodeConfig({
      configPath: join(configDirectory, 'opencode.jsonc'),
      homeDirectory: directory,
    })

    expect(result.apiKey).toBe('managed-zen-key')
  })

  it('injects only launcher environment values for the overlay', () => {
    const env: NodeJS.ProcessEnv = {}
    applyTavernOpenCodeEnvironment({
      sourceProvider: 'local-provider',
      displayName: 'Local OpenCode',
      api: 'openai-completions',
      baseURL: 'http://127.0.0.1:9000/v1',
      apiKey: 'test-key',
      headers: { 'x-workspace': 'test' },
      model: { id: 'model', name: 'Model' },
    }, env)

    expect(env[TAVERN_OPENCODE_ENV.api]).toBe('openai-completions')
    expect(env[TAVERN_OPENCODE_ENV.enabled]).toBe('1')
    expect(env[TAVERN_OPENCODE_ENV.apiKey]).toBe('test-key')
    expect(env[TAVERN_OPENCODE_ENV.baseURL]).toBe('http://127.0.0.1:9000/v1')
    expect(env[TAVERN_OPENCODE_ENV.headers]).toBe('{"x-workspace":"test"}')
    expect(env[TAVERN_OPENCODE_ENV.model]).toBe('model')
    expect(env[TAVERN_OPENCODE_ENV.displayName]).toBe('Local OpenCode')
    expect(env[TAVERN_OPENCODE_ENV.settingsPath]).toContain('tavern-settings.yaml')
    expect(env['OPENAI_API_KEY']).toBeUndefined()
  })

  it('fails clearly when no local OpenCode config exists', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-tavern-opencode-'))
    temporaryDirectories.push(directory)

    expect(() => loadTavernOpenCodeConfig({ cwd: directory, homeDirectory: directory })).toThrow(/could not find a local OpenCode config/)
  })
})
