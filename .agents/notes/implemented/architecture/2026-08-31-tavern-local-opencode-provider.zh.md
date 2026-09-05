# Agent Note: Tavern 读取本机 OpenCode provider 且不修改共享设置

Status: implemented

[English](2026-08-31-tavern-local-opencode-provider.md) | 中文

## 问题

Tavern 需要直接使用开发者已经为 OpenCode 配置的 provider，但 dsh 设置文档的优先级高于 bundle composition。复用共享设置文件可能让无关的编码模型选择继续生效；把 OpenCode API key 写入 DSH 设置又会产生第二个 secret 来源和面向仓库的泄露风险。

## 决策

源码仓库中的 Tavern 启动器在 Cordis 启动前读取项目级或用户级 OpenCode JSON/JSONC 配置。它选择第一个同时具有 OpenAI-compatible endpoint、API key 和 model map 的可用 provider，在本地解析环境变量或文件形式的 key，再通过仅属于 Tavern 启动进程的环境变量传给 Tavern。启动器追加一个独立的 Cordis overlay，将该 provider 声明为 `opencode-local`，携带 endpoint、headers、模型限制和 `apiKeyEnv` 引用；key 不会写入 YAML、DSH 设置或仓库文件。普通 Tavern patch 在没有本机 OpenCode 配置时仍然可用。

当 endpoint 为 OpenCode Zen（`https://opencode.ai/zen/go/v1`）时，启动器优先从 `~/.local/share/opencode/auth.json` 读取 OpenCode 管理的 `opencode-go` credential，避免继续使用失效的 provider 字面量 key。其他 endpoint 仍按配置中的环境变量、文件或字面量 key 解析。

OpenCode overlay 将 settings provider 指向 `$DSH_HOME/tavern-settings.yaml`。这样 Tavern 保存的模型变更可以在后续 Tavern 启动中继续使用，同时防止共享 `$DSH_HOME/settings.yaml` 的选择静默覆盖 Tavern 路由或被 Tavern 覆盖。通用设置和 credential 优先级仍遵循现有的[配置来源决策](2026-08-04-configuration-source-ownership.md)；这个 profile 专用文件是让启动器能够固定部署配置、抵御共享用户设置所做的选择。

## 考虑过的替代方案

**复用共享 DSH 设置文件。** 不采用，因为它的用户层级高于 Tavern composition，可能选择另一条路由；启动时修改它还会改变无关 profile。

**把 OpenCode API key 持久化到 DSH 设置。** 不采用，因为 credential seam 有意保存引用而不是 secret 值。启动器可以解析本机 OpenCode secret 并只在进程内保留，不需要再创建一个持久化 secret 存储。

**把 `opencode serve` 当作 OpenAI endpoint 连接。** 不采用，因为 OpenCode server API 是 client/server 控制面，不是本机 provider 配置声明的 OpenAI-compatible 模型 endpoint。

## 后果

Tavern 启动时会使用操作者在 OpenCode 中选择的本机 endpoint、headers 和模型，不需要再次输入 API key，也不会改变其他 dsh profile。现在 Tavern 进程要求本机存在可用的 OpenCode provider；同时，profile 专用的 settings 文件意味着通用 dsh 设置不会自动与 Tavern 共享。启动器支持 JSON 和 JSONC 语法、项目配置覆盖用户配置，以及 OpenCode 的环境变量/文件 key 引用。

## 验证

启动器解析器的聚焦测试覆盖 JSONC 注释和尾逗号、模型选择、环境变量 key 解析、Zen 托管认证、仅进程环境注入以及缺失配置时的明确失败。本机配置可以通过托管 credential 解析到 OpenCode Zen endpoint 和 `deepseek-v4-flash`，且不会打印 secret 值。
