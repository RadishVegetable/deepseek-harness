# `@deepseek-ai/dsh-tavern-shared`

[English](README.md) | 中文

面向 Tavern 的纯共享工具，负责稳定标识符、带标签的源文本、JSON 校验和 World Info 角色识别。本包不依赖 Cordis、持久化、模型、文件系统或 UI，也不执行 I/O。

## 接口

- `slug(value, fallback)` 使用 Unicode 字母/数字规则 `[^\p{L}\p{N}]`，转为小写；输入为空时返回调用方明确提供的 fallback。
- `parseLabeledLines(text, fallbackLabel)` 解析非空的 `label: value` 行。省略 `fallbackLabel` 时不生成 fallback；提供后，仅当源文本没有可用标签行且两个值都非空时生成一行 fallback。
- `collectCharacterEntries(entries, fieldsForEntry)` 识别 `Type: character` 条目，返回原始 entry 和提取出的 `Name`。可选的规范化字段可以覆盖源文本，但 entry 仍由调用方拥有。
- `parseJson`、`isRecord` 和 `isJsonValue` 提供 Tavern 调用方共用的 JSON 解析和校验实现。
- `suggestedLabels` 是按 `character` 与 `world` 分组的冻结只读建议词汇表。调用方可以展示或放入 prompt，但不能把它当成 schema。

## 模型体验

### 共享工具数据

#### 模型看到的内容

本包本身不会直接让模型看到内容。调用方可以将 `suggestedLabels` 放入规范化 prompt；本包不创建模型请求或 prompt section。

#### Token 影响

本包不直接消耗 token。建议词汇表带来的 prompt 成本由执行规范化的调用方负责。

#### KV Cache 影响

无。本包不拥有请求或缓存。

## 已知限制与后续工作

- `parseLabeledLines` 每行只识别一个以冒号分隔的标签和值，不解析任意结构化文档。
- `collectCharacterEntries` 只接受规范化后精确等于 `character` 的类型值；其他 World Info 角色约定由兼容解析器或调用方负责。
