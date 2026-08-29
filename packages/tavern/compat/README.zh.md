# dsh-tavern-compat

[English](README.md) | 中文

`@deepseek-ai/dsh-tavern-compat` 是无依赖的 Tavern 角色卡和世界书解析、匹配包。不依赖 Cordis 运行时，返回纯规范化数据，供后续 Tavern 适配层使用。

## 解析

`parseCharacterCard(input)` 接受 `chara_card_v2` 和 `chara_card_v3` 的 JSON 字符串或对象。解析时优先读取 `data`，再回退到顶层字段，因此两种导出形式都兼容。结果会把 `first_mes` 等字段规范化为 `firstMessage`，解析内嵌的 `character_book`，并在 `raw` 中保留原始解析对象。未知的顶层字段和 data 字段分别保留在 `unknown` 与 `dataUnknown` 中；传入字符串时，`rawJson` 保留原始文本。

`parseCharacterCardPng(input)` 会提取角色卡 PNG `chara` 元数据块中的 Base64 JSON，并交给同一套规范化逻辑处理。支持未压缩的 `tEXt` 和 `iTXt` 块；压缩元数据会明确报错。解析只读取元数据，不会保留 PNG 图片字节。

`parseWorldInfo(input)` 接受独立世界书或 YMLv2 JSON，同时兼容数字键对象和数组形式的 `entries`。文档级的 `scan_depth`、`token_budget`、`recursive_scanning` 会被保留；条目级的 `key`/`keys`、`keysecondary`/`secondary_keys`、`disable`/`enabled`、`use_regex`/`useRegex`、`order`/`insertion_order`、概率、depth、group、sticky 和 cooldown 会被标准化。文档和条目的未知字段会和各自的 `raw` 一起保留。

非法 JSON、字段类型错误和不支持的角色卡 spec 会抛出明确异常。解析不会修改输入对象。

## 匹配

`matchesWorldInfoEntry(entry, text)` 处理禁用、constant、selective、子串、整词、大小写和正则条目。Selective 条目必须先命中主关键词；配置了 secondary key 时，还必须命中至少一个 secondary key。空关键词永不匹配。非法正则会抛出 `SyntaxError`，不会被静默忽略。

`selectWorldInfoEntries(entries, text)` 过滤匹配条目，并按 `insertionOrder` 升序排列。概率逻辑不使用随机数：`useProbability=false` 时不做概率过滤，0% 和 100% 是确定结果，中间概率必须由调用方传入 `[0, 100)` 范围内的 `probabilityRoll`。

## Model Experience

### 请求上下文和条件

#### 模型看到的内容

本包只解析和匹配数据；后续 Tavern context compiler（例如 `compileContext()`）决定哪些规范化字段进入模型请求。

#### Token 影响

Zero direct token effect.

#### KV Cache 影响

None; this package does not create or modify model requests.

## 已知限制与后续工作

- **不解析压缩 PNG 元数据** - 压缩的 `zTXt`/`iTXt` 角色卡块需要调用方先使用运行时解压器处理。
- **不执行递归世界书扫描** - 本包只匹配调用方提供的一段文本，不处理递归、深度、预算、分组或持久化计时器。
- **不生成概率源** - 中间概率条目需要调用方提供确定性的 roll。
