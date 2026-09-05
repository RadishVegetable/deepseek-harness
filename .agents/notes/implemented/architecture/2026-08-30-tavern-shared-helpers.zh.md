# Agent Note: Tavern shared helper package

Status: implemented

[English](2026-08-30-tavern-shared-helpers.md) | 中文

## Problem

Tavern 在 Host、Compat、State 和 UI 中分别实现了 slug、标签行、JSON 与 World Info 角色识别。Unicode 处理和 fallback 规则可能发生漂移，使标识符和人物关联依赖调用方。

## Decision

`@deepseek-ai/dsh-tavern-shared` 负责这些纯函数的唯一实现。`slug` 使用 Unicode 字母/数字规则和调用方明确提供的 fallback；`parseLabeledLines` 只返回可用行，除非提供 fallback label；`collectCharacterEntries` 将源文本与可选的规范化覆盖字段合并，并返回原始 entry；`parseJson`、`isRecord` 和 `isJsonValue` 负责 JSON 解析与递归校验；`suggestedLabels` 是冻结的引导数据，不是 schema。

本包没有运行时依赖，并使用结构化 invariant companion，因此纯工具源码不会导入 Cordis。Compat、State、Host 和 UI 在原有职责位置使用本包。State 保留 `isJsonValue` 导出作为 re-export，领域专用的 JSON object 包装器仍保留在本地。

## Alternatives considered

**将 helper 放入 `dsh-tavern-context`：** 不采用，因为 Compat 和 UI 需要这些词汇而不应依赖上下文编译器；独立包能明确保持依赖方向。

**只共享 JSON 工具包：** 不采用，因为 slug、源文本行解析和 World Info 角色识别有共同的跨界一致性要求，只抽 JSON 会留下最关键的重复启发式。

**让规范化字段替代源文本：** 不采用，因为规范化字段不完整时仍必须读取源文本中的 `Type` 和 `Name`；shared collector 按 label 合并，并让规范化值覆盖对应源行。

## Consequences

Host 与 UI 现在使用相同的 slug 和角色识别规则，GM 输出、存储 schema、Compat 与 State 的 JSON 校验也不再分叉。调用方必须明确选择领域 slug fallback；需要源文本 fallback 的调用方必须传入 `fallbackLabel`，shared 不推断这些策略。helper 测试覆盖 Unicode、空值、部分规范化覆盖、fenced JSON、非法 JSON 值和冻结建议词汇表。完整覆盖率仍由仓库 coverage gate 负责，不由本阶段的聚焦检查替代。
