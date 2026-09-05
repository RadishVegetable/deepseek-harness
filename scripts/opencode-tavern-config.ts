/**
 * Read the local OpenCode provider configuration needed by the Tavern launcher.
 *
 * The launcher keeps the resolved API key in the child process environment for
 * the lifetime of that process. It never writes the key to DSH settings or a
 * repository file.
 *
 * @module opencode-tavern-config
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

/** Environment names used by the Tavern Cordis overlay. */
export const TAVERN_OPENCODE_ENV = {
  api: 'DSH_TAVERN_OPENCODE_API',
  apiKey: 'DSH_TAVERN_OPENCODE_API_KEY',
  baseURL: 'DSH_TAVERN_OPENCODE_BASE_URL',
  contextWindow: 'DSH_TAVERN_OPENCODE_CONTEXT_WINDOW',
  displayName: 'DSH_TAVERN_OPENCODE_DISPLAY_NAME',
  enabled: 'DSH_TAVERN_OPENCODE_ENABLED',
  headers: 'DSH_TAVERN_OPENCODE_HEADERS',
  maxTokens: 'DSH_TAVERN_OPENCODE_MAX_TOKENS',
  model: 'DSH_TAVERN_OPENCODE_MODEL',
  modelName: 'DSH_TAVERN_OPENCODE_MODEL_NAME',
  settingsPath: 'DSH_TAVERN_SETTINGS_PATH',
} as const

/** A model selected from the local OpenCode provider configuration. */
export interface TavernOpenCodeModel {
  /** Provider-owned model id. */
  id: string
  /** Display name from the OpenCode config, or the model id. */
  name: string
  /** Context window when OpenCode declares one. */
  contextWindow?: number
  /** Maximum output tokens when OpenCode declares one. */
  maxTokens?: number
}

/** Provider settings passed to the Tavern LLM adapter. */
export interface TavernOpenCodeConfig {
  /** OpenCode provider key selected from the merged local config. */
  sourceProvider: string
  /** Provider display name. */
  displayName: string
  /** OpenAI-compatible protocol used by the OpenCode provider. */
  api: 'openai-completions'
  /** OpenAI-compatible endpoint base URL. */
  baseURL: string
  /** API key resolved from the local OpenCode configuration. */
  apiKey: string
  /** Additional request headers declared by the local provider. */
  headers: Record<string, string>
  /** Default model selected for Tavern. */
  model: TavernOpenCodeModel
}

/** Inputs that make local-config loading deterministic in tests and launchers. */
export interface LoadTavernOpenCodeOptions {
  /** Process environment used for config-path and secret references. */
  env?: NodeJS.ProcessEnv
  /** Directory containing the project-level OpenCode config. */
  cwd?: string
  /** Home directory used for the global OpenCode config. */
  homeDirectory?: string
  /** Explicit config file, bypassing normal project/global discovery. */
  configPath?: string
}

type JsonObject = Record<string, unknown>

/** Return a record without treating arrays or null as provider objects. */
function asRecord(value: unknown): JsonObject | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as JsonObject
}

/** Remove JSONC comments while preserving string contents and line numbers. */
function stripJsonComments(source: string): string {
  let result = ''
  let quote = false
  let escaped = false
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index] ?? ''
    const next = source[index + 1] ?? ''
    if (quote) {
      result += current
      if (escaped) escaped = false
      else if (current === '\\') escaped = true
      else if (current === '"') quote = false
      continue
    }
    if (current === '"') {
      quote = true
      result += current
      continue
    }
    if (current === '/' && next === '/') {
      index += 1
      while (index + 1 < source.length && source[index + 1] !== '\n' && source[index + 1] !== '\r') index += 1
      continue
    }
    if (current === '/' && next === '*') {
      index += 1
      while (index + 1 < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        const commentCharacter = source[index] ?? ''
        if (commentCharacter === '\n' || commentCharacter === '\r') result += commentCharacter
        index += 1
      }
      index += 1
      continue
    }
    result += current
  }
  return result
}

/** Remove JSONC trailing commas outside quoted strings. */
function stripTrailingCommas(source: string): string {
  let result = ''
  let quote = false
  let escaped = false
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index] ?? ''
    if (quote) {
      result += current
      if (escaped) escaped = false
      else if (current === '\\') escaped = true
      else if (current === '"') quote = false
      continue
    }
    if (current === '"') {
      quote = true
      result += current
      continue
    }
    if (current === ',') {
      let lookahead = index + 1
      while (lookahead < source.length && /\s/.test(source[lookahead] ?? '')) lookahead += 1
      if (source[lookahead] === '}' || source[lookahead] === ']') continue
    }
    result += current
  }
  return result
}

/** Parse one OpenCode JSON or JSONC document without logging its contents. */
function parseConfig(source: string, filename: string): JsonObject {
  try {
    const parsed: unknown = JSON.parse(stripTrailingCommas(stripJsonComments(source)))
    const config = asRecord(parsed)
    if (config === undefined) throw new TypeError('the root value must be an object')
    return config
  } catch (error) {
    const detail = error instanceof SyntaxError ? 'invalid JSONC' : error instanceof Error ? error.message : 'invalid document'
    throw new Error(`Tavern OpenCode config ${filename}: ${detail}`)
  }
}

/** Merge plain OpenCode config objects with later project values taking precedence. */
function mergeConfig(under: JsonObject, over: JsonObject): JsonObject {
  const merged: JsonObject = { ...under }
  for (const [key, value] of Object.entries(over)) {
    const lower = asRecord(merged[key])
    const upper = asRecord(value)
    merged[key] = lower !== undefined && upper !== undefined ? mergeConfig(lower, upper) : value
  }
  return merged
}

/** Find the preferred OpenCode config filename in one directory. */
function findConfig(directory: string): string | undefined {
  for (const filename of ['opencode.jsonc', 'opencode.json']) {
    const candidate = join(directory, filename)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/** Resolve the config files that OpenCode commonly exposes to a local project. */
function configFiles(options: LoadTavernOpenCodeOptions): string[] {
  if (options.configPath !== undefined) return [resolve(options.configPath)]
  const env = options.env ?? process.env
  const cwd = options.cwd ?? process.cwd()
  const homeDirectory = options.homeDirectory ?? homedir()
  const configHome = env.XDG_CONFIG_HOME === undefined
    ? join(homeDirectory, '.config')
    : resolve(env.XDG_CONFIG_HOME)
  const files: string[] = []
  const global = findConfig(join(configHome, 'opencode'))
  const project = findConfig(cwd)
  if (global !== undefined) files.push(global)
  if (project !== undefined && project !== global) files.push(project)
  return files
}

/** Resolve an OpenCode API key value without including it in diagnostics. */
function resolveApiKey(value: unknown, env: NodeJS.ProcessEnv, configFile: string): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value
  const reference = asRecord(value)
  if (reference === undefined) return undefined
  if (typeof reference.env === 'string') return env[reference.env]
  if (typeof reference.file === 'string') {
    const filename = isAbsolute(reference.file) ? reference.file : resolve(dirname(configFile), reference.file)
    return readFileSync(filename, 'utf8').trim() || undefined
  }
  return undefined
}

/** Read the credential OpenCode stores for its hosted Zen provider. */
function resolveOpenCodeGoApiKey(homeDirectory: string): string | undefined {
  const filename = join(homeDirectory, '.local', 'share', 'opencode', 'auth.json')
  if (!existsSync(filename)) return undefined
  try {
    const auth = asRecord(JSON.parse(readFileSync(filename, 'utf8')))
    const provider = asRecord(auth?.['opencode-go'])
    const key = provider?.key
    return typeof key === 'string' && key.length > 0 ? key : undefined
  } catch (error) {
    if (error instanceof SyntaxError) return undefined
    throw error
  }
}

/** Use OpenCode's managed Zen credential when the configured endpoint is Zen. */
function resolveProviderApiKey(
  baseURL: string,
  configured: unknown,
  env: NodeJS.ProcessEnv,
  configFile: string,
  homeDirectory: string,
): string | undefined {
  const isOpenCodeZen = baseURL === 'https://opencode.ai/zen/go/v1' || baseURL === 'https://opencode.ai/zen/go/v1/'
  return isOpenCodeZen
    ? resolveOpenCodeGoApiKey(homeDirectory) ?? resolveApiKey(configured, env, configFile)
    : resolveApiKey(configured, env, configFile)
}

/** Read a finite positive number from an OpenCode model limit. */
function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

/** Select one model entry from an OpenCode provider's model map. */
function selectModel(provider: string, config: JsonObject, models: JsonObject): TavernOpenCodeModel {
  const configured = typeof config.model === 'string' && config.model.startsWith(`${provider}/`)
    ? config.model.slice(provider.length + 1)
    : undefined
  const id = configured !== undefined && asRecord(models[configured]) !== undefined
    ? configured
    : Object.keys(models).find(key => asRecord(models[key]) !== undefined)
  if (id === undefined) throw new Error(`Tavern OpenCode provider "${provider}" does not declare a model`)
  const model = asRecord(models[id]) ?? {}
  const limit = asRecord(model.limit)
  const contextWindow = positiveNumber(limit?.context)
  const maxTokens = positiveNumber(limit?.output)
  return {
    id,
    name: typeof model.name === 'string' && model.name.length > 0 ? model.name : id,
    ...(contextWindow === undefined ? {} : { contextWindow }),
    ...(maxTokens === undefined ? {} : { maxTokens }),
  }
}

/** Resolve string-valued request headers while ignoring malformed entries. */
function resolveHeaders(value: unknown): Record<string, string> {
  const source = asRecord(value)
  if (source === undefined) return {}
  return Object.fromEntries(Object.entries(source).filter(([, item]) => typeof item === 'string')) as Record<string, string>
}

/**
 * Load the first usable OpenCode OpenAI-compatible provider from local config.
 *
 * Project config values override the global config. When several providers are
 * present, the configured `model` selects its provider; otherwise the first
 * provider with a base URL, API key, and model map is used.
 *
 * @param options - Optional paths and environment overrides.
 * @returns Resolved provider settings for the Tavern overlay.
 */
export function loadTavernOpenCodeConfig(options: LoadTavernOpenCodeOptions = {}): TavernOpenCodeConfig {
  const env = options.env ?? process.env
  const homeDirectory = options.homeDirectory ?? homedir()
  const files = configFiles(options)
  if (files.length === 0) {
    throw new Error('Tavern could not find a local OpenCode config (expected ~/.config/opencode/opencode.jsonc or opencode.jsonc in the project)')
  }
  let config: JsonObject = {}
  for (const filename of files) config = mergeConfig(config, parseConfig(readFileSync(filename, 'utf8'), filename))
  const providers = asRecord(config.provider)
  if (providers === undefined) throw new Error(`Tavern OpenCode config ${files.at(-1)} has no provider entries`)
  const configuredProvider = typeof config.model === 'string' ? config.model.split('/')[0] : undefined
  const candidates = Object.entries(providers).filter(([, value]) => asRecord(value) !== undefined)
  candidates.sort(([left], [right]) => {
    if (left === configuredProvider) return -1
    if (right === configuredProvider) return 1
    return 0
  })
  for (const [sourceProvider, rawProvider] of candidates) {
    const provider = asRecord(rawProvider)
    if (provider === undefined) continue
    const optionsObject = asRecord(provider.options)
    const baseURL = optionsObject?.baseURL
    const models = asRecord(provider.models)
    if (typeof baseURL !== 'string' || baseURL.length === 0 || models === undefined) continue
    const apiKey = resolveProviderApiKey(baseURL, optionsObject?.apiKey, env, files.at(-1) ?? '', homeDirectory)
    if (apiKey === undefined || apiKey.length === 0) continue
    return {
      sourceProvider,
      displayName: typeof provider.name === 'string' && provider.name.length > 0 ? provider.name : sourceProvider,
      api: 'openai-completions',
      baseURL,
      apiKey,
      headers: resolveHeaders(optionsObject?.headers),
      model: selectModel(sourceProvider, config, models),
    }
  }
  throw new Error(`Tavern found no usable OpenCode provider in ${files.at(-1)}`)
}

/**
 * Put resolved OpenCode values in the current process for the Cordis overlay.
 *
 * @param config - Provider values returned by {@link loadTavernOpenCodeConfig}.
 * @param env - Environment object to mutate, defaulting to `process.env`.
 */
export function applyTavernOpenCodeEnvironment(config: TavernOpenCodeConfig, env: NodeJS.ProcessEnv = process.env): void {
  const dshHome = env.DSH_HOME === undefined ? join(homedir(), '.dsh') : resolve(env.DSH_HOME)
  env[TAVERN_OPENCODE_ENV.enabled] = '1'
  env[TAVERN_OPENCODE_ENV.api] = config.api
  env[TAVERN_OPENCODE_ENV.apiKey] = config.apiKey
  env[TAVERN_OPENCODE_ENV.baseURL] = config.baseURL
  env[TAVERN_OPENCODE_ENV.displayName] = config.displayName
  env[TAVERN_OPENCODE_ENV.headers] = JSON.stringify(config.headers)
  env[TAVERN_OPENCODE_ENV.model] = config.model.id
  env[TAVERN_OPENCODE_ENV.modelName] = config.model.name
  env[TAVERN_OPENCODE_ENV.contextWindow] = String(config.model.contextWindow ?? 131072)
  env[TAVERN_OPENCODE_ENV.maxTokens] = String(config.model.maxTokens ?? 32768)
  env[TAVERN_OPENCODE_ENV.settingsPath] = join(dshHome, 'tavern-settings.yaml')
}
