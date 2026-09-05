# @deepseek-ai/dsh-tavern-memory

[English](README.md) | 中文

面向 Tavern 旅程的追加式记忆能力包。事实以 session 日志为唯一来源；fold、检索索引、资产清洗视图和注入快照都是派生数据，可以随时重建。

## 接口

`parseMemoryExtractionOutput()` 校验一次完整的结构化模型响应，支持 fenced JSON 和普通 JSON。批次格式错误时返回 `undefined`，调用方可以重试而不推进游标。

`parseMemorySummaryOutput()` 单独校验压缩响应，只接受剧情梗概、带状态的未决伏笔和只包含关系的原子清理决定；它不能引入替代事实文本。

`ingestMemoryExtraction()` 校验人物目标，归一化兼容的结构键，跳过重复值，为 add/replace/remove 操作追加 observed 事件，并返回单调递增的区间游标。操作对 `(sessionId, span)` 幂等，且不会修改输入记录。

`MemoryExtractionScheduler` 按 Session 串行排队提取，同时允许不同旅程并发执行。`createMemoryExtractionId()` 和 `memoryExtractionIdempotencyKey()` 为重试与 reload 恢复提供稳定的区间标识。

`projectMemoryFacts()` 是人物和世界事实唯一的确定性视图 fold。结构键标识一个实体维度；通常由最新值生效，但玩家值或显式观察不能被后续的非显式观察静默压制。这类分歧会保留为冲突。`MemoryIndex` 是可丢弃的暴力派生索引，被覆盖的行会作为非活动审计数据保留。

`renderMemoryInjection()` 生成稳定角色设定区和动态旅程区，带当前事实出处、未决伏笔和可选预取结果。`appendMemoryInjectionSnapshot()` 把确切的模型可见文本记录为 `tavern/memory-context` session 事件。

`cleanTavernAsset()` 为角色卡和世界书提供带来源追踪的确定性回退结果。`uncleaned` 标志明确表示该视图仍可由模型清洗器替换，同时不会丢弃源 JSON。

`resolveMemoryConfig()` 校验提取、压缩、编辑、注入和检索策略。特别是，保留尾部必须覆盖可编辑窗口及配置的余量，checkpoint 输出也必须满足 token 预算。

## 模型体验

### 记忆注入

#### 模型看到的内容

所属 runtime 可以把 `staticText` 放入可复用的 system 前缀，把 `dynamicText` 放在请求末尾。动态区只包含带出处的 fold 当前值；本包不重复注入 checkpoint 历史，也不选择消息角色。

#### Token 影响

只有所属 provider 调用提取和检索时才会增加模型请求。注入消耗调用方提供的文本预算；压缩会拒绝超过配置 token 上限的 checkpoint。

#### KV Cache 影响

稳定区和动态区分离。事实变化只改变持久化的动态快照，角色设定前缀保持不变，使 consumer 可以保留可复用前缀。

## 已知限制与后续工作

- Host 已接线 turn-end 调度、provider 路由、可选的 `fact_search` 工具、资产清洗和酒馆专用压缩。`SqliteFactIndex` 提供持久化的派生索引存储，`DeterministicEmbeddingProvider` 提供本地确定性 embedding 回退。
- 外部 embedding provider、ANN 存储、向量池、跨旅程偏好记忆和通用 dsh memory 能力仍是后续工作。
- 资产清洗会保留原始源 JSON：`cleanTavernAsset()` 提供确定性回退，Host 可以用经过校验的模型规范视图替换它。
