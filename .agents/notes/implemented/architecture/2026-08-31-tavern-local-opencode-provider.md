# Agent Note: Tavern reads the local OpenCode provider without mutating shared settings

Status: implemented

English | [中文](2026-08-31-tavern-local-opencode-provider.zh.md)

## Problem

Tavern needs to use the provider a developer already configured for OpenCode, but the dsh settings document has a higher precedence than bundle composition. Reusing the shared settings file could therefore keep an unrelated coding-model selection active, while storing the OpenCode API key in DSH settings would create a second secret source and a repository-facing leak risk.

## Decision

The source-checkout Tavern launcher reads the project-level or user-level OpenCode JSON/JSONC configuration before Cordis starts. It selects the first usable provider with an OpenAI-compatible endpoint, API key, and model map, resolves environment/file key references locally, and passes the resolved values to the Tavern process through launcher-only environment variables. The launcher appends a separate Cordis overlay that declares that provider as `opencode-local` with the endpoint, headers, model limits, and `apiKeyEnv` reference; the key is never written to YAML, DSH settings, or repository files. The ordinary Tavern patch remains usable without a local OpenCode configuration.

For the OpenCode Zen endpoint (`https://opencode.ai/zen/go/v1`), the launcher prefers OpenCode's managed `opencode-go` credential from `~/.local/share/opencode/auth.json` over a stale literal provider key. Other endpoints retain the configured environment, file, or literal key resolution.

The OpenCode overlay points the settings provider at `$DSH_HOME/tavern-settings.yaml`. This keeps saved Tavern model changes available to later Tavern runs while preventing the shared `$DSH_HOME/settings.yaml` selection from silently overriding the Tavern route or being overwritten by it. The general settings and credential precedence remains the existing [configuration-source decision](2026-08-04-configuration-source-ownership.md); this profile-specific file is the launcher-level choice needed to pin a deployment against shared user settings.

## Alternatives considered

**Reuse the shared DSH settings file.** Rejected because its user layer outranks the Tavern composition and can select a different route; changing it at launch would also change unrelated profiles.

**Persist the OpenCode API key in DSH settings.** Rejected because the credential seam deliberately stores references rather than secret values. The launcher can resolve the local OpenCode secret and keep it process-local without creating another durable secret store.

**Connect to `opencode serve` as if it were an OpenAI endpoint.** Rejected because the OpenCode server API is a client/server control surface, not the OpenAI-compatible model endpoint declared by the local provider configuration.

## Consequences

Tavern starts with the same local OpenCode endpoint, headers, and configured model that its operator selected for OpenCode, without requiring a second API-key entry or changing other dsh profiles. A Tavern process now requires a usable local OpenCode provider, and the profile-specific settings file means general dsh settings are not automatically shared with Tavern. The launcher supports JSON and JSONC syntax, project-over-global config precedence, and OpenCode environment/file key references.

## Verification

The launcher resolver has focused tests for JSONC comments and trailing commas, model selection, environment-key resolution, managed Zen authentication, process-only environment injection, and a missing-config failure. The local machine configuration resolves to the OpenCode Zen endpoint and `deepseek-v4-flash` through the managed credential without printing secret values.
